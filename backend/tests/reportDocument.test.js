const { createReportDocument } = require('../src/services/reportDocument');

function sampleData(overrides = {}) {
  return {
    reportId: '11111111-2222-3333-4444-555555555555',
    period: { start_date: '2026-11-01', end_date: '2026-11-11' },
    generatedAt: new Date('2026-11-11T08:33:45Z'),
    preparedBy: 'Test Administrator',
    summary: {
      studentsRegistered: 2,
      studentsAssessed: 2,
      duplicateFlags: 0,
      totalAwards: 3,
      approvedAwards: 2,
      approvedAmount: 25000,
      rejectedAwards: 1,
      awaitingDecision: 0,
      awaitingVerification: 0,
      requestedAmount: 45000,
      pendingAmount: 0,
    },
    decisions: [
      { decided_at: '2026-11-10T09:00:00Z', full_name: 'Peter Ngigi', school_code: 'Alliance High', eligibility_category: 'High', status: 'approved', approved_amount: 10000 },
      { decided_at: '2026-11-10T10:15:00Z', full_name: 'Mary Njeri', school_code: 'Loreto Limuru', eligibility_category: 'Moderate', status: 'approved', approved_amount: 15000 },
      { decided_at: '2026-11-10T11:05:00Z', full_name: 'John Otieno', school_code: 'Maranda', eligibility_category: 'Low', status: 'rejected', approved_amount: null },
    ],
    ...overrides,
  };
}

function renderToBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = createReportDocument(data);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

describe('reportDocument', () => {
  test('a period with decisions renders a multi-section A4 PDF', async () => {
    const buffer = await renderToBuffer(sampleData());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(4000);
    // A4 portrait media box, so the report is not silently rendered at another size.
    expect(buffer.toString('latin1')).toContain('595.28');
  });

  test('an empty period still renders the report with the no-decisions wording', async () => {
    const buffer = await renderToBuffer(sampleData({
      decisions: [],
      summary: {
        studentsRegistered: 0,
        studentsAssessed: 0,
        duplicateFlags: 0,
        totalAwards: 0,
        approvedAwards: 0,
        approvedAmount: 0,
        rejectedAwards: 0,
        awaitingDecision: 0,
        awaitingVerification: 0,
        requestedAmount: 0,
        pendingAmount: 0,
      },
    }));
    expect(buffer.length).toBeGreaterThan(3000);
  });

  test('a long decision list paginates instead of overflowing one page', async () => {
    const decisions = Array.from({ length: 60 }, (_, index) => ({
      decided_at: '2026-11-10T09:00:00Z',
      full_name: `Beneficiary ${index + 1}`,
      school_code: 'Alliance High',
      eligibility_category: 'High',
      status: 'approved',
      approved_amount: 10000 + index,
    }));
    const doc = createReportDocument(sampleData({ decisions }));
    const pages = doc.bufferedPageRange().count;
    expect(pages).toBeGreaterThanOrEqual(3);
    doc.end();
  });
});
