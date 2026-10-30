-- Establishes the legacy `beneficiaries` table for databases whose baseline predates
-- it. `/api/beneficiaries` is still mounted (`src/index.js`), the model reads and writes
-- the table (`src/models/beneficiary.model.js`), and startup readiness requires it
-- (`src/services/databaseReadiness.js`). Additive and idempotent: an existing table is
-- left untouched, so recorded rows and their identifiers are preserved.
--
-- The shape mirrors the table observed in the existing deployment: an integer serial
-- primary key and no foreign keys. `scholarship_amount` semantics remain unresolved and
-- are deliberately not reinterpreted or mapped to bursary/payment amounts.
CREATE TABLE IF NOT EXISTS beneficiaries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  school VARCHAR(255),
  grade_level VARCHAR(50),
  scholarship_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
