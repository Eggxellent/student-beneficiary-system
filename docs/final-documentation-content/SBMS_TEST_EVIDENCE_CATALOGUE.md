# SBMS TEST EVIDENCE CATALOGUE

**Prepared:** 2026-11-02
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Run records used:** `docs/FINAL_TEST_REPORT.md` (2026-10-31 run and the 2026-11-01 certificate run), `docs/business-workflow-verification-2026-10-30.md`, `docs/frontend-verification-2026-10-30.md`, `docs/qr-verification-2026-10-30.md`, `docs/bursary-certificates-2026-11-01.md`, `docs/database-recovery-rehearsal-2026-10-31.md`.

**What this file is.** A catalogue of every test artefact in the repository, what each proves, when it was last executed and by which command. It is not a re-run: the suites listed here were executed on the dates shown, and this catalogue was compiled by reading the suites and the recorded output. Where a suite has never been executed in this environment, the row says so.

---

## 1. Test levels and tooling

| Level | Tool | Location | Count at this revision |
| --- | --- | --- | --- |
| Backend unit and integration (HTTP surface, real PostgreSQL) | Jest (`jest --runInBand`) | `backend/tests/` (24 suites) | 151 tests |
| Backend in-process unit | `node --test` | `backend/test/*.node.*`, `.cjs` (7 files) | 43 tests |
| Backend out-of-process smoke | `node --test` against a live API | `backend/test/api.smoke.test.js` | 3 tests |
| ML service | Python `unittest` | `ml-service/tests/` (5 files) | 33 tests |
| ML research helper | Python `unittest` | `ml-service/experiments/sbms_dataset/test_experiment.py` | 7 tests |
| Browser (headless Chrome over DevTools Protocol) | Node script, no new dependency | `scripts/browser-smoke.mjs` | 23 checks |
| Browser, QR page | as above | `scripts/qr-smoke.mjs` | 9 checks |
| Browser, registration fields on the live deployment | as above | `scripts/registration-fields-smoke.mjs` | 11 checks |
| Browser, administrator identifier reveal | as above | `scripts/admin-reveal-smoke.mjs` | Not re-run; blocked by a drifted admin password |
| Frontend build gate | Vite production build | `frontend/` | exit 0, 2 006 modules, 10.11 s |
| Database recovery | `pg_dump` / `pg_restore` rehearsal | `docs/database-recovery-rehearsal-2026-10-31.md` | Performed once, 2026-10-31 |
| Load, UAT, phone camera, hosted Azure exercises | — | — | **Not run** |

`pytest` is not installed in the ML virtual environment, which is why `unittest` is the runner. That is a recorded substitution, not an oversight.

## 2. Backend Jest inventory (24 suites, 151 tests)

| Suite | Tests | What it proves |
| --- | --- | --- |
| `auth.test.js` | 4 | Sign-in, wrong-endpoint refusal (403), disabled public registration (410), token payload |
| `roleAuthorization.test.js` | 6 | Admin/officer boundaries across representative routes; dashboard authorisation; settings denial |
| `loginRateLimit.test.js` | 1 | The 11th sign-in attempt in the window is refused with 429 |
| `securityMiddleware.test.js` | 9 | CORS allowlist behaviour, body-size limit, generic 5xx, header handling |
| `students.test.js` | 9 | Registration validation, school constraint, 503 on screening failure, listing, single read |
| `duplicateCheck.test.js` | 15 | Predictor invocation, batching, failure handling, response mapping |
| `duplicateAggregation.test.js` | 13 | `top-1` selection, exact-identifier ranking, suppression counts, policy normalisation |
| `duplicateFlags.test.js` | 9 | Queue listing, masking, audited reveal, decision recording, terminal-state refusal |
| `mlDuplicateReview.test.js` | 8 | Priority banding, exact identifier detection, shared policy between registration and queue |
| `predictorDateNormalization.test.js` | 6 | Day-first date parsing, one-day and seven-day tolerances, ambiguous-format refusal |
| `mlPredictor.integration.test.js` | 1 | The real Python predictor returns a score through the Node service |
| `kenyanSyntheticDataset.test.js` | 4 | Seeded synthetic records behave as the generator intends |
| `performance.test.js` | 1 | 50-pair screening under the 3 000 ms budget (measured 22.67 ms) |
| `workflow.test.js` | 11 | End-to-end business chain: screening, award gate, duplicate gate, clearance, acknowledgement, audit sequence, role boundaries |
| `bursaryAwards.controller.test.js` | 5 | Award submission, verification evidence requirement, approval/rejection rules |
| `disbursements.test.js` | 4 | Payment creation rules, amount ceiling, award state gate |
| `disbursementReconciliation.controller.test.js` | 4 | Clearance evidence, status transitions, exception listing |
| `bursaryRules.test.js` | 4 | Cents comparison, receipt status derivation, overdue arithmetic, exception reasons |
| `bursaryCertificates.test.js` | 12 | Issue preconditions, QR payload, public answer shape, `not_current`, revocation rules, audit rows |
| `certificateVerificationRoute.test.js` | 5 | Public certificate contract, malformed and unknown tokens, its own rate limit, no student data |
| `verification.test.js` | 10 | Student QR token format, QR payload, token never returned, `{found}` contract, limiter, forged forwarded header |
| `verificationRoute.test.js` | 4 | Public student verification route contract and rate limit |
| `schemaReadiness.test.js` | 5 | `/api/ready` fails closed on a missing table, wrong database identity and missing `bursary_certificates` |
| `health.test.js` | 1 | `/api/health` liveness |

The suite totals are those recorded on **2026-11-01** (`docs/FINAL_TEST_REPORT.md` §10). The 2026-10-31 run recorded 21 suites / 128 tests from the same tree before the certificate feature was added. Both figures are correct for their date; a count must never be cited without its date (G-25).

## 3. Backend native tests (43 in-process, 3 out-of-process)

| File | Environment | What it proves |
| --- | --- | --- |
| `databaseBootstrap.node.test.js` | in-process | Database bootstrap path |
| `databaseStartup.node.test.js` | in-process | Start-up identity checks |
| `databaseReadiness.node.js` | in-process | Readiness contract and fail-closed behaviour |
| `errorHandler.unit.test.js` | in-process | No internal detail leaks in a 5xx |
| `jwtSecret.validation.node.cjs` | in-process | Secret length and placeholder rejection |
| `migrate.unit.test.js` | in-process | Migration ordering and ledger |
| `verification.unit.test.js` | in-process | 5 QR verification unit tests |
| `api.smoke.test.js` | **out-of-process** against a live API on `http://localhost:5000` | Health, readiness and an authenticated route answer correctly over HTTP |

The 2026-10-31 run recorded **43/43** in-process (0.79 s, exit 0) and **3/3** out-of-process. The native layer exists because several behaviours (secret validation, readiness, migration ordering) must be provable without Jest and without a database fixture.

## 4. Browser evidence

| Harness | Checks | Result | Date | What it covers |
| --- | --- | --- | --- | --- |
| `scripts/browser-smoke.mjs` | 23 | **23/23 pass** | 2026-10-30 | Officer sign-in and registration, screening message, exact identifier sentence, colour change for a suspicious case, aggregation collapsing several candidates to one case, error handling on a blocked request, admin sign-in, queue contents, both cut-offs, model version, "score is not a decision" statement, audit counters, admin redirect |
| `scripts/qr-smoke.mjs` | 9 | **9/9 pass** | 2026-10-30; **not re-run** 2026-10-31 or 2026-11-01 | Scanning opens the page and reports the record, token removed from the URL, no student data, unknown token refused, no-token refused, query-parameter token refused, second scan re-verifies, no page errors |
| `scripts/registration-fields-smoke.mjs` | 11 | **11/11 pass** against the live Azure deployment | 2026-11-01 | Both new identifier inputs present and optional, original six fields still posted, payload carries both markers, blank identifier omitted, blocked request shows an error panel |
| `scripts/admin-reveal-smoke.mjs` | — | **Not re-run** | — | Blocked because the stored administrator password no longer authenticates |

All three executed harnesses drive real Chrome through the DevTools Protocol, sign in through the real forms, fill React-controlled inputs and read the rendered DOM. None of them is a screenshot comparison, and none asserts visual appearance.

## 5. Python evidence

| Suite | Tests | Result | What it proves |
| --- | --- | --- | --- |
| `ml-service/tests/` (5 files) | 33 | **33/33 pass** (1.96 s) | Feature engineering, artifact loading, operating-point report consistency, reliability analysis, training-integrity assertions |
| `experiments/sbms_dataset/test_experiment.py` | 7 | **7/7 pass** (0.47 s) | The research experiment's integrity checks (group overlap, label relation, archive hash) |

`tests/test_training_integrity.py` is the most consequential of these: it fails the build if a future change retrains on the holdout, regenerates overlapping groups, replaces the artifact without updating its recorded hash, lets the in-sample/holdout gap exceed 0.10, drifts holdout from grouped CV by more than 0.03, introduces a feature with ROC-AUC >= 0.95, or adds training or serialisation calls to the serving path.

## 6. Database, security and recovery evidence

| Check | Result | Date | Source |
| --- | --- | --- | --- |
| Schema constraints exercised through the real API | Pass (11 workflow tests plus 12 certificate tests) | 2026-10-30, 2026-11-01 | `backend/tests/workflow.test.js`, `bursaryCertificates.test.js` |
| Readiness fails closed on a missing table or wrong identity | Pass (5 tests) | 2026-11-01 | `schemaReadiness.test.js` |
| Dump and restore into an independent database | Pass: identity, table count, row digests compared | 2026-10-31 | `docs/database-recovery-rehearsal-2026-10-31.md` |
| Scheduled backup job and retention policy | **Absent** | — | NFR-18, G-19 |
| Rate limiters | Pass in-process only | 2026-10-30, 2026-11-01 | `verification.test.js`, `loginRateLimit.test.js`, `certificateVerificationRoute.test.js` |
| Concurrency | **No test** | — | NFR-13 |

## 7. What has not been run, and what that costs

| Not run | Why | Consequence for the report |
| --- | --- | --- |
| Phone-camera scan of a printed student QR code | Requires a public HTTPS origin; the deployment has one, but no phone session was recorded | The identification mechanism rests on a headless-browser check (G-11) |
| Phone-camera scan of a printed certificate | As above | Certificate authenticity is proven at the API, not on paper |
| Browser check of `/verify-certificate` | No harness exists for it | The certificate page is covered by API tests only |
| User acceptance study | Not conducted | NFR-14 unverified; no usability claim may be made (G-06) |
| Load or scale test | Not conducted | No claim about behaviour beyond 50 candidates (NFR-01) |
| Docker image build and run in this environment | Docker engine not running | Image size and gates are recorded from the CI build instead |
| Full Azure behaviour of the latest commit | Deployment was exercised on 2026-10-31 and 2026-11-01, not on this revision | Hosted behaviour is reported per date, not as current |
| Firefox, Safari, mobile browsers | Not exercised | NFR-19 partial |
| `pytest` | Not installed | `unittest` used; no behavioural difference claimed |

## 8. Run history, including one instability that must be reported

| Date | Command | Result | Note |
| --- | --- | --- | --- |
| 2026-10-30 | `npx jest --runInBand tests` | 107/107 pass | Before the workflow and payment suites |
| 2026-10-30 | Same, after the workflow suite was added | 21 suites / 128 tests pass | Recorded in `docs/business-workflow-verification-2026-10-30.md` |
| 2026-10-31 | `npm test` (Jest, whole tree) | 21 suites / 128 tests pass, 93.6 s | `docs/FINAL_TEST_REPORT.md` §1 |
| 2026-10-31 | Regression re-run after documentation edits | 21 suites / 128 tests pass, 73.5 s | Same tree, shorter run |
| 2026-11-01 | `npx jest --runInBand tests` | **24 suites / 151 tests pass** | Certificate feature added; supersedes the totals above |
| 2026-11-01 | `npm.cmd --prefix frontend run build` | exit 0, 2 006 modules, 10.11 s | Production build gate |

One instability is recorded honestly rather than hidden: during the 2026-10-31 sweeps the same suite was observed to stop at **149 or 150 of 151** when free memory fell to roughly 0.5 GB of 7.4 GB. The mechanism is inferred (memory pressure during a `--runInBand` run against a local database), not measured, and the affected runs were superseded by clean passes. It is carried as G-02 and must be mentioned if the report discusses test stability.

## 9. Coverage exclusions that matter for the evaluation chapter

| Area | What exists | What is missing |
| --- | --- | --- |
| Requirement coverage | 151 assertions mapped to requirement groups in `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §4 | Branch-level coverage of FR-12, FR-19, FR-25, FR-26, FR-28, FR-29 |
| Frontend | Build gate plus 43 browser checks across three harnesses | No unit tests for React components; no accessibility or visual regression |
| Duplicate model | Synthetic holdout plus integrity gates | No adjudicated data, no real-world metric |
| Payments | Full state-machine tests at API level | No browser test of the reconciliation screen; no bank integration to test |
| Certificates | 17 API-level tests across two suites | No browser test of `/verify-certificate`; no printed-copy scan |
| Operations | Readiness and a restore rehearsal | No scheduled backup, no monitoring, no alerting |

## 10. Reproduction commands

```powershell
# Backend Jest suite (needs backend/.env.test with NODE_ENV, DATABASE_URL,
# SBMS_TEST_DATABASE_URL, PUBLIC_APP_URL; values are never printed)
cd backend
npm test

# Native in-process and out-of-process tests
node --test test/*.node.test.js test/*.node.js test/*.unit.test.js
node --test test/api.smoke.test.js            # with API_URL=http://localhost:5000

# Frontend production build
npm.cmd --prefix frontend run build

# ML service and research helper
ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests -v
ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/experiments/sbms_dataset -p test_experiment.py

# Browser harnesses (each needs the API, the frontend dev server and a seeded account)
node scripts/browser-smoke.mjs
node scripts/qr-smoke.mjs
node scripts/registration-fields-smoke.mjs
```

The Jest guard `backend/tests/testDatabaseGuard.js` fails closed unless `NODE_ENV=test` and both `DATABASE_URL` and `SBMS_TEST_DATABASE_URL` are the same loopback `sbms_test` URL. A run that cannot prove it is pointed at the disposable database does not start, which is why no test in this catalogue can damage the development or deployment database.

## 11. How to read a test count in the report

1. Always cite the date with the count (`24 suites / 151 tests, 2026-11-01`), because two generations exist in the same file.
2. Never add counts across levels to produce a single "tests passed" figure. Jest, native, browser and Python tests answer different questions.
3. A passing test suite says nothing about the features it does not touch. §7 and §9 are the list of those features, and they are the ones the evaluation chapter must treat as unverified.
4. A green build is not evidence of behaviour; it is evidence that the code compiles and type-checks under the bundler.


