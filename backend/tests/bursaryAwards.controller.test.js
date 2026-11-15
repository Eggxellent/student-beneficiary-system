jest.mock('../src/config/db', () => ({ connect: jest.fn() }));
jest.mock('../src/services/auditLog', () => jest.fn());
jest.mock('../src/services/notifications', () => ({
  notifyAwardSubmitted: jest.fn(),
  notifyAwardDecision: jest.fn(),
  // certificateIssue requires this too; a partial mock would throw and hide the real assertion.
  notifyCertificateReady: jest.fn(),
}));

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

function setupDecisionClient({ duplicateRows = [], awardStatus = 'submitted', submittedBy = 'a0b1c2d3-0000-4000-8000-000000000000' } = {}) {
  const award = {
    id: awardId,
    student_id: studentId,
    status: awardStatus,
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

describe('bursary award proposals (isolated; no database)', () => {
  const approvedAward = {
    id: '1d1d1d1d-2222-4333-8444-555555555555',
    student_id: studentId,
    status: 'approved',
    requested_amount: 20000,
    approved_amount: 20000,
    submitted_by: 'a0b1c2d3-0000-4000-8000-000000000000',
    created_at: '2026-01-05T09:00:00.000Z',
  };

  function setupCreateClient({ existingAward = null, createdAt = new Date().toISOString() } = {}) {
    const created = {
      id: awardId,
      student_id: studentId,
      status: 'submitted',
      requested_amount: 25000,
      submitted_by: actorId,
      school_code: 'Nairobi School',
      created_at: createdAt,
    };
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/INSERT INTO bursary_awards/.test(sql)) return { rows: [created] };
        if (/FROM students/.test(sql)) return { rows: [{ id: studentId, full_name: 'Test Learner', school_code: 'Nairobi School' }] };
        if (/FROM bursary_awards/.test(sql)) return { rows: existingAward ? [existingAward] : [] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    return client;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks a second proposal when the student already has an approved award this year', async () => {
    const client = setupCreateClient({ existingAward: approvedAward });
    const res = makeResponse();

    await controller.create({ body: { student_id: studentId, requested_amount: 25000 }, user: { id: actorId } }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ANNUAL_AWARD_EXISTS');
    expect(res.body.message).toMatch(/one bursary per calendar year/i);
    expect(res.body.message).toMatch(String(new Date().getUTCFullYear()));
    expect(res.body.existing_award.id).toBe(approvedAward.id);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('blocks a second proposal while a proposal for the same year is pending', async () => {
    const pending = { ...approvedAward, status: 'submitted', approved_amount: null, created_at: '2026-02-01T08:00:00.000Z' };
    const client = setupCreateClient({ existingAward: pending });
    const res = makeResponse();

    await controller.create({ body: { student_id: studentId, requested_amount: 25000 }, user: { id: actorId } }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ANNUAL_AWARD_EXISTS');
    expect(res.body.message).toMatch(/awaiting a decision/i);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_awards/.test(sql))).toBe(false);
  });

  test('the old confirmation flag no longer bypasses the annual restriction', async () => {
    const client = setupCreateClient({ existingAward: approvedAward });
    const res = makeResponse();

    await controller.create({
      body: { student_id: studentId, requested_amount: 25000, confirm_duplicate_allocation: true },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ANNUAL_AWARD_EXISTS');
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_awards/.test(sql))).toBe(false);
  });

  test('creates the first proposal with no warning when the student has no allocation', async () => {
    const client = setupCreateClient();
    const res = makeResponse();

    await controller.create({ body: { student_id: studentId, requested_amount: 25000 }, user: { id: actorId } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(res.body.award.student_id).toBe(studentId);
    expect(logAudit).toHaveBeenCalledWith(actorId, 'AWARD_SUBMITTED', 'bursary_awards', awardId, {
      requested_amount: 25000,
      school_code: 'Nairobi School',
      award_year: new Date().getUTCFullYear(),
    }, client);
  });

  test('a concurrent proposal that loses the unique-index race is refused, not retried', async () => {
    const client = setupCreateClient();
    // The other request committed between this request's check and its INSERT.
    client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO bursary_awards/.test(sql)) {
        const error = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'bursary_awards_student_year_active_unique';
        throw error;
      }
      if (/FROM students/.test(sql)) return { rows: [{ id: studentId, full_name: 'Test Learner', school_code: 'Nairobi School' }] };
      if (/FROM bursary_awards/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const next = jest.fn();
    const res = makeResponse();

    await controller.create({ body: { student_id: studentId, requested_amount: 25000 }, user: { id: actorId } }, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ANNUAL_AWARD_EXISTS');
    expect(next).not.toHaveBeenCalled();
  });

  test('one accidental double click does not queue a twin proposal', async () => {
    // Same officer, same amount, seconds apart: the timestamp must be fresh for the guard to fire.
    const justProposed = {
      ...approvedAward,
      status: 'submitted',
      submitted_by: actorId,
      requested_amount: 25000,
      created_at: new Date().toISOString(),
    };
    const client = setupCreateClient({ existingAward: justProposed });
    const res = makeResponse();

    await controller.create({
      body: { student_id: studentId, requested_amount: 25000, confirm_duplicate_allocation: true },
      user: { id: actorId },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.already_submitted).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_awards/.test(sql))).toBe(false);
  });
});

describe('bursary award decisions (isolated; no database)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('approves a submitted award with no open duplicate flags and records the audit event', async () => {
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
    expect(res.body.message).toMatch(/invoice SBMS-2026-K8M4-X7PQ-2RZ/i);
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_certificates/.test(sql))).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      actorId, 'AWARD_CERTIFICATE_ISSUED', 'bursary_certificates', expect.any(String), expect.any(Object), client,
    );
  });

  test('rejects an award with a reason and records the audit event', async () => {
    const client = setupDecisionClient();
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

  test('blocks approval while a duplicate review case is open', async () => {
    const client = setupDecisionClient({
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

  test('route guards allow field officers to submit but reserve decisions for admins', () => {
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

describe('award error reports, corrections and voids (isolated; no database)', () => {
  const approvedAward = {
    id: awardId,
    student_id: studentId,
    status: 'approved',
    requested_amount: '20000.00',
    approved_amount: '20000.00',
    school_code: 'Nairobi School',
    award_year: 2026,
    submitted_by: actorId,
  };

  function setupReviewClient({ award = approvedAward, openReport = [{ id: 'report-1', reason: 'Wrong amount was entered' }], payments = [], updated } = {}) {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (/SELECT \* FROM bursary_awards/.test(sql)) return { rows: award ? [award] : [] };
        if (/FROM bursary_award_correction_events r/.test(sql)) return { rows: openReport };
        if (/INSERT INTO bursary_award_correction_events/.test(sql)) return { rows: [{ id: 'event-1' }] };
        if (/FROM disbursements/.test(sql)) return { rows: payments };
        if (/UPDATE bursary_awards/.test(sql)) return { rows: [updated || award] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    return client;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a field officer reports an error without changing the award or freeing the year', async () => {
    const client = setupReviewClient({ openReport: [] });
    const res = makeResponse();

    await controller.reportError({
      params: { id: awardId },
      body: { reason: 'The approved amount was typed with an extra zero' },
      user: { id: actorId, role: 'field_officer' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(client.query.mock.calls.some(([sql]) => /UPDATE bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(
      actorId, 'AWARD_ERROR_REPORTED', 'bursary_awards', awardId, expect.objectContaining({ award_year: 2026 }), client,
    );
  });

  test('a second report cannot be filed while one is open', async () => {
    setupReviewClient();
    const res = makeResponse();

    await controller.reportError({
      params: { id: awardId },
      body: { reason: 'Still the same wrong amount' },
      user: { id: actorId, role: 'field_officer' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/already has an error report/i);
  });

  test('an officer cannot report an award they did not propose', async () => {
    setupReviewClient({ openReport: [] });
    const res = makeResponse();

    await controller.reportError({
      params: { id: awardId },
      body: { reason: 'Wrong amount on the invoice' },
      user: { id: 'different-officer', role: 'field_officer' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('an administrator corrects the amount and the corrected award still occupies the year', async () => {
    const corrected = { ...approvedAward, approved_amount: '25000.00' };
    const client = setupReviewClient({ updated: corrected });
    const res = makeResponse();

    await controller.correct({
      params: { id: awardId },
      body: { approved_amount: 25000, reason: 'The approved amount was entered incorrectly' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.changes.approved_amount).toEqual({ from: 20000, to: 25000 });
    expect(res.body.message).toMatch(/still counts as the student's bursary for 2026/i);
    expect(res.body.award.status).toBe('approved');
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(
      actorId, 'AWARD_CORRECTED', 'bursary_awards', awardId,
      expect.objectContaining({ changes: { approved_amount: { from: 20000, to: 25000 } } }), client,
    );
  });

  test('a correction without an open report is refused', async () => {
    setupReviewClient({ openReport: [] });
    const res = makeResponse();

    await controller.correct({
      params: { id: awardId },
      body: { approved_amount: 25000, reason: 'Changing the amount' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/no error report/i);
  });

  test('a correction that changes nothing is refused', async () => {
    setupReviewClient();
    const res = makeResponse();

    await controller.correct({
      params: { id: awardId },
      body: { approved_amount: 20000, reason: 'Re-entered the same amount' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('an administrator voids an award with a mandatory reason and the record is kept', async () => {
    const voided = { ...approvedAward, status: 'voided', void_reason: 'Awarded to the wrong student' };
    const client = setupReviewClient({ updated: voided });
    const res = makeResponse();

    await controller.voidAward({
      params: { id: awardId },
      body: { reason: 'Awarded to the wrong student' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/considered for another bursary in 2026/i);
    const update = client.query.mock.calls.find(([sql]) => /UPDATE bursary_awards/.test(sql));
    expect(update[0]).toMatch(/status = 'voided'/);
    expect(client.query.mock.calls.some(([sql]) => /DELETE FROM bursary_awards/.test(sql))).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(
      actorId, 'AWARD_VOIDED', 'bursary_awards', awardId, expect.objectContaining({ reason: 'Awarded to the wrong student' }), client,
    );
  });

  test('voiding requires a reason', async () => {
    setupReviewClient();
    const res = makeResponse();

    await controller.voidAward({
      params: { id: awardId },
      body: { reason: 'oops' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('an award with recorded payments cannot be voided', async () => {
    setupReviewClient({ payments: [{ '?column?': 1 }] });
    const res = makeResponse();

    await controller.voidAward({
      params: { id: awardId },
      body: { reason: 'Wrong student was awarded' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/payments recorded against this award/i);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('an already voided award cannot be voided again', async () => {
    setupReviewClient({ award: { ...approvedAward, status: 'voided' } });
    const res = makeResponse();

    await controller.voidAward({
      params: { id: awardId },
      body: { reason: 'Void it twice' },
      user: { id: actorId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/already closed/i);
  });

  test('route guards reserve reporting for field officers and correction/void for admins', () => {
    const guardFor = (method, path) => routes.stack
      .find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
    const reportGuard = guardFor('post', '/:id/error-report');
    const correctionGuard = guardFor('patch', '/:id/correction');
    const voidGuard = guardFor('post', '/:id/void');
    const next = jest.fn();

    const officerReport = makeResponse();
    reportGuard({ user: { role: 'field_officer' } }, officerReport, next);
    const officerCorrection = makeResponse();
    correctionGuard({ user: { role: 'field_officer' } }, officerCorrection, next);
    const officerVoid = makeResponse();
    voidGuard({ user: { role: 'field_officer' } }, officerVoid, next);
    const adminVoid = makeResponse();
    voidGuard({ user: { role: 'admin' } }, adminVoid, next);
    const adminReport = makeResponse();
    reportGuard({ user: { role: 'admin' } }, adminReport, next);

    expect(officerReport.statusCode).toBe(200);
    expect(officerCorrection.statusCode).toBe(403);
    expect(officerVoid.statusCode).toBe(403);
    expect(adminVoid.statusCode).toBe(200);
    // Reporting is the field officer's action; an administrator resolves the report instead.
    expect(adminReport.statusCode).toBe(403);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
