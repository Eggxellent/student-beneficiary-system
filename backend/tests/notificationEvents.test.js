jest.mock('../src/config/db', () => ({ connect: jest.fn() }));
jest.mock('../src/services/auditLog', () => jest.fn());
jest.mock('../src/services/certificateIssue', () => ({ issueForApprovedAward: jest.fn() }));

const pool = require('../src/config/db');
const { issueForApprovedAward } = require('../src/services/certificateIssue');
const controller = require('../src/controllers/bursaryAwards.controller');

const awardId = 'a8fb65d1-4ff7-4cf0-b585-63991a4f409a';
const studentId = '5f458334-2c75-4d06-86dd-9eb7c47bbfab';
const adminId = 'ce05b86e-f645-4ed9-8772-a954a77f1664';
const officerId = 'a0b1c2d3-0000-4000-8000-000000000000';

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function notificationInserts(client) {
  return client.query.mock.calls.filter(([sql]) => /INSERT INTO notifications/.test(sql));
}

function setupClient({ award, decisionRows }) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/SELECT \* FROM bursary_awards/.test(sql)) return { rows: [award] };
      if (/SELECT id, full_name, school_code FROM students/.test(sql)) {
        return { rows: [{ id: studentId, full_name: 'Test Learner', school_code: 'Nairobi School' }] };
      }
      if (/SELECT full_name, upi, school_code FROM students/.test(sql)) {
        return { rows: [{ full_name: 'Test Learner', upi: 'TEST-UPI', school_code: 'Nairobi School' }] };
      }
      if (/INSERT INTO bursary_awards/.test(sql)) return { rows: [award] };
      if (/UPDATE bursary_awards/.test(sql)) return { rows: [decisionRows] };
      return { rows: [] };
    }),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

describe('notification-producing events (isolated; no database)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a field officer proposal notifies every active administrator once', async () => {
    const award = {
      id: awardId,
      student_id: studentId,
      school_code: 'Nairobi School',
      requested_amount: 15000,
      submitted_by: officerId,
      status: 'submitted',
    };
    const client = setupClient({ award });

    const res = makeResponse();
    await controller.create({ body: { student_id: studentId, requested_amount: 15000 }, user: { id: officerId, role: 'field_officer' } }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    const inserts = notificationInserts(client);
    expect(inserts).toHaveLength(1);
    const [sql, params] = inserts[0];
    expect(sql).toContain("WHERE u.role = 'admin' AND u.is_active = TRUE");
    expect(params).toEqual([
      'award_submitted',
      'Award proposal awaiting review',
      'Test Learner · KES 15,000 requested',
      '/awards',
      awardId,
      `award-submitted:${awardId}`,
    ]);
    // The officer who submitted is not also notified that they submitted.
    expect(params[0]).not.toBe(officerId);
  });

  test('an approved award notifies the proposing officer, deduped on the award', async () => {
    issueForApprovedAward.mockResolvedValue({ id: 'cert-1', certificate_reference: 'SBMS-2026-K8M4-X7PQ-2RZ' });
    const award = {
      id: awardId,
      student_id: studentId,
      submitted_by: officerId,
      status: 'submitted',
      verification_status: 'verified',
    };
    const client = setupClient({ award, decisionRows: { ...award, status: 'approved', approved_amount: 12000 } });

    const res = makeResponse();
    await controller.decide({
      params: { id: awardId },
      body: { decision: 'approved', approved_amount: 12000, reason: 'Documents verified' },
      user: { id: adminId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    // The certificate notification is written by the issuance service, which is mocked here.
    expect(issueForApprovedAward).toHaveBeenCalledTimes(1);
    const inserts = notificationInserts(client);
    expect(inserts).toHaveLength(1);
    const [sql, params] = inserts[0];
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7)');
    expect(params[0]).toBe(officerId);
    expect(params[1]).toBe('award_approved');
    expect(params[3]).toBe('Test Learner · KES 12,000 approved');
    expect(params[6]).toBe(`award-approved:${awardId}`);
    expect(params[0]).not.toBe(adminId);
  });

  test('a rejection notifies the officer and issues no certificate', async () => {
    const award = {
      id: awardId,
      student_id: studentId,
      submitted_by: officerId,
      status: 'submitted',
      verification_status: 'needs_investigation',
    };
    const client = setupClient({ award, decisionRows: { ...award, status: 'rejected' } });

    const res = makeResponse();
    await controller.decide({
      params: { id: awardId },
      body: { decision: 'rejected', reason: 'Household income not verified' },
      user: { id: adminId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(issueForApprovedAward).not.toHaveBeenCalled();
    const inserts = notificationInserts(client);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][1]).toBe('award_rejected');
    expect(inserts[0][1][6]).toBe(`award-rejected:${awardId}`);
  });

  test('a failed decision writes no notification because the transaction rolls back first', async () => {
    const award = {
      id: awardId,
      student_id: studentId,
      submitted_by: officerId,
      status: 'approved',
      verification_status: 'verified',
    };
    const client = setupClient({ award, decisionRows: award });

    const res = makeResponse();
    await controller.decide({
      params: { id: awardId },
      body: { decision: 'approved', approved_amount: 12000, reason: 'Already decided once' },
      user: { id: adminId, role: 'admin' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(notificationInserts(client)).toHaveLength(0);
  });
});
