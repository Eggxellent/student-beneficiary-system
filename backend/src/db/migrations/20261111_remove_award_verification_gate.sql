-- The beneficiary verification stage was removed from the award workflow: a field officer now
-- proposes and an administrator approves, with the certificate generated automatically on approval.
-- The `verification_status` column and its history table stay in place (no data is destroyed), but
-- the database must no longer refuse an approval that was never "verified".
ALTER TABLE bursary_awards
  DROP CONSTRAINT IF EXISTS bursary_awards_approval_verification_check;
