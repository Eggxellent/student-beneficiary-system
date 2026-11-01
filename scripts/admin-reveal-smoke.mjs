// Focused browser check for the administrator identifier-reveal flow.
//
// Why: the duplicate queue ships masked identifiers, so an administrator could not compare a
// flagged pair with the documents a guardian presents. This drives a real Chrome over the
// DevTools Protocol and proves that the case dialog offers a reveal, that the reveal is
// confirmed in the UI, and that the identifiers arrive unmasked afterwards.
//
// Prerequisites:
//   chrome --headless=new --remote-debugging-port=9223 --user-data-dir=<temp> about:blank
//
// Environment:
//   SBMS_BROWSER_APP       default https://sbms-web.azurewebsites.net
//   SBMS_BROWSER_DEVTOOLS  default http://127.0.0.1:9223
//   SBMS_ADMIN_EMAIL / SBMS_ADMIN_PASSWORD  optional overrides
//
// Exit code 0 means every check passed.
const DEVTOOLS = (process.env.SBMS_BROWSER_DEVTOOLS || 'http://127.0.0.1:9223').replace(/\/+$/, '');
const APP = (process.env.SBMS_BROWSER_APP || 'https://sbms-web.azurewebsites.net').replace(/\/+$/, '');
const EMAIL = process.env.SBMS_ADMIN_EMAIL || 'admin@sbms.test';
const PASSWORD = process.env.SBMS_ADMIN_PASSWORD || 'Sbms2026';

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
const pageErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
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
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

await goto('/admin/login', `!!document.querySelector('#sbms-login-email')`, 'admin sign-in form');
await evaluate(setField('#sbms-login-email', EMAIL));
await evaluate(setField('#sbms-login-password', PASSWORD));
await evaluate(`document.querySelector('form button[type=submit]').click()`);
await waitFor(`location.pathname === '/dashboard'`, 'admin dashboard', 40000);
record('administrator signed in', true);

await goto('/duplicate-review', `document.querySelectorAll('table tbody tr').length > 0`, 'duplicate queue', 40000);
record('duplicate queue rendered', true);

const opened = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => /view case/i.test(item.textContent));
  if (!button) return false;
  button.click();
  return true;
})()`);
await waitFor(`!!document.querySelector('[role=dialog]')`, 'case dialog');
await waitFor(`/Reveal identifiers/i.test(document.querySelector('[role=dialog]').innerText)`, 'reveal control');
record('case dialog opened', opened === true);

const before = await evaluate(`document.querySelector('[role=dialog]').innerText`);
const maskedBefore = (before.match(/\u2022/g) || []).length;
record('queue view masks identifiers', maskedBefore > 0, `maskedChars=${maskedBefore}`);
record('guardian contact row shows', /Guardian contact/.test(before));

const clicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('[role=dialog] button')].find((item) => /Reveal identifiers/i.test(item.textContent));
  if (!button) return false;
  button.click();
  return true;
})()`);
record('reveal control clicked', clicked === true);
await waitFor(`/recorded in the audit log/i.test(document.querySelector('[role=dialog]').innerText)`, 'reveal confirmation', 40000);

const after = await evaluate(`document.querySelector('[role=dialog]').innerText`);
const maskedAfter = (after.match(/\u2022/g) || []).length;
record('revealed values are unmasked', maskedAfter === 0, `maskedChars=${maskedAfter}`);
record('revealed view differs from masked view', after !== before);
record('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

socket.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
