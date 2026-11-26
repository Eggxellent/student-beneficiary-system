# SBMS final-report evidence audit

**Prepared:** 25 November 2026  
**Repository:** `student-beneficiary-system`  
**Checkout:** branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`  
**Working tree:** dirty before this evidence package was created; the application, database, and ML files already had uncommitted changes. The working tree is not a single reproducible commit. The ML retraining work later in this session changed ML generator/training/audit code, the synthetic datasets, evaluation reports and model artifact; it did not change application backend/frontend workflows, migrations, or deployment resources.

## Executive finding

SBMS is currently a React/Express/PostgreSQL application with authenticated Guardian accounts and applications, staff review, advisory duplicate screening using a Python model child process (current selected estimator: HistGradientBoosting), eligibility assessment, award proposal and approval, audit/notification records, and QR/token-based student and certificate verification. The code and histories describe a system that has changed materially from earlier documentation. The source-of-truth for this audit is the current checkout, not the old Chapter 4–6 drafts or earlier deployment snapshots.

The project brief’s stated Guardian correction workflow (“More Info Required” with field-limited editing) is **not implemented in the current checkout**. Guardian applications are viewable after submission but have no application-edit route; statuses are `submitted`, `under_review`, `approved`, and `rejected`. The separate profile endpoint edits only the Guardian account. The chapter must disclose this gap.

## What is supported by current repository evidence

- Guardian self-registration is a public, rate-limited route at `/api/guardian/register`; Guardians then sign in through the shared login. Staff routes are role-gated.
- A Guardian application is stored in `guardian_applications`. On submission, the same transaction links it to a `students` row, screens that student against the existing registry, records duplicate flags, and automatically assesses eligibility when no unresolved duplicate blocks assessment.
- Administrators manage the Guardian application status queue and the duplicate-review workflow. Field Officers see registered student/eligibility projections and may propose an award. The Administrator decides the award. The score is advisory; it does not itself establish identity or eligibility.
- Approved awards issue an approval certificate; QR/token or typed reference verification is implemented. This certifies the stored approval record. It does not prove that funds were paid.
- The current ML contract uses a **HistGradientBoostingClassifier** (`scikit-learn==1.9.0`) over six ordered features: `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `admission_number_match`, `birth_certificate_match` (schema `student-pair-v2-admission-number`). UPI is not a feature because the Guardian form does not collect it. Admission-number comparison is school-gated; birth-certificate and guardian identifiers are compared after prefix normalisation, falling back to Jaro-Winkler.
- The current artifact is at the compatibility path `ml-service/model/xgb_duplicate_model.joblib`; it is an uncalibrated HistGradientBoosting model with validation-selected cutoff 0.63. Fresh synthetic final-test F1 is 87.48%, and the depth-2 validation baseline is 84.90%. The model does not establish real-beneficiary accuracy.
- Python `unittest` discovery passed 33 tests; the prediction smoke script passed 17/17 scenarios. These checks do not validate actual applicant performance.

## Material discrepancies and claims to correct

| Earlier or requested description | Current evidence | Required report treatment |
|---|---|---|
| No-login Guardian submission with tracking code | Guardian account registration, shared login, authenticated application list/detail | Describe the current authenticated flow; treat no-login tracking as an abandoned design documented in older files. |
| Field Officer investigates raw Guardian applications, then verifies one | Current `/api/guardian/staff/applications` and status mutation are Administrator-only; application submission links a student immediately. Field Officers access a filtered registered-student view. | Describe current behavior and identify the difference from the earlier redesign specification. |
| “More Info Required” with selectively editable fields/documents | No such status or application patch route is present; only four application statuses are supported. | Mark not implemented. Do not say submitted values become selectively editable. |
| Award verification step before approval | Current award route allows Field Officer proposal and Administrator decision; old verification-event schema remains but is not a current user-facing step. | Do not invent an intermediate verification step. |
| Disbursement/payment is a current core workflow | No disbursement router/page or payment operation is mounted in the current source. The legacy `disbursements` table is still queried by public certificate verification for recorded payment summaries. | State that SBMS does not execute payments. If mentioned, describe only the legacy/read-only data use and distinguish approval from payment. |
| The model has confirmed real-world high accuracy | Synthetic final-test F1 is 87.48%; no adjudicated beneficiary pairs are in the repository. | State the synthetic-only result and lack of real-world validation. |
| Deployment reflects the current local checkout | Deployment was completed earlier; the deployment log records later API/frontend live activity, while this local pass did not query Azure. | Report deployment as complete, cite dated Azure records, and state current local/live revision parity is not established. |

## Evidence state and limitations

- **Direct code inspection:** current route/controller/service/schema/migration/model source, package manifests, workflow configuration, and relevant test files.
- **Executed on 25 November 2026 (this pass):** `npx jest --runInBand tests/duplicateCheck.test.js tests/eligibility.test.js` with `NODE_ENV=test` and the `backend/.env.test` variables loaded against the local PostgreSQL 17 `sbms_test` database → **2 suites, 33 tests, all passing**. `ml-service/.venv` `python -m unittest tests.test_feature_engineering tests.test_operating_point` → **18 tests, OK**. A broader Jest invocation (guardian pipeline, duplicate flags/aggregation/ML review, bursary certificates) captured `FAIL tests/duplicateFlags.test.js`; the run’s summary was not recovered, so that suite must be re-run and its first failure recorded before it is reported as passing.
- **Blocked or limited here:** the shell lost command-completion reporting partway through the pass, so the remaining Jest suites and `check_training_integrity.py` re-runs could not be captured; Azure CLI and the live deployment were not re-inspected. These are tooling limitations of this environment, not application test results.
- **Not available in checkout:** approved proposal, exact four approved objectives, Chapters 1–3, original bibliography, formal user-study/UAT records, current Azure deployment identity, current environment/database runtime inventory, Sharon Akinyi Ouma fixture, and evidence of real-beneficiary labels.
- **Not performed:** no production database or Azure resource was modified, no data was seeded, the model was retrained/replaced on synthetic data, and no diagrams or screenshots were created.

## Report readiness

The evidence folder contains draft chapters, traceability and handoff instructions, but the final report cannot be called fully verified until the author supplies the missing proposal/objective wording and references, confirms the implemented workflow deviations, and provides current deployment and author-side study evidence. See `07_EVIDENCE_GAPS_AND_USER_ACTIONS.md` for exact actions.

## Read next

1. `01_CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`
2. `02_CHAPTER_5_IMPLEMENTATION_TESTING_EVALUATION.md`
3. `03_CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_FUTURE_WORKS.md`
4. `04_AI_USE_DECLARATION_AND_REFERENCES.md`
5. `05_APPENDIX_EVIDENCE_INDEX.md`
6. `06_REQUIREMENTS_TRACEABILITY.csv`
7. `07_EVIDENCE_GAPS_AND_USER_ACTIONS.md`
8. `08_CLAUDE_FINAL_REPORT_HANDOFF.md`
## ML re-verification addendum (25 November 2026)

- The previous test partitions and model were contaminated by iterative diagnostics and are archived under `ml-service/backup_contaminated/`. An intermediate candidate that failed a serving smoke case is also archived, with its test labels unopened.
- The current artifact is uncalibrated `HistGradientBoostingClassifier`; cutoff 0.63 was selected on validation only. The split uses dataset seed 20261126 and is 21,000/4,500/4,500 rows.
- Current synthetic final-test F1 is 87.48%; depth-2 validation F1 is 84.90%. The test was scored once after model lock. Structural split verification read only group/identity/guardian/raw-pair fields; it did not load test labels, engineered features, or predictions.
- Structural checks found zero shared groups, identities, guardian clusters, identical rows, directed pairs, or reversed pairs. The unit suite passed 33 tests and prediction smoke passed 17/17; neither reads the final test CSV.
- The synthetic set is not independently adjudicated. Keep Administrator review mandatory and do not describe these metrics as real-beneficiary accuracy.
