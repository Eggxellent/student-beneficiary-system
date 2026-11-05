const { randomInt } = require('crypto');

// A certificate reference is typed by a human from paper, so it is built from an alphabet with no
// visually ambiguous pairs: no 0/O and no 1/I. Eleven symbols of a 32-symbol alphabet is 55 bits of
// entropy, which makes a reference impractical to guess while staying short enough to read aloud
// over a telephone. The reference identifies the certificate row, not the student: one student can
// hold several certificates for different academic years.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BODY_LENGTH = 11;
const GROUP_SIZES = [4, 4, 3];

// Canonical shape: SBMS-2026-K8M4-X7PQ-2RZ
const REFERENCE_PATTERN = /^SBMS-\d{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{3}$/;
// Certificates issued before the 2026-11 redesign used SBMS-CERT-2026-1A2B3C4D. They are still in
// circulation on paper, so they still resolve; no historical row is rewritten.
const LEGACY_REFERENCE_PATTERN = /^SBMS-CERT-\d{4}-[0-9A-F]{8}$/;

function group(body) {
  let cursor = 0;
  return GROUP_SIZES.map((size) => {
    const part = body.slice(cursor, cursor + size);
    cursor += size;
    return part;
  }).join('-');
}

function currentYear() {
  return new Date().getUTCFullYear();
}

function generateCertificateReference({ year = currentYear(), random = randomInt } = {}) {
  const stamp = Number(year);
  if (!Number.isInteger(stamp) || stamp < 2000 || stamp > 9999) {
    throw new Error('A certificate reference needs a four-digit year');
  }

  let body = '';
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    body += ALPHABET[random(ALPHABET.length)];
  }

  return `SBMS-${stamp}-${group(body)}`;
}

// Turns what a person typed into the stored form, or null when it cannot be a reference at all.
// Case, spaces and dashes are forgiven because a human is copying from a printed sheet; characters
// outside the alphabet are not, because guessing which symbol was meant would widen the search
// space for anyone probing the public endpoint.
function normalizeCertificateReference(input) {
  if (typeof input !== 'string') return null;

  const compact = input.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (!compact || compact.length > 40) return null;

  const legacy = compact.match(/^SBMSCERT(\d{4})([0-9A-F]{8})$/);
  if (legacy) return `SBMS-CERT-${legacy[1]}-${legacy[2]}`;

  // The prefix may be omitted: people often copy only the code part of the reference.
  const match = compact.match(/^(?:SBMS)?(\d{4})([A-Z0-9]{11})$/);
  if (!match) return null;

  const [, year, body] = match;
  if (![...body].every((character) => ALPHABET.includes(character))) return null;

  return `SBMS-${year}-${group(body)}`;
}

function isCertificateReference(value) {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value);
}

module.exports = {
  ALPHABET,
  REFERENCE_PATTERN,
  LEGACY_REFERENCE_PATTERN,
  generateCertificateReference,
  normalizeCertificateReference,
  isCertificateReference,
};
