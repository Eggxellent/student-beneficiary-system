const { certificateContent, renderCertificatePdf } = require('../src/services/certificateDocument');

// Rendering inside jest is slow: the QR encoder works pixel by pixel, and jest's module sandbox
// makes that roughly forty times slower than the same call in the API process (where a certificate
// renders in a few hundred milliseconds). The timeouts below cover the sandbox, not production.
jest.setTimeout(120000);

// The certificate document has two halves that can be tested without a database: the strings it
// decides to print (content), and the bytes it produces (PDF). Both matter for a document that is
// handed to a student and later compared against the verification page.
const certificate = {
  certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ',
  student_name: 'Amina Wanjiku Njeri',
  student_upi: 'CERT-UPI-987654',
  school_code: 'Alliance High',
  award_period: '2025/2026',
  approved_amount: '45000.00',
  award_approved_at: '2026-02-11T09:00:00Z',
  issued_at: '2026-02-12T10:00:00Z',
  national_id_number: '12345678',
};

const identity = {
  programme: 'NG-CDF bursary programme',
  constituency: 'Kamukunji',
  signatory: { name: 'J. K. Mwangi', designation: 'Constituency Bursary Officer' },
  issuingAuthority: 'Student Beneficiary Management System (SBMS)',
};

const verificationUrl = `https://sbms-web.azurewebsites.net/verify-certificate#token=${'a'.repeat(64)}`;
const manualVerificationUrl = 'https://sbms-web.azurewebsites.net/verify-certificate';

function render(overrides = {}) {
  return renderCertificatePdf({
    certificate,
    verificationUrl,
    manualVerificationUrl,
    identity,
    ...overrides,
  });
}

describe('Certificate content', () => {
  test('prints the approved facts and the reference, and nothing invented', () => {
    const content = certificateContent({ certificate, identity, manualVerificationUrl });

    expect(content.heading).toBe('CERTIFICATE');
    expect(content.subheading).toBe('OF BURSARY AWARD');
    expect(content.preamble).toBe('This is to certify that');
    expect(content.beneficiaryName).toBe('Amina Wanjiku Njeri');
    expect(content.reference).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(content.statement).toContain('has been recognised as an approved beneficiary');
    expect(content.statement).toContain('NG-CDF bursary programme');
    expect(content.statement).toContain('Student Beneficiary Management System');

    expect(content.facts).toEqual([
      { label: 'Institution', value: 'Alliance High' },
      { label: 'Academic year', value: '2025/2026' },
      { label: 'Approved bursary award', value: 'KSh 45,000.00' },
      { label: 'Constituency', value: 'Kamukunji' },
      { label: 'Date of issue', value: '12 February 2026' },
      { label: 'Award approved', value: '11 February 2026' },
    ]);
  });

  test('never prints beneficiary identifiers or other sensitive fields', () => {
    const serialized = JSON.stringify(certificateContent({ certificate, identity, manualVerificationUrl }));

    for (const secret of [certificate.student_upi, certificate.national_id_number, 'a'.repeat(64)]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/upi|national|birth|guardian|phone|token/i);
  });

  test('omits facts that the record does not hold instead of printing a placeholder', () => {
    const content = certificateContent({
      certificate: { ...certificate, school_code: '', award_period: '' },
      identity: { programme: 'NG-CDF bursary programme' },
      manualVerificationUrl,
    });

    expect(content.facts.map((fact) => fact.label)).toEqual([
      'Approved bursary award', 'Date of issue', 'Award approved',
    ]);
  });

  test('an unconfigured deployment gets no constituency and no signatory', () => {
    const content = certificateContent({
      certificate,
      identity: { programme: 'NG-CDF bursary programme' },
      manualVerificationUrl,
    });

    expect(content.constituency).toBeNull();
    expect(content.signatory).toBeNull();
    expect(content.programmeHeading).toBe('NG-CDF BURSARY PROGRAMME');
  });
});

describe('Certificate PDF', () => {
  test('is a single A4 landscape page with the QR code embedded as an image', async () => {
    const pdf = await render();
    const raw = pdf.toString('latin1');

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(15000);
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);

    // One page only: a certificate that spills onto a second sheet is not a certificate.
    expect((raw.match(/\/Type \/Page[^s]/g) || [])).toHaveLength(1);
    expect(raw).toContain('MediaBox [0 0 841.89 595.28]');

    // The QR code is 560 px wide inside an 84 pt square, so it stays sharp when printed, and it is
    // embedded bytes rather than a link to an image host.
    expect(raw).toMatch(/\/Subtype \/Image/);
    expect(raw).toMatch(/\/Width 560/);
    expect(raw).not.toMatch(/\/URI/);
  });

  test('repeated downloads of the same issued certificate are byte-identical', async () => {
    // Rendered one after the other: determinism is the property under test, and jest's environment
    // does not settle two pdfkit output streams started in the same tick.
    const first = await render();
    const second = await render();
    expect(first.equals(second)).toBe(true);
  });

  test('renders without a configured constituency or signatory', async () => {
    const pdf = await render({ identity: { programme: 'NG-CDF bursary programme' } });
    const raw = pdf.toString('latin1');

    expect((raw.match(/\/Type \/Page[^s]/g) || [])).toHaveLength(1);
    expect(pdf.length).toBeGreaterThan(15000);
  });

  test('a long beneficiary name still fits on one page', async () => {
    const pdf = await render({
      certificate: {
        ...certificate,
        student_name: 'Amina Wanjiku Njeri Wambui Akinyi Chebet Kiptoo Njoroge Ochieng',
      },
    });
    const raw = pdf.toString('latin1');

    expect((raw.match(/\/Type \/Page[^s]/g) || [])).toHaveLength(1);
  });
});

