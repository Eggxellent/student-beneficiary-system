const GUARDIAN_NATIONAL_ID_PATTERN = /^[0-9]{8}$/;

function isValidGuardianNationalId(value) {
  return typeof value === 'string' && GUARDIAN_NATIONAL_ID_PATTERN.test(value);
}

function presentGuardianProfile(profile) {
  if (!profile) return profile;
  const hasStoredValue = typeof profile.national_id === 'string' && profile.national_id.length > 0;
  const valid = isValidGuardianNationalId(profile.national_id);
  return {
    ...profile,
    // Return the guardian's own stored value so the application form can prefill it. Matching
    // still separately validates the exact eight-digit format before using it as evidence.
    national_id: hasStoredValue ? profile.national_id : null,
    national_id_status: valid ? 'valid' : hasStoredValue ? 'invalid_legacy' : 'missing',
  };
}

module.exports = {
  GUARDIAN_NATIONAL_ID_PATTERN,
  isValidGuardianNationalId,
  presentGuardianProfile,
};
