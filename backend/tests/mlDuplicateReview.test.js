jest.mock('../src/services/duplicateCheck', () => ({
  scoreStudentPairs: jest.fn(),
}));

const { scoreStudentPairs } = require('../src/services/duplicateCheck');
const { scorePairs, PREDICTION_BATCH_SIZE, exactNationalIdMatch } = require('../src/services/mlDuplicateReview');

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
});
