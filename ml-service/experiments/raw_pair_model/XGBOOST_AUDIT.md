# Raw-pair XGBoost audit

This experiment is isolated on `experiment/raw-pair-model-training`. It did not modify or promote the production model, application code, database, `dev`, or `main` (no local or remote `main` branch was available).

## Configuration comparison

| Setting | Existing production model | Earlier raw-CSV XGBoost | Audited raw-CSV XGBoost |
|---|---|---|---|
| Algorithm | RandomForestClassifier | XGBClassifier | XGBClassifier |
| Training data | 12,000 rows from `realistic_pairs_train.csv` | 8,000 rows from raw CSV train fold | Same 8,000-row raw CSV train fold |
| Selection | 5-fold grouped CV, F1 | Manually specified values; no CV search | 24-candidate randomized search; 5-fold grouped CV, average precision |
| Tree count | 160 | 250 | 500 (selected within the documented search range) |
| Depth | 10 | 4 | 3 |
| Leaf/split control | `min_samples_leaf=8`, `min_samples_split=2` | XGBoost `min_child_weight=1`; no RF-style split/leaf settings | `min_child_weight=1`; no RF-style split/leaf settings |
| Other parameters | Gini, `max_features=sqrt`, bootstrap, `class_weight=None` | `learning_rate=.05`, row/column sampling `.9`, `reg_lambda=1`, `gamma=0` default | `learning_rate=.03`, row/column sampling `1`, `reg_lambda=1`, `gamma=.1` |
| Seed | 876441 | 20261021 | 20261021; search and CV seeds recorded in JSON |
| Class weighting | None; training labels are balanced | None; balanced labels | None; balanced labels |
| Fit parallelism | `n_jobs=-1` | `n_jobs=-1` | `n_jobs=1` to avoid nested parallelism during sequential CV |
| Features | Six SBMS comparison features | Same six | Same six |
| Preprocessing | Direct numeric feature fit | Median imputer (no-op) | Direct numeric feature fit; incomplete feature data rejected |
| Decision threshold | 0.50 | Fixed 0.50 | Selected on grouped out-of-fold training probabilities to maximize F1; tie goes to threshold nearest 0.50 |

The production Random Forest configuration was verified from its saved estimator and training report. The inspected configuration snapshot is `production_rf_config_snapshot.json`; that estimator was not used to train or score the audited XGBoost. The production model was trained on a different CSV, so its own reported holdout metrics are not a direct raw-CSV comparison. The earlier raw-CSV Random Forest report is on the same raw test fold and is retained below as a comparable experiment baseline.

Both models consume the same six comparison feature definitions: order-tolerant Jaro-Winkler name similarity, normalized DOB comparison, normalized exact school match, and normalized fuzzy guardian/UPI/birth-certificate identifier comparisons. Missing raw fields are converted upstream to zero similarity/match; the CSV's model-feature columns themselves are complete. Missingness is therefore not separately represented to either model. `raw_pairs.csv` does not include the source birth-certificate values, so the saved certificate-match feature cannot be independently recomputed from this file.

## Hardcoded decisions and handling

- **Fixed XGBoost parameters:** The earlier runner hardcoded 250 trees, depth 4, learning rate 0.05, sampling 0.9, and L2 value 1 without a selection method. The audited runner selects these through a reproducible randomized search on training groups only. Search ranges are explicit in the report; the best tree count reached the search maximum, so the selected result is conditional on the finite search range and may warrant a later training-only expansion.
- **Fixed 0.50 cutoff:** The earlier runner used 0.50 without a task-specific cost justification. The audited threshold is selected by F1 on out-of-fold training predictions, giving equal weight to precision and recall because no adjudicated error-cost matrix is available. A production cutoff should use real operational costs and prevalence.
- **Feature list:** Retained. These six named pair-comparison features are the SBMS model input schema, are available at prediction time, and are also used by the existing estimator. `label`, `group_id`, and scenario descriptions are excluded from inputs. Raw strings are not added as extra features.
- **Median imputer:** Removed from the audited runner because all six comparison features are complete in the inspected CSV; it was a no-op. Missing feature values now fail validation instead of being silently transformed.
- **Class balancing / sample filtering:** None. Both classes have 5,000 rows. All rows, including 74 exact duplicates, are retained; duplicate groups stay together in the split.
- **CV scoring/search budget:** Average precision was selected because this is a candidate-ranking task and it summarizes positive retrieval across cutoffs; the classification cutoff is selected separately. The 24-candidate budget bounds computation and is recorded with all CV scores. The model selected the largest candidate tree count, so the result is conditional on the declared range.
- **Random seed and grouped split:** Retained for reproducibility and paired comparison with prior raw-CSV runs. The first fold of a stratified five-fold group split yields 8,000 train and 2,000 test rows. Group IDs never enter the model.
- **Synthetic label construction:** Labels come from latent identity, not prior model predictions. The generator assigns positive groups to repeat applications and negative groups to hard non-duplicate scenarios. Its corruption rates are class-conditional: for example, name errors use `0.22 + 0.50*difficulty` for positives versus `0.10` for negatives, and UPI corruption uses `0.25 + 0.50*difficulty` versus `0.025`. These simulator-specific distributions can become learnable cues even though they are not explicit label fields. `scenario` is not included in `raw_pairs.csv` or used by the model. No labels, cases, or difficult examples were altered or removed for this audit.
- **Precomputed features:** The CSV contains raw record fields plus six precomputed comparisons. The birth-certificate source values are absent from this CSV, so `birth_certificate_match` cannot be recomputed independently from the file; the other stored fields are likewise treated as the provided feature definitions rather than re-engineered in this run.
- **Existing artifacts / predictions:** The prior XGBoost artifact was not loaded or used to create labels. The existing RF artifact was loaded only in a separate read-only inspection to report its fitted configuration. Historical metric JSON was read only to make the before/after comparison.

## Evaluation protocol and results

The raw CSV contains 10,000 rows (5,000 per label) and 5,000 pair groups. The same deterministic stratified grouped test fold used in the earlier raw experiment is preserved: 8,000 training rows (4,000 per class) and 2,000 test rows (1,000 per class). Group, exact record-signature, and unordered pair overlap checks each found zero cross-split overlaps. The CSV has no canonical student IDs, so this cannot prove all latent people are disjoint.

Hyperparameters were selected using only the training rows: 24 randomized candidates, five-fold `StratifiedGroupKFold`, and average precision as the ranking score. The threshold was selected from a second five-fold grouped out-of-fold pass on training rows. The held-out test labels were not used in either selection step.

| Test metric | Earlier fixed XGBoost (`0.50`) | Audited XGBoost (CV-selected threshold) | Earlier raw Random Forest (`0.50`) |
|---|---:|---:|---:|
| Accuracy | 90.45% | 90.50% | 88.95% |
| Precision | 92.18% | 91.58% | 90.70% |
| Recall | 88.40% | 89.20% | 86.80% |
| F1 | 90.25% | 90.37% | 88.71% |
| ROC-AUC | 97.10% | 96.94% | 95.77% |
| PR-AUC (average precision) | 97.53% | 97.39% | 96.33% |
| Threshold | 0.500 | 0.4582 | 0.500 |
| TN / FP / FN / TP | 925 / 75 / 116 / 884 | 918 / 82 / 108 / 892 | 911 / 89 / 132 / 868 |

The audited XGBoost is close to the earlier fixed run: 0.05 percentage points higher accuracy, 0.60 points lower precision, 0.80 points higher recall, and one fewer total test error (190 vs. 191). No metric was forced up or down. The threshold trade-off shifts toward finding more duplicates, with seven additional false positives and eight fewer false negatives than the earlier XGBoost run.

**Test reuse caveat:** This test fold was reported in earlier experiments before the audit. It was excluded from the audited run's CV and parameter/threshold selection, but repeated prior exposure means it is not a pristine first-use final test. A new independently adjudicated dataset is needed for a genuinely fresh final assessment. All results are synthetic and do not establish real-world accuracy; the 50/50 class mix also does not represent operational prevalence.

## Reproduction

From the experiment worktree, with the project ML virtual environment:

```powershell
& 'C:\Users\user\Desktop\Projects\student-beneficiary-system\ml-service\.venv\Scripts\python.exe' 'ml-service\experiments\raw_pair_model\train_evaluate_xgboost.py'
```

The run writes `raw_pair_xgboost_audited.joblib`, `raw_pair_xgboost_audited_metrics.json`, `raw_pair_xgboost_search_cv.csv`, and `raw_pair_xgboost_audited_split.csv` beside the experiment script. The original fixed-parameter raw run is retained as `train_evaluate_xgboost_pre_audit.py` for reproducibility; the default runner now calls the audited procedure. Separate earlier XGBoost comparisons on the `dev` and realistic datasets remain historical runs and are not the raw-CSV audited workflow.
