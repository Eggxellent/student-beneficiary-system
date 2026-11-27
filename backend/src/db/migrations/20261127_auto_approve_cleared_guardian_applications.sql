-- A clean duplicate screen is the application's automatic approval decision. This backfills
-- legacy submissions that were left under review only because the old UI required manual approval.
WITH approved AS (
  UPDATE guardian_applications a
     SET status = 'approved',
         decision_note = NULL,
         decided_at = COALESCE(a.decided_at, NOW()),
         updated_at = NOW()
    FROM students s
   WHERE s.id = a.student_id
     AND a.status = 'under_review'
     AND s.duplicate_of_student_id IS NULL
     AND EXISTS (
       SELECT 1 FROM audit_logs screening
        WHERE screening.table_name = 'guardian_applications'
          AND screening.record_id = a.id
          AND screening.action = 'GUARDIAN_APPLICATION_LINKED_STUDENT'
     )
     AND NOT EXISTS (
       SELECT 1 FROM duplicate_flags f
        WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
          AND f.status IN ('pending', 'needs_verification')
     )
     AND NOT EXISTS (
       SELECT 1 FROM duplicate_flags f
        WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
          AND f.status = 'confirmed_duplicate'
          AND NOT EXISTS (SELECT 1 FROM duplicate_resolutions r WHERE r.duplicate_flag_id = f.id)
     )
  RETURNING a.id, a.reference
)
INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
SELECT NULL, 'GUARDIAN_APPLICATION_AUTO_APPROVED', 'guardian_applications', id,
       jsonb_build_object('reference', reference, 'reason', 'duplicate_screening_cleared', 'migration', '20261127')
  FROM approved;
