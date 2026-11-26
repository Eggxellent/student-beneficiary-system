const pool = require('../config/db');

function withoutQrToken(student) {
  if (!student) return student;
  const { qr_token, ...safeStudent } = student;
  return safeStudent;
}

async function create({ full_name, date_of_birth, school_code, school_name, guardian_id, admission_number, upi, birth_certificate_number, national_id_number, primary_phone, qr_token }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, school_name, guardian_id, admission_number, upi, birth_certificate_number, national_id_number, primary_phone, qr_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [full_name, date_of_birth || null, school_code || null, school_name || null, guardian_id || null, admission_number || null, upi || null, birth_certificate_number || null, national_id_number || null, primary_phone || null, qr_token || null]
  );
  return withoutQrToken(rows[0]);
}

// The one duplicate-visibility rule shared by every Field Officer read path: the roster used by the
// assessment and award forms, the single-record read, the registered list and the dashboard. A
// record is withheld while any case involving it is open, unresolved or confirmed, or while the
// record itself is marked as another record's duplicate.
const NO_DUPLICATE_CASE_FILTER = `
  s.duplicate_of_student_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM guardian_applications ga
     WHERE ga.student_id = s.id
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs screening
          WHERE screening.table_name = 'guardian_applications'
            AND screening.record_id = ga.id
            AND screening.action = 'GUARDIAN_APPLICATION_LINKED_STUDENT'
       )
  )
  AND NOT EXISTS (
    SELECT 1 FROM duplicate_flags f
     WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
       AND f.status IN ('pending', 'needs_verification')
  )
  AND NOT EXISTS (
    SELECT 1 FROM duplicate_flags f
     WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
       AND f.status = 'confirmed_duplicate'
       AND NOT EXISTS (
         SELECT 1 FROM duplicate_resolutions r WHERE r.duplicate_flag_id = f.id
       )
  )
`;

// Only a guardian-registered, duplicate-cleared row with a completed assessment is a "registered
// student" on the dashboard. Same rule, plus the guardian and assessment conditions.
const CLEARED_GUARDIAN_STUDENT_FILTER = `
  s.guardian_id IS NOT NULL
  AND ${NO_DUPLICATE_CASE_FILTER}
`;

// Field Officer roster used by the eligibility and award forms. Every student without an open or
// confirmed duplicate case is selectable; students still awaiting an assessment remain visible so
// the officer can complete it. The filter is in the query, so a direct API call cannot obtain a
// wider list than the screens offer.
async function getFieldOfficerRoster() {
  const { rows } = await pool.query(
    `SELECT * FROM students s WHERE ${NO_DUPLICATE_CASE_FILTER} ORDER BY s.created_at DESC`
  );
  return rows.map(withoutQrToken);
}

// Single-record read with the same rule. A duplicate-pending or confirmed-duplicate student is
// indistinguishable from a missing one, so the record cannot be enumerated by id either.
async function getFieldOfficerStudent(id) {
  const { rows } = await pool.query(
    `SELECT * FROM students s WHERE s.id = $1 AND ${NO_DUPLICATE_CASE_FILTER}`,
    [id]
  );
  return withoutQrToken(rows[0]);
}

// Field Officer eligibility-findings projection: the guardian registration and the saved automatic
// assessment for every duplicate-cleared guardian record, in one read. The screen that shows this is
// read-only, so the projection carries the values the guardian submitted and the assessment the
// engine already recorded (including the inputs it could not fill) instead of the students row alone.
// students.school_code stays NULL when the guardian typed a school name that matches no configured
// code, so the display school is COALESCE(school_code, school_name).
const ELIGIBILITY_FINDING_SELECT = `
  SELECT s.id, s.full_name, s.date_of_birth, s.birth_certificate_number,
         COALESCE(s.school_code, s.school_name) AS school,
         s.school_code, s.school_name, s.guardian_id, s.upi, s.primary_phone, s.created_at,
         ga.reference AS application_reference,
         ga.school_name AS application_school_name, ga.school_level, ga.class_year,
         ga.school_county, ga.admission_number,
         ga.guardian_full_name, ga.guardian_phone, ga.relationship_to_student,
         ga.household_size, ga.income_source, ga.monthly_income,
         ga.fee_balance, ga.vulnerability_status, ga.siblings_in_school,
         ga.prior_bursary_history,
         ga.created_at AS application_submitted_at,
         a.status AS assessment_status, a.score, a.category,
         a.recommended_min, a.recommended_max, a.recommended_currency,
         a.recommendation_provisional, a.recommendation_source,
         a.fee_balance AS assessed_fee_balance,
         a.household_income AS assessed_household_income,
         a.vulnerability_status AS assessed_vulnerability_status,
         a.siblings_in_school AS assessed_siblings_in_school,
         a.prior_bursary_history AS assessed_prior_bursary_history,
         a.missing_inputs, a.assessed_at, a.trigger AS assessment_trigger
    FROM students s
    LEFT JOIN LATERAL (
      SELECT g.reference, g.school_name, g.school_level, g.class_year, g.school_county,
             g.admission_number, g.guardian_full_name, g.guardian_phone,
             g.relationship_to_student, g.household_size, g.income_source,
             g.monthly_income, g.fee_balance, g.vulnerability_status, g.siblings_in_school,
             g.prior_bursary_history, g.created_at
        FROM guardian_applications g
       WHERE g.student_id = s.id
       ORDER BY g.created_at DESC
       LIMIT 1
    ) ga ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.status, e.score, e.category, e.recommended_min, e.recommended_max,
             e.recommended_currency, e.recommendation_provisional, e.recommendation_source,
             e.fee_balance, e.household_income, e.vulnerability_status,
             e.siblings_in_school, e.prior_bursary_history,
             e.missing_inputs, e.assessed_at, e.trigger
        FROM eligibility_assessments e
       WHERE e.student_id = s.id
       ORDER BY e.assessed_at DESC, e.created_at DESC
       LIMIT 1
    ) a ON TRUE
`;

// Splits the joined row into the student, the application it came from and the assessment the
// engine recorded. A record without an application or an assessment keeps that part null instead of
// being padded with placeholders.
function eligibilityFinding(row) {
  const {
    application_reference, application_school_name, school_level, class_year, school_county,
    admission_number, guardian_full_name, guardian_phone, relationship_to_student,
    household_size, income_source, monthly_income, fee_balance, vulnerability_status,
    siblings_in_school, prior_bursary_history, application_submitted_at,
    assessment_status, score, category, recommended_min, recommended_max,
    recommended_currency, recommendation_provisional, recommendation_source,
    assessed_fee_balance, assessed_household_income, assessed_vulnerability_status,
    assessed_siblings_in_school, assessed_prior_bursary_history,
    missing_inputs, assessed_at, assessment_trigger,
    ...student
  } = row;

  return {
    ...student,
    application: application_reference
      ? {
          reference: application_reference,
          school_name: application_school_name,
          school_level,
          class_year,
          school_county,
          admission_number,
          guardian_full_name,
          guardian_phone,
          relationship_to_student,
          household_size,
          income_source,
          monthly_income,
          // What the guardian actually submitted, next to the inputs the engine scored.
          fee_balance,
          vulnerability_status,
          siblings_in_school,
          prior_bursary_history,
          submitted_at: application_submitted_at,
        }
      : null,
    assessment: assessment_status
      ? {
          status: assessment_status,
          score,
          category,
          recommended_min,
          recommended_max,
          recommended_currency,
          provisional: recommendation_provisional,
          source: recommendation_source,
          missing_inputs: missing_inputs || [],
          assessed_at,
          trigger: assessment_trigger,
          inputs: {
            fee_balance: assessed_fee_balance,
            household_income: assessed_household_income,
            vulnerability_status: assessed_vulnerability_status,
            siblings_in_school: assessed_siblings_in_school,
            prior_bursary_history: assessed_prior_bursary_history,
          },
        }
      : null,
  };
}

async function getFieldOfficerEligibilityFindings() {
  const { rows } = await pool.query(
    `${ELIGIBILITY_FINDING_SELECT}
      WHERE s.guardian_id IS NOT NULL
        AND ${NO_DUPLICATE_CASE_FILTER}
      ORDER BY s.created_at DESC`
  );
  return rows.map(eligibilityFinding);
}


//
// A record is returned only when all three conditions hold:
//   * it was registered under a guardian (guardian_id was captured at intake),
//   * no duplicate case involving it is open or unresolved, and
//   * a saved eligibility assessment exists, with the recommended range that produced it.
//
// The rule lives here rather than in the React table so a direct API call receives the same
// answer. Nothing is deleted or rewritten: the excluded rows stay readable through their own
// review, assessment and award records.
async function getFieldOfficerRegisteredStudents() {
  const { rows } = await pool.query(
    `SELECT s.id, s.full_name, s.date_of_birth,
            COALESCE(s.school_code, s.school_name) AS school_code, s.school_name,
            s.guardian_id, s.admission_number, s.upi, s.primary_phone, s.birth_certificate_number,
            s.national_id_number, s.created_at,
            a.score, a.category, a.recommended_min, a.recommended_max,
            a.recommended_currency, a.recommendation_provisional, a.recommendation_source,
            a.assessed_at
       FROM students s
       JOIN LATERAL (
         SELECT ea.score, ea.category, ea.recommended_min, ea.recommended_max,
                ea.recommended_currency, ea.recommendation_provisional,
                ea.recommendation_source, ea.assessed_at
           FROM eligibility_assessments ea
          WHERE ea.student_id = s.id AND ea.status = 'complete'
          ORDER BY ea.assessed_at DESC, ea.created_at DESC
          LIMIT 1
       ) a ON TRUE
      WHERE ${CLEARED_GUARDIAN_STUDENT_FILTER}
      ORDER BY s.created_at DESC`
  );
  return rows.map((row) => ({
    ...row,
    duplicate_status: 'cleared',
    assessment_status: 'assessed',
  }));
}

// Field Officer dashboard projection. Every figure comes from the same filter as the registered
// list; "needs attention" is a student who cleared duplicate screening but whose assessment is
// incomplete (an input was not supplied) or was never recorded.
async function getFieldOfficerOverview() {
  const [counts, attention, recent] = await Promise.all([
    pool.query(
      `WITH cleared AS (
         SELECT s.id,
                (SELECT ea.category
                   FROM eligibility_assessments ea
                  WHERE ea.student_id = s.id AND ea.status = 'complete'
                  ORDER BY ea.assessed_at DESC, ea.created_at DESC
                  LIMIT 1) AS category
           FROM students s
          WHERE ${CLEARED_GUARDIAN_STUDENT_FILTER}
       )
       SELECT COUNT(*) FILTER (WHERE category IS NOT NULL)::int AS registered_students,
              COUNT(*) FILTER (WHERE category IS NULL)::int AS needs_attention,
              COUNT(*) FILTER (WHERE category = 'high')::int AS high,
              COUNT(*) FILTER (WHERE category = 'moderate')::int AS moderate,
              COUNT(*) FILTER (WHERE category = 'low')::int AS low
         FROM cleared`
    ),
    pool.query(
      `SELECT s.id, s.full_name, COALESCE(s.school_code, s.school_name) AS school,
              s.guardian_id, s.created_at,
              a.status AS assessment_status, a.missing_inputs, a.assessed_at
         FROM students s
         LEFT JOIN LATERAL (
           SELECT ea.status, ea.missing_inputs, ea.assessed_at
             FROM eligibility_assessments ea
            WHERE ea.student_id = s.id
            ORDER BY ea.assessed_at DESC, ea.created_at DESC
            LIMIT 1
         ) a ON TRUE
        WHERE ${CLEARED_GUARDIAN_STUDENT_FILTER}
          AND NOT EXISTS (
            SELECT 1 FROM eligibility_assessments c
             WHERE c.student_id = s.id AND c.status = 'complete'
          )
        ORDER BY s.created_at DESC
        LIMIT 10`
    ),
    pool.query(
      `SELECT s.id, s.full_name, COALESCE(s.school_code, s.school_name) AS school,
              s.created_at, a.score, a.category, a.assessed_at
         FROM students s
         JOIN LATERAL (
           SELECT ea.score, ea.category, ea.assessed_at
             FROM eligibility_assessments ea
            WHERE ea.student_id = s.id AND ea.status = 'complete'
            ORDER BY ea.assessed_at DESC, ea.created_at DESC
            LIMIT 1
         ) a ON TRUE
        WHERE ${CLEARED_GUARDIAN_STUDENT_FILTER}
        ORDER BY s.created_at DESC
        LIMIT 5`
    ),
  ]);

  const totals = counts.rows[0] || {};
  return {
    metrics: {
      registered_students: totals.registered_students || 0,
      needs_attention: totals.needs_attention || 0,
      high_eligibility: totals.high || 0,
      breakdown: {
        high: totals.high || 0,
        moderate: totals.moderate || 0,
        low: totals.low || 0,
      },
    },
    needs_attention: attention.rows.map((row) => ({
      ...row,
      reason: row.assessment_status === 'incomplete'
        ? `Assessment incomplete${row.missing_inputs?.length ? `: ${row.missing_inputs.join(', ').replaceAll('_', ' ')}` : ''}`
        : 'No eligibility assessment recorded',
    })),
    recent_registrations: recent.rows,
  };
}

async function hasQrToken(token) {
  const { rows } = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM students WHERE qr_token = $1) AS found',
    [token]
  );
  return rows[0].found;
}

module.exports = { create, getFieldOfficerRoster, getFieldOfficerStudent, getFieldOfficerRegisteredStudents, getFieldOfficerEligibilityFindings, getFieldOfficerOverview, hasQrToken };
