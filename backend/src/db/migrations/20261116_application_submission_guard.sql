-- Guard the public submission path and pin the shape of a duplicate case.
--
-- Two additive changes, both designed in docs/phase3-duplicate-schema-review.md (§3.3, §7):
--
--   1. a duplicate case has exactly one subject, and
--   2. the two submission pre-checks (same guardian, same child) are index-backed, because they now
--      run on a public endpoint.
--
-- Nothing here rewrites existing rows: every `duplicate_flags` row written so far is either a
-- registration case (`student_id` set) or an application case (`application_id` set, `student_id`
-- NULL), so both checks are satisfied by the data as it stands.

-- 1. `duplicate_flags_case_subject_check` already requires at least one subject
--    (20261116_application_duplicate_cases.sql). This one forbids both, so a reader can branch on
--    `application_id IS NULL` without a second look, and a re-screening bug cannot attach an
--    application subject to a registration case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'duplicate_flags'::regclass
      AND conname = 'duplicate_flags_case_kind_check'
  ) THEN
    ALTER TABLE duplicate_flags
      ADD CONSTRAINT duplicate_flags_case_kind_check
      CHECK (application_id IS NULL OR student_id IS NULL);
  END IF;
END $$;

-- 2. Same-guardian pre-check: `WHERE guardian_phone = $1 AND lower(full_name) = lower($2)
--    AND date_of_birth = $3 AND created_at > NOW() - INTERVAL '24 hours'`.
--    The leading column is the equality that survives normalisation, so the index narrows to one
--    guardian before the expression and the range are evaluated.
CREATE INDEX IF NOT EXISTS student_applications_guardian_child_idx
  ON student_applications (guardian_phone, date_of_birth, lower(full_name));

-- 3. Child pre-check: one child, one application, whatever guardian phone it came from. The
--    identifiers are optional individually (the form requires at least one), so each index is
--    partial and only covers the rows that carry that identifier.
CREATE INDEX IF NOT EXISTS student_applications_upi_idx
  ON student_applications (upi)
  WHERE upi IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_applications_birth_certificate_idx
  ON student_applications (birth_certificate_number)
  WHERE birth_certificate_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_applications_national_id_idx
  ON student_applications (national_id_number)
  WHERE national_id_number IS NOT NULL;
