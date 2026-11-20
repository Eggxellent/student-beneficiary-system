-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'field_officer',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  phone VARCHAR(50),
  national_id VARCHAR(100),
  relationship_to_student VARCHAR(50),
  last_login_at TIMESTAMP,
  CONSTRAINT users_role_supported_check CHECK (role IN ('admin', 'field_officer', 'guardian')),
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_supported_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_supported_check
      CHECK (role IN ('admin', 'field_officer', 'guardian'));
  END IF;
END $$;

-- 1b. One-time password reset links (issued by an administrator, single use, short lived)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at);

-- 2. Students
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  school_code VARCHAR(100),
  guardian_id VARCHAR(100),
  upi VARCHAR(100),
  national_id_number VARCHAR(100),
  primary_phone VARCHAR(50),
  qr_token VARCHAR(100),
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  birth_certificate_number VARCHAR(100),
  eligibility_score INTEGER,
  eligibility_category VARCHAR(50),
  eligibility_assessed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT students_school_supported_check
    CHECK (school_code IS NULL OR school_code IN ('Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda'))
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_upi_key;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_upi_unique;
DROP INDEX IF EXISTS students_upi_unique;

ALTER TABLE students ADD COLUMN IF NOT EXISTS eligibility_score INTEGER;
ALTER TABLE students ADD COLUMN IF NOT EXISTS eligibility_category VARCHAR(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS eligibility_assessed_at TIMESTAMP;
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_number VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS primary_phone VARCHAR(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_token VARCHAR(100);
ALTER TABLE students ALTER COLUMN upi DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_qr_token_unique ON students(qr_token) WHERE qr_token IS NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'birth_certificate_entry_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'birth_certificate_number'
  ) THEN
    ALTER TABLE students RENAME COLUMN birth_certificate_entry_number TO birth_certificate_number;
  ELSE
    ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_certificate_number VARCHAR(100);
  END IF;
END $$;

-- 3. Duplicate flags
CREATE TABLE IF NOT EXISTS duplicate_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  matched_student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  probability NUMERIC(5, 4) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  model_version TEXT,
  review_threshold NUMERIC(5, 4),
  comparison_features JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS model_version TEXT;
ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS review_threshold NUMERIC(5, 4);
ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS comparison_features JSONB;
COMMENT ON COLUMN duplicate_flags.probability IS
  'Legacy column name: model_version rows store an uncalibrated positive-class model score.';
CREATE UNIQUE INDEX IF NOT EXISTS duplicate_flags_unordered_pair_unique
  ON duplicate_flags (LEAST(student_id, matched_student_id), GREATEST(student_id, matched_student_id));

CREATE TABLE IF NOT EXISTS duplicate_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_flag_id UUID NOT NULL REFERENCES duplicate_flags(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  decision VARCHAR(30) NOT NULL CHECK (decision IN ('confirmed_duplicate', 'not_duplicate', 'needs_verification')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS duplicate_review_events_flag_created_idx
  ON duplicate_review_events(duplicate_flag_id, created_at DESC);

-- 4. Disbursements
CREATE TABLE IF NOT EXISTS disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  disbursement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  table_name VARCHAR(100),
  record_id UUID,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Reports
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID REFERENCES users(id),
  report_type VARCHAR(100) NOT NULL,
  start_date DATE,
  end_date DATE,
  file_path TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. Legacy beneficiaries
-- `/api/beneficiaries` is still mounted and `beneficiary.model.js` reads and writes
-- this table, and `services/databaseReadiness.js` requires it, so a database built
-- from this file must create it. The definition reproduces the shape observed in the
-- existing deployment (serial integer key, no foreign keys) and is additive only.
-- The meaning of `scholarship_amount` is still unresolved; it is preserved as-is and
-- is not mapped to any bursary award or payment amount.
CREATE TABLE IF NOT EXISTS beneficiaries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  school VARCHAR(255),
  grade_level VARCHAR(50),
  scholarship_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS guardian_application_reference_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS guardian_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(20) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted',
  student_full_name VARCHAR(255) NOT NULL,
  student_date_of_birth DATE,
  student_gender VARCHAR(20),
  student_identifier VARCHAR(100),
  relationship_to_student VARCHAR(50),
  school_name VARCHAR(255) NOT NULL,
  school_level VARCHAR(50),
  admission_number VARCHAR(100),
  class_year VARCHAR(100),
  school_county VARCHAR(150),
  guardian_full_name VARCHAR(255) NOT NULL,
  guardian_phone VARCHAR(50) NOT NULL,
  household_size INTEGER,
  income_source VARCHAR(150),
  monthly_income NUMERIC(14, 2),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMP,
  CONSTRAINT guardian_applications_status_check
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS guardian_applications_user_created_idx
  ON guardian_applications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guardian_applications_status_created_idx
  ON guardian_applications (status, created_at DESC);
