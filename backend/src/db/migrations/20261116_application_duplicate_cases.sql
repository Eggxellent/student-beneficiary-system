-- Let an application enter the existing duplicate queue.
--
-- The queue, its review events and its resolutions are reused rather than rebuilt: a case is still a
-- `duplicate_flags` row, still reviewed by a human, and the model still only supplies an advisory
-- score (docs/guardian-led-workflow.md sections 5.2 and 8). What changes is that a case may now
-- describe an application (not yet a student) against an existing student.

ALTER TABLE duplicate_flags
  ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES student_applications(id) ON DELETE CASCADE;

-- Registration cases always carry student_id. Application cases do not have a student yet.
ALTER TABLE duplicate_flags ALTER COLUMN student_id DROP NOT NULL;

-- PostgreSQL's LEAST/GREATEST ignore NULLs, so the legacy unordered-pair index would key every
-- application case against the same matched student as (matched, matched): two different
-- applications pointing at one existing student would collide and the second case would be lost.
-- Restricting the legacy index to registration cases keeps its guarantee exactly as before and lets
-- the application index below carry the equivalent guarantee for application cases.
DROP INDEX IF EXISTS duplicate_flags_unordered_pair_unique;
CREATE UNIQUE INDEX IF NOT EXISTS duplicate_flags_unordered_pair_unique
  ON duplicate_flags (LEAST(student_id, matched_student_id), GREATEST(student_id, matched_student_id))
  WHERE application_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'duplicate_flags'::regclass
      AND conname = 'duplicate_flags_case_subject_check'
  ) THEN
    ALTER TABLE duplicate_flags
      ADD CONSTRAINT duplicate_flags_case_subject_check
      CHECK (student_id IS NOT NULL OR application_id IS NOT NULL);
  END IF;
END $$;

-- Re-screening the same application against the same student must not open a second case.
CREATE UNIQUE INDEX IF NOT EXISTS duplicate_flags_application_pair_unique
  ON duplicate_flags (application_id, matched_student_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS duplicate_flags_application_idx
  ON duplicate_flags(application_id)
  WHERE application_id IS NOT NULL;

-- One audit trail, two reviewers: the field officer investigates, the administrator decides.
-- The stage says which of the two wrote the event; the decision vocabulary is unchanged.
ALTER TABLE duplicate_review_events
  ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'admin_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'duplicate_review_events'::regclass
      AND conname = 'duplicate_review_events_stage_check'
  ) THEN
    ALTER TABLE duplicate_review_events
      ADD CONSTRAINT duplicate_review_events_stage_check
      CHECK (stage IN ('admin_review', 'field_investigation'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS duplicate_review_events_flag_stage_created_idx
  ON duplicate_review_events(duplicate_flag_id, stage, created_at DESC);
