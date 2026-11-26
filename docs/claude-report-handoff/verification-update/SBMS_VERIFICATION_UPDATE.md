# SBMS Verification Update

Consolidated verification findings from the nine topic notes. Audit date: 25 November 2026.

## Contents

- [SBMS conflict resolution summary](#sbms-conflict-resolution-summary)
- [Current implementation verification](#current-implementation-verification)
- [ML model and duplicate-detection verification](#ml-model-and-duplicate-detection-verification)
- [Eligibility and award flow verification](#eligibility-and-award-flow-verification)
- [Test results and provenance audit](#test-results-and-provenance-audit)
- [Deployment evidence versus local development](#deployment-evidence-versus-local-development)
- [Seven-diagram audit](#seven-diagram-audit)
- [Screenshot and wireframe audit](#screenshot-and-wireframe-audit)
- [Instructions for Claude after verification](#instructions-for-claude-after-verification)
---

# SBMS conflict resolution summary

**Audit date:** 25 November 2026  
**Repository snapshot:** `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326` (`0080482`), commit dated 24 November 2026. The working tree was already dirty.  
**Scope:** Read-only inspection of repository evidence. No tests, model evaluation, training, database changes, deployment, or academic report edits were performed for this package.

## Decisions for the report

1. **Chapters 4â€“6 should describe the current local implementation snapshot, not d229c62.** Identify it precisely as branch `fix/restore-original-ui`, HEAD `0080482â€¦`, plus the relevant uncommitted working-tree changes as inspected on 25 November. Since the tree is dirty, it is not a single reproducible commit. Do not imply the live service has this exact code. `d229c623e718b5fbbc723d4802d1b9ae756813f7` exists as an ancestor dated 11 November 2026; it is historical context. The Word report itself was not found in the repository, so the assertion that its chapters bind to d229c62 could not be independently checked.
2. **The active local artifact is HistGradientBoosting, not XGBoost.** The compatibility filename `ml-service/model/xgb_duplicate_model.joblib` is misleading. The current training source imports `HistGradientBoostingClassifier`; the joblib byte content contains its class marker, while the accompanying metadata calls the outer object only a `sklearn.pipeline.Pipeline`. Serving code loads this artifact through `joblib`. This verifies the current local artifact from source/metadata/serialized marker inspection, not the model deployed in Azure.
3. **The old award-beneficiary verification gate is removed.** Migration `20261111_remove_award_verification_gate.sql` drops `bursary_awards_approval_verification_check`; verification columns/history remain. Approval still requires an Admin decision and is blocked by unresolved duplicate cases and other award rules. Do not describe this as a duplicate-review gate being removed.
4. **Test results are run-specific and must not be merged.** Current evidence records a targeted 25 November backend run (duplicate check + eligibility, 2 suites/33 tests) and selected ML checks (18 tests); broader backend output records failures in duplicate flags. Full historical results belong to older snapshots. The phrase â€œ154/175â€ was not found as a test result. â€œ175/175â€ appears as a historical claim in a d229-era state note, not as a current run.
5. **The seven requested diagrams cannot be audited individually from the repository contents.** The seven diagram source/image files were not found. One Mermaid certificate data-flow file exists, but it is not a substitute for the seven requested diagrams. Ask the report author to supply the originals; then audit/update them against this snapshot.
6. **Treat existing screenshots as dated evidence, not current Guardian workflow proof.** The 18 November browser-smoke assets are gitignored and include explicitly stubbed screenshots. They predate the 21â€“24 November Guardian account/application pipeline changes. Do not recapture or edit screenshots as part of this package. The user will handle wireframes. The Word report and its screenshot placements were unavailable, so individual report-image references cannot be mapped. Keep the approved title/abstract unchanged pending the author's latest master document; make no unsupported claims about them.

## Verified repository version

- Branch: `fix/restore-original-ui`.
- HEAD: `0080482354b35d3d784cd34bd05879c63f2fd326`, dated 2026-11-24 13:56:02 +03:00.
- `d229c62` resolves to `d229c623e718b5fbbc723d4802d1b9ae756813f7`, is an ancestor, and is dated 11 November.
- The worktree contains pre-existing modifications across backend, frontend, ML, evaluation data, and documentation, plus untracked files. It was not changed by this audit except for this new verification package.
- Post-d229 changes include Guardian application/account and screening flows, duplicate-case decisions/resolution, awards/certificates, and subsequent frontend/backend corrections. See `01_CURRENT_IMPLEMENTATION_VERIFICATION.md` and `05_DEPLOYMENT_VS_LOCAL.md`.

## Source boundary

The actual source tree is authoritative for local implementation. Repository deployment logs are historical deployment evidence, not a live status query. No `.doc`/`.docx` copy of the Word report or the seven diagram files was located. A previous handoff may contain useful claims, but those claims are retained only where independently supported by code or dated evidence.


---

# Current implementation verification

**Snapshot:** 25 November 2026; branch `fix/restore-original-ui`; HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`; dirty working tree. These are source inspection findings, not a fresh runtime acceptance test.

## Guardian workflow

| Capability | Verdict | Evidence and limits |
|---|---|---|
| Guardian account registration | Implemented | `backend/src/routes/guardian.routes.js` exposes rate-limited `POST /register`; `guardian.controller.js` validates account fields, hashes password, creates Guardian account. UI: `frontend/src/pages/GuardianRegistration.jsx`. |
| Guardian login/authentication | Implemented | Shared `/api/auth/login`; Guardian routes use `authenticateToken` and `requireRole('guardian')`. Account flow is not a separate login API. |
| Submit student application | Implemented | Guardian-only `POST /applications`; controller validates application and eligibility fields, inserts `guardian_applications` with `under_review`, links/screen student in same transaction. `guardianApplicationLink.js`. UI: `NewApplication.jsx`. |
| View own applications | Implemented | `GET /applications` and `GET /applications/:reference`; queries are scoped to `req.user.id`. UI: `MyApplications.jsx`, `ApplicationDetails.jsx`. |
| Edit submitted application | Not implemented | No Guardian application PATCH/PUT route. `PATCH /me` edits Guardian profile only. `ApplicationDetails.jsx` explicitly says submitted applications cannot be edited. |
| Under Review read-only state | Implemented for Guardian UI | Details page is read-only and shows status; no edit action. Backend has no application edit endpoint. |
| Submission receipt | Partially implemented | API response supplies a generated application reference and submitted application; UI displays reference/date. No distinct receipt-generation/download/receipt endpoint was found. |
| Admin â€œMore Info Requiredâ€ | Not implemented | Status vocabulary is `submitted`, `under_review`, `approved`, `rejected`; decision schema has no `more_info_required`. Staff queue can review and set status through `PATCH /staff/applications/:id/status`. |
| Selectively reopen flagged fields/documents | Not implemented | No field-level editability/allowlist or reopening route found. |
| Guardian resubmission | Not implemented as a correction workflow | Duplicate submission handling is idempotent/returns existing application; it does not reopen arbitrary fields. |
| Approved/Rejected terminal states | Partially implemented | Guardian decision endpoint sets `decided_at` on approve/reject, but schema allows Admin to set `under_review` later; no immutable terminal transition is enforced here. Do not claim terminality. |

Additional evidence: `guardian.controller.js` status comments state submission itself is always under review and duplicate review is separate. Its `decisionSchema` permits `under_review|approved|rejected`. `guardianApplicationLink.js` links the new application to a student, screens it, and triggers automatic eligibility subject to duplicate clearance. The application schema requires fee balance, vulnerability, sibling count, prior-bursary history, and declaration.

## Other relevant local behavior

- Duplicate screening is an advisory ML score plus evidence/candidate handling; an administrator resolves review cases. See `backend/src/controllers/duplicateFlags.controller.js` and `backend/src/services/duplicateAggregation.js`.
- Student registration and Guardian application linkage use a Python prediction child process. An unavailable screening service prevents the Guardian submission from being committed, per `guardian.controller.js`.
- The award/certificate and eligibility flow is summarized separately in `03_ELIGIBILITY_AND_AWARD_FLOW.md`.

## Evidence limits

This is code-level verification. No browser session, API server, or database was started for this audit. Runtime behavior on a particular local database and exact UI build therefore remains unverified. Uncommitted changes are part of the inspected snapshot and reduce reproducibility.


---

# ML model and duplicate-detection verification

**Scope:** Static inspection of the current local artifact and source; no model was loaded, evaluated, trained, or modified during this audit. Azure's deployed artifact was not available for comparison.

## Current local serving artifact

- **Path:** `ml-service/model/xgb_duplicate_model.joblib` (working-tree modified).
- **Actual estimator:** `sklearn.ensemble.HistGradientBoostingClassifier`, inside a scikit-learn pipeline. The training source `ml-service/retrain_realistic_pairs.py` imports and constructs `HistGradientBoostingClassifier`. The current serialized artifact contains the `HistGradientBoostingClassifier` class marker. Metadata describes only the outer `sklearn.pipeline.Pipeline`, so its `model_type` alone is not enough to identify the estimator.
- **Filename warning:** `xgb_duplicate_model.joblib` is a legacy compatibility name. It does not establish that XGBoost is the estimator. `predict.py:model_version()` also hardcodes the string prefix `xgboost:` for the file digest; that label is stale/misleading for this artifact.
- **Metadata:** `ml-service/model/xgb_duplicate_model.metadata.json`. Declared schema is `student-pair-v2-admission-number`, six features, review threshold `0.63` selected on validation with validation FPR guardrail, and synthetic identity-scenario data. Artifact SHA-256 in metadata is `4c788be70fe558003cfa2b79b5b596f1b6a47692a69e613556ba114c04334913`. Metadata claims sklearn 1.9.0 and xgboost 3.2.0 environment versions; this does not imply XGBoost is the fitted estimator.
- **Training provenance:** Metadata records training/validation/holdout file hashes, generator hash, seeds and counts. Because generator, data, model and metadata are dirty/uncommitted in this checkout, provenance is a working-tree artifact record, not a commit-bound release. Synthetic records are not adjudicated beneficiaries.

## Feature contract and inference

`ml-service/feature_engineering.py:FEATURE_COLUMNS`, in order:

1. `jaro_winkler`
2. `dob_match`
3. `school_match`
4. `guardian_match`
5. `admission_number_match`
6. `birth_certificate_match`

`build_pair_features` computes these values. Admission-number similarity is gated by exact matching `school_code`; a matching school name fallback is not used for this gate. It recognizes exact normalized numbers and same-character transpositions. Name similarity uses Jaro-Winkler across concatenated and sorted tokens; DOB uses graded date similarity. Guardian and birth-certificate identifiers are normalized and compared with similarity fallback.

`ml-service/predict.py` loads the joblib artifact, checks `feature_names_in_` against `FEATURE_COLUMNS`, checks the metadata schema and artifact SHA-256, and uses `predict_proba`. The estimator must therefore expose the expected feature schema. Prediction outputs a probability; backend candidate aggregation and review policy determine what is shown for human review.

## Threshold and review behavior

- Model metadata review threshold: **0.63** (validation selected).
- `predict.py:predict_duplicate` has a default argument of 0.5, and the backend has its own `ML_REVIEW_SCORE_THRESHOLD` default. These values must not be conflated with the validation-selected metadata threshold. The exact active backend environment override was not established from this static audit.
- Backend logic includes aggregation/corroboration and can elevate exact-identifier evidence; an ML score alone is not a final identity decision. Guardian-only evidence is treated specially in current local source. Admin duplicate review and clearance are required before action on flagged cases.

## Older artifacts and deployment boundary

- XGBoost artifacts remain in `ml-service/backup_legacy/` and backups; these are not loaded by the current `predict.py` path.
- The current trainer uses HistGradientBoosting. Random Forest/research artifacts and archived models do not make those algorithms active in serving.
- A byte-string inspection of the active local artifact found the HistGradientBoosting class marker and not XGBoost/RandomForest markers; this was inspection, not deserialization or runtime prediction.
- The deployed Azure model class/hash cannot be established from the local files or deployment log. Do not call this local model the production model or claim local/live parity.

## Report-safe wording

â€œAt the inspected local snapshot, the Python service loads a HistGradientBoosting estimator saved under a legacy XGBoost-named path. It scores six engineered pair features; the output is an advisory review signal and requires administrator review. Reported synthetic metrics do not establish accuracy on real beneficiaries.â€


---

# Eligibility and award flow verification

**Basis:** Current local backend/frontend/SQL source inspection, not a fresh end-to-end run. No database was altered or queried for this package.

## Guardian application to eligibility

1. Guardian submits through `POST /api/guardian/applications` (role protected). Required assessment fields are fee balance, vulnerability status, number of siblings in school, and prior bursary history; household income is optional in the schema and can result in an incomplete assessment if absent.
2. `guardian.controller.js:createApplication` stores the application in `guardian_applications` with `under_review`, then `guardianApplicationLink.js:linkGuardianApplicationStudent` creates/links a student and invokes screening inside the transaction.
3. If duplicate screening is unavailable, the transaction is rolled back and the endpoint returns 503; it does not silently accept an un-screened application.
4. `automaticAssessment.js:assessAutomatically` checks the student's duplicate state. `pending` or `needs_verification` flags, unresolved `confirmed_duplicate`, or a student already marked as duplicate block assessment. A clean record is assessed under `registration_screening`; an Administrator clearing a false positive can trigger `duplicate_clearance`.
5. Missing scoring inputs are recorded as `incomplete` with named `missing_inputs`; they are not replaced with zero. Complete input is passed to `eligibility.js:calculateEligibility`, and the assessment is persisted. The automatic score/recommendation is not an identity decision or guaranteed award.

## Duplicate review and clearance

`backend/src/controllers/duplicateFlags.controller.js` implements review decisions (`confirmed_duplicate`, `not_duplicate`, `needs_verification`) and a separate resolution operation requiring a confirmed case and a canonical record. Clearing a false positive triggers eligibility assessment for the Guardian-linked student when applicable. `automaticAssessment.js:duplicateBlockReason` and award controller checks make unresolved duplicate cases consequential gates.

## Award and certificate flow

- `backend/src/routes/bursaryAwards.routes.js`: Field Officer lists and proposes (`POST /`); Admin reads detail and decides (`PATCH /:id/decision`). Admin-only correction/void routes are also present.
- `bursaryAwards.controller.js:create` refuses records marked as duplicates or held by unresolved duplicate cases. A submitted award requires Admin approval/rejection; approval checks unresolved duplicate cases, canonical identity, annual award conflicts, and separation of duties (the proposer cannot approve their own award).
- On approval, the certificate is issued in the same transaction. Certificate retrieval/PDF routes are available. Certificate verification describes the approved award record; it is not proof that bursary funds were disbursed.

## Verification gate distinction

Migration `backend/src/db/migrations/20261111_remove_award_verification_gate.sql` drops `bursary_awards_approval_verification_check`. It explicitly preserves the `verification_status` column and its history table. Thus the former beneficiary-verification status is **not a database approval gate** in the current migration history. There remains a separate **duplicate review gate**: pending/needs-verification or unresolved confirmed duplicate cases block eligibility/award progression. Do not conflate these gates.

The migration log notes it was applied in the November deployment history; current live database schema was not queried in this audit. Current local source/migration evidence establishes the intended local schema, but not live schema parity.

## Relevant limits

- This audit did not test workflows against a running API or database.
- Guardian â€œMore Info Requiredâ€ field reopening/resubmission is absent; see `01_CURRENT_IMPLEMENTATION_VERIFICATION.md`.
- Synthetic model score and automated eligibility recommendation both require appropriate human review; neither alone establishes beneficiary identity or guarantees an award.


---

# Test results and provenance audit

**No tests were rerun for this audit**, as instructed. This document classifies repository records; it does not certify that a test passes against the current dirty tree.

## Results recorded for 25 November 2026

| Evidence | Recorded result | Provenance classification |
|---|---|---|
| `docs/final-report-evidence/00_EXECUTIVE_AUDIT.md` targeted backend command: `tests/duplicateCheck.test.js tests/eligibility.test.js`, `NODE_ENV=test`, local PostgreSQL 17 `sbms_test` | 2 suites, 33 tests passed | Dated run claim in the audit document. The underlying full terminal transcript is not bundled here; treat as recorded run evidence, not independently rerun in this audit. |
| Same audit document: Python `tests.test_feature_engineering tests.test_operating_point` in ML virtualenv | 18 tests passed | Dated, focused run claim. Not a full backend or full ML suite. |
| `ml-service/evaluation/unittest_final.log` | `Ran 33 tests ... OK` | Existing log supports a 33-test Python run, but log alone does not bind it to current HEAD. The suite used fixtures/in-memory samples and does not read final holdout CSV, per `RETRAINING_EVALUATION.md`. |
| `ml-service/evaluation/prediction_smoke_final.log` | 17 prediction scenarios, zero scripted failures | Existing scenario log; not real-user/production validation and not commit-bound. |
| Broader backend duplicate-flags output | `duplicateFlags.test.js` failed; summary fragment shows six failing tests and three passing, first-failure capture absent/incomplete | Failed/incomplete evidence. Do not report broad backend suite as green. |
| Frontend build/Jest | Prior report records Node `EPERM` path-resolution failure before tool startup | Environment-blocked historical attempt, not a source assertion failure and not current pass evidence. |

## Historical counts and claims

- â€œ154/175â€ was not found as a test result in repository search. Do not repeat it.
- â€œ175/175â€ appears in historical state documentation associated with the 11 November `d229c62` snapshot. It is a document-recorded historical result, not a current-tree test run.
- `SBMS_CURRENT_PROJECT_STATE_FOR_CLAUDE.md` was not present at the repository root in this checkout. A current `docs/final-report-evidence/00_EXECUTIVE_AUDIT.md` contains a summary of historical evidence, not raw output for every claimed run.
- A previous state note also reports 224 backend tests on a 15 November working tree, but the exact commit is not established. Keep it historical and unbound unless the original transcript is supplied.
- Older 151/151 and 128/128 counts in project documentation belong to earlier runs and are not evidence for HEAD.

## Classification guidance

1. **Current-run claim (dated, recorded):** 25 November targeted backend and 18 selected ML checks, as summarized above. State exactly the subset and limitations.
2. **Existing log evidence, commit not bound:** 33 Python unit tests and 17 smoke scenarios. Do not imply these ran against an unchanged commit unless the log records it.
3. **Historical evidence:** 175, 224 and earlier totals. Name the associated date/snapshot and do not aggregate them.
4. **Unverified:** 154/175, full current backend pass, current frontend build pass, and broad current suite pass.

Certificate tests appear in historical test plans and older runs, but no current, commit-bound complete certificate-test run was found for this dirty snapshot. Do not claim one. No new commands were executed during this audit.


---

# Deployment evidence versus local development

Deployment was completed earlier. The present project phase is local testing, manual verification, bug identification, and preparation of report evidence. This audit made no deployment/hosting/live-data changes and did not query Azure.

## What the repository establishes

- `docs/azure-deployment-log-2026-10-31.md` records deployment operations and later entries. It describes API image deployment on 12 November using commit `a5c4ef4746144d83db15ee75731a83655b4a2c0e`, CI success, and `/api/health` plus `/api/ready` returning HTTP 200 at that time.
- The same log records frontend deployments through 18 November and a browser smoke run on the live app with 36 passed and 3 failed. The corresponding screenshots/results are in gitignored `verification-evidence/2026-11-18/`.
- `docs/academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md` is an earlier 3 November snapshot at `a3714f8`; its certificate endpoint finding predates subsequent deployment records and is not the latest evidence.
- The migration history and log document deployment of the award-verification-gate removal in November. This is historical deployment evidence, not a live database read in this audit.

## Local state on audit date

- Branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, commit dated 24 November.
- The worktree is dirty across application code, frontend, ML, data, tests, and docs; there are also untracked migration and artifact files. This local state cannot be represented as HEAD alone.
- Local files include newer Guardian application pipeline code and an updated HistGradientBoosting artifact. Their presence does not establish that Azure runs them.

## What cannot be claimed

- No live Azure revision/image query or live endpoint check was made now. Current live version, current health, current database schema, and whether the live app reflects HEAD or working-tree changes are **unverified**.
- No exact frontend/backend parity between local and live is established. The last dated deployment evidence is older than HEAD and uncommitted work.
- Do not describe deployment as pending. State that deployment is complete and that current verification is local; identify dated deployment evidence separately from current local code.


---

# Seven-diagram audit

The requested seven original diagrams were not present in the repository file inventory, so none can be visually or semantically audited without inventing details. No diagrams were edited or redrawn.

| Requested diagram | Filename/location found | Audit result |
|---|---|---|
| Activity diagram | Not found | Unverifiable: no original diagram to inspect. |
| Class diagram | Not found | Unverifiable. |
| Context diagram | Not found | Unverifiable. |
| ERD | Not found | Unverifiable. `backend/src/db/schema.sql` and migrations provide schema source, not the requested ERD image. |
| Sequence diagram | Not found | Unverifiable. |
| System architecture diagram | Not found | Unverifiable. `docs/figure-5-1-certificate-data-flow.mmd` is a certificate-specific flow and is not the overall architecture diagram. |
| Use case diagram | Not found | Unverifiable. |

## Available nearby material

- `docs/figure-5-1-certificate-data-flow.mmd` is the one Mermaid diagram source located by the audit. It represents certificate data flow, not one of the seven in the submitted inventory unless the author intended it as a separate figure.
- `backend/src/db/schema.sql`, `backend/src/db/migrations/`, API routes, and frontend role flows can serve as implementation references when the originals are made available.
- The Word report and its embedded diagrams were not present as `.doc`/`.docx` files in the repository. No claim can be made about embedded copies in that document.

## Action for report author

Supply the seven actual image/source files (or a readable PDF/Word report containing them) before requesting line-by-line corrections. Then compare roles, entities, cardinalities, API/service boundaries, duplicate review, Guardian applications, eligibility, awards, and certificates against the inspected local snapshot. Mark any nonimplemented features as proposed/future work rather than implemented. Do not silently replace the diagrams with newly invented ones.


---

# Screenshot and wireframe audit

No screenshots were captured, generated, edited, or inserted for this verification. The report Word file was not present, so its embedded screenshots and their exact chapter locations could not be inventoried.

## Available retained evidence

`verification-evidence/2026-11-18/` contains gitignored browser-smoke results and screenshots dated 18 November 2026, including public landing/apply/track screens, Officer/Admin pages, and multiple files explicitly named `*-stub.png` for certificate, tracking, and synthetic data scenarios. The repository's deployment log records 36 passed and 3 failed in that live browser smoke.

## Relevance to the current implementation

- These are dated evidence of the 18 November build/session, not proof of current local behavior.
- The Guardian account/application pipeline changed after those screenshots, with commits on 21 and 24 November. Older public apply/track screens therefore do not establish the current authenticated Guardian submission, read-only detail, staff queue, screening, or eligibility flow.
- Screenshots explicitly named `stub` are simulated UI states and must be labeled as such; do not present them as real API responses or live workflow evidence.
- Existing public tracking/apply imagery may remain useful for documenting the older public-facing flow, but it should not be labeled as the current Guardian portal without a current capture and verification.
- The screenshot directory is gitignored. Treat images and `results.json` as retained local evidence; they are not part of a clean commit-bound source record.

## Report author decisions

The user will handle wireframes. Keep existing approved title and abstract text unchanged until the current master report and author-approved wording are available. If screenshots are later refreshed, capture the local application and record date, build/commit plus dirty-tree state, route, actor/role, and whether backend data was real, synthetic, or stubbed. Do not state that a screenshot depicts Azure unless that session was actually against the live deployment.


---

# Instructions for Claude after verification

Use this verification package as a factual correction sheet. The repository's local source is authoritative for implementation claims; keep dated records and live deployment evidence separate. Do not ask the author to resolve items that this package already verifies.

## Report version and scope

1. Describe the inspected **local snapshot**: branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, plus explicitly identified uncommitted changes, reviewed 25 November 2026. Do not call this a clean, reproducible commit.
2. Treat `d229c62` as historical context only. It is an ancestor from 11 November, and its Guardian/workflow description predates later implementation. The alleged Word draft was not available for direct comparison; do not claim its exact contents were verified.
3. State that deployment completed earlier. Present dated Azure evidence as historical. Do not imply live parity with the local snapshot or describe deployment as outstanding.

## Required factual corrections

- Guardian registration, authenticated submission, and own-application viewing exist. Submitted applications are read-only. There is no Admin â€œMore Info Requiredâ€ status, selective field reopening, Guardian correction/resubmission route, or separate downloadable receipt in the inspected source. The application reference is shown as the submission acknowledgement.
- Current local serving artifact is HistGradientBoosting in a Pipeline under the legacy `xgb_duplicate_model.joblib` name. Do not describe it as XGBoost based on filename. Its score is an advisory review signal, not a final identity decision. Deployed model type/hash is unknown.
- Award beneficiary-verification constraint was dropped by migration. Preserve the distinction from unresolved duplicate-case gates, which still block eligibility/award progression. Describe both approval roles and separation of duties accurately.
- Use only the exact test run, date/snapshot, scope, and result supported by the evidence inventory. Do not repeat â€œ154/175â€; do not present historic â€œ175/175â€ as current. Broad duplicate-flags evidence is failing/incomplete. State that this audit reran nothing.
- The seven requested diagrams were unavailable. Mark them â€œawaiting original diagram filesâ€; do not infer corrections or fabricate replacements.
- November 18 screenshots are dated, some are stubs, and they predate later Guardian changes. Do not use them as evidence of the current authenticated Guardian pipeline. The author will handle wireframes. Do not change the approved title/abstract based on inference; retain pending the latest master/author-approved text.

## Evidence style

Name source paths, routes, functions, migration names, commit IDs, and dates. Use â€œimplemented,â€ â€œpartially implemented,â€ â€œnot implemented,â€ or â€œunverifiedâ€ precisely. Distinguish source inspection from runtime proof, synthetic metrics from real-beneficiary performance, historical deployment from local testing, and recorded test summaries from raw commit-bound logs.

This package resolves the implementation conflicts available from repository evidence. It does not authorize editing the academic report, application, model, database, live environment, screenshots, or diagrams.

