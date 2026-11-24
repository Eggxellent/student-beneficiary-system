-- Reverse of 20261123_guardian_eligibility_inputs.sql. Applications keep their rows; only the
-- four scoring-input columns and their checks are removed.
ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_prior_bursary_history_check;
ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_siblings_in_school_check;
ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_vulnerability_status_check;
ALTER TABLE guardian_applications DROP CONSTRAINT IF EXISTS guardian_applications_fee_balance_check;

ALTER TABLE guardian_applications
  DROP COLUMN IF EXISTS prior_bursary_history,
  DROP COLUMN IF EXISTS siblings_in_school,
  DROP COLUMN IF EXISTS vulnerability_status,
  DROP COLUMN IF EXISTS fee_balance;
