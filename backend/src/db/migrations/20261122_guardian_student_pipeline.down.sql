-- Reverses the schema additions only. The NOT NULL columns relaxed above are intentionally left
-- nullable: automatic assessments can be incomplete, and tightening them again would require
-- deleting or fabricating rows, which this project never does.
DROP INDEX IF EXISTS eligibility_assessments_automatic_event_unique;
ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_trigger_check;
ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_complete_score_check;
ALTER TABLE eligibility_assessments DROP CONSTRAINT IF EXISTS eligibility_assessments_status_check;
ALTER TABLE eligibility_assessments
  DROP COLUMN IF EXISTS trigger_reference,
  DROP COLUMN IF EXISTS trigger,
  DROP COLUMN IF EXISTS missing_inputs,
  DROP COLUMN IF EXISTS status;

DROP INDEX IF EXISTS guardian_applications_student_idx;
DROP INDEX IF EXISTS guardian_applications_student_unique;
ALTER TABLE guardian_applications DROP COLUMN IF EXISTS student_id;
ALTER TABLE students DROP COLUMN IF EXISTS school_name;
