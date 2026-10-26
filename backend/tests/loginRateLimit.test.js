const loginRateLimit = require('../src/middleware/loginRateLimit');

describe('loginRateLimit', () => {
  test('allows ten sign-in requests and rejects the next request from the same IP', () => {
    const ip = `rate-limit-test-${Date.now()}-${Math.random()}`;
    let allowed = 0;
    let statusCode;
    let responseBody;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      loginRateLimit({ ip, socket: {} }, res, () => { allowed += 1; });
    }
    loginRateLimit({ ip, socket: {} }, res, () => { allowed += 1; });

    expect(allowed).toBe(10);
    expect(statusCode).toBe(429);
    expect(responseBody).toEqual({ message: 'Too many sign-in attempts. Try again later.' });
  });
});
