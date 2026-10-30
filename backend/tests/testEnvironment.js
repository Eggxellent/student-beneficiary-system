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
