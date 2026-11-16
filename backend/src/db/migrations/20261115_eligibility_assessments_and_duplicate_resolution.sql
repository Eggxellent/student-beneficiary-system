-- 1. Saved eligibility assessments.
--
-- Until now a calculation was written only as score/category on the student row plus an audit-log
-- entry. The administrator has to see the inputs and the recommended range that produced the score,
-- so every calculation is now stored as its own immutable row. Nothing is recalculated here.
CREATE TABLE IF NOT EXISTS eligibility_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  category VARCHAR(20) NOT NULL,
  fee_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  household_income NUMERIC(14, 2) NOT NULL DEFAULT 0,
  vulnerability_status VARCHAR(20) NOT NULL,
  siblings_in_school INTEGER NOT NULL DEFAULT 0,
  prior_bursary_history VARCHAR(20) NOT NULL,
  recommended_min NUMERIC(14, 2),
  recommended_max NUMERIC(14, 2),
  recommended_currency VARCHAR(10),
  recommendation_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  recommendation_source TEXT,
  recorded_via VARCHAR(30) NOT NULL DEFAULT 'eligibility_form',
  assessed_by UUID REFERENCES users(id),
  assessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eligibility_assessments_student_assessed_idx
  ON eligibility_assessments(student_id, assessed_at DESC);

-- Existing assessments are reconstructed from the audit entry that recorded them, so the live data
-- keeps the values the field officer actually submitted. The form did not store an assessment
-- timestamp, so only the newest audit entry per student is adopted and the student's
-- eligibility_assessed_at is reused as the assessment date.
INSERT INTO eligibility_assessments (
  student_id, score, category, fee_balance, household_income, vulnerability_status,
  siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
  recommended_currency, recommendation_provisional, recommendation_source,
  recorded_via, assessed_by, assessed_at
)
SELECT DISTINCT ON (al.record_id)
  al.record_id,
  COALESCE((al.details->>'score')::int, s.eligibility_score, 0),
  COALESCE(al.details->>'category', s.eligibility_category, 'low'),
  COALESCE((al.details->'inputs'->>'fee_balance')::numeric, 0),
  COALESCE((al.details->'inputs'->>'household_income')::numeric, 0),
  COALESCE(al.details->'inputs'->>'vulnerability_status', 'low'),
  COALESCE((al.details->'inputs'->>'siblings_in_school')::int, 0),
  COALESCE(al.details->'inputs'->>'prior_bursary_history', 'none'),
  (al.details->'recommended_range'->>'min')::numeric,
  (al.details->'recommended_range'->>'max')::numeric,
  al.details->'recommended_range'->>'currency',
  COALESCE((al.details->'recommended_range'->>'provisional')::boolean, TRUE),
  al.details->'recommended_range'->>'source',
  'audit_log_backfill',
  al.user_id,
  COALESCE(s.eligibility_assessed_at, al.created_at)
FROM audit_logs al
JOIN students s ON s.id = al.record_id
WHERE al.action = 'ELIGIBILITY_CALCULATED'
  AND al.details->'inputs' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM eligibility_assessments existing WHERE existing.student_id = al.record_id
  )
ORDER BY al.record_id, al.created_at DESC;

-- 2. Duplicate resolution.
--
-- Confirming a duplicate is only a review decision. Resolution is a separate administrator action
-- that names the canonical record and marks the other record as its duplicate. Both student rows are
-- kept, with their awards, assessments and history, so nothing is merged or deleted.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS duplicate_of_student_id UUID REFERENCES students(id),
  ADD COLUMN IF NOT EXISTS duplicate_marked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS duplicate_marked_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS students_duplicate_of_idx
  ON students(duplicate_of_student_id)
  WHERE duplicate_of_student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS duplicate_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_flag_id UUID NOT NULL UNIQUE REFERENCES duplicate_flags(id),
  canonical_student_id UUID NOT NULL REFERENCES students(id),
  duplicate_student_id UUID NOT NULL REFERENCES students(id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  resolved_by UUID NOT NULL REFERENCES users(id),
  resolved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT duplicate_resolutions_distinct_records
    CHECK (canonical_student_id <> duplicate_student_id)
);

CREATE INDEX IF NOT EXISTS duplicate_resolutions_canonical_idx
  ON duplicate_resolutions(canonical_student_id);
