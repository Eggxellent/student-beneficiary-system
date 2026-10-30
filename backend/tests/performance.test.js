const fs = require('fs');
const path = require('path');
const { scoreStudentPairs } = require('../src/services/duplicateCheck');

const mlService = path.join(__dirname, '..', '..', 'ml-service');
const pythonExecutable = process.env.PYTHON_EXECUTABLE
  || path.join(mlService, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const predictorAvailable = fs.existsSync(pythonExecutable)
  && fs.existsSync(path.join(mlService, 'predict.py'))
  && fs.existsSync(path.join(mlService, 'model', 'xgb_duplicate_model.joblib'));

function pair(index) {
  return {
    first: {
      full_name: `Perf Candidate ${index}`,
      date_of_birth: '2010-05-14',
      school_code: 'Maranda',
      guardian_id: `G-${100000 + index}`,
      upi: `UPI-${20000000 + index}`,
      birth_certificate_number: `BC-${3000000 + index}`,
      national_id_number: `ID-${4000000 + index}`,
    },
    second: {
      full_name: `Perf Existing ${index}`,
      date_of_birth: '2011-02-03',
      school_code: 'Nairobi School',
      guardian_id: `G-${500000 + index}`,
      upi: `UPI-${60000000 + index}`,
      birth_certificate_number: `BC-${7000000 + index}`,
      national_id_number: `ID-${8000000 + index}`,
    },
  };
}

// Skipped only when the Python environment or model artifact is absent, so the
// suite still runs on a checkout without the (git-ignored) artifact.
const describeWithPredictor = predictorAvailable ? describe : describe.skip;

describeWithPredictor('Duplicate detection performance', () => {
  jest.setTimeout(60000);

  test('screens a 50-candidate registration within 3 seconds', async () => {
    // The first call includes predictor start-up and model load; this measures
    // the steady state, which is what a warm API pays per registration.
    await scoreStudentPairs([pair(0)]);

    const pairs = Array.from({ length: 50 }, (_, index) => pair(index + 1));
    const start = process.hrtime.bigint();
    const result = await scoreStudentPairs(pairs);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`Screened ${pairs.length} candidate pairs in ${elapsedMs.toFixed(2)} ms`);

    expect(result.results).toHaveLength(pairs.length);
    expect(result.model_version).toMatch(/^xgboost:/);
    for (const scored of result.results) {
      expect(scored.score).toBeGreaterThanOrEqual(0);
      expect(scored.score).toBeLessThanOrEqual(1);
    }
    expect(elapsedMs).toBeLessThan(3000);
  });
});
