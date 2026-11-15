-- One-time password reset links. An administrator issues the link and hands it over; the holder
-- creates a new password with it. Only the SHA-256 of the token is stored, so a copy of this table
-- cannot be used to reset an account. `used_at` makes a link single-use and `expires_at` keeps the
-- window short, so an intercepted link dies quickly.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at);
