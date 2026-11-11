# SBMS REQUIREMENTS AND SCOPE CATALOGUE (recalculated)

> Recalculated 2026-11-03 against HEAD `cca0625`. IDs are preserved from the previously approved catalogue
> (`docs/final-documentation-content/SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md`, bound to `d6b5032`) so Chapters 1–3
> stay traceable; **statuses and limitations are re-derived, not copied.** Counts in §3 were recounted from the
> tables below.
>
> Status vocabulary: **VERIFIED** (implementation located and consistent), **PARTIAL** (implemented, but a stated
> part is unverified or conditional), **NOT IMPLEMENTED**, **NOT TESTED** (no executed evidence), **UNVERIFIABLE**
> (cannot be settled from the repository or the live deployment).

## 1. Functional requirements (37)

| ID | Requirement (abbreviated) | Status | Primary source | Limitation |
| --- | --- | --- | --- | --- |
| FR-01 | bcrypt authentication, JWT valid 8 h | VERIFIED | `controllers/auth.controller.js:26,48,58` | bcrypt cost not benchmarked on target hardware |
| FR-02 | Separate admin / field-officer sign-in, wrong endpoint → 403 | VERIFIED | `auth.controller.js:51-53`; `routes/auth.routes.js:12-13` | — |
| FR-03 | Public self-registration refused (410) | VERIFIED | `routes/auth.routes.js:9-11` | `auth.controller.register` exists but is **not mounted** (dead code) |
| FR-04 | Role matrix on every endpoint | VERIFIED | 12 route modules: `router.use(authenticateToken)` + `requireRole(...)`; live `GET /api/students` → 401 | Beneficiary reads open to any authenticated role |
| FR-05 | Register beneficiary with validated fields | VERIFIED | `students.controller.js:15-24`; `services/studentRecordFormat.js` | — |
| FR-06 | Only the five approved schools | VERIFIED | `config/schools.js`; `db/schema.sql:43-44` | The five are a project assumption, not a ministry list |
| FR-07 | Score a registration against every existing record | VERIFIED | `students.controller.js:69-96` | Quadratic cost; no blocking (FR-34) |
| FR-08 | Screening never blocks creation | VERIFIED | `students.controller.js:101` | — |
| FR-09 | Store score, model version, threshold, feature vector | VERIFIED | `students.controller.js:104-108` → `duplicate_flags` | — |
| FR-10 | Mask identifiers; reveal only on audited request | VERIFIED | `routes/duplicateFlags.routes.js:6-7`; `duplicateFlags.controller.js` | API-layer masking, not column encryption |
| FR-11 | Decision with mandatory reason + case history | VERIFIED | `duplicateFlags.controller.js:14,458-470`; `duplicate_review_events` | — |
| FR-12 | Eligibility from five weighted factors, four categories | VERIFIED | `services/eligibility.js` (30+25+25+10+10) | Weights are a project judgement, not a cited policy |
| FR-13 | Submit bursary award application | VERIFIED | `routes/bursaryAwards.routes.js:9`; `bursaryAwards.controller.js` | — |
| FR-14 | Verification outcome; `verified` needs evidence | VERIFIED | `bursaryAwards.controller.js:46`; `bursary_award_verification_events` | — |
| FR-15 | Approval blocked if unverified or duplicates open | VERIFIED | `bursaryAwards.controller.js:169-188` (409 twice) | — |
| FR-16 | Record payment as `issued`; refuse invalid payments | PARTIAL | `routes/disbursements.routes.js:11-12`; `disbursements.controller.js` | Refusal branches not line-verified this pass |
| FR-17 | Clearance recorded separately with evidence | PARTIAL | `disbursements.routes.js:13-14` | as above |
| FR-18 | Acknowledgement; shortfall → `discrepancy` | PARTIAL | `disbursements.routes.js:14`; `disbursement_reconciliation_events` | as above |
| FR-19 | Report reconciliation exceptions | PARTIAL | `disbursements.routes.js:10` | Class list not re-verified line by line |
| FR-20 | Random QR token per student + QR image | VERIFIED | `students.controller.js:58-60` | No re-issue path (FR-35) |
| FR-21 | Public endpoint reports only whether a record exists | VERIFIED | `controllers/verification.controller.js`; live `POST /api/verify` → `{"found":false}` | Rate limit is per process |
| FR-22 | Issue QR-verifiable certificate; refuse a second | PARTIAL | `controllers/certificates.controller.js`; `models/bursaryCertificate.model.js` | **HEAD only — absent from the deployed image** |
| FR-23 | Verify a certificate publicly by QR token or by typing its printed reference; an unknown reference answers "not found" | VERIFIED | `certificates.controller.js` verification path; `bursaryCertificates.test.js`, `certificateVerificationRoute.test.js` | Revocation removed from scope |
| FR-24 | `not_current` when the award changed | VERIFIED | `certificates.controller.js:67-77` | Same deployment caveat |
| FR-25 | Dashboard totals, six-month trend, recent activity | VERIFIED | `controllers/adminDashboard.controller.js` | — |
| FR-26 | Date-range PDF export | VERIFIED | `controllers/reports.controller.js:3,97` | One endpoint; no CSV/HTML variant |
| FR-27 | Audit every state change | VERIFIED | `services/auditLog.js` + call sites | No tamper-evident chain in `audit_logs` |
| FR-28 | Read/update cut-offs within 0–1, and audit | PARTIAL | `routes/settings.routes.js`; `config/settings.js` | In-memory per process; audit of the change not line-verified |
| FR-29 | List users, create accounts | VERIFIED | `routes/users.routes.js:8-11` (admin only) | No password reset or deactivation endpoint |
| FR-30 | Liveness and readiness separate, readiness fails closed | VERIFIED | `src/index.js:69-73`; `services/databaseReadiness.js`; live 200/200 | — |
| FR-31 | **Random Forest over four similarity features** (approved proposal) | **NOT IMPLEMENTED** | Delivered: XGBoost, six features — `ml-service/predict.py`, `feature_engineering.py:11` | Objective deviation; must be declared (`PRODUCTION_ML_MODEL_VERIFICATION.md` §1) |
| FR-32 | NEMIS / national identifier verification integration | NOT IMPLEMENTED | out of scope | Requires ministry access |
| FR-33 | Offline operation and native mobile applications | NOT IMPLEMENTED | out of scope | — |
| FR-34 | No candidate blocking | PARTIAL | `students.controller.js:69-73` | Whole-registry `FOR UPDATE` scan per registration; admin rescan quadratic |
| FR-35 | No re-issue path for a student QR token | NOT IMPLEMENTED | no such endpoint | A lost token cannot be recreated |
| FR-36 | No token expiry or rotation | NOT IMPLEMENTED | `students_qr_token_unique` only | Accepted risk |
| FR-37 | Payments are recorded, not executed | PARTIAL | `disbursements` state only | Deliberate scope limit, to be stated as such |

## 2. Non-functional requirements (24)

| ID | Requirement (abbreviated) | Status | Evidence | Limitation |
| --- | --- | --- | --- | --- |
| NFR-01 | Screening completes within 3 s | PARTIAL | `backend/tests/performance.test.js` asserts 50 pairs < 3 000 ms and passed | Nothing measured above 50 pairs; a 1 000-record registry untested |
| NFR-02 | Password storage resists offline attack | VERIFIED | `bcrypt.hash(password, 12)` | Cost/throughput not benchmarked |
| NFR-03 | Signed, time-bounded credentials | VERIFIED | `expiresIn: '8h'`; `config/jwtSecret.js` refuses a missing secret | No refresh list or revocation |
| NFR-04 | Authorisation does not trust a client claim | VERIFIED | `middleware/auth.js` re-reads the user; `requireRole` uses the DB role | — |
| NFR-05 | Identifiers not exposed by default | VERIFIED | queue masks; reveal is a separate audited endpoint | — |
| NFR-06 | Public verification discloses no beneficiary data | VERIFIED | `verification.controller.js` → `{found}`; `certificates.controller.js publicView` omits name/UPI/school/amount | — |
| NFR-07 | Public endpoints rate limited | VERIFIED | `verificationRateLimit.js`, `certificateRateLimit.js` (10 / 15 min / IP) | Per-process counters |
| NFR-08 | Sign-in rate limited | VERIFIED | `loginRateLimit.js` (10 / 15 min / IP) | as above |
| NFR-09 | Request bodies bounded | VERIFIED | `src/index.js:64` `express.json({limit:'100kb'})` | Other routers' limits not re-checked |
| NFR-10 | Errors do not leak internals | VERIFIED | `middleware/errorHandler.js` returns fixed strings; `index.js:33-39` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` | Headers are hand-rolled (no `helmet`, no Content-Security-Policy) |
| NFR-11 | Browser origins restricted | VERIFIED | `config/cors.js` allowlist; `index.js:41-47` → 403 | Allowlist is environment-driven |
| NFR-12 | Integrity enforced by the database | VERIFIED | CHECKs, unique indexes, transition constraints in `schema.sql` | Triggers inspected, not fuzzed |
| NFR-13 | Concurrent registrations do not interleave | VERIFIED | `pg_advisory_xact_lock(hashtext('sbms.student.registration'))` + `FOR UPDATE` | Serialises all registrations |
| NFR-14 | Usable by non-technical officers | **NOT TESTED** | no participants, consent, or session notes | `docs/uat-test-plan.md` is a plan, not evidence |
| NFR-15 | Maintainable and reproducible | VERIFIED | 24 jest suites + 33 Python unit tests pass; 27-file doc set; migration ledger | Frontend has zero automated tests |
| NFR-16 | Operable within a zero-cost budget | PARTIAL | App Service **F1 Free**, PostgreSQL **Burstable B1ms**, Container App 0–1 replicas | No always-on, cold starts, CPU quota, `geoRedundantBackup Disabled` |
| NFR-17 | A human makes every duplicate and payment decision | VERIFIED | flags advisory; `reviewPriority` is a label; approval gated by human verification | — |
| NFR-18 | Recovery from database loss with verified evidence | PARTIAL | `docs/database-recovery-rehearsal-2026-10-31.md` + local artefacts | Not re-executed this pass; no Azure PITR drill |
| NFR-19 | Compatible with ordinary modern browsers | **NOT TESTED** | `npm run build` succeeds (2006 modules) | No browser matrix, no device run |
| NFR-20 | Predictable degradation when the predictor is unavailable | PARTIAL | predictor failure → `DUPLICATE_PREDICTOR_FAILED` → **503** `DUPLICATE_SCREENING_UNAVAILABLE` with the transaction rolled back (`students.controller.js:76-82`; `duplicateFlags.controller.js:258-263`) | Fail-closed, not graceful: no rule-based fallback, registration is unavailable while `predict.py` is down |
| NFR-21 | Audit records attributable and complete for state-changing actions | VERIFIED | `services/auditLog.js` written from every state-changing controller; `tests/workflow.test.js` exercises a ten-action sequence | Append-only by convention only — no database-level immutability and no retention policy |
| NFR-22 | Load-tested capacity for a constituency-scale registry | **NOT TESTED** | no hosted load test; the only performance evidence is 50 pairs under 3 s (`performance.test.js`) | 500 / 1 000-candidate runs and two simultaneous registrations were not executed this pass (G-12) |
| NFR-23 | Thresholds validated against adjudicated beneficiary data | **NOT TESTED** | no adjudicated label set exists; `thresholds_validated: false` is returned by the API itself (`students.controller.js:150-151`) | 0.50 is provisional and non-durable (G-18, G-34) |
| NFR-24 | Independent confirmation of receipt by a school | PARTIAL | acknowledgement is officer-assisted by design: `PATCH /api/disbursements/:id/acknowledgement` (admin / field officer only) stores `acknowledged_amount`, `acknowledgement_evidence_ref` and `acknowledgement_method = 'officer_assisted'`, writes a `disbursement_reconciliation_events` row and audits `RECEIPT_ACKNOWLEDGED_OFFICER_ASSISTED` (`disbursements.controller.js:193-232`) | No school-initiated confirmation channel exists; the requirement is re-scoped and labelled, not met |

## 3. Recount (this pass)

| Status | FR | NFR |
| --- | --- | --- |
| VERIFIED | 24 | 15 |
| PARTIAL | 8 | 5 |
| NOT IMPLEMENTED | 5 | 0 |
| NOT TESTED | 0 | 4 |
| **Total** | **37** | **24** |

Requirement totals are unchanged from the approved Chapter 4 draft (37 FR, 24 NFR). **The distribution has changed**:
FR-22/23/24 exist but are undeployed; NFR-16 moved to PARTIAL on the strength of the Azure inventory; NFR-18 stays
PARTIAL because the 2026-10-31 rehearsal was not re-run; NFR-21 is VERIFIED for the workflows exercised but the audit
table has no database-level immutability; NFR-22 and NFR-23 have no executed evidence at all; NFR-24 is PARTIAL because
acknowledgement is officer-assisted and labelled as such. FR-31 is the one requirement whose *status class* changed
(was "met via Random Forest", now "not implemented as specified") and it must be reported as an objective deviation.

## 4. Gap references

| ID | Requirement(s) it constrains |
| --- | --- |
| G-11 | FR-33 — no phone-camera decoding, so scanning is typed/manual |
| G-12 | FR-34, NFR-01 — pairwise screening verified at 50 candidates only |
| G-17 | FR-29 (eligibility), FR-30 (dashboard/reports) — thin automated coverage |
| G-21 | FR-31 — Random Forest/four features specified, XGBoost/six delivered |
| G-29 | FR-22–FR-24 — implemented and tested at HEAD, absent from the deployed image |
| G-33 | NFR-10 — security headers present, CSP absent |

