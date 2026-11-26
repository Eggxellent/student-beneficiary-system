# Local SBMS duplicate-model training and evaluation guide

The latest synthetic run is documented in `RETRAINING_EVALUATION.md`. The old test data and model are archived in `backup_contaminated/`; the active test has already been evaluated once. Do not rerun selection or evaluation on that same test file and call it a fresh unbiased result. Any future model changes require a new seed, new split files, a structural isolation audit, train/validation-only selection, and a one-time final evaluation.

## Current run

- Dataset seed `20261126`; component split seed `20261127`.
- Split rows: train 21,000; validation 4,500; final test 4,500 (70/15/15).
- Estimator: regularized `HistGradientBoostingClassifier`, median imputer, stored at the compatibility path `model/xgb_duplicate_model.joblib`.
- Validation-selected analysis cutoff: 0.63; the API review threshold is separate and defaults to 0.50.
- Train/validation/final-test F1: 87.24% / 86.68% / 87.48%. Final-test confusion matrix: `[[2073,119],[421,1887]]`.
- Final test is synthetic, not adjudicated beneficiary data. The final F1 is just above the earlier 70-86% target; do not tune on it.
- Structural integrity audit: zero shared groups, identities, guardians, identical rows, ordered pairs, or reversed pairs across all split pairs.
- Tests: 33 unit tests passed; `test_predictions.py` passed 17/17 cases.

## Files

- `generate_realistic_pairs.py`: latent-identity labels, realistic omission/collision scenarios, connected-component 70/15/15 split.
- `experiments/regularization_sweep.py`: trains candidate models on train and selects candidate/cutoff using validation only; it never opens test data.
- `retrain_realistic_pairs.py`: rebuilds the selected candidate from the sweep, locks model/threshold, runs smoke checks, then evaluates the final test once.
- `check_training_integrity.py`: structural-only split audit; reads identifiers/raw pair fields but not labels, features, or model scores.
- `feature_engineering.py`, `predict.py`: shared train/serving feature schema and artifact loader.
- `evaluation/realistic_pairs_xgboost_training_metrics.json`: current metrics, hashes and final one-time score.
- `evaluation/forensic_audit_fresh_20261126.json`: train/validation shortcut, missingness and feature-tier diagnostic.
- `evaluation/training_integrity_report_fresh_2026-11-26.json`: zero-overlap structural report.

Do not regenerate the active files with the same seed and reuse the previous score as a new final test. Keep Administrator review mandatory; synthetic performance cannot establish real-world effectiveness.
