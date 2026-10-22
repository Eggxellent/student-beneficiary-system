-- Records the model and review settings used for each new machine-scored flag.
-- Preflight avoids silently removing or collapsing any existing review cases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM duplicate_flags
    GROUP BY LEAST(student_id, matched_student_id), GREATEST(student_id, matched_student_id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add duplicate pair uniqueness: duplicate flags already exist for an unordered student pair';
  END IF;
END $$;

ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS model_version TEXT;
ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS review_threshold NUMERIC(5, 4);
ALTER TABLE duplicate_flags ADD COLUMN IF NOT EXISTS comparison_features JSONB;
COMMENT ON COLUMN duplicate_flags.probability IS
  'Legacy column name: model_version rows store an uncalibrated positive-class model score.';
CREATE UNIQUE INDEX IF NOT EXISTS duplicate_flags_unordered_pair_unique
  ON duplicate_flags (LEAST(student_id, matched_student_id), GREATEST(student_id, matched_student_id));
