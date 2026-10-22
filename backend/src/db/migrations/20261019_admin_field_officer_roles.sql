DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_supported_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_supported_check
      CHECK (role IN ('admin', 'field_officer'));
  END IF;
END $$;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;
