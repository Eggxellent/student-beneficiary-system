# Supplied SBMS synthetic dataset experiment

**Status:** Completed research experiment; not integrated into SBMS.  
**Archive:** `C:\Users\user\Downloads\sbms_dataset.zip`  
**SHA-256:** `dd7766fb28444a2a6940c2835c4e4302087d3798e397e5588bc97fe53d3d0d9a`  
**Runtime:** Python 3.11.9, pandas 3.0.5, scikit-learn 1.9.0, XGBoost 3.2.0, jellyfish 1.2.1, joblib 1.6.0.  
**Random seed:** 42.

## Split and quality checks

The archive has 16,800 train, 2,400 validation, and 4,800 primary test rows. In each split, binary rows are 25% match and 75% non-match; review rows are 6% of all rows and have no binary target. The experiment read IDs as strings and checked the serialized label/target relation.

Identity overlap, cluster overlap, and exact pair overlap were all zero for every pair of primary splits. Exact duplicate record pairs within train, validation, and test were also zero. The check fails closed if these conditions are violated. The archive reports canonical identity pairs recur within a split under different corruptions (maximum reuse 9 train, 10 validation, 7 test), so rows within a split are still related. The six challenge sets are all subsets of primary test and are reported only as test slices.

The data-quality JSON records per-column missing counts, label counts, archive hash, configuration, library versions, group checks, and challenge-subset membership. Private metadata was used for integrity checks only, never as a model feature.

## Feature schema and search

Research features in fixed order:

1. `jaro_winkler`
2. `dob_match`
3. `school_match`
4. `guardian_match`
5. `name_both_present`
6. `dob_both_present`
7. `school_both_present`
8. `guardian_both_present`
9. `dob_conflict`
10. `guardian_conflict`

The first four values reuse `ml-service/feature_engineering.py`. The archive's first, middle, and surname fields are joined in that order to approximate the application's `full_name`. Its `guardian_id_no` is mapped experimentally to the app's `guardian_id` based on field naming only; equivalence is unverified. `upi_match` and `birth_certificate_match` are excluded because the archive does not contain those fields. No archive field outside the existing application's inputs was added.

Two baselines and an eight-candidate fixed XGBoost search were evaluated. The selected XGBoost configuration was `n_estimators=120`, `max_depth=4`, `learning_rate=0.1`, with fixed `min_child_weight=3`, `subsample=0.85`, `colsample_bytree=0.9`, `reg_alpha=0`, `reg_lambda=2`, and `gamma=0`. The choice used validation average precision, then validation F1 at 0.5. The recorded runtime was 36.3 seconds. Each binary threshold was selected on validation by maximum F1; ties prefer recall, then precision, then the higher threshold.

## Primary test results

The same primary test binary rows (4,512; 25% match) were used for all binary methods. Confusion matrices use positive = `match` and are listed as TP, FP, TN, FN. Average precision (PR-AUC) depends on this synthetic 25% prevalence.

| Method | Cutoff | Precision | Recall | F1 | PR-AUC | ROC-AUC | TP / FP / TN / FN |
|---|---:|---:|---:|---:|---:|---:|---|
| Full-name Jaro–Winkler, default | 0.50 | 0.273 | 0.986 | 0.427 | 0.596 | 0.831 | 1112 / 2967 / 417 / 16 |
| Full-name Jaro–Winkler, validation F1 | 0.8595 | 0.523 | 0.778 | 0.626 | 0.596 | 0.831 | 878 / 800 / 2584 / 250 |
| Transparent rule, validation-selected name cutoff | name ≥ 0.75 plus exact DOB; or exact guardian ID and DOB | 0.819 | 0.752 | 0.784 | 0.677 | 0.848 | 848 / 188 / 3196 / 280 |
| XGBoost, default | 0.50 | 0.906 | 0.846 | 0.875 | 0.953 | 0.978 | 954 / 99 / 3285 / 174 |
| XGBoost, validation F1 | 0.4162 | 0.874 | 0.880 | 0.877 | 0.953 | 0.978 | 993 / 143 / 3241 / 135 |

The selected threshold slightly raises recall and F1 while lowering precision compared with 0.5. F1 treats precision and recall symmetrically; it is an experimental selection rule, not an approved operational cost policy. The standalone baseline uses standard-order Jaro–Winkler over joined name parts. The XGBoost name feature uses the existing SBMS feature builder, which takes the higher similarity of direct and token-reordered names. These scores do not establish performance on real bursary records.

## Review and challenge cases

Review rows remain a separate annotation. On the primary test review slice (288 rows), the XGBoost score mean was 0.177, median 0.150, and 1.7% fell between 0.4 and 0.6. These are descriptive only. Review labels represent an evidence policy and can contain either same-identity or different-identity pairs. No uncertain cutoff was selected without a validated abstention cost and policy.

Challenge metrics are in `sbms_dataset_experiment_metrics.json`. They overlap the primary test and must not be read as independent tests. Single-class slices (hard positives or hard negatives) have no defined ROC-AUC; ranking metrics are recorded as null. Hard-positive recall at the selected cutoff was 0.807 (510/632). Hard-negative false-positive rate was 0.078 (135/1,735). Missing-data slice F1 was 0.746; contradiction and unseen-transform results are in the JSON report.

## Compatibility and limits

The current app model expects six ordered features: name, DOB, school, guardian ID, UPI, and birth-certificate comparisons. This archive has no UPI or birth-certificate values; generated school labels do not match the app's five supported school names; and the archive-to-app guardian ID mapping is not confirmed. Consequently, the research model's ten-column schema is not compatible with `ml-service/predict.py` or backend API behavior. It was saved separately as `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` (183,445 bytes; SHA-256 `72a005b030167512783c6371132d3a5024d4fff2845f95d9455a18696a448567`); the active model was not loaded, overwritten, or changed.

The archive has synthetic, limited name/place pools, designed corruption mechanisms, 25% binary positive prevalence, and repeated canonical pairs within partitions. No authorized real-data evaluation or cluster-bootstrap uncertainty interval was available. A representative, authorized, de-identified evaluation set and a deployment-specific false-positive/false-negative/manual-review cost policy are required before any integration decision.

## Reproduction

```powershell
& .\ml-service\.venv\Scripts\python.exe -m unittest ml-service.experiments.sbms_dataset.test_experiment -v
& .\ml-service\.venv\Scripts\python.exe ml-service/experiments/sbms_dataset/experiment.py --archive 'C:\Users\user\Downloads\sbms_dataset.zip'
```

Machine-readable results: `ml-service/reports/sbms_dataset_experiment_metrics.json` and `ml-service/reports/sbms_dataset_quality.json`. Selected parameters and feature order: `ml-service/experiments/sbms_dataset/artifacts/selected_config.json` and `feature_schema.json`.
