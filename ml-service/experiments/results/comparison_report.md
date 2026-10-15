# SBMS duplicate-detection experiments

**Dataset:** `data\features.csv` · 10,000 synthetic pairs · 5,000 groups  
**Holdout:** 20.0% by group, seed 42 · 8,000 train / 2,000 test rows · group overlap 0  
**Threshold:** 0.5  
**Environment:** Python 3.11.9 · scikit-learn 1.9.0 · XGBoost 3.2.0 · Jellyfish installed

## 1. Random Forest vs XGBoost

Both models use the same six features, group-separated train/test rows, five-fold `StratifiedGroupKFold` tuning on training data, and 24 parameter candidates each. The held-out test set was not used for parameter selection.

| Metric | Random Forest | XGBoost |
|---|---:|---:|
| Precision | 0.9793 | 0.9736 |
| Recall | 0.9930 | 0.9950 |
| F1-score | 0.9861 | 0.9842 |
| Accuracy | 0.9860 | 0.9840 |
| ROC-AUC | 0.9985 | 0.9983 |
| False positives | 21 | 27 |
| False negatives | 7 | 5 |
| Confusion matrix (TN, FP / FN, TP) | 979, 21 / 7, 993 | 973, 27 / 5, 995 |
| Training / tuning time (s) | 29.08 | 17.28 |
| Test batch prediction time (ms) | 83.55 | 5.02 |

**Recommended research candidate: Random Forest.** It led on held-out F1 (0.9861 vs 0.9842). Random Forest had 6 fewer false positives; XGBoost had 2 fewer false negatives. XGBoost tuned faster (17.28s). A false positive can send a legitimate student to review; a false negative can let a duplicate pass undetected. This is a small synthetic-data advantage, not enough by itself to change the production model.

## 2. Jaro-Winkler vs normalized Levenshtein

The same Random Forest settings selected in Experiment 1, same feature set except for the name-similarity value, same group split, and same test rows were used for both methods. Names are normalized to lowercase letters; Levenshtein similarity is `1 - edit_distance / longer_name_length`.

| Metric | Jaro-Winkler | Normalized Levenshtein |
|---|---:|---:|
| Precision | 0.9793 | 0.9793 |
| Recall | 0.9930 | 0.9930 |
| F1-score | 0.9861 | 0.9861 |
| Accuracy | 0.9860 | 0.9860 |
| ROC-AUC | 0.9985 | 0.9984 |
| False positives | 21 | 21 |
| False negatives | 7 | 7 |
| Confusion matrix (TN, FP / FN, TP) | 979, 21 / 7, 993 | 979, 21 / 7, 993 |
| Training / tuning time (s) | 0.64 | 0.63 |
| Test batch prediction time (ms) | 80.29 | 80.76 |

**Recommended research candidate: Jaro-Winkler.** Selection is based on held-out F1, then recall, precision, and ROC-AUC as tie-breakers. The two methods produced the same thresholded test decisions; ROC-AUC was 0.9985 for Jaro-Winkler and 0.9984 for Normalized Levenshtein. The measured difference is small, so keeping the existing method is the simpler choice.

## Limitations and use

- These results describe a synthetic dataset, not real student records. They do not establish real-world effectiveness.
- Group separation keeps pairs generated from the same group together. It cannot remove every synthetic-data bias or prove generalization to the beneficiary population.
- The recommendations are for the capstone research comparison. The SBMS production model and backend decision workflow were not changed by this experiment.
- Training times include model search for Experiment 1 and final model fitting for Experiment 2; timing varies by machine.

Dataset SHA-256: `e214f9b28af17cff5f461bef051f7dd92b83af0a4c6a30eb71d8e91b669a3aa7`
