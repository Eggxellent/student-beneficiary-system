jest.mock('../src/services/duplicateCheck', () => ({
  scoreStudentPairs: jest.fn(),
}));

const { scoreStudentPairs } = require('../src/services/duplicateCheck');
const { scorePairs, PREDICTION_BATCH_SIZE, exactNationalIdMatch, exactReviewIdentifierMatches, reviewPriority } = require('../src/services/mlDuplicateReview');
const { getDuplicateThreshold } = require('../src/config/settings');

function scoredBatch(pairs) {
  return {
    model_version: 'xgboost:test-artifact',
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
    expect(result.model_version).toBe('xgboost:test-artifact');
  });

  test('asks predictor to identify artifact version when there are no pairs', async () => {
    scoreStudentPairs.mockResolvedValueOnce(scoredBatch([]));

    await expect(scorePairs([])).resolves.toEqual({ model_version: 'xgboost:test-artifact', results: [] });
    expect(scoreStudentPairs).toHaveBeenCalledWith([]);
  });

  test('rejects normalized exact national IDs as a separate review signal', () => {
    expect(exactNationalIdMatch({ national_id_number: '1234 5678-X' }, { national_id_number: '12345678-x' })).toBe(true);
    expect(exactNationalIdMatch({ national_id_number: 'UNKNOWN' }, { national_id_number: 'UNKNOWN' })).toBe(false);
  });

  test('treats exact UPI and birth-certificate identifiers as human-review signals', () => {
    expect(exactReviewIdentifierMatches(
      { upi: 'UPI-12345', birth_certificate_number: 'BC-2012-45678' },
      { upi: 'upi 12345', birth_certificate_number: 'bc201245678' }
    )).toEqual(['UPI', 'birth certificate number']);
    expect(exactReviewIdentifierMatches(
      { upi: 'UNKNOWN', birth_certificate_number: '000000' },
      { upi: 'UNKNOWN', birth_certificate_number: '000000' }
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
