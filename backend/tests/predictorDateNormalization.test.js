const { dateOnly, predictorRecord } = require('../src/services/mlDuplicateReview');

// Regression guard: `pg` returns DATE columns as a JS Date at local midnight, which
// JSON-serialises to a UTC timestamp (the previous calendar day east of UTC). The
// Python predictor only parses strict calendar dates, so unnormalised values silently
// scored dob_match=0 for records that share a birth date.
describe('Predictor date normalisation', () => {
  test('serialises a pg DATE (local midnight) as its calendar date', () => {
    expect(dateOnly(new Date(2010, 4, 14))).toBe('2010-05-14');
  });

  test('keeps an already-normalised submission unchanged', () => {
    expect(dateOnly('2010-05-14')).toBe('2010-05-14');
  });

  test('truncates an ISO timestamp to its calendar date', () => {
    expect(dateOnly('2010-05-14T00:00:00.000Z')).toBe('2010-05-14');
  });

  test('maps missing or unparseable values to null', () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
    expect(dateOnly('')).toBeNull();
    expect(dateOnly(new Date('not a date'))).toBeNull();
  });

  test('passes unrecognised text through so the predictor treats it as missing', () => {
    expect(dateOnly('14 May 2010')).toBe('14 May 2010');
  });

  test('normalises only the date field and does not mutate the record', () => {
    const record = { date_of_birth: new Date(2010, 4, 14), upi: 'UPI-1', full_name: 'Miriam Chebet' };

    expect(predictorRecord(record)).toEqual({
      date_of_birth: '2010-05-14',
      upi: 'UPI-1',
      full_name: 'Miriam Chebet',
    });
    expect(record.date_of_birth).toBeInstanceOf(Date);
  });
});
