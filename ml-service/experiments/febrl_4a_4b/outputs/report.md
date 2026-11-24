# FEBRL 4A/4B independent pair-classification experiment

> FEBRL is synthetic. These results do not establish accuracy on Kenyan beneficiary records.

## Dataset and labels

The experiment uses FEBRL 4A originals and 4B corrupted copies. The documented numeric portion of `rec_id` supplies the shared entity key. That key is used only to label pairs and split entities; it is excluded from model inputs.

Dataset source: [https://github.com/J535D165/recordlinkage](https://github.com/J535D165/recordlinkage). Files and SHA-256 hashes are recorded in `dataset_metadata.json`.

## Entity split and candidate generation

Entities were split 70/15/15 (train/validation/test; seed 20261022) before pairs were built. All cross-file candidates sharing an exact normalized value on at least one of given name, surname, date of birth, social security ID, postcode, or suburb were retained. There is no cross-partition pairing.

| Partition | Entities | 4A records | 4B records | Candidate pairs | Positive | Negative | Blocking recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| train | 3500 | 3500 | 3500 | 103381 | 3500 | 99881 | 1.0000 |
| validation | 750 | 750 | 750 | 5148 | 750 | 4398 | 1.0000 |
| test | 750 | 750 | 750 | 5390 | 750 | 4640 | 1.0000 |

## Model and evaluation

Fresh `RandomForestClassifier` with 300 trees, Gini criterion, unlimited depth, minimum leaf size 2, sqrt feature sampling, balanced-sub-sample class weights, and seed 20261022. No resampling or existing model was used. Threshold was chosen on validation by maximum F1; ties select the higher threshold.

Test decision threshold: **0.511327**. Candidate-set class counts: 750 positive and 4640 negative.

| Metric | Test result |
|---|---:|
| accuracy | 0.9998 |
| precision | 1.0000 |
| recall | 0.9987 |
| f1 | 0.9993 |
| roc_auc | 1.0000 |
| pr_auc_average_precision | 1.0000 |

Confusion matrix: TN 4640, FP 0, FN 1, TP 749.
Test blocking candidate recall: 1.0000; classifier recall among admitted candidates: 0.9987; their product is 0.9987 as an approximate end-to-end recall over true FEBRL links.

A false positive is a different synthetic person pair flagged for review; a false negative is a true pair missed among generated candidates. Blocking misses are separately reflected in blocking recall. Precision is conditional on this candidate-generation strategy and must not be read as deployment precision at another pair prevalence.

The very high results were investigated. The exact-agreement diagnostics and feature importances in `results.json` show how strongly particular synthetic attributes separate candidates. In this FEBRL test candidate set, some exact address and social-security-ID agreements occurred only on true links; this is an inherent property of this synthetic sample and increases separability. It is not a Kenyan deployment estimate or evidence that such fields are equally reliable in SBMS.

## Features and limits

For each of the ten available attributes (given name, surname, street number, address fields 1 and 2, suburb, postcode, state, date of birth, social security ID), features are normalized Jaro-Winkler similarity, exact normalized agreement, both-missing, and one-missing indicators. Identifiers and ground truth do not enter features. No SBMS-specific school, guardian, UPI, or birth-certificate fields exist in FEBRL. FEBRL is fictitious Australian-style person data, not Kenyan beneficiary data; production use would require authorized, representative Kenyan data and independent validation, including candidate recall and human-review outcomes.

## Reproduction

From the repository root, run `python ml-service/experiments/febrl_4a_4b/download_data.py` and then `python ml-service/experiments/febrl_4a_4b/run_experiment.py`. Exact dependency versions are in `requirements.txt`.
