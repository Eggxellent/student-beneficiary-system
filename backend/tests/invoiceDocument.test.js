const { invoiceContent, renderInvoicePdf } = require('../src/services/invoiceDocument');

// Rendering inside jest is slow: the QR encoder works pixel by pixel, and jest's module sandbox
// makes that far slower than the API process. The timeouts below cover the sandbox, not production.
jest.setTimeout(120000);

// The invoice has two halves that can be tested without a database: the strings it decides to print
// (content) and the bytes it produces (PDF). Both matter for a document that is handed to a student
// or a school and later compared against the verification page.
const certificate = {
  certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ',
  student_name: 'Amina Wanjiku Njeri',
  student_upi: 'CERT-UPI-987654',
  school_code: 'Alliance High',
  award_period: '2025/2026',
  approved_amount: '45000.00',
  award_approved_at: '2026-02-11T09:00:00Z',
  issued_at: '2026-02-12T10:00:00Z',
  award_status: 'approved',
  award_live_amount: '45000.00',
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
  return renderInvoicePdf({
    certificate,
    verificationUrl,
    manualVerificationUrl,
    identity,
    ...overrides,
  });
}

describe('Invoice content', () => {
  test('prints the beneficiary record, the invoice number and the approved amount', () => {
    const content = invoiceContent({ certificate, identity, manualVerificationUrl });

    expect(content.title).toBe('BURSARY APPROVAL INVOICE');
    expect(content.invoiceNumber).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(content.beneficiaryName).toBe('Amina Wanjiku Njeri');
    expect(content.beneficiary).toEqual([
      { label: 'UPI / student no.', value: 'CERT-UPI-987654' },
      { label: 'Institution', value: 'Alliance High' },
      { label: 'Academic year', value: '2025/2026' },
      { label: 'Constituency', value: 'Kamukunji' },
    ]);

    expect(content.lineItems).toEqual([{
      description: 'Approved bursary award for the 2025/2026 academic year',
      quantity: '1',
      amount: '45,000.00',
    }]);
    expect(content.totals).toEqual([
      { label: 'Approved bursary amount', value: 'KSh 45,000.00', emphasis: false },
      { label: 'Amount transferred to date', value: 'KSh 0.00', emphasis: false },
      { label: 'Balance payable under this invoice', value: 'KSh 45,000.00', emphasis: true },
    ]);

    expect(content.status.label).toBe('APPROVED');
    expect(content.dates.approved).toBe('11 Feb 2026');
    expect(content.paymentTerms.status).toBe('Not paid');
  });

  test('states plainly that approval is not payment', () => {
    const content = invoiceContent({ certificate, identity, manualVerificationUrl });

    expect(content.paymentTerms.lines.join(' ')).toMatch(/approval is not payment/i);
    expect(content.paymentTerms.lines.join(' ')).toMatch(/no transfer, disbursement or receipt/i);
    expect(content.notes.join(' ')).toMatch(/neither this document nor the verification page confirms/i);
    expect(content.verification.instructions).toMatch(/never reports a payment/i);
  });

  test('marks a superseded approval instead of restating it as current', () => {
    const rejected = invoiceContent({ certificate: { ...certificate, award_status: 'rejected' }, identity });
    const revalued = invoiceContent({ certificate: { ...certificate, award_live_amount: '30000.00' }, identity });

    expect(rejected.status.label).toBe('SUPERSEDED');
    expect(revalued.status.label).toBe('SUPERSEDED');
  });

  test('never prints the verification token or unrelated identifiers', () => {
    const serialized = JSON.stringify(invoiceContent({ certificate, identity, manualVerificationUrl }));

    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toMatch(/national_id|guardian|phone|allocation/i);
  });

  test('omits facts the record does not hold instead of printing a placeholder', () => {
    const content = invoiceContent({
      certificate: { ...certificate, student_upi: '', school_code: '', award_period: '' },
      identity: { programme: 'NG-CDF bursary programme' },
      manualVerificationUrl,
    });

    expect(content.beneficiary).toEqual([]);
    expect(content.lineItems[0].description).toBe('Approved bursary award');
    expect(content.organisation.constituency).toBeNull();
    expect(content.signatory).toBeNull();
    expect(content.organisation.programmeHeading).toBe('NG-CDF BURSARY PROGRAMME');
  });
});

describe('Invoice PDF', () => {
  test('is a single A4 portrait page with the QR code embedded as an image', async () => {
    const pdf = await render();
    const raw = pdf.toString('latin1');

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(15000);
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);

    // One page only: an invoice that spills onto a second sheet cannot be filed as one document.
    expect((raw.match(/\/Type \/Page[^s]/g) || [])).toHaveLength(1);
    expect(raw).toContain('MediaBox [0 0 595.28 841.89]');

    // The QR is 560 px wide inside an ~86 pt square, and it is embedded bytes rather than a link to
    // an image host, so a printed invoice never depends on a reachable URL at print time.
    expect(raw).toMatch(/\/Subtype \/Image/);
    expect(raw).toMatch(/\/Width 560/);
    expect(raw).not.toMatch(/\/URI/);
  });

  test('repeated downloads of the same issued invoice are byte-identical', async () => {
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
