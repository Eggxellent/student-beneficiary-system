-- Guardian submission -> student record -> duplicate screening -> automatic assessment.
--
-- 1. A guardian application now owns the student record it created. The unique index makes the
--    link the idempotency key: a repeated or retried submission can never attach a second student
--    to the same application, and no application can claim a student that already belongs to
--    another application.
ALTER TABLE guardian_applications
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guardian_applications_student_unique
  ON guardian_applications(student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS guardian_applications_student_idx
  ON guardian_applications(student_id)
  WHERE student_id IS NOT NULL;

-- 2. Guardian intake collects the school as free text, while students.school_code only accepts the
--    five configured codes. Keep the submitted name so nothing is lost when no code matches.
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_name VARCHAR(255);

-- 3. Automatic assessments may run before every scoring input exists. An incomplete row records the
--    inputs that were available, names the missing ones and carries no score. "Incomplete" is a
--    real state, not a zero score, so the columns it cannot fill become nullable.
ALTER TABLE eligibility_assessments
  ALTER COLUMN score DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN fee_balance DROP NOT NULL,
  ALTER COLUMN household_income DROP NOT NULL,
  ALTER COLUMN vulnerability_status DROP NOT NULL,
  ALTER COLUMN siblings_in_school DROP NOT NULL,
  ALTER COLUMN prior_bursary_history DROP NOT NULL;

ALTER TABLE eligibility_assessments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS missing_inputs TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trigger VARCHAR(40) NOT NULL DEFAULT 'officer_form',
  ADD COLUMN IF NOT EXISTS trigger_reference UUID;

ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_status_check;
ALTER TABLE eligibility_assessments ADD CONSTRAINT eligibility_assessments_status_check
  CHECK (status IN ('complete', 'incomplete'));

ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_complete_score_check;
ALTER TABLE eligibility_assessments ADD CONSTRAINT eligibility_assessments_complete_score_check
  CHECK (status = 'incomplete' OR (score IS NOT NULL AND category IS NOT NULL));

ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_trigger_check;
ALTER TABLE eligibility_assessments ADD CONSTRAINT eligibility_assessments_trigger_check
  CHECK (trigger IN ('officer_form', 'registration_screening', 'duplicate_clearance'));

-- One automatic assessment per student per triggering event: a retried request is a no-op instead
-- of a second record. Officer-completed assessments stay unconstrained (a revised form is history).
CREATE UNIQUE INDEX IF NOT EXISTS eligibility_assessments_automatic_event_unique
  ON eligibility_assessments(student_id, trigger, trigger_reference)
  WHERE trigger IN ('registration_screening', 'duplicate_clearance')
    AND trigger_reference IS NOT NULL;
