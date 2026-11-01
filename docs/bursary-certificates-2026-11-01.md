# Bursary award certificates — 1 November 2026

**Scope:** issuing a QR-verifiable certificate for an approved bursary award, the public
verification page, the printable PDF, revocation, and the tests that cover them.
**Result:** the feature is implemented and covered by the automated suite (24 Jest suites /
151 tests pass, frontend production build exits 0). No browser, phone-camera, Azure or
production check is claimed: those were not run in this session and are listed in §8.

## 1. How the flow works

1. An administrator approves a bursary award (`PATCH /api/awards/:id/decision`). Approval is the
   only precondition for a certificate; a pending or rejected award cannot produce one.
2. The administrator issues the certificate from the **Disbursements → Bursary certificates**
   panel (`POST /api/awards/:id/certificate`, optional `{ "award_period": "2026" | "2025/2026" }`).
   The award period defaults to the UTC year of the approval date.
3. Issuing stores a **snapshot row** in `bursary_certificates` and returns the certificate facts,
   the verification URL and a QR data URL. The reference has the form
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
- a certificate can be revoked without touching the decision it certifies;
- `award_id` is `UNIQUE`, so a second certificate for the same award is refused with `409` — a
  lost or spoiled printout is reprinted from the stored row, not reissued with a new identity.

Revocation is a status change (`active` → `revoked`) plus `revoked_by`, `revoked_at` and a reason
of at least 5 characters, enforced by a table `CHECK` constraint as well as by the API. A revoked
certificate cannot be reissued for that award.

## 3. Endpoints and roles

| Method and path | Roles | Behaviour |
| --- | --- | --- |
| `POST /api/awards/:id/certificate` | admin | Issues the certificate. `409` when the award is not approved, already has a certificate, or its student record is missing; `400` for a malformed award period. |
| `GET /api/awards/:id/certificate` | admin, field officer | Staff view plus QR data URL and verification URL; `404` when no certificate exists. |
| `GET /api/awards/:id/certificate.pdf` | admin, field officer | The printable document, `Content-Disposition: attachment`, `Cache-Control: no-store`. |
| `POST /api/awards/:id/certificate/revoke` | admin | `{ reason }`; `404` when no certificate exists, `409` when already revoked. |
| `POST /api/certificates/verify` | public | `{ token }` only. Rate limited to 20 requests per client IP per 15 minutes, before the JSON body parser. |

Issuing and revoking are administrator actions because only an administrator can approve the award
being certified. Field officers read and print, because they hand the document to the student or
the school.

## 4. What the public endpoint answers

| Situation | Response |
| --- | --- |
| Active certificate, award still approved at the same amount | `{ valid: true, status: "verified", certificate_reference, award_period, issued_at, award_approved_at, award_status: "approved", issuing_authority }` |
| Revoked certificate | `{ valid: false, status: "revoked", certificate_reference, award_period, revoked_at, issuing_authority }` |
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
| Field officers read and print, only admins issue and revoke | A certificate must be traceable to the role that owns the decision. |
| Separate 20/15-minute rate-limit budget (`certificateRateLimit`) | A school checking a batch of certificates cannot exhaust the student-record budget (10/15 min), and a certificate scanner cannot lock either one out. |
| Rate limiting mounted before the JSON parser | An abusive client is rejected before the body is parsed. |
| `AWARD_CERTIFICATE_ISSUED` and `AWARD_CERTIFICATE_REVOKED` in `audit_logs` with `table_name = 'bursary_certificates'` | Issue and revocation are accountable events, not silent edits. |
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
  after the approved amount changes, revocation (officer `403`, short reason `400`, unknown award
  `404`, second revocation `409`), the award itself staying approved at the same amount, and the
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
- Revocation is visible only to the certificate verification endpoint and the staff view. It never
  changes the award decision or any payment record.
