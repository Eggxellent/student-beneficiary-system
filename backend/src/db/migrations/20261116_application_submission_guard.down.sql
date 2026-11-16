-- Rollback for 20261116_application_submission_guard.sql.
--
-- Not executed by scripts/migrate.js: the runner ignores `*.down.sql`
-- (scripts/migrate.js:54-56). Every statement is additive and reversible without touching a row.
DROP INDEX IF EXISTS student_applications_guardian_child_idx;
DROP INDEX IF EXISTS student_applications_upi_idx;
DROP INDEX IF EXISTS student_applications_birth_certificate_idx;
DROP INDEX IF EXISTS student_applications_national_id_idx;
ALTER TABLE duplicate_flags DROP CONSTRAINT IF EXISTS duplicate_flags_case_kind_check;
