const {
  isValidGuardianNationalId,
  presentGuardianProfile,
} = require('../src/services/guardianNationalId');

describe('Guardian National ID rules', () => {
  test('accepts exactly eight digits and preserves leading zeroes', () => {
    expect(isValidGuardianNationalId('00123456')).toBe(true);
    expect(presentGuardianProfile({ national_id: '00123456' })).toMatchObject({
      national_id: '00123456',
      national_id_status: 'valid',
    });
  });

  test.each([
    '1234567',
    '123456789',
    '1234 5678',
    '1234-5678',
    '1234567a',
    ' 1234567',
    12345678,
  ])('rejects invalid ID value %p without converting it', (value) => {
    expect(isValidGuardianNationalId(value)).toBe(false);
  });

  test('returns invalid historical values for guardian profile prefilling without marking them valid', () => {
    const legacyProfile = { id: 'guardian-1', national_id: 'N1234567' };
    expect(presentGuardianProfile(legacyProfile)).toMatchObject({
      national_id: 'N1234567',
      national_id_status: 'invalid_legacy',
    });
    expect(legacyProfile.national_id).toBe('N1234567');
  });
});
