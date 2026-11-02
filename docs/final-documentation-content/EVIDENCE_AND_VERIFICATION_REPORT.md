# EVIDENCE AND VERIFICATION REPORT

**Purpose.** This report identifies the files, code locations, tests, configurations and project documents that support
each significant claim in Chapters 4, 5 and 6, and states what was verified by direct inspection during this
documentation pass, what was taken from recorded evidence, and what could not be verified at all.

**Method.** Read-only inspection. No application source file, schema, migration, configuration, environment variable or
test was modified, no migration was applied, nothing was deployed, and no test suite was re-executed. The only files
written are the six documents in this folder.

---

## 1. Identity of what was inspected

| Item | Value |
| --- | --- |
| Repository | `C:\Users\user\Desktop\Projects\student-beneficiary-system` |
| Branch | `fix/sbms-completion-work` |
| Commit | `d6b5032` (`chore(repo): drop generated logs, report PDFs and three superseded docs`) |
| Parent commits of interest | `f3686ec` (certificate feature), `621f23f` (state reviewed by the O10/O11 work) |
| Working-tree state at inspection | Clean apart from two untracked root reports (`SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md`) |
| Other copies of the project on disk | `student-beneficiary-system-dev` (`dev`), `-admin-login-fix`, `sbms-raw-pair-model-training` — **not** used as evidence, because their documents differ |
| Academic sources consulted | `ICS Project II Proposal Guide 2026_V1.docx` (School template), `Project Proposal- 169613.pdf` (approved SBMS proposal, 34 pages), `CHAPTER_4[1].docx` (Chapter 4 exemplar, used for section numbering) |

---

## 2. Code evidence index

| Claim | Evidence |
| --- | --- |
| Public registration disabled; two role-specific sign-in routes | `backend/src/routes/auth.routes.js:9-14` |
| bcrypt cost 12; JWT 8 hours; wrong role refused | `backend/src/controllers/auth.controller.js:26, 37-74` |
| Role re-read from the database; account must be active | `backend/src/middleware/auth.js:18-25` |
| Role gate answers 403 | `backend/src/middleware/requireRole.js:1-17` |
| `/api/students` field-officer-only, by design and by test | `backend/src/routes/students.routes.js:8`; `backend/tests/roleAuthorization.test.js` |
| Registration validates eight fields, resolves policy before the transaction, takes an advisory lock, screens all candidates, returns without the token | `backend/src/controllers/students.controller.js:15-161` |
| Five approved schools | `backend/src/config/schools.js`; `students_school_supported_check` in `backend/src/db/schema.sql:43-45` |
| Screening batches at 200, validates count/range/version, raises a typed error on failure | `backend/src/services/mlDuplicateReview.js:4, 84-117` |
| Predictor is a child process with a 30 s timeout and fail-closed handling | `backend/src/services/duplicateCheck.js:241-301` |
| Aggregation `top-1` default, corroboration rules, audit counters | `backend/src/services/duplicateAggregation.js:36-144` |
| Priority shared by registration and queue | `backend/src/services/mlDuplicateReview.js:50-59` |
| Identifier masking and audited reveal | `backend/src/controllers/duplicateFlags.controller.js:37-42, 434-446` |
| Terminal review decision with reason, event and audit rows | `backend/src/controllers/duplicateFlags.controller.js:452-503` |
| Approval gate on verification and duplicates (both sides of a pair) | `backend/src/controllers/bursaryAwards.controller.js:173-189` |
| Payment gate, balance ceiling, `issued` state | `backend/src/controllers/disbursements.controller.js:65-215` |
| Payment transition legality and discrepancy arithmetic | `backend/src/services/bursaryRules.js:1-52` |
| Eligibility scoring rules | `backend/src/services/eligibility.js:1-102`; `docs/eligibility-rules.md` |
| QR token generation, fragment URL, stripping from responses | `backend/src/controllers/students.controller.js:58-60`; `backend/src/config/publicAppUrl.js:164-177`; `backend/src/models/student.model.js:3-7` |
| Public verification returns only `{found}`; malformed and unknown indistinguishable | `backend/src/controllers/verification.controller.js:1-24` |
| Certificate snapshot, four verification states, revocation constraints | `backend/src/controllers/certificates.controller.js:53-89, 95-270`; `backend/src/models/bursaryCertificate.model.js`; migration `20261031_bursary_certificates.sql` |
| Separate rate-limit budgets and shared counter implementation | `backend/src/middleware/rateLimitWindow.js`; `verificationRateLimit.js`; `certificateRateLimit.js`; `loginRateLimit.js` |
| Security headers, CORS allowlist, body limit, single registration of `/api/verify` | `backend/src/index.js:33-67` |
| Sanitised error responses | `backend/src/middleware/errorHandler.js:59-78` |
| Readiness contract and fail-closed start-up | `backend/src/index.js:73-125`; `backend/src/services/databaseReadiness.js`; `backend/src/services/databaseStartup.js` |
| Schema: eight baseline tables plus migration tables, constraints and indexes | `backend/src/db/schema.sql`; fourteen files in `backend/src/db/migrations/` |
| Frontend routes, role-protected layout, public pages | `frontend/src/App.jsx`; `frontend/src/components/AppLayout.jsx`; `frontend/src/pages/Verification.jsx`; `frontend/src/pages/CertificateVerification.jsx` |
| Officer-facing screening sentence without model internals | `frontend/src/pages/StudentRegistration.jsx:7-22, 65-75` |
| Six-feature contract and derivation | `ml-service/feature_engineering.py:11-117` |
| Artefact loading, version hashing, `predict_pairs` | `ml-service/predict.py:14-98` |
| Container build, inference gate, no CUDA, no secrets | `Dockerfile:1-48` |
| Image publication gates | `.github/workflows/publish-api-image.yml` |
| Deployment topology (Render equivalent, documented for reference) | `render.yaml` |

---

## 3. Test artefact index

| Artefact | Location | Evidence it provides | Reliability note |
| --- | --- | --- | --- |
| 24 Jest suites, 151 tests | `backend/tests/*.test.js` (inventory in Chapter 5 Table 5.9) | Behaviour through the real HTTP surface against PostgreSQL | Counts recorded 2026-11-01; the suites were read during this pass to confirm the described assertions exist |
| Database guard | `backend/tests/testDatabaseGuard.js` | Fails closed unless the target is the loopback `sbms_test` database | Read directly |
| Native test files | `backend/test/databaseReadiness.node.js`, `databaseStartup.node.test.js`, `databaseBootstrap.node.test.js`, `errorHandler.unit.test.js`, `verification.unit.test.js`, `migrate.unit.test.js`, `jwtSecret.validation.node.cjs` | 43 in-process tests | Read directly; result recorded 2026-10-31 |
| Out-of-process smoke | `backend/test/api.smoke.test.js` | 3 checks against a running API | Read directly |
| ML service tests | `ml-service/tests/*.py` (6 files) | 33 tests: features, operating point, artefact loading, training integrity, reliability | Read directly; result recorded 2026-10-31 |
| Research helper tests | `ml-service/experiments/sbms_dataset/test_experiment.py` | 7 tests | Recorded |
| Browser harnesses | `scripts/browser-smoke.mjs`, `qr-smoke.mjs`, `registration-fields-smoke.mjs`, `admin-reveal-smoke.mjs` | 23, 9, 11 and (unrun) reveal checks | Harnesses read; results taken from project records |
| Training and evaluation metrics | `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json` | Hyperparameters, holdout metrics, confusion matrix, generated scenarios, limitations | Read directly; every figure in Chapter 5 §5.5.5 comes from this file |
| Operating-point evidence | `ml-service/evaluation/operating_point_2026-10-30.json` | Threshold table, negative-family rates, masking, blocking projections | Summarised in `docs/ml-decision-sheet-2026-10-30.md`, which was read |
| False-positive baseline | `ml-service/evaluation/fpr_baseline_2026-10-30.json`; `docs/ml-evaluation-baseline-2026-10.md` | 0.35% of 2 000 random unrelated pairs above 0.50 | Read through the decision sheet |
| Training integrity | `ml-service/evaluation/training_integrity_report.json`; `ml-service/check_training_integrity.py` | Group holdout, no memorisation, no single-feature label determination | Read via tests and reports |
| Research-only artefacts | `ml-service/model/research/rf_attachment_style_candidate.joblib`; `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` | Kept separate from production; metrics in `ML_RELIABILITY_REPORT.md` and `reports/sbms_dataset_experiment.md` | Read directly; **not** attributed to the deployed system |
| Production artefact | `ml-service/model/xgb_duplicate_model.joblib` | 421 089 bytes, SHA-256 `6ec9f2a3…` | Presence, size and tracked status verified with `git ls-files` and a file check |

---

## 4. Document evidence index

| Document | Used for | Reliability assessment |
| --- | --- | --- |
| `docs/FINAL_TEST_REPORT.md` | Test counts, environment, database state, outstanding tests | **Current**, but contains two generations of result; §10 supersedes §1–§3 |
| `docs/business-workflow-verification-2026-10-30.md` | Workflow chain, the payment-clearance defect, behaviour observations | Current and specific |
| `docs/frontend-verification-2026-10-30.md` | 23 browser checks, the priority/`risk_level` defects | Current |
| `docs/qr-verification-2026-10-30.md` | QR design, 10 API + 9 browser checks, the camera blocker, residual gaps | Current |
| `docs/bursary-certificates-2026-11-01.md` | Certificate design, endpoint roles, automated coverage, unverified items | Current |
| `docs/azure-deployment-log-2026-10-31.md` | Deployment identity, resource configuration, live checks, the production QR defect, carry-forward items | Current; §7–§9 record unfinished operator tasks |
| `docs/ml-decision-sheet-2026-10-30.md` | Operating point, negative families, masking, blocking, D1–D5 | Current; explicitly labels all labels synthetic |
| `docs/ml-evaluation-policy.md` | The five unanswered decisions and where each lands in code | Current |
| `docs/ml-evaluation-baseline-2026-10.md` | 0.35% false-positive baseline and queue arithmetic | Current |
| `docs/ml-integration-and-school-identifiers.md` | School identifier problem; model interface | Current |
| `docs/ml_audit.md` | The supplied external dataset and the ten-column research model | Current |
| `ml-service/ML_RELIABILITY_REPORT.md` | Random Forest candidate metrics; the `raw_pairs.csv` label shortcut | Current, and the basis for excluding that dataset from training |
| `ml-service/reports/sbms_dataset_experiment.md` | Research-only experiment metrics | Current; describes a model the system does not load |
| `docs/SBMS_PROJECT_HANDOVER_2026-10.md` | Status matrix, defect history, phase plans | Current as a record; §12+ supersedes its earlier sections |
| `SBMS_O10_O11_IMPLEMENTATION_REPORT.md` (untracked) | The `/api/students` policy decision and the `/api/verify` double-registration fix | Reliable but **untracked**; gap G-28 |
| `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` (untracked) | Confirmation that the SBMS-01…18 wording is unrecoverable | Reliable but **untracked**; gap G-28 |
| `docs/verification.md` | **Superseded claims** about the predictor | Do **not** cite; gap G-08/G-23 |
| `docs/uat-test-plan.md` | Five `PASS` results without participants | Do **not** present as acceptance evidence; gap G-24 |
| `docs/database-recovery-rehearsal-2026-10-31.md` | Restore rehearsal procedure and result | Current |
| `docs/eligibility-rules.md` | Scoring factors and categories | Current; agrees with `services/eligibility.js` |

---

## 5. Verification status of the chapters' major claims

| Claim in the chapters | Status | How it was established |
| --- | --- | --- |
| The production classifier is XGBoost over six features, artefact `6ec9f2a3…` | **VERIFIED** | `predict.py`, `feature_engineering.py`, metrics JSON, artefact size and hash |
| Training used 12 000 pairs with a grouped 80/20 split and an independent 12 000-pair holdout | **VERIFIED** | `realistic_pairs_xgboost_training_metrics.json` |
| Holdout metrics: accuracy 0.9078, precision 0.9204, recall 0.8927, F1 0.9063, PR-AUC 0.9727, ROC-AUC 0.9685, CM 5 356/463/5 537/644 | **VERIFIED** | Same JSON file |
| The live cut-off is 0.50 and is unvalidated | **VERIFIED** | `config/settings.js:8`; `thresholds_validated: false` in the queue response; `docs/ml-evaluation-policy.md` |
| Registration compares against the whole registry | **VERIFIED** | `students.controller.js:69-73` (no filter); decision sheet §6 |
| At most one flag per registration by default | **VERIFIED** | `duplicateAggregation.js:36-39, 86-117` |
| A duplicate blocks approval and payment, on either side of the pair | **VERIFIED** | Controller SQL; `workflow.test.js` checks 3–5 |
| Payments are recorded as issued, cleared separately with evidence | **VERIFIED** | `disbursements.controller.js`; `bursaryRules.js`; database `CHECK` constraints |
| Receipt acknowledgement is officer-assisted | **VERIFIED** | `acknowledgement_method = 'officer_assisted'` required by constraint |
| Student QR and certificate QR are separate namespaces, endpoints, budgets and pages | **VERIFIED** | `index.js:65-66`; controllers; two page components; two rate limiters |
| No beneficiary data appears in any public response | **VERIFIED** | `verification.controller.js`; `publicView()`; tests |
| 24 suites / 151 tests passed on 2026-11-01 | **RECORDED** (not re-run) | `docs/FINAL_TEST_REPORT.md` §10; `docs/bursary-certificates-2026-11-01.md` §7 |
| 43/43 native, 3/3 smoke, 33/33 and 7/7 Python | **RECORDED** (not re-run) | `docs/FINAL_TEST_REPORT.md` §2, §4 |
| 23/23, 9/9 and 11/11 browser checks | **RECORDED** (not re-run) | Frontend, QR and deployment records |
| The system is deployed at the stated Azure endpoints | **RECORDED** | `docs/azure-deployment-log-2026-10-31.md` §1; not independently probed in this pass |
| Nine defects were found and fixed during testing | **VERIFIED as records** | Each defect is documented with its root cause |
| The `/api/students` restriction is intentional, not a defect | **VERIFIED** | Code, frontend call sites, regression test, O10/O11 report |
| The Random Forest is not in production | **VERIFIED** | `predict.py` loads only `xgb_duplicate_model.joblib` |
| Real-world detection performance is unknown | **VERIFIED as unknown** | No adjudicated labels in the repository or either database |
| A phone can scan a printed QR code | **NOT VERIFIED** | No camera run recorded; gap G-11 |
| 500+ students can be screened within three seconds | **NOT VERIFIED** | No load test; gap G-12 |
| Users find the system usable | **NOT VERIFIED** | No user study; gap G-06 |

---

## 6. What was checked during this pass, and what was not

**Checked directly:**

1. Every code location cited in the chapters was opened and the cited behaviour confirmed.
2. The suite inventory was regenerated by counting `test(`/`it(` occurrences per file: 24 files, 151 tests, matching the
   recorded total.
3. Test *names* for the fourteen most relevant suites were extracted and used to write Chapter 5 Table 5.9, so the table
   describes assertions that exist rather than assertions that were imagined.
4. The training metrics JSON was parsed field by field; every number in Chapter 5 §5.5.5 traces to it.
5. The artefact's size, presence and tracked status were verified (`git ls-files` reports it as tracked although
   `.gitignore` lists the pattern — gap G-27).
6. `git status` and `git log` fixed the revision under description and recorded the two untracked reports.
7. The proposal PDF was extracted and read for objectives, scope, methodology and the four-feature Random Forest
   specification, so the deviation in Chapter 4 §4.1 is documented rather than assumed.

**Not performed:**

1. No test suite was executed, in any language.
2. No database query, migration, backup or restore was run.
3. No deployment, restart or configuration change was made.
4. No screenshot was captured and no figure was drawn.
5. No network call was made to the deployed endpoints; their status is taken from the deployment record.
6. No interview, survey or acceptance session was conducted.

---

## 7. How to re-verify the main claims

Commands are given as the project records them; they were **not** run in this pass.

```powershell
# 1. Fix the revision under description
git rev-parse HEAD            # expect d6b5032
git status --short            # expect only the two untracked root reports

# 2. Backend suite (needs backend/.env.test with NODE_ENV, DATABASE_URL,
#    SBMS_TEST_DATABASE_URL, and PUBLIC_APP_URL set to an https origin)
cd backend
npx jest --runInBand tests    # expect 24 suites / 151 tests

# 3. Native and smoke tests
node --test backend/test/databaseReadiness.node.js backend/test/databaseStartup.node.test.js backend/test/databaseBootstrap.node.test.js backend/test/errorHandler.unit.test.js backend/test/verification.unit.test.js backend/test/migrate.unit.test.js backend/test/jwtSecret.validation.node.cjs
# expect 43/43

# 4. Frontend build
npm.cmd --prefix frontend run build     # expect exit 0

# 5. ML tests and evaluation
ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/tests -v      # expect 33
ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service/experiments/sbms_dataset -p test_experiment.py
cd ml-service; .\.venv\Scripts\python.exe .\evaluate_operating_point.py              # regenerates the operating-point JSON

# 6. Artefact identity
Get-FileHash ml-service\model\xgb_duplicate_model.joblib -Algorithm SHA256
# expect 6EC9F2A3CBE6ED0DCF80C79B15F47364D9F4F7BD3E27DA25C690D0436BB0A6F9
```

Note on disambiguation: `backend/tests/` (plural) holds the Jest suites and `backend/test/` (singular, except for the
Jest-named files) holds the native files. Running the native command from the repository root rather than from
`backend/` changes the relative paths and will fail for that reason alone.

---

## 8. Residual risks to the report's accuracy

| Risk | Consequence | Mitigation already applied in the chapters |
| --- | --- | --- |
| Recorded test counts may not reproduce on a different machine | A reader re-running the suite could see 149–150/151 | Chapter 5 §5.4.3 states the instability, its mechanism and the isolation results (gap G-20) |
| Project records may be superseded after this pass | A citation could point at a stale statement | Every citation names a dated document, and the two known-stale documents are named as stale |
| The deployment identity may change (resources stopped or deleted) | "Deployed" claims could become untrue | The chapters describe the deployment as demonstrated on a stated date and note the stopped-database availability model |
| Figures may be drawn in a way that contradicts the specifications | Visual content would misstate the system | Each figure carries an explicit content specification, including what must **not** appear |
| A reader may treat synthetic metrics as accuracy | Over-claiming detection capability | Every metric is labelled synthetic, and Chapter 5 §5.5.5 lists what it does not establish |
| Chapters 1–3 may describe features that the implementation does not have | Cross-chapter contradiction | The known conflicts are recorded here and in the gap register; Chapters 1–3 were not edited, as that is outside this task |

---

## 9. Cross-chapter consistency checks performed

| Check | Result |
| --- | --- |
| Problem in Chapter One matches the solution in Chapters Four and Five | Consistent: within-registry duplicate detection plus an evidence-bearing payment chain; the cross-constituency limitation is stated in Chapter Five §5.6.2 |
| Objectives in Chapter One are addressed in Four, Five and Six | Consistent: each of the four objectives appears in Chapter Four §4.2, is evaluated in Chapter Five §5.5.2 and concluded in Chapter Six §6.2.3–§6.2.6 |
| Chapter Three methodology agrees with the implementation and evaluation | Consistent with DSR plus Agile as described in the proposal §3.2–§3.3; the classifier differs (gap G-21) and the deployment architecture differs (gap G-22), both recorded |
| Requirements in Chapter Four agree with the implemented system | Consistent: each FR cites a route, service or table; unsatisfied items are marked in Table 4.1 |
| Diagrams agree with the architecture and workflows | The figure specifications are derived from controller and page code; drawing them remains the author's task (gap G-03) |
| Implementation in Chapter Five agrees with the design in Chapter Four | Consistent: Table 5.3 maps each Chapter Four module to its implementation and test |
| Testing and evaluation support the conclusions in Chapter Six | Consistent: the conclusion table in `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §5 cites the supporting section for each conclusion |
| Module, role and entity names are used consistently | Consistent: `admin`, `field_officer`, `students`, `duplicate_flags`, `duplicate_review_events`, `bursary_awards`, `bursary_award_verification_events`, `disbursements`, `disbursement_reconciliation_events`, `bursary_certificates`, `audit_logs`, `reports` |

---

## 10. Summary of the evidence position

The chapters report a system whose code, schema, tests and deployment records are internally consistent and
independently checkable for their implementation claims, and whose quantitative claims fall into three groups:
(a) implementation facts, which were verified by reading the code; (b) test results, which are recorded with dates and
commands but were not re-executed in this pass; and (c) model metrics, which were read directly from the artefact's own
report and are explicitly properties of a synthetic generator. The claims that cannot be supported — real-world
detection accuracy, physical QR scanning, scale performance, and user acceptance — are named as unsupported rather
than inferred, and each is assigned a gap-register item with a route to closure.
