-- Guardian-led applications.
--
-- A guardian applies without an account and receives a tracking code. Nothing here replaces
-- `students`: an application is a claim about a child, a student row is the verified record created
-- at the end of the workflow (docs/guardian-led-workflow.md).
--
-- Two integrity rules are enforced by the database, not by the handler, because the payload is the
-- only evidence of what was submitted once a human decision has been made from it:
--   1. `submitted_payload` is immutable after insert (trigger below, rule 8).
--   2. `tracking_code_hash` is unique, so one code cannot resolve to two applications.
-- Timeline timestamps are not duplicated in a table of their own: every transition writes an
-- `audit_logs` row named in docs/guardian-led-workflow.md section 4, which is the same trail the
-- rest of the system already uses.

CREATE TABLE IF NOT EXISTS student_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the 10-character code. The plaintext is returned once and never stored.
  tracking_code_hash TEXT NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  submitted_payload JSONB NOT NULL,

  guardian_name VARCHAR(255) NOT NULL,
  guardian_phone VARCHAR(50) NOT NULL,
  guardian_email VARCHAR(255),
  relationship_to_student VARCHAR(50),

  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE NOT NULL,
  school_code VARCHAR(100) NOT NULL,
  upi VARCHAR(100),
  birth_certificate_number VARCHAR(100),
  national_id_number VARCHAR(100),
  primary_phone VARCHAR(50),

  screening_score NUMERIC(5, 4),
  screening_model_version TEXT,
  screening_threshold NUMERIC(5, 4),
  screening_priority VARCHAR(20),
  screening_failure_code VARCHAR(40),
  screened_at TIMESTAMP,
  candidates_considered INTEGER,
  candidates_qualifying INTEGER,
  candidates_suppressed INTEGER,

  verified_student_id UUID REFERENCES students(id),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMP,
  decision_reason TEXT,

  duplicate_of_student_id UUID REFERENCES students(id),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT student_applications_status_check CHECK (status IN (
    'submitted', 'screened', 'needs_investigation', 'investigated', 'resolved',
    'verified', 'award_recommended', 'approved', 'rejected', 'withdrawn'
  )),
  -- Same supported-school rule as students; an application may never name a school the register
  -- cannot hold, otherwise verification would have to reject a value it accepted.
  CONSTRAINT student_applications_school_supported_check CHECK (
    school_code IN ('Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda')
  ),
  CONSTRAINT student_applications_contact_present_check CHECK (
    length(btrim(guardian_name)) > 0 AND length(btrim(guardian_phone)) > 0
  ),
  -- At least one identifier, matching the submission rule in docs/guardian-led-workflow.md section 7.
  CONSTRAINT student_applications_identifier_present_check CHECK (
    upi IS NOT NULL OR birth_certificate_number IS NOT NULL OR national_id_number IS NOT NULL
  ),
  CONSTRAINT student_applications_verified_consistent_check CHECK (
    (status IN ('verified', 'award_recommended', 'approved')
      AND verified_student_id IS NOT NULL AND verified_at IS NOT NULL)
    OR status NOT IN ('verified', 'award_recommended', 'approved')
  )
);

CREATE INDEX IF NOT EXISTS student_applications_status_created_idx
  ON student_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS student_applications_name_idx
  ON student_applications(lower(full_name));
CREATE INDEX IF NOT EXISTS student_applications_verified_student_idx
  ON student_applications(verified_student_id)
  WHERE verified_student_id IS NOT NULL;

-- The payload is evidence. A later correction is a new column (or a new application), never an edit
-- of what the guardian signed.
CREATE OR REPLACE FUNCTION sbms_reject_application_payload_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.submitted_payload IS DISTINCT FROM OLD.submitted_payload THEN
    RAISE EXCEPTION 'student_applications.submitted_payload is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_applications_payload_immutable ON student_applications;
CREATE TRIGGER student_applications_payload_immutable
  BEFORE UPDATE ON student_applications
  FOR EACH ROW EXECUTE FUNCTION sbms_reject_application_payload_change();

COMMENT ON COLUMN student_applications.submitted_payload IS
  'Verbatim normalised submission; guarded by student_applications_payload_immutable.';
COMMENT ON COLUMN student_applications.tracking_code_hash IS
  'SHA-256 of the tracking code; the code itself is returned once at submission and not stored.';
