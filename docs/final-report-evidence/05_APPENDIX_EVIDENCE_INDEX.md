# Appendix evidence index

## Repository and model evidence

| Deployment/local phase distinction | `09_DEPLOYMENT_STATUS_AND_LOCAL_VERIFICATION.md` | Completed deployment, dated Azure evidence, current local verification phase, and parity limits | No live query or production change was made during this documentation pass |

| Evidence | Location | What it supports | Limit |
|---|---|---|---|
| Repository audit and scope | `docs/final-report-evidence/00_EXECUTIVE_AUDIT.md` | Checkout state, implemented workflows and key caveats | Working tree is dirty; source commit alone does not contain this final work |
| Chapter 4 requirements/design | `01_CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` | Current requirements catalogue, workflow, data model and written diagram specs | No diagrams are included; approved objective wording absent |
| Chapter 5 test/evaluation | `02_CHAPTER_5_IMPLEMENTATION_TESTING_EVALUATION.md` | Environment, execution outcomes, synthetic metrics and limitations | Deployment completion has dated evidence; current local/live revision parity and Node suite were not verified in this pass |
| ML run metrics | `ml-service/evaluation/realistic_pairs_xgboost_training_metrics.json` | Train/validation/final-test metrics, threshold, errors, hashes | Synthetic labels and generated population |
| ML split audit | `ml-service/evaluation/training_integrity_report_fresh_2026-11-26.json` | Structural group/identity/guardian/pair isolation | Reads raw identifiers for overlap checks; does not load test labels/features or calculate metrics |
| Model comparison | `ml-service/experiments/results/model_comparison_validation_20261125.json` | Validation-only candidate comparison and hardness gate result | Synthetic validation distribution |
| Forensic audit | `ml-service/evaluation/forensic_audit_fresh_20261126.json` | Train/validation-only shortcut, missingness, and feature-tier statistics | Not real registration prevalence or observed production workload |
| Artifact metadata | `ml-service/model/xgb_duplicate_model.metadata.json` | Model type, six-feature order, hash, split hashes, recorded 0.63 validation cutoff, train/validation/holdout metric blocks | Artifact filename is legacy; the wrapped estimator is an uncalibrated `HistGradientBoostingClassifier`, and the API review default (0.50) differs from the recorded cutoff |
| Legacy backup | `ml-service/backup_legacy/before_connected_component_retrain_20261125/backup_manifest.json` | Pre-retraining artifact/evaluation checksums | Backup is a local copy, not an immutable remote archive |
| Current pair generator | `ml-service/generate_realistic_pairs.py` | Label logic, scenarios, connected-component assignment | Scenario proportions are designed, not estimated from real applications |
| Local manual evaluation guide | `ml-service/evaluation/MANUAL_SYSTEM_EVALUATION.md` | Safe workflow for later authorized reviewed cases | No adjudicated sample is present |

## Executed test evidence

- `python -m unittest discover -s tests`: 33 passed.
- `python -m pytest`: unavailable because `pytest` is not installed in the project venv; the repository test files were run with unittest discovery instead.
- `python test_predictions.py`: 17 scenarios, 0 failures; known limitations are printed.
- `python check_training_integrity.py --output evaluation/training_integrity_report_fresh_2026-11-26.json`: structural audit verdict `pass`; zero pairwise overlaps.
- The validation-only regularization sweep recorded the depth-2 baseline F1 as 0.8490, just below the `<0.85` criterion.
- `python experiments/regularization_sweep.py`: validation-only model comparison; selected uncalibrated HistGradientBoosting. It does not read the final-test file.
- Backend Jest and frontend Vite build were not run successfully in this environment because Node path resolution returned `EPERM` for `C:\Users\user`.
- No new Azure current-state query was made because this task focuses on local testing/documentation. Deployment was completed earlier; no production database, deployment, or service was modified during this pass. Use the dated Azure deployment log for historical live evidence and do not infer parity with the current local worktree.

## Screenshot/evidence requests for the student

No screenshots were generated. If the report requires visual evidence, capture these in the authorized current local/deployed environment and record the commit/image shown:

1. Guardian application submission and own-application view, with all names, contact details, IDs and tokens masked.
2. Administrator duplicate review queue and a resolved-case audit view using synthetic or approved anonymized data.
3. Field Officer eligibility/award proposal view demonstrating role limits.
4. Administrator award decision and certificate verification screen using a synthetic record.
5. Application More Info correction flow only after it exists; do not create a screenshot implying the current code supports it.
6. ML evaluation report screenshot showing synthetic-only caveat, actual metrics and synthetic-only limitation.

Store screenshots in the project’s approved evidence folder and remove sensitive browser URLs, tokens, student records, user names and cloud credentials before inclusion.
