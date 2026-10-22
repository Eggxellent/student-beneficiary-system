# Evaluation on human-reviewed pairs

`evaluate_reviewed_pairs.py` scores a selected model against reviewed outcomes. It does not fit a model or update the application model.

## Prepare the data

Start from `reviewed_pairs_template.csv`. Use one row per pair and fill every column:

- `label`: `1` for a reviewer-confirmed duplicate or `0` for a reviewer-confirmed non-duplicate. Leave unresolved cases out until they have a final adjudication.
- `entity_id_1` and `entity_id_2`: stable, pseudonymous person-level IDs assigned after review. A duplicate pair uses the same ID twice; a non-duplicate pair uses two different IDs. Reuse IDs consistently wherever the same person appears.
- `partition`: assign complete entities to `tuning` or `holdout`. No person can appear in both. Both partitions must contain confirmed duplicates and confirmed non-duplicates. Use tuning results to choose a review threshold; reserve holdout for the final report.
- Remaining columns: the two records' names, dates of birth, school codes, guardian IDs, UPIs, and birth-certificate numbers. Blank fields should be encoded as a documented missing-value marker such as `UNKNOWN`; matching missing markers do not count as a match.

Keep the file in an approved local location, restrict access to authorized reviewers, and use pseudonymous entity IDs. The pair contents contain sensitive student data.

## Run

From `ml-service/` with its Python environment activated:

```powershell
python .\evaluate_reviewed_pairs.py C:\approved\reviewed_pairs.csv `
  --model .\model\xgb_duplicate_model.joblib `
  --output .\evaluation\reviewed_pairs_metrics.json
```

The report includes ROC-AUC, average precision, and precision, recall, F1, confusion counts, and review-queue size at thresholds 0.30 through 0.70. It includes input and model hashes for provenance. Do not choose a threshold from holdout results. A measured threshold is a proposal for human review policy, not a calibrated probability or proof that a pair is a duplicate.

The current application model is trained from generated SBMS scenarios. No verified production dataset is included in this repository, so real-case performance cannot be reported until an authorized reviewed CSV is supplied.
