const { scorePairs } = require('../src/services/mlDuplicateReview');

describe('Python duplicate model prediction bridge', () => {
  jest.setTimeout(30000);

  test('scores a synthetic record pair with the deployed artifact and reports its version', async () => {
    const first = {
      full_name: 'Amina Wanjiku',
      date_of_birth: '2010-05-14',
      school_code: 'Nairobi School',
      guardian_id: 'G-4101',
      admission_number: '0148',
      birth_certificate_number: 'BC-4101',
    };
    const second = { ...first, full_name: 'Amina Wanjikuu', admission_number: '0148' };

    const prediction = await scorePairs([{ first, second }]);

    expect(prediction.model_version).toMatch(/^histgradientboostingclassifier:[a-f0-9]{64}$/);
    expect(prediction.results).toHaveLength(1);
    expect(prediction.results[0].score).toBeGreaterThanOrEqual(0);
    expect(prediction.results[0].score).toBeLessThanOrEqual(1);
    expect(Object.keys(prediction.results[0].features)).toEqual([
      'jaro_winkler',
      'dob_match',
      'school_match',
      'guardian_match',
      'admission_number_match',
      'birth_certificate_match',
    ]);
    expect(prediction.results[0].features.admission_number_match).toBe(1);
    expect(prediction.results[0].review_evidence).toEqual(expect.objectContaining({
      near_match_review: expect.any(Boolean),
      signals: expect.any(Array),
    }));
  });
});
