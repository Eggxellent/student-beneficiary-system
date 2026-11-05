const {
  ALPHABET,
  REFERENCE_PATTERN,
  generateCertificateReference,
  normalizeCertificateReference,
  isCertificateReference,
} = require('../src/services/certificateReference');

// The printed reference is the manual verification path, so it has to be both hard to guess and
// easy to read back off paper.
describe('Certificate references', () => {
  test('are grouped and human readable', () => {
    const reference = generateCertificateReference({ year: 2026 });

    expect(reference).toMatch(REFERENCE_PATTERN);
    expect(reference.startsWith('SBMS-2026-')).toBe(true);
    expect(reference.split('-')).toHaveLength(5);
    expect(isCertificateReference(reference)).toBe(true);
  });

  test('avoid the characters that are misread from print', () => {
    for (const character of ['0', 'O', '1', 'I']) {
      expect(ALPHABET).not.toContain(character);
    }
    expect(ALPHABET).toHaveLength(32);
  });

  test('do not repeat and are not sequential', () => {
    const references = new Set();
    for (let index = 0; index < 2000; index += 1) {
      references.add(generateCertificateReference({ year: 2026 }));
    }
    expect(references.size).toBe(2000);

    // A sequential scheme would differ in one or two trailing characters; these must not.
    const [first, second] = [...references];
    const bodyA = first.slice(10);
    const bodyB = second.slice(10);
    const shared = [...bodyA].filter((character, index) => character === bodyB[index]).length;
    expect(shared).toBeLessThan(8);
  });

  test('are built from the injected randomness, so the source can be tested', () => {
    const reference = generateCertificateReference({ year: 2027, random: () => 0 });
    // Index 0 of the alphabet is '2'.
    expect(reference).toBe('SBMS-2027-2222-2222-222');
  });

  test('reject an impossible year instead of printing a strange reference', () => {
    expect(() => generateCertificateReference({ year: 26 })).toThrow(/four-digit year/i);
    expect(() => generateCertificateReference({ year: 20260 })).toThrow(/four-digit year/i);
  });

  test('a typed reference is normalised before lookup', () => {
    expect(normalizeCertificateReference('SBMS-2026-K8M4-X7PQ-2RZ')).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(normalizeCertificateReference('  sbms-2026-k8m4-x7pq-2rz ')).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(normalizeCertificateReference('SBMS 2026 K8M4 X7PQ 2RZ')).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(normalizeCertificateReference('2026K8M4X7PQ2RZ')).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(normalizeCertificateReference('K8M4-X7PQ-2RZ')).toBeNull();
  });

  test('certificates issued before this format still resolve', () => {
    expect(normalizeCertificateReference('SBMS-CERT-2026-1A2B3C4D')).toBe('SBMS-CERT-2026-1A2B3C4D');
    expect(normalizeCertificateReference('sbms-cert-2026-1a2b3c4d')).toBe('SBMS-CERT-2026-1A2B3C4D');
  });

  test('values that cannot be a reference are refused rather than guessed at', () => {
    for (const value of [
      '',
      '   ',
      'SBMS-2026-K8M4-X7PQ-2R',
      'SBMS-2026-K8M4-X7PQ-2RZZ',
      'SBMS-2026-IIII-IIII-III',
      'SBMS-2026-0000-0000-000',
      'a'.repeat(64),
      'x'.repeat(41),
      null,
      undefined,
      12345,
      { reference: 'SBMS-2026-K8M4-X7PQ-2RZ' },
    ]) {
      expect(normalizeCertificateReference(value)).toBeNull();
    }
  });
});
