-- Application closure.
--
-- Rejection and withdrawal are terminal states a person chooses, not the result of a failed check.
-- The reason and the actor are stored on the application itself so a later reader does not have to
-- reconstruct the decision from the audit log, while the audit log still records the transition.
ALTER TABLE student_applications
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS closure_reason TEXT;

CREATE INDEX IF NOT EXISTS student_applications_closed_idx
  ON student_applications(closed_at)
  WHERE closed_at IS NOT NULL;
