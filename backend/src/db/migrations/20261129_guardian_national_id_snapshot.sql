-- Snapshot the guardian identifier on each application. This is guardian context,
-- not a unique identifier for the student.
ALTER TABLE guardian_applications
  ADD COLUMN IF NOT EXISTS guardian_national_id VARCHAR(100);

UPDATE guardian_applications AS application
   SET guardian_national_id = guardian.national_id
  FROM users AS guardian
 WHERE application.user_id = guardian.id
   AND NULLIF(BTRIM(application.guardian_national_id), '') IS NULL
   AND NULLIF(BTRIM(guardian.national_id), '') IS NOT NULL;
