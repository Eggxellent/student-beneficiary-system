-- Persisted, per-user notifications for the events that actually need a person's attention.
--
-- Why a table and not a derived list in the browser: the previous bell re-read duplicate flags
-- and submitted awards on every page load and stored "seen" ids in localStorage, so a read state
-- was lost on another device and every user saw the same list. A row per recipient makes the
-- unread count a fact about the recipient, survives a refresh, and lets the API enforce who may
-- read what.
--
-- Only four categories exist because only these four events need action in SBMS: a proposal
-- awaiting review, the two decision outcomes, and a certificate that can now be printed.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(30) NOT NULL CHECK (category IN (
    'award_submitted', 'award_approved', 'award_rejected', 'certificate_ready'
  )),
  -- Title and body are stored at write time: the wording belongs to the event, and a later
  -- rename of a student must not rewrite what the recipient was told.
  title VARCHAR(120) NOT NULL,
  body VARCHAR(280) NOT NULL,
  link VARCHAR(120) NOT NULL DEFAULT '',
  reference_id UUID,
  -- The event that produced the row, for example `award-submitted:<award id>`. The unique
  -- constraint below is what prevents a retried request or a second approval from producing a
  -- duplicate notification for the same event.
  dedupe_key VARCHAR(160) NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_dedupe_unique UNIQUE (user_id, dedupe_key),
  CONSTRAINT notifications_body_check CHECK (length(btrim(title)) > 0 AND length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);

-- The badge count only ever asks for one user's unread rows.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id)
  WHERE read_at IS NULL;
