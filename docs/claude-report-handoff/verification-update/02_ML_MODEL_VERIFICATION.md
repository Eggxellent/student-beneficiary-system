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

“At the inspected local snapshot, the Python service loads a HistGradientBoosting estimator saved under a legacy XGBoost-named path. It scores six engineered pair features; the output is an advisory review signal and requires administrator review. Reported synthetic metrics do not establish accuracy on real beneficiaries.”
