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

- “154/175” was not found as a test result in repository search. Do not repeat it.
- “175/175” appears in historical state documentation associated with the 11 November `d229c62` snapshot. It is a document-recorded historical result, not a current-tree test run.
- `SBMS_CURRENT_PROJECT_STATE_FOR_CLAUDE.md` was not present at the repository root in this checkout. A current `docs/final-report-evidence/00_EXECUTIVE_AUDIT.md` contains a summary of historical evidence, not raw output for every claimed run.
- A previous state note also reports 224 backend tests on a 15 November working tree, but the exact commit is not established. Keep it historical and unbound unless the original transcript is supplied.
- Older 151/151 and 128/128 counts in project documentation belong to earlier runs and are not evidence for HEAD.

## Classification guidance

1. **Current-run claim (dated, recorded):** 25 November targeted backend and 18 selected ML checks, as summarized above. State exactly the subset and limitations.
2. **Existing log evidence, commit not bound:** 33 Python unit tests and 17 smoke scenarios. Do not imply these ran against an unchanged commit unless the log records it.
3. **Historical evidence:** 175, 224 and earlier totals. Name the associated date/snapshot and do not aggregate them.
4. **Unverified:** 154/175, full current backend pass, current frontend build pass, and broad current suite pass.

Certificate tests appear in historical test plans and older runs, but no current, commit-bound complete certificate-test run was found for this dirty snapshot. Do not claim one. No new commands were executed during this audit.
