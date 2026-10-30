# QR verification — 30 October 2026

**Scope:** QR generation, the public verification page, token handling, privacy, rate
limiting, and older-code compatibility.
**Result:** 10 API tests and 9 real-browser checks pass. One defect found and fixed
(stale result on a second scan in the same tab). **The phone-camera scan itself is blocked
by configuration** — see §5.

## 1. How the flow works (as verified, not as assumed)

1. Registration generates `randomBytes(32).toString('hex')` — 64 lowercase hex characters —
   stores it in `students.qr_token` (partial unique index) and returns a QR image.
2. The QR encodes `PUBLIC_APP_URL + '/verify#token=<token>'` — the token is in the
   **fragment**, so it is never sent to a server in a URL, never lands in access logs, and is
   not sent as a `Referer`.
3. `/verify` reads the fragment, removes it from the visible URL with `history.replaceState`,
   and POSTs `{ token }` to `/api/verify`.
4. `/api/verify` is public, rate limited before body parsing, accepts **exactly** one key
   (`token`) matching `^[a-f0-9]{64}$`, and answers `{ "found": true | false }` — nothing
   else. Malformed, unknown and well-formed-but-unknown tokens all get `{ found: false }`, so
   the endpoint is not an oracle for token validity.
5. The registration response strips `qr_token` from the student object (`student.model.js`).

## 2. API evidence (`backend/tests/verification.test.js`, new — 10 tests)

| Test | Result |
| --- | --- |
| Token is 64 lowercase hex | pass |
| QR image encodes `/verify#token=…` (byte-identical to re-encoding that URL) | pass |
| Registration response never contains the token | pass |
| Valid token → `200 {found: true}` and nothing else | pass |
| Unknown token → `{found: false}` | pass |
| Malformed tokens (63 chars, uppercase, non-hex, empty, number, null) → `{found: false}` | pass |
| Extra body keys refused | pass |
| Empty body refused | pass |
| 11th request in the window → `429` with a generic message | pass |
| Forged `X-Forwarded-For` does not create a fresh budget | pass |

The QR-payload test is the important one: it proves the image contains the verification URL
rather than asserting it from the source code.

## 3. Browser evidence (`scripts/qr-smoke.mjs`, new — 9 checks)

| Check | Result |
| --- | --- |
| Scanning a valid code opens the page and reports the record as found | pass |
| The token is removed from the visible URL | pass (`http://localhost:4174/verify`) |
| The page exposes no student data | pass (no name, school, DOB, national ID, phone) |
| The page shows nothing beyond a status message | pass (1 line) |
| An unknown token is refused | pass |
| A visit with no token is refused | pass |
| A token supplied as a query parameter is not accepted | pass |
| A second code in the same tab re-verifies instead of keeping the old result | pass |
| No uncaught page errors | pass (a missing favicon is not counted) |

## 4. Defects found and fixed

1. **Stale result across scans (fixed).** `Verification.jsx` verified once on mount, so a
   second code opened in the same tab (a hash-only change, which does not remount the
   component) kept showing the previous result — a valid code followed by an invalid one
   still read "Record found". Verification now re-runs on `hashchange`.
2. **React StrictMode made the first fix wrong (fixed).** Development runs effects twice;
   re-reading the hash inside the effect meant the second pass saw the already-stripped URL
   and reported "invalid". The token is now captured during render and the effect keys on it.
   *This is exactly the kind of bug a compile-only check would have shipped.*
3. **Per-IP limits behind a proxy (hook added).** The limiter keyed on
   `req.socket.remoteAddress`. Behind Azure App Service every request arrives from the
   proxy, so all public users would share one 10-per-15-minutes bucket. `TRUST_PROXY_HOPS`
   now sets Express `trust proxy`; the default (0) keeps today's behaviour exactly, and
   forwarded headers are never trusted unless an operator sets it.

## 5. The phone-camera scan: blocked, and why

A phone cannot reach `http://localhost:4174`, so the QR must point somewhere the phone can
open. `publicAppUrl.js` deliberately refuses every origin that is not public HTTPS — measured
directly:

| `PUBLIC_APP_URL` | `NODE_ENV` | Result |
| --- | --- | --- |
| `http://localhost:4174` | development | accepted |
| `http://127.0.0.1:4174` | development | accepted |
| `http://192.168.56.1:4174` (LAN) | development | **rejected** |
| `http://10.53.13.69:4174` (LAN) | development | **rejected** |
| `https://sbms.azurewebsites.net` | production | accepted |
| `http://sbms.azurewebsites.net` | production | **rejected** |

So a LAN address cannot be used even in development, by design. The camera test therefore
needs one of:

1. **The Azure deployment (recommended).** After Phase 6, set
   `PUBLIC_APP_URL=https://<app>.azurewebsites.net`, register a student, scan, and the phone
   opens the real public page.
2. **A temporary HTTPS tunnel** (`cloudflared`, `ngrok`, …) pointing at `:4174`, with
   `PUBLIC_APP_URL` set to the tunnel URL. This adds an external tool and is only worth it if
   the test cannot wait for Phase 6.

### Camera checklist (to run once a public URL exists)

Prerequisite: `PUBLIC_APP_URL` is the public HTTPS origin and the API has been restarted after
changing it (it is read per request, but restart avoids doubt).

1. Register a new student as a field officer. The confirmation shows the QR image.
2. Scan it with the phone camera at arm's length, in normal indoor light.
3. Expect: the phone opens `https://<origin>/verify`, the address bar **does not** keep
   `#token=…`, and the page shows **"Record found"**.
4. Confirm the page shows no name, school, date of birth, identifier or phone number.
5. Scan an unrelated QR code (a website, a product barcode). Expect "Unable to verify this
   code" — never an error page or a blank screen.
6. Open `/verify` with no token: expect "Unable to verify this code".
7. Open `/verify?token=<the same token>`: expect "Unable to verify this code" (the fragment is
   required, and the query form would leak the token into logs).
8. Scan the same code twice in a row: the second scan must still report "Record found".
9. Ten scans in 15 minutes work; the eleventh should show "Verification is temporarily
   unavailable" rather than a false result.

## 6. Remaining gaps (not claimed as done)

1. **No camera automation.** Steps above must be performed by a person with a phone.
2. **No expiry or revocation.** A token is valid for the lifetime of the student row; there is
   no rotation, disable or "code replaced" flow.
3. **No re-issue path.** `/api/students` exposes only list, read and create, so a student whose
   `qr_token` is `NULL` (a row created before the QR feature, or by a direct insert) has no way
   to be given a code. Seeded demo students do have tokens.
4. **The limiter is in-process.** Counters reset on restart and are not shared between
   instances, so horizontal scaling weakens it; a shared store would be needed for that.
5. **Verification proves existence only.** It does not prove identity, eligibility, approval or
   payment, which is the correct scope but must be stated in the report.

