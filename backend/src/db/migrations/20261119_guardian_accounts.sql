-- Guardian accounts and guardian-owned bursary applications.
--
-- Guardians sign in through the existing /api/auth/login endpoint, so the only authentication
-- change is a third supported value in the users role constraint. Ownership is enforced by
-- guardian_applications.user_id; staff keep their existing roles and workflows.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_supported_check;
ALTER TABLE users ADD CONSTRAINT users_role_supported_check
  CHECK (role IN ('admin', 'field_officer', 'guardian'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS relationship_to_student VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS users_national_id_key
  ON users (national_id)
  WHERE national_id IS NOT NULL;

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
