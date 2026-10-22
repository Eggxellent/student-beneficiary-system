const { createHash } = require('crypto');
const SCHOOL_INFO = {
  NAIROBI: ['NRB', 'Nairobi School'], NAKURU: ['NAK', 'Alliance High'],
  KIAMBU: ['KBU', 'Loreto Limuru'], MAKUENI: ['MAK', 'Bishop Gatimu'],
  KISUMU: ['KSM', 'Maranda'], UASIN_GISHU: ['UG', 'Alliance High'],
  KILIFI: ['KLF', 'Maranda'], KAKAMEGA: ['KAK', 'Maranda'],
  MERU: ['MER', 'Bishop Gatimu'], KERICHO: ['KER', 'Loreto Limuru'],
  KITUI: ['KIT', 'Bishop Gatimu'], NYERI: ['NYR', 'Loreto Limuru'],
  BUSIA: ['BUS', 'Maranda'], MACHAKOS: ['MAC', 'Nairobi School'],
};
const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 8).toUpperCase();
const SCHOOL_CODES = Object.fromEntries(Object.entries(SCHOOL_INFO).map(([county, [, school]]) => [county, school]));

const records = [];
const comparisons = [];

function student(code, full_name, options = {}) {
  const index = records.length + 1;
  const value = (key, fallback) => Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback;
  const record = {
    code,
    full_name,
    date_of_birth: value('date_of_birth', '2012-04-18'),
    school_code: value('school_code', SCHOOL_CODES[options.county || 'NAKURU']),
    guardian_id: value('guardian_id', `SYN-GUARD-${shortHash(code)}`),
    upi: value('upi', `SYN-UPI-KE-${code}`),
    national_id_number: value('national_id_number', `SYN-NID-KE-${code}`),
    birth_certificate_number: value('birth_certificate_number', `SYN-BC-KE-${code}`),
    primary_phone: value('primary_phone', `+2547${String(40000000 + index).padStart(8, '0')}`),
    qr_token: `SBMS-SYNTHETIC-KE-20261019-${code}`,
  };
  records.push(record);
  return record;
}

function pair(id, category, left, right, sharedFields = []) {
  const first = student(left.code, left.name, left.options);
  const rightOptions = { ...right.options };
  for (const field of sharedFields) rightOptions[field] = first[field];
  const second = student(right.code, right.name, rightOptions);
  comparisons.push({ id, category, first, second });
}

pair('clear-01', 'clear_duplicate_candidates',
  { code: 'DUP001A', name: 'Amina Hassan', options: { county: 'NAIROBI', date_of_birth: '2011-05-14', guardian_id: 'SYN-GUARDIAN-KE-FAMILY001' } },
  { code: 'DUP001B', name: 'Amina Hassan' },
  ['date_of_birth', 'school_code', 'guardian_id', 'upi', 'birth_certificate_number']);
pair('clear-02', 'clear_duplicate_candidates',
  { code: 'DUP002A', name: 'Collins Barasa', options: { county: 'KAKAMEGA', date_of_birth: '2010-09-02', guardian_id: 'SYN-GUARDIAN-KE-FAMILY002' } },
  { code: 'DUP002B', name: 'Collins Barasa' },
  ['date_of_birth', 'school_code', 'guardian_id', 'upi', 'birth_certificate_number']);
pair('clear-03', 'clear_duplicate_candidates',
  { code: 'DUP003A', name: 'Chebet Jepkosgei', options: { county: 'KERICHO', date_of_birth: '2012-02-11', guardian_id: 'SYN-GUARDIAN-KE-FAMILY003' } },
  { code: 'DUP003B', name: 'Chebet Jepkosgei' },
  ['date_of_birth', 'school_code', 'guardian_id']);

pair('typo-01', 'typographical_variations',
  { code: 'TYP001A', name: 'Wanjiku Mwangi', options: { county: 'KIAMBU', date_of_birth: '2011-07-21', guardian_id: 'SYN-GUARDIAN-KE-FAMILY004' } },
  { code: 'TYP001B', name: 'Wanjiku Mwaangi' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('typo-02', 'typographical_variations',
  { code: 'TYP002A', name: 'Brian Kiptoo', options: { county: 'UASIN_GISHU', date_of_birth: '2010-03-08', guardian_id: 'SYN-GUARDIAN-KE-FAMILY005' } },
  { code: 'TYP002B', name: 'Brian Kipt oo' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('typo-03', 'typographical_variations',
  { code: 'TYP003A', name: 'Akinyi Odhiambo', options: { county: 'KISUMU', date_of_birth: '2013-12-01', guardian_id: 'SYN-GUARDIAN-KE-FAMILY006' } },
  { code: 'TYP003B', name: 'Akinyi Odhiyambo' }, ['date_of_birth', 'school_code', 'guardian_id']);

pair('format-01', 'name_order_and_formatting',
  { code: 'FMT001A', name: 'Kevin Mutua', options: { county: 'MACHAKOS', date_of_birth: '2012-10-17', guardian_id: 'SYN-GUARDIAN-KE-FAMILY007' } },
  { code: 'FMT001B', name: 'Mutua Kevin' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('format-02', 'name_order_and_formatting',
  { code: 'FMT002A', name: 'Faith Njeri', options: { county: 'NYERI', date_of_birth: '2011-01-26', guardian_id: 'SYN-GUARDIAN-KE-FAMILY008' } },
  { code: 'FMT002B', name: 'Faith  Njeri' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('format-03', 'name_order_and_formatting',
  { code: 'FMT003A', name: 'Mercy Wambui', options: { county: 'NAIROBI', date_of_birth: '2014-06-05', guardian_id: 'SYN-GUARDIAN-KE-FAMILY009' } },
  { code: 'FMT003B', name: 'Mercy Wambui ' }, ['date_of_birth', 'school_code', 'guardian_id']);

pair('similar-01', 'similar_names_distinct_students',
  { code: 'SIM001A', name: 'Peter Mwangi', options: { county: 'KIAMBU', date_of_birth: '2009-04-07', guardian_id: 'SYN-GUARDIAN-KE-SIBLING010' } },
  { code: 'SIM001B', name: 'Peter Mwangi', options: { date_of_birth: '2012-04-07' } }, ['school_code', 'guardian_id']);
pair('similar-02', 'similar_names_distinct_students',
  { code: 'SIM002A', name: 'Nyambura Kariuki', options: { county: 'NYERI', date_of_birth: '2008-11-19', guardian_id: 'SYN-GUARDIAN-KE-SIBLING011' } },
  { code: 'SIM002B', name: 'Dennis Kariuki', options: { date_of_birth: '2011-11-19' } }, ['school_code', 'guardian_id']);
pair('similar-03', 'similar_names_distinct_students',
  { code: 'SIM003A', name: 'Ian Ochieng', options: { county: 'KISUMU', date_of_birth: '2009-08-12' } },
  { code: 'SIM003B', name: 'Iain Ochieng', options: { county: 'BUSIA', date_of_birth: '2013-08-12' } });
pair('similar-04', 'similar_names_distinct_students',
  { code: 'SIM004A', name: 'Mark Maina', options: { county: 'NAIROBI', date_of_birth: '2008-02-22' } },
  { code: 'SIM004B', name: 'Martin Maina', options: { county: 'MAKUENI', date_of_birth: '2014-02-22' } });

pair('conflict-01', 'conflicting_identifiers',
  { code: 'CON001A', name: 'Hassan Abdi', options: { county: 'KILIFI', date_of_birth: '2011-09-30', guardian_id: 'SYN-GUARDIAN-KE-FAMILY012' } },
  { code: 'CON001B', name: 'Hassan Abdi' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('conflict-02', 'conflicting_identifiers',
  { code: 'CON002A', name: 'Purity Muthoni', options: { county: 'MERU', date_of_birth: '2010-05-06', guardian_id: 'SYN-GUARDIAN-KE-FAMILY013' } },
  { code: 'CON002B', name: 'Purity Muthoni' }, ['date_of_birth', 'school_code', 'guardian_id']);
pair('conflict-03', 'conflicting_identifiers',
  { code: 'CON003A', name: 'Samuel Kiprono', options: { county: 'UASIN_GISHU', date_of_birth: '2013-03-14', guardian_id: 'SYN-GUARDIAN-KE-FAMILY014' } },
  { code: 'CON003B', name: 'Samuel Kiprono' }, ['date_of_birth', 'school_code', 'guardian_id']);

pair('missing-01', 'missing_or_inconsistent_fields',
  { code: 'MIS001A', name: 'Esther Wanjala', options: { county: 'BUSIA', date_of_birth: null, guardian_id: null } },
  { code: 'MIS001B', name: 'Esther Wanjala', options: { date_of_birth: null, guardian_id: null } }, ['school_code']);
pair('missing-02', 'missing_or_inconsistent_fields',
  { code: 'MIS002A', name: 'David Otieno', options: { county: 'KISUMU', date_of_birth: '2011-12-12', guardian_id: null } },
  { code: 'MIS002B', name: 'David Otieno', options: { date_of_birth: '2011-12-12', guardian_id: null } }, ['school_code']);
pair('missing-03', 'missing_or_inconsistent_fields',
  { code: 'MIS003A', name: 'Zawadi Naliaka', options: { county: 'KAKAMEGA', date_of_birth: null, guardian_id: 'SYN-GUARDIAN-KE-FAMILY015' } },
  { code: 'MIS003B', name: 'Zawadi Nalyaka', options: { date_of_birth: null } }, ['school_code', 'guardian_id']);

pair('upi-01', 'exact_upi_matches',
  { code: 'UPI001A', name: 'Dennis Kamau', options: { county: 'NAIROBI', date_of_birth: '2010-06-20', upi: 'SYN-UPI-KE-INTENTIONAL-SHARED-001' } },
  { code: 'UPI001B', name: 'Daniel Kamau', options: { county: 'KITUI', date_of_birth: '2013-01-09' } }, ['upi']);
pair('upi-02', 'exact_upi_matches',
  { code: 'UPI002A', name: 'Sheila Atieno', options: { county: 'KISUMU', date_of_birth: '2012-05-29', upi: 'SYN-UPI-KE-INTENTIONAL-SHARED-002' } },
  { code: 'UPI002B', name: 'Sheila Atieno', options: { county: 'KILIFI', date_of_birth: '2014-07-11' } }, ['upi']);

const ordinaryStudents = [
  student('ORD001', 'Grace Wairimu', { county: 'NYERI', date_of_birth: '2012-09-14' }),
  student('ORD002', 'Victor Barasa', { county: 'KAKAMEGA', date_of_birth: '2011-02-03' }),
  student('ORD003', 'Halima Noor', { county: 'NAIROBI', date_of_birth: '2010-12-19' }),
  student('ORD004', 'Joel Kibet', { county: 'UASIN_GISHU', date_of_birth: '2013-04-25' }),
  student('ORD005', 'Linet Muthoka', { county: 'MAKUENI', date_of_birth: '2009-07-08' }),
  student('ORD006', 'Omar Hassan', { county: 'KILIFI', date_of_birth: '2014-03-17' }),
  student('ORD007', 'Brenda Auma', { county: 'KISUMU', date_of_birth: '2012-01-30' }),
  student('ORD008', 'Caleb Kiplangat', { county: 'KERICHO', date_of_birth: '2010-10-02' }),
];

module.exports = { comparisons, ordinaryStudents, records, SCHOOL_CODES, SCHOOL_INFO };
