# Chapter 5: System Implementation, Testing and Evaluation

> **Evidence binding:** inspected 25 November 2026; branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, dirty working tree. Several app/model source files were already modified or untracked before this documentation pass. Runtime values below are limited to commands that executed successfully or dated repository evidence. Azure identity and Node test/build execution could not be verified in this sandbox.

## 5.1 Introduction

This chapter describes the current implementation and separates source inspection from tests executed in this audit and older recorded tests. The implementation combines a React/Vite interface, Express API, PostgreSQL persistence and a Python pair scorer. The selected artifact is an uncalibrated `HistGradientBoostingClassifier` stored at the compatibility path `ml-service/model/xgb_duplicate_model.joblib` (schema `student-pair-v2-admission-number`). The metrics below are synthetic-pair measurements and do not establish performance on real beneficiaries.

## 5.2 Implementation environment

### 5.2.1 Hardware and development environment

The repository identifies Windows paths and the executable environment exposed Node.js `v22.11.0` and Python `3.11.9` (the project virtual environment). Hardware CPU and memory were not verifiably queried in this pass. Windows WMI/CIM access returned `Access denied`; no processor or RAM specification should be inferred from older host notes.

The API and frontend package scripts configure local development ports `5000` and `4174` (`backend/src/index.js`, `frontend/package.json`). These are configured defaults, not evidence that services were running during this documentation pass.

### 5.2.2 Software and versions

| Technology | Version / configuration | Purpose | Evidence and status |
|---|---|---|---|
| Node.js | 22.11.0 observed | API and frontend tooling | `node --version`, executed here. |
| React / React DOM | 18.3.1 declared | Browser UI | `frontend/package.json` and lockfile. |
| Vite | 5.4.1 declared | Frontend development/build | `frontend/package.json`; build attempt could not start because Node reported sandbox `EPERM` resolving `C:\Users\user`. |
| Express | 4.19.2 declared | REST API | `backend/package.json` and lockfile. |
| PostgreSQL client | `pg` 8.12.0 declared | API persistence | `backend/package.json`. Server version for the current environment was not independently queried. |
| Jest / Supertest | 30.5.1 / 7.2.2 declared | Backend tests | `backend/package.json`; selected suites could not start due same Node path restriction. |
| Python | 3.11.9 observed in ML venv | Feature generation, training, inference | Executed `ml-service/.venv/Scripts/python.exe`. |
| pandas / scikit-learn / XGBoost / jellyfish | 3.0.5 / 1.9.0 / 3.2.0 / 1.2.1 | Pair dataset and classifier | Imported in active venv and pinned in `ml-service/requirements.txt`; jellyfish has no exposed `__version__` attribute in this environment. |
| Azure | Existing completed deployment; dated records in `docs/azure-deployment-log-2026-10-31.md` | Hosting and prior live verification | The log records completed deployment and later live activity, including a frontend redeployment on 18 Nov. This pass did not query Azure; parity with the current local worktree is not established. |

### 5.2.3 Configuration, startup and deployment

The API loads `.env` through dotenv, validates the JWT key and public app origin before listening, and checks the configured database and required tables at readiness. The frontend API origin is build-time configuration (`VITE_API_ORIGIN` in the API client); the backend CORS allowlist and trusted proxy count are environment-configured. Environment variable names may be documented, but values must not appear in a report.

Local setup described by package files is: install backend/frontend dependencies from the checked-in lockfiles, provision a local disposable PostgreSQL database, apply migrations with the repository migration script, set environment values from `.env.example`, then start API/frontend. This audit did **not** create a database, apply migrations, start services, or access a production database. Use the README and `backend/scripts/setup-local-database.js` for the actual supported commands; confirm current DB script behavior before reproducing.

The root Dockerfile describes the API plus an embedded Python virtual environment and model. `.github/workflows/publish-api-image.yml` publishes an image on configured triggers and contains model-load/inference gates. Azure deployment was completed earlier; `docs/azure-deployment-log-2026-10-31.md` records the deployment and subsequent live checks, including later November frontend deployments. The Azure CLI profile was inaccessible to this local audit, so no new cloud query was made. The current local checkout is not established as the deployed revision. Treat the November 3 Azure snapshot as historical and use the later deployment log for the deployment timeline. Deployment is not outstanding work.

## 5.3 Implemented modules

| Module | Inputs and processing | Outputs / permissions | Evidence |
|---|---|---|---|
| Guardian account and application | Guardian details, student/school, identifiers, household and five eligibility inputs; validation and transaction; student linking and duplicate screening | Own application records; authenticated Guardian endpoints. | `guardian.controller.js`, `guardian.routes.js`, `guardianApplicationLink.js`, `NewApplication.jsx`, `ApplicationDetails.jsx`. |
| Duplicate screening/review | Student records and school-aware six-feature pair scores; threshold and aggregation policy; case audit and resolution | Administrator review cases; no automatic finding or rejection. | `studentRegistration.js`, `mlDuplicateReview.js`, `duplicateAggregation.js`, `duplicateFlags.controller.js`. |
| Eligibility | Five need inputs and rules-based weighted scoring; unresolved duplicate gate | Assessment/category and provisional recommendation; Field Officer assessment; never award approval. | `eligibility.js`, `automaticAssessment.js`, `eligibility.controller.js`. |
| Student/Field Officer views | Linked student records, saved assessment and duplicate state | Restricted roster, filtered to cleared/assessed students. | `student.model.js`, `students.routes.js`, `Students.jsx`. |
| Award | Field Officer proposal, annual duplicate-allocation and unresolved-duplicate checks; Administrator decision | Submitted/proposed/approved/rejected award record; approved award can issue certificate. | `bursaryAwards.controller.js`, `bursaryAwards.routes.js`, `Awards.jsx`. |
| Certificate verification | Award snapshot/reference/token compared to live award; public QR or typed lookup | Current/not-current/not-recognised status plus printed approval facts. | `certificateIssue.js`, `certificates.controller.js`, `certificateReference.js`, `CertificateVerification.jsx`. |
| Audit, reports, dashboard and notifications | Authorized action/events and persisted records | Admin reports/audit/dashboard; notifications scoped to user. | Corresponding controllers/routes/services and `frontend/src/pages/`. |

The schema file and migrations declare 18 distinct table names. Eleven are required by the current readiness query. A report should distinguish the current Guardian workflow from the earlier no-login tracking-code design and should not describe “More Info Required” selective application edits as implemented. The code has no such application status or patch endpoint.

## 5.4 Data and model implementation

### 5.4.1 Dataset and split methodology

The current training artifacts are generated by `ml-service/generate_realistic_pairs.py`. The label denotes same latent student versus different students; metadata such as identity/group/scenario/difficulty is excluded from the feature list. The current report records 21,000 training rows, 4,500 validation rows and 4,500 final-test rows (70/15/15). One generated population is partitioned by connected components spanning latent identities and guardian clusters. The structural audit reports zero shared groups, identities, guardians, identical rows, directed pairs, or reversed pairs.

The synthetic set is a designed challenge distribution, not an estimate of actual NG-CDF prevalence. The generator assigns 45% of generated positive groups to omitted identifier/name/DOB variation cases and 45% of negative groups to blocked household/school collisions (twins, siblings, same-school/same-DOB common-name classmates) with identifiers absent on one record. Component partitioning moves split rates slightly; all labels remain based on latent identities. Raw missing identifiers are blank and the shared feature builder returns zero similarity for absent values; missing feature columns are not emitted as NaN. The full set also includes other positive record changes. The exact scenario distribution and limitations are stored in `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json`.

Earlier test partitions were read during iterative diagnostics and have been archived as contaminated. The current test labels/features were not used for fitting, selection, or thresholding; structural identifiers were read before training only to verify split isolation. The final test was scored once after model lock. Labels remain simulator-generated, not external human adjudications.

### 5.4.2 Feature pipeline and inference

The ordered production features are:

1. `jaro_winkler`
2. `dob_match`
3. `school_match`
4. `guardian_match`
5. `admission_number_match`
6. `birth_certificate_match`

`feature_engineering.py` is shared by training and inference. It applies normalized name similarity, date parsing/tolerance, normalized school equality, identifier similarity, school-context admission comparison, and birth-certificate similarity. Missing values score zero in the feature builder; the model pipeline retains a median imputer for compatibility. `difficulty`, `difficulty_band`, scenario, variation, mutation, group, and identity metadata are not model inputs. UPI is not a model feature. Admission-number match is zero unless school identity matches; exact and transposed formats are considered only inside school context.

`predict.py` loads `model/xgb_duplicate_model.joblib` with metadata/schema/hash checks and computes scores using the shared feature contract. The backend invokes the Python predictor as a child process; it validates result shape, feature values and consistent model version. The API blocks or surfaces screening failure rather than treating an unavailable model as a clear result. Scores are positive-class outputs from the selected estimator trained on the synthetic training split. The six feature values match the shared serving feature builder.

### 5.4.3 Training, selection and artifact

The current estimator is `HistGradientBoostingClassifier` with `max_iter=160`, `max_leaf_nodes=7`, `l2_regularization=4.0`, `min_samples_leaf=25`, and `learning_rate=0.05`. It was selected from validation-only candidates. The model-analysis threshold is **0.63**, selected to maximize validation F1 subject to validation FPR <= 5%.

The backend case threshold is a separate, environment-configured value: `ML_REVIEW_SCORE_THRESHOLD` defaults to **0.50** (`backend/src/config/settings.js`). Unless a deployment sets that variable to the artifact's cutoff, the API and the training report disagree about the operating point; the report must state the value actually configured at deployment rather than implying they match. `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (default 0.70) only sets review priority and is marked unvalidated in the code, and the legacy `DUPLICATE_REVIEW_THRESHOLD` (default 0.30) is no longer the flag-creation threshold.

Earlier training runs in this repository used other estimators and other cutoffs, and their metric files remain on disk. They are historical. The authoritative pair for the report is the artifact plus `model/xgb_duplicate_model.metadata.json` and the metrics JSON it names; the author should confirm those hashes at the moment of writing and treat any other `evaluation/*metrics*.json` file as superseded.


## 5.5 Test strategy and results

### 5.5.1 Verification performed on 25 November 2026

| ID | Command / method | Result | Evidence and limit |
|---|---|---|---|
| ML-T01 | `ml-service/.venv/Scripts/python.exe -m unittest discover -s tests -v` (working directory `ml-service`) | **PASS: 33 tests** | Executed here; unit fixtures and in-memory generator samples. The suite does not read the final-test CSV. |
| ML-T02 | `ml-service/.venv/Scripts/python.exe test_predictions.py` | **PASS: 17 cases, 0 failures** | Executed here. It also prints known model/policy limitations; this is a synthetic operational smoke test, not real case accuracy. |
| ML-T03 | `check_training_integrity.py` | **PASS: structural-only audit**; zero shared groups, identities, guardian clusters, identical rows, directed pairs, and reversed pairs across all split pairs. It does not load test labels/features or calculate test metrics. |
| BE-T01 | Selected Jest: Guardian, Guardian pipeline, duplicate aggregation, predictor integration, eligibility and award workflow | **Could not start** | Node process failed with `EPERM: operation not permitted, lstat 'C:\Users\user'` before Jest loaded. This is a sandbox path error, not a failed application assertion. |
| FE-T01 | `npm.cmd --prefix frontend run build` | **Could not start** | Vite/Node failed with the same `EPERM` path resolution error before compilation. |
| DEP-T01 | Azure current deployment query | **Could not run** | Azure CLI profile access denied on `C:\Users\user\.azure\azureProfile.json`. No current-deployment claim is made. |
| DB-T01 | Database integration/migration test | **Not run** | No connection or migration was attempted; avoid exposing or using production data. |

The relevant test suite must be rerun on a local developer shell that can resolve Node modules and only after verifying that the test guard targets loopback database `sbms_test` with role `sbms_test_runner`. Never repoint it to production. The frontend build can likewise be rerun locally. These are outstanding verification actions, not implied passes.

### 5.5.2 Synthetic ML results

The model and cutoff were locked before the one-time final-test evaluation. All split metrics below use cutoff 0.63. Confusion matrices are shown as `[[TN, FP], [FN, TP]]`.

| Metric | Train (21,000) | Validation (4,500) | Final test (4,500; one evaluation) |
|---|---:|---:|---:|
| Accuracy | 88.12% | 87.89% | 88.00% |
| Precision | 94.05% | 94.01% | 94.07% |
| Recall | 81.36% | 80.42% | 81.76% |
| F1 | 87.24% | 86.68% | 87.48% |
| False-positive rate | 5.14% | 4.93% | 5.43% |
| False-negative rate | 18.64% | 19.58% | 18.24% |
| Confusion matrix | `[[9974,540],[1955,8531]]` | `[[2181,113],[432,1774]]` | `[[2073,119],[421,1887]]` |

The depth-2 validation baseline is 84.90%, narrowly below the proposed <85% gate. The previous contaminated run's tree used name similarity and birth-certificate similarity; the forensic report records both old and fresh rules. In the current validation data, single-feature AUCs are all below 0.773. A classifier trained only on raw missing-value indicators has 45.50% F1, below the 65.79% all-positive baseline. Full feature distributions by easy/moderate/hard tier and label are in `ml-service/evaluation/forensic_audit_fresh_20261126.json`.

No test labels or engineered features were read before model and threshold selection. The structural separation check reads only split IDs and raw pair fields. The final test was opened and scored once after lock; subsequent unit and smoke tests do not load that CSV. The results remain synthetic and do not establish real-world detection effectiveness.

Validation-only comparison included regularized XGBoost depths 2/3, LogisticRegression, RandomForest, HistGradientBoosting, and calibrated HistGradientBoosting. Uncalibrated HistGradientBoosting was selected at validation F1 86.68%, FPR 4.93%, threshold 0.63. See `ml-service/experiments/results/model_comparison_validation_20261125.json` for candidate metrics and parameters.
### 5.5.3 Error and scenario analysis

The final-test report records aggregate confusion counts and synthetic examples, but no post-test threshold changes or scenario-driven model revisions were made. The prediction smoke harness passed 17/17 hand-crafted scenarios; it also lists operational limitations such as re-registration with reissued identifiers and ambiguous sibling/name collisions. Those examples are not a substitute for adjudicated cases.

The Sharon Akinyi Ouma case is not found as a dedicated regression fixture. A similarly named Akinyi example in the Kenyan synthetic seed data is not proof of the stated name/DOB/school/birth-certificate variation through candidate retrieval, score threshold, case creation and eligibility gate. Do not present this as a successful Sharon test. Add a pseudonymous synthetic fixture only with explicit source/ground-truth metadata and separate test coverage.

### 5.5.4 System evaluation and governance

The current workflow keeps duplicate resolution and award approval in human hands. An unresolved duplicate blocks assessment and award progression in the code. This is a design-level and testable control, not a guarantee that every true duplicate is found. No user acceptance study, real-beneficiary adjudication, external fairness analysis, phone-camera test in the current revision, or present-day cloud end-to-end check was executed in this audit.

An approved award and its certificate represent an administrative decision, not money transferred. No payment processing flow is currently exposed in application routes/pages, although legacy disbursement rows are read for certificate payment summaries. Describe this distinction exactly.

## 5.6 Discussion against the four objectives provided in the report brief

The brief supplies paraphrases of four objectives; the approved proposal wording is absent. Confirm and replace these paraphrases with the exact approved objectives before submission.

| Objective (as supplied) | Assessment | Evidence and limitation |
|---|---|---|
| Investigate challenges in manual beneficiary registration/tracking | **Partially demonstrated** | Repository includes project documentation and a software artifact; no primary interviews/observation or original research instruments were supplied in this checkout. |
| Design architecture, database schema and ML pipeline | **Achieved in implementation evidence, with deviations** | React/API/PostgreSQL plus Python child-process design, schema/migrations and a six-feature HistGradientBoosting scorer exist. Proposal rationale and approved-objective text still require author confirmation. |
| Implement a web-based beneficiary management system | **Partially to substantially achieved in code** | Guardian intake, duplicate triage, eligibility, award decision, certificates and audit/notification modules exist. Deployment was completed earlier; current local/live parity and some local end-to-end tests are not established. More Info Required correction is absent. |
| Validate duplicate detection and beneficiary tracking | **Partially achieved** | Synthetic ML tests and pair metrics exist. No real labeled beneficiary evaluation or Sharon regression fixture is available. The deployment has dated live verification evidence; this local pass did not repeat live testing. |

## 5.7 Version control and evidence provenance

The inspected branch is `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, subject “Ignore local dev stack runtime files”, commit time `2026-11-24T13:56:02+03:00`. The branch tracks `origin/fix/restore-original-ui`. Before this documentation pass, the working tree already contained modifications across backend, frontend and ML code, plus untracked migrations, reports, notebooks, archives and model metadata. This means the checkout cannot be equated to HEAD alone. Preserve this state; do not claim the dirty changes are committed or deployed.

Deployment completion and live checks are documented in `docs/azure-deployment-log-2026-10-31.md`; the most recent recorded deployment activity is the 18 November frontend redeployment. This evidence must be dated and separated from local testing. The `academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md` snapshot is dated 3 November and is superseded for later deployment activity. This pass did not query current Azure revision identity, so do not claim the live environment matches the current dirty local worktree. That is a parity limitation, not a pending deployment.

## 5.8 Chapter summary

The source confirms an integrated application design and a reproducible synthetic ML pipeline. The one-time synthetic final-test F1 is 87.48%; the depth-2 validation baseline is 84.90%, narrowly below the proposed <85% gate. These results do not establish registry behaviour or real-beneficiary accuracy. Deployment was completed earlier and has dated live evidence; current local/live parity, the full backend suite, the frontend build, real-world model quality, user acceptance and the requested Sharon flow remain unverified. Administrator review remains essential, and report claims must preserve these limits.

## 5.9 Metrics for the shipped artifact

All metrics use validation-selected threshold 0.63. The backend review cutoff defaults to 0.50 and is separate. Confusion matrix layout is `[[TN,FP],[FN,TP]]`.

| Metric | Train (21,000) | Validation (4,500) | Synthetic final test (4,500; once) |
|---|---:|---:|---:|
| Accuracy | 88.12% | 87.89% | 88.00% |
| Balanced accuracy | 88.11% | 87.75% | 88.17% |
| Precision | 94.05% | 94.01% | 94.07% |
| Recall | 81.36% | 80.42% | 81.76% |
| F1 | 87.24% | 86.68% | 87.48% |
| Specificity | 94.86% | 95.07% | 94.57% |
| False-positive rate | 5.14% | 4.93% | 5.43% |
| False-negative rate | 18.64% | 19.58% | 18.24% |
| ROC AUC | 0.9678 | 0.9675 | 0.9688 |
| Average precision | 0.9656 | 0.9645 | 0.9679 |
| Confusion matrix | `[[9974,540],[1955,8531]]` | `[[2181,113],[432,1774]]` | `[[2073,119],[421,1887]]` |

The final-test F1 is slightly above the earlier 70-86% target. No post-test tuning was performed. See `ml-service/RETRAINING_EVALUATION.md` for the forensic audit and synthetic-data limitations.
## 5.10 Test execution record — 25 November 2026 pass

| Test ID | Command | Outcome | Notes |
|---|---|---|---|
| BE-01 | `npx jest --runInBand tests/duplicateCheck.test.js tests/eligibility.test.js` with `NODE_ENV=test` and `backend/.env.test` loaded | **Pass** — 2 suites, 33 tests | Local PostgreSQL 17, `sbms_test` database, `sbms_test_runner` role; guard verified loopback target before running. |
| ML-U01 | `ml-service/.venv/Scripts/python.exe -m unittest discover -s tests -v` | **Pass: 33 tests** | Full ML unit suite; no final-test CSV is opened. |
| BE-02 | Wider Jest run: `guardianPipeline`, `duplicateFlags`, `duplicateAggregation`, `mlDuplicateReview`, `bursaryCertificates` | **Fail** — `duplicateFlags` 6 failed / 9 passed | First failure is environmental: `column "admission_number" of relation "students" does not exist` because the migration is not in `MIGRATION_ORDER`. See §5.10.1. Do not report this suite as passing. |
| ML-I01 | `check_training_integrity.py --output evaluation/training_integrity_report_fresh_2026-11-26.json` | **Pass** | Structural-only audit: zero group, identity, guardian, identical-row, directed-pair and reversed-pair overlap. Test labels/features are not loaded. |
| FE-01 | `npm --prefix frontend run build` | **Not run in this pass** | Earlier EPERM blocker is environmental; rerun before quoting build evidence. |
| DEP-01 | Azure CLI resource/revision query | **Not run in this pass** | Deployment identity remains unknown; older Azure logs are dated historical records only. |

## 5.11 Requirement-to-test coverage (verdicts to be filled by the author)

Verdicts are left blank where the suite exists but was not re-executed in this pass; a blank is not a pass. `NT` marks a requirement with no test evidence in the repository.

| Requirement | Test file / evidence | Latest verdict |
|---|---|---|
| FR-01 Guardian registration | `backend/tests/guardian.test.js` | ________ |
| FR-02 Login and role landing | `auth.test.js`, `roleAuthorization.test.js`, `securityMiddleware.test.js` | ________ |
| FR-03 Application submission and validation | `guardian.test.js`, `guardianPipeline.test.js` | ________ |
| FR-04 Own-records scoping | `guardianPipeline.test.js`, `ownership` assertions | ________ |
| FR-05 Application immutability after submission | Route inventory; no PATCH route exists | Verified by inspection (no test) |
| FR-06 More Info Required field-limited editing | — | **NT — not implemented** |
| FR-07 Submission-time screening | `duplicateCheck.test.js` (executed, pass) | Pass (33-test run) |
| FR-08 Duplicate case recording with provenance | `duplicateFlags.test.js`, `duplicateAggregation.test.js` | **Fail 6/9 — environment drift; see §5.10.1** |
| FR-09 Audited identifier reveal | `duplicateFlags.test.js` | ________ |
| FR-10 Resolution blocks progression | `guardianPipeline.test.js`, `workflow.test.js` | ________ |
| FR-11 Field Officer roster filtering | `students` route tests, `roleAuthorization.test.js` | ________ |
| FR-12 Eligibility assessment | `eligibility.test.js` (executed, pass) | Pass (33-test run) |
| FR-13 Award proposal gating | `bursaryAwards*.test.js` | ________ |
| FR-14 Administrator award decision, no self-approval | `bursaryAwards*.test.js` | ________ |
| FR-15 Certificate issue and verification | `bursaryCertificates.test.js` | ________ |
| FR-16 Reports, audit, notifications | `notifications.test.js`, route inspection | ________ |
| FR-17 Payment execution | No route mounted | **NT — out of implemented scope** |
| NFR-01 Server-side role enforcement | `roleAuthorization.test.js` | ________ |
| NFR-04 Fail-closed inference | `mlPredictor.integration.test.js`, `predictorDateNormalization.test.js` | ________ |
| NFR-06 Public verification disclosure limits | `verification`, `certificate` tests | ________ |
| NFR-07 Performance/load | — | **NT — no load test exists** |

## 5.12 Figure and screenshot requirements (author to capture)

Capture each item from the running local build of the final commit, with the branch/commit visible in a second window if possible. No screenshots were produced during this pass.

1. Guardian registration and login, showing role-based landing.
2. New application form with the eligibility inputs and admission number field.
3. Submitted application in read-only state, captioned to show that no edit control exists (supports FR-05 and the FR-06 gap).
4. Administrator application queue with status filters.
5. Administrator duplicate-review list with score, feature values, model version and reveal action.
6. Duplicate case resolution dialog with reason and reviewer fields, plus the resulting audit-log entry.
7. Field Officer student roster showing the duplicate/assessment filter effect.
8. Eligibility assessment result with category and provisional amount.
9. Award proposal (Field Officer) and decision (Administrator) screens.
10. Issued certificate PDF with QR code, plus the public certificate-verification page returning current/not-current.
11. Public student-token verification returning existence only.
12. Reports/dashboard and audit-log pages.
13. Terminal capture of passing unittest, prediction smoke, and structural split-audit commands.

## 5.13 Mapping to the chapter numbering in the final report

The sections above are numbered by the order they were drafted. In the final document they map as: this file §5.1 → 5.1; §5.2 → 5.2 (with §5.2.1 hardware, §5.2.2 software, §5.2.3 deployment); §5.3 → 5.3.1; §5.4 → 5.3.2; §5.5–§5.11 → 5.4 (strategy, cases, project-specific evaluation, results); §5.6 assessment table and the limitations discussion → 5.5; §5.7 → 5.6. The metric table in §5.9 must be moved into 5.4 before submission and the superseded table deleted.

**Current artifact note:** `ml-service/model/xgb_duplicate_model.metadata.json` records `model_type: sklearn.pipeline.Pipeline` wrapping an uncalibrated `HistGradientBoostingClassifier` (`max_iter=160`, `max_leaf_nodes=7`, `l2_regularization=4.0`, `min_samples_leaf=25`, `learning_rate=0.05`), `scikit_learn_version 1.9.0`, `xgboost_version 3.2.0`, model hash `4c788be7…`, and a validation-selected review threshold of **0.63**. The `xgb` filename is a compatibility path only. Any sentence that calls the estimator XGBoost must be corrected in the final Word document.

### 5.10.1 `duplicateFlags.test.js` — root cause of the unresolved failure

Re-run on 25 November 2026 with the test environment loaded: **6 failed / 9 passed**. The first failure is not an assertion failure.

- Test: `GET /api/duplicate-flags should return pending duplicate flags for admins`.
- Error: `error: column "admission_number" of relation "students" does not exist`, raised by the fixture helper `createStudent` at `tests/duplicateFlags.test.js:52`.
- Cause: `backend/src/db/migrations/20261124_guardian_admission_number.sql` exists and is mirrored in `src/db/schema.sql`, but the file is **not listed in `MIGRATION_ORDER`** in `backend/scripts/migrate.js`. `node scripts/migrate.js status` reports `Migration inventory mismatch. Unlisted: 20261124_guardian_admission_number.sql; missing: none.`, so the column was never applied to `sbms_test`.
- A bare `npx jest` run without the environment reports `Jest blocked: set NODE_ENV=test and configure DATABASE_URL and SBMS_TEST_DATABASE_URL ...` from `tests/testDatabaseGuard.js:5`. That is a fail-closed guard, not a test verdict; load the test environment before quoting any Jest result.

Remediation before FR-08/FR-09 can be marked passing: register the migration in `MIGRATION_ORDER`, apply it to `sbms_test`, then re-run the suite. Do not edit the migration to match a stale test database.

Structural integrity re-run (`ml-service/check_training_integrity.py`) printed `verdict: pass (structural-only; labels, features, predictions, and test metrics were not loaded)` with zero group, identity, guardian-cluster, identical-row, directed-pair and reversed-pair overlaps for training/validation, training/test and validation/test. It therefore confirms partition hygiene only; it does not recompute or confirm the metric values recorded in the artifact metadata.


