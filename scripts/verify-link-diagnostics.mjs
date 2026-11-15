// End-to-end check of the link a QR code carries.
//
// Why: officers reported that scanning a student or invoice QR produced a "dangerous link"
// warning or simply failed to open. From the scanner's side every failure looks the same, and the
// payload is assembled server-side from PUBLIC_APP_URL, so this script reproduces the exact URL
// the backend embeds, then makes the exact requests the two public pages make. A wrong origin, a
// missing SPA fallback and a dead API are told apart, and the host is checked against the three
// public reputation sources that answer without an API key.
//
// Usage:
//   node scripts/verify-link-diagnostics.mjs [--app URL] [--api URL] [--token TOKEN]
//
// Environment:
//   PUBLIC_APP_URL    default https://sbms-web.azurewebsites.net
//   SBMS_API_ORIGIN   default the live Container App
//
// Exit code 0 means every core check passed. Reputation lookups are informational: a vendor that
// answers "untested" is not a failure, only a positive unsafe verdict is.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  buildStudentVerificationUrl,
  buildCertificateVerificationUrl,
} = require('../backend/src/config/publicAppUrl.js');

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const APP = argValue('app', process.env.PUBLIC_APP_URL || 'https://sbms-web.azurewebsites.net')
  .replace(/\/+$/, '');
const API = argValue(
  'api',
  process.env.SBMS_API_ORIGIN || 'https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io',
).replace(/\/+$/, '');
// A newly issued student token, in the shape the backend generates: 32 random bytes as hex.
const TOKEN = argValue('token', randomBytes(32).toString('hex'));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}
function note(name, detail) {
  console.log(`INFO  ${name}  [${detail}]`);
}

// The backend refuses non-HTTPS and loopback origins outside development, so the QR payload is
// built with the production rule set even when this runs from a workstation.
const studentUrl = buildStudentVerificationUrl(TOKEN, APP, 'production');
const certificateUrl = buildCertificateVerificationUrl(TOKEN, APP, 'production');

console.log(`app origin      ${APP}`);
console.log(`api origin      ${API}`);
console.log(`student QR      ${studentUrl}`);
console.log(`invoice QR      ${certificateUrl}\n`);

// Scanners only ever request the part before the fragment, so that is what must answer 200 with
// the SPA shell; the fragment never reaches the server.
for (const [label, url] of [['student page', studentUrl], ['invoice page', certificateUrl]]) {
  const pageUrl = url.split('#')[0];
  try {
    const response = await fetch(pageUrl, { redirect: 'follow' });
    const body = await response.text();
    const shell = body.includes('id="root"');
    record(`${label} answers ${pageUrl}`, response.ok && shell, `HTTP ${response.status}${shell ? ', SPA shell' : ', NOT the SPA shell'}`);
    record(`${label} is HTML`, (response.headers.get('content-type') || '').includes('text/html'), response.headers.get('content-type') || 'no content-type');
    record(`${label} nosniff`, response.headers.get('x-content-type-options') === 'nosniff', response.headers.get('x-content-type-options') || 'missing');
    record(`${label} no framing`, (response.headers.get('x-frame-options') || '').toUpperCase() === 'DENY', response.headers.get('x-frame-options') || 'missing');
  } catch (error) {
    record(`${label} answers ${pageUrl}`, false, error.message);
  }
}

// Both public pages call the API from the browser, so a CORS or DNS failure on this origin is what
// the officer sees as "this code could not be checked".
for (const [label, path, payload, expected] of [
  ['student token', '/api/verify', { token: TOKEN }, (data) => data?.found === false],
  ['invoice token', '/api/certificates/verify', { token: TOKEN }, (data) => data?.valid === false],
]) {
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    record(`${label} endpoint answers`, response.status < 500, `HTTP ${response.status}`);
    record(`${label} rejects an unknown token`, expected(data), JSON.stringify(data));
    record(`${label} allows the page origin`, Boolean(response.headers.get('access-control-allow-origin')), response.headers.get('access-control-allow-origin') || 'missing');
  } catch (error) {
    record(`${label} endpoint answers`, false, error.message);
  }
}

// Reputation is reported, not enforced: a scanner warning is often an opinion about the shared
// *.azurewebsites.net hostname rather than a finding about this deployment.
const host = new URL(APP).hostname;

try {
  const raw = await (await fetch(`https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=${host}`)).text();
  const payload = JSON.parse(raw.split('\n').slice(1).join('\n'));
  const flags = Array.isArray(payload?.[0]) ? payload[0].slice(2, 6) : [];
  const unsafe = flags.some(Boolean);
  record('Google Safe Browsing clean', !unsafe, unsafe ? 'listed' : 'no listing');
} catch (error) {
  note('Google Safe Browsing', `lookup failed: ${error.message}`);
}

try {
  const data = await (await fetch(`https://safeweb.norton.com/safeweb/sites/v1/details?url=${encodeURIComponent(APP)}&insert=0`)).json();
  const unsafe = data?.globalRestriction === true || data?.rating === 'r' || data?.rating === 'w';
  record('Norton Safe Web clean', !unsafe, `rating ${data?.rating ?? 'unknown'}${data?.globalRestriction ? ', restricted' : ''}`);
} catch (error) {
  note('Norton Safe Web', `lookup failed: ${error.message}`);
}

try {
  const data = await (await fetch(`https://sitecheck.sucuri.net/api/v3/?scan=${host}`)).json();
  const critical = Object.keys(data?.recommendations || {}).filter((key) => key.startsWith('security_critical'));
  record('Sucuri sitecheck clean', critical.length === 0, `rating ${data?.ratings?.total?.rating ?? 'unknown'}${critical.length ? `, ${critical.join(',')}` : ''}`);
} catch (error) {
  note('Sucuri sitecheck', `lookup failed: ${error.message}`);
}

console.log('\nA scanner warning that none of the three sources reproduces is a false positive against');
console.log('the shared hostname. The durable fix is a custom domain bound to the same site, with');
console.log('PUBLIC_APP_URL and CORS_ORIGINS pointed at it, because reputation follows the hostname.');

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  failed.forEach((item) => console.log(`  ${item.name}  ${item.detail}`));
  process.exitCode = 1;
}
