jest.mock('../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../src/config/db');
const controller = require('../src/controllers/notifications.controller');

const userId = 'ce05b86e-f645-4ed9-8772-a954a77f1664';
const otherUserId = 'a0b1c2d3-0000-4000-8000-000000000000';
const notificationId = '0b0b0b0b-1111-4222-8333-444444444444';

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

  test('clamps the requested page size instead of trusting the caller', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = makeResponse();
    await controller.list(makeRequest({ query: { limit: '5000' } }), res, jest.fn());
    expect(pool.query.mock.calls[0][1]).toEqual([userId, 50]);

    await controller.list(makeRequest({ query: { limit: 'nonsense' } }), res, jest.fn());
    expect(pool.query.mock.calls[2][1]).toEqual([userId, 20]);
  });

  test('marks a notification read only when the row belongs to the caller', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: notificationId, read_at: '2026-11-11T08:00:00Z' }] });
    const owned = makeResponse();
    await controller.markRead(makeRequest({ params: { id: notificationId } }), owned, jest.fn());
    expect(owned.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND user_id = $2'), [notificationId, userId]);

    pool.query.mockResolvedValueOnce({ rows: [] });
    const foreign = makeResponse();
    await controller.markRead(makeRequest({ params: { id: notificationId } }), foreign, jest.fn());
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body.message).toBe('Notification not found.');
  });

  test('rejects a malformed id without touching the database', async () => {
    const res = makeResponse();
    await controller.markRead(makeRequest({ params: { id: 'not-a-uuid' } }), res, jest.fn());
    expect(res.statusCode).toBe(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('marks every unread row for the caller and nobody else', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 3 });
    const res = makeResponse();
    await controller.markAllRead(makeRequest(), res, jest.fn());
    expect(res.body).toEqual({ updated: 3 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1 AND read_at IS NULL'),
      [userId],
    );
    expect(pool.query.mock.calls[0][1]).not.toContain(otherUserId);
  });
});
