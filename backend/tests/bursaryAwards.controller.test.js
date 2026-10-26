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

function setupDecisionClient({ verificationStatus = 'verified', duplicateRows = [], awardStatus = 'submitted' } = {}) {
  const award = {
    id: awardId,
    student_id: studentId,
    status: awardStatus,
    verification_status: verificationStatus,
  };
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/SELECT \* FROM bursary_awards/.test(sql)) return { rows: [award] };
      if (/FROM duplicate_flags/.test(sql)) return { rows: duplicateRows };
      if (/UPDATE bursary_awards/.test(sql)) return { rows: [{ ...award, status: 'approved' }] };
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
  });

  test('rejects an award with a reason and records the audit event without requiring verification', async () => {
    setupDecisionClient({ verificationStatus: 'not_found' });
    const res = makeResponse();

    await controller.decide({
      params: { id: awardId },
      body: { decision: 'rejected', reason: 'Required records were not found' },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'AWARD_REJECTED', 'bursary_awards', awardId, expect.any(Object), expect.any(Object));
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
