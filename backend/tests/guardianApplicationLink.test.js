const { resolveSchoolCode, submittedStudentFor } = require('../src/services/guardianApplicationLink');

describe('guardian school-code handling', () => {
  test('normalizes submitted SBMS codes for the student record', () => {
    expect(resolveSchoolCode('sch-009')).toBe('SCH-009');
    expect(submittedStudentFor({ school_name: 'sch-070' }).school_code).toBe('SCH-070');
  });

  test('preserves the supported legacy school names', () => {
    expect(resolveSchoolCode('nairobi school')).toBe('Nairobi School');
    expect(resolveSchoolCode('Unknown school')).toBeNull();
  });
});
