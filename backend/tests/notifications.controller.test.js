jest.mock('../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../src/config/db');
const controller = require('../src/controllers/notifications.controller');

const userId = 'ce05b86e-f645-4ed9-8772-a954a77f1664';
const otherUserId = 'a0b1c2d3-0000-4000-8000-000000000000';
const notificationId = '0b0b0b0b-1111-4222-8333-444444444444';
const awardId = '1c1c1c1c-2222-4333-8444-555555555555';

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeRequest(overrides = {}) {
  return { user: { id: userId }, params: {}, query: {}, body: {}, ...overrides };
}

describe('notifications API (isolated; no database)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists only the authenticated user rows and their real unread count', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: notificationId, category: 'award_approved', title: 'Award approved' }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const res = makeResponse();
    await controller.list(makeRequest(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.unread_count).toBe(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(pool.query.mock.calls[0][1]).toEqual([userId, 20]);
    expect(pool.query.mock.calls[0][0]).toContain('WHERE user_id = $1');
    expect(pool.query.mock.calls[1][1]).toEqual([userId]);
  });

  // A proposal is still waiting after its one-shot notification has been opened and deleted, so the
  // administrator's queue is derived from the awards table and cannot be cleared away.
  test('an administrator also receives the students still awaiting a decision', async () => {
    const award = {
      id: awardId,
      student_name: 'Amina Wanjiku',
      requested_amount: '45000.00',
      created_at: '2026-11-14T09:00:00.000Z',
    };
    pool.query.mockImplementation(async (statement) => {
      if (statement.includes('FROM bursary_awards a')) return { rows: [award] };
      if (statement.includes("status = 'submitted'")) return { rows: [{ count: 7 }] };
      if (statement.includes('COUNT(*)')) return { rows: [{ count: 2 }] };
      return { rows: [] };
    });

    const res = makeResponse();
    await controller.list(makeRequest({ user: { id: userId, role: 'admin' } }), res, jest.fn());

    expect(res.body.unread_count).toBe(2);
    expect(res.body.pending_approval_count).toBe(7);
    expect(res.body.pending_approvals).toEqual([{ ...award, link: '/awards' }]);
    const pendingCall = pool.query.mock.calls.find(([statement]) => statement.includes('FROM bursary_awards a'));
    expect(pendingCall[0]).toContain("WHERE a.status = 'submitted'");
    // The panel shows a few rows; the count is what says how many students are actually waiting.
    expect(pendingCall[1]).toEqual([5]);
  });

  test('a field officer gets no pending-approval list and no extra awards query', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = makeResponse();
    await controller.list(makeRequest({ user: { id: userId, role: 'field_officer' } }), res, jest.fn());

    expect(res.body.pending_approvals).toEqual([]);
    expect(res.body.pending_approval_count).toBe(0);
    expect(pool.query.mock.calls).toHaveLength(2);
  });


  test('clamps the requested page size instead of trusting the caller', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = makeResponse();
    await controller.list(makeRequest({ query: { limit: '5000' } }), res, jest.fn());
    expect(pool.query.mock.calls[0][1]).toEqual([userId, 50]);

    await controller.list(makeRequest({ query: { limit: 'nonsense' } }), res, jest.fn());
    expect(pool.query.mock.calls[2][1]).toEqual([userId, 20]);
  });

  test('dismisses a notification only when the row belongs to the caller', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: notificationId }] });
    const owned = makeResponse();
    await controller.dismiss(makeRequest({ params: { id: notificationId } }), owned, jest.fn());
    expect(owned.statusCode).toBe(200);
    expect(owned.body).toEqual({ removed: notificationId });
    const [statement, params] = pool.query.mock.calls[0];
    // A read notification is deleted, never flagged as read and kept.
    expect(statement).toContain('DELETE FROM notifications');
    expect(statement).not.toContain('read_at');
    expect(params).toEqual([notificationId, userId]);

    pool.query.mockResolvedValueOnce({ rows: [] });
    const foreign = makeResponse();
    await controller.dismiss(makeRequest({ params: { id: notificationId } }), foreign, jest.fn());
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body.message).toBe('Notification not found.');
  });

  test('rejects a malformed id without touching the database', async () => {
    const res = makeResponse();
    await controller.dismiss(makeRequest({ params: { id: 'not-a-uuid' } }), res, jest.fn());
    expect(res.statusCode).toBe(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('clears every row for the caller and nobody else', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 3 });
    const res = makeResponse();
    await controller.clearAll(makeRequest(), res, jest.fn());
    expect(res.body).toEqual({ removed: 3 });
    const [statement, params] = pool.query.mock.calls[0];
    expect(statement).toContain('DELETE FROM notifications WHERE user_id = $1');
    expect(params).toEqual([userId]);
    expect(params).not.toContain(otherUserId);
  });
});
