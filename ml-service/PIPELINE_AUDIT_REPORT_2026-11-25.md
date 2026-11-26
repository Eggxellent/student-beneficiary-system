# ML pipeline forensic audit and clean retraining ? 25 November 2026

## Disposition

The prior final-test data was contaminated by iterative diagnostics. The prior splits, model, metadata and dependent reports were moved to `backup_contaminated/`. An interim new-seed model failed a smoke case before its test labels were opened and was archived under `backup_contaminated/pre_final_smoke_failure_20261125/`.

The accepted run uses dataset seed `20261126` and component split seed `20261127`, with 21,000/4,500/4,500 rows (70/15/15). The selected model is an uncalibrated regularized `HistGradientBoostingClassifier`, cutoff 0.63. Candidate and threshold selection used training and validation only. A structural check read only test group/identity/guardian/raw pair fields before model selection; it did not load labels, engineered features, or scores. After lock, the test was read and scored once.

## Five-point audit findings

1. **Contamination:** the old test is retired and archived. The current test's labels/features were sealed until final evaluation.
2. **Shallow-tree shortcut:** the old depth-2 validation tree used `jaro_winkler <= 0.89692`, then `birth_certificate_match <= 0.93889` to predict negative; other leaves predicted positive. Old validation F1 was 88.09%. Current train/validation-only tree rules use thresholds 0.88993 and 0.93889, with validation F1 84.90%. Individual feature AUCs are all below 0.773.
3. **Missingness:** old missing-only validation F1 was 66.51%, essentially no better than its 67.4% all-positive baseline. In the fresh run, missing-only F1 was 45.50% versus a 65.79% all-positive baseline. Fresh side-2 admission missingness is 45.08% for negatives and 45.54% for positives; birth-certificate missingness is 45.13% and 45.23%. Full tier/label distributions are in `evaluation/forensic_audit_fresh_20261126.json`.
4. **Features/preprocessing:** the model uses only the six ordered production features. `feature_engineering.py` fits no statistics; the training pipeline's median imputer is fit only inside the training pipeline. `predict.py` calls the same `build_pair_features` implementation. Admission-number comparison requires `school_match >= 0.85`. The old label-derived `difficulty_band` metadata was removed; current tiers do not use labels or scenario names.
5. **Graph/pair isolation:** all three split pairs were checked for groups, latent identities, guardian clusters, exact rows, ordered pairs and unordered/reversed pairs. Every count is zero. The checker is structural-only and does not calculate test metrics.

## Final metrics

At the validation-selected threshold 0.63; confusion matrix format `[[TN,FP],[FN,TP]]`:

| Split | Rows | Accuracy | Precision | Recall | F1 | FPR | FNR | Confusion matrix |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Train | 21,000 | 88.12% | 94.05% | 81.36% | 87.24% | 5.14% | 18.64% | `[[9974,540],[1955,8531]]` |
| Validation | 4,500 | 87.89% | 94.01% | 80.42% | 86.68% | 4.93% | 19.58% | `[[2181,113],[432,1774]]` |
| Final test (one pass) | 4,500 | 88.00% | 94.07% | 81.76% | 87.48% | 5.43% | 18.24% | `[[2073,119],[421,1887]]` |

The final-test F1 is just above the earlier 70-86% target; it was not altered after test evaluation. The depth-2 baseline is narrowly below the <85% gate. These are synthetic metrics, not real-beneficiary accuracy.

## Verification

- Structural split audit: pass, all pairwise overlaps zero.
- `python test_predictions.py`: 17 scenarios, 0 failures; the smoke check ran before the final test was opened.
- `python -m unittest discover -s tests -v`: 33 tests passed. The suite does not read the final-test CSV.
- The live API review cutoff remains separately configured (default 0.50); the 0.63 model-analysis cutoff does not silently change backend policy.
- Administrator review remains mandatory. Similar names, DOB, school and guardian can describe distinct siblings/classmates when identifiers are missing. No automatic merge, rejection or fraud finding is justified by a synthetic score.

See `RETRAINING_EVALUATION.md`, `evaluation/MANUAL_SYSTEM_EVALUATION.md`, `evaluation/realistic_pairs_xgboost_training_metrics.json`, and the two `forensic_audit_*.json` reports for the full record.
