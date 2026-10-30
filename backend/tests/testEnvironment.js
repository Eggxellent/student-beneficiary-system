// Configuration that must exist before a suite imports `src/index.js`.
//
// Student registration builds a QR code from PUBLIC_APP_URL, and
// `src/config/publicAppUrl.js` accepts only public HTTPS origins unless
// NODE_ENV=development. This fixture origin keeps the suites independent of an
// operator's shell without weakening the production validation: nothing contacts it,
// and a real deployment still has to supply its own value.
if (!process.env.PUBLIC_APP_URL) {
  process.env.PUBLIC_APP_URL = 'https://sbms-test-fixture.ac.ke';
}

// The sign-in and verification limiters keep in-process counters keyed by client IP, and
// every supertest request arrives from 127.0.0.1. Because setupFiles runs once per test
// file, resetting here gives each file its own budget: otherwise adding one more suite
// that signs in pushes unrelated suites over the production limit and they fail with 429.
// The limits themselves are unchanged, and tests that assert the limit still exhaust it
// within their own file.
require('../src/middleware/loginRateLimit').reset();
require('../src/middleware/verificationRateLimit').reset();
