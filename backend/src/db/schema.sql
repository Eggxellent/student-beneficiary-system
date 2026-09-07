CREATE TABLE IF NOT EXISTS beneficiaries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  school VARCHAR(255),
  grade_level VARCHAR(50),
  scholarship_amount NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
