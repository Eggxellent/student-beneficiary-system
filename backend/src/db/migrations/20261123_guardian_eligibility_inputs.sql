-- Guardian intake: the four remaining eligibility scoring inputs.
--
-- services/automaticAssessment.js reads each scoring input from its own guardian_applications
-- column first and only then from the details JSON. These columns are that source of truth, so a
-- guardian submission now carries all five inputs and produces a complete assessment.
--
-- Scoring vocabulary (services/eligibility.js): vulnerability_status low|medium|high and
-- prior_bursary_history none|low|high. The API validates the same vocabulary before insert; the
-- checks below stop a hand-written statement from storing a value the engine cannot interpret.
-- Nullable on purpose: applications submitted before this migration keep whatever they had, and
-- the assessment records them as incomplete rather than inventing a value.
ALTER TABLE guardian_applications
  ADD COLUMN IF NOT EXISTS fee_balance NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vulnerability_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS siblings_in_school INTEGER,
  ADD COLUMN IF NOT EXISTS prior_bursary_history VARCHAR(20);

ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_fee_balance_check;
ALTER TABLE guardian_applications ADD CONSTRAINT guardian_applications_fee_balance_check
  CHECK (fee_balance IS NULL OR fee_balance >= 0);

ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_vulnerability_status_check;
ALTER TABLE guardian_applications ADD CONSTRAINT guardian_applications_vulnerability_status_check
  CHECK (vulnerability_status IS NULL OR vulnerability_status IN ('low', 'medium', 'high'));

ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_siblings_in_school_check;
ALTER TABLE guardian_applications ADD CONSTRAINT guardian_applications_siblings_in_school_check
  CHECK (siblings_in_school IS NULL OR siblings_in_school >= 0);

ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_prior_bursary_history_check;
ALTER TABLE guardian_applications ADD CONSTRAINT guardian_applications_prior_bursary_history_check
  CHECK (prior_bursary_history IS NULL OR prior_bursary_history IN ('none', 'low', 'high'));
