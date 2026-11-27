jest.mock('../src/services/duplicateCheck', () => ({
  scoreStudentPairs: jest.fn(),
}));

const { scoreStudentPairs } = require('../src/services/duplicateCheck');
const {
  scorePairs,
  PREDICTION_BATCH_SIZE,
  exactReviewIdentifierMatches,
  reviewPriority,
} = require('../src/services/mlDuplicateReview');
const { getDuplicateThreshold } = require('../src/config/settings');

function scoredBatch(pairs) {
  return {
    model_version: 'histgradientboostingclassifier:test-artifact',
    results: pairs.map(() => ({ score: 0.42, features: { jaro_winkler: 0.9, school_match: 1 } })),
  };
}

describe('ML duplicate review adapter', () => {
  beforeEach(() => scoreStudentPairs.mockReset());

  test('scores every pair in order and batches large candidate lists', async () => {
    const pairs = Array.from({ length: PREDICTION_BATCH_SIZE + 1 }, (_, index) => ({
      first: { full_name: `Student ${index}` },
      second: { full_name: `Candidate ${index}` },
    }));
    scoreStudentPairs
      .mockImplementationOnce(async (batch) => scoredBatch(batch))
      .mockImplementationOnce(async (batch) => scoredBatch(batch));

    const result = await scorePairs(pairs);

    expect(scoreStudentPairs.mock.calls.map(([batch]) => batch.length)).toEqual([PREDICTION_BATCH_SIZE, 1]);
    expect(result.results).toHaveLength(pairs.length);
    expect(result.results[0].score).toBe(0.42);
    expect(result.model_version).toBe('histgradientboostingclassifier:test-artifact');
  });

  test('asks predictor to identify artifact version when there are no pairs', async () => {
    scoreStudentPairs.mockResolvedValueOnce(scoredBatch([]));

    await expect(scorePairs([])).resolves.toEqual({ model_version: 'histgradientboostingclassifier:test-artifact', results: [] });
    expect(scoreStudentPairs).toHaveBeenCalledWith([]);
  });

  test('surfaces prediction process failures to the registration caller', async () => {
    scoreStudentPairs.mockRejectedValueOnce(new Error('predictor exited'));

    await expect(scorePairs([{ first: {}, second: {} }])).rejects.toMatchObject({
      code: 'DUPLICATE_PREDICTOR_FAILED',
    });
  });

  test('rejects incomplete or invalid prediction responses', async () => {
    scoreStudentPairs.mockResolvedValueOnce({ model_version: 'histgradientboostingclassifier:test', results: [] });

    await expect(scorePairs([{ first: {}, second: {} }])).rejects.toThrow(/invalid response/);
  });

  test('guardian national IDs are never student-unique review signals', () => {
    expect(exactReviewIdentifierMatches(
      { guardian_national_id: '12345678' },
      { guardian_national_id: '12345678' },
    )).toEqual([]);
  });

  test('treats an in-school admission number and a birth-certificate match as human-review signals', () => {
    expect(exactReviewIdentifierMatches(
      { school_code: 'Nairobi School', admission_number: 'ADM-0148', birth_certificate_number: 'BC-2012-45678' },
      { school_code: 'Nairobi School', admission_number: '0148', birth_certificate_number: 'bc201245678' }
    )).toEqual(['admission number', 'birth certificate number']);
    expect(exactReviewIdentifierMatches(
      { school_code: 'NAIROBI', admission_number: 'UNKNOWN', birth_certificate_number: '000000' },
      { school_code: 'NAIROBI', admission_number: 'UNKNOWN', birth_certificate_number: '000000' }
    )).toEqual([]);
  });

  test('never treats the same admission number at two schools, or without a school, as a match', () => {
    const first = { school_code: 'Nairobi School', admission_number: '0148' };
    expect(exactReviewIdentifierMatches(first, { school_code: 'Alliance High', admission_number: '0148' })).toEqual([]);
    expect(exactReviewIdentifierMatches(first, { admission_number: '0148' })).toEqual([]);
    expect(exactReviewIdentifierMatches({ admission_number: '0148' }, { admission_number: '0148' })).toEqual([]);
  });

  test('keeps leading zeros distinct when comparing admission numbers', () => {
    const first = { school_code: 'Nairobi School', admission_number: '0148' };
    expect(exactReviewIdentifierMatches(first, { school_code: 'Nairobi School', admission_number: '148' })).toEqual([]);
    expect(exactReviewIdentifierMatches(first, { school_code: 'Nairobi School', admission_number: '0148' })).toEqual(['admission number']);
  });

  test('does not treat a free-text school name as an admission-number model match', () => {
    expect(exactReviewIdentifierMatches(
      { school_name: 'St. Mary\u2019s Girls', admission_number: 'ADM-22' },
      { school_name: 'st marys girls', admission_number: '22' }
    )).toEqual([]);
  });

  test('only treats an admission number as exact evidence under a shared school code', () => {
    expect(exactReviewIdentifierMatches(
      { school_code: 'NAIROBI-01', admission_number: 'ADM-22' },
      { school_code: 'Nairobi 01', admission_number: '22' },
    )).toEqual(['admission number']);
    expect(exactReviewIdentifierMatches(
      { school_code: 'NAIROBI-01', school_name: 'Same Name', admission_number: '22' },
      { school_name: 'Same Name', admission_number: '22' },
    )).toEqual([]);
  });
});

describe('reviewPriority', () => {
  const highPriorityCutoff = 0.7;

  test('exact identifier agreement outranks the model score', () => {
    expect(reviewPriority({ score: 0.05, highPriorityThreshold: highPriorityCutoff, exactIdentifierCount: 1 })).toBe('high');
    expect(reviewPriority({ score: 0.99, highPriorityThreshold: highPriorityCutoff, exactIdentifierCount: 0 })).toBe('high');
  });

  test('score-only cases use the high-priority cutoff, not the review cutoff', () => {
    // 0.55 clears the 0.50 review cutoff but is not high priority: that distinction is
    // what makes the 'high' badge in the admin queue and the registration screen mean
    // something.
    expect(reviewPriority({ score: 0.55, highPriorityThreshold: highPriorityCutoff })).toBe('standard');
    expect(reviewPriority({ score: 0.7, highPriorityThreshold: highPriorityCutoff })).toBe('high');
    expect(reviewPriority({ score: 0.9982, highPriorityThreshold: highPriorityCutoff })).toBe('high');
  });

  test('falls back to the configured cutoff', () => {
    expect(reviewPriority({ score: getDuplicateThreshold() })).toBe('high');
    expect(reviewPriority({ score: 0 })).toBe('standard');
  });

  test('never throws on missing or malformed input', () => {
    expect(reviewPriority()).toBe('standard');
    expect(reviewPriority({ score: null, highPriorityThreshold: highPriorityCutoff })).toBe('standard');
    expect(reviewPriority({ score: 'not-a-number', highPriorityThreshold: highPriorityCutoff })).toBe('standard');
    expect(reviewPriority({ score: '0.8', highPriorityThreshold: highPriorityCutoff })).toBe('high');
  });
});
