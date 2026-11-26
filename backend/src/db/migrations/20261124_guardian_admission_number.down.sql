-- Reverses the schema addition only. Student rows keep whatever admission number was captured;
-- dropping the column would delete data, which this project's down-migrations never do.
DROP INDEX IF EXISTS students_school_admission_idx;
ALTER TABLE students DROP COLUMN IF EXISTS admission_number;
