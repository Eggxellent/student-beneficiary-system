jest.mock('../src/config/db', () => ({ connect: jest.fn() }));
jest.mock('../src/services/auditLog', () => jest.fn());
jest.mock('../src/models/disbursement.model', () => ({ create: jest.fn() }));

const pool = require('../src/config/db');
const logAudit = require('../src/services/auditLog');
const Disbursement = require('../src/models/disbursement.model');
const controller = require('../src/controllers/disbursements.controller');

const paymentId = '6a0fe2c5-9c03-4f80-babd-751e82c705a3';
const awardId = 'a8fb65d1-4ff7-4cf0-b585-63991a4f409a';
const studentId = '5f458334-2c75-4d06-86dd-9eb7c47bbfab';
const actorId = 'ce05b86e-f645-4ed9-8772-a954a77f1664';

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function setupClient(handler) {
  const client = { query: jest.fn(handler), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  return client;
}

describe('payment reconciliation controllers (isolated; no database)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records split payments only within the approved balance and audits issuance', async () => {
    const award = { id: awardId, student_id: studentId, status: 'approved', verification_status: 'verified', approved_amount: '1000.00' };
    const client = setupClient(async (sql) => {
      if (/SELECT \* FROM bursary_awards/.test(sql)) return { rows: [award] };
      if (/FROM duplicate_flags/.test(sql)) return { rows: [] };
      if (/SUM\(amount\)/.test(sql)) return { rows: [{ total: '600.00' }] };
      return { rows: [] };
    });
    Disbursement.create.mockResolvedValue({ id: paymentId, amount: '400.00', payment_status: 'issued' });
    const res = makeResponse();

    await controller.create({
      body: { award_id: awardId, amount: 400, payment_method: 'Cheque', disbursement_date: '2026-10-23' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(res.body.disbursement.payment_status).toBe('issued');
    expect(Disbursement.create).toHaveBeenCalledWith(expect.objectContaining({ award_id: awardId, amount: 400 }), client);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'PAYMENT_ISSUED', 'disbursements', paymentId, expect.any(Object), client);
  });

  test('requires evidence to clear an issued payment and appends an audit record', async () => {
    const payment = { id: paymentId, award_id: awardId, amount: '250.00', payment_status: 'issued', receipt_status: 'awaiting_acknowledgement' };
    const client = setupClient(async (sql) => {
      if (/SELECT \* FROM disbursements/.test(sql)) return { rows: [payment] };
      if (/UPDATE disbursements/.test(sql)) return { rows: [{ ...payment, payment_status: 'cleared' }] };
      return { rows: [] };
    });
    const res = makeResponse();

    await controller.updatePaymentStatus({
      params: { id: paymentId },
      body: { payment_status: 'cleared', evidence_ref: 'bank-statement-row-42' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO disbursement_reconciliation_events/.test(sql))).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'PAYMENT_CLEARED', 'disbursements', paymentId, expect.any(Object), client);
  });

  test('records an acknowledgement mismatch as a follow-up exception', async () => {
    const payment = { id: paymentId, award_id: awardId, amount: '250.00', payment_status: 'cleared', receipt_status: 'awaiting_acknowledgement' };
    const client = setupClient(async (sql) => {
      if (/SELECT \* FROM disbursements/.test(sql)) return { rows: [payment] };
      if (/UPDATE disbursements/.test(sql)) return { rows: [{ ...payment, receipt_status: 'discrepancy', acknowledged_amount: '200.00' }] };
      return { rows: [] };
    });
    const res = makeResponse();

    await controller.acknowledgeReceipt({
      params: { id: paymentId },
      body: { acknowledged_amount: 200, evidence_ref: 'school-ledger-page-8', notes: 'Amount is lower than issued' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.disbursement.receipt_status).toBe('discrepancy');
    expect(res.body.message).toMatch(/discrepancy recorded/i);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'RECEIPT_ACKNOWLEDGED_OFFICER_ASSISTED', 'disbursements', paymentId, expect.any(Object), client);
  });

  test('rejects clearing without evidence before opening a transaction', async () => {
    const res = makeResponse();

    await controller.updatePaymentStatus({ params: { id: paymentId }, body: { payment_status: 'cleared' }, user: { id: actorId } }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
