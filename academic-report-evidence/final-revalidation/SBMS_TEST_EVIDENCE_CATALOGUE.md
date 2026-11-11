# SBMS TEST EVIDENCE CATALOGUE

> All commands executed 2026-11-03 from `student-beneficiary-system` at HEAD `cca0625`, unless a row says otherwise.
> Nothing here is copied from an earlier report; every result below was produced in this pass.

## 1. Executed in this pass

| # | Command | Working dir | Result | Duration |
| --- | --- | --- | --- | --- |
| T-01 | `npm test` (`jest --runInBand tests`) | `backend/` | **24 suites / 151 tests; 151 distinct tests pass.** Best monolithic attempt: 150 passed, 1 failed (`mlPredictor.integration.test.js` — `Python predictor process exited`, free RAM 0.55 GB). Grouped runs: **80/80** and **70/71**, the single failure being `performance.test.js` with `Production XGBoost model artifact could not be loaded`; that test passes alone (V-5). Full ledger in §1.1 | 111.5 s (monolithic) |
| T-02 | `.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` | `ml-service/` | **Ran 33 tests — OK** | 2.4 s |
| T-03 | `npm run build` (`vite build`) | `frontend/` | **exit 0, 2 006 modules, 13.02 s**, `dist/assets/index-DMsnyNls.js` 707 195 B (gzip 171.40 kB), `index-CtMrTnBu.css` 42 034 B, `dist/index.html` 423 B (hash is *not* deployment evidence — see §2 note) | 13.0 s |
| T-04 | `POST /api/verify` against the live API | host → `ca-sbms-api` | **200** `{"found":false,…}` | 3.4 s (cold) |
| T-05 | `POST /api/certificates/verify` against the live API | host → `ca-sbms-api` | **404** (route absent → deployment behind HEAD) | — |
| T-06 | `GET /api/health`, `GET /api/ready` | host → `ca-sbms-api` | **200 / 200** (`{"status":"ready"}`) | — |
| T-07 | `GET /api/students` without a token | host → `ca-sbms-api` | **401** | — |
| T-08 | CORS preflight (`OPTIONS /api/health`) | host → `ca-sbms-api` | foreign `Origin` → **403**; `Origin: https://sbms-web.azurewebsites.net` → **204** with `Access-Control-Allow-Origin` echoing that origin | — |

## 1.1 Run ledger (pass 2, 2026-11-03 09:45–10:10 +03:00)

Host: 7.4 GB total RAM, **0.55–0.79 GB free** while the runs were made. Backend environment exported from
`backend/.env.test` before every run; `--runInBand` throughout, so every run used the same single Node process model.

| Run | Scope | Suites | Tests | Result | Time |
| --- | --- | --- | --- | --- | --- |
| V-1 | all 24 files, one invocation | 24 | 151 | 150 passed, **1 failed**: `mlPredictor.integration.test.js` → `Error: Python duplicate predictor failed / Python predictor process exited` | 111.5 s |
| V-2 | same command, repeated | 24 | 151 | identical single failure, same test, same message (reproducible under memory pressure, not flaky at random) | ≈120 s |
| V-3 | group A — 12 files (`auth`, `bursary*`, `certificateVerificationRoute`, `disbursement*`, `duplicateAggregation`, `duplicateCheck`, `duplicateFlags`, `health`, `kenyanSyntheticDataset`) | 12 | 80 | **80/80 pass**, exit 0 — `mlPredictor.integration.test.js` is in group B and was **not** involved | 56.7 s |
| V-4 | group B — 12 files (`loginRateLimit`, `mlDuplicateReview`, `mlPredictor.integration`, `performance`, `predictorDateNormalization`, `roleAuthorization`, `schemaReadiness`, `securityMiddleware`, `students`, `verification`, `verificationRoute`, `workflow`) | 12 | 71 | 70 passed, **1 failed**: `performance.test.js` → `Production XGBoost model artifact could not be loaded`; **`mlPredictor.integration.test.js` PASSED (6.956 s)** | 67.7 s |
| V-5 | `performance.test.js` alone | 1 | 1 | **pass**, exit 0 | 8.9 s |
| V-6 | `mlPredictor.integration.test.js` alone | 1 | 1 | **pass**, exit 0 | 7.6 s |
| V-7 | ML suite (5 files) | — | 33 | **Ran 33 tests — OK** | 2.4 s |
| V-8 | frontend production build | — | — | exit 0 | 13.0 s |
| V-9 | live probes T-04 … T-08 | — | — | 200 / 200 / 200 / 401 / 404 / 403 / 204 | — |

Interpretation, stated conservatively:

1. **151 distinct tests exist and every one of them passes.** V-3 (80) + V-4 (71) = 151 with no overlap, and the two
   tests that failed inside a group pass alone (V-5, V-6).
2. The failures are **not assertion failures**. In V-1/V-2 the predictor child process exited; in V-4 it started but
   could not load the 421 kB joblib artefact. Both messages come from the same place — the Python sidecar started while
   the Windows host had under 1 GB of free physical memory — and the same test passes minutes later at 0.79 GB free
   (V-5). Reporting "0 failures" for the monolithic run would therefore be untrue, and reporting "the suite fails" would
   be equally untrue. Chapter 5 must quote the ledger, not a single line.
3. The number to use for the count of tests is **151 at `cca0625`** (24 suites). The earlier 149/150 figures in
   `docs/FINAL_TEST_REPORT.md` are superseded and dated (G-25).
4. Nothing in the ledger was produced by mocking the predictor: `duplicateCheck` tests use the real `predict.py`
   bridge, which is why a host-memory problem surfaces as a test result at all.

Interpretation: the registration, eligibility, duplicate-review, award, disbursement and certificate **code paths are
exercised by automated tests at HEAD**, and the deployed service answers liveness, readiness and public
verification. The deployment does **not** contain the certificate feature (T-05).

Probe note (re-verified 2026-11-03): run the live probes from a file or without a body. Under PowerShell 5.1 an inline
`-d '{"token":"x"}'` is passed to `curl.exe` with its quotes stripped, the app-wide body parser then rejects the
malformed JSON and the API answers `400 {"message":"Invalid request"}` *before* route matching. With a valid JSON body
`POST /api/verify` → `200 {"found":false}` and `POST /api/certificates/verify` → `404 Cannot POST
/api/certificates/verify`, which is the deployment-lag evidence; the `400` is an artefact of the shell, not a finding.

## 2. Backend jest suites (24 files, 151 tests)

| Suite | Covers | Requirement anchors |
| --- | --- | --- |
| `auth.test.js` | sign-in, wrong-endpoint 403, token payload, `/me` | FR-01, FR-02, NFR-03 |
| `roleAuthorization.test.js` | role matrix on protected routes | FR-04, NFR-04 |
| `securityMiddleware.test.js` | body limits, CORS allowlist, error shaping | NFR-09, NFR-10, NFR-11 |
| `loginRateLimit.test.js` | 10 attempts / 15 min per IP | NFR-08 |
| `schemaReadiness.test.js` | readiness fails closed on a missing table | FR-30, NFR-12 |
| `health.test.js` | liveness/readiness contract | FR-30 |
| `students.test.js` | registration, QR token, validation, listing | FR-05, FR-06, FR-07, FR-20 |
| `duplicateCheck.test.js` | predictor bridge, batching, version drift, failure codes | FR-07, FR-09, NFR-20 |
| `duplicateAggregation.test.js` | `top-1` policy, corroboration, suppression counts | FR-08, FR-09, FR-34 |
| `duplicateFlags.test.js` | queue, masking, reveal, decisions with reason | FR-10, FR-11, NFR-05 |
| `mlDuplicateReview.test.js` | score batching, date normalisation, threshold labels | FR-07, FR-09, NFR-01 |
| `mlPredictor.integration.test.js` | real `predict.py --server` stdin/stdout round-trip | FR-07, NFR-20 |
| `predictorDateNormalization.test.js` | `DATE` serialisation regression (`YYYY-MM-DD`) | FR-09 |
| `performance.test.js` | 50-pair scoring under 3 000 ms | NFR-01 (limited — see §5) |
| `bursaryRules.test.js` | five-factor weights and category bands | FR-12 |
| `bursaryAwards.controller.test.js` | verification gate, approval/rejection, duplicate block | FR-13, FR-14, FR-15 |
| `workflow.test.js` | registration → award → disbursement → reconciliation | FR-13 … FR-18 |
| `disbursements.test.js` | issue payment, guards, state transitions | FR-16, FR-17 |
| `disbursementReconciliation.controller.test.js` | clearance, shortfall → `discrepancy`, exceptions | FR-18, FR-19 |
| `bursaryCertificates.test.js` | issue/public view/reference lookup, `not_current`, single-certificate rule, no revocation route | FR-22, FR-23, FR-24 |
| `certificateVerificationRoute.test.js` | public certificate route + disclosure limits | FR-23, NFR-06 |
| `verification.test.js` | public student QR verification, disclosure limits | FR-21, NFR-06 |
| `verificationRoute.test.js` | public route rate limiting | NFR-07 |
| `kenyanSyntheticDataset.test.js` | synthetic seed-data integrity | demo-data provenance |

Limitations to state alongside this table: the suites run against a **test database guarded by
`tests/testDatabaseGuard.js`** (the guard refuses to run against a non-test database), they are
**integration-style** (they hit real Postgres), and they were executed with `--runInBand`, so no parallelism claim
can be made.

Reproduction requirements (the guard is silent about them, so they are recorded here):

- `NODE_ENV=test`, and `DATABASE_URL` **equal to** `SBMS_TEST_DATABASE_URL`, both pointing at the local
  `sbms_test` database as the `sbms_test_runner` role. All four values already exist in `backend/.env.test`
  (git-ignored); `npm test` does **not** load that file, so they must be set in the shell first. In PowerShell:
  `Get-Content .env.test | ? { $_ -match '^[A-Z_]+=' } | % { $kv = $_ -split '=',2; Set-Item "Env:$($kv[0])" $kv[1] }`
- A local PostgreSQL service (`postgresql-x64-17`) must be running; the database is created once with
  `npm run db:provision-test`.
- Without the variables above every suite fails in `setupFiles` with 0 tests run — that is a configuration error, not
  a test failure, and must not be reported as one.

Environment limit observed on re-attempt (same day, HEAD `cca0625`): the single monolithic `npm test` run aborted with
`Fatal process out of memory: Zone` while the host had **725 MB free of 7 531 MB** (VS Code held ~2 GB). This is the
same limitation recorded as G-02. The 24/151 figure was therefore **re-derived in four grouped runs** of the same
command and same guarded database, all exit 0:

| Group | Suites | Tests | Time |
| --- | --- | --- | --- |
| `auth`, `bursaryAwards.controller`, `bursaryCertificates`, `bursaryRules`, `certificateVerificationRoute` | 5 | 30 | 42.6 s |
| `disbursementReconciliation.controller`, `disbursements`, `duplicateAggregation`, `duplicateCheck`, `duplicateFlags`, `health`, `kenyanSyntheticDataset` | 7 | 50 | 18.4 s |
| `loginRateLimit`, `mlDuplicateReview`, `mlPredictor.integration`, `performance`, `predictorDateNormalization`, `roleAuthorization` | 6 | 23 | 18.8 s |
| `schemaReadiness`, `securityMiddleware`, `students`, `verification`, `verificationRoute`, `workflow` | 6 | 48 | 47.1 s |
| **Total** | **24** | **151** | **126.9 s** |

The 33 ML tests (T-02) were re-run unchanged on the same day: `Ran 33 tests in 2.678s — OK` (pass 1) and
`Ran 33 tests in 2.382s — OK` (pass 2).

Pass 2 reproduced the same totals with a different grouping — 12 suites / 80 tests and 12 suites / 70 tests — and made
the mechanism explicit: the only test that failed was the one whose Python sidecar could not start or load its model,
and it passes when run alone (§1.1). Both ledgers therefore agree on **24 suites / 151 tests**, and neither contains an
assertion failure.

Note on the bundle hash (T-03): `frontend/src/services/api.js:3` inlines `import.meta.env.VITE_API_ORIGIN` at build
time, so `index-*.js` changes with the API origin baked in, not only with the source commit. Pass 2 built once at
13.02 s and emitted `index-DMsnyNls.js` (707 195 B, gzip 171.40 kB) with `VITE_API_ORIGIN` unset; the deployed shell
references `index-KTiUJ9pN.js` (640 631 B). Two identical sources therefore produce different bundles in different
environments, and the hash **cannot** be compared against the deployed bundle — deployment lag is evidenced by the image
tag and T-05, never by this hash. What *can* be compared is `dist/index.html`, which is environment-independent:
423 bytes locally, 423 bytes live (§2 of `AZURE_DEPLOYMENT_VERIFICATION.md`).

## 3. ML unit tests (5 files, 33 tests, all passing)

| File | Covers |
| --- | --- |
| `test_feature_engineering.py` | the six features, normalisation, missing-value semantics, column order |
| `test_predict_artifact_loading.py` | joblib load, version string, response schema |
| `test_operating_point.py` | threshold sweep and rate reporting used by the evaluation JSON |
| `test_reliability_analysis.py` | grouped/reliability analysis helpers |
| `test_training_integrity.py` | dataset hashes, leakage guards, metric recomputation |

Interpreter note: these need pandas/xgboost/joblib and must run with **`ml-service/.venv`**, not the workspace
`.venv` (which lacks pandas and produces 5 collection errors). Reproduce with:
`cd ml-service; .\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`. Note: passing `-t tests`
instead of `-p "test_*.py"` fails on Windows with `Start directory is not importable` — that is an invocation error, not
a test result.

## 4. Present but not executed in this pass

| Harness | Files | How to run | Why not executed |
| --- | --- | --- | --- |
| `node --test` files in `backend/test/` | `api.smoke.test.js`, `databaseBootstrap.node.test.js`, `databaseStartup.node.test.js`, `errorHandler.unit.test.js`, `migrate.unit.test.js`, `verification.unit.test.js`, `databaseReadiness.node.js`, `jwtSecret.validation.node.cjs` (8) | `npm run test:smoke` runs only the first | The bootstrap/startup ones create or drop a database; each needs its own environment |
| Frontend automation | **none** | — | `frontend/src` has no `*.test.*`; UI evidence must be screenshots |
| Load/soak testing | none in repo | — | No tooling present — do not claim any |
| Azure point-in-time-restore drill | none | — | Portal access required (`AZURE_DEPLOYMENT_VERIFICATION.md` §6) |

## 5. Evidence strength, stated plainly

| Claim | Supportable? |
| --- | --- |
| "The API test suite passes at HEAD." | **Yes, with the ledger** — 24 suites / 151 tests, all 151 passing; the only failures ever observed were the Python sidecar failing to start or load its model when the host had under 1 GB of free RAM, and each of those tests passes alone (T-01, §1.1). |
| "The ML pipeline is unit-tested." | **Yes** — 33 tests (T-02), with the interpreter caveat. |
| "The frontend is tested." | **No** — zero automated frontend tests. |
| "The system was tested by real users." | **No** — no participants, consent or session notes (NFR-14). |
| "Performance was validated under load." | **No** — one 50-pair test; nothing above 50 pairs. |
| "The deployed build contains every HEAD feature." | **No** — contradicted by T-05 (route 404) and the image tag; the bundle hash cannot be used for this (see §2 note). |
| "Detection accuracy was validated on real data." | **No** — synthetic only. |
| "The database recovery plan was verified." | **Partly** — a local rehearsal is documented (2026-10-31) but was not re-executed here. |

## 6. Gap references

| ID | Relevance to the test evidence |
| --- | --- |
| G-02 | **Mechanism identified in pass 2** — the 149–150/151 sweeps are host-memory limited, not code limited. Failure text is `Python predictor process exited` or `Production XGBoost model artifact could not be loaded` from `duplicateCheck.js`, raised when the Python sidecar starts while free physical memory is below ~1 GB (0.55 GB observed); both affected tests pass alone and in grouped runs (§1.1). Report the ledger, not a single line |
| G-15 | Print output of the certificate PDF and the report export is untested |
| G-16 | Only Chrome was used; no accessibility tool run |
| G-17 | Eligibility arithmetic, dashboard counters and report content remain thinly covered |
| G-20 | **Closed** by T-01/§1.1 — 24 suites, 151 tests, all passing across the run ledger; no test expectation was ever observed to fail |
| G-29 | T-05 (certificate verify → 404) plus the image tag (`a3714f8`, 9 commits behind) are the deployment-lag evidence |
