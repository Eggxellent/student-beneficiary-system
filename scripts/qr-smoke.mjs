// Browser check for the public QR verification page.
//
// Confirms that scanning the code leads to a page that:
//   * extracts the token from the URL fragment and verifies it,
//   * removes the token from the visible URL,
//   * shows only "Record found" / "Unable to verify this code" and no student data,
//   * refuses an unknown token, a missing token and a token supplied as a query parameter.
//
// Prerequisites: backend on :5000 with the test database, frontend on :4174, and Chrome
//   --headless=new --remote-debugging-port=9222
// Obtain a token by registering a student, e.g. POST /api/students and read
// `qr_token` for that row, then:
//   SBMS_QR_TOKEN=<64 hex chars> node scripts/qr-smoke.mjs
const DEVTOOLS = (process.env.SBMS_BROWSER_DEVTOOLS || 'http://127.0.0.1:9222').replace(/\/+$/, '');
const APP = (process.env.SBMS_BROWSER_APP || 'http://localhost:4174').replace(/\/+$/, '');
const TOKEN = process.env.SBMS_QR_TOKEN;

if (!TOKEN || !/^[a-f0-9]{64}$/.test(TOKEN)) {
  console.error('SBMS_QR_TOKEN must be a 64-character lowercase hex QR token.');
  process.exit(2);
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.text || 'exception');
  } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    const { source, text, url } = message.params.entry;
    pageErrors.push(`${source}: ${text}${url ? ` (${url})` : ''}`);
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
  if (response.result?.exceptionDetails) throw new Error('evaluate failed');
  return response.result?.result?.value;
}

async function waitForText(expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await evaluate('document.body ? document.body.innerText : ""');
    if (text && text.includes(expected)) return text;
    await sleep(200);
  }
  return await evaluate('document.body ? document.body.innerText : ""');
}

async function visit(path, expected) {
  // Always start from a blank document so a scenario that differs only in the URL fragment
  // is a real page load, exactly like scanning a code opens the page.
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await send('Page.navigate', { url: `${APP}${path}` });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(`document.readyState === 'complete'`)) break;
    await sleep(150);
  }
  return waitForText(expected);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

// 1. A valid code verifies.
const found = await visit(`/verify#token=${TOKEN}`, 'Record found');
record('a scanned code opens the page and reports the record as found', /Record found/.test(found), found.replace(/\s+/g, ' ').slice(0, 80));

const visibleUrl = await evaluate('location.href');
record('the token is removed from the visible URL', !visibleUrl.includes(TOKEN), visibleUrl.slice(0, 70));

const bodyText = await evaluate('document.body.innerText');
record(
  'the page exposes no student data',
  !/QR Camera Sample|Nairobi School|2010-09-14|QR-CAMERA-0001|254799111222/i.test(bodyText),
  bodyText.replace(/\s+/g, ' ').slice(0, 90)
);
record('the page shows nothing beyond a status message', bodyText.trim().split('\n').length <= 2, `${bodyText.trim().split('\n').length} lines`);

// 2. An unknown code is refused.
const unknown = await visit(`/verify#token=${'a'.repeat(64)}`, 'Unable to verify this code');
record('an unknown token is refused', /Unable to verify this code/.test(unknown), unknown.replace(/\s+/g, ' ').slice(0, 70));

// 3. No code at all.
const missing = await visit('/verify', 'Unable to verify this code');
record('a visit without a token is refused', /Unable to verify this code/.test(missing), missing.replace(/\s+/g, ' ').slice(0, 70));

// 4. Token in the query string instead of the fragment (no such QR was ever issued).
const query = await visit(`/verify?token=${TOKEN}`, 'Unable to verify this code');
record('a token passed as a query parameter is not accepted', /Unable to verify this code/.test(query), query.replace(/\s+/g, ' ').slice(0, 70));

// 5. A different code in the same tab must re-verify instead of keeping the old result.
await visit(`/verify#token=${TOKEN}`, 'Record found');
await evaluate(`location.hash = '#token=${'b'.repeat(64)}'`);
const switched = await waitForText('Unable to verify this code');
record(
  'a new code in the same tab is re-verified, not left showing the previous result',
  /Unable to verify this code/.test(switched),
  switched.replace(/\s+/g, ' ').slice(0, 70)
);

// A missing favicon is not a defect; everything else is.
const realErrors = pageErrors.filter((item) => !/favicon\.ico/i.test(item));
record('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

const failures = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failures}/${results.length} QR checks passed`);
socket.close();
process.exit(failures === 0 ? 0 : 1);
