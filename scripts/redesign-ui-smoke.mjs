// Browser checks for the "Modern Emerald & Slate" public / Field Officer UI and for the
// untouched Admin interface, against a deployed build.
//
// Drives a real Chrome over the DevTools Protocol (no extra dependencies: Node 22 has a
// global WebSocket), signs in with the existing test accounts and asserts which layout each
// role receives. Edge responses for certificate verification and guardian tracking are
// simulated at the browser network layer with Fetch.fulfillRequest, so no backend code, no
// database record and no server state is touched.
//
// Prerequisites:
//   1. Chrome with the DevTools port open:
//        chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<temp> about:blank
//   2. Environment (loaded from deploy/azure/.secrets.json by the caller, never printed):
//        SBMS_OFFICER_EMAIL / SBMS_OFFICER_PASSWORD
//        SBMS_ADMIN_EMAIL / SBMS_ADMIN_PASSWORD
//        SBMS_BROWSER_APP       default https://sbms-web.azurewebsites.net
//        SBMS_BROWSER_DEVTOOLS  default http://127.0.0.1:9222
//        SBMS_EVIDENCE_DIR      default verification-evidence/<yyyy-mm-dd>
//
// Exit code 0 means every check passed. Results and screenshots are written to SBMS_EVIDENCE_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEVTOOLS = (process.env.SBMS_BROWSER_DEVTOOLS || 'http://127.0.0.1:9222').replace(/\/+$/, '');
const APP = (process.env.SBMS_BROWSER_APP || 'https://sbms-web.azurewebsites.net').replace(/\/+$/, '');
const EVIDENCE = path.resolve(
  process.env.SBMS_EVIDENCE_DIR || path.join('verification-evidence', new Date().toISOString().slice(0, 10)),
);
const OFFICER = { email: process.env.SBMS_OFFICER_EMAIL, password: process.env.SBMS_OFFICER_PASSWORD };
const ADMIN = { email: process.env.SBMS_ADMIN_EMAIL, password: process.env.SBMS_ADMIN_PASSWORD };
const SKIP_ROLES = !OFFICER.email || !OFFICER.password || !ADMIN.email || !ADMIN.password;
const REAL_API = process.env.SBMS_REAL_API !== '0';

await mkdir(EVIDENCE, { recursive: true });

const results = [];
const shots = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

const target = (await (await fetch(`${DEVTOOLS}/json/list`)).json()).find((item) => item.type === 'page');
if (!target) throw new Error('no page target in Chrome');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const stubs = []; // { match: (url, method) => boolean, status, body, fail }

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30000);
  });
}


function pickStub(url, method) {
  return stubs.find((stub) => stub.match(url, method));
}

function corsHeaders(request) {
  return [
    { name: 'access-control-allow-origin', value: request.headers?.Origin || APP },
    { name: 'access-control-allow-methods', value: 'GET,POST,OPTIONS' },
    { name: 'access-control-allow-headers', value: 'content-type,authorization' },
    { name: 'access-control-allow-credentials', value: 'true' },
    { name: 'content-type', value: 'application/json' },
  ];
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data || {})})`));
    else entry.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    if (request.method === 'OPTIONS') {
      send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: corsHeaders(request) }).catch(() => {});
      return;
    }
    const stub = pickStub(request.url, request.method);
    if (!stub) {
      send('Fetch.continueRequest', { requestId }).catch(() => {});
      return;
    }
    if (stub.fail) {
      send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
      return;
    }
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: stub.status,
      responseHeaders: corsHeaders(request),
      body: Buffer.from(JSON.stringify(stub.body ?? {})).toString('base64'),
    }).catch(() => {});
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
  }
  return response.result.value;
}

async function waitFor(expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(`return (${expression});`);
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${label} (last=${JSON.stringify(last)})`);
}

async function navigate(route) {
  await send('Page.navigate', { url: `${APP}${route}` });
  await waitFor('document.readyState === "complete"', `load ${route}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function typeInto(selector, value) {
  await evaluate(`
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('missing ' + ${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
}

async function submitForm(selector = 'form') {
  await evaluate(`
    const form = document.querySelector(${JSON.stringify(selector)});
    if (!form) throw new Error('missing form: ' + ${JSON.stringify(selector)});
    form.requestSubmit();
    return true;
  `);
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = path.join(EVIDENCE, `${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  shots.push(path.relative(process.cwd(), file));
  return file;
}

async function heading() {
  return evaluate('const h = document.querySelector("main h1") || document.querySelector("h1"); return h ? h.textContent.trim() : "";');
}

async function signOut() {
  await evaluate('localStorage.clear(); sessionStorage.clear(); return true;');
  await navigate('/login');
}

async function signIn(account, label) {
  if (!account.email || !account.password) throw new Error(`missing credentials for ${label}`);
  await navigate('/login');
  await waitFor('!!document.querySelector("#sbms-login-email")', 'login form');
  await typeInto('#sbms-login-email', account.email);
  await typeInto('#sbms-login-password', account.password);
  await submitForm('form');
  return waitFor(
    `location.pathname !== "/login" || (document.querySelector(".sbms-login-error")?.innerText || "")`,
    `sign-in for ${label}`,
    25000,
  );
}

async function stubFetch(rules) {
  stubs.length = 0;
  stubs.push(...rules);
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*api/certificates/verify*' }, { urlPattern: '*api/applications/track*' }],
    handleAuthRequests: false,
  });
}

async function clearStubs() {
  stubs.length = 0;
  await send('Fetch.disable');
}
const CERT_REF = 'SBMS-2026-AAAA-AAAA';
const trackedBody = {
  valid: true,
  status: 'verified',
  certificate_reference: CERT_REF,
  beneficiary_name: 'Smoke Test Beneficiary',
  institution: 'Smoke Test Institute',
  programme: 'Bursary programme',
  disbursement_programme: 'Bursary programme',
  award_period: '2026/2027',
  approved_amount: 45000,
  issued_at: '2026-11-01T09:00:00.000Z',
  award_approved_at: '2026-10-30T09:00:00.000Z',
  payments: { total_cleared: 20000, last_payment_at: '2026-11-10T09:00:00.000Z' },
};
const supersededBody = {
  valid: false,
  status: 'not_current',
  certificate_reference: CERT_REF,
};

async function certificateLookup(reference, expectedText, shotName) {
  await navigate('/verify-certificate');
  await waitFor('!!document.querySelector("#certificate-reference")', 'certificate reference input');
  await typeInto('#certificate-reference', reference);
  await submitForm('form');
  try {
    await waitFor(
      `document.body.innerText.includes(${JSON.stringify(expectedText)})`,
      `certificate result "${expectedText}"`,
      25000,
    );
    record(shotName, true, `rendered "${expectedText}"`);
  } catch (error) {
    record(shotName, false, error.message);
  }
  await screenshot(shotName);
}

// ---------------------------------------------------------------- public surfaces
pageErrors.length = 0; // discard exceptions replayed from whatever page the tab was on
consoleErrors.length = 0;
await navigate('/');
const landingHeading = await heading();
const landingUi = await evaluate('return !!document.querySelector(".sbms-ui");');
record('public landing renders redesigned shell', landingUi && landingHeading.length > 0, landingHeading);
await screenshot('01-public-landing');

await navigate('/verify');
const verifyHeading = await heading();
record(
  'public /verify renders without a session',
  verifyHeading === 'Student record verification' &&
    (await evaluate('return !!document.querySelector(".sbms-ui");')),
  verifyHeading,
);
await screenshot('02-public-verify');

await navigate('/apply');
record(
  'public /apply renders the redesigned form',
  (await evaluate('return !!document.querySelector(".sbms-ui form");')),
  await heading(),
);
await screenshot('03-public-apply');

await navigate('/apply/track');
record(
  'public /apply/track renders both lookup fields',
  await evaluate(
    'return !!document.querySelector("#tracking_code") && !!document.querySelector("#date_of_birth");',
  ),
  await heading(),
);
await screenshot('04-public-track');

// ------------------------------------------------ certificate verification states
if (REAL_API) {
  await clearStubs();
  await certificateLookup(CERT_REF, 'Not found', '05-certificate-invalid-real');
} else {
  console.log('SKIP  live API certificate lookup (SBMS_REAL_API=0)');
}

await stubFetch([{ match: (url) => url.includes('/certificates/verify'), status: 429, body: { message: 'Too many checks.' } }]);
await certificateLookup(CERT_REF, 'Please wait', '06-certificate-rate-limited-stub');

await stubFetch([{ match: (url) => url.includes('/certificates/verify'), status: 503, body: { message: 'Unavailable' } }]);
await certificateLookup(CERT_REF, 'Connection problem', '07-certificate-unavailable-stub');

await stubFetch([{ match: (url) => url.includes('/certificates/verify'), fail: true }]);
await certificateLookup(CERT_REF, 'Connection problem', '08-certificate-network-failure-stub');

await stubFetch([{ match: (url) => url.includes('/certificates/verify'), status: 200, body: supersededBody }]);
await certificateLookup(CERT_REF, 'No longer current', '09-certificate-superseded-stub');

await stubFetch([{ match: (url) => url.includes('/certificates/verify'), status: 200, body: trackedBody }]);
await certificateLookup(CERT_REF, 'Current certificate', '10-certificate-verified-stub');
const verifiedDetail = await evaluate(
  'return document.body.innerText.includes("Smoke Test Beneficiary") && document.body.innerText.includes("Current");',
);
record('verified certificate shows beneficiary and approval status', verifiedDetail);

// ------------------------------------------------------ guardian tracking stage
const blockedTrackBody = {
  application: {
    tracking_code: 'SMOKETEST',
    full_name: 'Smoke Test Guardian',
    school_code: 'SCH-001',
    status: 'screened',
    screening_failure_code: 'NAME_MISMATCH',
    screening_unavailable: false,
    submitted_at: '2026-11-12T08:00:00.000Z',
    updated_at: '2026-11-13T08:00:00.000Z',
  },
  timeline: [],
};
await stubFetch([{ match: (url) => url.includes('/applications/track'), status: 200, body: blockedTrackBody }]);
await navigate('/apply/track');
await waitFor('!!document.querySelector("#tracking_code")', 'tracking form');
await typeInto('#tracking_code', 'SMOKETEST');
await typeInto('#date_of_birth', '2008-04-01');
await submitForm('form');
try {
  await waitFor('document.body.innerText.includes("What happens next")', 'tracking result', 25000);
  const nextStep = await evaluate(`
    const alert = [...document.querySelectorAll('.sb-alert')].find((node) =>
      node.textContent.includes('What happens next'),
    );
    return alert ? alert.textContent.replace(/\\s+/g, ' ').trim() : '';
  `);
  record(
    'tracking "What happens next" shows the blocked screening stage',
    nextStep.includes('What happens next') && nextStep.includes('Screening could not be completed'),
    nextStep.slice(0, 160),
  );
} catch (error) {
  record('tracking "What happens next" shows the blocked screening stage', false, error.message);
}
await screenshot('11-tracking-blocked-stage-stub');
await clearStubs();



// -------------------------------------------------------------- Field Officer role
if (SKIP_ROLES) {
  console.log('SKIP  authenticated role checks (credentials not provided)');
} else {

function loginFailed(probe) {
  return typeof probe === 'string' && probe.length > 0;
}

let officerProbe = '';
try {
  officerProbe = await signIn(OFFICER, 'field officer');
} catch (error) {
  officerProbe = error.message;
}
const officerPath = await evaluate('return location.pathname;');
record(
  'field officer signs in',
  !loginFailed(officerProbe) && officerPath !== '/login',
  loginFailed(officerProbe) ? officerProbe : officerPath,
);
record(
  'field officer lands on the redesigned dashboard',
  !loginFailed(officerProbe) &&
    (officerPath === '/field-officer' || officerPath === '/officer') &&
    (await evaluate('return !!document.querySelector(".sb-officer");')),
  `${officerPath} — ${await heading()}`,
);
await screenshot('12-officer-dashboard');

if (!loginFailed(officerProbe)) {
  await navigate('/applications');
  const officerQueueHeading = await heading();
  const officerQueueShell = await evaluate('return !!document.querySelector(".sb-officer");');
  const officerRows = await evaluate('return document.querySelectorAll("a[href*=\\"/applications/\\"]").length;');
  record(
    'field officer /applications keeps the redesigned officer view',
    officerQueueShell && officerRows > 0,
    `${officerQueueHeading} (${officerRows} case links)`,
  );
  await screenshot('13-officer-applications');

  if (officerRows > 0) {
    await evaluate(`
      const link = document.querySelector('a[href*="/applications/"]');
      link.click();
      return true;
    `);
    try {
      await waitFor('location.pathname.split("/").filter(Boolean).length >= 3', 'case detail route', 15000);
      await waitFor('!!document.querySelector(".sb-officer")', 'officer detail shell', 15000);
      const detailPath = await evaluate('return location.pathname;');
      const detailText = await evaluate('return document.body.innerText;');
      const hasTabs = ['Eligibility', 'Duplicate', 'Identifiers'].filter((tab) => detailText.includes(tab)).length;
      record('field officer case detail renders the redesigned tabs', hasTabs >= 2, `${detailPath} (${hasTabs}/3 tab labels)`);
      await screenshot('14-officer-case-detail');
    } catch (error) {
      record('field officer case detail renders the redesigned tabs', false, error.message);
      await screenshot('14-officer-case-detail-failed');
    }
  } else {
    record('field officer case detail renders the redesigned tabs', false, 'no case link to open');
  }

  await navigate('/eligibility');
  const eligibilityHeading = await heading();
  record(
    'field officer /eligibility keeps the redesigned view',
    (await evaluate('return !!document.querySelector(".sb-officer");')) && eligibilityHeading.length > 0,
    eligibilityHeading,
  );
  await screenshot('15-officer-eligibility');
}

// --------------------------------------------------------------------- Admin role
await signOut();
let adminProbe = '';
try {
  adminProbe = await signIn(ADMIN, 'administrator');
} catch (error) {
  adminProbe = error.message;
}
const adminPath = await evaluate('return location.pathname;');
record(
  'administrator signs in',
  !loginFailed(adminProbe) && adminPath !== '/login',
  loginFailed(adminProbe) ? adminProbe : adminPath,
);
await screenshot('16-admin-landing');

if (!loginFailed(adminProbe)) {
  await navigate('/applications');
  const adminApplications = {
    heading: await heading(),
    redesign: await evaluate('return document.querySelectorAll(".sbms-ui, .sb-officer").length;'),
  };
  record(
    'admin /applications keeps the original interface',
    adminApplications.heading === 'Guardian applications' && adminApplications.redesign === 0,
    `${adminApplications.heading} — redesign nodes: ${adminApplications.redesign}`,
  );
  await screenshot('17-admin-applications');

  await navigate('/awards');
  const adminAwards = {
    heading: await heading(),
    redesign: await evaluate('return document.querySelectorAll(".sbms-ui, .sb-officer").length;'),
  };
  record(
    'admin /awards keeps the original interface',
    adminAwards.heading === 'Bursary awards' && adminAwards.redesign === 0,
    `${adminAwards.heading} — redesign nodes: ${adminAwards.redesign}`,
  );
  await screenshot('18-admin-awards');
}
}

// ------------------------------------------------------------------- diagnostics
const unexpectedConsole = consoleErrors.filter((line) => !/429|Too Many Requests|503|Failed to load resource/i.test(line));
record('no uncaught page exceptions', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
record(
  'no unexpected console errors',
  unexpectedConsole.length === 0,
  unexpectedConsole.slice(0, 3).join(' | '),
);

const summary = {
  app: APP,
  ranAt: new Date().toISOString(),
  passed: results.filter((entry) => entry.ok).length,
  failed: results.filter((entry) => !entry.ok).length,
  results,
  screenshots: shots,
  pageErrors,
  consoleErrors,
};
await writeFile(path.join(EVIDENCE, 'results.json'), JSON.stringify(summary, null, 2));

console.log(`\n${summary.passed} passed, ${summary.failed} failed. Evidence: ${EVIDENCE}`);
socket.close();
process.exit(summary.failed === 0 ? 0 : 1);
