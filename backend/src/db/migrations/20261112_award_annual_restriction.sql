-- One bursary per student per calendar year, plus the correction/void path that replaces the old
-- "confirm a second allocation" escape hatch.
--
-- Why a stored year and a partial unique index: the rule has to hold when two field officers submit
-- at the same moment, and an application-level "SELECT then INSERT" cannot. The index makes the
-- database the last line of defence: at most one live award (pending or approved) per student and
-- year. A rejected or voided award is outside the index, so it neither blocks nor consumes the year.
ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS award_year INTEGER;

-- Existing rows take the calendar year they were proposed in. Backfilled before the column is made
-- NOT NULL so the migration is safe on a populated table.
UPDATE bursary_awards
SET award_year = EXTRACT(YEAR FROM created_at)::INTEGER
WHERE award_year IS NULL;

ALTER TABLE bursary_awards ALTER COLUMN award_year SET NOT NULL;
ALTER TABLE bursary_awards ALTER COLUMN award_year SET DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER;

ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE bursary_awards ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

-- 'voided' joins the status list. The original column check has to be replaced rather than extended
-- because PostgreSQL does not allow adding values to an existing CHECK constraint.
ALTER TABLE bursary_awards DROP CONSTRAINT IF EXISTS bursary_awards_status_check;
ALTER TABLE bursary_awards ADD CONSTRAINT bursary_awards_status_check
  CHECK (status IN ('submitted', 'approved', 'rejected', 'voided'));

-- The decision-field rule now knows about voided rows. A void keeps the decision it supersedes (the
-- amount and the reason an administrator approved) and adds its own mandatory reason.
ALTER TABLE bursary_awards DROP CONSTRAINT IF EXISTS bursary_awards_decision_fields_check;
ALTER TABLE bursary_awards ADD CONSTRAINT bursary_awards_decision_fields_check CHECK (
  (status = 'submitted' AND approved_amount IS NULL AND decision_reason IS NULL
    AND decided_by IS NULL AND decided_at IS NULL AND voided_at IS NULL AND void_reason IS NULL)
  OR (status = 'approved' AND approved_amount IS NOT NULL
    AND length(COALESCE(btrim(decision_reason), '')) >= 5
    AND decided_by IS NOT NULL AND decided_at IS NOT NULL
    AND voided_at IS NULL AND void_reason IS NULL)
  OR (status = 'rejected' AND approved_amount IS NULL
    AND length(COALESCE(btrim(decision_reason), '')) >= 5
    AND decided_by IS NOT NULL AND decided_at IS NOT NULL
    AND voided_at IS NULL AND void_reason IS NULL)
  OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL
    AND length(COALESCE(btrim(void_reason), '')) >= 5)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bursary_awards
    WHERE status IN ('submitted', 'approved')
    GROUP BY student_id, award_year
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate live awards exist for the same student and year. Resolve them before applying this migration.';
  END IF;
END $$;

-- The rule itself. Pending and approved awards occupy the year; rejected and voided ones do not.
CREATE UNIQUE INDEX IF NOT EXISTS bursary_awards_student_year_active_unique
  ON bursary_awards (student_id, award_year)
  WHERE status IN ('submitted', 'approved');

CREATE INDEX IF NOT EXISTS bursary_awards_student_year_idx
  ON bursary_awards (student_id, award_year);

-- Every report, correction and void writes a row here. The award itself is never deleted and keeps
-- its original columns; this table is the history of what changed, why, and by whom.
CREATE TABLE IF NOT EXISTS bursary_award_correction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id UUID NOT NULL REFERENCES bursary_awards(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('error_reported', 'award_corrected', 'award_voided')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  -- {"approved_amount": {"from": 20000, "to": 25000}} for a correction; the status change for a
  -- void. A report carries none, because nothing has changed yet.
  changes JSONB,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bursary_award_correction_changes_check
    CHECK (event_type <> 'award_corrected' OR changes IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS bursary_award_correction_events_award_idx
  ON bursary_award_correction_events(award_id, created_at DESC);
