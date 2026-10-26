BEGIN;

LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@sbms.com' AND role = 'admin'
  ) OR NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'field.officer.demo@sbms.local' AND role = 'field_officer'
  ) THEN
    RAISE EXCEPTION 'Primary SBMS admin and field officer accounts were not both found; no accounts were changed';
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Keep historical user rows for audit and activity foreign keys, but prevent
-- other accounts from appearing in the account list or authenticating.
UPDATE users
SET is_active = (email IN ('admin@sbms.com', 'field.officer.demo@sbms.local'));

COMMIT;
