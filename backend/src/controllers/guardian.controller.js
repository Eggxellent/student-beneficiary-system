const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../config/db');
const { getJwtSecret } = require('../config/jwtSecret');
const logAudit = require('../services/auditLog');
const { DuplicateScreeningUnavailableError } = require('../services/studentRegistration');
const { linkGuardianApplicationStudent } = require('../services/guardianApplicationLink');

// Guardian status vocabulary. The database keeps snake_case values; the guardian pages use the
// shorter `statusKey` they were designed around ('review' for 'under_review').
//
// Every successful submission is recorded as `under_review`: the application status is driven only
// by the submission itself, never by duplicate screening. A duplicate review (when one applies) is a
// separate workflow with its own status and does not move this application to Approved; only an
// administrator decision does that.
const STATUS_LABELS = Object.freeze({
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
});
const STATUS_KEYS = Object.freeze({
  submitted: 'submitted',
  under_review: 'review',
  approved: 'approved',
  rejected: 'rejected',
});
const ACCOUNT_TYPES = Object.freeze([
  'parent',
  'legal_guardian',
  'adult_student',
  'authorised_caregiver',
]);

// Scoring vocabulary shared with services/eligibility.js. The guardian form shows friendly labels
// ("No previous bursary", "Yes - limited assistance", ...) but submits these exact values, so the
// automatic assessment never has to translate or guess what the guardian meant.
const VULNERABILITY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const PRIOR_BURSARY_LEVELS = Object.freeze(['none', 'low', 'high']);
const VULNERABILITY_LABELS = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High' });
const PRIOR_BURSARY_LABELS = Object.freeze({
  none: 'No previous bursary',
  low: 'Yes - limited assistance',
  high: 'Yes - substantial assistance',
});

function emptyToUndefined(value) {
  return value === '' || value === null ? undefined : value;
}

function optionalText(maxLength) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

function optionalNumber(maxValue) {
  return z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(maxValue).optional());
}

// A required measurement. An empty answer stays undefined so the field is reported as required
// instead of being coerced to 0 (0 is a meaningful answer for fee balance and siblings in school).
function requiredNumber({ message, max, integer = false }) {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : Number(value)),
    (integer
      ? z.number({ error: message }).int('Enter a whole number')
      : z.number({ error: message }))
      .min(0, 'The value cannot be negative')
      .max(max, `The value cannot be more than ${max}`),
  );
}

// Public registration rules agreed with the field team: the phone number is exactly 10 digits and the
// identification field accepts at most 9 letters/digits (national IDs are up to 9 digits, passports
// up to 9 characters). The same rules are mirrored in frontend/src/pages/GuardianRegistration.jsx.
const PHONE_RULE = /^\d{10}$/;
const IDENTIFICATION_RULE = /^[A-Za-z0-9]{1,9}$/;

const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Full legal name is required').max(255),
  email: z
    .string()
    .trim()
    .min(1, 'Email address is required')
    .email('Enter a valid email address')
    .max(255)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  phone: z
    .string()
    .trim()
    .min(1, 'Phone number is required')
    .regex(PHONE_RULE, 'Phone number must be exactly 10 digits, for example 0712345678'),
  national_id: z
    .string()
    .trim()
    .min(1, 'National ID or passport number is required')
    .regex(
      IDENTIFICATION_RULE,
      'National ID or passport number must be at most 9 letters or digits',
    ),
  relationship_to_student: z.enum(ACCOUNT_TYPES),
  privacy_consent: z.literal(true),
});

const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(255).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  national_id: z.string().trim().min(4).max(100).optional(),
  relationship_to_student: z.enum(ACCOUNT_TYPES).optional(),
});

const applicationSchema = z.object({
  student_full_name: z.string().trim().min(2).max(255),
  student_date_of_birth: optionalText(10),
  student_gender: optionalText(20),
  student_identifier: optionalText(100),
  relationship_to_student: optionalText(50),
  school_name: z.string().trim().min(2).max(255),
  school_level: optionalText(50),
  admission_number: optionalText(100),
  class_year: optionalText(100),
  school_county: optionalText(150),
  guardian_full_name: z.string().trim().min(2).max(255),
  guardian_phone: z.string().trim().min(7).max(30),
  household_size: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(50).optional(),
  ),
  income_source: optionalText(150),
  monthly_income: optionalNumber(1000000000),
  // The four remaining inputs the automatic eligibility assessment scores. They are required on a
  // new submission because the assessment runs immediately after duplicate screening; without them
  // the engine can only record an incomplete assessment. Ranges: KES fee balance up to 1 billion
  // (12,2 column), siblings 0-20 (a larger household size would mean more than 50 people).
  fee_balance: requiredNumber({ message: 'Fee balance (KES) is required', max: 1000000000 }),
  vulnerability_status: z.enum(VULNERABILITY_LEVELS, { error: 'Select the vulnerability level' }),
  siblings_in_school: requiredNumber({
    message: 'Number of siblings currently in school is required',
    max: 20,
    integer: true,
  }),
  prior_bursary_history: z.enum(PRIOR_BURSARY_LEVELS, { error: 'Select the prior bursary history' }),
  declaration: z.literal(true),
  documents: z.array(z.any()).max(10).optional(),
});

const decisionSchema = z.object({
  status: z.enum(['under_review', 'approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
});

function formatDate(value, style = 'long') {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: style === 'short' ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function presentSummary(row) {
  const statusKey = STATUS_KEYS[row.status] || 'submitted';
  return {
    id: row.id,
    reference: row.reference,
    status: STATUS_LABELS[row.status] || 'Submitted',
    statusKey,
    status_code: row.status,
    student: row.student_full_name,
    school: row.school_name,
    date: formatDate(row.created_at, 'short'),
    submittedDate: formatDate(row.created_at),
    submitted_at: row.created_at,
  };
}

function presentDocuments(details) {
  const documents = details && Array.isArray(details.documents) ? details.documents : [];
  return documents
    .filter(
      (document) =>
        document &&
        typeof document === 'object' &&
        typeof document.name === 'string' &&
        document.name.trim() !== '',
    )
    .map((document) => ({
      name: document.name,
      description: document.description || 'Supporting document',
    }));
}

function presentDetail(row) {
  const numericIncome = row.monthly_income === null ? null : Number(row.monthly_income);
  return {
    ...presentSummary(row),
    student: {
      name: row.student_full_name,
      dateOfBirth: formatDate(row.student_date_of_birth),
      gender: row.student_gender || '',
      identification: row.student_identifier || '',
      relationship: row.relationship_to_student || '',
    },
    school: {
      name: row.school_name,
      level: row.school_level || '',
      admissionNumber: row.admission_number || '',
      currentClass: row.class_year || '',
      location: row.school_county || '',
    },
    household: {
      guardianName: row.guardian_full_name,
      phone: row.guardian_phone,
      size: row.household_size === null ? '' : `${row.household_size} members`,
      incomeSource: row.income_source || '',
      monthlyIncome:
        numericIncome === null ? '' : `KES ${numericIncome.toLocaleString('en-KE')}`,
      // Submitted eligibility inputs, shown back to the guardian and used by the automatic
      // assessment. Labels stay human-readable here; the raw vocabulary is what the engine scores.
      feeBalance:
        row.fee_balance === null || row.fee_balance === undefined
          ? ''
          : `KES ${Number(row.fee_balance).toLocaleString('en-KE')}`,
      vulnerabilityStatus: VULNERABILITY_LABELS[row.vulnerability_status] || '',
      siblingsInSchool:
        row.siblings_in_school === null || row.siblings_in_school === undefined
          ? ''
          : String(row.siblings_in_school),
      priorBursaryHistory: PRIOR_BURSARY_LABELS[row.prior_bursary_history] || '',
    },
    decisionNote: row.decision_note || '',
    documents: presentDocuments(row.details),
  };
}

function presentStudentRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    school_code: row.school_code || null,
    school_name: row.school_name || null,
    guardian_id: row.guardian_id || null,
    created_at: row.created_at,
  };
}

async function presentLatestAssessment(client, studentId) {
  const { rows } = await client.query(
    `SELECT id, status, score, category, missing_inputs, assessed_at, trigger
       FROM eligibility_assessments WHERE student_id = $1
      ORDER BY assessed_at DESC, created_at DESC LIMIT 1`,
    [studentId],
  );
  return rows[0] || null;
}

function issueToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, getJwtSecret(), { expiresIn: '8h' });
}

async function register(req, res) {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.flatten();
    const message =
      Object.values(details.fieldErrors).flat().find(Boolean) || 'Invalid registration data';
    return res.status(400).json({ error: message, details });
  }

  const { full_name, email, password, phone, national_id, relationship_to_student } = result.data;
  const existing = await pool.query(
    `SELECT id FROM users WHERE email = $1 OR (national_id IS NOT NULL AND national_id = $2) LIMIT 1`,
    [email, national_id],
  );
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account with this email or national ID already exists' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  let user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, phone, national_id, relationship_to_student)
       VALUES ($1, $2, $3, 'guardian', $4, $5, $6)
       RETURNING id, full_name, email, role, phone, national_id, relationship_to_student, created_at`,
      [full_name, email, password_hash, phone, national_id, relationship_to_student],
    );
    user = rows[0];
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email or national ID already exists' });
    }
    throw error;
  }

  await logAudit(user.id, 'GUARDIAN_REGISTERED', 'users', user.id, { email: user.email });

  return res.status(201).json({
    message: 'Guardian account created successfully',
    token: issueToken(user),
    user,
  });
}

async function me(req, res) {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, role, phone, national_id, relationship_to_student,
            is_active, created_at, last_login_at
       FROM users WHERE id = $1 AND role = 'guardian'`,
    [req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Guardian account not found' });
  return res.json(rows[0]);
}

async function dashboard(req, res) {
  const [guardianResult, summaryResult, applicationsResult] = await Promise.all([
    pool.query('SELECT id, full_name, email, phone FROM users WHERE id = $1', [req.user.id]),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
         FROM guardian_applications WHERE user_id = $1 GROUP BY status`,
      [req.user.id],
    ),
    pool.query(
      `SELECT * FROM guardian_applications
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [req.user.id],
    ),
  ]);

  const counts = { submitted: 0, under_review: 0, approved: 0, rejected: 0 };
  for (const row of summaryResult.rows) counts[row.status] = row.count;
  const summary = {
    total: counts.submitted + counts.under_review + counts.approved + counts.rejected,
    submitted: counts.submitted,
    review: counts.under_review,
    approved: counts.approved,
    rejected: counts.rejected,
  };

  return res.json({
    guardian: guardianResult.rows[0] || null,
    summary,
    applications: applicationsResult.rows.map(presentSummary),
  });
}

async function listApplications(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM guardian_applications
      WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id],
  );
  return res.json({ applications: rows.map(presentSummary) });
}

async function createApplication(req, res) {
  const result = applicationSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid application data', details: result.error.flatten() });
  }
  const data = result.data;
  if (data.student_date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(data.student_date_of_birth)) {
    return res.status(400).json({ error: 'Date of birth must use the YYYY-MM-DD format' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One guardian's submissions are serialised so two identical requests cannot both screen and
    // both create a student for the same child.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `sbms.guardian.application.${req.user.id}`,
    ]);

    // Identity of the child, not of the submission. A retry, a double click or a resubmission of
    // the same form finds the earlier application and never creates a second student.
    const existing = await client.query(
      `SELECT * FROM guardian_applications
        WHERE user_id = $1
          AND status <> 'rejected'
          AND lower(btrim(student_full_name)) = lower(btrim($2))
          AND student_date_of_birth IS NOT DISTINCT FROM $3::date
          AND lower(btrim(school_name)) = lower(btrim($4))
        ORDER BY created_at DESC
        LIMIT 1`,
      [req.user.id, data.student_full_name, data.student_date_of_birth || null, data.school_name],
    );

    let application = existing.rows[0] || null;

    if (application && application.student_id) {
      // The earlier submission already produced a student record. Return that application instead
      // of screening and registering the same child again. Documents supplied on a resubmission are
      // merged into the same application so evidence is never lost by a retry.
      if (data.documents?.length) {
        const existingDocuments = application.details?.documents || [];
        const merged = [...existingDocuments];
        for (const document of data.documents) {
          const index = merged.findIndex((item) => item.name === document.name);
          if (index >= 0) merged[index] = document;
          else merged.push(document);
        }
        const updated = await client.query(
          'UPDATE guardian_applications SET details = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
          [JSON.stringify({ ...application.details, documents: merged }), application.id],
        );
        application = updated.rows[0];
      }
      const student = await client.query('SELECT * FROM students WHERE id = $1', [application.student_id]);
      const assessment = await presentLatestAssessment(client, application.student_id);
      await client.query('COMMIT');
      return res.status(200).json({
        application: presentDetail(application),
        duplicate_submission: true,
        student: presentStudentRecord(student.rows[0]),
        assessment,
      });
    }

    if (!application) {
    const referenceResult = await client.query(
      `SELECT 'APP-' || EXTRACT(YEAR FROM NOW())::int || '-' ||
              lpad(nextval('guardian_application_reference_seq')::text, 5, '0') AS reference`,
    );
    const reference = referenceResult.rows[0].reference;

    const inserted = await client.query(
      `INSERT INTO guardian_applications (
         reference, user_id, status, student_full_name, student_date_of_birth, student_gender,
         student_identifier, relationship_to_student, school_name, school_level,
         admission_number, class_year, school_county, guardian_full_name, guardian_phone,
         household_size, income_source, monthly_income,
         fee_balance, vulnerability_status, siblings_in_school, prior_bursary_history, details
       ) VALUES (
         $1, $2, 'under_review', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
         $19, $20, $21, $22
       ) RETURNING *`,
      [
        reference,
        req.user.id,
        data.student_full_name,
        data.student_date_of_birth || null,
        data.student_gender || null,
        data.student_identifier || null,
        data.relationship_to_student || null,
        data.school_name,
        data.school_level || null,
        data.admission_number || null,
        data.class_year || null,
        data.school_county || null,
        data.guardian_full_name,
        data.guardian_phone,
        data.household_size ?? null,
        data.income_source || null,
        data.monthly_income ?? null,
        data.fee_balance,
        data.vulnerability_status,
        data.siblings_in_school,
        data.prior_bursary_history,
        // Initial submissions carry no supporting documents; the column keeps an empty list until
        // an authorised officer requests evidence through the More Info Required workflow.
        JSON.stringify({ documents: data.documents || [] }),
      ],
    );

      application = inserted.rows[0];

      await logAudit(
        req.user.id,
        'GUARDIAN_APPLICATION_SUBMITTED',
        'guardian_applications',
        application.id,
        { reference },
        client,
      );
    }

    // The application is preserved as submitted (status under_review); the student record is the
    // same record duplicate screening has always produced for a registration.
    let linkage;
    try {
      linkage = await linkGuardianApplicationStudent({
        client,
        application,
        actorId: req.user.id,
      });
    } catch (error) {
      if (error instanceof DuplicateScreeningUnavailableError) {
        await client.query('ROLLBACK');
        return res.status(503).json({
          error: 'Your application was not submitted because duplicate screening is unavailable. Please retry.',
          code: 'DUPLICATE_SCREENING_UNAVAILABLE',
        });
      }
      throw error;
    }
    application = linkage.application;

    await client.query('COMMIT');

    return res.status(201).json({
      application: presentDetail(application),
      duplicate_submission: false,
      student: presentStudentRecord(linkage.student),
      duplicate_screening: linkage.screening,
      assessment: linkage.assessment,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getApplication(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM guardian_applications WHERE reference = $1 AND user_id = $2`,
    [req.params.reference, req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Application not found' });
  return res.json({ application: presentDetail(rows[0]) });
}

async function staffQueue(req, res) {
  // Administrator review screen. Each row carries the linked student, the latest duplicate flag and
  // the latest assessment so a reviewer can see why a submission is still waiting, and can tell an
  // application from before the linkage pipeline (student_id IS NULL) from one that is genuinely
  // unresolved.
  const { rows } = await pool.query(
    `SELECT a.*, u.full_name AS guardian_account_name, u.email AS guardian_email,
            s.full_name AS registered_full_name, s.upi AS registered_upi,
            flag.status AS duplicate_status, flag.probability AS duplicate_probability,
            assessment.status AS assessment_status, assessment.score AS assessment_score,
            assessment.category AS assessment_category,
            assessment.missing_inputs AS assessment_missing_inputs
       FROM guardian_applications a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN students s ON s.id = a.student_id
       LEFT JOIN LATERAL (
         SELECT status, probability FROM duplicate_flags
          WHERE student_id = a.student_id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       ) flag ON TRUE
       LEFT JOIN LATERAL (
         SELECT status, score, category, missing_inputs FROM eligibility_assessments
          WHERE student_id = a.student_id
          ORDER BY assessed_at DESC, created_at DESC
          LIMIT 1
       ) assessment ON TRUE
      ORDER BY a.created_at DESC`,
  );
  return res.json({
    applications: rows.map((row) => ({
      ...presentSummary(row),
      detail: presentDetail(row),
      guardianAccount: row.guardian_account_name,
      guardianEmail: row.guardian_email,
      student_id: row.student_id || null,
      registeredStudent: row.student_id
        ? {
            id: row.student_id,
            full_name: row.registered_full_name || row.student_full_name,
            upi: row.registered_upi || null,
          }
        : null,
      duplicate: row.duplicate_status
        ? {
            status: row.duplicate_status,
            probability:
              row.duplicate_probability === null ? null : Number(row.duplicate_probability),
          }
        : null,
      assessment: row.assessment_status
        ? {
            status: row.assessment_status,
            score: row.assessment_score === null ? null : Number(row.assessment_score),
            category: row.assessment_category || null,
            missing_inputs: row.assessment_missing_inputs || [],
          }
        : null,
    })),
  });
}

async function staffDecision(req, res) {
  const result = decisionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid decision data', details: result.error.flatten() });
  }
  const { status, note } = result.data;
  const decided = status === 'approved' || status === 'rejected';

  const { rows } = await pool.query(
    `UPDATE guardian_applications
        SET status = $1,
            decision_note = $2,
            decided_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [status, note || null, decided, req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Application not found' });

  await logAudit(
    req.user.id,
    'GUARDIAN_APPLICATION_DECIDED',
    'guardian_applications',
    rows[0].id,
    { status, reference: rows[0].reference },
  );
  return res.json({ application: presentDetail(rows[0]) });
}

module.exports = {
  register,
  me,
  updateProfile,
  dashboard,
  listApplications,
  createApplication,
  getApplication,
  staffQueue,
  staffDecision,
};

async function updateProfile(req, res) {
  const result = profileSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid profile data', details: result.error.flatten() });
  }
  const fields = result.data;
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'No profile fields to update' });

  const assignments = keys.map((key, index) => `${key} = $${index + 2}`);
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${assignments.join(', ')}
        WHERE id = $1 AND role = 'guardian'
        RETURNING id, full_name, email, role, phone, national_id, relationship_to_student,
                  is_active, created_at, last_login_at`,
      [req.user.id, ...keys.map((key) => fields[key])],
    );
    if (!rows.length) return res.status(404).json({ error: 'Guardian account not found' });
    await logAudit(req.user.id, 'GUARDIAN_PROFILE_UPDATED', 'users', req.user.id, { fields: keys });
    return res.json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That national ID is already registered' });
    }
    throw error;
  }
}
