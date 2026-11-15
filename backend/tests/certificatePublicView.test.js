const { publicView } = require('../src/controllers/certificates.controller');

// `/api/certificates/verify` answers from `publicView`, so the shape asserted here is the contract the
// invoice QR reader sees. The paper records the approval; the page adds what SBMS has actually
// recorded against the same award, and it must never invent a payment that is not in the table.
const row = {
  certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ',
  student_name: 'Amina Wanjiku Njeri',
  school_code: 'Alliance High',
  award_period: '2025/2026',
  approved_amount: '45000.00',
  award_live_amount: '45000.00',
  award_status: 'approved',
  award_approved_at: '2026-02-11T09:00:00Z',
  issued_at: '2026-02-12T10:00:00Z',
  payment_count: 0,
  recorded_amount: '0',
  cleared_amount: '0',
  last_payment_date: null,
};

describe('Public certificate view: payment tracking', () => {
  test('an award with no recorded payment says so without predicting one', () => {
    const view = publicView(row);

    expect(view.valid).toBe(true);
    expect(view.payments).toEqual({
      status: 'no_payment',
      recorded_count: 0,
      total_recorded: 0,
      total_cleared: 0,
      outstanding: 45000,
      last_payment_date: null,
    });
  });

  test('a payment recorded but not cleared is pending, not paid', () => {
    const view = publicView({
      ...row,
      payment_count: 1,
      recorded_amount: '45000',
      cleared_amount: '0',
      last_payment_date: '2026-03-02',
    });

    expect(view.payments.status).toBe('pending_clearance');
    expect(view.payments.total_recorded).toBe(45000);
    expect(view.payments.total_cleared).toBe(0);
    expect(view.payments.outstanding).toBe(0);
    expect(view.payments.last_payment_date).toBe('2026-03-02T00:00:00.000Z');
  });

  test('a partly cleared award reports both figures', () => {
    const view = publicView({
      ...row,
      payment_count: 2,
      recorded_amount: '30000',
      cleared_amount: '20000',
      last_payment_date: '2026-03-05',
    });

    expect(view.payments.status).toBe('partly_cleared');
    expect(view.payments.total_cleared).toBe(20000);
    expect(view.payments.outstanding).toBe(15000);
  });

  test('a fully cleared award reports cleared', () => {
    const view = publicView({ ...row, payment_count: 1, recorded_amount: '45000', cleared_amount: '45000' });

    expect(view.payments.status).toBe('cleared');
    expect(view.payments.outstanding).toBe(0);
  });

  test('a superseded approval exposes the reference only, payment tracking included', () => {
    const view = publicView({ ...row, award_live_amount: '30000.00', payment_count: 1, cleared_amount: '45000' });

    expect(view).toEqual({
      valid: false,
      status: 'not_current',
      certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ',
      issuing_authority: expect.any(String),
    });
  });
});
