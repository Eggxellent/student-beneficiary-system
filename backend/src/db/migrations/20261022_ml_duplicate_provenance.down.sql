DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM duplicate_flags
    WHERE model_version IS NOT NULL OR review_threshold IS NOT NULL OR comparison_features IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove model provenance columns while they contain audit data';
  END IF;
END $$;

DROP INDEX IF EXISTS duplicate_flags_unordered_pair_unique;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS comparison_features;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS review_threshold;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS model_version;
COMMENT ON COLUMN duplicate_flags.probability IS NULL;
