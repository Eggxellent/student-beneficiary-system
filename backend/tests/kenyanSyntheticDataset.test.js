const { comparisons, ordinaryStudents, records, SCHOOL_INFO } = require('../scripts/kenyanSyntheticDataset');
const {
  buildDuplicateFeatures,
  calculateDuplicateScore,
  classifyDuplicate,
  hasCorroboratingMajority,
  MIN_NAME_SIMILARITY,
} = require('../src/services/duplicateCheck');

function evaluate(item) {
  const features = buildDuplicateFeatures(item.first, item.second);
  const probability = features.national_id_match ? 1 : calculateDuplicateScore(features);
  return {
    features,
    probability,
    risk: classifyDuplicate(features, probability, 0.7, 0.3),
    eligible: features.jaro_winkler >= MIN_NAME_SIMILARITY
      || features.upi_match || features.birth_certificate_match || features.national_id_match
      || hasCorroboratingMajority(features),
  };
}

describe('synthetic Kenyan dashboard dataset', () => {
  test('has 50 clearly marked fictional records and 21 labelled comparison pairs', () => {
    expect(records).toHaveLength(50);
    expect(ordinaryStudents).toHaveLength(8);
    expect(comparisons).toHaveLength(21);
    expect(records.every((record) => record.qr_token.startsWith('SBMS-SYNTHETIC-KE-'))).toBe(true);
    expect(records.every((record) => record.upi.startsWith('SYN-UPI-KE-'))).toBe(true);
    expect(new Set(Object.values(SCHOOL_INFO).map(([, school]) => school))).toEqual(new Set([
      'Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda',
    ]));
    expect(records.every((record) => ['Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda'].includes(record.school_code))).toBe(true);
    expect(new Set(records.map((record) => record.qr_token)).size).toBe(records.length);
  });

  test('uses the real application matching policy: typo variants are review candidates and reversed order is not assumed exact', () => {
    const typo = evaluate(comparisons.find((item) => item.id === 'typo-01'));
    expect(typo.eligible).toBe(true);
    expect(typo.risk).toBe('review');
    const reversed = evaluate(comparisons.find((item) => item.id === 'format-01'));
    expect(reversed.features.jaro_winkler).toBeLessThan(MIN_NAME_SIMILARITY);
    expect(reversed.risk).toBe('clear');
    const repeatedSpace = evaluate(comparisons.find((item) => item.id === 'format-02'));
    expect(repeatedSpace.features.jaro_winkler).toBe(1);
  });

  test('shared school and guardian alone do not make a different-age sibling a duplicate candidate', () => {
    const sibling = evaluate(comparisons.find((item) => item.id === 'similar-01'));
    expect(sibling.features.school_match).toBe(1);
    expect(sibling.features.guardian_match).toBe(1);
    expect(sibling.risk).toBe('clear');
    expect(comparisons.filter((item) => item.category === 'similar_names_distinct_students')
      .every((item) => evaluate(item).risk !== 'duplicate')).toBe(true);
  });

  test('missing values are zero evidence and exact synthetic UPI matches are critical review candidates', () => {
    const missing = comparisons.filter((item) => item.category === 'missing_or_inconsistent_fields').map(evaluate);
    expect(missing[0].features.dob_match).toBe(0);
    expect(missing[0].features.guardian_match).toBe(0);
    expect(missing[1].features.guardian_match).toBe(0);
    expect(missing[2].features.dob_match).toBe(0);
    const upi = comparisons.filter((item) => item.category === 'exact_upi_matches').map(evaluate);
    expect(upi.every((result) => result.features.upi_match === 1 && result.risk === 'critical')).toBe(true);
    expect(upi.every((result) => result.eligible)).toBe(true);
  });
});
