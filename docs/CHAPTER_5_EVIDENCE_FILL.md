# Chapter 5 evidence fill-in sheet

**Purpose:** insertion-ready project facts and unresolved evidence for the Chapter 5 text supplied in the Codex attachment. This file is not a replacement for the thesis chapter. It does not invent workstation specifications, screenshots, test runs, live database results, or user-study findings.

**Repository snapshot reviewed:** local branch `fix/sbms-completion-work`, commit `dabfa1bf94c84ad062cfe6d32fc654e6ad239835`. This commit is local and has not been pushed or deployed. The worktree also contains pre-existing untracked documents; they were preserved.

## Facts supported by the repository and recorded checks

### 5.2 Environment and software

The project is a React single-page frontend, an Express API backed by PostgreSQL, and a Python process for duplicate-candidate scoring. The API Dockerfile uses Node 22 on Debian Bookworm slim. The project lockfiles record React 18.3.1, Vite 5.4.21, Express 4.22.3, `pg` 8.23.0, bcrypt 6.0.0, JSON Web Token 9.0.3, Jest 30.5.1, and Supertest 7.2.2. The Python requirements pin pandas 3.0.5, scikit-learn 1.9.0, XGBoost 3.2.0, and jellyfish 1.2.1. Lockfile versions are dependency records; they do not prove that every package was installed in the test environment.

The local execution session reported Node.js 22.11.0 and npm 10.9.0. A PostgreSQL 17.11 Windows service was running and listening on loopback. Its database and role were not verified because PostgreSQL required a password. The browser/device versions, workstation processor, memory, storage, and installed Python runtime version were not recorded and must be supplied from the machine actually used for the thesis tests.

The variable names present in the project configuration include `PORT`, `DATABASE_URL`, `SBMS_EXPECTED_DATABASE_NAME`, `JWT_SECRET`, `CORS_ORIGINS`, `PUBLIC_APP_URL`, `PYTHON_EXECUTABLE`, `ML_REVIEW_SCORE_THRESHOLD`, `DUPLICATE_REVIEW_THRESHOLD`, `DUPLICATE_HIGH_PRIORITY_THRESHOLD`, and optional `ACKNOWLEDGEMENT_OVERDUE_DAYS`. The empty-database initializer additionally requires `SBMS_INITIALIZE_EMPTY_DATABASE`, `SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED`, `SBMS_BOOTSTRAP_ADMIN_NAME`, `SBMS_BOOTSTRAP_ADMIN_EMAIL`, and `SBMS_BOOTSTRAP_ADMIN_PASSWORD`. Include names and purpose only; never include values.

### 5.3 Implementation facts

- **Authentication:** `POST /api/auth/login/admin` and `POST /api/auth/login/field-officer` use a shared login controller. Passwords are compared with bcrypt, inactive accounts are rejected, and successful sign-in issues an eight-hour JWT. Public registration returns 410; admin creation is not public. Sources: `backend/src/routes/auth.routes.js`, `backend/src/controllers/auth.controller.js`, `backend/src/models/auth.model.js`, `backend/src/middleware/auth.js`, and `backend/src/middleware/requireRole.js`.
- **Database:** `backend/src/db/schema.sql` defines `users`, `students`, `duplicate_flags`, `duplicate_review_events`, `disbursements`, `audit_logs`, and `reports`. Automatic SQL migrations add further student and reconciliation fields/tables, including bursary awards and payment/verification events. The manual `20261023_retain_primary_accounts.sql` is not part of the automatic migration order. The baseline does **not** create the legacy `beneficiaries` table, although `/api/beneficiaries` remains mounted. The newer student and legacy beneficiary models are separate; do not claim they are reconciled. `scholarship_amount` has no approved mapping to requested, approved, issued, cleared, or acknowledged payment amounts.
- **Startup/bootstrap:** the API startup validates the configured database name and the required public `users` login columns before listening. The separate `db:bootstrap-empty` command requires explicit target approval and refuses existing public relations, routines, or custom types. Its SQL has not been executed against a real PostgreSQL database in the current checkout. Do not describe the hosted schema as initialized.
- **QR:** registration generates a server-side 32-byte token and a QR URL using `PUBLIC_APP_URL`; the token is held in the URL fragment. The public verification endpoint accepts a token and returns whether a matching student exists without student details. The route is rate-limited in-process to 10 requests per IP per 15-minute window; limits are not shared across instances. Source review does not establish that a phone-camera scan or hosted QR flow was tested.
- **Duplicate workflow:** model scores are review signals; administrators make the final duplicate decision. Normalized exact UPI, birth-certificate, and National ID matches can also queue human review independently of the model score. They do not automatically reject a student.
- **Payment workflow:** the current code has award verification/approval and disbursement reconciliation states. Keep requested award amounts, approved limits, issued/cleared payments, failed/cancelled payments, acknowledgements, and null/unverified legacy rows separate. This sheet does not resolve the programme's reporting definitions.

### 5.3.5 Correct production feature table

The production predictor loads `ml-service/model/xgb_duplicate_model.joblib` as an XGBoost classifier, builds columns in the following order, and calls `predict_proba`. The field name `probability` is an API compatibility name; the documented evaluation says the score is uncalibrated. The ten-feature research artifact is separate and must not be described as production.

| Order | Feature column | Implemented calculation | Type |
|---|---|---|---|
| 1 | `jaro_winkler` | Maximum of direct and token-order-tolerant Jaro–Winkler name similarity; missing names score 0 | Continuous, 0–1 |
| 2 | `dob_match` | Date similarity: same date 1.0, one-day difference 0.8, up to seven days 0.5, otherwise 0; missing/unparseable dates score 0 | Continuous, 0–1 |
| 3 | `school_match` | Normalized exact school identifier match | Binary, 0/1 |
| 4 | `guardian_match` | Normalized identifier similarity, including prefix handling and Jaro–Winkler for non-exact values | Continuous, 0–1 |
| 5 | `upi_match` | Normalized identifier similarity, including prefix handling and Jaro–Winkler for non-exact values | Continuous, 0–1 |
| 6 | `birth_certificate_match` | Normalized identifier similarity, including prefix handling and Jaro–Winkler for non-exact values | Continuous, 0–1 |

The supplied chapter currently calls several of these binary. Correct that description. The ordering and calculations come from `ml-service/feature_engineering.py`; loading and inference are in `ml-service/predict.py`.

### 5.4 Dataset and model facts

The recorded production evaluation uses 12,000 generated synthetic training pairs and 12,000 generated synthetic holdout pairs, each balanced 6,000/6,000 across labels 0 and 1. Both are grouped by latent person entities; the holdout was generated from new latent identities. The holdout was subsequently used to compare and select XGBoost over Random Forest, so its metrics are **post-selection descriptive results**, not an unbiased final estimate. The synthetic generator is not a sample of actual SBMS applicants.

At threshold 0.5, the recorded XGBoost metrics are precision 0.9204, recall 0.8927, F1 0.9063, average precision 0.9727, and ROC-AUC 0.9685. Confusion counts are TN 5,537, FP 463, FN 644, TP 5,356. The report also records a 22.21% false-positive rate for its synthetic identifier-collision slice and 7.84% for its common-name/same-school slice. Do not present assumed-prevalence precision as measured operational performance. Cite `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json` and `ml-service/RETRAINING_EVALUATION.md`, and explicitly state the holdout-selection limitation.

Recorded selection configuration: 250 estimators, maximum depth 4, learning rate 0.05, row and column sampling 0.9, L2 regularization 1.0; scikit-learn 1.9.0 and XGBoost 3.2.0. The model evaluation JSON records artifact SHA-256 `6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9`; verify that hash against the exact artifact used in the final thesis test run before publishing it as current provenance.

### 5.5 Test evidence and status

For the current local feature commit, the focused command below passed 29/29 native Node tests. The tests use fakes or pure functions; they are **not** PostgreSQL-backed authentication integration tests:

```text
node --test backend/test/databaseBootstrap.node.test.js backend/test/databaseStartup.node.test.js backend/test/databaseReadiness.node.js backend/test/migrate.unit.test.js backend/test/jwtSecret.validation.node.cjs
```

`node --check` for the changed JavaScript files, backend `package.json` JSON parsing, and `git diff --check` also passed. Backend Jest/auth integration was blocked: `pg` and Jest could not be resolved after `npm ci --prefix backend` failed in a package install script with Windows `EPERM`. No DB-backed test or real bcrypt verification was run on this commit.

An older test report records 79/79 backend tests and a frontend build on another checkout/revision (`experiment/febrl-record-linkage`, `22435ec…`, dated 2026-10-27). Do not attribute those results to commit `dabfa1b` without rerunning the tests on that exact revision. Earlier ML Python tests were recorded as 10/10 and research-helper tests as 7/7, but they also need an explicit revision link before being used as current results.

The Render API was previously reported live with `/api/health` returning `{"status":"ok"}`; that is only liveness. A supplied Admin-login diagnostic recorded PostgreSQL code `42P01` at `auth.model.js:4:20`. The current Render schema query was blocked by its IP allowlist, so current tables and live login are unverified. No production migration, successful Admin login, end-to-end test, user acceptance study, or latency benchmark is verified in this evidence.

## Items the author must still supply

1. Actual workstation/browser/device specifications, installed Python version, and which exact machine/environment ran each test.
2. Redacted screenshots for registration, invalid input, login outcomes, duplicate review, QR verification, awards/disbursement, dashboard and PDF export. Use only synthetic data. Do not claim phone-camera scanning unless actually tested.
3. Current branch/commit under test, repository link, accessible-source confirmation, and a test report tied to that revision. The local feature branch is not a deployed revision.
4. A safe, disposable PostgreSQL test database and actual DB-backed test results. Do not use the hosted or ordinary development database as a test target.
5. A current authorized metadata result for the Render database, followed by explicit approval before any production initialization. Do not put a dump, database URL, password, JWT, or personal record into the thesis or chat.
6. The actual model artifact hash from the thesis run, training generator/source and label definition, split seed, leakage-check output, and baseline result (or a statement that no baseline was run).
7. User-acceptance participants, roles, count, tasks and findings—or state that no user study was conducted and mark NFR-06 unverified.
8. Actual performance workload, measurements and environment—or state that performance testing was not run.
9. An objective-by-objective decision supported by completed evidence. Do not mark implementation or effectiveness objectives achieved solely because code exists.
10. AI-use disclosure for tools actually used and how their outputs were checked.

## Suggested wording for the current deployment limitation

> The hosted API process was reported live and its liveness endpoint returned `{"status":"ok"}`. This endpoint does not test database schema readiness. A prior Admin-login diagnostic recorded PostgreSQL `42P01` at the `users` query. A subsequent read-only schema query could not run because the client IP was not allowed. Therefore, the production schema and successful Admin authentication were not verified at the time of writing; no migration or restore was performed.

