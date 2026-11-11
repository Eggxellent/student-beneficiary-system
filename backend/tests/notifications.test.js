const notifications = require('../src/services/notifications');

const award = {
  id: 'a8fb65d1-4ff7-4cf0-b585-63991a4f409a',
  student_id: '5f458334-2c75-4d06-86dd-9eb7c47bbfab',
  submitted_by: 'ce05b86e-f645-4ed9-8772-a954a77f1664',
  requested_amount: 15000,
};

function recordingDb(rows = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    }),
  };
}

describe('notification service', () => {
  test('a submitted proposal notifies administrators only, once per award', async () => {
    const db = recordingDb();
    await notifications.notifyAwardSubmitted(db, { award, studentName: 'Test Learner' });

    expect(db.calls).toHaveLength(1);
    const [{ sql, params }] = db.calls;
    expect(sql).toContain("WHERE u.role = 'admin' AND u.is_active = TRUE");
    expect(sql).toContain('ON CONFLICT (user_id, dedupe_key) DO NOTHING');
    expect(params).toEqual([
      'award_submitted',
      'Award proposal awaiting review',
      'Test Learner · KES 15,000 requested',
      '/awards',
      award.id,
      `award-submitted:${award.id}`,
    ]);
  });

  test('a rejection reaches the proposing officer, not the deciding administrator', async () => {
    const db = recordingDb();
    await notifications.notifyAwardDecision(db, {
      award,
      studentName: 'Test Learner',
      decision: 'rejected',
      approvedAmount: null,
    });

    const [{ sql, params }] = db.calls;
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7)');
    expect(params[0]).toBe(award.submitted_by);
    expect(params[1]).toBe('award_rejected');
    expect(params[2]).toBe('Award rejected');
    expect(params[6]).toBe(`award-rejected:${award.id}`);
  });

  test('an approval states the approved amount, not the requested one', async () => {
    const db = recordingDb();
    await notifications.notifyAwardDecision(db, {
      award,
      studentName: 'Test Learner',
      decision: 'approved',
      approvedAmount: 12000,
    });

    const [{ params }] = db.calls;
    expect(params[1]).toBe('award_approved');
    expect(params[3]).toBe('Test Learner · KES 12,000 approved');
  });

  test('no award decision notification is written when the proposer is unknown', async () => {
    const db = recordingDb();
    await notifications.notifyAwardDecision(db, {
      award: { ...award, submitted_by: null },
      studentName: 'Test Learner',
      decision: 'approved',
      approvedAmount: 12000,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a certificate notification names the reference and is deduped on the certificate', async () => {
    const db = recordingDb();
    const certificate = { id: '0b0b0b0b-1111-4222-8333-444444444444', certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ' };
    await notifications.notifyCertificateReady(db, { award, studentName: 'Test Learner', certificate });

    const [{ params }] = db.calls;
    expect(params[1]).toBe('certificate_ready');
    expect(params[3]).toBe('Test Learner · SBMS-2026-K8M4-X7PQ-2RZ');
    expect(params[6]).toBe(`certificate-ready:${certificate.id}`);
  });

  test('a notification body never carries identifier or guardian fields', async () => {
    const db = recordingDb();
    await notifications.notifyAwardSubmitted(db, { award, studentName: 'Test Learner' });
    const body = String(db.calls[0].params[2]);
    expect(body).not.toMatch(/national|birth|guardian|score|token/i);
  });
});
