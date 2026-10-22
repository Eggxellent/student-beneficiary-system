DROP INDEX IF EXISTS duplicate_flags_assigned_status_created_idx;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS assigned_to;
