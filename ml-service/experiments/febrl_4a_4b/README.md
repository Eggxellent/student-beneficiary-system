# FEBRL 4A/4B experiment

This independent experiment trains a fresh Random Forest pair classifier using FEBRL 4A/4B. It is isolated from the SBMS production model and application.

## Run

From the repository root in PowerShell:

```powershell
python ml-service/experiments/febrl_4a_4b/download_data.py
python ml-service/experiments/febrl_4a_4b/run_experiment.py
```

Install the pinned dependencies with:

```powershell
python -m pip install -r ml-service/experiments/febrl_4a_4b/requirements.txt
```

The download script records retrieval time, official source URLs, file sizes, and SHA-256 hashes in `dataset_metadata.json`. Raw CSVs under `data/` are ignored by Git. Results and the report are written under `outputs/`.

## Labels, split, and candidates

The [Record Linkage Toolkit documentation](https://recordlinkage.readthedocs.io/en/stable/guides/link_two_dataframes.html) describes 4A as 5,000 originals and 4B as their 5,000 corrupted copies. `load_febrl4(return_links=True)` in the toolkit implementation returns links by matching `rec-<entity>-org` with `rec-<entity>-dup-0`. The numeric key is used to construct labels and split by entity before pairs are generated; it is never a feature.

The split is 70/15/15 by entity with seed `20261022`. Candidate generation is a union of exact normalized-value blocks on given name, surname, date of birth, social security ID, postcode, or suburb. All pairs admitted by the blocks are used. The report separately gives blocking recall because a classifier cannot recover true links omitted by candidate generation. Metrics are conditional on this candidate set and should be interpreted with its class prevalence.

## Features and model

Each of the ten present person attributes gets Jaro-Winkler similarity, exact normalized agreement, both-missing, and one-missing features. Record IDs, entity keys, row positions, and labels are excluded. Deterministic normalization requires no learned fitting. The primary model is a fresh `RandomForestClassifier`; its threshold is selected by maximum validation F1 with a higher-threshold tie break. Test data is used once for final evaluation.

FEBRL is synthetic and does not establish accuracy on Kenyan beneficiary records. School, guardian, UPI, and birth-certificate fields used or proposed by SBMS are absent here.
