const { canTransitionPayment, exceptionReasons, overdueByDays, receiptStatus } = require('../src/services/bursaryRules');

describe('bursary reconciliation rules', () => {
  test('only issued payments can move to a final payment state', () => {
    expect(canTransitionPayment('issued', 'cleared')).toBe(true);
    expect(canTransitionPayment('issued', 'failed')).toBe(true);
    expect(canTransitionPayment('issued', 'cancelled')).toBe(true);
    expect(canTransitionPayment('cleared', 'issued')).toBe(false);
    expect(canTransitionPayment('failed', 'cleared')).toBe(false);
  });

  test('receipt acknowledgement distinguishes equal and discrepant amounts to cents', () => {
    expect(receiptStatus('1250.00', '1250')).toBe('acknowledged');
    expect(receiptStatus('1250.00', '1249.99')).toBe('discrepancy');
    expect(receiptStatus('100', '0')).toBe('discrepancy');
  });

  test('overdue classification uses the configured deadline and is disabled without one', () => {
    const today = new Date('2026-10-23T12:00:00Z');
    expect(overdueByDays('2026-10-01', 14, today)).toBe(true);
    expect(overdueByDays('2026-10-09', 14, today)).toBe(false);
    expect(overdueByDays('2026-10-01', null, today)).toBe(false);
  });

  test('exception reasons distinguish follow-up cases without labeling them as fraud', () => {
    expect(exceptionReasons({
      award_id: 'award-1',
      award_status: 'approved',
      award_verification_status: 'verified',
      award_approved_amount: '5000.00',
      award_paid_total: '2500.00',
      payment_status: 'issued',
      receipt_status: 'awaiting_acknowledgement',
      disbursement_date: '2026-10-01',
    }, 14, new Date('2026-10-23T12:00:00Z'))).toEqual([
      'Partial payment',
      'Awaiting clearance',
      'Awaiting receipt acknowledgement',
      'Acknowledgement overdue',
    ]);
  });
});
