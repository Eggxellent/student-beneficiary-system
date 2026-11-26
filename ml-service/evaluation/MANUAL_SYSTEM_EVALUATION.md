# Manual SBMS duplicate-screening evaluation

## Current synthetic model evidence

The current artifact is a regularized `HistGradientBoostingClassifier` at the compatibility path `model/xgb_duplicate_model.joblib`. Its model-analysis cutoff was selected on validation only at 0.63. The running API's default review cutoff remains 0.50 and applies aggregation/corroboration rules; these are different thresholds.

All three split metrics below use the validation-selected cutoff 0.63. The final test was scored once after model lock. Confusion matrices are `[[TN,FP],[FN,TP]]`.

| Split | Rows | Accuracy | Precision | Recall | F1 | FPR | FNR | Confusion matrix |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Train | 21,000 | 88.12% | 94.05% | 81.36% | 87.24% | 5.14% | 18.64% | `[[9974,540],[1955,8531]]` |
| Validation | 4,500 | 87.89% | 94.01% | 80.42% | 86.68% | 4.93% | 19.58% | `[[2181,113],[432,1774]]` |
| Final test | 4,500 | 88.00% | 94.07% | 81.76% | 87.48% | 5.43% | 18.24% | `[[2073,119],[421,1887]]` |

The test result is slightly above the previously requested 70-86% band. Do not tune against this test result. The labels come from a simulator, not adjudicated Guardian applications, and the metrics are not evidence of real applicant performance.

The earlier final-test split was contaminated by repeated diagnostic reads and is archived under `backup_contaminated/`. The current run used dataset seed `20261126`; the model and cutoff were locked before opening test labels. A structural split check read only identity/group/guardian/raw-pair fields to confirm separation. It did not inspect test labels, engineered features, or scores. After lock, the final evaluation read and scored the test once.

A shallow tree reached 84.90% validation F1 using `jaro_winkler` and `birth_certificate_match` thresholds, while each individual feature's validation AUC was below 0.773. A missingness-only classifier scored 45.50% validation F1, below an all-positive baseline of 65.79%. Missing identifier rates were closely matched across labels. The detailed train/validation-only forensic results and tiered feature distributions are in `forensic_audit_fresh_20261126.json`.

Administrator review remains mandatory. Matching names, dates, school, or guardian details can describe siblings or classmates; when exact identifiers are missing, the model may not be able to distinguish a true duplicate from a namesake. Treat scores as triage evidence. Do not automatically merge, reject, or make a fraud finding.

## Collect manually reviewed pairs

Fill a copy of `reviewed_pairs_template.csv` on the authorized local machine:

- `pair_id`: a unique random case ID.
- `entity_id_1` and `entity_id_2`: stable pseudonymous IDs assigned to actual people. Reuse the same ID for a person in every row. Do not use names as IDs.
- `partition`: `tuning` or `holdout`, assigned by entity before looking at model results. An entity must never occur in both partitions.
- `label`: independent human adjudication, `1` only if both records are the same student, otherwise `0`. Decide this without looking at the model score or flag.
- `system_flagged`: what the running system actually did for that pair: `1` if it surfaced the pair for review, otherwise `0`. Include any system identifier override in this observed outcome.
- Record the six input fields for both students exactly as the system received them. Leave unknown fields blank.

Include confirmed duplicates and non-duplicates, including difficult negatives such as siblings, twins, namesakes, shared guardians, and reused identifiers. Sample from cases the system did and did not flag; a flagged-only sample cannot measure missed duplicates. Record how cases were sampled because precision depends on the sample's match prevalence.

Assign entities to tuning and holdout before scoring. Keep the holdout untouched while making any threshold decision. If the goal is to evaluate the system as currently configured, do not change its settings during collection; the evaluator reports the observed decision directly.

## Run the evaluator locally

From PowerShell in `ml-service`:

```powershell
.\.venv\Scripts\python.exe .\evaluate_reviewed_pairs.py "C:\path\to\your\private-reviewed-pairs.csv" --system-threshold 0.50
```

Use the actual `ML_REVIEW_SCORE_THRESHOLD` configured in the running system if it differs from `0.50`. The evaluator loads the current production model, validates its feature schema and hash, reports observed-system metrics separately from model-only metrics, and uses tuning rows only to select an optional analysis threshold. It writes aggregate results to `evaluation/reviewed_pairs_metrics.json` without names, record values, or entity IDs.

Keep the CSV on the authorized machine. Share only the generated aggregate JSON report; do not upload the raw pair file or identifiers. The final holdout metrics apply to the cases and sampling process in that file, not automatically to all SBMS records.
