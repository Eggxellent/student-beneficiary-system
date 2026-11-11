# Bursary award certificates — 1 November 2026

**Scope:** issuing a QR-verifiable certificate for an approved bursary award, the public
verification page, the printable PDF, revocation, and the tests that cover them.
**Result:** the feature is implemented and covered by the automated suite (24 Jest suites /
151 tests pass, frontend production build exits 0). No browser, phone-camera, Azure or
production check is claimed: those were not run in this session and are listed in §8.

> **5 November 2026 — §1 item 3, §4, §5 and the "no student data in the public answer" row of §6
> describe the 1 November behaviour and are superseded by §10.** The certificate was redesigned, a
> human-readable reference with manual verification was added, and the public answer now shows the
> facts printed on the paper. §10 is the current description; the earlier sections are kept because
> they record why the first design was built the way it was.

## 1. How the flow works

1. An administrator approves a bursary award (`PATCH /api/awards/:id/decision`). Approval is the
   only precondition for a certificate; a pending or rejected award cannot produce one.
2. Approval issues the certificate in the same transaction: the decision handler writes the
   **snapshot row** to `bursary_certificates` and an `AWARD_CERTIFICATE_ISSUED` audit event, then
   returns `certificate_reference` in the decision response. The award period defaults to the UTC
   year of the approval date and can be overridden with `{ "award_period": "2026" | "2025/2026" }`.
   A rejection produces no certificate. `POST /api/awards/:id/certificate` remains as an
   administrator-only retry/backfill path for an approved award that has no row yet (`409` when a
   certificate already exists).
3. `GET /api/awards/:id/certificate` returns the stored certificate facts, the verification URL and
   a QR data URL. The reference has the form
   `SBMS-CERT-<year>-<8 uppercase hex>` (for example `SBMS-CERT-2026-1A2B3C4D`), where the hex
   part is `randomBytes(4)`, not a sequence number.
4. The QR code encodes `PUBLIC_APP_URL + '/verify-certificate#token=<64 hex>'`. The token is
   `randomBytes(32).toString('hex')` and, like the student QR, lives in the **fragment**, so it is
   never sent to a web server, never written to an access log and never forwarded as a `Referer`.
5. `/verify-certificate` reads the fragment, removes it from the visible URL with
   `history.replaceState`, and POSTs `{ token }` to `/api/certificates/verify` — a public endpoint
   with its own rate-limit budget.
6. The PDF (`GET /api/awards/:id/certificate.pdf`) is rendered on demand with pdfkit + qrcode on
   A4 landscape, so the printed sheet carries the same QR code as the screen.

## 2. Why the certificate is its own table

An award is a decision; a certificate is a document that was issued and handed to a person.
`bursary_awards` therefore stays the single source of truth for the decision, and the certificate
copies the facts it prints (`student_name`, `student_upi`, `school_code`, `approved_amount`,
`award_approved_at`). The consequences are deliberate:

- a later edit to the award cannot silently rewrite what a printed certificate says;
- verification compares the snapshot with the live award, and reports `not_current` instead of
  `verified` when the award is no longer approved or its approved amount has changed;
- revocation is out of scope: the printed document keeps verifying as long as the award it certifies
  stands, and stops verifying when the award is no longer approved at the same amount;
- `award_id` is `UNIQUE`, so a second certificate for the same award is refused with `409` — a
  lost or spoiled printout is reprinted from the stored row, not reissued with a new identity.

There is no revocation status, endpoint or screen. The `status` column still exists and still reads
`active` for every issued certificate; nothing in the application can change it (see §10.13).

## 3. Endpoints and roles

| Method and path | Roles | Behaviour |
| --- | --- | --- |
| `POST /api/awards/:id/certificate` | admin | Retry/backfill for an approved award that has no certificate. `409` when the award is not approved, already has a certificate, or its student record is missing; `400` for a malformed award period. Normal issuance happens during approval. |
| `GET /api/awards/:id/certificate` | admin; field officer who proposed the award | Staff view plus QR data URL and verification URL; `404` when no certificate exists; `403` for any other field officer; `409` when the award is no longer approved. |
| `GET /api/awards/:id/certificate.pdf` | admin; field officer who proposed the award | The printable document, `Content-Disposition: attachment`, `Cache-Control: no-store`; same `403`/`409` refusals as the staff view. |
| `POST /api/certificates/verify` | public | `{ token }` only. Rate limited to 20 requests per client IP per 15 minutes, before the JSON body parser. |

Issuance is an administrator action because only an administrator can approve the award being
certified. Field officers read and print, but only for awards they proposed themselves: the staff
view and the PDF both compare the certificate's award `submitted_by` with the caller and answer
`403` for any other officer, so one officer cannot read or print a colleague's beneficiary
certificate. Administrators can read and print every certificate.

## 4. What the public endpoint answers

| Situation | Response |
| --- | --- |
| Active certificate, award still approved at the same amount | `{ valid: true, status: "verified", certificate_reference, award_period, issued_at, award_approved_at, award_status: "approved", issuing_authority }` |
| Award no longer approved, or approved amount changed after issue | `{ valid: false, status: "not_current", certificate_reference, issuing_authority }` |
| Malformed, unknown or manipulated token | `{ valid: false, status: "not_recognised" }` — identical in every case |

The public answer never contains the student's name, UPI, school, date of birth, phone number or the
award amount: whoever scans a printed certificate may be a stranger. `not_recognised` is
deliberately the same for a malformed token and a well-formed token that was never issued, so the
endpoint is not an oracle for token validity. Database failures return a generic `503` without
echoing the token.

## 5. What the PDF says

The document is A4 landscape, drawn with the application palette, and contains only facts the
system actually holds:

- the title **Bursary Award Certificate** and the line "certificate of authenticity for an
  approved bursary award";
- the student's name, UPI and school code exactly as stored;
- certificate reference, award period, approved amount, award approval date, date issued and the
  issuing administrator's name;
- the QR code, the verification URL in 7 pt under it, and the sentence that the result is answered
  live from the SBMS database;
- a boxed statement **APPROVAL IS NOT PAYMENT** explaining that only a cleared payment in SBMS is
  evidence that money was released;
- "Electronically issued by SBMS. No handwritten signature or institutional seal is required".

No invented coat of arms, signature image, seal or sequence number is drawn: the project cannot
honestly produce them, and a fake seal on a bursary document would be worse than none. The PDF is
built into a `Buffer` before the response is written, so a rendering failure becomes a JSON error
rather than a truncated file.

## 6. Security decisions

| Decision | Reason |
| --- | --- |
| Token in the URL fragment, not the path or query | Fragments are never sent to a server, so the token stays out of access logs, proxy logs and `Referer` headers. |
| 32 random bytes, `^[a-f0-9]{64}$`, no reuse across the two verification endpoints | Guessing is infeasible; a student QR token can never be replayed against the certificate endpoint. |
| Identical `not_recognised` answer for malformed and unknown tokens | Prevents the endpoint from confirming that a guessed token exists. |
| No student data in the public answer, and no award amount | Anyone who scans the paper can call the endpoint; authenticity does not require personal data. |
| Field officers read and print, only admins issue | A certificate must be traceable to the role that owns the decision. |
| Separate 20/15-minute rate-limit budget (`certificateRateLimit`) | A school checking a batch of certificates cannot exhaust the student-record budget (10/15 min), and a certificate scanner cannot lock either one out. |
| Rate limiting mounted before the JSON parser | An abusive client is rejected before the body is parsed. |
| `AWARD_CERTIFICATE_ISSUED` in `audit_logs` with `table_name = 'bursary_certificates'` | Issuing is an accountable event, not a silent insert. |
| `PUBLIC_APP_URL` validated before the row is written | A misconfigured origin fails the request instead of leaving a certificate whose QR code cannot be reached. |

## 7. Automated coverage

| Command | Result |
| --- | --- |
| `npx jest --runInBand tests` (backend, `NODE_ENV=test`, `backend/.env.test` loaded) | **24 suites / 151 tests passed** |
| `npm.cmd --prefix frontend run build` | **exit 0**, 2,006 modules, `dist` written |

Suites that exist because of this feature:

- `backend/tests/bursaryCertificates.test.js` — approval as precondition (`409` before approval,
  for rejected awards, and for an award whose student record is missing), the QR payload being
  `/verify-certificate#token=…`, the public answer shape for a valid certificate, `not_current`
  after the approved amount changes, the absence of any revocation route (`404`, and the certificate
  still verifying afterwards), the award itself staying approved at the same amount, and the
  audit rows.
- `backend/tests/certificateVerificationRoute.test.js` — the public route's contract: exact body
  shape, malformed and unknown tokens, the limiter answering `429` with a generic message, and no
  student data in any response.
- `backend/tests/schemaReadiness.test.js` — the readiness contract now lists
  `bursary_certificates`, so `GET /api/ready` fails closed if the migration was not applied.

The migration `backend/src/db/migrations/20261031_bursary_certificates.sql` is registered in
`backend/scripts/migrate.js` and in the readiness contract. It is not applied automatically: an
authorised operator applies it after backing up and verifying a restore, as with every other
migration in this repository.

## 8. What is not verified

| Item | Status |
| --- | --- |
| Headless-browser check of `/verify-certificate` (`scripts/qr-smoke.mjs` covers `/verify` only) | **NOT RUN** — no Chrome DevTools session, API or dev server was running in this session |
| Phone-camera scan of a printed certificate | **NOT RUN** — needs a public HTTPS origin |
| Print output on a physical printer | **NOT RUN** — only the generated PDF bytes are covered |
| Azure/production behaviour | **NOT RUN** |
| UAT with real students, schools or guardians | **NOT RUN** |

The certificate panel and the verification page are therefore verified by build, by unit and
integration tests over the real HTTP surface, and by the response contracts above — not by a human
looking at them.

## 9. Operator notes

- `PUBLIC_APP_URL` must be the public HTTPS frontend origin. Certificate QR codes are built from it
  exactly like student QR codes, and a wrong value is rejected at issue time.
- Apply `20261031_bursary_certificates.sql` before the endpoints are used; until then
  `GET /api/ready` reports not ready and issuing fails.
- The PDF is generated per request and is not stored on disk: nothing to back up or leak, at the
  cost of a few milliseconds per download.
- There is no revocation path. The only way a certificate stops verifying is a change to the award it
  certifies (a withdrawal of approval or a different approved amount), and even then the original
  decision and every payment record stay untouched.

## 10. Redesign — 5 November 2026

This section supersedes §1 item 3, §4, §5 and the "no student data in the public answer" row of §6.

### 10.1 What was missing

| Gap | Consequence before this change |
| --- | --- |
| Only the QR token could verify a certificate | A creased, rained-on or badly printed code left a school with no way to check the paper |
| Reference had 32 bits of entropy and was ungrouped (`SBMS-CERT-2026-1A2B3C4D`) | Short and ugly to read aloud; no way to look one up |
| PDF was a report: Helvetica on white, no frame, packed 8 pt facts, token URL printed in full | It did not look like a certificate, and the printed URL leaked the QR token as text |
| Public answer confirmed authenticity but showed no facts | The reader could not compare the paper with the record, so a copied reference on an altered document was undetectable |

### 10.2 The document

A4 landscape (841.89 × 595.28 pt), always one page, drawn entirely from vector primitives, text and
one embedded PNG QR code — no external image URLs, so a certificate downloaded today still renders
the same way offline.

| Element | Design |
| --- | --- |
| Paper | Ivory `#FCFAF3` sheet |
| Border | 2.6 pt navy `#12294A` rule at the paper edge, 0.8 pt muted-gold `#AE8B3C` rule inset 8 pt, ornamental L-flourishes with gold lozenges in all four corners |
| Heading | "CERTIFICATE" in Times-Bold 38 pt, letter-spaced, over "OF BURSARY AWARD" in muted gold |
| Preamble | "This is to certify that" in Times-Italic |
| Beneficiary name | Times-Bold, 32 pt, centred, shrunk in steps to 16 pt so a long name stays on one line instead of colliding with the facts grid |
| Statement | "has been recognised as an approved beneficiary of the <programme>, having received an approved bursary award as recorded in the Student Beneficiary Management System." |
| Award facts | Three-column grid of label/value pairs, separated by hairline rules: institution, academic year, approved amount in KSh, constituency (only when configured), date of issue, award approval date |
| Seal | A generic rosette with two tapered tails and the words SBMS / BURSARY / AWARD — explicitly not a coat of arms or state emblem |
| Authorisation | "AUTHORISED SIGNATORY" block with name, designation and signature rule **only when a real signatory is configured**; otherwise "Issued electronically by SBMS. No handwritten signature or ink seal is required for this certificate." |
| Verification block | 84 pt QR code, "SCAN TO VERIFY", the certificate reference at 10 pt Times-Bold, and the manual page address |
| Small print | "Approval is not payment… and is not a government seal or endorsement." |

The layout is measured before it is drawn: the name height is computed, the statement's font size is
chosen so it fits above the facts grid, and the facts grid and verification band sit on fixed
anchors. That is why a 68-character beneficiary name still produces a single page (tested).

The PDF `CreationDate` is pinned to the certificate's issue date, so downloading the same issued
certificate twice produces **byte-identical** output: a reprint cannot be passed off as a second,
different document.

### 10.3 Two independent verification methods

| Property | Printed reference | QR token |
| --- | --- | --- |
| Format | `SBMS-2026-K8M4-X7PQ-2RZ` | 64 lowercase hex characters, inside the URL fragment of `https://<PUBLIC_APP_URL>/verify-certificate#token=…` |
| Entropy | 11 symbols from a 32-symbol alphabet (`23456789A–Z` without `0`, `O`, `1`, `I`) = 55 bits | 32 random bytes = 256 bits |
| Generated by | `crypto.randomInt` per symbol (`services/certificateReference.js`) | `crypto.randomBytes(32)` |
| Uniqueness | `bursary_certificates.certificate_reference` is `UNIQUE`; an insert that loses a race is retried inside a savepoint, up to five times | `verification_token` is `UNIQUE`, and a `CHECK` constraint pins the shape |
| Guessable / sequential | No: nothing about it derives from a row number, date or award | No |
| What it identifies | The certificate row (one student may hold several certificates) | The certificate row |
| Where it is read from | Typed from the paper by a person | Scanned from the paper |
| Logged | Never (it is the query key) | Never: it lives in the fragment, so it never reaches a server log, and the API never logs the submitted value |

Legacy certificates in the old `SBMS-CERT-2026-1A2B3C4D` shape are still accepted by the normaliser,
so paper already in circulation keeps verifying. No historical row is rewritten.

### 10.4 Manual verification

`POST /api/certificates/verify` accepts **exactly one** key. `{ "token": "<64 hex>" }` is the QR
path; `{ "reference": "…" }` is the typed path. Both resolve to the same row through the same
handler and produce the same answer.

The typed value is normalised before it is used as a query key: trimmed, upper-cased, and stripped
of spaces and dashes, so `sbms-2026-k8m4-x7pq-2rz`, `SBMS 2026 K8M4 X7PQ 2RZ` and the bare
`2026K8M4X7PQ2RZ` all reach the same certificate. Characters outside the alphabet are **not**
forgiven — guessing which symbol a person meant would widen the search space for anyone probing the
endpoint. A value that cannot be a reference, a well-formed reference that does not exist, a
tampered token and an unknown token all answer `{ valid: false, status: "not_recognised" }`, so the
endpoint is not an oracle for which references exist.

Lookups share the route's existing budget: 20 requests per client IP per 15 minutes, enforced before
the JSON body is parsed. A reference is checked in the same bucket as a QR scan, so neither path can
be used to brute-force around the other, and at 55 bits of entropy a guessing campaign would need
more requests than the limiter allows in a geological age.

### 10.5 What the public page now shows — a deliberate disclosure decision

A certificate is handed to a school or an employer precisely so those facts can be read, and a page
that shows nothing cannot be used to detect a document whose printed details were altered. The
public answer therefore now includes the facts printed on the paper:

| Returned for a current certificate | Never returned |
| --- | --- |
| `certificate_reference`, `beneficiary_name`, `institution`, `programme`, `constituency` (null unless configured), `award_period`, `approved_amount`, `issued_at`, `award_approved_at`, `status`, `valid`, `issuing_authority` | UPI or any other student identifier, national ID, birth certificate number, date of birth, guardian or phone details, home address, supporting-document references, duplicate-detection scores or flags, administrative notes, `award_id`, certificate `id`, `verification_token` |

A certificate whose award changed after issue answers `not_current` with the reference only.

This replaces the earlier "no name, school or amount" policy. It is one decision in one place —
`publicView()` in `backend/src/controllers/certificates.controller.js` — and the exact key set is
pinned by `backend/tests/bursaryCertificates.test.js`, so reversing the decision is a small,
test-visible change rather than an archaeology exercise.

### 10.6 Forgery and tampering

- The page never trusts the code it was given: it looks the row up and reports what the database
  says, so a QR code or reference copied onto an altered document resolves to the original record.
- The page states, in a warning block, that the name, institution, academic year, amount and
  reference on the paper must all match, and that a match does not validate printed details that
  differ.
- The page says that only the answer it shows, checked just now, is authoritative — not a
  screenshot of it.
- A certificate whose award is no longer approved, or whose approved amount changed after issue,
  answers `not_current` instead of `verified`.
- **No cryptographic PDF signature is implemented.** The PDF is authenticatable through the
  database, not through a signature embedded in the file, and no document in this repository claims
  otherwise.

### 10.7 Lifecycle and permissions

Unchanged: an approved award is the only precondition for a certificate, `award_id` is `UNIQUE` so
one award yields one certificate, and only an administrator approves. The approval transaction now
writes the certificate itself, so the administrator no longer issues it from a panel; the
`POST /api/awards/:id/certificate` route is a retry/backfill for an approved award that somehow has
no row. Field officers read and print only the certificates of awards they proposed (every other
officer gets `403`), and administrators read and print all of them. There is no revocation step, no
reinstatement and no second certificate type. The suite re-checks the other-officer `403`, the
pending/rejected `404`, the second-issue `409`, and that no revocation route answers anything but
`404`.

### 10.8 Configuration

| Variable | Effect |
| --- | --- |
| `SBMS_BURSARY_PROGRAMME` | Programme name printed on the certificate and returned as `programme`. Defaults to `NG-CDF bursary programme`. |
| `SBMS_CONSTITUENCY` | When set, printed in the identity line and the facts grid. Unset means the certificate simply omits it — no placeholder is drawn. |
| `SBMS_SIGNATORY_NAME`, `SBMS_SIGNATORY_TITLE` | When a name is set, the authorisation block prints it with a signature rule. Until then the certificate states that it was issued electronically. |

Nothing in this list invents a signatory, a constituency, a crest or a government endorsement: an
unconfigured deployment produces a plain typographic certificate.

### 10.9 Tests and build

| Command | Result |
| --- | --- |
| `npx jest --runInBand tests/certificateDocument.test.js tests/certificateReference.test.js tests/certificateVerificationRoute.test.js tests/bursaryCertificates.test.js` (`NODE_ENV=test`, `backend/.env.test` loaded) | **36 tests passed, 0 failed** |
| `npx jest --runInBand tests/workflow.test.js tests/verification.test.js tests/roleAuthorization.test.js tests/verificationRoute.test.js tests/schemaReadiness.test.js` | **33 tests passed, 0 failed** |
| `npm.cmd --prefix frontend run build` | **exit 0**, built in 13.9 s, `assets/index-CwXnarJe.js` |

New coverage added by the redesign:

- `tests/certificateReference.test.js` — format and grouping, the ambiguous characters that are
  excluded, 2 000 generated references with no collisions, non-sequential bodies, the injected
  randomness source, rejected years, and every normalisation and rejection case (canonical, lower
  case, spaces, prefix omitted, legacy shape, wrong length, characters outside the alphabet,
  non-string input).
- `tests/certificateDocument.test.js` — the content builder prints only stored facts, omits missing
  ones instead of writing a placeholder, contains no UPI, national ID or token, and prints no
  constituency or signatory when the deployment has not configured one; the PDF is one A4 landscape
  page with `MediaBox [0 0 841.89 595.28]`, embeds the QR at 560 px, contains no `/URI` link, is
  byte-identical across two renders, and still fits on one page when the beneficiary name is 68
  characters long.
- `tests/bursaryCertificates.test.js` — the public answer now carries the disclosed facts and no
  identifiers; the typed reference resolves to the same body as the QR token (including lower case,
  padding, spaces instead of dashes and the bare code); unknown or impossible references answer
  `not_recognised`; two certificates never share a reference; the PDF is one page, has no external
  link, and a re-download is byte-identical.
- `tests/certificateVerificationRoute.test.js` — the manual-reference path sits behind the same rate
  limiter, so exhausting the budget with QR lookups also throttles reference lookups.

The PDF test file raises its jest timeout to 120 s. Rendering takes a few hundred milliseconds in the
API process but roughly 18 s inside jest's module sandbox, because the QR encoder is a per-pixel
JavaScript loop; the timeout covers the sandbox, not production behaviour.

### 10.10 Everything that changed

No migration and no schema change: `certificate_reference`, its `UNIQUE` constraint, the token
`CHECK` constraint and `award_id UNIQUE` were already correct, and existing rows (old reference
shape) keep working.

| Path | Change |
| --- | --- |
| `backend/src/services/certificateReference.js` | New: generation and normalisation of the printed reference |
| `backend/src/config/certificateIdentity.js` | New: programme/constituency/signatory resolved from configuration, never invented |
| `backend/src/services/certificateDocument.js` | Rewritten: the designed certificate, the content builder, deterministic PDF bytes, QR embedded at 560 px |
| `backend/src/controllers/certificates.controller.js` | New reference generation with savepoint retry, expanded `publicView`, token-or-reference verification |
| `backend/src/models/bursaryCertificate.model.js` | `findByReference` |
| `backend/src/config/publicAppUrl.js` | `buildCertificateVerificationPageUrl` (the URL printed under the QR) |
| `frontend/src/pages/CertificateVerification.jsx` | Manual reference entry, verified / not-current / not-found states, compare-the-paper warning |
| `frontend/src/components/PublicVerificationLayout.jsx` | Privacy sentence corrected to what the pages actually withhold |
| `frontend/src/components/AwardCertificatePanel.jsx` | Shows the manual verification page, not just the QR link |
| `backend/tests/certificateReference.test.js`, `backend/tests/certificateDocument.test.js` | New suites |
| `backend/tests/bursaryCertificates.test.js`, `backend/tests/certificateVerificationRoute.test.js` | Updated for the new contract |

### 10.11 Deployment and live verification

| Item | Result |
| --- | --- |
| Commit | `b4de909` on `fix/sbms-completion-work`, pushed |
| API image build | GitHub Actions run `42042738945` — **success** |
| Image deployed | `ghcr.io/eggxellent/sbms-api:b4de9092bc94f45bef8f81cafac146693cb9a693` on `ca-sbms-api` (revision `ca-sbms-api--latest`), image tag confirmed by reading the container app back |
| `GET /api/health` | **200** `{"status":"ok"}` |
| `GET /api/ready` | **200** `{"status":"ready"}` |
| `POST /api/certificates/verify` `{"reference":"SBMS-2026-2222-2222-222"}` | **200** `{"valid":false,"status":"not_recognised"}` |
| `POST /api/certificates/verify` `{"reference":"not-a-reference"}` | **200** `{"valid":false,"status":"not_recognised"}` |
| `POST /api/certificates/verify` `{"token":"aaa…"}` | **200** `{"valid":false,"status":"not_recognised"}` |
| `GET /api/awards/:id/certificate.pdf` without a token | **401** |
| `GET /api/disbursements` | **404** — no payment or disbursement surface was reintroduced |
| Frontend | zip deployed to `sbms-web` (rg-sbms); `/verify-certificate` returns **200** serving `assets/index-CwXnarJe.js`, and the deployed bundle contains the new strings ("Check a certificate reference", "Compare the document before relying on it", "Certificate not found"). That image also still contains the revoked-certificate wording later removed in §10.13. |

### 10.12 Still not verified

| Item | Status |
| --- | --- |
| Issuing a certificate on production and scanning the printed QR with a phone | **NOT RUN** — needs an approved award and an administrator session on the live deployment |
| Physical print on A4 landscape paper | **NOT RUN** — only the generated PDF bytes and a rendered raster were inspected |
| Cryptographic signature on the PDF (PAdES/CMS) | **NOT IMPLEMENTED** — deliberately not claimed anywhere in the document, the interface or this report |
| Visual regression of the frontend page in a browser | **NOT RUN** — covered by the production build and the deployed bundle strings only |

### 10.13 Revocation removed — 5 November 2026

Revocation is out of the SBMS scope, so the functionality was removed rather than documented. One
approved award produces one certificate; that certificate is downloaded, issued and verified, and
nothing in the application can withdraw it.

| Removed | Where |
| --- | --- |
| `POST /api/awards/:id/certificate/revoke` route and handler | `backend/src/routes/bursaryAwards.routes.js`, `backend/src/controllers/certificates.controller.js` |
| `revoke()` model function | `backend/src/models/bursaryCertificate.model.js` |
| `revoked` branch in `publicView()`, `revoked_at` / `revocation_reason` in `staffView()` | `backend/src/controllers/certificates.controller.js` |
| `AWARD_CERTIFICATE_REVOKED` audit action | controller |
| Revoke button, reason form, "Revoked" chip, revocation-reason row | `frontend/src/components/AwardCertificatePanel.jsx` |
| Revoked result block on the public page | `frontend/src/pages/CertificateVerification.jsx` |
| Revoked-certificate screenshot requirement | `docs/screenshot-capture-runbook-2026-11-05.md`, `academic-report-evidence/final-revalidation/SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` |

Preserved: the `status`, `revoked_by`, `revoked_at` and `revocation_reason` columns (no migration,
no record deleted), `AWARD_CERTIFICATE_ISSUED`, the one-certificate-per-award rule, the approval
precondition, the role permissions, PDF generation and download, and the whole verification surface
including the student-record QR feature.

Chapter 5 evidence is now three figures: 5.1 a certificate issued for an approved award, 5.2 the
generated PDF, 5.3 public verification showing a **successfully verified** certificate. No
revoked-certificate screenshot is required.

Verification of this change, 5 November 2026:

| Command | Result |
| --- | --- |
| `npx jest --runInBand tests/bursaryCertificates.test.js tests/certificateVerificationRoute.test.js` (`NODE_ENV=test`, `backend/.env.test` loaded) | **2 suites, 20 tests passed** |
| `npm run build` (frontend) | **exit 0**, 2 006 modules, built in 10.1 s |

Not verified: the Azure deployment. It was not redeployed for this change, so the running API still
exposes the revoke route until a new image is published and the frontend bundle is replaced. Nothing
in this document claims the removal is live.




