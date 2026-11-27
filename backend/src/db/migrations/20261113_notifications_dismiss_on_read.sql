-- A notification is either waiting for the recipient or gone. Nothing stays behind once it has been
-- read, so there is no read state to store, no read styling, and no "already seen" history to load.
--
-- Why delete instead of keeping a read flag: the bell exists to ask someone to act. A row that has
-- been opened has no further job, and keeping it only grows the table, the payload and the badge
-- query. Dismissal is the read: one row removed, `unread_count` falls with it.
-- Some existing installations already have the final table shape without this marker. Keep the
-- migration repeatable against those databases instead of failing before the guarded DROP below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'notifications'
       AND column_name = 'read_at'
  ) THEN
    DELETE FROM notifications WHERE read_at IS NOT NULL;
  END IF;
END $$;

-- The column had exactly one meaning, the read marker this migration removes. Keeping it would
-- reintroduce a state the API no longer writes.
ALTER TABLE notifications DROP COLUMN IF EXISTS read_at;

-- Its partial predicate referenced `read_at`, so it cannot survive the column drop. The remaining
-- `notifications_user_created_idx` already serves the list query.
DROP INDEX IF EXISTS notifications_user_unread_idx;
