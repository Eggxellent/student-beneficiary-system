# FEBRL 4A/4B isolated record-linkage experiment

This research experiment trains a new Random Forest to classify candidate record pairs from FEBRL 4A and 4B. FEBRL is a synthetic benchmark made for record-linkage research; it is not Kenyan data and does not measure SBMS performance.

## Reproduce on Windows

From this directory, with Python 3.11:

```powershell
py -3.11 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
& .\.venv\Scripts\python.exe .\download_data.py
& .\.venv\Scripts\python.exe .\prepare_data.py
& .\.venv\Scripts\python.exe .\run_experiment.py
& .\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
```

The two raw CSVs are downloaded from the versioned Record Linkage Toolkit v0.16 source and stay local under `data/`; their provenance, byte lengths, and SHA-256 checksums are recorded in `data/dataset_manifest.json`. Use `--force` with `download_data.py` to replace existing files. Prepared feature CSVs and the model artifact stay under ignored local paths. The preparation report and final metrics are saved under `artifacts/`.

## Source data and labels

The [official linking guide](https://recordlinkage.readthedocs.io/en/stable/guides/link_two_dataframes.html) describes FEBRL records as fictitious, shows 5,000 rows and 10 attributes in 4A, and documents linking 4A to 4B. The [dataset API](https://recordlinkage.readthedocs.io/en/stable/ref-datasets.html) states that 4A has 5,000 originals and 4B has their 5,000 duplicates, and that `load_febrl4(return_links=True)` returns true links. In these source files those links are `rec-N-org` to `rec-N-dup-0`. The preparation code validates that structure and labels a candidate as positive only when its pair is in this documented link set. All other generated candidates are confirmed non-matches under the benchmark's one-to-one ground truth.

The raw columns are `given_name`, `surname`, `street_number`, `address_1`, `address_2`, `suburb`, `postcode`, `state`, `date_of_birth`, and `soc_sec_id`. They are loaded as strings so leading zeroes and identifier formatting are retained. The source includes missing values, which the feature step represents through explicit field-level missingness features. `soc_sec_id` is a synthetic benchmark attribute; it is not treated as an SBMS or Kenyan identifier.

## Pair generation and leakage control

There are 25,000,000 possible cross-file pairs (`5,000 × 5,000`). Exhaustively materializing their feature vectors is unnecessary for this experiment. Candidate generation unions exact, non-missing blocks on `given_name`, `surname`, `date_of_birth`, `postcode`, and `soc_sec_id`. The run reports candidate counts, class counts, blocking recall, and positive pairs missed by the blocker. Classifier scores are conditional on the blocked candidate set; end-to-end test recall also counts blocking misses.

The 5,000 ground-truth entities are shuffled with seed `20261022` and split 70%/15%/15% into 3,500/750/750 entities. Each original and its duplicate stay in the same partition. Candidate pairs are generated only after partitioning and only within each partition. Preparation checks entity-ID and source-record overlap between every pair of partitions and expects zero. Entity IDs, record IDs, and labels are never model features.

## Features and model

Text normalization applies Unicode NFKC, case-folding, and whitespace trimming. It does not fit learned preprocessing statistics. Features are:

- Jaro-Winkler similarity for `given_name`, `surname`, `address_1`, `address_2`, and `suburb`.
- Exact agreement for `street_number`, `postcode`, `state`, `date_of_birth`, and `soc_sec_id`.
- For each of the 10 source fields, flags for both values missing and exactly one value missing. Missing string comparisons score zero.

The primary classifier is a fresh `RandomForestClassifier` with 200 trees, `max_features="sqrt"`, `class_weight="balanced_subsample"`, fixed random seed, and validation-selected `max_depth` and `min_samples_leaf`. The class weighting leaves observed train/validation/test distributions intact; no resampling is applied. Hyperparameters are selected by validation average precision. The alert threshold is selected on validation by maximum F1, with ties resolved in favor of recall, then precision, then the higher threshold. The test split is scored once after selection.

A most-frequent-class dummy classifier is reported as a simple baseline. Model and threshold outputs are experiment artifacts only; no production model or backend code is changed.

## Interpretation

The report includes source profiles and checksums, split sizes and overlap counts, possible and generated pair counts, blocking recall, per-split class distributions, hyperparameter comparisons, validation metrics, final test metrics, the confusion matrix, a dummy baseline, runtime, model checksum, and a reload-equivalence check. A false positive is a different synthetic person flagged for review; a false negative is a true FEBRL link missed by the classifier. A match score is an alert for human review, not proof of identity.

FEBRL's one-duplicate-per-original setup, Australian-style fields, synthetic corruption patterns, exact identifier-like attributes, and benchmark blocking do not reproduce Kenyan student-beneficiary data quality, prevalence, administrative identifiers, or review costs. Even strong benchmark metrics cannot establish real SBMS accuracy.
