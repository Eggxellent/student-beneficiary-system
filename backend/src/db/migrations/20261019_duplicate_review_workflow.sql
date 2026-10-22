ALTER TABLE duplicate_flags
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

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
