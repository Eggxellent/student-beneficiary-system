# SBMS COMPREHENSIVE INFORMATION REPORT FOR CHAPTERS FOUR, FIVE AND SIX

**Document type:** evidence dossier and drafting resource
**System:** Student Beneficiary Management System (SBMS)
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Prepared:** 2026-11-02
**Institution context:** capstone project report; Design Science Research through an Agile cycle

---

## Document control

| Item | Value |
| --- | --- |
| This report | `SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md` and `.pdf` |
| Ten supporting data files | `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md`, `SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md`, `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md`, `SBMS_API_ENDPOINT_CATALOGUE.md`, `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md`, `SBMS_TEST_EVIDENCE_CATALOGUE.md`, `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md`, `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md`, `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md`, `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` |
| Earlier deliverables re-used, not duplicated | `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`, `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md`, `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md`, `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md`, `DOCUMENTATION_GAP_REGISTER.md`, `EVIDENCE_AND_VERIFICATION_REPORT.md`, `FIGURE_PLACEHOLDER_CHECKLIST.md` |
| Evidence position | Implementation facts read from code at the named revision; test counts taken from dated run records and **not re-executed**; ML metrics synthetic only; the unsupported claims are stated in Part III §24 and itemised in `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §4 |
| What this document is not | It is not a replacement for the three chapters. It is the evidence base and drafting aid for them |

## How to use this report

1. **Part I** supplies everything Chapter Four needs: scope, actors, requirement counts, the analysis and design facts each diagram must encode, the interface inventory, the schema, and the deployment architecture.
2. **Part II** supplies everything Chapter Five needs: the implementation environment, the feature-by-feature implementation map, the test inventory with what each suite proves, the defect log, and the evaluation against objectives and requirements.
3. **Part III** supplies everything Chapter Six needs: an objective-by-objective conclusion with an honest status, the stated contribution, recommendations, and future work with owners.
4. **Part IV** is the assurance layer: a completeness matrix (requested area → status → where it is), the gap summary, reproduction commands and the document map.
5. Every factual statement names its source. Where a statement rests on code reading only, it says so. Where evidence is absent, the text says *not verified* rather than implying success.

## Executive summary of the evidence position

| Dimension | Position at this revision |
| --- | --- |
| Code | Complete three-tier system with a deployed demonstration instance; 45 HTTP endpoints, 13 tables, 14 forward migrations |
| Automated tests | 151 Jest tests in 24 suites (2026-11-01), 43 native in-process tests, 3 live-HTTP smoke tests, 40 Python tests, 43 browser checks across three harnesses |
| Build | Frontend production build exits 0 (2 006 modules); API image built by CI and running on Azure |
| Machine learning | One deployed XGBoost artifact over six features; synthetic holdout F1 0.9063 at cut-off 0.50; **no real-world metric exists** |
| Deployment | Live on Azure (UAE North) as a demonstration instance, verified on 2026-10-31 and 2026-11-01 |
| User evidence | **None.** No user acceptance study, no usability test, no fieldwork |
| Scale evidence | **None.** No load test; the only timing is 22.67 ms for 50 candidate pairs |
| Physical QR evidence | **None.** No phone-camera scan of a printed code was recorded |

Three sentences summarise the honest position. The system is built, tested at API and browser level, and deployed. Its duplicate-detection model is evaluated only against synthetic data, so no accuracy claim about real beneficiaries is possible. Its usability, scale behaviour and physical QR identification are unverified and must be reported as such.

---

# PART I — EVIDENCE FOR CHAPTER FOUR: SYSTEM ANALYSIS AND DESIGN

## 1. System identity and problem framing

SBMS exists to replace a manual bursary register with a system that (a) registers a beneficiary once, (b) detects a probable repeat application before money is committed, (c) routes every duplicate signal to a human, and (d) leaves an audit trail from registration to receipt. The design's central control is therefore not the classifier: it is the **gate**. A model score may create a case, but only an administrator's decision can release an award for payment, and only a verified beneficiary may be approved at all.

| Element | Fact at this revision |
| --- | --- |
| Presentation | React 18 SPA, Vite, `react-router-dom`; 14 screens across 16 routes |
| Application | Node 22 + Express 4; 13 routers, 13 controllers, 10 services, 5 models |
| Persistence | PostgreSQL 17; 13 tables; 14 forward migrations plus one rollback script |
| Inference | Python 3.11 + scikit-learn + XGBoost, one artifact, spawned as a stdio subprocess |
| Delivery | One container image (API plus ML) on Azure Container Apps; static frontend on App Service F1 |
| Identity | JWT, 8-hour expiry, role re-read from the database on every request |

The two material departures from the approved proposal must be stated in Chapter Four, not discovered in Chapter Six. First, the deployed classifier is **XGBoost over six features**, not the specified Random Forest over four; the Random Forest survives only as an unevaluated research candidate. Second, the system **exceeds** the proposal on award reconciliation and certificates while **falling short** of the proposal's implied evaluation design, because registration still compares a new record against the entire registry with no candidate blocking.

## 2. Requirements: what the chapter can state as fact

| Group | Count | Verified | Partial | Not implemented |
| --- | --- | --- | --- | --- |
| Functional requirements delivered (FR-01 to FR-30) | 30 | 24 | 6 | 0 |
| Proposal requirements carried as deviations (FR-31 to FR-33) | 3 | 0 | 0 | 3 |
| Functional gaps stated as gaps (FR-34 to FR-37) | 4 | 0 | 0 | 4 |
| Non-functional requirements (NFR-01 to NFR-21) | 21 | 14 | 7 | 0 |

The register, with the statement, actor, priority, implementation location, test and status of each requirement, is `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §6-§7. Chapter Four should reproduce the register as its Table 4.1 and Table 4.2 rather than restating requirements in prose, because prose drifts and the register does not.

**The six gaps that must appear as gaps:** no candidate blocking (FR-34), no QR re-issue (FR-35), no token expiry (FR-36), no payment execution (FR-37), no NEMIS integration (FR-32), no offline or native mobile operation (FR-33).

## 3. Actors and their interests

| Actor | Interest | Interface surface | Evidence of role enforcement |
| --- | --- | --- | --- |
| Field Officer | Register accurately, see whether a case was raised, record evidence, submit awards | `/students`, `/students/register`, `/eligibility`, `/disbursements`, `/field-officer` | 403 on adjudication and approval (`workflow.test.js` #11) |
| Administrator | Decide cases, approve awards, control payments, issue certificates, read the audit trail | `/dashboard`, `/duplicate-review`, `/disbursements`, `/reports`, `/settings`, `/audit`, `/users` | 403 on registration and award submission (`workflow.test.js` #11) |
| Public verifier | Confirm a printed code is genuine without learning anything about the holder | `/verify`, `/verify-certificate` | Boolean and authenticity facts only (15 tests) |
| Operator | Apply migrations, manage secrets, start and stop the deployment, restore a backup | CLI, `deploy/azure/**` | Start-up guards; readiness contract |
| Programme owner | Set the cut-off policy, adjudication protocol and acknowledgement deadline | Not in the interface | Open decisions D1-D5 |

The role split is by *duty*, not seniority: the officer who registers a beneficiary cannot approve money for that beneficiary, and the administrator who approves cannot register. That separation is the design's answer to the collusion and error risk described in Chapter Two.

## 4. Analysis artefacts: what each diagram must encode

Chapter Four specifies eleven analysis artefacts. Each must be drawn from the implemented system, so each row gives the facts the drawing has to carry and the code that establishes them.

| Figure | What it must show | Facts that must appear | Source |
| --- | --- | --- | --- |
| Context diagram (4.3.1) | SBMS and its external parties | Field officer, administrator, public verifier, PostgreSQL, the ML predictor as an internal component, no NEMIS link | `backend/src/index.js` mount table |
| Use case diagram (4.3.2) | Actors to use cases | The 14 screens' capabilities; public verification as unauthenticated | `frontend/src/App.jsx`; API catalogue §3 |
| Activity: registration and screening (4.3.3) | Decision points | Validation, advisory lock, whole-registry scoring, qualification, `top-1` aggregation, 503 on predictor failure, student still created | `students.controller.js:31-161` |
| Activity: review to payment gate (4.3.4) | Two gates | Approval requires verified and no open or confirmed case; payment requires approved, verified, no open case and amount ceiling | `bursaryAwards.controller.js:151-209`; `disbursements.controller.js:65-136` |
| Class diagram (4.3.5) | Entities and services | Student, DuplicateCase, ReviewEvent, Award, VerificationEvent, Disbursement, ReconciliationEvent, Certificate, User | Data dictionary §4 |
| Sequence: registration (4.3.6) | Message order across tiers | SPA → API → lock → SELECT FOR UPDATE → predictor → aggregation → insert → audit → response | Architecture map §5 |
| Sequence: review decision (4.3.7) | Decision to terminal state | Masked queue, audited reveal, decision plus event plus audit in one transaction | `duplicateFlags.controller.js` |
| Sequence: award to certificate (4.3.8) | Four gates and a snapshot | Verification evidence, approval, payment ceiling, certificate snapshot with unique award | API catalogue §3.5-§3.6 |
| Sequence: public verification (4.3.9) | Token handling | Fragment token, `replaceState`, single-key POST, existence query, boolean answer | `docs/qr-verification-2026-10-30.md` §1 |
| ER diagram (4.3.10) | 13 tables and relationships | Cascades for review data; RESTRICT for money, certification and verification records | Data dictionary §5 |
| ML pipeline diagram (4.3.11) | Six stages | Generation, feature construction, training, validation, artifact, serving | ML documentation §2-§3 |

`FIGURE_PLACEHOLDER_CHECKLIST.md` already separates diagrams that can be drawn from specifications from those that need screenshots. No screenshot exists yet (G-04).

## 5. Design: architecture and module responsibilities

| Layer | Responsibility | Notable design choice | Where the evidence sits |
| --- | --- | --- | --- |
| Presentation | Rendering, role routing, plain-language messaging | Officers never see model internals; administrators see score, version and cut-offs | UI inventory §3-§5 |
| Application | Auth, validation, workflow, audit | The role is re-read from the database, so a stale token cannot carry an old privilege | Security catalogue §4 |
| Domain services | Screening, aggregation, rules, documents, readiness | One shared module per rule set, so policy cannot drift between screens | Architecture map §3.2 |
| Persistence | Constraints and referential actions | The database refuses an unverified approval and a half-recorded clearance | Data dictionary §7 |
| Inference | Feature construction and scoring | Training and serving share one feature module | ML documentation §3 |

Three design decisions deserve explicit treatment because they are what the chapter's "design justification" section should argue:

1. **A human gate enforced by the schema.** `bursary_awards_approval_verification_check` makes it impossible to store an approved award for an unverified beneficiary, regardless of which code path attempted it. The control is not in the controller alone.
2. **Snapshot rather than reference for certificates.** A certificate copies the facts it prints, so a later award edit cannot silently alter what a printed document says; verification compares snapshot with live award and answers `not_current` on a mismatch.
3. **Aggregation of cases, not of scores.** `top-1` caps cases per registration at one while still counting suppressed candidates in the audit trail. It manages workload without pretending to improve the model.

## 6. Design: workflow and state

| Entity | States | Transition enforcer | Refusal message |
| --- | --- | --- | --- |
| Duplicate case | `pending` → `confirmed_duplicate` / `not_duplicate` / `needs_verification` (terminal) | Controller plus event history | `This duplicate flag has already been decided` |
| Award | `submitted` → `approved` / `rejected` | Schema CHECK plus controller | `Verify the beneficiary before approving this award.` / `Resolve duplicate review cases before approving this award.` |
| Verification | `not_checked` → `verified` / `not_found` / `needs_investigation` | Schema CHECK on evidence | `Provide an outcome, notes, and evidence for verified cases.` |
| Payment | `issued` → `cleared` / `failed` / `cancelled` | `canTransitionPayment` plus CHECK | `This payment status cannot be changed.` |
| Receipt | `null` → `awaiting_acknowledgement` → `acknowledged` / `discrepancy` | `receiptStatus` in cents | `Enter the received amount and evidence reference.` |
| Certificate | `active` → `revoked` | CHECK plus UNIQUE award | `This certificate has already been revoked.` |

A confirmed duplicate is deliberately **terminal**: it leaves the beneficiary unpayable and cannot be reversed through the API. That is correct policy, and it also means a mistaken confirmation can be corrected only in the database. The chapter should say so rather than describe the design as forgiving.

## 7. Design: access control, security and validation

| Control | Implementation | What must be said about it |
| --- | --- | --- |
| Authentication | bcrypt cost 12; JWT 8 h; secret >= 32 bytes validated at start-up | Implemented and tested; no multi-factor and no token revocation list |
| Authorisation | `requireRole` per route or router; role re-read from the row | Tested; matrix in the security catalogue §3 |
| Account state | `is_active` checked on every request | Deactivation is the only revocation mechanism |
| Origin control | Allowlist checked before routing plus `cors` | A browser policy, not authentication |
| Headers | `nosniff`, `DENY`, `no-referrer`, restricted permissions | No CSP and no HSTS from the API |
| Body bound | 100 kB JSON limit | Tested |
| Error hygiene | 5xx always `Internal server error`; allowlisted diagnostics only | Tested |
| Rate limits | 10 sign-ins, 10 student verifications, 20 certificate verifications per IP per 15 min | In-process only; not shared across replicas |
| Validation | Zod per endpoint with cross-field rules | Tested through the API |
| Identifier masking | Last three characters until an audited reveal | Tested |
| Privacy of public endpoints | Boolean and authenticity facts only | 15 tests |

The residual risks in `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md` §11 belong in the chapter's security-evaluation subsection. They are: a JWT in `localStorage`, no revocation list, no per-account lockout, no MFA, an in-process limiter, no CSP or HSTS, no row-level security, a conventionally-immutable audit trail, a temporary admin-login diagnostic, no penetration test and no dependency-audit gate.

## 8. Design: interface inventory

| Screen group | Routes | Purpose | Evidence |
| --- | --- | --- | --- |
| Public verification | `/verify`, `/verify-certificate` | Existence and authenticity, one line or a few facts | 9 browser checks; 15 API tests |
| Sign-in | `/login`, `/admin/login`, `/field-officer/login` | Role-specific entry | 4 auth tests; browser check 1 |
| Officer workspace | `/field-officer`, `/students`, `/students/register`, `/eligibility` | Register, review the register, score eligibility | 23 browser checks; 9 student tests |
| Award and payment | `/disbursements` (+ certificate panel) | Submit, verify, approve, pay, clear, acknowledge, certify | 20 API tests; no browser harness |
| Administration | `/dashboard`, `/duplicate-review`, `/reports`, `/settings`, `/audit`, `/users` | Adjudicate, monitor, tune, administer | 33 API tests; 9 browser checks |

Full detail, including the deliberate asymmetry between what an officer and an administrator may see, is in `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md`. Two interface facts matter for the chapter's honesty: the registry screen renders whatever the endpoint returns because the endpoint has no pagination, and the administrator's award picker has no data because `GET /api/students` is officer-only.

## 9. Design: database

| Aspect | Fact |
| --- | --- |
| Tables | 13: users, students, duplicate_flags, duplicate_review_events, bursary_awards, bursary_award_verification_events, disbursements, disbursement_reconciliation_events, bursary_certificates, audit_logs, reports, beneficiaries, sbms_schema_migrations |
| Migrations | 14 forward files, dated 20261019 to 20261031, plus one rollback script |
| Constraints that matter most | approval requires verified; clearance requires evidence; acknowledgement requires officer-assisted method and evidence; one certificate per award; one case per unordered pair; token format `^[a-f0-9]{64}$` |
| Referential asymmetry | Review data cascades; money, certification and verification data restrict deletion |
| Indexes | Nine purpose-built indexes; none on student name, school or date of birth, consistent with whole-registry scanning |
| Legacy | `beneficiaries` table and `scholarship_amount` with unresolved meaning, deliberately not mapped to awards |

The full column-level dictionary is `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` §4. That file is the source for the chapter's Table 4.4 (column design) and must be cited rather than paraphrased.

## 10. Design: physical deployment

| Element | Fact |
| --- | --- |
| API | Azure Container Apps, `minReplicas 0`, image `ghcr.io/eggxellent/sbms-api` (1.37 GB) |
| Frontend | Azure App Service F1 (free), zip deployment of the Vite build |
| Database | Azure Database for PostgreSQL Flexible Server, B1MS, 32 GiB, stopped between demonstrations |
| Region | UAE North, forced by a `sys.regionrestriction` policy; Static Web Apps is not creatable on this subscription |
| Cost | $4.42 per idle month; $4.58 per 8-hour demonstration; about $6.42 in a normal month |
| Logs | Destination none; diagnostics are the process's own output plus the start-up guard message |

Chapter Four's deployment figure must show one container (API plus ML), one web app, one managed database and the public HTTPS ingress, and must state that this is a demonstration topology rather than a production one.

## 11. What Chapter Four must not claim

| Tempting claim | Why it fails |
| --- | --- |
| "The architecture scales horizontally" | Rate limits, thresholds and the ML subprocess are per-process; nothing was tested under load |
| "The design eliminates duplicate payments" | It blocks payment only when a case exists and is open or confirmed; an undetected duplicate still passes |
| "The ML model was specified as XGBoost" | The proposal specified Random Forest; this is a documented deviation (G-21) |
| "The system integrates with national registries" | It does not (FR-32) |
| "Certificates prove payment" | They prove an approval; the PDF says so explicitly |

---

# PART II — EVIDENCE FOR CHAPTER FIVE: IMPLEMENTATION, TESTING AND EVALUATION

## 12. Implementation environment

| Item | Value | Status of the evidence |
| --- | --- | --- |
| Operating system | Windows 11 (win32) | Recorded |
| Node.js | v22.11.0 | Recorded |
| npm | 10.9.0 | Recorded |
| Python | 3.11.9 with a service virtual environment | Recorded |
| PostgreSQL | 17.11 client and server | Recorded |
| Docker | CLI 29.9.2, engine **not** running | Recorded; image built by CI instead |
| Browser automation | Headless Chrome over the DevTools Protocol from Node 22's built-in `WebSocket` | Recorded |
| Hardware specification | **Not recorded** (G-01); logs show 7.4 GB RAM with about 0.5 GB free | Blocking gap |
| Test database | Disposable `sbms_test` on loopback, role `sbms_test_runner`, guarded by `testDatabaseGuard.js` | Recorded |

The hardware gap is the chapter's weakest environmental statement. It is honest to write that the workstation specification was not captured, that available memory was observed at 7.4 GB with approximately 0.5 GB free during the sweeps, and that one sweep produced 149 or 150 of 151 tests under memory pressure (G-02), rather than to claim a clean environment.

## 13. Implementation by feature, and where the code is

| Feature | Implementation | Tests |
| --- | --- | --- |
| Authentication and RBAC | Two sign-in endpoints, JWT, role re-read, user administration | 4 + 6 + 1 |
| Registration and validation | Zod schema, five-school constraint, phone and identifier normalisation | 9 |
| Duplicate screening | Advisory lock, whole-registry comparison, Python subprocess, `top-1` aggregation, provenance | 15 + 13 + 8 + 6 + 1 + 4 |
| Duplicate review | Masked queue, audited reveal, decision with reason, terminal states | 9 |
| Eligibility scoring | Five weighted factors, four categories, persisted result | Route and validation only |
| Award lifecycle | Submission, verification with evidence, approval and rejection with reasons | 5 |
| Payments and reconciliation | Issue, clearance with evidence, officer-assisted acknowledgement, discrepancy detection, exceptions | 4 + 4 + 4 |
| Student QR identification | 32 random bytes, fragment token, existence-only endpoint, dedicated limiter | 10 + 4 |
| Award certificates | Snapshot row, reference, token, A4 landscape PDF, revocation, `not_current` | 12 + 5 |
| Dashboard, reports, audit, settings | Totals and trend, date-range PDF, audit trail, three cut-offs | 6 (authorisation); content by inspection |
| Operations | Health, readiness, start-up guards, migration ledger | 1 + 5 + migration unit tests |

## 14. Test evidence, by level

| Level | Command | Result | Date |
| --- | --- | --- | --- |
| Backend Jest, whole tree | `npx jest --runInBand tests` | **24 suites / 151 tests pass** | 2026-11-01 |
| Backend Jest, earlier generation | `npm test` | 21 suites / 128 tests pass | 2026-10-31 |
| Backend native, in-process | `node --test` over seven files | **43/43 pass** | 2026-10-31 |
| Backend native, out-of-process | `node --test test/api.smoke.test.js` | **3/3 pass** | 2026-10-31 |
| Frontend production build | `npm.cmd --prefix frontend run build` | **exit 0**, 2 006 modules, 10.11 s | 2026-11-01 |
| ML service | `unittest discover -s ml-service/tests` | **33/33 pass** | 2026-10-31 |
| ML research helper | `unittest discover -s experiments/sbms_dataset` | **7/7 pass** | 2026-10-31 |
| Browser, registration and review | `node scripts/browser-smoke.mjs` | **23/23 pass** | 2026-10-30 |
| Browser, QR page | `node scripts/qr-smoke.mjs` | **9/9 pass** | 2026-10-30 |
| Browser, registration fields on the live deployment | `node scripts/registration-fields-smoke.mjs` | **11/11 pass** | 2026-11-01 |
| Database restore | `pg_dump` then `pg_restore` into an independent database | Pass, digests compared | 2026-10-31 |
| Phone-camera QR scan | manual | **Not run** | — |
| Browser check of `/verify-certificate` | no harness | **Not run** | — |
| User acceptance | — | **Not conducted** | — |
| Load or scale test | — | **Not run** | — |
| Docker build in this environment | — | **Not run** (engine unavailable) | — |

The count that may be quoted as the current automated position is **24 suites / 151 tests, 2026-11-01**, plus the native, browser and Python layers separately. Counts must never be summed across levels, and never quoted without a date.

## 15. Defects found during testing, and what closed them

Six defects are tabled here because each has a code-level root cause, a fix and a test or browser check at this revision. They are a selection, not a register: the session documents record others, including a date-of-birth feature skew that made two identical dates score `dob_match: 0`, a registration 500 caused by an origin variable read at request time, a deployed SPA that returned 404 for every `/api/verify` call, a review queue that closed a case as soon as it was opened, and a readiness check that passed against a schema missing a table. Those are recorded where they happened, in `docs/SBMS_PROJECT_HANDOVER_2026-10.md` §13.2-§13.4 and `docs/azure-deployment-log-2026-10-31.md` §7-§8, and this report does not restate them.

| Defect | Effect before the fix | Root cause | Closed by |
| --- | --- | --- | --- |
| Payment clearance returned 500 for every status change | No payment could ever be marked cleared; all reconciliation reporting was unreachable | One SQL parameter reused across `VARCHAR(20)`, `VARCHAR(50)` and a text comparison (PostgreSQL 42P08) | Explicit casts, with a comment recording why they must stay |
| Stale QR result on a second scan in the same tab | A valid code followed by an invalid one still read "Record found" | Verification ran once on mount; a hash-only change does not remount | `hashchange` listener |
| StrictMode regression introduced by the first fix | Development runs reported "invalid" for a valid token | The effect re-read an already-stripped URL | Token captured during render, effect keyed on it |
| `risk_level: critical` unreachable in the UI | A suspicious case could never be styled as such | The API only emitted `review` | API now publishes `priority` and `exact_identifier_matches` |
| High-priority cut-off was dead configuration | Every model case was `high`; screen showed "high 0.00" | Queue prioritised on the review cut-off and published a null threshold | Priority computed on the high-priority cut-off and published |
| Registration form omitted UPI and birth certificate | The critical exact-identifier rule could only fire for seeded rows | Form posted five fields; API accepted eight | Two optional inputs added and verified live with 11 checks |

Two of these are the strongest evidence that testing found real faults rather than confirming what was written: payment clearance was completely broken and invisible to the suite until a workflow test exercised it, and the QR defect lived in the interaction between hash routing and React's mount behaviour, where no unit test would have reached it.

## 16. Machine-learning evaluation

| Aspect | Fact | What it supports |
| --- | --- | --- |
| Artifact | `xgboost:6ec9f2a3…`, six features, one file | Provenance per case |
| Holdout | 12 000 synthetic pairs; 0 shared groups, 0 shared identities, 0 identical rows | Leakage check |
| In-sample versus holdout F1 | 0.9196 versus 0.9063 | No memorisation |
| Grouped cross-validation | 0.9067 mean F1, within 0.0004 of the holdout | Stability inside the training file |
| Learning curve | 0.8886 at 10% of groups rising to 0.9063 at 100% | Near-flat, not memorisation |
| Live cut-off | 0.50: precision 0.9204, recall 0.8927, F1 0.9063, miss 10.73%, FPR on hard negatives 7.72% | Synthetic operating point only |
| Independent FPR baseline | 0.35% of 2 000 synthetic unrelated pairs at 0.50 | A different question from 7.72%; report both or neither |
| Per-feature AUC | 0.34 to 0.71 | No single-feature shortcut |
| Adjudicated data | **None** | No real-world metric is possible |

The reported numbers describe a generator, not Kenyan bursary records. Three limitations carry into Chapter Six: positives are one duplicate pattern (`repeat_application`), the holdout was used for model selection (so the figures are selection-optimistic), and one artifact with one seed means a retrain invalidates them.

## 17. Evaluation against the objectives

| Objective | Status | Evidence | What is missing |
| --- | --- | --- | --- |
| (i) Investigate the existing challenges of manual registration and tracking | **Partially achieved** | Chapter Two document analysis; requirement register derived from it | No primary fieldwork or interviews (G-06) |
| (ii) Design architecture, database schema and ML pipeline | **Achieved with one deviation** | Three-tier architecture, 13 tables, six-feature pipeline, deployed | Random Forest replaced by XGBoost (G-21) |
| (iii) Implement registration, unique identifiers, QR identification and RBAC | **Achieved** | 45 endpoints; QR flow with 10 + 4 tests and 9 browser checks; role matrix with 6 + 11 tests | Phone-camera scan not performed (G-11) |
| (iv) Validate, test and evaluate effectiveness | **Partially achieved** | 151 Jest tests, 43 native, 40 Python, 43 browser checks; synthetic ML evaluation; live deployment checks | No real-user evaluation, no load test, no real-world ML metric |

## 18. Evaluation against non-functional requirements

| NFR | Verdict | Basis |
| --- | --- | --- |
| NFR-01 performance | Partial | 22.67 ms for 50 pairs; no registry-scale measurement |
| NFR-02 to NFR-06 security and privacy | Verified | Tests plus implementation |
| NFR-07 to NFR-11 rate limits, bodies, errors, origins | Verified | Tests; in-process limitation recorded |
| NFR-12 database integrity | Verified | Constraint tests across workflow and certificate suites |
| NFR-13 concurrency | Partial | Advisory lock present; no concurrency test |
| NFR-14 usability | Partial | Browser-checked; no usability study |
| NFR-15 maintainability | Verified | Shared feature module, ordered migrations, three test runners |
| NFR-16 zero-cost operation | Partial | Zero-cost configuration is recorded (scale-to-zero, free tiers); no billed month reconciled |
| NFR-17 human decisions | Verified | Score creates cases only; gates are role-gated |
| NFR-18 recovery | Partial | Rehearsal done; no schedule or retention |
| NFR-19 browser compatibility | Partial | Chrome only |
| NFR-20 degradation | Verified | 503 on predictor failure |
| NFR-21 audit completeness | Partial | Attributed in every tested flow; append-only is convention, not a constraint |

In requirement terms this is 14 verified and 7 partial, the same split as §2; the grouped rows above cover NFR-02 to NFR-11 individually.

## 19. Limits of this evaluation

1. No user acceptance study, so nothing about usability, comprehension or workflow fit can be concluded.
2. No load test, so nothing about concurrency, throughput or latency at scale can be concluded.
3. No real-world duplicate labels, so nothing about model accuracy can be concluded.
4. No phone-camera session, so physical QR identification is unverified even though the code path is tested headlessly.
5. No penetration test or dependency audit, so the security section is a control inventory, not an assurance statement.
6. The deployment is a demonstration instance: one region, no monitoring, no backup schedule, demonstration data.
7. Test counts come from dated runs; none was re-executed for this report.

---

# PART III — EVIDENCE FOR CHAPTER SIX: CONCLUSIONS, RECOMMENDATIONS AND FUTURE WORK

## 20. Conclusions, objective by objective

| Objective | Conclusion the evidence supports | Wording to use |
| --- | --- | --- |
| (i) Investigate the challenges | Partially achieved: the problem is characterised from secondary sources, not fieldwork | The investigation establishes the problem from documentary evidence and does not claim primary data |
| (ii) Design the architecture, schema and pipeline | Achieved, with a stated deviation from the proposal | The artefact is a three-tier system with a 13-table schema and a six-feature pipeline; the classifier is XGBoost rather than the proposed Random Forest, and that change is recorded rather than reconciled |
| (iii) Implement registration, identifiers, QR identification and RBAC | Achieved | Every capability named in the objective is implemented and covered by executed tests, with the physical scan and the scale behaviour reported as unverified |
| (iv) Validate, test and evaluate | Partially achieved | The artefact is tested at API, browser and database level and evaluated against synthetic data only; the absence of adjudicated data and of user involvement bounds the conclusion |

## 21. The stated contribution

| Contribution | Statement the evidence supports | Evidence |
| --- | --- | --- |
| Engineering | A working, deployed bursary system in which an algorithmic signal can never authorise payment, because the gates are enforced in the database as well as the API | `workflow.test.js` #2-#6; schema CHECK constraints |
| Methodological | The registration-level flag arithmetic: because every registration is compared with the whole registry, a per-pair false-positive rate p produces a nuisance flag with probability 1 − (1 − p)^N, so queue volume grows with registry size independently of cut-off. The `top-1` aggregation policy is the response | `docs/ml-evaluation-baseline-2026-10.md` §3-§4 |
| Evaluation | A reproducible synthetic pipeline with leakage gates, an operating-point sweep, and integrity tests that fail the build if the artifact and its recorded metrics diverge | `docs/ml-training-integrity-2026-10-30.md`; `ml-service/tests/` |
| Transparency | A documented set of claim limits and stale-document exclusions that a reader can audit | `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` |

The aggregation finding is the most defensible contribution because it is arithmetic rather than assertion: it follows from the measured per-pair rate and does not depend on any accuracy claim.

## 22. Recommendations

| # | Recommendation | For whom | Basis |
| --- | --- | --- | --- |
| 1 | Obtain adjudicated duplicate pairs before making any accuracy statement | Programme owner | D1, D5 |
| 2 | Choose a cut-off only after stating an acceptable miss rate and the weekly review capacity | Programme owner | D2, D3 |
| 3 | Introduce candidate blocking before the register exceeds a few thousand rows | Project owner | FR-34; the N x p arithmetic |
| 4 | Replace the in-process rate limiter with a shared store before running more than one instance | Operator | NFR-07 |
| 5 | Schedule and retain database backups, and rehearse a restore against the deployment, not only locally | Operator | NFR-18, G-19 |
| 6 | Perform at least one phone-camera scan of a printed student code and a printed certificate | Author | G-11 |
| 7 | Conduct a small structured usability session with officers and record consent | Author | G-06, NFR-14 |
| 8 | Mark `docs/verification.md` and `docs/uat-test-plan.md` superseded or withdraw them | Author | G-07, G-08 |
| 9 | Commit the two untracked root reports and resolve the model-artefact ignore rule | Author | G-27, G-28 |
| 10 | Capture the workstation and device specification, or state explicitly that it was not recorded | Author | G-01 |

## 23. Future work

| Area | Work | Why it matters | Depends on |
| --- | --- | --- | --- |
| Candidate generation | Name-token blocking with a capped candidate list; keep `school_match` as a feature; treat a missing school as a wildcard | Removes the linear and quadratic cost and makes the queue affordable | D4 approval and new tests |
| Model governance | A registry entry per artifact, with the metrics file bound to the hash | Makes a retrain auditable | The current integrity gate as a starting point |
| Calibration | Calibrate scores before calling them probabilities, or stop calling them probabilities | Prevents a 0.6 being read as "60% likely a duplicate" | Adjudicated data |
| Adjudication | In-app review of sampled pairs, stratified by score band, two independent reviewers | Produces the only evidence that can support an accuracy claim | D5 |
| Operations | Scheduled backups, retention, monitoring, alerting and a log workspace | Turns a demonstration into an operated service | Budget decision |
| Security | Short-lived tokens with refresh, server-side revocation, per-account lockout, MFA for administrators, CSP and HSTS, dependency auditing, a penetration test | Closes the residual risks in the security catalogue §11 | Time and review |
| Data model | Remove the legacy `beneficiaries` module; add the constraint tying a payment's student to its award's student | Removes two parallel registries and one unchecked pairing | Migration and data cleanup |
| Accessibility | Keyboard and screen-reader audit plus a contrast check | NFR-14 cannot be claimed without it | Design time |
| Physical identification | Token rotation and re-issue, and a printed-card process | FR-35 and FR-36 are currently gaps | Policy decision on re-issue |

## 24. Boundaries of the conclusions

| Boundary | What it excludes |
| --- | --- |
| Data boundary | Every metric is synthetic; no claim about Kenyan bursary records is supported |
| User boundary | No officer, student, guardian or school participated; usability is unmeasured |
| Scale boundary | Nothing above 50 candidate pairs was timed; no hosted load test exists |
| Device boundary | Chrome only; no phone camera, no printed output on a physical printer |
| Operational boundary | Demonstration instance; no monitoring, no backup schedule, no high availability |
| Security boundary | Control inventory, not an assurance statement; no review or penetration test |
| Governance boundary | The five owner decisions are unanswered, and no supervisor finding can be closed without its wording |

---

# PART IV — ASSURANCE

## 25. Completeness matrix (requested area to status to location)

| Requested area | Status | Where it is covered |
| --- | --- | --- |
| Scope, actors and requirement register | Complete | Part I §1-§3; `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §4-§7 |
| Functional requirements with verification status | Complete | Requirements catalogue §6 |
| Non-functional requirements with status | Complete | Requirements catalogue §7 |
| Analysis artefacts and what each must encode | Complete | Part I §4 |
| Architecture, modules and cross-cutting concerns | Complete | Part I §5; `SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md` §1-§10 |
| Access control matrix and security controls | Complete | Part I §7; `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md` §1-§12 |
| Database schema and full data dictionary | Complete | Part I §9; `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` §2-§11 |
| API endpoint catalogue with contracts | Complete | `SBMS_API_ENDPOINT_CATALOGUE.md` §2-§7 (45 endpoints) |
| ML subsystem: features, artifact, metrics, limits | Complete | Part II §16; `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §1-§14 |
| UI screens, workflows and figure mapping | Complete | Part I §8; `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md` §1-§10 |
| Implementation environment | Complete for software; **gap** for hardware | Part II §12 (G-01) |
| Test inventory with what each suite proves | Complete | Part II §13-§14; `SBMS_TEST_EVIDENCE_CATALOGUE.md` §2-§11 |
| Defect log and resolution | Complete | Part II §15 |
| Evaluation against objectives and NFRs | Complete | Part II §17-§18 |
| Conclusions, contribution, recommendations, future work | Complete | Part III §20-§24 |
| Claim limits and stale-document exclusions | Complete | Part III §24; `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §3-§5 |
| Figures and screenshots | **Not produced** | `FIGURE_PLACEHOLDER_CHECKLIST.md`; G-03, G-04, G-05 |
| User acceptance evidence | **Not available** | G-06 |
| Physical QR scan evidence | **Not available** | G-11 |
| Load and scale evidence | **Not available** | NFR-01 |
| Production metrics, uptime, monitoring | **Not available** | Part II §19 |
| Supervisor findings SBMS-01…18 | **Not recoverable** | `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` (repository root) §11 |

## 26. Gap summary, ordered by submission risk

| Priority | Gap | Effect if unresolved | Owner |
| --- | --- | --- | --- |
| Blocking | G-01 workstation and device specification | Chapter Five §5.2.1 cannot be completed | Author |
| Blocking | G-03/G-04/G-05 figures and screenshots, plus the synthetic-data check | Chapters Four and Five cannot be illustrated | Author |
| Blocking | G-06 a user-acceptance position, or an explicit statement that none was conducted | NFR-14 stays unverified and Chapter Five §5.5.6 is empty | Author |
| Important | G-11 one phone-camera scan of a printed code | The identification mechanism rests on a headless-browser check | Author |
| Important | G-21 the Random Forest to XGBoost deviation | Must be stated in Chapters Four and Six | Author |
| Important | G-07/G-08 stale `uat-test-plan.md` and `verification.md` | Two documents contradict the implementation | Author |
| Important | G-02 the 149/150-of-151 instability | Test stability claim needs a caveat | Author |
| Important | G-25 two test-count generations in one file | A count quoted without a date is misleading | Author |
| Optional | G-27/G-28 untracked reports and the artefact ignore rule | Reproducibility from a clean clone | Author |
| Optional | G-19 retention policy, G-17 monitoring | Operational maturity | Operator |

## 27. Reproduction: how a reader can re-establish every claim

```powershell
# 1. Fix the revision under description
git checkout fix/sbms-completion-work
git rev-parse HEAD          # expect d6b5032

# 2. Backend suite (needs backend/.env.test; values are never printed)
cd backend; npm test        # expect 24 suites / 151 tests on 2026-11-01

# 3. Native tests
node --test test/*.node.test.js test/*.node.js test/*.unit.test.js     # expect 43/43
node --test test/api.smoke.test.js                                    # expect 3/3 against a live API

# 4. Frontend build
npm.cmd --prefix frontend run build                                   # expect exit 0

# 5. ML suite and research helper, then the integrity audit and the operating point
cd ..\ml-service
.\.venv\Scripts\python.exe -m unittest discover -s tests -v           # expect 33/33
.\.venv\Scripts\python.exe -m unittest discover -s experiments\sbms_dataset -p test_experiment.py   # expect 7/7
.\.venv\Scripts\python.exe .\check_training_integrity.py
.\.venv\Scripts\python.exe .\evaluate_operating_point.py

# 6. Browser checks (each needs the API, the frontend dev server and a seeded account)
cd ..
node scripts/browser-smoke.mjs                                        # 23 checks
node scripts/qr-smoke.mjs                                             # 9 checks
node scripts/registration-fields-smoke.mjs                            # 11 checks (live deployment)
# node scripts/admin-reveal-smoke.mjs                                  # not re-run: admin password drifted
```

Together steps 5 and 6 reproduce the recorded 40 Python tests and 43 browser checks. The fourth browser harness is listed but commented out deliberately: it cannot pass until the administrator password is reset, and a script that silently skips would misrepresent the evidence.

The Jest guard `backend/tests/testDatabaseGuard.js` refuses to run unless the target database is the disposable loopback `sbms_test`, so step 2 cannot damage the development or deployment database.

## 28. Document map

| File | What it is for | Read it when |
| --- | --- | --- |
| This report | The consolidated evidence base and drafting aid | Starting any of Chapters Four to Six |
| `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` | The numbered requirement register with status | Writing requirement tables or conclusion claims |
| `SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md` | Modules, flows, decisions, weaknesses | Writing the architecture and implementation sections |
| `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` | Every table and column, plus state machines | Writing the database section or an ER diagram |
| `SBMS_API_ENDPOINT_CATALOGUE.md` | All 45 endpoints with guards and contracts | Writing the interface or API appendix |
| `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` | Features, artifact, metrics, limits, decisions | Writing the ML and evaluation sections |
| `SBMS_TEST_EVIDENCE_CATALOGUE.md` | Every test artefact, date and what it proves | Writing the testing section |
| `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md` | Controls, matrix, residual risks | Writing the security section |
| `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` | Resources, pipeline, config, runbook, costs | Writing the deployment section |
| `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md` | Screens, workflows, figure mapping | Writing the interface design section or capturing screenshots |
| `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` | Evidence tiers, forbidden claims, open decisions | Before writing any claim |
| `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` | The drafted chapter | Drafting or checking Chapter Four |
| `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` | The drafted chapter | Drafting or checking Chapter Five |
| `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` | The drafted chapter | Drafting or checking Chapter Six |
| `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` | Objective to requirement to test to conclusion | Defending a conclusion |
| `DOCUMENTATION_GAP_REGISTER.md` | Every open gap with priority | Before submission |
| `EVIDENCE_AND_VERIFICATION_REPORT.md` | Code, test and document evidence index | Auditing a specific claim |
| `FIGURE_PLACEHOLDER_CHECKLIST.md` | What each figure must show | Producing the figures |

**Entry set added later, same folder.** Nine files now form the front door to this evidence base, and each is
summarised in `CLAUDE_HANDOFF_GUIDE.md` §2: `ACADEMIC_GUIDE_REQUIREMENTS.md`,
`CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN_EVIDENCE.md`, `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION_EVIDENCE.md`,
`CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORK_EVIDENCE.md`,
`CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md`, `DIAGRAM_SPECIFICATIONS.md`, `MASTER_EVIDENCE_REGISTER.md`
(51 evidence IDs), `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` and `CLAUDE_HANDOFF_GUIDE.md`. Read those first; the
table above is the deeper tier they point into.

## 29. Final statement

The evidence supports a clear, bounded conclusion: SBMS is a working, tested, deployed three-tier system whose duplicate-detection signal is deliberately subordinate to human decision, whose payment path is gated by verification and duplicate state in the database as well as the API, and whose machine-learning component is evaluated only against synthetic data. The engineering is real and inspectable. The evaluation is partial, and this documentation set states exactly where it stops: no user acceptance, no load test, no physical QR scan, no real-world accuracy figure, no production assurance. A report that keeps those boundaries visible is stronger than one that quietly crosses them.









