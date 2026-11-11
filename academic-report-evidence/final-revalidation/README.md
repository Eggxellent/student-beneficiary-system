# SBMS FINAL REVALIDATION EVIDENCE PACKAGE

**Audited commit:** `cca0625` (branch `fix/sbms-completion-work`)
**Deployed commit:** `a3714f8` — the Container App image is nine commits behind the audited commit
**Revalidated:** 2026-11-03 in two independent passes (01:20–01:30 and 09:45–10:10 +03:00), read-only: no application code, migration, test or CI file was modified

> The single most important sentence in this package: **test evidence is not deployment evidence.** Everything was
> measured at `cca0625`; the running system serves an older image, so the certificate feature (FR-22–FR-24), which is
> implemented and covered by 17 tests at HEAD, returns `404` in production.

## Read in this order

| # | File | What it answers |
| --- | --- | --- |
| 1 | `CURRENT_REPOSITORY_STATE.md` | what the repository contains at `cca0625` |
| 2 | `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` | 37 FR + 24 NFR and their re-derived statuses |
| 3 | `SBMS_TEST_EVIDENCE_CATALOGUE.md` | every test and probe executed, with commands and results |
| 4 | `PRODUCTION_ML_MODEL_VERIFICATION.md` | the classifier, its six features, its metrics and its limits |
| 5 | `AZURE_DEPLOYMENT_VERIFICATION.md` | the deployed resources, endpoints and the nine-commit lag |
| 6 | `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` | objectives (i)–(iv) traced to tests |
| 7 | `SBMS_DIAGRAM_SPECIFICATIONS.md` · `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` | what each figure must show; how to capture it |
| 8 | `CHAPTER_4_FINAL_EVIDENCE_PACKAGE.md` · `CHAPTER_5_FINAL_EVIDENCE_PACKAGE.md` · `CHAPTER_6_FINAL_EVIDENCE_PACKAGE.md` | section-by-section verdicts and the wording to use |
| 9 | `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md` | G-01 … G-36, E-01 … E-03, AD-1 … AD-6 |
| 10 | `EVIDENCE_SOURCE_INDEX.md` · `CLAUDE_FINAL_HANDOFF_GUIDE.md` | every citation; how to continue safely |

## The numbers

| Item | Value | Where |
| --- | --- | --- |
| Requirements verified | 24 / 37 FR · 15 / 24 NFR | requirements catalogue §3 |
| Backend tests | 24 suites · 151 tests · **all 151 passing** (monolithic attempts 150/151 at 111.5 s; the one failure passes alone — see T-01 and G-02) | test catalogue T-01 |
| ML tests | 33 · OK · 2.4 s | test catalogue T-02 |
| Frontend build | 2 006 modules · 13.0 s · `index-DMsnyNls.js` 707.15 kB (gzip 171.40 kB) | test catalogue T-03 |
| Tables · endpoints | 12 · 45 | Ch.4 §4 |
| Classifier | XGBoost · six features · `xgboost:6ec9f2a3…` · cut-off 0.50 (provisional) | ML doc §2–§3 |
| Metrics | precision 0.9204 · recall 0.8927 · F1 0.9063 · ROC-AUC 0.9685 · PR-AUC 0.9727 | ML doc §4 |

## What is not established

1. **Certificates are not deployed** (G-29). The live API runs `a3714f8`, 9 commits behind HEAD `cca0625`, so
   `POST /api/certificates/verify` answers 404. Do not compare SPA bundle hashes — the build inlines
   `VITE_API_ORIGIN`, so the hash changes with the environment, not only the commit.
2. **No user acceptance study** (G-06). No participants, no tasks, no findings.
3. **No adjudicated labels** (G-18). Every quality figure is on synthetic data; at 1 % prevalence the precision falls
   from 0.9204 to 0.105.
4. **No load or concurrency test** beyond 50 candidate pairs (G-12) and no hosted recovery drill (G-19).
5. **Random Forest was specified, XGBoost was delivered** (G-21) — a declared deviation, not a silent substitution.
6. **No phone-camera scanning** (G-11); tokens are typed or opened by link.
7. **The test workstation is memory-constrained** (7.4 GB RAM, 0.55–0.79 GB free during this pass). Two
   predictor-dependent tests — `mlPredictor.integration.test.js` and `performance.test.js` — failed with
   `Python predictor process exited` / `Production XGBoost model artifact could not be loaded` when the Python child
   process was started while the host was under pressure. Each of them passes when run alone, and all 151 tests pass
   across the two grouped runs. This is a host limitation (G-02), not an assertion failure: no test expectation has
   ever been observed to fail.

## Before submission

The author must: obtain or confirm the Chapter 1 objective sentences (E-01); write the workstation specification
(G-01); draw Figures 4.1–4.24 and capture S-01 … S-30; decide AD-1 … AD-6; and either commit this folder or archive it
with the submission (G-30).
