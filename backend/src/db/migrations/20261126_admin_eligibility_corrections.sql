-- Admin corrections are new assessment events; previous submitted values and assessments remain
-- in their original rows and audit entries.
ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_trigger_check;
ALTER TABLE eligibility_assessments ADD CONSTRAINT eligibility_assessments_trigger_check
  CHECK (trigger IN ('officer_form', 'registration_screening', 'duplicate_clearance', 'admin_correction'));
