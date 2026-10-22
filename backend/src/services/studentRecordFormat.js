function cleanOptional(value) {
  if (value == null) return undefined;
  const cleaned = String(value).trim().replace(/\s+/g, ' ');
  return cleaned || undefined;
}

function normalizeIdentifier(value) {
  const cleaned = cleanOptional(value);
  return cleaned ? cleaned.toUpperCase() : undefined;
}

function normalizeKenyanPhone(value) {
  const cleaned = cleanOptional(value);
  if (!cleaned) return undefined;
  const digits = cleaned.replace(/[\s()-]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+254[17]\d{8}$/.test(digits)) return digits;
  return cleaned;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

module.exports = { cleanOptional, normalizeIdentifier, normalizeKenyanPhone, validIsoDate };
