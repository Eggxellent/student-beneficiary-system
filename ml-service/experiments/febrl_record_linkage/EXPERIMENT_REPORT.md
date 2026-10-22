# FEBRL 4A/4B experiment report

Run timestamp: `2026-10-22T07:52:09.003742+00:00`  
Seed: `20261022`  
Scope: isolated research experiment; no production model or service was changed.

## Dataset

This uses the Record Linkage Toolkit's FEBRL 4A and 4B data from tagged release v0.16. It is a synthetic, fictitious person-record benchmark, not Kenyan student or beneficiary data. The official guide describes the fictitious records and the dataset API documents 5,000 originals and 5,000 corresponding duplicates with true links available through `load_febrl4(return_links=True)`. The run validated the source IDs and constructed labels from those links, never from row order. ([linking guide](https://recordlinkage.readthedocs.io/en/stable/guides/link_two_dataframes.html), [dataset API](https://recordlinkage.readthedocs.io/en/stable/ref-datasets.html), [tagged FEBRL source](https://github.com/J535D165/recordlinkage/tree/v0.16/recordlinkage/datasets/febrl))

| File | Rows | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `dataset4a.csv` | 5,000 | 519,618 | `07c7cb3f0a8d88180e80317f2a60499dee4e8324a44c38059f4e7fed0a8b4488` |
| `dataset4b.csv` | 5,000 | 515,463 | `2eed76c99fa2237be3ec013a123427926d4158abcb3a8f65874d6c7f1358cf2c` |

Each file contains the same ten source attributes: given name, surname, street number, two address fields, suburb, postcode, state, date of birth, and social security identifier. Values were loaded as strings to preserve formatting. Missing values were present in both files and represented explicitly in features. The `soc_sec_id` values belong to the synthetic benchmark and are not real-world identifiers.

## Leakage controls and candidate generation

The 5,000 entities were split before pair creation into 3,500 train, 750 validation, and 750 test entities (70/15/15). Each entity's original and duplicate stayed together. Entity and source-record overlap were zero across all split pairs. No cross-partition pairs were generated.

There are 25,000,000 possible cross-file pairs overall; within the partitions, 13,375,000 pairs were possible. Exact non-missing blocks on given name, surname, date of birth, postcode, and `soc_sec_id` produced the following candidates:

| Split | Candidates | Positive | Negative | Blocker positive recall |
| --- | ---: | ---: | ---: | ---: |
| Train | 94,412 | 3,500 | 90,912 | 100% |
| Validation | 4,203 | 750 | 3,453 | 100% |
| Test | 4,814 | 750 | 4,064 | 100% |

The reported classifier metrics are conditional on candidates produced by this blocker. End-to-end test recall includes blocker misses; this benchmark run had none. The source's one-duplicate-per-original structure is unlike general production deduplication.

## Features and fitting

The model uses 30 pairwise features: Jaro-Winkler similarities for given name, surname, address 1, address 2, and suburb; exact agreement for street number, postcode, state, date of birth, and `soc_sec_id`; and both-missing/one-missing flags for each of the ten fields. Normalization applies Unicode NFKC, case-folding, and whitespace trimming. Record IDs, entity IDs, and labels are excluded from features.

A new Random Forest was fitted with 200 trees, square-root feature sampling, `balanced_subsample` class weights, maximum depth 8, and minimum leaf size 2. No oversampling or downsampling was used. Four parameter settings were compared using validation average precision; all four reached 1.0 on this validation candidate set, so the selected simpler depth-8 setting was not uniquely superior by that metric. Threshold 0.81 was selected on validation by maximum F1 with documented tie-breaking. The held-out test was scored after model and threshold selection.

## Results

| Metric | Validation | Test |
| --- | ---: | ---: |
| Candidate pairs | 4,203 | 4,814 |
| Accuracy | 1.000 | 1.000 |
| Balanced accuracy | 1.000 | 1.000 |
| Precision | 1.000 | 1.000 |
| Recall | 1.000 | 1.000 |
| F1 | 1.000 | 1.000 |
| ROC-AUC | 1.000 | 1.000 |
| Average precision (PR-AUC) | 1.000 | 1.000 |

Test confusion matrix at threshold 0.81: **TN 4,064, FP 0, FN 0, TP 750**. Test end-to-end recall, including blocking, was 1.000. The most-frequent-class baseline predicted every candidate as negative: accuracy 0.844, balanced accuracy 0.500, precision/recall/F1 0, and average precision 0.156. This baseline illustrates why accuracy alone is insufficient for the imbalanced candidate set.

The train candidate positive fraction was 3.71%; validation was 17.84% and test was 15.58%. This differs because blocking creates split-specific candidate pools. Metrics and threshold should therefore be interpreted in the context of the candidate-generation policy.

All validation parameter settings achieved perfect validation average precision and F1 at 0.5, and the final test result is also perfect. This means this synthetic benchmark and candidate pool did not expose a generalization gap; it does **not** establish robustness to unseen populations or data-generation patterns. Benchmark identifiers and corruption patterns are especially unlike operational Kenyan records. No claim about SBMS accuracy should be inferred from these scores. Operational use would require representative, independently labeled data, a review-cost-aware threshold, and monitoring.

## Reproducibility and artifacts

The complete machine-readable results, including per-split counts, metric details, model checksum, and environment versions, are in [`artifacts/metrics.json`](artifacts/metrics.json). Preparation counts and overlap assertions are in [`artifacts/preparation_report.json`](artifacts/preparation_report.json); raw-file checksums and download provenance are in [`data/dataset_manifest.json`](data/dataset_manifest.json). The model artifact is local and ignored by Git.

Environment: Python 3.11.9, scikit-learn 1.9.0, pandas 3.0.5, NumPy 2.4.6. Total tuning and evaluation runtime was 25.32 seconds; final test prediction took 0.13 seconds. The saved model SHA-256 is `9a7d08fca3f4bf46f2ad3488c23a2cc99aa4830a0bc8d3272523690ce8f898ed`. Reloading the saved model reproduced predictions on a 256-row validation sample within absolute tolerance `1e-12` (maximum difference `1.11e-16`).

Four unit tests for identity parsing, deterministic disjoint splitting, attribute-only blocking, and features without identifiers/labels passed. Reproduction commands are in [`README.md`](README.md).
