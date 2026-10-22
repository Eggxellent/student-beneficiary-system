UPDATE students
SET school_code = CASE split_part(school_code, '-', 2)
  WHEN 'NRB' THEN 'Nairobi School'
  WHEN 'NAK' THEN 'Alliance High'
  WHEN 'KBU' THEN 'Loreto Limuru'
  WHEN 'MAK' THEN 'Bishop Gatimu'
  WHEN 'KSM' THEN 'Maranda'
  WHEN 'UG' THEN 'Alliance High'
  WHEN 'KLF' THEN 'Maranda'
  WHEN 'KAK' THEN 'Maranda'
  WHEN 'MER' THEN 'Bishop Gatimu'
  WHEN 'KER' THEN 'Loreto Limuru'
  WHEN 'KIT' THEN 'Bishop Gatimu'
  WHEN 'NYR' THEN 'Loreto Limuru'
  WHEN 'BUS' THEN 'Maranda'
  WHEN 'MAC' THEN 'Nairobi School'
  ELSE school_code
END
WHERE is_synthetic = TRUE AND school_code LIKE 'SYN-%';
