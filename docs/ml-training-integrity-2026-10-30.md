# Model overfitting and training/holdout integrity - 30 October 2026

**Question asked:** make sure the model does not overfit, and do not judge it on the data
it was trained on.

**Verdict: pass.** The shipped artifact is trained on `training/realistic_pairs_train.csv`
only, and every reported score comes from `evaluation/realistic_pairs_holdout.csv`, which
shares no pair group, no person identity and no identical row with the training data. The
gap between in-sample and holdout performance is **1.33 percentage points of F1**, and
grouped cross-validation reproduces the holdout score to within **0.0004 F1**. That is the
signature of a model that generalises, not one that memorises.

Nothing was retrained. The artifact is byte-identical before and after this audit
(`6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9`), so there is no
deployment risk attached to this finding.

## 1. What was measured

Harness: `ml-service/check_training_integrity.py` (read-only; exit code 0 = pass).
Raw output: `ml-service/evaluation/training_integrity_report.json`.

```powershell
cd ml-service
.\.venv\Scripts\python.exe .\check_training_integrity.py
```

| Question | Measurement | Result |
| --- | --- | --- |
| Is the artifact the one the metrics describe? | sha256 of model, training file, holdout file vs `realistic_pairs_xgboost_training_metrics.json` | all three match |
| Could a holdout row have been memorised? | shared `group_id` across splits | 0 |
| Could a person appear in both splits? | shared identities (name/DOB/UPI key) | 0 |
| Literal duplicated rows across splits? | exact row comparison on all raw fields | 0 |
| Is the holdout declared excluded from fitting? | `holdout_used_for_training_or_tuning` | `false` (asserted by the training script) |
| Does the model merely memorise? | in-sample F1 vs holdout F1 | 0.9196 vs 0.9063 (+0.0133) |
| Is the holdout score reproducible on unseen groups? | 5-fold `StratifiedGroupKFold` inside the training file | 0.9067 mean F1 (holdout 0.9063) |
| Does any single feature determine the label? | per-feature ROC-AUC | 0.34 - 0.71, no shortcut |

## 2. Learning curve (trained on shares of the training groups, scored on the untouched holdout)

| Training data | Rows | Holdout F1 | Holdout ROC-AUC |
| --- | ---: | ---: | ---: |
| 10% of groups | 1 200 | 0.8886 | 0.9569 |
| 25% of groups | 3 000 | 0.8989 | 0.9643 |
| 50% of groups | 6 000 | 0.9010 | 0.9659 |
| 100% of groups (as shipped) | 12 000 | 0.9063 | 0.9685 |

The curve is already close to flat at one tenth of the data and gains less than two points
of F1 across a tenfold increase. A model that had memorised its training rows would show
the opposite shape: strong in-sample scores with a steep collapse on the holdout.

## 3. Per-feature discrimination, training vs holdout

| Feature | Training AUC | Holdout AUC |
| --- | ---: | ---: |
| `jaro_winkler` | 0.7041 | 0.7101 |
| `dob_match` | 0.6927 | 0.6894 |
| `school_match` | 0.3389 | 0.3384 |
| `guardian_match` | 0.5003 | 0.5041 |
| `upi_match` | 0.6688 | 0.6716 |
| `birth_certificate_match` | 0.6731 | 0.6822 |

Two things follow. First, no feature approaches AUC 0.95, so this dataset does not contain
the generator shortcut that made the old `data/raw_pairs.csv` results meaningless (there
`birth_certificate_match` alone scored 0.953). Second, every feature behaves the same way
in both splits, which means the two splits really are drawn from the same distribution.

## 4. What the serving path is allowed to do

`ml-service/predict.py` is scanned on every run for `.fit(`, `GridSearchCV`,
`joblib.dump`, `train_model` and `train_test_split`. It contains none of them: the process
loads one `joblib` artifact and only calls `predict_proba`. The backend has no reference
to training anywhere in `backend/src`, so no registration, review or admin action can
change the model. A model that learned from live registrations could not be audited this
way, which is why the scan is part of the guard rather than a one-off check.

## 5. The one honest caveat

`realistic_pairs_xgboost_training_metrics.json` records
`holdout_used_for_model_selection: true`. The same holdout was used to choose XGBoost over
Random Forest, so the holdout numbers are **selection-optimistic** for "XGBoost, as
deployed". This is a mild effect, not leakage: the holdout never entered `fit`, and the
grouped CV score of 0.9067 - computed entirely inside the training file, with no reference
to the holdout - lands within 0.0004 of the holdout score. If the selection had been
driven by holdout noise, CV would sit visibly lower.

The rule going forward is unchanged and worth stating plainly: a *final* unbiased number
requires a third set that has never been used for fitting or for choosing anything. That
is what adjudicated real review pairs (D1/D5 in `docs/ml-evaluation-policy.md`) will
provide. Until then, treat 0.9063 F1 as "best available estimate", not "final score".

The other standing limitation is unchanged: all of this data is synthetic. The numbers
describe the simulator. They cannot establish accuracy on real beneficiaries.

## 6. What is now enforced

`ml-service/tests/test_training_integrity.py` (9 tests, 1.8 s for the whole ml-service
suite of 19) fails the build if a future change:

- retrains on the holdout, or regenerates a split with overlapping groups or people;
- replaces the artifact without updating its recorded hash, so the metrics no longer
  describe the deployed file;
- lets the in-sample/holdout F1 advantage exceed 0.10, or drifts the holdout away from
  grouped CV by more than 0.03;
- introduces a feature that alone predicts the label (AUC >= 0.95);
- adds training or serialisation calls to the serving path.

Two tests also cover the checker itself, so a broken matcher cannot quietly report "no
leakage": placeholder values (`NOT PROVIDED`, `NaN`) must not create phantom identity
collisions, and genuinely identical people across splits must be detected.

## 7. Reproducing

```powershell
cd ml-service
.\.venv\Scripts\python.exe .\check_training_integrity.py                    # full audit, ~30 s
.\.venv\Scripts\python.exe .\check_training_integrity.py --fast             # skip CV and curve
.\.venv\Scripts\python.exe -m unittest discover -s tests -v                 # 19 tests
```

The audit never writes to `training/` or to the holdout CSV, and it never overwrites the
deployed artifact. Its only output is the JSON report named by `--output`
(default `evaluation/training_integrity_report.json`).
