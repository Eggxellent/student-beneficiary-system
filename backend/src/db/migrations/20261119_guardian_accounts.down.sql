DROP INDEX IF EXISTS guardian_applications_status_created_idx;
DROP INDEX IF EXISTS guardian_applications_user_created_idx;
DROP TABLE IF EXISTS guardian_applications;
DROP SEQUENCE IF EXISTS guardian_application_reference_seq;
DROP INDEX IF EXISTS users_national_id_key;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users DROP COLUMN IF EXISTS relationship_to_student;
ALTER TABLE users DROP COLUMN IF EXISTS national_id;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
-- Only reversible when no guardian account exists; otherwise the constraint change is refused.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_supported_check;
ALTER TABLE users ADD CONSTRAINT users_role_supported_check
  CHECK (role IN ('admin', 'field_officer'));
