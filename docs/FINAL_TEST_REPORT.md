# SBMS final test report

**Date:** 2026-10-31
**Checkout:** `fix/sbms-completion-work` at `3a29fab19502aad4cf45c1e44055c54cc4ff7c6e`, working tree clean
**Environment:** Windows 11 (win32), Node v22.11.0, npm 10.9.0, Python 3.11.9,
PostgreSQL 17.11 local (`psql`/`pg_dump`/`pg_restore` 17.11), Docker CLI 29.9.2 with the engine **not** running.

Every row below was produced by the command shown, in this session, on this checkout. Nothing is
carried over from the 2026-10-27 version of this report, which is **superseded** by this file. No
browser, UAT, QR-camera, phone, Azure or production check is claimed as passed: those were not run.

The database target used by the database-backed suites is the local disposable `sbms_test` database
on loopback (`::1:5432`, role `sbms_test_runner`, `current_database() = sbms_test`). The Jest guard
(`backend/tests/testDatabaseGuard.js`) fails closed unless `NODE_ENV=test` and both `DATABASE_URL`
and `SBMS_TEST_DATABASE_URL` are the same loopback `sbms_test` URL for that role; the connection
values were read from `backend/.env.test` and are not reproduced here.

## 1. Summary of this run

| Check | Result | Command |
|---|---|---|
| Backend Jest suite (whole) | **PASS — 21 suites / 128 tests**, 93.6 s, exit 0 | `npm test` (backend, after loading `backend/.env.test`) |
| Backend native `node --test`, in-process | **PASS — 43/43**, exit 0, 0.79 s | 7 files, see §2.2 |
| Backend native API smoke (out-of-process) | **PASS — 3/3** against a live API, exit 0 | `node --test backend/test/api.smoke.test.js` with `API_URL=http://localhost:5000` |
| Frontend production build | **PASS — exit 0**, 2,002 modules, 12.98 s | `npm.cmd --prefix frontend run build` |
| ML service suite (production code) | **PASS — 33/33**, exit 0, 1.96 s | `ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests -v` |
| ML research-helper suite | **PASS — 7/7**, exit 0, 0.47 s | `... -m unittest discover -s ml-service/experiments/sbms_dataset -p test_experiment.py` |
| Database readiness (`sbms_test`) | **PASS — `{"ready":true}`** | app startup + `/api/ready` |
| QR verification unit tests | **PASS — 5/5** (native) | `node --test backend/test/verification.unit.test.js` |
| QR phone-camera smoke (real device) | **NOT RUN** | needs a public HTTPS origin (Phase 6) |
| Headless-Chrome QR smoke (`scripts/qr-smoke.mjs`) | **NOT RUN this session** | last recorded 9/9 on 2026-10-30, handover §18.3 |
| Browser E2E (`npm run smoke:browser`) | **NOT RUN — blocked** | needs `SBMS_VERIFY_PASSWORD`, a Chrome DevTools session and a frontend dev server |
| `pytest` command | **NOT RUN — not installed** | `pytest` and `pyyaml` are absent from the venv; `unittest` used instead |
| Docker image build/run | **NOT RUN** | CLI present, `docker info` fails: engine unavailable |
| Azure deployment exercises | **NOT RUN** | nothing provisioned (Phase 6 is research only) |
| UAT with real users | **NOT RUN** | — |

No test is reported as passed unless the command in that row was executed and returned success in
this session.

## 2. Backend tests

### 2.1 Jest suite — 21 suites, 128 tests, all passed

```
cd backend
# load backend/.env.test into the process (NODE_ENV, DATABASE_URL,
# SBMS_TEST_DATABASE_URL, SBMS_MIGRATION_DATABASE_URL); values not printed
npm test          # -> jest --runInBand tests
```

```
Test Suites: 21 passed, 21 total
Tests:       128 passed, 128 total
Snapshots:   0 total
Time:        93.585 s
```

A regression re-run of the same command after the documentation changes in this commit reported the
same 21 suites / 128 tests with `73.536 s` (wall-clock varies with machine load, the counts do not).

| # | Suite | # | Suite | # | Suite |
|---|---|---|---|---|---|
| 1 | `auth` | 8 | `duplicateFlags` | 15 | `predictorDateNormalization` |
| 2 | `bursaryAwards.controller` | 9 | `health` | 16 | `roleAuthorization` |
| 3 | `bursaryRules` | 10 | `kenyanSyntheticDataset` | 17 | `schemaReadiness` |
| 4 | `disbursementReconciliation.controller` | 11 | `loginRateLimit` | 18 | `securityMiddleware` |
| 5 | `disbursements` | 12 | `mlDuplicateReview` | 19 | `students` |
| 6 | `duplicateAggregation` | 13 | `mlPredictor.integration` | 20 | `verification` |
| 7 | `duplicateCheck` | 14 | `performance` | 21 | `workflow` |

**Warnings observed (not failures).** The run prints `console.error` lines through the sanitised
error handler (`Admin login failed`, `Request failed`) with Express frames at
`src/middleware/errorHandler.js:65`. Those come from tests that deliberately provoke failures to
prove a generic 500 is returned and nothing sensitive is logged. No test failed and no unhandled
rejection was reported.

### 2.2 Native `node --test` — 43/43 in-process

```
node --test backend/test/databaseReadiness.node.js backend/test/databaseStartup.node.test.js `
  backend/test/databaseBootstrap.node.test.js backend/test/errorHandler.unit.test.js `
  backend/test/verification.unit.test.js backend/test/migrate.unit.test.js `
  backend/test/jwtSecret.validation.node.cjs
```

```
# tests 43   # pass 43   # fail 0   # duration_ms 793.662   exit 0
```

Coverage: readiness contract (missing/shadowed table, wrong database, unset expected name, malformed
catalog rows, error propagation), startup validation, fail-closed empty-schema bootstrap (approval
gate, wrong database, pre-existing relation, atomic rollback, bcrypt admin hash, email collision),
error-handler sanitisation, JWT-secret validation (missing/empty/short/placeholder/random), migration
target + inventory + ledger adoption, and verification/QR behaviour.

### 2.3 Out-of-process API smoke — 3/3, but only with a live server

`backend/test/api.smoke.test.js` is **not** a self-contained unit test: it `fetch`es
`process.env.API_URL` (default `http://localhost:5000`) and signs in as a seeded admin. Run inside
the in-process group it fails on its prerequisites, not because of a code defect:

```
not ok 1 - health endpoint is available                       error: 'fetch failed'
not ok 2 - admin can authenticate, read admin resources, ...   error: 'fetch failed'
not ok 3 - report export validates its date range             error: 'fetch failed'
```

Re-run against a real API on `sbms_test` (`PORT=5000`, `SBMS_EXPECTED_DATABASE_NAME=sbms_test`,
`PUBLIC_APP_URL` set, random 64-hex `JWT_SECRET`):

```
Server running on port 5000
GET /api/ready -> {"status":"ready"}
ok 1 - health endpoint is available
ok 2 - admin can authenticate, read admin resources, and is blocked from field workflows
ok 3 - report export validates its date range
# tests 3   # pass 3   # fail 0        exit 0
```

That is the intended mode (`npm run test:smoke`) and it passed. The server process was stopped
afterwards.

## 3. Frontend build and tests

```
npm.cmd --prefix frontend run build     # -> vite build
```

```
2002 modules transformed.
dist/index.html                   0.42 kB | gzip:   0.29 kB
dist/assets/index-BV7kk6vQ.css   39.81 kB | gzip:   8.69 kB
dist/assets/index-DVJZF6nD.js   636.12 kB | gzip: 162.73 kB
built in 12.98s                         exit 0
```

`frontend/dist` then contains `index.html`, `assets/index-BV7kk6vQ.css`,
`assets/index-DVJZF6nD.js` and `images/sbms-landscape.jpg` (copied verbatim from
`frontend/public/`).

**Warning (honest):** Vite warns that one chunk exceeds 500 kB after minification (636.12 kB JS,
162.73 kB gzipped) and suggests code-splitting. The build still succeeds; bundle size is a
performance concern, not a correctness one.

**There is no frontend unit-test runner installed.** `frontend/devDependencies` contains only
`@tailwindcss/vite`, `@vitejs/plugin-react`, `autoprefixer`, `postcss`, `tailwindcss`, `vite`, and
the only frontend scripts are `dev`, `build`, `preview`. Frontend behaviour is therefore covered by
the build plus the browser-E2E harness, which was **not** run (see section 7).

## 4. ML tests

| Suite | Tests | Result | Command |
|---|---|---|---|
| Production ML code (`ml-service/tests`) | 33 | **PASS**, 1.958 s, exit 0 | `ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests -v` |
| Research helpers (`ml-service/experiments/sbms_dataset`) | 7 | **PASS**, 0.473 s, exit 0 | `... -m unittest discover -s ml-service/experiments/sbms_dataset -p test_experiment.py` |

The 33 tests cover feature engineering (shared training/serving features, missing-value handling),
operating-point/threshold metrics, registration simulation, artefact loading (`predict` uses only the
production artefact; missing/corrupt artefacts fail closed), training-integrity reports (group
holdout excludes pair families, the model does not merely memorise training rows, no single feature
determines the label) and reliability analysis.

`python -m pytest` was **not** run because `pytest` is not installed in that venv
(`importlib.util.find_spec('pytest') -> None`) and `pyyaml` is absent too. No package was installed
to change the environment; the `unittest` suites above provide the coverage.

**Unchanged and still unvalidated:** the live 0.50 cutoff. The model is trained on synthetic labels
only and there is still no adjudicated ground truth, so these tests prove the pipeline is wired and
reproducible, not that its accuracy is adequate.

## 5. Database integration tests

The Jest suites run against a real PostgreSQL 17.11 database, not mocks, and are gated by
`backend/tests/testDatabaseGuard.js`, which refuses to start unless `NODE_ENV=test` and both
`DATABASE_URL` and `SBMS_TEST_DATABASE_URL` are the same loopback `sbms_test` URL with role
`sbms_test_runner`. The guard is what makes it impossible for this run to have touched a production
database.

State of `sbms_test` recorded during this session:

| Property | Value |
|---|---|
| `current_database()` / server address | `sbms_test` / `::1:5432` (loopback) |
| PostgreSQL version | 17.11 |
| Base tables in `public` | 12 |
| Columns in `public` | 118 |
| Constraints | 56 |
| Indexes | 21 |
| Sequences | 1 |
| Extensions | 2 (`pgcrypto`, `plpgsql`) |
| Applied migrations (`sbms_schema_migrations`) | 12 |
| Readiness (`checkDatabaseReadiness`, expected name `sbms_test`) | `{"ready":true}` |
| Data after the Jest + smoke runs | `users=4`, `audit_logs=1`, `students=0`, `duplicate_flags=0`, `duplicate_review_events=0`, `bursary_awards=0`, `disbursements=0`, `reports=0`, `beneficiaries=0` |

The Jest run leaves the test database clean (no students, flags or disbursements), which matches the
Phase 5 evidence in handover section 19.4. Recovery of this database was separately rehearsed end to
end (custom-format dump, independent restore database, readiness, schema/row-digest comparison and an
application smoke test against the restored copy); the evidence is in
`docs/database-recovery-rehearsal-2026-10-31.md`.

## 6. QR verification tests

| Check | Result |
|---|---|
| `backend/test/verification.unit.test.js` (native, 5 tests) | **PASS** — URL/QR image use the configured public origin and a fragment token; a well-formed token returns only an existence result; missing/malformed/extra fields are rejected without querying; a failed lookup returns a generic failure; the limiter allows ten requests and rejects the eleventh |
| `backend/tests/verification.test.js` (inside the Jest suite) | **PASS** (part of the 21 suites / 128 tests) |
| `scripts/qr-smoke.mjs` (headless Chrome, 9 checks) | **NOT RUN this session** — last recorded result is 9/9 on 2026-10-30 (handover section 18.3); it is not re-claimed here |
| Phone camera scanning a printed/displayed QR | **NOT RUN** — requires a public HTTPS origin, which needs Phase 6 |

The verification endpoint is privacy-limited by design: possession of a token proves only that a
record exists, never identity, eligibility, award amount or payment state. Nothing in this run tested
a real phone camera, printed QR code, token expiry or revocation.

## 7. End-to-end tests

| Check | Result |
|---|---|
| `backend/tests/workflow.test.js` (11 tests, inside Jest) | **PASS** — registration, review case, verification, two independent duplicate gates (award approval and disbursement), approval, disbursement, payment clearance, acknowledgement, audit trail, role boundaries |
| `backend/test/api.smoke.test.js` against a live API | **PASS — 3/3** (health, admin authentication plus role boundary and admin resources, report-export date validation) |
| `/api/ready` on a live API against `sbms_test` | **PASS** — `{"status":"ready"}` |
| `npm run smoke:browser` (real Chrome over DevTools) | **NOT RUN — blocked** |

The browser harness was not run because it requires three preconditions this session did not have:
`SBMS_VERIFY_PASSWORD` (absent from `backend/.env`, `backend/.env.test` and the environment), a Chrome
instance started with `--remote-debugging-port=9222`, and a frontend dev server on port 4174. The
accounts it signs in with do exist in `sbms_test` (`phase3.admin@example.invalid`,
`phase3.officer@example.invalid`). Setting a new password through `npm run seed:verification` would
rewrite account credentials, which is outside the scope of a test-report regeneration, so it was not
done and no browser result is claimed.

## 8. Outstanding tests

| Outstanding item | Why it is still open |
|---|---|
| QR phone-camera test (Phase 4 exit criterion) | Needs a public HTTPS origin: the Azure deployment or an HTTPS tunnel |
| Browser E2E (`npm run smoke:browser`) | Needs `SBMS_VERIFY_PASSWORD`, a Chrome DevTools session, API plus dev server |
| `scripts/qr-smoke.mjs` re-run | Same prerequisites as above; not re-run in this session |
| Azure exercises (Phase 6 exit criterion) | Nothing is provisioned; six approvals are outstanding |
| UAT with real users | Not scheduled |
| ML accuracy on adjudicated data (Phase 2) | No adjudicated ground truth exists; D1-D5 unanswered; the 0.50 cutoff is unvalidated |
| Cloud performance and load testing | `performance.test.js` passes locally; no hosted load test has run |
| Docker image build/run | Docker engine not running (`docker info` fails); image size was measured earlier at ~2.07 GiB |
| `pytest` | Not installed in `ml-service/.venv` |

## 9. What changed since the 2026-10-27 report

| Item in the old report | Status now |
|---|---|
| "Backend Jest suites — BLOCKED, `jest` is not recognized" | **Resolved**: 21 suites / 128 tests pass |
| "QR verification native tests — BLOCKED, `Cannot find module 'qrcode'`" | **Resolved**: 5/5 pass |
| "Backend DB integration/smoke suite — NOT RUN" | **Resolved**: Jest runs against real `sbms_test`; live HTTP smoke passes |
| "Local isolated backup restore — BLOCKED, `fe_sendauth`" | **Resolved**: dump and restore rehearsed; see `docs/database-recovery-rehearsal-2026-10-31.md` |
| "Render Blueprint validation" | **Superseded**: the target is Azure (Phase 6 research) |
| "Docker image build/runtime — BLOCKED" | **Unchanged**: engine still unavailable |

Two environment quirks carry over and are cosmetic: PowerShell surfaces a child process's stderr as
`NativeCommandError`, and a sandboxed shell can raise Windows `EPERM` while Node resolves
`C:\Users\user`. Every command above reports its own real exit code, and a `NativeCommandError` line
accompanied by exit code 0 is not a test failure.

**Bottom line:** 21 Jest suites / 128 tests, 43/43 in-process native tests, 3/3 live HTTP smoke tests,
a green production build, and 40 Python tests all pass on this checkout. The unverified areas that
matter for the submission — real phone-camera QR scanning, browser UAT, hosted Azure behaviour, and
any accuracy claim about the duplicate model — remain unverified and are listed in section 8.


