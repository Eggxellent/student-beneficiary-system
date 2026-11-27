const { scoreStudentPairs } = require('./duplicateCheck');
const { getMlReviewScoreThreshold, getDuplicateThreshold } = require('../config/settings');

const PREDICTION_BATCH_SIZE = 200;
const MISSING_IDENTIFIERS = new Set(['', 'na', 'nan', 'none', 'null', 'unknown', 'notprovided', 'notavailable']);
// Identifiers that stand alone as evidence a reviewer can check against source documents.
// The admission number is not in this list because it is only unique inside one school; it is
// compared separately by exactAdmissionNumberMatch().
const REVIEW_IDENTIFIER_FIELDS = Object.freeze([
  ['birth_certificate_number', 'birth certificate number'],
]);
const ADMISSION_NUMBER_LABEL = 'admission number';
const ADMISSION_NUMBER_PREFIXES = Object.freeze([
  'admissionnumber', 'admissionno', 'admission', 'admno', 'adm',
  'registrationnumber', 'regno', 'reg',
]);

function configuredThreshold() {
  const value = getMlReviewScoreThreshold();
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('ML_REVIEW_SCORE_THRESHOLD must be a number from 0 to 1');
  }
  return value;
}

function normalizedIdentifier(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function usableIdentifier(value) {
  const normalized = normalizedIdentifier(value);
  return !MISSING_IDENTIFIERS.has(normalized) && !(normalized.length >= 4 && /^0+$/.test(normalized));
}

function exactSchoolCodeMatch(first, second) {
  const left = normalizedIdentifier(first && first.school_code);
  const right = normalizedIdentifier(second && second.school_code);
  return usableIdentifier(left) && left === right && usableIdentifier(right);
}

// Presentation only: case, spaces, slashes and a leading field prefix are removed. Leading zeros
// are preserved, because 0148 and 148 are two register entries, not one.
function admissionNumberKey(value) {
  let compact = normalizedIdentifier(value);
  if (!usableIdentifier(compact)) return '';
  for (const prefix of ADMISSION_NUMBER_PREFIXES) {
    if (compact.startsWith(prefix) && compact.length > prefix.length) {
      compact = compact.slice(prefix.length);
      break;
    }
  }
  return compact;
}

/**
 * Match the model's training/inference gate exactly: both records need the same usable
 * school_code. Free-text school names do not make admission numbers comparable in this model.
 */
function exactAdmissionNumberMatch(first, second) {
  if (!exactSchoolCodeMatch(first, second)) return false;
  const left = admissionNumberKey(first && first.admission_number);
  const right = admissionNumberKey(second && second.admission_number);
  return Boolean(left && right && left === right);
}

function exactReviewIdentifierMatches(first, second) {
  const matches = REVIEW_IDENTIFIER_FIELDS.flatMap(([field, label]) => {
    const left = normalizedIdentifier(first && first[field]);
    const right = normalizedIdentifier(second && second[field]);
    return usableIdentifier(left) && usableIdentifier(right) && left === right ? [label] : [];
  });
  if (exactAdmissionNumberMatch(first, second)) matches.unshift(ADMISSION_NUMBER_LABEL);
  // National ID belongs to the guardian. It is context only, not student identity evidence.
  return matches;
}

/**
 * Priority for one duplicate case, shared by the registration response and the admin
 * queue so the confirmation screen and the queue can never disagree.
 *
 * Exact identifier agreement outranks the model score, because it is evidence a reviewer
 * can check against source documents. Otherwise `DUPLICATE_HIGH_PRIORITY_THRESHOLD`
 * decides. That cutoff is provisional (`thresholds_validated: false` in the queue policy),
 * so neither priority level is a decision that a record is a duplicate.
 */
function reviewPriority({ score, highPriorityThreshold, exactIdentifierCount = 0 } = {}) {
  if (Number(exactIdentifierCount) > 0) return 'high';
  const cutoff = highPriorityThreshold === undefined
    ? getDuplicateThreshold()
    : highPriorityThreshold;
  const numericScore = Number(score);
  const numericCutoff = Number(cutoff);
  if (!Number.isFinite(numericScore) || !Number.isFinite(numericCutoff)) return 'standard';
  return numericScore >= numericCutoff ? 'high' : 'standard';
}

// The predictor parses strict calendar dates (feature_engineering._dob_similarity),
// so anything else silently scores as "no date-of-birth match". `pg` returns DATE
// columns as a JS Date at local midnight, which serialises to a UTC timestamp -- and
// therefore the previous calendar day for every zone east of UTC. Records are
// normalised to YYYY-MM-DD here, at the single boundary that talks to the predictor,
// so stored rows and freshly submitted payloads are compared on the same basis.
function dateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function predictorRecord(record) {
  if (!record || typeof record !== 'object') return record;
  return { ...record, date_of_birth: dateOnly(record.date_of_birth) };
}

async function scorePairs(pairs) {
  const results = [];
  let modelVersion;
  const batchCount = Math.max(1, Math.ceil(pairs.length / PREDICTION_BATCH_SIZE));
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const offset = batchIndex * PREDICTION_BATCH_SIZE;
    const batch = pairs
      .slice(offset, offset + PREDICTION_BATCH_SIZE)
      .map((pair) => ({ first: predictorRecord(pair.first), second: predictorRecord(pair.second) }));
    let prediction;
    try {
      prediction = await scoreStudentPairs(batch);
    } catch (cause) {
      const error = new Error('Python duplicate predictor failed');
      error.code = 'DUPLICATE_PREDICTOR_FAILED';
      error.cause = cause;
      throw error;
    }
    if (!Array.isArray(prediction.results) || prediction.results.length !== batch.length || !prediction.model_version) {
      throw new Error('Python duplicate predictor returned an invalid response');
    }
    if (modelVersion && modelVersion !== prediction.model_version) {
      throw new Error('Python duplicate model changed during this comparison');
    }
    modelVersion = prediction.model_version;
    for (const result of prediction.results) {
      if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !result.features) {
        throw new Error('Python duplicate predictor returned an invalid score');
      }
      results.push(result);
    }
  }
  return { model_version: modelVersion, results };
}

module.exports = {
  PREDICTION_BATCH_SIZE,
  configuredThreshold,
  dateOnly,
  predictorRecord,
  exactSchoolCodeMatch,
  exactAdmissionNumberMatch,
  exactReviewIdentifierMatches,
  reviewPriority,
  scorePairs,
};
