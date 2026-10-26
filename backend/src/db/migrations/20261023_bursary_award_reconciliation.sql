BEGIN;

CREATE TABLE IF NOT EXISTS bursary_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_code VARCHAR(100) NOT NULL,
  requested_amount NUMERIC(12, 2) NOT NULL CHECK (requested_amount > 0),
  approved_amount NUMERIC(12, 2) CHECK (approved_amount IS NULL OR approved_amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected')),
  verification_status VARCHAR(30) NOT NULL DEFAULT 'not_checked'
    CHECK (verification_status IN ('not_checked', 'verified', 'not_found', 'needs_investigation')),
  verification_notes TEXT,
  verification_evidence_ref VARCHAR(500),
  verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  decision_reason TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bursary_awards_decision_fields_check CHECK (
    (status = 'submitted' AND approved_amount IS NULL AND decision_reason IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (status = 'approved' AND approved_amount IS NOT NULL AND length(COALESCE(btrim(decision_reason), '')) >= 5 AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'rejected' AND approved_amount IS NULL AND length(COALESCE(btrim(decision_reason), '')) >= 5 AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT bursary_awards_approval_verification_check CHECK (status <> 'approved' OR verification_status = 'verified'),
  CONSTRAINT bursary_awards_verification_fields_check CHECK (
    verification_status <> 'verified'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND length(COALESCE(btrim(verification_evidence_ref), '')) > 0)
  )
);

CREATE INDEX IF NOT EXISTS bursary_awards_status_created_idx
  ON bursary_awards(status, created_at DESC);
CREATE INDEX IF NOT EXISTS bursary_awards_student_created_idx
  ON bursary_awards(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bursary_award_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id UUID NOT NULL REFERENCES bursary_awards(id) ON DELETE RESTRICT,
  outcome VARCHAR(30) NOT NULL CHECK (outcome IN ('verified', 'not_found', 'needs_investigation')),
  notes TEXT NOT NULL CHECK (length(btrim(notes)) >= 5),
  evidence_ref VARCHAR(500),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT award_verified_event_evidence_check CHECK (
    outcome <> 'verified' OR length(COALESCE(btrim(evidence_ref), '')) > 0
  )
);

CREATE INDEX IF NOT EXISTS bursary_award_verification_events_award_idx
  ON bursary_award_verification_events(award_id, created_at DESC);

ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS award_id UUID REFERENCES bursary_awards(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80),
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cleared_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clearance_evidence_ref VARCHAR(500),
  ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS acknowledged_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledgement_method VARCHAR(30),
  ADD COLUMN IF NOT EXISTS acknowledgement_evidence_ref VARCHAR(500),
  ADD COLUMN IF NOT EXISTS acknowledgement_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursements_payment_status_check') THEN
    ALTER TABLE disbursements ADD CONSTRAINT disbursements_payment_status_check
      CHECK (payment_status IS NULL OR payment_status IN ('issued', 'cleared', 'failed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursements_receipt_status_check') THEN
    ALTER TABLE disbursements ADD CONSTRAINT disbursements_receipt_status_check
      CHECK (receipt_status IS NULL OR receipt_status IN ('awaiting_acknowledgement', 'acknowledged', 'discrepancy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursements_acknowledged_amount_check') THEN
    ALTER TABLE disbursements ADD CONSTRAINT disbursements_acknowledged_amount_check
      CHECK (acknowledged_amount IS NULL OR acknowledged_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursements_clearance_fields_check') THEN
    ALTER TABLE disbursements ADD CONSTRAINT disbursements_clearance_fields_check CHECK (
      (payment_status = 'cleared' AND cleared_by IS NOT NULL AND cleared_at IS NOT NULL AND length(COALESCE(btrim(clearance_evidence_ref), '')) > 0)
      OR (payment_status IS DISTINCT FROM 'cleared' AND cleared_by IS NULL AND cleared_at IS NULL AND clearance_evidence_ref IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursements_acknowledgement_fields_check') THEN
    ALTER TABLE disbursements ADD CONSTRAINT disbursements_acknowledgement_fields_check CHECK (
      (receipt_status IN ('acknowledged', 'discrepancy') AND acknowledged_amount IS NOT NULL AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND acknowledgement_method = 'officer_assisted' AND length(COALESCE(btrim(acknowledgement_evidence_ref), '')) > 0)
      OR (receipt_status IS DISTINCT FROM 'acknowledged' AND receipt_status IS DISTINCT FROM 'discrepancy' AND acknowledged_amount IS NULL AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND acknowledgement_method IS NULL AND acknowledgement_evidence_ref IS NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS disbursements_award_status_idx
  ON disbursements(award_id, payment_status, receipt_status);

CREATE TABLE IF NOT EXISTS disbursement_reconciliation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_id UUID NOT NULL REFERENCES disbursements(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('payment_issued', 'payment_cleared', 'payment_failed', 'payment_cancelled', 'payment_linked_to_award', 'receipt_acknowledged')),
  payment_status VARCHAR(20) CHECK (payment_status IS NULL OR payment_status IN ('issued', 'cleared', 'failed', 'cancelled')),
  receipt_status VARCHAR(30) CHECK (receipt_status IS NULL OR receipt_status IN ('awaiting_acknowledgement', 'acknowledged', 'discrepancy')),
  amount NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0),
  evidence_ref VARCHAR(500),
  notes TEXT,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS disbursement_reconciliation_events_disbursement_idx
  ON disbursement_reconciliation_events(disbursement_id, created_at DESC);

COMMIT;
