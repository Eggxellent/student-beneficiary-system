const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const configuredPythonExecutable = process.env.PYTHON_BIN;
const windowsPythonExecutable = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'ml-service',
  '.venv',
  'Scripts',
  'python.exe'
);
const unixPythonExecutable = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'ml-service',
  '.venv',
  'bin',
  'python'
);
const pythonExecutable = configuredPythonExecutable
  || (fs.existsSync(windowsPythonExecutable) ? windowsPythonExecutable : unixPythonExecutable);
const predictor = path.join(__dirname, '..', '..', '..', 'ml-service', 'predict.py');
const modelFile = process.env.SBMS_MODEL_PATH || path.join(__dirname, '..', '..', '..', 'ml-service', 'model', 'rf_duplicate_model.joblib');
const DUPLICATE_SCORE_MAXIMUMS = Object.freeze({
  name: 0.08,
  date_of_birth: 0.04,
  school: 0.02,
  guardian: 0.06,
  upi: 0.40,
  birth_certificate: 0.40,
});
const MIN_NAME_SIMILARITY = 0.70;
const MIN_CORROBORATING_FIELDS = 4;
let predictorProcess;
let predictorOutput;
let pendingRequests = [];

function clean(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function jaro(first, second) {
  if (first === second) return 1;
  if (!first.length || !second.length) return 0;
  const distance = Math.floor(Math.max(first.length, second.length) / 2) - 1;
  const firstMatches = new Array(first.length).fill(false);
  const secondMatches = new Array(second.length).fill(false);
  let matches = 0;

  for (let index = 0; index < first.length; index += 1) {
    const start = Math.max(0, index - distance);
    const end = Math.min(index + distance + 1, second.length);
    for (let candidate = start; candidate < end; candidate += 1) {
      if (!secondMatches[candidate] && first[index] === second[candidate]) {
        firstMatches[index] = true;
        secondMatches[candidate] = true;
        matches += 1;
        break;
      }
    }
  }

  if (!matches) return 0;
  let transpositions = 0;
  let secondIndex = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (!firstMatches[index]) continue;
    while (!secondMatches[secondIndex]) secondIndex += 1;
    if (first[index] !== second[secondIndex]) transpositions += 1;
    secondIndex += 1;
  }
  return (matches / first.length + matches / second.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(first, second) {
  const left = clean(first);
  const right = clean(second);
  const base = jaro(left, right);
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  return base + prefix * 0.1 * (1 - base);
}

function normalizedValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchingValue(first, second, prefix) {
  const left = normalizedValue(first);
  const right = normalizedValue(second);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftCore = prefix && left.startsWith(prefix) ? left.slice(prefix.length) : left;
  const rightCore = prefix && right.startsWith(prefix) ? right.slice(prefix.length) : right;
  const similarity = editSimilarity(leftCore, rightCore);
  return similarity >= MIN_NAME_SIMILARITY ? similarity : 0;
}

function exactIdentifierMatch(first, second) {
  const left = normalizedValue(first);
  const right = normalizedValue(second);
  return Number(Boolean(left && right && left === right));
}

function editSimilarity(first, second) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      current[secondIndex] = Math.min(
        current[secondIndex - 1] + 1,
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + substitutionCost
      );
    }
    for (let secondIndex = 0; secondIndex <= second.length; secondIndex += 1) previous[secondIndex] = current[secondIndex];
  }

  const longest = Math.max(first.length, second.length);
  return longest ? 1 - previous[second.length] / longest : 1;
}

function dateValue(value) {
  if (!value) return '';
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function dateSimilarity(first, second) {
  const left = dateValue(first);
  const right = dateValue(second);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const daysApart = Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000;
  return Number((1 / (1 + daysApart / 365)).toFixed(4));
}

function buildDuplicateFeatures(first, second) {
  const nameSimilarity = jaroWinkler(first.full_name, second.full_name);

  return {
    jaro_winkler: nameSimilarity >= MIN_NAME_SIMILARITY ? nameSimilarity : 0,
    dob_match: dateSimilarity(first.date_of_birth, second.date_of_birth),
    school_match: matchingValue(first.school_code, second.school_code, 'sch'),
    guardian_match: matchingValue(first.guardian_id, second.guardian_id, 'g'),
    upi_match: exactIdentifierMatch(first.upi, second.upi),
    birth_certificate_match: exactIdentifierMatch(first.birth_certificate_number, second.birth_certificate_number),
  };
}

function calculateDuplicateContributions(features) {
  return {
    name: Number((features.jaro_winkler * DUPLICATE_SCORE_MAXIMUMS.name).toFixed(4)),
    date_of_birth: Number((features.dob_match * DUPLICATE_SCORE_MAXIMUMS.date_of_birth).toFixed(4)),
    school: Number((features.school_match * DUPLICATE_SCORE_MAXIMUMS.school).toFixed(4)),
    guardian: Number((features.guardian_match * DUPLICATE_SCORE_MAXIMUMS.guardian).toFixed(4)),
    upi: Number((features.upi_match * DUPLICATE_SCORE_MAXIMUMS.upi).toFixed(4)),
    birth_certificate: Number((features.birth_certificate_match * DUPLICATE_SCORE_MAXIMUMS.birth_certificate).toFixed(4)),
  };
}

function calculateDuplicateScore(features) {
  const contributions = calculateDuplicateContributions(features);
  return Number(Object.values(contributions).reduce((total, contribution) => total + contribution, 0).toFixed(4));
}

function hasCorroboratingMajority(features) {
  return Object.values(features).filter((similarity) => similarity >= MIN_NAME_SIMILARITY).length >= MIN_CORROBORATING_FIELDS;
}

function classifyDuplicate(features, score, duplicateThreshold, reviewThreshold) {
  if (features.upi_match === 1 || features.birth_certificate_match === 1) return 'critical';
  if (score >= duplicateThreshold) return 'duplicate';
  if (score >= reviewThreshold || hasCorroboratingMajority(features)) return 'review';
  return 'clear';
}

function duplicateReviewReason(features, score, reviewThreshold) {
  const matchedIdentifiers = [
    features.upi_match === 1 ? 'UPI' : null,
    features.birth_certificate_match === 1 ? 'birth certificate number' : null,
  ].filter(Boolean);
  if (matchedIdentifiers.length > 0) {
    return `Critical identifier match: exact ${matchedIdentifiers.join(' and ')} across student records. Verify the original documents and resolve this flag before disbursement.`;
  }
  if (score >= reviewThreshold) return null;
  if (hasCorroboratingMajority(features)) return 'Four or more fields show strong similarity; manual review is required.';
  return null;
}

function checkDuplicate(features) {
  return checkDuplicates([features]).then((results) => results[0]);
}

function checkDuplicates(features) {
  return new Promise((resolve, reject) => {
    ensurePredictor();
    pendingRequests.push({ resolve, reject });
    const preparedFeatures = features.map((feature) => ({
      ...feature,
      birth_certificate_match: feature.birth_certificate_match || 0,
    }));
    predictorProcess.stdin.write(`${JSON.stringify(preparedFeatures)}\n`);
  });
}

function ensurePredictor() {
  if (predictorProcess) return;
  if (!fs.existsSync(modelFile)) {
    throw new Error('Duplicate-detection model is not installed');
  }
  predictorProcess = spawn(pythonExecutable, [predictor, '--server'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  predictorProcess.unref();
  predictorProcess.stdin.unref();
  predictorProcess.stdout.unref();
  predictorProcess.stderr.unref();
  predictorOutput = readline.createInterface({ input: predictorProcess.stdout });
  predictorOutput.on('line', (line) => {
    const request = pendingRequests.shift();
    if (!request) return;
    try {
      const result = JSON.parse(line);
      if (result.error) return request.reject(new Error(result.error));
      request.resolve(Array.isArray(result) ? result : [result]);
    } catch (error) {
      request.reject(error);
    }
  });
  predictorProcess.on('error', handlePredictorFailure);
  predictorProcess.on('close', () => {
    handlePredictorFailure(new Error('Python predictor process exited'));
    predictorProcess = undefined;
    predictorOutput = undefined;
  });
}

function handlePredictorFailure(error) {
  const requests = pendingRequests;
  pendingRequests = [];
  for (const request of requests) request.reject(error);
}

module.exports = {
  checkDuplicate,
  checkDuplicates,
  jaroWinkler,
  buildDuplicateFeatures,
  calculateDuplicateContributions,
  calculateDuplicateScore,
  hasCorroboratingMajority,
  classifyDuplicate,
  duplicateReviewReason,
  DUPLICATE_SCORE_MAXIMUMS,
  MIN_NAME_SIMILARITY,
  MIN_CORROBORATING_FIELDS,
};
