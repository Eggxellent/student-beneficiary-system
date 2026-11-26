-- Duplicate screening moves from the never-collected UPI to the school-scoped admission number.
--
-- The guardian form records the admission number and the school; it does not record a UPI, so
-- every record screened through that pipeline carried an empty UPI and the model input was a
-- constant. The admission number is copied onto the student row so existing rows can be compared
-- without re-joining the application at screening time.
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_number VARCHAR(100);

-- Admission numbers are only meaningful within one school, so the lookup used by the duplicate
-- scan is scoped by school code rather than made globally unique.
CREATE INDEX IF NOT EXISTS students_school_admission_idx
  ON students(school_code, admission_number)
  WHERE admission_number IS NOT NULL;
