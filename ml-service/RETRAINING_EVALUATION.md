# Duplicate model retraining and forensic audit (25 November 2026)

## Outcome

A fresh synthetic dataset was generated with dataset seed `20261126` and component-split seed `20261127`. The partitions contain 21,000 training rows, 4,500 validation rows, and 4,500 final-test rows (70/15/15). The selected estimator is `HistGradientBoostingClassifier` with median imputation, stored at the service's compatibility path `model/xgb_duplicate_model.joblib`. Validation-only selection chose threshold `0.63` under a validation FPR ceiling of 5%.

The final synthetic test F1 is **87.48%** (accuracy 88.00%, precision 94.07%, recall 81.76%, FPR 5.43%, FNR 18.24%). This is just above the previously requested 70-86% range. The test was evaluated once after the model and threshold were locked. No post-test changes or threshold tuning were made. Synthetic metrics do not demonstrate beneficiary performance.

## Forensic audit: five leakage vectors

1. **Prior test contamination:** the earlier final-test CSV had been read repeatedly during iterative diagnostics, so it was not suitable for unbiased reporting. The old train/validation/holdout CSVs, model and metadata, and derived metrics/reports were moved to `backup_contaminated/`. An intermediate fresh-seed candidate also failed a serving smoke case; it was archived under `backup_contaminated/pre_final_smoke_failure_20261125/` without opening its test labels. The accepted run uses seed `20261126`. Before model selection, the structural checker read only group, identity, guardian, and raw-pair fields to verify separation; it did not load test labels, engineered features, or predictions. After lock, the final evaluation read the test partition and scored it once.
2. **Depth-2 tree shortcut:** on the contaminated prior validation set, the `DecisionTreeClassifier(max_depth=2)` used `jaro_winkler <= 0.89692`; below that it predicted negative when `birth_certificate_match <= 0.93889`, otherwise positive. Above the name threshold it predicted positive. Its validation F1 was 88.09%. It was not using exact admission or birth-certificate equality as a perfect rule; it exploited the generator's strong name-similarity and certificate-similarity combination. On the rebuilt train/validation set, the analogous thresholds are `jaro_winkler <= 0.88993` and `birth_certificate_match <= 0.93889`; validation F1 is 84.90%. Single-feature validation AUCs range from 0.362 to 0.773, so no one feature independently determines the label. The remaining pairwise signal is expected for duplicate screening, but this is still synthetic evidence.
3. **Missingness/distribution signal:** a classifier trained only on raw-field `isna()` indicators achieved 45.50% validation F1 on the new run, below the 65.79% all-positive baseline. In train plus validation, missing rates for admission number on side 2 were 45.08% for negatives and 45.54% for positives; birth-certificate side-2 rates were 45.13% and 45.23%. Other raw-field missing rates were about 2.8-3.4%. The challenge-case missingness is intentionally similar between labels. Full feature mean, standard deviation, null rate, minimum and maximum by split, tier, and label are in `evaluation/forensic_audit_fresh_20261126.json`.
4. **Feature engineering/preprocessing:** the six ordered model inputs are `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `admission_number_match`, and `birth_certificate_match`. `difficulty`, `difficulty_band`, scenario, mutation, group, and identity fields are excluded. The old label-derived `difficulty_band` was a metadata leakage risk even though it was not a model input; the new tier is computed from pair features without labels or scenario names. `feature_engineering.py` fits no statistics and is called by `predict.py` through the same `build_pair_features` function used to produce training features. Median imputation is inside the estimator pipeline and is fitted on training rows only. Admission comparison is allowed only when `school_match >= 0.85` (the current school-code equality feature is binary). No post-outcome field is used.
5. **Graph/pair separation:** `check_training_integrity.py` checks all three partition pairs for shared groups, latent identity IDs, guardian clusters, identical raw rows, directed `(A,B)` pairs, and undirected pairs including `(B,A)`. The fresh audit reports zero for every overlap count. Its audit is structural only; it does not calculate model metrics or read labels/features from the test partition.

## Data construction and split

Labels remain faithful to `identity_1 == identity_2`; no label edits or score-targeting were used. Exactly 45% of positive groups receive identifier-omission challenge scenarios, and 45% of negative groups receive blocked household/school collisions. Positive challenge records omit admission and birth-certificate values on one side; a realistic mix includes name transcription/initial/middle-name variation, occasional DOB entry error, guardian change, or school transfer. Negative challenge cases include twins, siblings, and same-school/same-DOB common-name classmates; at least one record lacks both identifiers. The generator and tests verify actual overlap in the six-feature space.

Connected components keep pair groups, identities, and guardian clusters together. Split sizes are exactly 21,000/4,500/4,500 rows for this generated run. The final test labels come from the same simulator, not adjudicated beneficiaries. The split audit report is `evaluation/training_integrity_report_fresh_2026-11-26.json`.

## Candidate selection and final metrics

Candidates (regularized XGBoost depths 2/3, LogisticRegression, RandomForest, HistGradientBoosting, and calibrated HistGradientBoosting) were trained on train only and compared on validation only. Thresholds maximize validation F1 subject to validation FPR <= 5%; ties prefer the higher threshold. The uncalibrated HistGradientBoosting candidate was selected. Its settings are `max_iter=160`, `max_leaf_nodes=7`, `l2_regularization=4.0`, `min_samples_leaf=25`, and `learning_rate=0.05`. Selection results are in `experiments/results/model_comparison_validation_20261125.json` and explicitly record `test_data_accessed: false`.

All split metrics use the validation-selected threshold 0.63. Confusion matrices are `[[TN, FP], [FN, TP]]`.

| Split | Rows | Accuracy | Precision | Recall | F1 | FPR | FNR | Confusion matrix |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Train | 21,000 | 88.12% | 94.05% | 81.36% | 87.24% | 5.14% | 18.64% | `[[9974,540],[1955,8531]]` |
| Validation | 4,500 | 87.89% | 94.01% | 80.42% | 86.68% | 4.93% | 19.58% | `[[2181,113],[432,1774]]` |
| Final test (one evaluation) | 4,500 | 88.00% | 94.07% | 81.76% | 87.48% | 5.43% | 18.24% | `[[2073,119],[421,1887]]` |

The model and threshold were persisted before test evaluation. The final report is `evaluation/realistic_pairs_xgboost_training_metrics.json`; the model hash and threshold are recorded in `model/xgb_duplicate_model.metadata.json`.

## Verification and limitations

- Structural split audit: pass; zero group, identity, guardian, identical-row, directed-pair, and undirected-pair overlaps across all partition pairs.
- Serving smoke check: 17 cases, 0 failures. It ran before final test access as a stop condition and was repeated after evaluation without loading any dataset split.
- Python unit suite: 33 tests passed. The suite uses unit fixtures/generated in-memory samples and does not read the final test CSV.
- The shallow-tree validation F1 is 84.90%, narrowly under the <85% hardness gate. Final-test F1 is 87.48%, still slightly above the earlier 86% target. No post-test changes were made to chase that range.
- The model has not been evaluated on independently adjudicated real beneficiary pairs. Its balanced synthetic prevalence and scenario mix are not operational prevalence estimates. Precision/recall on real cases remain unknown.
- Exact-name/DOB/school/guardian collisions can be indistinguishable from true duplicates when both identifiers are missing. A high score is a review signal, not proof that two records are the same child. An Administrator must review evidence and decide; the model must not auto-merge, reject, or label a person fraudulent.

For manual evaluation with authorized, independently adjudicated pairs, follow `evaluation/MANUAL_SYSTEM_EVALUATION.md`. Keep the raw file local and report only aggregate metrics.
