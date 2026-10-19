# Attachment-style model retraining and evaluation

This experiment is isolated on the local branch `ml/retraining-evaluation`.

## Source data and label correction

The attached generator contains messy names, malformed dates, identifier noise, and cleaning steps worth retaining. Its original labels were shuffled independently of pair content, however, and its Jaro-Winkler score was sampled randomly rather than calculated from the names. Training on that output unchanged would teach arbitrary labels and arbitrary similarity scores.

`generate_attachment_style_pairs.py` preserves the noisy scenarios but labels from a hidden identity relationship and recomputes comparison features from cleaned values. Duplicate pairs share a latent student; nonduplicate pairs can still have colliding demographics or similar names. The generator keeps the attachment's balanced 50/50 labels as a simulation setup, not a claim about real SBMS prevalence.

## Run on this branch

Generate two distinct CSVs, then train and evaluate:

```powershell
& .\ml-service\.venv\Scripts\python.exe .\ml-service\generate_attachment_style_pairs.py
& .\ml-service\.venv\Scripts\python.exe .\ml-service\train.py
```

`train.py` and `train_model.py` both route to `retrain_attachment_style.py`. That runner reads `training/pairs_attachment_style_train.csv` and `evaluation/pairs_attachment_style_holdout.csv`; it does not use the old `data/features.csv`. It verifies that valid names, dates, guardian IDs, UPIs and birth-certificate values do not overlap between those datasets. The five allowed school categories are shared. Raw fields support the disjointness check; fitting uses only the six columns in `feature_engineering.FEATURE_COLUMNS`.

The training CSV is split 50/50 by `group_id`, keeping related pairs together. Five-fold grouped cross-validation uses only the training half. The independent holdout is not used for fitting or tuning. The trained candidate is saved under `model/research/` and does not replace the deployed model. Metrics are written to `evaluation/attachment_style_retraining_metrics.json`.

The old CSV is retained on disk for historical work so this branch does not remove files shared with the main checkout. It is no longer used by the standard training commands. Historical comparison scripts that explicitly load `data/features.csv` are not part of this workflow.

## Latest independent holdout result

The run used 10,000 training pairs and a separate 10,000-pair holdout. At threshold 0.5, holdout accuracy was **76.41%**, balanced accuracy **76.41%**, precision **98.14%**, recall **53.84%**, and F1 **69.53%**. Confusion counts were 4,949 true negatives, 51 false positives, 2,308 false negatives, and 2,692 true positives.

The high precision and lower recall reflect that this attached-style generator includes many positives whose records are severely corrupted or look unrelated. Metrics are synthetic diagnostics, not estimates of performance on verified SBMS cases.
