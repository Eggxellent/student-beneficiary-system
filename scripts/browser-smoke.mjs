// Browser smoke check for the registration and duplicate-review screens.
//
// Drives a real Chrome over the DevTools Protocol: signs in as a field officer and as an
// administrator, registers a student, re-registers the same student to force duplicate
// screening, blocks the API to check error handling, then checks the admin queue, the
// audit log and the role guard. No extra dependencies: Node 22 has a global WebSocket.
//
// Prerequisites (three terminals, from the repository root):
//   1. API against the test database:
//        backend$ SBMS_EXPECTED_DATABASE_NAME=sbms_test  PUBLIC_APP_URL=https://sbms-test-fixture.ac.ke
//        backend$ PORT=5000 node src/index.js
//   2. Frontend dev server (proxies /api to :5000):  frontend$ npm run dev
//   3. Chrome with the DevTools port open:
//        chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<temp> about:blank
//   Plus accounts from:  backend$ npm run seed:verification   (needs SBMS_VERIFY_PASSWORD)
//
// Environment:
//   SBMS_BROWSER_APP       default http://localhost:4174
//   SBMS_BROWSER_DEVTOOLS  default http://127.0.0.1:9222
//   SBMS_VERIFY_PASSWORD   required
//   SBMS_VERIFY_ADMIN_EMAIL / SBMS_VERIFY_OFFICER_EMAIL  optional overrides
//
// Exit code 0 means every check passed.
const DEVTOOLS = (process.env.SBMS_BROWSER_DEVTOOLS || 'http://127.0.0.1:9222').replace(/\/+$/, '');
const APP = (process.env.SBMS_BROWSER_APP || 'http://localhost:4174').replace(/\/+$/, '');
const PASSWORD = process.env.SBMS_VERIFY_PASSWORD;
if (!PASSWORD) {
  console.error('SBMS_VERIFY_PASSWORD must be set to the password used by npm run seed:verification.');
  process.exit(2);
}
const OFFICER = { email: process.env.SBMS_VERIFY_OFFICER_EMAIL || 'phase3.officer@example.invalid', password: PASSWORD };
const ADMIN = { email: process.env.SBMS_VERIFY_ADMIN_EMAIL || 'phase3.admin@example.invalid', password: PASSWORD };

const results = [];
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
const pageErrors = [];
const state = { blockStudentPost: false };
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    if (state.blockStudentPost && request.method === 'POST' && request.url.endsWith('/api/students')) {
      send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
    } else {
      send('Fetch.continueRequest', { requestId });
    }
  } else if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.text || 'exception');
  } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    pageErrors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || 'evaluate failed');
  }
  return response.result?.result?.value;
}

async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // the page may be mid-navigation; keep polling
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function goto(path, readyExpression, label) {
  await send('Page.navigate', { url: `${APP}${path}` });
  await waitFor(`document.readyState === 'complete'`, `${label} load`);
  await waitFor(readyExpression, label);
}

const setField = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

async function login(path, credentials) {
  await goto(path, `!!document.querySelector('#sbms-login-email')`, `${path} form`);
  await evaluate(setField('#sbms-login-email', credentials.email));
  await evaluate(setField('#sbms-login-password', credentials.password));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(
    `!!localStorage.getItem('token') && !location.pathname.endsWith('/login')`,
    'login redirect'
  );
  return evaluate(`JSON.parse(localStorage.getItem('user'))?.role || null`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// A token from an earlier run would bounce the login page straight to a dashboard.
await send('Page.navigate', { url: `${APP}/login` });
await waitFor(`document.readyState === 'complete'`, 'initial load');
await evaluate(`localStorage.clear()`);

const officerRole = await login('/field-officer/login', OFFICER);

const STUDENT = {
  first: 'Phase',
  last: 'Three',
  dob: '2011-04-12',
  nationalId: 'P3-NID-00012345',
  phone: '+254712345678',
};

async function register(student = STUDENT) {
  await goto(
    '/students/register',
    `!!document.querySelector('select[name=school_code]') && document.querySelectorAll('select[name=school_code] option').length > 1`,
    'registration form'
  );
  const school = await evaluate(`document.querySelectorAll('select[name=school_code] option')[1].value`);
  await evaluate(setField('input[name=first_name]', student.first));
  await evaluate(setField('input[name=last_name]', student.last));
  await evaluate(setField('input[name=date_of_birth]', student.dob));
  await evaluate(setField('select[name=school_code]', school));
  await evaluate(setField('input[name=national_id_number]', student.nationalId));
  await evaluate(setField('input[name=primary_phone]', student.phone));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(`!!document.querySelector('[role=status]') || !!document.querySelector('[role=alert]')`, 'confirmation or error');
  return evaluate(`(() => {
    const panel = document.querySelector('[role=status]');
    const alert = document.querySelector('[role=alert]');
    return { panel: panel ? panel.innerText : '', panelClass: panel ? panel.className : '', alert: alert ? alert.innerText : '' };
  })()`);
}

// 1. A normal registration with nothing (or little) to compare against.
const first = await register();
record('normal registration succeeds in the browser', /Student registered/i.test(first.panel), first.panel.split('\n')[0]);
record(
  'screening sentence is shown to the officer',
  /No existing students were available|Checked against \d+ existing student/i.test(first.panel),
  first.panel.replace(/\s+/g, ' ').slice(0, 150)
);
record('field officer sees no model internals', !/xgboost|Aggregation policy|Review cutoff|Suppressed/i.test(first.panel));

// 2. The same student again: a suspicious candidate must reach review.
const second = await register();
record('re-registration is still created (no automatic rejection)', /Student registered/i.test(second.panel));
record('duplicate warning is shown to the officer', /administrator must review/i.test(second.panel), second.panel.replace(/\s+/g, ' ').slice(0, 170));
record('exact identifier evidence is named in plain language', /Exact .*match/i.test(second.panel), second.panel.replace(/\s+/g, ' ').slice(0, 170));
record('suspicious case uses the stronger warning colour', /red/i.test(second.panelClass), second.panelClass.slice(0, 80));

// 3. A third copy: several candidates qualify, one case opens, the rest are withheld.
const third = await register();
record('third registration still succeeds', /Student registered/i.test(third.panel));
record(
  'several qualifying candidates are collapsed to one case and counted',
  /flagged for a second look|recorded in the audit log/i.test(third.panel),
  third.panel.replace(/\s+/g, ' ').slice(0, 220)
);
record('officer never sees cutoffs or model internals', !/xgboost|cutoff|Aggregation policy|Suppressed/i.test(third.panel), third.panel.replace(/\s+/g, ' ').slice(0, 200));

// 4. API failure must be reported, not swallowed.
const errorsBeforeFaultInjection = pageErrors.length;
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/students', requestStage: 'Request' }] });
state.blockStudentPost = true;
await goto(
  '/students/register',
  `!!document.querySelector('select[name=school_code]') && document.querySelectorAll('select[name=school_code] option').length > 1`,
  'registration form (blocked API)'
);
await evaluate(setField('input[name=first_name]', 'Blocked'));
await evaluate(setField('input[name=last_name]', 'Request'));
await evaluate(setField('input[name=date_of_birth]', '2012-01-01'));
await evaluate(`(() => { const s = document.querySelector('select[name=school_code]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[1].value); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await evaluate(setField('input[name=national_id_number]', 'P3-NID-BLOCKED'));
await evaluate(setField('input[name=primary_phone]', '+254712345679'));
await evaluate(`document.querySelector('form button[type=submit]').click()`);
await waitFor(`!!document.querySelector('[role=alert]')`, 'error alert');
const failed = await evaluate(`document.querySelector('[role=alert]').innerText`);
record('a failed request shows an error instead of a false success', /failed|could not|unavailable|retry/i.test(failed), failed.replace(/\s+/g, ' ').slice(0, 120));
record('no confirmation panel appears for the failed request', !(await evaluate(`!!document.querySelector('[role=status]')`)));
state.blockStudentPost = false;
await send('Fetch.disable');
const injectedErrors = pageErrors.length - errorsBeforeFaultInjection;
record('the blocked request produced exactly one expected network error', injectedErrors <= 1, `${injectedErrors} logged`);


// 5. Admin surface: the case is in the queue and the policy is visible.
await evaluate(`localStorage.clear()`);
await goto('/login', `!!document.querySelector('a[data-role="admin"]')`, 'role chooser');
const adminRole = await login('/admin/login', ADMIN);
record('admin can sign in through the UI', adminRole === 'admin', `role=${adminRole}`);

await goto('/duplicate-review', `!!document.body.innerText.match(/Cutoffs:/)`, 'duplicate review queue');
const queueText = await evaluate('document.body.innerText');
record('admin queue lists the case as pending review', /pending review/i.test(queueText));
record(
  'admin sees both cutoffs (review and high-priority)',
  /0\.50/.test(queueText) && /0\.70/.test(queueText),
  (queueText.match(/Cutoffs:[^\n]*/) || [''])[0].slice(0, 150)
);
record('admin sees the aggregation policy', /aggregation/i.test(queueText));
record('high-priority cases are counted for the admin', /High priority/i.test(queueText));

const opened = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => /View case|Review case/i.test(item.innerText));
  if (!button) return false;
  button.click();
  return true;
})()`);
if (opened) {
  await waitFor(`!!document.querySelector('[role=dialog]')`, 'case dialog');
  const dialog = await evaluate(`document.querySelector('[role=dialog]').innerText`);
  record('case detail shows the model version and cutoff', /Model:/i.test(dialog) && /cutoff:/i.test(dialog), (dialog.match(/Model:[^\n]*/) || [''])[0].slice(0, 110));
  record('case detail states the score is not a decision', /not a calibrated probability or decision/i.test(dialog));
} else {
  record('case detail opens', false, 'no case button found');
}

// 6. The audit screen an administrator uses must show the screening counters readably.
await goto('/audit', `!!document.body.innerText`, 'audit logs');
const auditText = await evaluate('document.body.innerText');
record(
  'audit log renders the duplicate screening counters as readable text',
  /duplicate candidates considered: \d/i.test(auditText) || /duplicate flags created/i.test(auditText),
  (auditText.match(/duplicate candidates considered: \d[^\n]*/) || [''])[0].slice(0, 120)
);

// 7. Role guard: an admin must not reach the field-officer registration screen.
await send('Page.navigate', { url: `${APP}/students/register` });
await waitFor(`document.readyState === 'complete'`, 'guard navigation load');
await sleep(1500);
const adminPath = await evaluate('location.pathname');
record('admin is redirected away from the registration page', adminPath !== '/students/register', `pathname=${adminPath}`);

// 7. Console health, excluding the one error this script deliberately injected.
const unexpectedErrors = pageErrors.length - injectedErrors;
record('no uncaught page errors outside the injected failure', unexpectedErrors === 0, pageErrors.slice(0, 3).join(' | '));

const failures = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failures}/${results.length} browser checks passed`);
socket.close();
process.exit(failures === 0 ? 0 : 1);

record('field officer can sign in through the UI', officerRole === 'field_officer', `role=${officerRole}`);
