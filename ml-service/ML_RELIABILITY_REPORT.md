# SBMS ML training diagnosis

**Run date:** 2026-10-20  
**Mainline branch:** `dev` (the repository has no branch named `main`)

## Finding

The open `data/raw_pairs.csv` contains a severe synthetic label shortcut. All 5,000 positive rows have `birth_certificate_match = 1`; 471 of 5,000 negative rows do. That single feature has ROC-AUC **0.953** on the full dataset. The high scores previously reported from this dataset therefore describe its generator rules, not reliable duplicate detection.

The standard `train.py` / `train_model.py` commands on this branch do **not** read `data/raw_pairs.csv`. They train from separately generated attachment-style pairs with labels tied to a latent identity. Their grouped cross-validation F1 ranged **0.700–0.732**, internal test F1 was **0.710**, and disjoint synthetic holdout F1 was **0.695**. The small gap does not indicate classic overfitting. Recall on that holdout was only **0.538**, so the synthetic model misses many positive pairs.

An additional grouped analysis of `raw_pairs.csv` produced 98.61% test F1, but its separate scenario challenge produced only **0.665 F1** and **0.498 recall**. Birth-certificate-only ablation still scored **0.945 F1** on the grouped test set. This is direct evidence that the raw-pairs metrics are driven by generator-specific shortcuts and do not transfer to the challenge scenarios.

## Changes made

- Added per-feature positive/negative means and single-feature ROC-AUC diagnostics to `retrain_attachment_style.py` and its metrics report. This makes label shortcuts visible in future training runs.
- Kept training and evaluation group-separated; the external holdout is not used for fitting or tuning.
- Kept the result as a research candidate. No candidate was promoted into the model loaded by the application because all available evaluations are synthetic.
- Left `data/raw_pairs.csv` unchanged. It is not used by the branch's standard training commands.

## Current candidate run

| Data / split | F1 | Recall | Interpretation |
|---|---:|---:|---|
| Attachment-style grouped CV folds | 0.700–0.732 | — | Training stability across groups |
| Attachment-style internal test | 0.710 | 0.552 | Same generator, unseen groups |
| Attachment-style independent holdout | 0.695 | 0.538 | Disjoint synthetic value domains |
| Raw-pairs scenario challenge | 0.665 | 0.498 | Distribution shift; not real-world validation |

On attachment-style data, the strongest single feature was birth-certificate match, with AUC **0.723** on training and **0.724** on the independent holdout. That is much less dominant than the **0.953** AUC on `raw_pairs.csv`, but still reflects synthetic assumptions. Exact identifier agreement may be useful review evidence; it should not be treated as proof of identity by the classifier.

## Artifacts and limits

- Detailed attachment-style metrics: `evaluation/attachment_style_retraining_metrics.json`
- Raw-pairs and scenario-challenge summary: this report
- Research candidate: `model/research/rf_attachment_style_candidate.joblib`

No dataset in this run contains independently verified SBMS identity outcomes. These metrics cannot establish live accuracy or prevalence. A defensible production retrain requires appropriately authorized, human-reviewed duplicate and non-duplicate outcomes, split by student identity (and ideally by time or school), with a final untouched evaluation set.
