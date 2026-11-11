# CHAPTER 5 FINAL EVIDENCE PACKAGE

> Evidence for `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md`, revalidated 2026-11-03 at HEAD `cca0625`.
> Section numbering follows the existing draft. Where the draft's numbers no longer hold, the correction is stated.

## 1. Section-by-section evidence

| Section | What it may assert | Evidence produced in this pass | Verdict / correction |
| --- | --- | --- | --- |
| 5.2.1 Hardware | development and test machine | host facts recorded in `CURRENT_REPOSITORY_STATE.md` | OK |
| 5.2.2 Software and versions | Node/Express, React/Vite, Python/XGBoost, PostgreSQL 16 | `backend/package.json`, `frontend/package.json`, `ml-service/requirements.txt`, live server version 16 | OK |
| 5.2.3 Tooling | git, jest, `node --test`, `unittest`, vite, az CLI | commands in `SBMS_TEST_EVIDENCE_CATALOGUE.md` §1 | OK |
| 5.2.4 Deployment environment | Azure Container App + App Service F1 + PostgreSQL Flexible B1ms, images from GHCR | `AZURE_DEPLOYMENT_VERIFICATION.md` §1–§4 | **CORRECTION**: drop Render; add that the workflow is manual `workflow_dispatch` and does not deploy |
| 5.3.1 Code organisation | 14 controllers, 12 routers, 10 services, 8 middleware, 14 pages | directory counts | OK |
| 5.3.2 Auth and access control | bcrypt 12, JWT 8 h, DB-role checks, rate limits, hardened headers | `auth.controller.js`, `middleware/*`, `index.js:33-47` | OK (headers are hand-rolled; no CSP) |
| 5.3.3 Student management | registration, five schools, QR token, identifiers incl. UPI/birth certificate/national ID | `students.controller.js`; `730a62e`, `9fc14df` | OK — but **screenshots of the current form must be retaken**; the form gained fields after `d6b5032` |
| 5.3.4 ML-assisted duplicate detection | six features, XGBoost, batching, advisory flags | `PRODUCTION_ML_MODEL_VERIFICATION.md` | **CORRECTION**: XGBoost (not Random Forest); six features |
| 5.3.5 Review and resolution | masked queue, audited reveal, reason-mandatory decisions, case history | `duplicateFlags.controller.js`; `duplicateFlags.test.js` (9) | OK |
| 5.3.6 Eligibility | five weighted factors, four categories | `services/eligibility.js`; `bursaryRules.test.js` (4) | OK |
| 5.3.7 Awards, payments, reconciliation | verification gate, duplicate gate, `discrepancy` class | `bursaryAwards.controller.js:169-188`; `workflow.test.js` (11) | OK |
| 5.3.8 QR verification | 32-byte token, `found` only, rate limited | `verification.test.js` (10), `verificationRoute.test.js` (4); live 200 | OK |
| 5.3.9 Certificates | issue/PDF/public verify by QR or printed reference, `not_current`; no revocation | `bursaryCertificates.test.js` (14), `certificateVerificationRoute.test.js` (5) | **CORRECTION**: present at HEAD, **absent from the deployed image** (`a3714f8`); live probe 404 |
| 5.3.10 Dashboard, reporting, audit | totals, trend, PDF export, audit log | `adminDashboard.controller.js`, `reports.controller.js` | OK |
| 5.3.11 Start-up guards and migrations | readiness fails closed, 14 forward migrations | `databaseReadiness.js`; live `/api/ready` 200 | OK |
| 5.3.12 Deployment | image built from a commit SHA, deployed to Azure | `publish-api-image.yml`; live inventory | **CORRECTION**: the running image is `a3714f8`, 9 commits behind HEAD |

## 2. System testing (5.4) — numbers to use

| Item | Value to report | Where it came from |
| --- | --- | --- |
| Backend suites / tests | **24 suites, 151 tests — all 151 passing** (monolithic attempts: 150/151, the single failure being the Python sidecar; grouped runs: 80/80 and 70/71, the one failure passing alone) | `npx jest --runInBand tests`, 2026-11-03; ledger in `SBMS_TEST_EVIDENCE_CATALOGUE.md` §1.1 |
| Backend execution mode | `jest --runInBand`, real Postgres, guarded test database | `jest.config.js`, `tests/testDatabaseGuard.js` |
| ML tests | **5 files, 33 tests, all passing** | `ml-service/.venv` `unittest discover -p "test_*.py"`, 2.4 s |
| Frontend tests | **0** | no `*.test.*` under `frontend/src` |
| Additional `node --test` files | 8 present, 1 runnable via `npm run test:smoke` | `backend/test/` |
| Build verification | `vite build` exit 0, 2 006 modules, 13.02 s, `index-DMsnyNls.js` 707 195 B (hash not comparable to the deployment; `dist/index.html` is, and it is 423 B in both) | 2026-11-03 |
| Performance test | 50 pairs < 3 000 ms asserted and passing | `performance.test.js` |
| Browser/UI testing | none automated; screenshots only | see checklist |
| UAT | **none** — no participants, no consent, no notes | `docs/uat-test-plan.md` is a plan |

If the draft quotes a different backend total, the **151 measured here at `cca0625`** is the number to report, with
the commit and date stated beside it. Earlier figures in `docs/` were recorded on earlier dates and against earlier
commits; they are not wrong, they are stale (gap C-5 in `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md`).

## 3. Evaluation (5.5)

| Sub-section | What can be concluded from evidence | What cannot |
| --- | --- | --- |
| 5.5.1 approach | four outcomes per objective (demonstrated / partially / not / not evaluable) is defensible | — |
| 5.5.2 objectives | (i) P, (ii) P with declared deviation, (iii) V with deployment caveat, (iv) P | objective (i) cannot claim fieldwork; (iv) cannot claim real-data accuracy or usability |
| 5.5.3 functional requirements | 24 verified / 8 partial / 5 not implemented of 37 | the 5 not-implemented items must be named, not aggregated away |
| 5.5.4 non-functional requirements | 15 verified / 5 partial / 4 not tested of 24 | NFR-14, NFR-19, NFR-22 and NFR-23 have no evidence at all |
| 5.5.5 ML evaluation | precision 0.9204, recall 0.8927, F1 0.9063, ROC-AUC 0.9685, PR-AUC 0.9727 at 0.50 on a synthetic balanced holdout; FPR 0.35 % on 2 000 unrelated pairs; prevalence-adjusted precision 0.105 / 0.378 / 0.562 at 1 / 5 / 10 % | no real labels; holdout used for model selection; the cut-off is provisional and the system says so |
| 5.5.6 usability / UAT | nothing | must be written as "not conducted", with the reason (G-06) |

## 4. Discussion and limitations (5.6)

| Limitation to state | Concrete evidence |
| --- | --- |
| Screening cost is quadratic; registrations serialise | full-registry `SELECT … FOR UPDATE` + `pg_advisory_xact_lock` per registration |
| Duplicate detection is single-registry | no cross-registry identity resolution exists |
| The score is uncalibrated and the cut-off unvalidated | API returns `thresholds_validated: false`, `score_is_calibrated_probability: false` |
| Predictor failure blocks registration | `DUPLICATE_PREDICTOR_FAILED` → **503** `DUPLICATE_SCREENING_UNAVAILABLE`, transaction rolled back (`students.controller.js:76-82`) |
| Free-tier hosting | App Service F1, Container App `minReplicas 0`, PostgreSQL B1ms, no geo-redundant backup |
| No deployment automation | `workflow_dispatch` builds an image only; the Container App is repointed by hand |
| Deployment lags HEAD | image `a3714f8` vs HEAD `cca0625`; certificate route 404 live |
| The test host is memory-limited | 7.4 GB RAM; the Python sidecar needs ~1 GB of headroom to import pandas/XGBoost and load a 421 kB joblib artefact. At 0.55 GB free one predictor-dependent test failed to start the process, at 0.79 GB free the same test passed. Report the run ledger, not a single Jest summary line |
| Frontend untested | 0 automated tests |
| Research artefacts are not production | `model/research/*` and `ml-service/experiments/*` excluded from every claim |

## 5. Screenshots and figures for Chapter 5

Use `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md`. Two rules that follow from this pass:

1. **Certificate screenshots (S-13 … S-16) cannot be captured from the live deployment** — the route returns 404
   there. Capture them from a local run of HEAD and caption them "local build, HEAD `cca0625`", or refresh the
   deployment first.
2. **Registration-form screenshots must be retaken**, because the form gained UPI, birth-certificate and national-ID
   fields after the earlier documentation was captured.

## 6. Corrections the chapter needs

1. Classifier name and feature count (XGBoost / six features).
2. Backend test total and the commit it was measured at.
3. Certificate feature: implemented and tested, **not deployed**.
4. Render removed from the deployment narrative; `render.yaml` described as dead configuration.
5. ML service described as an in-container Python child process, not a microservice.
6. Any UAT sentence reclassified as "not conducted" rather than "passed".

## 7. Gap references

| ID | Relevance to Chapter 5 |
| --- | --- |
| G-01 | §5.2.1 needs the real workstation specification |
| G-05, G-13 | Screenshots and quoted identifiers must be synthetic; the `E2E Probe` records should be removed |
| G-06 | §5.5.6 must say no UAT was conducted |
| G-16 | NFR-14/NFR-19 unverified beyond Chrome |
| G-19 | Recovery evidence is a local rehearsal only |
| G-24 | `docs/uat-test-plan.md` cannot be cited as UAT evidence |
| G-26 | §5.6 must name the checkout used |
| G-28 | Two root reports cited are untracked |
| C-5 | The two test totals in `docs/FINAL_TEST_REPORT.md` are dated, not contradictory |

