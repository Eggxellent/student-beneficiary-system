const {
  buildDuplicateFeatures,
  calculateDuplicateContributions,
  calculateDuplicateScore,
  DUPLICATE_SCORE_MAXIMUMS,
  MIN_NAME_SIMILARITY,
  hasCorroboratingMajority,
  hasExactNameAndDateMatch,
  classifyDuplicate,
  duplicateReviewReason,
} = require('../src/services/duplicateCheck');

function student(overrides = {}) {
  return {
    full_name: 'John Kamau',
    date_of_birth: '2005-04-12',
    school_code: 'SCH001',
    guardian_id: 'G123',
    upi: 'UPI-12345678',
    birth_certificate_number: 'BC-2010-123456',
    ...overrides,
  };
}

describe('Duplicate comparison features', () => {
  test('field maximums are fixed and sum to 100 percent', () => {
    expect(DUPLICATE_SCORE_MAXIMUMS).toEqual({
      name: 0.08,
      date_of_birth: 0.04,
      school: 0.02,
      guardian: 0.06,
      upi: 0.40,
      birth_certificate: 0.40,
    });
    expect(Object.values(DUPLICATE_SCORE_MAXIMUMS).reduce((sum, weight) => sum + weight, 0)).toBe(1);
  });

  test('clearly different names receive no name contribution', () => {
    const features = buildDuplicateFeatures(student(), student({ full_name: 'Tendo Kiptoo' }));

    expect(MIN_NAME_SIMILARITY).toBe(0.7);
    expect(features.jaro_winkler).toBe(0);
    expect(calculateDuplicateContributions(features).name).toBe(0);
  });

  test('close name spellings keep graded similarity credit', () => {
    const features = buildDuplicateFeatures(student(), student({ full_name: 'John Kamauu' }));

    expect(features.jaro_winkler).toBeGreaterThan(MIN_NAME_SIMILARITY);
    expect(features.jaro_winkler).toBeLessThan(1);
    expect(calculateDuplicateContributions(features).name).toBeGreaterThan(0);
    expect(calculateDuplicateContributions(features).name).toBeLessThan(DUPLICATE_SCORE_MAXIMUMS.name);
  });

  test('four strong fields trigger review even when their weighted score is below the review threshold', () => {
    const features = {
      jaro_winkler: 0.72,
      dob_match: 0.71,
      school_match: 0.72,
      guardian_match: 0.71,
      upi_match: 0,
      birth_certificate_match: 0,
    };
    const score = calculateDuplicateScore(features);

    expect(score).toBeLessThan(0.3);
    expect(hasCorroboratingMajority(features)).toBe(true);
    expect(classifyDuplicate(features, score, 0.7, 0.3)).toBe('review');
    expect(duplicateReviewReason(features, score, 0.3)).toMatch(/four or more fields/i);
  });

  test('corroboration requires four strong fields and never bypasses automatic duplicate threshold', () => {
    const threeFields = { jaro_winkler: 1, dob_match: 1, school_match: 1, guardian_match: 0, upi_match: 0, birth_certificate_match: 0 };
    const fourFields = { ...threeFields, guardian_match: 1 };

    expect(hasCorroboratingMajority(threeFields)).toBe(false);
    expect(classifyDuplicate(threeFields, 0.2, 0.7, 0.3)).toBe('review');
    expect(duplicateReviewReason(threeFields, 0.2, 0.3)).toMatch(/exact name and date/i);
    expect(classifyDuplicate(fourFields, 0.4, 0.7, 0.3)).toBe('review');
    expect(classifyDuplicate(fourFields, 0.7, 0.7, 0.3)).toBe('duplicate');
  });

  test('a lone exact birth certificate match is flagged for review below the clear-duplicate threshold', () => {
    const features = buildDuplicateFeatures(student(), student({
      full_name: 'Zxq Blr',
      date_of_birth: '2010-09-20',
      school_code: 'SCH099',
      guardian_id: 'G999',
      upi: 'UPI-87654321',
    }));

    expect(features.birth_certificate_match).toBe(1);
    expect(calculateDuplicateScore(features)).toBeGreaterThanOrEqual(0.4);
    expect(calculateDuplicateScore(features)).toBeLessThan(0.7);
    expect(calculateDuplicateContributions(features).birth_certificate).toBe(0.4);
    expect(classifyDuplicate(features, calculateDuplicateScore(features), 0.7, 0.3)).toBe('review');
    expect(duplicateReviewReason(features, calculateDuplicateScore(features), 0.3)).toMatch(/administrator confirmation/i);
  });

  test('a lone exact UPI match is flagged for review below the clear-duplicate threshold', () => {
    const features = buildDuplicateFeatures(student(), student({
      full_name: 'Zxq Blr',
      date_of_birth: '2010-09-20',
      school_code: 'SCH099',
      guardian_id: 'G999',
      birth_certificate_number: 'BC-2010-987654',
    }));

    expect(features.upi_match).toBe(1);
    expect(calculateDuplicateScore(features)).toBeGreaterThanOrEqual(0.4);
    expect(calculateDuplicateScore(features)).toBeLessThan(0.7);
    expect(calculateDuplicateContributions(features).upi).toBe(0.4);
    expect(classifyDuplicate(features, calculateDuplicateScore(features), 0.7, 0.3)).toBe('review');
    expect(duplicateReviewReason(features, calculateDuplicateScore(features), 0.3)).toMatch(/administrator confirmation/i);
  });

  test('a single exact identifier and supporting evidence below 70 percent stays in review', () => {
    const features = buildDuplicateFeatures(student(), student({
      full_name: 'John Kamau',
      date_of_birth: '2005-04-12',
      school_code: 'SCH001',
      guardian_id: 'G123',
      upi: 'UPI-96583217',
      birth_certificate_number: 'BC-2010-123456',
    }));

    expect(calculateDuplicateScore(features)).toBe(0.6);
    expect(classifyDuplicate(features, calculateDuplicateScore(features), 0.7, 0.3)).toBe('review');
  });

  test('scores at 70 percent are classified as clear duplicate candidates', () => {
    const features = { jaro_winkler: 0, dob_match: 0, school_match: 0, guardian_match: 0, upi_match: 0, birth_certificate_match: 0 };

    expect(classifyDuplicate(features, 0.6999, 0.7, 0.3)).toBe('review');
    expect(classifyDuplicate(features, 0.7, 0.7, 0.3)).toBe('duplicate');
  });

  test('database date values match calendar dates without UTC day shifts', () => {
    const features = buildDuplicateFeatures(
      student({ date_of_birth: '2010-05-14' }),
      student({ date_of_birth: new Date(2010, 4, 14) })
    );

    expect(features.dob_match).toBe(1);
  });

  test('unique identifiers only match exactly and receive no fuzzy credit for typos', () => {
    const features = buildDuplicateFeatures(
      student({ upi: 'UPI-12345678', birth_certificate_number: 'BC-2010-123456' }),
      student({ upi: 'UPI-12345679', birth_certificate_number: 'BC-2010-123457' })
    );

    expect(features.upi_match).toBe(0);
    expect(features.birth_certificate_match).toBe(0);
    expect(calculateDuplicateContributions(features).upi).toBe(0);
    expect(calculateDuplicateContributions(features).birth_certificate).toBe(0);
  });

  test('exact name and date agreement routes to review even below the weighted threshold', () => {
    const features = buildDuplicateFeatures(student({
      full_name: 'Amina Hassan',
      date_of_birth: '2010-05-14',
      school_code: 'SCH-014',
      guardian_id: 'G-123456',
      upi: 'UPI-12345678',
      birth_certificate_number: 'BC-2010-123456',
    }), student({
      full_name: 'Amina Hassan',
      date_of_birth: '2010-05-14',
      school_code: 'SCH-079',
      guardian_id: 'G-654321',
      upi: 'UPI-87654321',
      birth_certificate_number: 'BC-2010-654321',
    }));
    const score = calculateDuplicateScore(features);

    expect(score).toBe(0.12);
    expect(hasExactNameAndDateMatch(features)).toBe(true);
    expect(classifyDuplicate(features, score, 0.7, 0.3)).toBe('review');
    expect(duplicateReviewReason(features, score, 0.3)).toMatch(/exact name and date/i);
  });

  test('nearby dates receive stronger similarity than dates years apart', () => {
    const nearby = buildDuplicateFeatures(student({ date_of_birth: '2010-05-14' }), student({ date_of_birth: '2010-05-15' }));
    const distant = buildDuplicateFeatures(student({ date_of_birth: '2010-05-14' }), student({ date_of_birth: '2015-05-14' }));

    expect(nearby.dob_match).toBeGreaterThan(distant.dob_match);
    expect(nearby.dob_match).toBeLessThan(1);
  });

  test('unrelated identifiers with the same type prefix do not receive match credit', () => {
    const features = buildDuplicateFeatures(student(), student({
      upi: 'UPI-98765432',
      birth_certificate_number: 'BC-2010-987654',
    }));

    expect(features.upi_match).toBe(0);
    expect(features.birth_certificate_match).toBe(0);
    expect(calculateDuplicateScore(features)).toBe(0.2);
  });
});
