# Supplied SBMS dataset experiment

This is an isolated research experiment for `sbms_dataset.zip`. It does not use a database and does not modify `ml-service/predict.py`, the backend, or the active model at `ml-service/model/xgb_duplicate_model.joblib`.

## Reproduce

From the repository root in PowerShell:

```powershell
& .\ml-service\.venv\Scripts\python.exe -m unittest ml-service.experiments.sbms_dataset.test_experiment -v
& .\ml-service\.venv\Scripts\python.exe ml-service/experiments/sbms_dataset/experiment.py --archive 'C:\Users\user\Downloads\sbms_dataset.zip'
```

The archive is read in place. CSV values are loaded as strings and the private metadata is used only for split/group checks. Outputs are written to `ml-service/reports/` and `ml-service/experiments/sbms_dataset/artifacts/`; the research model artifact is separate from the production model.

## Method

- Train uses only `match` and `non_match`. The `review` annotation has no binary `y` and is excluded from model fitting and threshold tuning.
- Hyperparameter selection and the F1 threshold selection use validation only. The primary test is evaluated after these choices. Eight fixed XGBoost configurations are searched; ranking is validation average precision, then F1 at 0.5.
- Baselines are full-name Jaro–Winkler with a validation-selected threshold, and a transparent rule: exact DOB plus either a validation-cutoff name similarity or exact guardian-ID similarity.
- XGBoost uses a fixed 10-column research schema: the first four existing SBMS features plus paired availability and DOB/guardian conflict flags. Private identity, pair IDs, labels, and generator metadata never enter the feature matrix.
- Review rows are only reported as score diagnostics. No `UNCERTAIN` confidence band is selected: that needs an explicit and validated cost for unnecessary manual review versus missed or incorrectly flagged duplicates.

## Results and boundary

See `ml-service/reports/sbms_dataset_experiment.md` and the JSON metrics/quality reports next to it. The experiment is not compatible with the current app contract: UPI and birth-certificate inputs are absent from the archive, archive schools are fictional values, and guardian-ID semantic equivalence has not been confirmed. The research artifact must not be loaded by the active predictor.
