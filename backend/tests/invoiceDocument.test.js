const zlib = require('zlib');
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
    ]);

    expect(content.lineItems).toEqual([{
      description: 'Bursary award, 2025/2026',
      amount: '45,000.00',
    }]);
    expect(content.total).toEqual({ label: 'Total approved', value: 'KSh 45,000.00' });

    expect(content.status.label).toBe('APPROVED');
    expect(content.dates.approved).toBe('11 Feb 2026');
  });

  test('states each fact once, so nothing on the page competes with itself', () => {
    const content = invoiceContent({ certificate, identity, manualVerificationUrl });
    const serialized = JSON.stringify(content);

    // The period lives on the line item only, not again as a beneficiary field.
    expect(serialized.match(/2025\/2026/g)).toHaveLength(1);
    // The number appears in the header block and beside the code, nowhere else.
    expect(serialized.match(new RegExp(content.invoiceNumber, 'g'))).toHaveLength(2);
    // The amount appears as the line amount and as the total, nowhere else.
    expect(serialized.match(/45,000\.00/g)).toHaveLength(2);
    // An invoice of one bursary award has nothing to put in a quantity column.
    expect(serialized).not.toMatch(/"quantity"/);
  });

  test('says once, in one line, that approval is not payment', () => {
    const content = invoiceContent({ certificate, identity, manualVerificationUrl });
    const printed = [
      content.notes.join(' '),
      content.verification.instructions,
      content.footnote,
    ].join(' ');

    expect(content.notes[0]).toBe('Approval is not payment.');
    // One statement, not four: the paper is a decision record, and the live page carries tracking.
    expect(printed.match(/not payment/gi)).toHaveLength(1);
    expect(content.verification.instructions).toMatch(/any payment recorded/i);
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
    expect(content.lineItems[0].description).toBe('Bursary award');
    expect(content.organisation.constituency).toBeNull();
    expect(content.signatory).toBeNull();
    expect(content.organisation.programmeHeading).toBe('NG-CDF BURSARY PROGRAMME');
  });
});

// The header prints on a fixed grid, so two lines only stay readable if they keep separate
// baselines. Reading the drawn baselines back out of the compressed content stream is the only way
// to prove that from the bytes a caller actually receives.
function drawnText(pdf) {
  const content = [];
  for (const part of pdf.toString('latin1').split('endstream')) {
    const marker = part.lastIndexOf('stream');
    if (marker === -1) continue;
    try {
      const body = part.slice(marker + 6).replace(/^\r?\n/, '');
      content.push(zlib.inflateSync(Buffer.from(body, 'latin1'), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1'));
    } catch {
      // Image streams carry no text.
    }
  }

  const runs = [];
  for (const block of content.join('\n').match(/BT[\s\S]*?ET/g) || []) {
    const position = block.match(/([\d.-]+) ([\d.-]+) Tm/);
    if (!position) continue;
    const text = (block.match(/<([0-9A-Fa-f\s]+)>/g) || [])
      .map((hex) => Buffer.from(hex.slice(1, -1).replace(/\s+/g, ''), 'hex').toString('latin1'))
      .join('');
    if (text.trim()) runs.push({ y: Number(position[2]), text });
  }
  return runs;
}

function baselinesOf(pdf, match) {
  const found = drawnText(pdf).filter((run) => match(run.text));
  return [...new Set(found.map((run) => run.y))];
}

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

  test('keeps each header line on its own baseline, even with a long programme line', async () => {
    // The reported defect: the organisation name and the document title wrapped onto a second line
    // that printed straight over the programme line and the subtitle. Each header line now holds to
    // a single baseline, shrinking to fit rather than wrapping.
    const pdf = await render({
      identity: {
        programme: 'Kenya CDF bursary programme',
        constituency: 'Student beneficiary records | Bursary award approvals',
      },
    });

    const organisation = baselinesOf(pdf, (text) => text === 'STUDENT BENEFICIARY MANAGEMENT SYSTEM');
    const programme = baselinesOf(pdf, (text) => text.startsWith('Kenya CDF bursary programme'));
    const title = baselinesOf(pdf, (text) => text === 'BURSARY APPROVAL INVOICE');
    const subtitle = baselinesOf(pdf, (text) => text.startsWith('Official record of an approved bursary award'));

    expect(organisation).toHaveLength(1);
    expect(programme).toHaveLength(1);
    expect(title).toHaveLength(1);
    expect(subtitle).toHaveLength(1);

    // A programme line that no longer fits is clipped, never wrapped on top of its neighbour.
    expect(organisation[0] - programme[0]).toBeGreaterThan(10);
    expect(title[0] - subtitle[0]).toBeGreaterThan(15);
  });
});
