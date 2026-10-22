# SBMS model training and evaluation

The standard command generates a new, reproducible synthetic set of candidate pairs and trains the application model:

```powershell
& .\ml-service\.venv\Scripts\python.exe .\ml-service\train.py
```

`data/raw_pairs.csv` is a separate, more challenging synthetic dataset generated from latent student identities. It includes repeat applications with entry errors and difficult non-duplicate cases such as siblings, twins, common names, and identifier collisions. The prior version is kept as `data/raw_pairs.pre_realistic_backup.csv`, and `data/raw_pairs_metadata.json` records the seed, scenario mix, and file hashes. Regenerate only this CSV with `python improve_raw_pairs.py`; that command does not train the model. The standard training command does not read `raw_pairs.csv`: it generates its own training and independent holdout files under `training/` and `evaluation/`.

The Python prediction service loads an `XGBClassifier` from `model/xgb_duplicate_model.joblib`. The reproducible training command validates the generated pair features, trains on all generated training groups, scores the separate generated holdout at threshold 0.5, and writes `evaluation/realistic_pairs_xgboost_training_metrics.json`. It uses the configuration from the recorded XGBoost comparison: 250 estimators, depth 4, learning rate 0.05, row and column sampling 0.9, and L2 regularization 1.0. The median imputer is retained for compatibility, although the validated feature columns are complete.

The current comparison used this same holdout to choose XGBoost over Random Forest, so the holdout metrics are descriptive of that comparison and are no longer an unbiased final estimate for the selected model. A new independently generated, adjudicated dataset is needed for a fresh evaluation.

On the shared 12,000-pair synthetic holdout, Random Forest scored 89.78% accuracy, 90.46% precision, 88.93% recall, and 89.69% F1. XGBoost scored 90.78% accuracy, 92.04% precision, 89.27% recall, and 90.63% F1, with 1,107 errors versus 1,227 for Random Forest. These results motivated the switch; because the holdout informed that model choice, treat the difference as preliminary rather than an unbiased final comparison.

The scenario data is a transparent simulation, not labeled SBMS cases. Balanced test metrics do not reflect operational prevalence. The report includes illustrative precision at several assumed candidate-pair prevalence levels; real evaluation requires independently reviewed pairs with person-level groups kept separate between tuning and holdout.
