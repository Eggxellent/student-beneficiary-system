UPDATE students
SET full_name = regexp_replace(btrim(full_name), '\s+', ' ', 'g'),
    guardian_id = CASE WHEN guardian_id IS NULL OR btrim(guardian_id) = '' THEN NULL ELSE upper(regexp_replace(btrim(guardian_id), '\s+', ' ', 'g')) END,
    upi = CASE WHEN upi IS NULL OR btrim(upi) = '' THEN NULL ELSE upper(regexp_replace(btrim(upi), '\s+', ' ', 'g')) END,
    birth_certificate_number = CASE WHEN birth_certificate_number IS NULL OR btrim(birth_certificate_number) = '' THEN NULL ELSE upper(regexp_replace(btrim(birth_certificate_number), '\s+', ' ', 'g')) END,
    national_id_number = CASE WHEN national_id_number IS NULL OR btrim(national_id_number) = '' THEN NULL ELSE upper(regexp_replace(btrim(national_id_number), '\s+', ' ', 'g')) END,
    primary_phone = CASE
      WHEN primary_phone IS NULL OR btrim(primary_phone) = '' THEN NULL
      WHEN regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g') ~ '^0[17][0-9]{8}$'
        THEN '+254' || substr(regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g'), 2)
      WHEN regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g') ~ '^254[17][0-9]{8}$'
        THEN '+' || regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g')
      WHEN regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g') ~ '^\+254[17][0-9]{8}$'
        THEN regexp_replace(btrim(primary_phone), '[\s()-]', '', 'g')
      ELSE primary_phone
    END,
    qr_token = CASE WHEN qr_token IS NULL OR btrim(qr_token) = '' THEN NULL ELSE btrim(qr_token) END;

WITH numbered_synthetic_phones AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS row_number
  FROM students
  WHERE is_synthetic = TRUE
    AND (primary_phone IS NULL OR primary_phone !~ '^\+254[17][0-9]{8}$')
)
UPDATE students AS student
SET primary_phone = '+2547' || lpad((40000000 + numbered.row_number)::text, 8, '0')
FROM numbered_synthetic_phones AS numbered
WHERE student.id = numbered.id;
