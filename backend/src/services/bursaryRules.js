const paymentTransitions = Object.freeze({
  issued: new Set(['cleared', 'failed', 'cancelled']),
});

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function canTransitionPayment(currentStatus, nextStatus) {
  if (currentStatus == null) return ['cleared', 'failed', 'cancelled'].includes(nextStatus);
  return paymentTransitions[currentStatus]?.has(nextStatus) || false;
}

function receiptStatus(paymentAmount, acknowledgedAmount) {
  const paymentCents = cents(paymentAmount);
  const receivedCents = cents(acknowledgedAmount);
  if (paymentCents === null || receivedCents === null || paymentCents < 0 || receivedCents < 0) {
    throw new TypeError('Payment amounts must be valid non-negative numbers');
  }
  return paymentCents === receivedCents ? 'acknowledged' : 'discrepancy';
}

function overdueByDays(paymentDate, deadlineDays, today = new Date()) {
  if (!Number.isInteger(deadlineDays) || deadlineDays < 1 || !paymentDate) return false;
  const issued = new Date(`${String(paymentDate).slice(0, 10)}T00:00:00Z`);
  const current = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(issued.getTime())) return false;
  return Math.floor((current - issued) / 86400000) > deadlineDays;
}

function exceptionReasons(payment, deadlineDays, today = new Date()) {
  const reasons = [];
  if (!payment.award_id) reasons.push('Legacy payment without an award link');
  if (payment.payment_status == null) reasons.push('Payment status unverified');
  if (payment.award_id && payment.award_verification_status !== 'verified') reasons.push('Beneficiary verification incomplete');
  if (payment.award_id && cents(payment.award_paid_total) > cents(payment.award_approved_amount)) reasons.push('Disbursed amount exceeds approved award');
  if (payment.award_id && payment.award_status === 'approved' && cents(payment.award_approved_amount) > cents(payment.award_paid_total)) {
    if (cents(payment.award_paid_total) > 0) reasons.push('Partial payment');
    else reasons.push('No payment recorded');
  }
  if (payment.payment_status === 'issued') reasons.push('Awaiting clearance');
  if (payment.payment_status === 'failed') reasons.push('Payment failed');
  if (payment.payment_status === 'cancelled') reasons.push('Payment cancelled');
  if (payment.receipt_status === 'awaiting_acknowledgement') {
    reasons.push('Awaiting receipt acknowledgement');
    if (overdueByDays(payment.disbursement_date, deadlineDays, today)) reasons.push('Acknowledgement overdue');
  }
  if (payment.receipt_status === 'discrepancy') reasons.push('Amount discrepancy');
  if (payment.award_id && payment.receipt_status == null) reasons.push('Receipt acknowledgement missing');
  return reasons;
}

module.exports = { canTransitionPayment, cents, exceptionReasons, overdueByDays, receiptStatus };
