# EVIDENCE SOURCE INDEX

> Every file this evidence package cites, what claim it supports, and which deliverable cites it. Paths are relative
> to the repository root at HEAD `cca0625`. A file that is missing, untracked or stale is marked as such, because a
> citation to a missing file is weaker than no citation.

## 1. Backend source (runtime behaviour)

| File | Claim it supports | Cited by |
| --- | --- | --- |
| `backend/src/index.js` | middleware order; the four hand-rolled security headers (`:33-39`); CORS allowlist rejection; 100 kb body limit; `/api/health`, `/api/ready`, `/api/verify` mounting; 45 endpoints | Req. catalogue (NFR-10, NFR-12), Test catalogue (T-04–T-08), Azure §2, Ch.4 |
| `backend/src/config/settings.js` | thresholds 0.70 / 0.30 / 0.50 read from env with in-memory overrides | ML doc §3, G-34, Ch.4 |
| `backend/src/config/cors.js` | `getAllowedOrigins()` — the allowlist that produced the live 403 | Test catalogue T-08 |
| `backend/src/config/jwtSecret.js` | refuses to start without a secret | Req. catalogue NFR-07 |
| `backend/src/config/schools.js` | the five-school enum used by the CHECK constraint | Ch.4 (ER), Req. catalogue FR-03 |
| `backend/src/middleware/auth.js`, `requireRole.js` | JWT verification, role gates, 401 vs 403 behaviour | Test catalogue (auth, roleAuthorization), Azure §2 |
| `backend/src/middleware/errorHandler.js`, `loginRateLimit.js`, `verificationRateLimit.js`, `certificateRateLimit.js` | error shape, rate limits, 429 behaviour | Test catalogue; Req. catalogue NFR-06 |
| `backend/src/services/duplicateCheck.js` | batch scoring, `predict.py --server` child process, fail-closed 503, `@deprecated` legacy engine | ML doc §5–§6, G-35 |
| `backend/src/services/duplicateAggregation.js` | policies `top-1`, `top-1-corroborated`, `all`; default `top-1` | ML doc §3, Ch.4 |
| `backend/src/services/mlDuplicateReview.js` | score → review band → priority mapping | ML doc §3 |
| `backend/src/services/databaseReadiness.js` | the 12-table readiness set that fails closed | Azure §2, Ch.4 (12 tables), Req. catalogue NFR-02 |
| `backend/src/services/eligibility.js`, `bursaryRules.js` | five-factor 0–100 score; award amount rules | Req. catalogue FR-29, FR-20 |
| `backend/src/services/auditLog.js` | one audit row per state change, including threshold updates | Req. catalogue FR-27, G-34 |
| `backend/src/services/studentRecordFormat.js` | masking/format of returned records | Req. catalogue NFR-08 |
| `backend/src/controllers/*.js` (14 modules) | endpoint behaviour: students, duplicateFlags, bursaryAwards, disbursements, certificates, verification, reports, adminDashboard, settings, audit, auth, users, beneficiaries, eligibility | Req. catalogue FR tables; Test catalogue mapping |
| `backend/src/routes/*.js` (12 modules) | 41 router-level endpoint declarations (+4 inline = 45) | Ch.4 endpoint count |
| `backend/src/db/schema.sql` + `backend/src/db/migrations/` (14 forward, 1 rollback) | 12 tables, keys, CHECKs; `20261031_bursary_certificates.sql` creates the certificate tables | Ch.4 (ER), Azure §2 |
| `backend/tests/*.test.js` (24 suites) | 151 passing tests | Test catalogue T-01 |
| `backend/jest.config.js`, `backend/package.json` | test runner configuration; `test` script is `jest --runInBand` | Test catalogue T-01 |
| `backend/scripts/seed-kenyan-demo-data.js`, `reset-kenyan-demo-data.js`, `provision-test-database.js` | synthetic data and the guarded test database | Screenshot checklist §1 |

## 2. ML service and model artefacts

| File | Claim it supports | Cited by |
| --- | --- | --- |
| `ml-service/feature_engineering.py` | `FEATURE_COLUMNS` in order (jaro_winkler, dob_match, school_match, guardian_match, upi_match, birth_certificate_match) and `build_pair_features()` shared by training and serving | ML doc §2 |
| `ml-service/train_model.py` | XGBoost training, 250 trees, depth 4, learning rate 0.05 | ML doc §2 |
| `ml-service/predict.py` | `--server` mode, JSON protocol, batch scoring | ML doc §5 |
| `ml-service/model/xgb_duplicate_model.joblib` (tracked) | the production artefact; sha256 `6ec9f2a3…` | ML doc §2, G-27 |
| `ml-service/model/research/rf_attachment_style_candidate.joblib` (tracked) | a Random Forest used only in research — **not** the deployed model | ML doc §2, §7 |
| `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json` | precision 0.9204, recall 0.8927, F1 0.9063, ROC-AUC 0.9685, PR-AUC 0.9727 | ML doc §3–§4 |
| `ml-service/evaluation/fpr_baseline_2026-10-30.json` | 0.35 % false-positive rate at 0.50 on 2 000 negative pairs | ML doc §4 |
| `ml-service/evaluation/operating_point_2026-10-30.json` | the 0.50 operating point and its confusion counts | ML doc §4 |
| `ml-service/evaluation/REVIEWED_DATA_EVALUATION.md`, `reviewed_pairs_template.csv` | the reviewed-pairs procedure that has **not** been run with adjudicated labels | ML doc §4, G-18 |
| `ml-service/evaluation/training_integrity_report.json` | train/holdout separation checks | ML doc §4 |
| `ml-service/experiments/sbms_dataset/artifacts/feature_schema.json`, `selected_config.json` | the experiment-level feature schema and chosen configuration | ML doc §2 (research context only) |
| `ml-service/experiments/febrl_record_linkage/artifacts/metrics.json` | third-party FEBRL experiment — **research only**, never a system claim | ML doc §7 |
| `ml-service/tests/*.py` (33 tests) | passing ML suite | Test catalogue T-02 |
| `ml-service/requirements.txt` | pinned inference dependencies | Test catalogue T-02 |

## 3. Frontend

| File | Claim it supports | Cited by |
| --- | --- | --- |
| `frontend/src/App.jsx` | 17 `path=` route elements: `/login`, `/admin/login`, `/field-officer/login`, `/students`, `/students/register`, `/eligibility`, `/duplicate-review`, `/disbursements`, `/reports`, `/settings`, `/audit`, `/users`, `/field-officer`, `/dashboard`, `/verify`, `/verify-certificate`, `/` | Diagram spec §2, Screenshot checklist §2 |
| `frontend/package.json`, `frontend/vite.config.js` | Vite build configuration behind the 2 006-module build | Test catalogue T-03 |
| `npm run build` of `frontend/` (exit 0, 2 006 modules, 13.02 s, `index-DMsnyNls.js` 707 195 B / gzip 171.40 kB, `dist/index.html` 423 B) | that the frontend compiles cleanly at HEAD — **not** deployment lag (`VITE_API_ORIGIN` is inlined, so the hash is origin-dependent; only `index.html`'s byte length is comparable) | Test catalogue T-03, §2 note |

## 4. Operations, deployment and configuration

| File | Claim it supports | Cited by |
| --- | --- | --- |
| `.github/workflows/publish-api-image.yml` | `workflow_dispatch` only; build and push to GHCR; **no tests, no deploy step** | Azure §4, G-31 |
| `Dockerfile` (repository root) | Python virtualenv and `ml-service/` copied into the API image | Azure §3.1 |
| `render.yaml` | dead configuration; no Render service exists | Azure §4, G-32 |
| `.gitignore` | still ignores `ml-service/model/*.joblib`, yet two artefacts are tracked | G-27 |
| `docs/database-recovery-rehearsal-2026-10-31.md` | local restore rehearsal; not a hosted drill | Ch.5 §5.4.5, G-19 |

## 5. Documents: which may be cited and which may not

| Document | Status | Rule |
| --- | --- | --- |
| `docs/final-documentation-content/CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`, `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md`, `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` | chapter drafts | cite as the text under correction, never as evidence |
| `docs/final-documentation-content/DOCUMENTATION_GAP_REGISTER.md` | authoritative for G-01 … G-28 | cite for gap definitions |
| `docs/final-documentation-content/ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` | authoritative for C-1 … C-6 | cite for the cross-chapter conflicts |
| `docs/final-documentation-content/CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md` | consistency notes | cite only for the conflict list |
| `docs/FINAL_TEST_REPORT.md` | **two result generations** (21/128 and 24/151) | cite the dated 24/151 lines only (G-25) |
| `docs/uat-test-plan.md` | no participants, stale predictor sentence | **do not cite** as UAT evidence (G-24, AD-4) |
| `docs/verification.md` | false statement that no controller calls the predictor | **do not cite** (G-23, AD-4) |
| `SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` | untracked (`??`) | cite only if committed (G-28) |
| `academic-report-evidence/` | untracked in this working copy | commit or archive (G-30, AD-5) |

## 6. This package's own files

| File | Purpose |
| --- | --- |
| `CURRENT_REPOSITORY_STATE.md` | commit, branch, test totals, migrations, environment facts |
| `AZURE_DEPLOYMENT_VERIFICATION.md` | resource inventory, endpoints, configuration, workflow, deployment lag |
| `PRODUCTION_ML_MODEL_VERIFICATION.md` | classifier, features, artefact hash, metrics, thresholds, fail-closed behaviour |
| `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` | 37 FR + 24 NFR with re-derived statuses |
| `SBMS_TEST_EVIDENCE_CATALOGUE.md` | T-01 … T-08 with commands and results |
| `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` | objectives (i)–(iv) → requirements → tests |
| `SBMS_DIAGRAM_SPECIFICATIONS.md` | Figures 4.1–4.24, content and redraw verdicts |
| `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` | S-01 … S-30 capture list and caption rules |
| `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md` | G-01 … G-36, E-01 … E-03, AD-1 … AD-6 |
| `CHAPTER_4_FINAL_EVIDENCE_PACKAGE.md` | section-by-section verdicts for Chapter 4 |
| `CHAPTER_5_FINAL_EVIDENCE_PACKAGE.md` | section-by-section verdicts for Chapter 5 |
| `CHAPTER_6_FINAL_EVIDENCE_PACKAGE.md` | objective verdicts, quality claims, recommendations, future work |
| `EVIDENCE_SOURCE_INDEX.md` | this file — every citation, with its strength |


