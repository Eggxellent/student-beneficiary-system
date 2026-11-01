-- QR-verifiable bursary award certificates.
--
-- Why a separate table rather than columns on bursary_awards: an award is a decision, while a
-- certificate is a document that was issued and handed to a person. Keeping the issued facts in
-- their own row means a later change to the award cannot silently rewrite what a printed
-- certificate says - the verification endpoint compares the snapshot with the live award - and a
-- certificate can be revoked without touching the decision it certifies.
CREATE TABLE IF NOT EXISTS bursary_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id UUID NOT NULL UNIQUE REFERENCES bursary_awards(id) ON DELETE RESTRICT,
  certificate_reference VARCHAR(40) NOT NULL UNIQUE,
  verification_token VARCHAR(100) NOT NULL UNIQUE,
  award_period VARCHAR(20) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  student_upi VARCHAR(100),
  school_code VARCHAR(100) NOT NULL,
  approved_amount NUMERIC(12, 2) NOT NULL CHECK (approved_amount > 0),
  award_approved_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CONSTRAINT bursary_certificates_revocation_check CHECK (
    (status = 'active' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status = 'revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
        AND length(COALESCE(btrim(revocation_reason), '')) >= 5)
  ),
  CONSTRAINT bursary_certificates_period_check CHECK (award_period ~ '^[0-9]{4}(/[0-9]{4})?$'),
  CONSTRAINT bursary_certificates_token_check CHECK (verification_token ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS bursary_certificates_status_issued_idx
  ON bursary_certificates(status, issued_at DESC);
