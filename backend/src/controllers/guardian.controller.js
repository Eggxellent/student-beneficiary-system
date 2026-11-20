const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../config/db');
const { getJwtSecret } = require('../config/jwtSecret');
const logAudit = require('../services/auditLog');

// Guardian status vocabulary. The database keeps snake_case values; the guardian pages use the
// shorter `statusKey` they were designed around ('review' for 'under_review').
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

function emptyToUndefined(value) {
  return value === '' || value === null ? undefined : value;
}

function optionalText(maxLength) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

function optionalNumber(maxValue) {
  return z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(maxValue).optional());
}

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  phone: z.string().trim().min(7).max(30),
  national_id: z.string().trim().min(4).max(100),
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
    },
    decisionNote: row.decision_note || '',
    documents: [],
  };
}

function issueToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, getJwtSecret(), { expiresIn: '8h' });
}

async function register(req, res) {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid registration data', details: result.error.flatten() });
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
    const referenceResult = await client.query(
      `SELECT 'APP-' || EXTRACT(YEAR FROM NOW())::int || '-' ||
              lpad(nextval('guardian_application_reference_seq')::text, 5, '0') AS reference`,
    );
    const reference = referenceResult.rows[0].reference;

    const { rows } = await client.query(
      `INSERT INTO guardian_applications (
         reference, user_id, student_full_name, student_date_of_birth, student_gender,
         student_identifier, relationship_to_student, school_name, school_level,
         admission_number, class_year, school_county, guardian_full_name, guardian_phone,
         household_size, income_source, monthly_income, details
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
        JSON.stringify({ documents: data.documents || [] }),
      ],
    );

    await logAudit(
      req.user.id,
      'GUARDIAN_APPLICATION_SUBMITTED',
      'guardian_applications',
      rows[0].id,
      { reference },
      client,
    );
    await client.query('COMMIT');

    return res.status(201).json({ application: presentDetail(rows[0]) });
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
  const { rows } = await pool.query(
    `SELECT a.*, u.full_name AS guardian_account_name, u.email AS guardian_email
       FROM guardian_applications a
       JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC`,
  );
  return res.json({
    applications: rows.map((row) => ({
      ...presentSummary(row),
      guardianAccount: row.guardian_account_name,
      guardianEmail: row.guardian_email,
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
