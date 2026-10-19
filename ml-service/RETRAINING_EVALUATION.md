# Model retraining and evaluation

Work on this experiment is isolated on the local Git branch `ml-retraining-evaluation`.

## Why the previous training data was unreliable

The existing `data/features.csv` contains 10,000 pairs with a 50/50 label split. In the saved data, every duplicate pair has an exact birth-certificate match, while only 9.4% of nonduplicate pairs do. UPI matches occur in 69.7% of duplicate pairs and 0% of nonduplicates. These shortcuts let a model score well by learning the generator's artificial rules. The saved CSV also does not match the current `generate_dataset.py` source, so regenerating and evaluating from that file can produce irreproducible conclusions.

## Current workflow

Use `retrain_variable_pairs.py` as the canonical retraining and evaluation entry point (also used by `train.py` and `train_model.py`):

```powershell
& .\ml-service\.venv\Scripts\python.exe .\ml-service\retrain_variable_pairs.py
```

It reads the branch datasets `training/pairs_variable_noise_train.csv` and `evaluation/pairs_variable_noise_holdout.csv` directly; it does not read or overwrite the legacy `data/features.csv`. Duplicate labels come from a shared latent student identity; field corruption varies independently by severity. Nonduplicate pairs can share names and demographic fields. The independent holdout has a separate name vocabulary, birth-date range and identifier range. The same five school categories are retained because they are the application's permitted schools.

The script checks that names, dates of birth, guardian IDs, UPIs and birth-certificate values do not overlap between training and independent holdout. Raw synthetic fields are kept in the CSV for that audit, while the classifier is fitted only on the six columns in `feature_engineering.FEATURE_COLUMNS`. The supplied randomized evaluation CSV is never used for training or tuning. The fitted model is saved as a research candidate under `model/research/`; this experiment does not replace the deployed model.

The training CSV is split 50/50 by `group_id`; related pairs stay together. Five-fold grouped cross-validation runs only on the training half. The separately generated holdout CSV is evaluated once after fitting. Results are written to `evaluation/variable_noise_retraining_metrics.json`. The legacy `train.py` and `train_model.py` commands now route to this same workflow so they cannot silently train on the old CSV.

## Latest run

The latest run used 10,000 pairs per dataset and a 5% positive rate as a simulation assumption (not measured SBMS prevalence). On the independent holdout at threshold 0.5:

- Accuracy: 95.69%; balanced accuracy: 93.85%.
- Precision: 54.06%; recall: 91.80%; F1: 68.05%.
- Confusion counts: 9,110 true negatives, 390 false positives, 41 false negatives and 459 true positives.

The holdout was not used to fit or tune the model. These synthetic results test generalization to different generated values; they do not establish performance on verified SBMS cases. The latest candidate was promoted in the earlier run before this branch was set up; rerunning the branch workflow saves a research candidate and leaves the deployed model unchanged.
