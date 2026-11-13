// Writes the notification rows for the handful of SBMS events that ask someone to act.
//
// Everything here runs inside the caller's transaction and through the caller's query executor,
// so a notification is never committed for an event that rolled back, and a retried request
// cannot double-notify thanks to the (user_id, dedupe_key) unique constraint.
//
// Deliberately absent: national IDs, birth certificate numbers, dates of birth, guardians,
// documents and duplicate-detection scores. A notification preview says what happened and which
// award it concerns, nothing that should not sit on a lock screen.

const AWARDS_PATH = '/awards';

// A notification is a side effect of the event, never a condition for it. Every write therefore
// runs inside a savepoint: a missing table (an unapplied migration), a lock timeout or a constraint
// change costs the recipient a notification, but it must not roll back the award an officer just
// proposed or an administrator just decided. Without the savepoint PostgreSQL aborts the whole
// transaction (25P02) and the user is told the action failed when it did not.
const NOTIFICATION_SAVEPOINT = 'notification_write';

function reportFailure(category, error) {
  const reason = error && (error.code || error.message);
  console.warn(`[notifications] ${category} not delivered: ${reason}`);
}

async function guardedWrite(db, category, write) {
  await db.query(`SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
  try {
    const result = await write();
    await db.query(`RELEASE SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
    return result;
  } catch (error) {
    try {
      await db.query(`ROLLBACK TO SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
    } catch (rollbackError) {
      // The connection is gone; the caller's ROLLBACK reports it.
    }
    reportFailure(category, error);
    return null;
  }
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`;
}

async function insertForUser(db, { userId, category, title, body, referenceId, dedupeKey }) {
  if (!userId) return null;
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, category, title, body, link, reference_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [userId, category, title, body, AWARDS_PATH, referenceId || null, dedupeKey]
  );
  return rows[0] || null;
}

// One statement for every administrator, so a new administrator does not need a backfill and a
// proposal never produces a notification for anyone who cannot open the awards page.
async function insertForAdmins(db, { category, title, body, referenceId, dedupeKey }) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, category, title, body, link, reference_id, dedupe_key)
     SELECT u.id, $1, $2, $3, $4, $5, $6
     FROM users u
     WHERE u.role = 'admin' AND u.is_active = TRUE
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [category, title, body, AWARDS_PATH, referenceId || null, dedupeKey]
  );
  return rows.length;
}

// A field officer proposed an amount; an administrator has to review it.
async function notifyAwardSubmitted(db, { award, studentName }) {
  const amount = formatAmount(award.requested_amount);
  return guardedWrite(db, 'award_submitted', () => insertForAdmins(db, {
    category: 'award_submitted',
    title: 'Award proposal awaiting review',
    body: amount ? `${studentName} · ${amount} requested` : `${studentName} · proposal submitted`,
    referenceId: award.id,
    dedupeKey: `award-submitted:${award.id}`,
  }));
}

// The deciding administrator gets no notification here: they performed the action, and the
// proposing officer is the person who needs to know the outcome.
async function notifyAwardDecision(db, { award, studentName, decision, approvedAmount }) {
  const approved = decision === 'approved';
  const amount = formatAmount(approvedAmount);
  if (!award.submitted_by) return null;
  return guardedWrite(db, approved ? 'award_approved' : 'award_rejected', () => insertForUser(db, {
    userId: award.submitted_by,
    category: approved ? 'award_approved' : 'award_rejected',
    title: approved ? 'Award approved' : 'Award rejected',
    body: approved && amount
      ? `${studentName} · ${amount} approved`
      : `${studentName} · decision recorded, see Awards`,
    referenceId: award.id,
    dedupeKey: `award-${decision}:${award.id}`,
  }));
}

// Issued once per award, from the same transaction that writes the certificate row, so the
// officer learns about the download at the moment the certificate exists.
async function notifyCertificateReady(db, { award, studentName, certificate }) {
  if (!certificate) return null;
  return guardedWrite(db, 'certificate_ready', () => insertForUser(db, {
    userId: award.submitted_by,
    category: 'certificate_ready',
    title: 'Certificate ready to download',
    body: `${studentName} · ${certificate.certificate_reference}`,
    referenceId: award.id,
    dedupeKey: `certificate-ready:${certificate.id}`,
  }));
}

module.exports = {
  notifyAwardSubmitted,
  notifyAwardDecision,
  notifyCertificateReady,
};
