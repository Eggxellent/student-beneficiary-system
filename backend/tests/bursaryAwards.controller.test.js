jest.mock('../src/config/db', () => ({ connect: jest.fn() }));
jest.mock('../src/services/auditLog', () => jest.fn());

const pool = require('../src/config/db');
const logAudit = require('../src/services/auditLog');
const controller = require('../src/controllers/bursaryAwards.controller');
const routes = require('../src/routes/bursaryAwards.routes');

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

function setupDecisionClient({ verificationStatus = 'verified', duplicateRows = [], awardStatus = 'submitted', submittedBy = 'a0b1c2d3-0000-4000-8000-000000000000' } = {}) {
  const award = {
    id: awardId,
    student_id: studentId,
    status: awardStatus,
    verification_status: verificationStatus,
    submitted_by: submittedBy,
  };
  const certificate = {
    id: '0b0b0b0b-1111-4222-8333-444444444444',
    certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ',
  };
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/SELECT \* FROM bursary_awards/.test(sql)) return { rows: [award] };
      if (/FROM duplicate_flags/.test(sql)) return { rows: duplicateRows };
      if (/FROM students/.test(sql)) return { rows: [{ full_name: 'Test Learner', upi: 'TEST-UPI', school_code: 'Nairobi School' }] };
      if (/INSERT INTO bursary_certificates/.test(sql)) return { rows: [certificate] };
      if (/UPDATE bursary_awards/.test(sql)) return { rows: [{ ...award, status: 'approved', approved_amount: 25000, decided_by: actorId }] };
      return { rows: [] };
    }),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

describe('bursary award decisions (isolated; no database)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('approves a verified award with no open duplicate flags and records the audit event', async () => {
    const client = setupDecisionClient();
    const res = makeResponse();

    await controller.decide({
      params: { id: awardId },
      body: { decision: 'approved', approved_amount: 25000, reason: 'Verified and eligible' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.award.status).toBe('approved');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    expect(logAudit).toHaveBeenCalledWith(actorId, 'AWARD_APPROVED', 'bursary_awards', awardId, expect.any(Object), client);
    // Approval writes the certificate in the same transaction; no separate issue step is required.
    expect(res.body.certificate_reference).toBe('SBMS-2026-K8M4-X7PQ-2RZ');
    expect(res.body.message).toMatch(/certificate SBMS-2026-K8M4-X7PQ-2RZ/i);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_certificates/.test(sql))).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      actorId, 'AWARD_CERTIFICATE_ISSUED', 'bursary_certificates', expect.any(String), expect.any(Object), client,
    );
  });

  test('rejects an award with a reason and records the audit event without requiring verification', async () => {
    const client = setupDecisionClient({ verificationStatus: 'not_found' });
    const res = makeResponse();

    await controller.decide({
      params: { id: awardId },
      body: { decision: 'rejected', reason: 'Required records were not found' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'AWARD_REJECTED', 'bursary_awards', awardId, expect.any(Object), expect.any(Object));
    // No certificate is generated for a rejected award.
    expect(res.body.certificate_reference).toBeNull();
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_certificates/.test(sql))).toBe(false);
  });

  test('blocks approval before verification or duplicate review is resolved', async () => {
    const client = setupDecisionClient({
      verificationStatus: 'verified',
      duplicateRows: [{ id: 'open-duplicate-flag' }],
    });
    const res = makeResponse();

    await controller.decide({
      params: { id: awardId },
      body: { decision: 'approved', approved_amount: 25000, reason: 'Verified and eligible' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(client.query.mock.calls.some(([sql]) => /UPDATE bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('blocks an officer from approving the award they proposed', async () => {
    const client = setupDecisionClient({ submittedBy: actorId });
    const res = makeResponse();

    await controller.decide({
      params: { id: awardId },
      body: { decision: 'approved', approved_amount: 25000, reason: 'Verified and eligible' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/cannot approve it/i);
    expect(client.query.mock.calls.some(([sql]) => /UPDATE bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('rejects malformed decision data before opening a transaction', async () => {
    const res = makeResponse();

    await controller.decide({ params: { id: awardId }, body: { decision: 'approved' }, user: { id: actorId } }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('route guards allow field officers to submit and verify but reserve decisions for admins', () => {
    const decisionRoute = routes.stack.find((layer) => layer.route?.path === '/:id/decision').route;
    const submissionRoute = routes.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.post).route;
    const decisionGuard = decisionRoute.stack[0].handle;
    const submissionGuard = submissionRoute.stack[0].handle;
    const forbidden = makeResponse();
    const allowed = makeResponse();
    const next = jest.fn();

    decisionGuard({ user: { role: 'field_officer' } }, forbidden, next);
    submissionGuard({ user: { role: 'field_officer' } }, allowed, next);

    expect(forbidden.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
