# SBMS REQUIREMENTS AND SCOPE CATALOGUE

**Prepared:** 2026-11-02
**System:** Student Beneficiary Management System (SBMS)
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Evidence basis:** source, migrations, tests and recorded run documents in the repository. Nothing in this catalogue is a plan; every row describes what exists at the revision above.
**Companion files:** `SBMS_API_ENDPOINT_CATALOGUE.md`, `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md`, `SBMS_TEST_EVIDENCE_CATALOGUE.md`, `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md`.

---

## 1. Purpose

This file is the single requirements register for the written report. It exists so that Chapters Four, Five and Six can cite one authoritative numbered list instead of restating requirements in prose that drifts between chapters. It states, for each requirement: the identifier, the requirement as a testable statement, the actor, the priority, the implementation location, the evidence that establishes the behaviour, and the verification status.

The identifiers are those already used in `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.2.2 (FR-01 … FR-37) and §4.2.3 (NFR-01 … NFR-21). They are reproduced here, not renumbered, so cross-references in the chapters remain valid.

## 2. Status vocabulary

| Code | Meaning | Test applied |
| --- | --- | --- |
| **V** | Verified | An executed automated test or a recorded observation establishes the behaviour at this revision |
| **P** | Partially verified | Some behaviour is established; a named part is not (the row says which) |
| **N** | Implemented, not tested | Code path exists and was read; no executed test exercises it |
| **X** | Not implemented | Absent by scope decision or recorded as a gap |

A requirement is called *implemented* only where a route, a service, a database object and a user-facing affordance all exist. Where the interface exists but no executed test covers the behaviour, the row is marked **N**, never **V**.

## 3. System identity and component inventory

| Layer | Technology at this revision | Entry point |
| --- | --- | --- |
| Presentation | React 18 single-page application, Vite build, `react-router-dom` | `frontend/src/main.jsx`, `frontend/src/App.jsx` |
| Application | Node.js 22 + Express 4 REST API, 13 routers | `backend/src/index.js` |
| Domain services | 10 service modules (screening, aggregation, review policy, eligibility, bursary rules, certificates, audit, readiness) | `backend/src/services/` |
| Persistence | PostgreSQL 17, 13 tables, 14 forward migrations + 1 rollback script | `backend/src/db/schema.sql`, `backend/src/db/migrations/` |
| Machine learning | Python 3.11, scikit-learn + XGBoost 3.2.0, one six-feature model, one long-running scoring subprocess | `ml-service/predict.py`, `ml-service/feature_engineering.py` |
| Delivery | Single container image (API + ML runtime), GitHub Actions build, Azure Container Apps | `Dockerfile`, `.github/workflows/publish-api-image.yml` |

## 4. Actors and interests

| Actor | Description | Where they act |
| --- | --- | --- |
| Field Officer | Registers beneficiaries at a school, screens them, records verification evidence, submits award applications, records payments | `/students`, `/students/register`, `/eligibility`, `/disbursements`, `/field-officer` |
| Administrator | Adjudicates duplicate cases, approves or rejects awards, issues certificates, manages users and cut-offs, reads the audit log and reports | `/dashboard`, `/duplicate-review`, `/disbursements`, `/reports`, `/settings`, `/audit`, `/users` |
| Public verifier | Student, guardian, school or employer holding a printed QR code | `/verify`, `/verify-certificate` (unauthenticated) |
| Operator / deployer | Applies migrations, sets secrets, starts and stops the deployment, restores a backup | `backend/scripts/migrate.js`, `docs/deployment.md`, `deploy/azure/**` |
| Programme owner | Owns the open policy decisions (cut-off choice, adjudication protocol, acknowledgement deadline) | Not represented in the interface; see `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §6 |

## 5. Scope boundary

**In scope and delivered:** authentication and role separation; beneficiary registration with a five-school constraint; six-feature ML-assisted duplicate screening with human adjudication; rule-based eligibility scoring; bursary award submission, verification, approval and rejection; payment issue, clearance and officer-assisted receipt acknowledgement with exception reporting; QR student identification (existence only); QR-verifiable award certificates with revocation; dashboard, PDF export, audit log, cut-off settings and user administration; migrations, readiness guards and a containerised deployment.

**Delivered beyond the approved proposal:** award verification evidence, payment reconciliation (issue/clearance/acknowledgement with discrepancy handling), and award certificates. Recorded as expansion, not as a proposal obligation.

**Excluded and stated as excluded:** NEMIS or any national identifier verification service (FR-32); offline operation and native mobile applications (FR-33); financial transfer execution (FR-37 — SBMS records payments, it does not move money); multi-tenancy; token expiry and re-issue for student QR codes (FR-35, FR-36).

## 6. Functional requirements register (FR-01 … FR-30)

Priority: **M** must have, **S** should have, **C** could have. Verification names the file in `backend/tests/` unless a full path is given.

| ID | Requirement (abbreviated statement) | Actor | Pri | Implementation | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | Authenticate against a stored bcrypt hash and issue a JWT valid for 8 hours | Admin, Officer | M | `auth.controller.js` | `auth.test.js`, `roleAuthorization.test.js` | V |
| FR-02 | Separate administrator and field-officer sign-in; refuse the wrong endpoint with 403 | Both | M | `auth.controller.js:44-60` | `auth.test.js`, `roleAuthorization.test.js` | V |
| FR-03 | Refuse public self-registration (410); accounts created only by an administrator | Admin | M | `auth.routes.js:9` | `auth.test.js` | V |
| FR-04 | Enforce the role matrix on every endpoint; 403 otherwise | All | M | `middleware/requireRole.js`; every router | `roleAuthorization.test.js` (6), `workflow.test.js` | V |
| FR-05 | Register a beneficiary with validated name, DOB, school, national ID, phone and optional UPI / birth certificate | Officer | M | `students.controller.js:15-24` | `students.test.js` (9) | V |
| FR-06 | Reject a school outside the five approved schools | Officer | M | `config/schools.js`; `students_school_supported_check` | `students.test.js` | V |
| FR-07 | Score a new registration against every existing record and raise review cases per policy | System | M | `students.controller.js:69-124`; `services/duplicateCheck.js` | `duplicateFlags.test.js`, `workflow.test.js`, `mlPredictor.integration.test.js` | V |
| FR-08 | Never reject, delete or amend an existing record because of screening; the flagged student is still created | System | M | `students.controller.js:101` | `workflow.test.js` #1; `docs/business-workflow-verification-2026-10-30.md` §4 | V |
| FR-09 | Store score, model version, review threshold and feature vector per case | System, Admin | M | `students.controller.js:103-109`; migration `20261022_ml_duplicate_provenance.sql` | `duplicateFlags.test.js` | V |
| FR-10 | Mask identifiers in the queue; reveal only on an explicit audited request | Admin | M | `duplicateFlags.controller.js:37-42,106-107` | `duplicateFlags.test.js` | V |
| FR-11 | Record a reviewer decision with a mandatory reason, appended to case history | Admin | M | `duplicateFlags.controller.js:452-503`; `duplicate_review_events` | `duplicateFlags.test.js`, `workflow.test.js` | V |
| FR-12 | Compute eligibility from five weighted factors and assign one of four categories | Officer | S | `services/eligibility.js`; `eligibility.controller.js` | Route and validation only; no automated test of the arithmetic | P |
| FR-13 | Submit a bursary award application for an existing student with a requested amount | Officer | S | `bursaryAwards.controller.js:64-101` | `bursaryAwards.controller.test.js` (5) | V |
| FR-14 | Record a verification outcome with an evidence reference; `verified` requires one | Officer | S | `bursaryAwards.controller.js:104-148` | `bursaryAwards.controller.test.js`; `workflow.test.js` #2 | V |
| FR-15 | Approve or reject with a reason; approval refused unless verified and no open or confirmed duplicate exists | Admin | M | `bursaryAwards.controller.js:151-209` | `bursaryAwards.controller.test.js`; `workflow.test.js` #2-#6 | V |
| FR-16 | Record payment as `issued`; refuse unapproved, unverified, duplicate-blocked or over-amount payments | Admin, Officer | M | `disbursements.controller.js:65-136` | `disbursements.test.js` (4); `workflow.test.js` #7 | V |
| FR-17 | Record clearance separately from issue, with a mandatory evidence reference | Admin, Officer | S | `disbursements.controller.js:138-191` | `disbursementReconciliation.controller.test.js` (4); `workflow.test.js` #8 | V |
| FR-18 | Record officer-assisted acknowledgement; classify a shortfall as `discrepancy` without overwriting the recorded amount | Admin, Officer | S | `disbursements.controller.js:193-260`; `bursaryRules.receiptStatus` | `workflow.test.js` #9; `bursaryRules.test.js` (4) | V |
| FR-19 | Report reconciliation exceptions (unlinked legacy, unverified, partial, awaiting, overdue, failed, cancelled, discrepancy) | Admin, Officer | S | `bursaryRules.exceptionReasons`; `disbursements.controller.js:53-63` | `workflow.test.js` covers exercised paths; not every reason code is individually asserted | P |
| FR-20 | Generate a cryptographically random QR token per student and return a QR image | System, Officer | M | `students.controller.js:58-60`; `config/publicAppUrl.js` | `verification.test.js` (10) | V |
| FR-21 | Public endpoint reports only whether a matching record exists | Public | M | `verification.controller.js`; `index.js:65` | `verification.test.js`; `verificationRoute.test.js` (4) | V |
| FR-22 | Issue a QR-verifiable certificate for an approved award; refuse a second certificate | Admin | C | `certificates.controller.js:95-181`; `bursary_certificates` UNIQUE `award_id` | `bursaryCertificates.test.js` (12) | V |
| FR-23 | Verify a certificate publicly by QR token or by its printed reference; an unknown reference answers "not found" | Admin | C | `certificates.controller.js` verification path | `bursaryCertificates.test.js`, `certificateVerificationRoute.test.js` | V |
| FR-24 | Report `not_current` when the award is no longer approved or its amount changed since issue | System | C | `certificates.controller.js:251-290` | `bursaryCertificates.test.js` | V |
| FR-25 | Dashboard: registry, duplicate, award and payment totals, six-month trend, recent audit activity | Admin | S | `adminDashboard.controller.js`; `pages/AdminDashboard.jsx` | Authorisation and synthetic counts in `roleAuthorization.test.js`; counter arithmetic not individually tested | P |
| FR-26 | Date-range PDF export of registration, disbursement, duplicate and accountability summaries | Admin | S | `reports.controller.js`; `routes/reports.routes.js:8-13` | Range validation tested; PDF content verified by inspection only | P |
| FR-27 | Audit every state-changing operation with actor, action, table, record and details | System | M | `services/auditLog.js`; every controller | `workflow.test.js` #10 (ten-action sequence) | V |
| FR-28 | Read and update the duplicate, high-priority and model cut-offs within 0-1, and audit the change | Admin | S | `settings.controller.js`; `config/settings.js` | Denial tested in `roleAuthorization.test.js`; validation by inspection | P |
| FR-29 | List users and create administrator or field-officer accounts | Admin | S | `users.controller.js` | `roleAuthorization.test.js`; last-admin guard by inspection | P |
| FR-30 | Report liveness and readiness separately; readiness fails closed on a missing table or wrong database identity | Operator | S | `index.js:69-87`; `services/databaseReadiness.js` | `test/databaseReadiness.node.js`; `schemaReadiness.test.js` (5); `health.test.js` | V |

### 6.1 Proposal requirements recorded for completeness

| ID | Proposal requirement | Delivered state | Classification |
| --- | --- | --- | --- |
| FR-31 | Random Forest over four similarity features | XGBoost over six features in production; Random Forest retained only as an unevaluated research artefact | Implemented with a documented design change (G-21) |
| FR-32 | NEMIS / national identifier verification integration | Not implemented; excluded in the proposal | Not implemented, as scoped |
| FR-33 | Offline operation and native mobile applications | Not implemented; responsive web only | Not implemented, as scoped |

### 6.2 Functional gaps recorded as gaps

| ID | Gap | Consequence | Evidence |
| --- | --- | --- | --- |
| FR-34 | No candidate blocking: each registration is compared with the whole registry; the administrator rescan is quadratic | Model calls grow linearly with registry size; review cost grows with N | `students.controller.js:69-73`; `docs/ml-decision-sheet-2026-10-30.md` §6 |
| FR-35 | No re-issue path for a student QR token | A row created without a token cannot be given one through the API | `docs/qr-verification-2026-10-30.md` §6 |
| FR-36 | No token expiry or rotation | A token remains valid for the life of the student row | `docs/qr-verification-2026-10-30.md` §6 |
| FR-37 | Payments are recorded, not executed | No bank, mobile-money or treasury integration | `disbursements.controller.js` |

## 7. Non-functional requirements register (NFR-01 … NFR-21)

| ID | Requirement | Measure or constraint implemented | Evidence | Status |
| --- | --- | --- | --- | --- |
| NFR-01 | Screening completes within three seconds | <= 3 000 ms for a 50-candidate registration; 22.67 ms measured for 50 pairs (2026-10-30) | `tests/performance.test.js` | P: satisfied at 50 candidates; no measurement at registry scale |
| NFR-02 | Password storage resists offline attack | bcrypt, cost factor 12 | `auth.controller.js:26` | V as implementation; cost not benchmarked on the host |
| NFR-03 | Session credentials are signed and time-bounded | HMAC JWT, `expiresIn: 8h`, secret >= 32 bytes, placeholder rejected at start-up | `auth.controller.js:55-59`; `config/jwtSecret.js` | V |
| NFR-04 | Authorisation does not trust a client-supplied claim | Role re-read from the `users` row on every request; inactive users refused | `middleware/auth.js:20-24` | V |
| NFR-05 | Identifiers are not exposed by default in the queue | Last-three-character masking plus an audited reveal endpoint | `duplicateFlags.controller.js:37-42,106-107` | V |
| NFR-06 | Public verification discloses no beneficiary data | Student endpoint returns `{found}` only; certificate endpoint returns authenticity facts only | `verification.controller.js`; `certificates.controller.js:53-89` | V |
| NFR-07 | Public endpoints are rate limited | 10 requests / IP / 15 min (student); 20 / IP / 15 min (certificate); separate counters | `middleware/verificationRateLimit.js`; `certificateRateLimit.js`; `rateLimitWindow.js` | V in-process only; not shared across instances |
| NFR-08 | Sign-in is rate limited | 10 attempts / IP / 15 min | `middleware/loginRateLimit.js` | V |
| NFR-09 | Request bodies are bounded | JSON limit 100 kB | `index.js:64` | V |
| NFR-10 | Errors do not leak internals | 5xx returns a generic message; logs carry no stack, message or credential | `middleware/errorHandler.js:59-78` | V |
| NFR-11 | Browser origins restricted by allowlist | Unlisted origin rejected before routing; malformed configuration stops start-up | `config/cors.js`; `index.js:40-47` | V |
| NFR-12 | Integrity enforced by the database, not only the application | CHECK constraints for roles, school list, award decision, verification, payment and receipt status, clearance and acknowledgement completeness, certificate status and token format; foreign keys throughout | `db/schema.sql`; migrations | V |
| NFR-13 | Concurrent registrations do not interleave | Transaction plus `pg_advisory_xact_lock`; candidates selected `FOR UPDATE` | `students.controller.js:67-73` | P: lock exists and is used; no concurrency test exists |
| NFR-14 | Usable by non-technical officers on varied devices | Responsive layout, role navigation, plain-language screening messages, single-line status pages | `components/AppLayout.jsx`; `pages/StudentRegistration.jsx`; `pages/Verification.jsx` | P: browser-checked; no usability study or acceptance session |
| NFR-15 | Maintainable and reproducible | One feature-schema module shared by training and serving; ordered migrations; Jest, native `node --test` and Python `unittest`; pinned requirements | `ml-service/feature_engineering.py`; `db/migrations/`; `ml-service/requirements.txt` | V |
| NFR-16 | Operable within a zero-cost student budget | Container with `minReplicas 0`; free App Service tier; PostgreSQL stopped between demonstrations; no log workspace | `Dockerfile`; `docs/azure-deployment-log-2026-10-31.md` §1-§4 | P: the zero-cost configuration is recorded, but no billed month has been reconciled against the budget and the cost model is an owner decision |
| NFR-17 | A human makes every duplicate and payment decision | Scores create cases only; approval, disbursement and issue are role-gated human actions | `duplicateFlags.controller.js:452-503`; `bursaryAwards.controller.js:151-209` | V |
| NFR-18 | Recovery from database loss with verified evidence | Dump, restore into an independent database, readiness and row-digest comparison rehearsed | `docs/database-recovery-rehearsal-2026-10-31.md` | P: local rehearsal; no scheduled backup job or retention policy in the deployment |
| NFR-19 | Compatible with ordinary modern browsers | SPA over HTTPS using `fetch`, `history.replaceState` and router hash handling only | `frontend/src/**`; `frontend/public/web.config` | P: exercised in Chrome only; Firefox, Safari and mobile browsers unrecorded |
| NFR-20 | Predictable degradation when the predictor is unavailable | Registration aborts with 503 instead of registering an unscreened beneficiary | `students.controller.js:74-96`; `services/duplicateCheck.js` | V by inspection and the 503 assertion path |
| NFR-21 | Audit records attributable and complete for state changes | Every controller writes an `audit_logs` row with actor, action, table, record and JSON details | `services/auditLog.js`; `workflow.test.js` #10 | P: attributable and complete in every tested workflow; append-only is convention only and is not enforced by the schema |

## 8. Counts and status summary

| Group | Count | V | P | N | X |
| --- | --- | --- | --- | --- | --- |
| Functional requirements delivered (FR-01 … FR-30) | 30 | 24 | 6 | 0 | 0 |
| Proposal requirements carried as deviations (FR-31 … FR-33) | 3 | 0 | 0 | 0 | 3 |
| Functional gaps reported as gaps (FR-34 … FR-37) | 4 | 0 | 0 | 0 | 4 |
| Non-functional requirements (NFR-01 … NFR-21) | 21 | 14 | 7 | 0 | 0 |

The six partially verified functional requirements are FR-12 (eligibility arithmetic), FR-19 (not every reason code individually asserted), FR-25 (counter arithmetic), FR-26 (PDF content), FR-28 (cut-off validation) and FR-29 (last-administrator guard); every other delivered functional requirement carries a route-level or workflow-level test. The seven partially verified non-functional requirements are NFR-01, NFR-13, NFR-14, NFR-16, NFR-18, NFR-19 and NFR-21. These counts are obtained by counting the status cells in §6 and §7, not maintained as a separate figure, so a change to a row changes the count.

Two **V** verdicts rest partly on inspection and say so in the row: NFR-02 (bcrypt cost factor is set but not benchmarked on the host) and NFR-20 (the 503 path is asserted and the surrounding branch was read). Every other **V** rests on an executed test or a recorded observation. The **N** column is empty because every implemented requirement has at least a route-level test, which is not a claim that every branch is covered; branch-level coverage is stated in `SBMS_TEST_EVIDENCE_CATALOGUE.md` §7.

## 9. Traceability entry points

| Question | File that answers it |
| --- | --- |
| Which endpoint implements a requirement? | `SBMS_API_ENDPOINT_CATALOGUE.md` §3 |
| Which table and column stores the result? | `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` §4-§8 |
| Which test proves it, and on what date? | `SBMS_TEST_EVIDENCE_CATALOGUE.md` §3-§6 |
| Which claim is unsupported, and why? | `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §4-§5 |
| Which objective does it serve? | `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §1 |
| Which gap is still open? | `DOCUMENTATION_GAP_REGISTER.md` §1-§3 |

**Statement of provenance.** Every row above was read from the revision named in the header, not from an earlier draft. Where the repository contradicts a chapter, the contradiction is recorded in `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §3 rather than smoothed away here.




