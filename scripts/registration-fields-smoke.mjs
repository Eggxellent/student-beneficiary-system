// Focused browser check for the identifiers the registration form must capture.
//
// Why: the duplicate rules give an exact UPI or birth-certificate agreement critical status, but the
// form only posted name, date of birth, school, National ID and phone, so those two columns stayed
// NULL for every real registration and the critical rule could never fire. This drives a real Chrome
// over the DevTools Protocol, fills the form and *intercepts* POST /api/students, so the submitted
// payload is proven without writing a student record.
//
// Prerequisites:
//   chrome --headless=new --remote-debugging-port=9223 --user-data-dir=<temp> about:blank
//
// Environment:
//   SBMS_BROWSER_APP         default https://sbms-web.azurewebsites.net
//   SBMS_BROWSER_DEVTOOLS    default http://127.0.0.1:9223
//   SBMS_OFFICER_EMAIL       required - a field-officer account
//   SBMS_OFFICER_PASSWORD    required
//
// Exit code 0 means every check passed.
const DEVTOOLS = (process.env.SBMS_BROWSER_DEVTOOLS || 'http://127.0.0.1:9223').replace(/\/+$/, '');
const APP = (process.env.SBMS_BROWSER_APP || 'https://sbms-web.azurewebsites.net').replace(/\/+$/, '');
const EMAIL = process.env.SBMS_OFFICER_EMAIL;
const PASSWORD = process.env.SBMS_OFFICER_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('SBMS_OFFICER_EMAIL and SBMS_OFFICER_PASSWORD must be set to a field-officer account.');
  process.exit(2);
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

const targets = await (await fetch(`${DEVTOOLS}/json/list`)).json();
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('no page target in Chrome');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
let capturedBody = null;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/students') {
      // Keep the body and refuse the request: the form is exercised, nothing is persisted.
      capturedBody = request.postData || '';
      send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
    } else {
      send('Fetch.continueRequest', { requestId });
    }
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || 'evaluate failed');
  }
  return response.result?.result?.value;
}

async function waitFor(expression, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // the page may be mid-navigation; keep polling
    }
    await sleep(250);
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
  const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const UPI = 'SMOKE-UPI-20261101-0001';
const CERTIFICATE = 'SMOKE-BC-20261101-0001';
const NATIONAL_ID = 'SMOKE-NID-0001';
const PHONE = '+254712345678';

async function fill(lastName, values) {
  await evaluate(setField('input[name=first_name]', 'Smoke'));
  await evaluate(setField('input[name=last_name]', lastName));
  await evaluate(setField('input[name=date_of_birth]', '2011-04-12'));
  const school = await evaluate(`document.querySelectorAll('select[name=school_code] option')[1].value`);
  await evaluate(setField('select[name=school_code]', school));
  await evaluate(setField('input[name=national_id_number]', NATIONAL_ID));
  await evaluate(setField('input[name=primary_phone]', PHONE));
  await evaluate(setField('input[name=birth_certificate_number]', values.certificate));
  await evaluate(setField('input[name=upi]', values.upi));
}

async function submitAndCapture() {
  capturedBody = null;
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && capturedBody === null) await sleep(200);
  return capturedBody;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// A token from an earlier run would bounce the login page straight to a dashboard.
await send('Page.navigate', { url: `${APP}/login` });
await waitFor(`document.readyState === 'complete'`, 'initial load');
await evaluate(`localStorage.clear()`);

await goto('/field-officer/login', `!!document.querySelector('#sbms-login-email')`, 'field-officer sign-in form');
await evaluate(setField('#sbms-login-email', EMAIL));
await evaluate(setField('#sbms-login-password', PASSWORD));
await evaluate(`document.querySelector('form button[type=submit]').click()`);
await waitFor(`!!localStorage.getItem('token') && !location.pathname.endsWith('/login')`, 'login redirect', 40000);
const role = await evaluate(`JSON.parse(localStorage.getItem('user'))?.role || null`);
record('field officer signed in', role === 'field_officer', `role=${role}`);

await goto(
  '/students/register',
  `!!document.querySelector('select[name=school_code]') && document.querySelectorAll('select[name=school_code] option').length > 1`,
  'registration form'
);

const shape = await evaluate(`(() => {
  const certificate = document.querySelector('input[name=birth_certificate_number]');
  const upi = document.querySelector('input[name=upi]');
  const label = (el) => el && el.closest('label') ? el.closest('label').innerText.split('\\n')[0].trim() : null;
  return {
    certificatePresent: !!certificate,
    upiPresent: !!upi,
    certificateLabel: label(certificate),
    upiLabel: label(upi),
    certificateRequired: certificate ? certificate.required : null,
    upiRequired: upi ? upi.required : null,
    inputNames: [...document.querySelectorAll('form input, form select')].map((el) => el.name).filter(Boolean),
  };
})()`);
record('birth certificate input is on the form', shape.certificatePresent === true, shape.certificateLabel || '');
record('UPI input is on the form', shape.upiPresent === true, shape.upiLabel || '');
record('both identifiers are optional', shape.certificateRequired === false && shape.upiRequired === false,
  `required=${shape.certificateRequired}/${shape.upiRequired}`);
record('form keeps the original fields', ['first_name', 'last_name', 'date_of_birth', 'school_code', 'national_id_number', 'primary_phone']
  .every((name) => shape.inputNames.includes(name)), shape.inputNames.join(','));

await send('Fetch.enable', { patterns: [{ urlPattern: '*api/students*', requestStage: 'Request' }] });

await fill('Fields', { certificate: CERTIFICATE, upi: UPI });
const body = await submitAndCapture();
let payload = null;
try {
  payload = JSON.parse(body || '');
} catch {
  payload = null;
}
record('form posts a JSON body to /api/students', payload !== null, body ? `bytes=${body.length}` : 'no request captured');
record('payload carries the birth certificate number', payload?.birth_certificate_number === CERTIFICATE,
  String(payload?.birth_certificate_number));
record('payload carries the UPI', payload?.upi === UPI, String(payload?.upi));
record('payload still carries the original fields',
  payload?.full_name === 'Smoke Fields' && payload?.national_id_number === NATIONAL_ID && payload?.primary_phone === PHONE,
  payload ? Object.keys(payload).join(',') : '');
record('blocked submission is reported instead of a success panel',
  await evaluate(`/Failed to register/i.test((document.querySelector('[role=alert]') || {}).innerText || '')`));

// A blank identifier must be omitted, not sent as an empty string.
await sleep(500);
await fill('Blank', { certificate: '', upi: '' });
const blankBody = await submitAndCapture();
let blankPayload = null;
try {
  blankPayload = JSON.parse(blankBody || '');
} catch {
  blankPayload = null;
}
record('blank identifiers are omitted from the payload',
  blankPayload !== null && !('birth_certificate_number' in blankPayload) && !('upi' in blankPayload),
  blankPayload ? Object.keys(blankPayload).join(',') : 'no request captured');

socket.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);


