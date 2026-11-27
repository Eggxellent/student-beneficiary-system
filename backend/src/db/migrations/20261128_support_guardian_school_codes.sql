-- Guardian applications now submit school codes such as SCH-009. Keep historical
-- configured school names valid while allowing the code format used by the form.
ALTER TABLE students
  DROP CONSTRAINT IF EXISTS students_school_supported_check;

ALTER TABLE students
  ADD CONSTRAINT students_school_supported_check
  CHECK (
    school_code IS NULL
    OR school_code IN ('Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda')
    OR school_code ~ '^SCH-[0-9]{3}$'
  );

-- Backfill applications submitted while the form collected school codes into
-- school_name but the old resolver only accepted school names.
UPDATE students
   SET school_code = UPPER(BTRIM(school_name))
 WHERE school_code IS NULL
   AND BTRIM(school_name) ~* '^SCH-[0-9]{3}$';
