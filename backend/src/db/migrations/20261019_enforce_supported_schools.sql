DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_school_supported_check'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_school_supported_check
      CHECK (school_code IS NULL OR school_code IN (
        'Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda'
      ));
  END IF;
END $$;
