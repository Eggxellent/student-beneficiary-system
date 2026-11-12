# SBMS — Current Project State (source of truth for revising Chapters 4, 5 and 6)

**Prepared:** 2026-11-11
**Repository:** `student-beneficiary-system` (this file is at its root)
**Branch / commit inspected:** `fix/sbms-completion-work` at `d229c623e718b5fbbc723d4802d1b9ae756813f7`, working tree clean
**Scope note:** this describes **SBMS** (Student Beneficiary Management System). It is not the Flood
Monitoring System and shares no code with it.

**Evidence rule used here:** every statement is backed by a file in this repository, by a command run
while preparing this document, or is explicitly marked `UNVERIFIED` / `NOT IMPLEMENTED`. Nothing is
inferred from the proposal where the code disagrees with it.

---

## 0. One-paragraph position

SBMS is a role-based bursary case-management system: a Field Officer registers a student, the system
screens the record for duplicates with a Python/XGBoost model, an officer records an eligibility
assessment and proposes an award amount, an administrator approves or rejects it, and approval
automatically issues a QR-verifiable bursary certificate that the proposing officer prints and hands
over. Public verification of the certificate (QR **or** typed reference) and of the student record
(QR only) are public, unauthenticated endpoints. **SBMS records decisions and documents; it does not
move money.** The payment/disbursement module that earlier drafts described was removed on
2026-11-11 (commit `5b319ce`, "simplify SBMS to core beneficiary management scope").

---

## 1. Retained features (all present in the inspected commit)

| # | Feature | Purpose | How it is implemented now |
|---|---|---|---|
| 1 | Authentication and roles | Only authorised officers act on beneficiary data | `POST /api/auth/login`, `POST /api/auth/register` (field-officer self-service only); bcrypt cost 12; 8-hour JWT; `middleware/auth.js` verifies the token **and reloads the role from `users`** each request, so a stale claim cannot grant rights; `users.is_active` blocks suspended accounts; login rate limited |
| 2 | Student registration | Creates the beneficiary record | `POST /api/students` (field officer only), Zod validation, server-generated `qr_token` (32 random bytes, hex), QR image returned as a data URL pointing at `PUBLIC_APP_URL/verify#token=…`; duplicate screening runs **before** insert inside one transaction with an advisory lock |
| 3 | Duplicate detection (ML) | Surfaces possible re-registrations for human review | Node spawns `ml-service/predict.py --server` as a child process and streams JSON lines over stdin/stdout (a long-lived Python process, not an HTTP microservice); six ordered features; score ≥ `ML_REVIEW_SCORE_THRESHOLD` (default 0.50) qualifies a candidate; aggregation policy `top-1` writes **at most one** `duplicate_flags` row per registration |
| 4 | Duplicate review | A human decides, never the model | `/api/duplicate-flags` (admin only): list, `GET /:id/identifiers` (reveals UPI / birth-certificate / national ID to an admin), `PATCH /:id` decision with reviewer and reason, `POST /evaluate` (score an ad-hoc pair), `POST /scan` (re-scan existing registry); statuses `pending`, `needs_verification`, `confirmed_duplicate`, `not_duplicate` |
| 5 | Eligibility assessment and recommended range | Turns need indicators into a review aid | `POST /api/eligibility` (field officer, requires `student_id`), five weighted factors summing to 100 → `high` (70–100), `moderate` (40–69), `low` (0–39); writes score, category and timestamp to the student row plus an `ELIGIBILITY_CALCULATED` audit entry; range is configuration (`ELIGIBILITY_RANGE_*`), never approval |
| 6 | Bursary award proposal by the field officer | Recommends the amount; approval stays with the admin | `POST /api/awards` (`field_officer` only) stores `student_id`, `requested_amount` and the student's `school_code` with status `submitted`; the officer cannot approve their own proposal. No separate verification step exists |
| 7 | Award proposal and decision | Separates proposing from approving | `POST /api/awards` (field officer; DB value `submitted`, UI wording "Proposed (awaiting approval)"); repeat proposals are gated behind a confirmation — a student whose award is `approved` (or still `submitted`) gets `409` `EXISTING_ALLOCATION` and a retry with `confirm_duplicate_allocation: true`, and `Awards.jsx` labels them "(already has a bursary)"; `PATCH /api/awards/:id/decision` (admin; `approved`/`rejected` with reason); approval refuses `submitted_by === req.user.id` |
| 8 | Automatic certificate on approval | Produces the document at the decision | The decision transaction calls `services/certificateIssue.js`, which writes the `bursary_certificates` snapshot row, a 64-hex verification token, a human reference and an `AWARD_CERTIFICATE_ISSUED` audit row, and returns `certificate_reference` in the decision response |
| 9 | Certificate view / print for issue | Officer hands the paper to the school | `GET /api/awards/:id/certificate` (facts + QR data URL) and `GET /api/awards/:id/certificate.pdf` (on-demand PDF, `no-store`), restricted to admins and to the officer who proposed that award (`403` otherwise; `409` if the award is no longer approved); UI `AwardCertificatePanel.jsx` on the Awards page |
| 10 | Public certificate verification | Anyone holding the paper can check it | `POST /api/certificates/verify` accepts exactly one of `{ token }` (QR) or `{ reference }` (typed); reference normalisation (trim, upper-case, strip spaces/dashes); answers `verified` / `not_current` / `not_recognised`; 20 requests per IP per 15 minutes before the body parser; page `/verify-certificate` strips the fragment via `history.replaceState` |
| 11 | Public student-record verification | Confirms a student record exists | `POST /api/verify` with a 64-hex token, answers `{ found }` only, no student details; page `/verify`; separate 10/15-minute limiter |
| 12 | Dashboards | Role-specific landing surfaces | `AdminDashboard.jsx` (`/dashboard`) and `FieldOfficerDashboard.jsx` (`/field-officer`); data from `GET /api/admin/dashboard` |
| 13 | Reports | Printable case file | `GET /api/reports` → `services/reportDocument.js` renders a styled multi-section PDF (summary, eligibility, awards, duplicate cases, audit) with `pdfkit`; date range validated |
| 14 | Audit trail | Accountability for decisions | `audit_logs` written by `services/auditLog.js` for registration, duplicate decisions, eligibility, awards, verification, certificate issue, user and settings changes; `GET /api/audit-logs` (admin), page `AuditLogs.jsx` |
| 15 | Settings | Admin-tunable duplicate threshold | `GET/PUT /api/settings/threshold` (admin) sets the three thresholds in the running process and audits the change (`ADMIN_UPDATE_DUPLICATE_THRESHOLDS`); the values are **in-memory only** — a restart restores the environment/default values. Page `Settings.jsx`; field officers cannot see the scoring formula |
| 16 | User management | Officer accounts | `GET/POST /api/users`, `PATCH /api/users/:id/role`, `DELETE /api/users/:id` (admin only), page `UserManagement.jsx`; public admin registration disabled |
| 17 | Notifications | Tells the right person what happened | **New in this commit.** `notifications` table; admins are notified of each proposal, the proposing officer of the decision and of certificate readiness; `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, every query scoped to `req.user.id`; `NotificationBell.jsx` renders the dropdown for both roles |
| 18 | Operational endpoints | Health and readiness | `GET /api/health` (liveness) and `GET /api/ready` (checks configured database name and required tables, including `bursary_certificates` and `notifications`) |
| 19 | Legacy beneficiary compatibility API | Keeps older records readable | `/api/beneficiaries` is **still mounted** (`backend/src/index.js`) against the legacy `beneficiaries` table created by `20261025_legacy_beneficiaries_baseline.sql`. It is not the primary workflow and must not be presented as the main beneficiary module |

---

## 2. Removed features — do not describe these as part of the system

| Removed | Evidence | What Chapters 4–6 must stop saying |
|---|---|---|
| **Payments / disbursements / reconciliation** (`disbursements` table, `disbursement_reconciliation_events`, `disbursements.controller.js`, `models/disbursement.model.js`, `routes/disbursements.routes.js`, `services/bursaryRules.js`, `config/reconciliation.js`, `pages/Disbursements.jsx`, three Jest suites) | Deleted in commit `5b319ce` ("simplify SBMS to core beneficiary management scope"); the files are absent from `backend/src` and `frontend/src` at HEAD | No "payment issued / cleared / acknowledged / discrepancy" states, no `/api/disbursements`, no reconciliation screen or report section, no `POST /api/awards/:id/payment`. Chapters 4 and 5 FR-16…FR-19, the schema table listing `disbursements`, and any screenshot of a Disbursements page are obsolete |
| **Payment-derived dashboard and report figures** | `adminDashboard.controller.js` and `reports.controller.js` no longer reference disbursements | Remove "six-month disbursement trend" and "disbursement detail list" from dashboard/report descriptions |
| **Duplicate-case assignment to an officer** | Migration `20261019_remove_duplicate_case_assignment.sql` | Duplicate cases have no assignee column, no assignment endpoint and no "assigned to me" queue |
| **Separate verification router file** | `backend/src/routes/verification.routes.js` deleted in `d0aa56c` | `POST /api/verify` still exists, but it is declared inline in `backend/src/index.js`. Do not cite a verification router module |
| **Beneficiary selection / approved-list import** | Scope decision recorded in `docs/beneficiary-processing-workflow-2026-11-05.md` §"Scope decision" | SBMS does **not** select beneficiaries and has no `beneficiary_selections` table, award-period table or list-import endpoint. Selection happens outside the system and the officer registers the resulting students |
| **Beneficiary verification stage** (`POST /api/awards/:id/verification`, `recordVerification`, `bursary_awards_verification_events`, `verification_status` gate) | Removed in the current working tree: the route, controller function, `Awards.jsx` verify panel and the `bursary_awards_approval_verification_check` database constraint (`20261111_remove_award_verification_gate.sql`). The columns and event table are retained but never written | No "Verify beneficiary" step, no verification status column or evidence reference in the workflow; a field officer proposes and an administrator approves. Do not describe an officer verifying their own proposal |
| **Certificate revocation / reinstatement** | No route, column value change or UI exists (`docs/bursary-certificates-2026-11-01.md` §2, §10.7) | There is no revocation status, endpoint or screen; `status` is `active` for every issued certificate and nothing can change it |
| **Public administrator self-registration** | `auth.routes.js` exposes field-officer registration only | Admin accounts are provisioned privately (bootstrap script / user management) |
| **Rendered report PDFs committed to the repo** (24 files under `docs/final-documentation-content/pdf`) | Commit `cca0625` pruned them from 28 to 4 | Do not reference deleted PDF artifacts as evidence |

---

## 3. Changed features — previous behaviour vs behaviour at this commit

| Area | Earlier documented behaviour | Current behaviour |
|---|---|---|
| Duplicate flag volume | One `duplicate_flags` row for **every** candidate pair scoring ≥ threshold. With N students and per-pair false-positive rate p, a legitimate registration was flagged with probability `1−(1−p)^N` (29.6% at N=100, 82.7% at N=500 at p=0.0035) | `backend/src/services/duplicateAggregation.js` selects flags from already-scored candidates. Default policy `top-1`: **at most one flag per registration**, the best qualifying candidate, ranking exact identifier agreement (UPI / birth certificate / national ID) above model score. `top-1-corroborated` exists but is EXPERIMENTAL and unevaluated; `all` reproduces the old behaviour and exists only for comparison. Selected with `DUPLICATE_AGGREGATION_POLICY` |
| Duplicate threshold | Single high-priority threshold | Three configured values: `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (0.70), `DUPLICATE_REVIEW_THRESHOLD` (0.30), `ML_REVIEW_SCORE_THRESHOLD` (0.50, the cut-off for creating a case). An administrator can change them at runtime through `/api/settings/threshold`; the change applies to the running process only (it is audited, not persisted) |
| Header bell / notifications | Bell shown only to admins; panel rebuilt from `/api/duplicate-flags?status=open` plus submitted awards on every page load; "seen" ids kept in `localStorage` per device; no unread count server-side | Server-persisted rows in `notifications` (category, title, body, link, `reference_id`, `read_at`, `UNIQUE (user_id, dedupe_key)`). Recipients are chosen at write time: active admins for a proposal, the proposing officer (`submitted_by`) for the decision and for certificate readiness. Read state is per user in the database; `NotificationBell.jsx` shows a badge, unread styling, *Mark all as read* and an empty state; polled every 60 s and on focus, refreshed on open. No duplicate-flag entries |
| Certificate issuance | Administrator opened an award and clicked "issue certificate"; the decision response carried no certificate | Certificate is written **inside the approval transaction**; the decision response returns `certificate_reference`. The manual route is now only a retry/backfill (`409` when one exists). Field officers are notified and print from `AwardCertificatePanel.jsx` |
| Certificate reference | `SBMS-CERT-<year>-<8 uppercase hex>` (32 bits, ungrouped) | `SBMS-<year>-<4>-<4>-<3>` e.g. `SBMS-2026-K8M4-X7PQ-2RZ`; 11 symbols from a 32-character alphabet without `0 O 1 I` (≈55 bits), generated with `crypto.randomInt`, unique in the database, race-retried in a savepoint. Legacy `SBMS-CERT-…` values are still normalised and accepted for paper already in circulation |
| Public certificate answer | Reference, period, dates, issuing authority only — explicitly **no** name, school or amount | Since the 2026-11-05 redesign it returns the facts printed on the paper: `certificate_reference`, `beneficiary_name`, `institution`, `programme`, `constituency` (null unless configured), `award_period`, `approved_amount`, `issued_at`, `award_approved_at`, `status`, `valid`, `issuing_authority`. Still never UPI, national ID, birth certificate, DOB, guardian/phone, address, documents, duplicate scores, ids or token. This is documented as a deliberate disclosure decision in `docs/bursary-certificates-2026-11-01.md` §10.5 |
| Certificate PDF | Plain Helvetica one-page report, token URL printed as text | A4 landscape vector document (ivory paper, navy/gold rules, rosette seal that is explicitly not a coat of arms, facts grid, 84 pt QR, reference and manual page address, "approval is not payment" small print); byte-identical on re-download because `CreationDate` is pinned; signatory block only when `SBMS_SIGNATORY_NAME` is configured |
| Award wording | Status chip said "Submitted" | Stored value remains `submitted`, every user-facing surface says "Proposed (awaiting approval)"; `approved` is a decision record, never a payment |
| Beneficiary verification | Field officer recorded `verified` / `not_found` / `needs_investigation` with an evidence reference (`POST /api/awards/:id/verification`); approval was refused unless `verification_status = 'verified'` | Stage removed: the officer registers, assesses eligibility and proposes the amount, the administrator reviews the proposal and decides. The API route, controller function, approval gate, `Awards.jsx` verify panel and the database CHECK constraint are gone; `verification_*` / `verified_*` columns and `bursary_award_verification_events` remain unused |
| Repeat awards | A student could be proposed again after an approved award, allowing two bursaries | Repeat proposals are allowed but never silent: `POST /api/awards` returns `409` with `code: "EXISTING_ALLOCATION"` while a non-rejected award exists (`submitted` or `approved`), and `Awards.jsx` shows those students as "(already has a bursary)". The officer confirms the browser dialog and the request is retried with `confirm_duplicate_allocation: true`, which the server re-checks under a per-student advisory lock and records in the audit payload; a rejected proposal frees the student again |
| Student QR verification | Token was created in the browser and no server verification endpoint existed | `students.qr_token` is generated server-side (`randomBytes(32).toString('hex')`), the QR encodes `PUBLIC_APP_URL/verify#token=…`, the page strips the fragment and posts to `POST /api/verify`, which answers `{ found }` only |
| Authentication enforcement | Role taken from the JWT claim | `middleware/auth.js` reloads role and `is_active` from `users` on every request; suspended users are refused even with a valid token |
| Reports | Plain tabular PDF | Styled multi-section document (commit `4c9606e`); field officers no longer see the scoring formula (commit `dc4b949`); section toggles are labelled (`d39ca0c`) |
| Deployment target | `render.yaml` Blueprint and `docs/deployment.md` describe Render (API Docker service + static site + Render Postgres) | Deployed target is **Azure** (Container Apps + App Service F1 + PostgreSQL Flexible Server). `render.yaml` and `docs/deployment.md` remain in the repository as an unused alternative and must not be described as the live deployment |
| ML integration in registration | Aborts registration with `503 DUPLICATE_SCREENING_UNAVAILABLE` if screening fails (unchanged), compares against every existing student (unchanged) | Same, plus the `top-1` aggregation; candidate blocking / top-k retrieval is still **NOT IMPLEMENTED**, so registration remains O(N²) over the registry and `POST /api/duplicate-flags/scan` is likewise a full scan |


---

## 4. Current system architecture

| Layer | Technology | Evidence / notes |
|---|---|---|
| Frontend | React 18 + Vite, React Router, utility-class styling; dev server port 4174 with the API proxied | `frontend/package.json`, `frontend/vite.config.js`; 14 pages plus 5 shared components; public routes `/verify` and `/verify-certificate` render without a session |
| Backend | Node.js 22 + Express 4, single process, port 5000 | `backend/src/index.js`; routers: auth, students, duplicate-flags, awards, eligibility, reports, settings, audit-logs, admin-dashboard, users, notifications, plus the legacy beneficiaries router and two inline public endpoints (`/api/verify`, `/api/certificates/verify`) |
| Data access | `pg` connection pool, hand-written SQL, transactions with `FOR UPDATE` and advisory locks | `backend/src/db/pool.js`; no ORM |
| Validation | Zod schemas per endpoint, cross-field refinements (e.g. a `verified` outcome needs an evidence reference) | controllers |
| Security | bcrypt cost 12, 8-hour JWT, `requireRole` middleware, role reloaded from the database per request, `is_active` flag, CORS allowlist (`CORS_ORIGINS`), body-size limit, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, per-IP rate limits (login 10/15 min, student verification 10/15 min, certificate verification 20/15 min), sanitised error handler | `backend/src/middleware/` |
| Database | PostgreSQL 17.11 locally; Azure Database for PostgreSQL Flexible Server (B1MS, 32 GiB) in the deployed environment, database `sbms` | `docs/azure-deployment-log-2026-10-31.md` §1; connection via `DATABASE_URL` with `sslmode=require` |
| Live tables | `users`, `students`, `duplicate_flags`, `duplicate_review_events`, `bursary_awards`, `bursary_award_verification_events`, `bursary_certificates`, `audit_logs`, `notifications`, plus the legacy `beneficiaries` table | migrations `20261019_*` … `20261111_notifications.sql`; `backend/src/db/schema.sql` is a **historical baseline** and must not be executed directly. Threshold settings are held in process memory, not in a table |
| Schema management | Numbered SQL migrations applied by an operator; `npm run migrate` only targets loopback `sbms_test`; `npm run db:bootstrap-empty` provisions a confirmed-empty database atomically (schema + migrations + bcrypt initial admin) | `backend/scripts/migrate.js`, `bootstrap-production-schema.js`, `README.md` §Database operations |
| ML service | Python 3.11 virtual environment: XGBoost 3.2.0, scikit-learn 1.9.0, pandas 3.0.5, jellyfish 1.2.1, joblib 1.6.0; artifact `ml-service/model/xgb_duplicate_model.joblib` | Invoked by the API as a **child process** (`predict.py --server`) exchanging JSON lines on stdin/stdout, 30 s timeout, one long-lived process per API instance. It is not a separate HTTP service and is not containerised separately |
| Integrations | **None external.** No SMS, e-mail, payment-gateway, identity-provider or NG-CDF/government API integration exists | `backend/src/services/` contains only audit, certificate document/issue/reference, database readiness/startup, duplicate aggregation/check, eligibility, ML review, notifications, report document, student format. Notifications are in-app only |
| Deployment | Azure: Container Apps `ca-sbms-api` (API image `ghcr.io/eggxellent/sbms-api:<commit-sha>`, `minReplicas 0`), App Service F1 `sbms-web` (`https://sbms-web.azurewebsites.net`) for the built frontend, PostgreSQL Flexible Server `pg-sbms`, budget `budget-sbms`; CI workflow `.github/workflows/publish-api-image.yml` builds and pushes the image | Verified live: `ca-sbms-api` provisioning `Succeeded`, running, image tag `4c9606ec9beb42e2a6a1b90fea51340578323918` (older than HEAD `d229c62`) |
| Deployment alternative (not live) | `render.yaml` and `docs/deployment.md` describe a Render Blueprint | Present but unused; do not present as the current deployment |

**Deployment position (important for Chapter 5):** the deployed API image is commit `4c9606e`. The two
notification commits (`9fbf701`, `d229c62`) are pushed to `origin/fix/sbms-completion-work` but are
**not** deployed, and the `notifications` migration has **not** been applied to the Azure database
(`UNVERIFIED` by direct query, because this document was prepared without touching the deployed
system; the local `sbms_test` database definitely lacks it — see §7).


---

## 5. Current workflows and responsibilities (implemented)

Status meaning: **IMPLEMENTED** = code present and covered by automated tests; **NOT IMPLEMENTED** =
absent from the repository.

### 5.1 Student registration and beneficiary processing — IMPLEMENTED

| # | Step | Actor | Implementation |
|---|---|---|---|
| 1 | Receive the list of students selected for NG-CDF consideration | Field Officer, **outside SBMS** | No table, no import endpoint (deliberate scope decision, `docs/beneficiary-processing-workflow-2026-11-05.md`) |
| 2 | Register the student | Field Officer | `POST /api/students`; fields: `full_name`, `date_of_birth` (YYYY-MM-DD), `school_code` (one of `APPROVED_SCHOOLS`), `guardian_id`, `upi`, `birth_certificate_number`, `national_id_number`, `primary_phone` (`+254[17]xxxxxxxx`); Zod-validated; page `/students/register` |
| 3 | Duplicate screening inside the registration transaction | System | Loads existing students, scores in batches of 200, applies threshold + `top-1` aggregation, inserts the student and the flag, commits; a predictor failure rolls back and returns `503` with `code: DUPLICATE_SCREENING_UNAVAILABLE` |
| 4 | Return the registration result | System | Student row, QR data URL (`/verify#token=…`) and, when flagged, the duplicate case summary and review priority |
| 5 | List / view students | Field Officer | `GET /api/students`, `GET /api/students/:id`, `GET /api/students/schools`; page `/students` |

### 5.2 Duplicate detection and review — IMPLEMENTED

1. Registration (or `POST /api/duplicate-flags/evaluate`) produces pair scores from the Python model.
2. Candidates at or above `ML_REVIEW_SCORE_THRESHOLD` (0.50) are ranked: exact identifier agreement
   first (UPI, birth certificate, national ID), then model probability.
3. `top-1` writes at most one `duplicate_flags` row (`pending`) carrying `probability`,
   `model_version`, `review_threshold` and the comparison features.
4. An administrator opens `/duplicate-review`, optionally reveals both records' identifiers
   (`GET /api/duplicate-flags/:id/identifiers`, audited), and records a decision with a reason:
   `confirmed_duplicate`, `not_duplicate` or `needs_verification`.
5. Decisions are written to `duplicate_flags` and `duplicate_review_events` and audited. A confirmed
   or unresolved duplicate case blocks award approval for that student.
6. `POST /api/duplicate-flags/scan` re-screens the existing registry on demand (admin). It is a full
   O(N²) scan; no blocking/indexing exists.

### 5.3 Eligibility assessment and recommended range — IMPLEMENTED

Field Officer submits need indicators for an existing student (`POST /api/eligibility`). Weights:
fee balance 30, household income 25, vulnerability status 25, siblings in school 10, prior bursary
history 10. Bands: `high` 70–100, `moderate` 40–69, `low` 0–39. The result is stored on the student
(`eligibility_score`, `eligibility_category`, `eligibility_assessed_at`) and audited. The recommended
cash range comes from `ELIGIBILITY_RANGE_*`; when any of the six values is missing or inverted, the
built-in figures (High 15,000–25,000; Moderate 8,000–15,000; Low 3,000–8,000 KSh) are used and flagged
`provisional: true`. The formula is exposed to admins (`GET /api/eligibility`), not to field officers.
**Eligibility never approves an award.**

### 5.4 Bursary award proposal by the Field Officer — IMPLEMENTED

`POST /api/awards` (`requireRole('field_officer')`) records `student_id` and `requested_amount` (a
positive number); the student's `school_code` is copied onto the award, and the award is stored with
status `submitted`. The student must exist and must already have a school, otherwise `404`/`409`. A
second proposal for a student who already holds a non-rejected award (status `submitted` or
`approved`) is answered with `409` and `code: "EXISTING_ALLOCATION"` — "This student has already been
allocated a bursary…" or "This student already has a bursary proposal awaiting a decision…". The
officer acknowledges the browser dialog and the screen retries with `confirm_duplicate_allocation:
true`; the server repeats the check inside a `pg_advisory_xact_lock` transaction (so two clicks cannot
both see "no allocation") and records `duplicate_allocation_confirmed`, `existing_award_id` and
`existing_award_status` in the `AWARD_SUBMITTED` audit payload. A same-officer, same-amount repeat
click under 60 seconds old returns `200 { already_submitted: true }` instead of a duplicate row. The
UI labels students with an award on record "(already has a bursary)" plus an amber hint, and explains
the dialog before it opens; only a `rejected` proposal frees the student. An open or confirmed
duplicate case is caught at approval time, not at proposal. The submission writes an `AWARD_SUBMITTED`
audit row and a notification for every active administrator.


### 5.5 Approval and rejection by the Admin — IMPLEMENTED

1. The Field Officer proposes the award amount (`POST /api/awards`); the administrator reviews the
   student record, eligibility assessment and proposed amount from the proposal itself. There is no
   separate verification stage and the officer never verifies or approves their own proposal.
2. The administrator decides (`PATCH /api/awards/:id/decision`): `approved` requires an
   `approved_amount`; every decision requires a reason of at least five
   characters. Approval is refused for an open or confirmed duplicate case and when
   `submitted_by === req.user.id` (nobody approves their own proposal). Rejection has no self-approval
   restriction.
3. The decision is audited and the proposing officer is notified.

### 5.6 Automatic certificate generation after approval — IMPLEMENTED

In the same transaction as the approval: snapshot row in `bursary_certificates` (student name, UPI,
school code, approved amount, approval timestamp, award period defaulting to the UTC approval year or
an explicit `award_period`), 64-hex `verification_token`, human reference, `status = 'active'`,
`AWARD_CERTIFICATE_ISSUED` audit row, and a "certificate ready" notification to the proposing officer.
Rejection produces no certificate. A spoiled printout is reprinted from the stored row; a second
certificate for the same award is refused (`award_id` is `UNIQUE`).

### 5.7 Field Officer downloads the certificate for issuance — IMPLEMENTED

`AwardCertificatePanel.jsx` (opened from `/awards`) calls `GET /api/awards/:id/certificate` for the
facts and QR image, and `GET /api/awards/:id/certificate.pdf` for the printable A4 landscape document.
Access is limited to the proposing officer and administrators; any other officer gets `403`, and an
award no longer approved returns `409`.

### 5.8 Public verification — IMPLEMENTED

| Path | Input | Answer |
|---|---|---|
| `/verify` → `POST /api/verify` | 64-hex student token from the QR fragment | `{ found: true/false }` only; proves a record exists, says nothing about eligibility, award or payment |
| `/verify-certificate` QR → `POST /api/certificates/verify` `{ token }` | 64-hex certificate token | `verified` (with printed facts), `not_current` (award changed or no longer approved; reference only), `not_recognised` |
| `/verify-certificate` manual → same endpoint `{ reference }` | Typed reference (`SBMS-2026-K8M4-X7PQ-2RZ`; case, spaces and dashes forgiven) | Same three answers through the same handler |

### 5.9 Planned / proposed but **NOT IMPLEMENTED**

Candidate blocking or approximate nearest-neighbour retrieval to replace O(N²) screening; retraining
on adjudicated (human-reviewed) pairs; certificate revocation; e-mail/SMS delivery of notifications;
bulk import of the selected-beneficiary list; payment execution or reconciliation; document upload/OCR
of supporting evidence; cryptographic signing of the certificate PDF; native mobile client.


---

## 6. Machine learning implementation

### 6.1 What is deployed (production model)

| Item | Value |
|---|---|
| Artifact | `ml-service/model/xgb_duplicate_model.joblib` |
| Model version string | `xgboost:6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9` (also stored on every `duplicate_flags` row) |
| Algorithm | `XGBClassifier`, binary (duplicate / not duplicate) |
| Parameters | `n_estimators 250`, `max_depth 4`, `learning_rate 0.05`, `subsample 0.9` (full set in `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json`) |
| Runtime | Python 3.11, xgboost 3.2.0, scikit-learn 1.9.0, pandas 3.0.5, jellyfish 1.2.1 |
| Interface | `ml-service/predict.py --server` child process; JSON lines in/out; input is a list of unordered pairs of student records; output is a probability and the model version |
| Decision cut-off | 0.50 (`ML_REVIEW_SCORE_THRESHOLD`); 0.70 is the admin "high priority" threshold |

### 6.2 Features (six, ordered, shared contract)

| Feature | Meaning |
|---|---|
| `jaro_winkler` | Jaro–Winkler similarity of cleaned full names, taken as the better of direct and token-sorted comparison |
| `dob_match` | Similarity of parsed Kenyan-format dates of birth |
| `school_match` | School agreement |
| `guardian_match` | Guardian identifier agreement |
| `upi_match` | UPI similarity |
| `birth_certificate_match` | Birth-certificate number similarity |

The order is fixed in `ml-service/feature_engineering.py:FEATURE_COLUMNS` and is identical in the
backend payload and `predict.py`. Country-specific parsing (day/month/year) and missing-value
normalisation (`NA`, `NULL`, `UNKNOWN`, all-zero strings, …) happen before scoring. Exact agreement
of UPI, birth certificate or national ID is **not** a model feature; it is used after scoring to rank
review priority and (optionally) to corroborate a match.

### 6.3 Training data and approach

- Training data is **synthetic**: pairs generated by `ml-service/generate_realistic_pairs.py`, in
  which each pair is derived from a latent identity, so duplicate labels are consistent with the
  visible records. Scenarios include common names in one school, identifier collisions, repeat
  applications, siblings in one household, twins/close ages and unrelated candidates.
- Split: 12,000 training pairs (6,000 groups) and 12,000 **independently generated** holdout pairs
  (6,000 groups), balanced 50/50; grouped 80/20 internal split so related pairs never straddle the
  split; the holdout comes from new latent identities and a separate random seed. Data checksums are
  recorded (`training_sha256 7b5856…`, `holdout_sha256 533e1f…`).
- Features are recomputed from the raw fields rather than copied from the CSV, and the harness checks
  that identifiers do not overlap between training and holdout.
- Model selection: XGBoost chosen in a same-holdout comparison of candidate algorithms; threshold
  fixed at 0.5. Because the holdout was used for selection, it is **not** a fully untouched test set
  (`holdout_used_for_model_selection: true`).
- The deployed artifact was promoted from this run (`model_promoted: true`).

### 6.4 Measured results (synthetic, threshold 0.5)

| Metric | Independent holdout (12,000 pairs) |
|---|---|
| Accuracy / balanced accuracy | 0.9078 |
| Precision | 0.9204 |
| Recall | 0.8927 |
| F1 | 0.9063 |
| Average precision | 0.9727 |
| ROC-AUC | 0.9685 |
| Confusion | TN 5,537 · FP 463 · FN 644 · TP 5,356 |

Per-scenario false-positive behaviour on the same holdout: unrelated candidates 0.0%; siblings sharing
a household 0.98%; twins/close ages 5.57%; common name in the same school 7.84%; identifier collision
22.2% (repeat-application recall 89.3%). These scenario figures are the honest way to report the model:
it is strong on easy negatives and weak where identifiers or names collide.

### 6.5 Operational baseline (measured, not a substitute for accuracy)

`ml-service/evaluate_false_positive_rate.py`, seed 20261030, 2,000 deliberately unrelated same-school
pairs: 0.35% flagged at 0.50 (0.15% when names are provably different); unrelated-pair score
distribution p50 0.019, p90 0.050, p99 0.198, max 0.744. Raw JSON:
`ml-service/evaluation/fpr_baseline_2026-10-30.json`.


### 6.6 How the model sits in the duplicate workflow

Registration → all existing records become candidates → model scores each pair → candidates ≥ 0.50
are ranked by exact identifier agreement then probability → `top-1` selects one → one `duplicate_flags`
row (`pending`) → admin decides → a confirmed/unresolved case blocks award approval. The model only
creates review work; it never rejects a registration, approves an award or edits data. If the predictor
cannot be reached, registration fails closed with `503` rather than proceeding unscreened.

### 6.7 Limitations (state these explicitly in Chapter 5)

1. All training and evaluation data is **synthetic**. No human-adjudicated real pair has ever been used
   for training or evaluation (`ml-service/evaluation/REVIEWED_DATA_EVALUATION.md` documents the empty
   template).
2. The 50/50 label balance is not the expected operational prevalence; precision at realistic
   prevalence is much lower (illustrative values in the metrics file: ~0.10 at 1% prevalence, ~0.56 at
   10%).
3. Identifier similarity features (`upi_match`, `birth_certificate_match`) reward structurally similar
   strings; unrelated identifiers average ≈0.50 similarity, which is why identifier-collision
   scenarios show a 22% false-positive rate.
4. Screening compares against every stored student, so cost grows quadratically; candidate blocking is
   not implemented.
5. Research experiments must not be quoted as production performance:
   - `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` — a
     different, incompatible feature schema (dataset fields do not map to the app contract). Its test
     metrics (precision 0.874, recall 0.880, F1 0.877, AP 0.953, ROC-AUC 0.978) are research only.
   - `ml-service/model/rf_duplicate_model.joblib` and the attachment-style candidate
     (`F1 0.695`, `recall 0.538` on an independent synthetic holdout) — not deployed.
   - `data/raw_pairs.csv` results (98.61% test F1) come from a generator shortcut
     (`birth_certificate_match` alone has AUC 0.953). Do not cite them.


---

## 7. Testing and deployment

### 7.1 Results measured while preparing this document (2026-11-11, commit `d229c62`)

| Check | Command | Result |
|---|---|---|
| Backend Jest | `backend/.env.test` loaded, then `npx jest --runInBand --silent tests` | **27 suites / 175 tests — all 27 suites passed, 175/175 tests passed** after the local `sbms_test` database had both `20261111_notifications.sql` and `20261111_remove_award_verification_gate.sql` applied |
| ML service | `ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests` | **33 tests, OK, 3.5 s** |
| Frontend build | `npm run build --prefix frontend` | **exit 0**, built in 12.47 s |

**Earlier red run (now cleared):** `tests/workflow.test.js`, `tests/duplicateFlags.test.js` and
`tests/bursaryCertificates.test.js` failed with `500` on award submission/approval because the local
`sbms_test` database lacked the `notifications` table. Both pending migrations are now applied to the
loopback test database (`node scripts/migrate.js apply --confirm-sbms-test`) and the full suite is green.
`tests/workflow.test.js` raises its hook budget to 300 s because registration screens each new student
against the whole registry, which a long-lived local database makes slow.

### 7.2 Earlier verified results (historical, still valid for the commit named)

| Date | Commit | Result |
|---|---|---|
| 2026-10-31 | `3a29fab` | Backend Jest **21 suites / 128 tests passed**; native `node --test` 43/43; API smoke 3/3 against a live server; ML 33/33 + research helpers 7/7; frontend build exit 0 (`docs/FINAL_TEST_REPORT.md`) |
| 2026-11-01 | — | Backend Jest **24 suites / 151 tests passed** with the certificate feature (`docs/bursary-certificates-2026-11-01.md` §7) |
| 2026-11-11 (prior session) | before `9fbf701` | Notification work: **4 suites / 21 tests passing**, frontend build clean, live local DB smoke test of admin fan-out, dedupe suppression and read toggling |

Do not cite 21/128 or 24/151 as the current totals; they predate the notification suites.

### 7.3 Not verified

| Item | Status |
|---|---|
| Full green Jest run on this commit | **PASSED** on loopback `sbms_test` after both pending migrations were applied (27/27 suites, 175/175 tests) |
| Browser end-to-end / Selenium-style run | **NOT RUN** |
| Phone-camera scan of a printed certificate or student card | **NOT RUN** (needs a public HTTPS origin and a device) |
| Print output on a physical printer | **NOT RUN** |
| UAT with real officers, students or schools | **NOT RUN** |
| Docker image build from HEAD | **NOT RUN** in this session |
| Notifications on the deployed Azure system | **NOT DEPLOYED** — image is `4c9606e`, and the migration is not applied there |

### 7.4 Deployment status (read-only Azure queries, 2026-11-11)

| Resource | Observed |
|---|---|
| Container App `ca-sbms-api` | provisioning `Succeeded`, `Running`, image `ghcr.io/eggxellent/sbms-api:4c9606ec9beb42e2a6a1b90fea51340578323918` |
| App Service `sbms-web` (F1) | `https://sbms-web.azurewebsites.net` (per `docs/azure-deployment-log-2026-10-31.md`; not re-queried) |
| PostgreSQL Flexible Server `pg-sbms` (B1MS) | database `sbms`; schema state not queried (out of scope for this document) |
| Budget | `budget-sbms`; recorded idle cost ≈ $4.42/month |

**Outstanding deployment work (do not claim as done in the report):**
1. Apply `backend/src/db/migrations/20261111_notifications.sql` to the production database (backup and
   restore rehearsal first, per `README.md`).
2. Build and deploy an image from a commit that includes the notification code, then confirm
   `GET /api/ready` (readiness lists `notifications`, so the API will fail closed until the migration
   is applied).
3. Re-run the full Jest suite on a provisioned test database and record the result.


---

## 8. Academic reporting corrections — what to change in Chapters 4, 5 and 6

Paths are under `docs/final-documentation-content/`. Line numbers refer to the versions inspected on
2026-11-11 and should be re-checked before editing.

### 8.1 Chapter 4 — `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`

| Location | Outdated claim | Correction |
|---|---|---|
| FR-16…FR-19 (≈ lines 133–136) | Payment issued / cleared / acknowledged / reconciliation exception requirements | Delete or replace. The disbursement module was removed; the remaining relevant requirements are award proposal by the field officer, award decision with reason, automatic certificate on approval, certificate verification and in-app notification |
| FR-26 (≈ line 148) | Date-range PDF report containing "disbursement" data | The report contains registration, eligibility, award, duplicate-case and audit sections only |
| ≈ line 171 | "The system records payments; it does not execute transfers" | Replace with: SBMS records decisions and documents; it does not record, clear or reconcile payments |
| NFR-17 (≈ line 205) | "every duplicate and payment decision" | "every duplicate, eligibility and award decision is made by a human; the model only creates review cases" |
| ≈ line 235 | Schema/ERD list including `disbursements` and `disbursement_reconciliation_events` | Remove both; add `notifications`; keep `bursary_certificates`, `bursary_award_verification_events`, `duplicate_review_events` |
| ≈ line 258 | Cross-field rules about clearance and reconciliation | Remove; keep `verified` + evidence reference, required rejection reason, mandatory `student_id` for eligibility |
| Functional requirements | No requirement for notifications or automatic certificate issue | Add: automatic certificate on approval with unique human reference and QR token; in-app notifications to the correct role with per-user read state; manual reference verification |
| Module map / architecture diagram | Shows a disbursement controller and page | Redraw: frontend (14 pages) → Express API (12 routers + 2 inline public endpoints) → PostgreSQL; the Python predictor is a **child process of the API**, not a separate service; deployment on Azure Container Apps + App Service + Flexible Server |
| Use-case / sequence diagrams | Award approval ends at "approved" | Show one transaction: award update → certificate snapshot → audit row → notification; then the separate officer action "print certificate" |
| Scope section | Original proposal scope only | Add a "scope changes after the proposal" subsection: payments/reconciliation removed; beneficiary selection out of scope; notifications and automatic certificates added; certificate redesign 2026-11-05 |
| Non-functional table | No readiness statement for the new table | Readiness is fail-closed: `/api/ready` refuses to report ready when a required table (including `notifications`) is missing |


### 8.2 Chapter 5 — `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md`

| Location | Outdated claim | Correction |
|---|---|---|
| Module table ≈ lines 152–153 | "Bursary awards … `pages/Disbursements.jsx`"; a "Payments and reconciliation" row citing `disbursements.controller.js`, `bursaryRules.js`, `config/reconciliation.js` | Awards row uses `pages/Awards.jsx` + `AwardCertificatePanel.jsx`; the payments row must be deleted |
| ≈ line 361 | "A payment is recorded as `issued` — never as paid" | Delete. Awards have three states only: `submitted` (proposed), `approved`, `rejected` |
| ≈ line 410 | Reference format `SBMS-CERT-<year>-<8 uppercase hex>` | Current format `SBMS-<year>-<4>-<4>-<3>` (e.g. `SBMS-2026-K8M4-X7PQ-2RZ`); the legacy format is still normalised for paper in circulation. Describe manual-reference verification too |
| ≈ lines 432, 441 | Dashboard "six-month disbursement trend"; report "disbursement detail list" | Replace with award / certificate / duplicate trends and the current report sections |
| ≈ line 496 | Admin surface list includes `/api/disbursements` | Remove; add `/api/notifications` |
| Certificate narrative | Certificate "issued from a panel by an administrator" | Certificate is issued inside the approval transaction; the panel is the officer's download/print surface; `POST /api/awards/:id/certificate` is retry/backfill only |
| Duplicate-detection section | "every candidate pair ≥ threshold creates a flag" | `top-1` aggregation: at most one case per registration, ranked by exact identifier agreement then score; `all` exists only as a legacy comparison mode |
| Notifications | Absent from the chapter | Add a subsection: table, categories, role targeting, dedupe key, read state, polling, bell component and its tests |
| Test evidence tables | 21 suites / 128 tests; 24 suites / 151 tests | Current: 27 suites / 175 tests — 24 suites / 154 tests pass, 3 suites / 21 tests blocked by the un-migrated test database (§7.1). State the blockage honestly |
| Frontend build evidence | Module counts 2,002 / 2,006 | Re-measure; the verified statement for this commit is "exit 0, 11.67 s" |
| Screenshots | Disbursements page, "Submitted" status chips, old bell, old certificate layout, `SBMS-CERT-…` reference | Replace with current `/awards`, `/duplicate-review`, bell dropdown, new certificate PDF and `/verify-certificate` result |
| ML evaluation subsection | Figures from `raw_pairs.csv` (98.61% F1) or the research dataset model (0.875 F1) | Use the deployed model's synthetic holdout metrics (§6.4), the false-positive baseline (§6.5) and the limitations (§6.7) |

### 8.3 Chapter 6 — `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md`

- Recommendations about payment recording, clearance, receipts and reconciliation belong under
  "future work / outside the delivered scope", not under system behaviour.
- Achievements should cite only what exists: duplicate screening with human review, eligibility scoring
  with provisional ranges, propose/approve separation with self-approval refusal, automatic
  QR-verifiable certificates with manual fallback, audit trail, role-scoped notifications.
- Future work must include: adjudicated-pair model evaluation, candidate blocking, certificate
  revocation, out-of-app notification delivery, and deploying the notification migration.
- Any statement that the system is fully deployed must be qualified: the live image predates the
  notification feature and the production migration is outstanding.

---

## 9. Rules for Claude when rewriting the chapters

1. **Tense discipline.** Present tense only for §1 and §5.1–§5.8. Everything in §5.9 is future or
   proposed. Nothing about payments exists in any tense except "removed" or "future work".
2. **Numbers.** Quote test totals as "27 suites / 175 tests, all passing" and name the database they ran
   against (`sbms_test`, with both 2026-11-11 migrations applied). Quote ML metrics with the word
   *synthetic* and the threshold (0.5).
3. **Two QR codes.** Student QR proves record existence only. Certificate QR (or typed reference)
   proves the certificate is current. Do not merge them into one "verification system" claim.
4. **Approval is a decision, not money.** Every mention of "approved" must not imply payment; the
   certificate PDF itself prints "approval is not payment".
5. **Deployment honesty.** Live API image `4c9606e`; HEAD `d229c62` is pushed but not deployed; the
   `notifications` migration is unapplied in production.
6. **Separation of duties.** Field officers register, assess, propose and print; administrators decide,
   manage users, tune thresholds and read audit logs; nobody approves their own proposal.
7. **Do not reuse numbers from superseded documents** (`docs/FINAL_TEST_REPORT.md`,
   `docs/SBMS_PROJECT_HANDOVER_2026-10.md`, `docs/bursary-certificates-2026-11-01.md` §1–§9) without
   checking them against §6 and §7 here.

---

## 10. Reproduction commands used for this document

```powershell
# exact revision
git rev-parse HEAD; git rev-parse --abbrev-ref HEAD; git status --porcelain

# backend tests (load backend/.env.test first; do not print its values)
npx jest --runInBand --silent tests

# ML suite
.\ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests

# frontend build
npm run build --prefix frontend

# deployed image and state
az containerapp show -g rg-sbms -n ca-sbms-api --query "properties.template.containers[0].image" -o tsv
az containerapp show -g rg-sbms -n ca-sbms-api --query "[properties.runningStatus, properties.provisioningState]" -o tsv
```

*Prepared by inspecting the repository only. No application code, schema, migration, report document
or Azure resource was modified.*

