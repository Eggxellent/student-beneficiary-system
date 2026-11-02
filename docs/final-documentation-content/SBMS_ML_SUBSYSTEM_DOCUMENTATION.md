# SBMS ML SUBSYSTEM DOCUMENTATION

**Prepared:** 2026-11-02
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Sources read:** `ml-service/feature_engineering.py`, `ml-service/predict.py`, `backend/src/services/duplicateCheck.js`, `backend/src/services/mlDuplicateReview.js`, `backend/src/services/duplicateAggregation.js`, `backend/src/controllers/students.controller.js`, `docs/ml-decision-sheet-2026-10-30.md`, `docs/ml-evaluation-baseline-2026-10.md`, `docs/ml-training-integrity-2026-10-30.md`, `ml-service/reports/sbms_dataset_experiment.md`.

---

## 1. What is deployed, what is research

| Item | Status | Identity |
| --- | --- | --- |
| Production classifier | **Deployed and called on every registration** | `XGBClassifier` inside a scikit-learn pipeline, six features, artifact `ml-service/model/xgb_duplicate_model.joblib`, model version `xgboost:6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9` |
| Random Forest | **Not deployed.** Research candidate only | `ml-service/model/research/rf_attachment_style_candidate.joblib`; the application never loads it |
| Research ten-feature model on the supplied archive | **Not deployed and structurally incompatible with the serving path** | `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` (183 445 bytes, separate hash) |
| Review cut-off | **Deployed, provisional** | 0.50 (`ML_REVIEW_SCORE_THRESHOLD`), `thresholds_validated: false` |
| High-priority cut-off | **Deployed, provisional, presentation only** | 0.70 (`DUPLICATE_HIGH_PRIORITY_THRESHOLD`) |
| Human adjudication | No adjudicated pair exists | `ml-service/evaluation/reviewed_pairs_template.csv` is header-only |

The approved proposal specified a Random Forest over four features. What runs is an XGBoost classifier over six. That is a design deviation (G-21), reported as a deviation rather than reconciled, because a reader must not be told the proposal was followed when it was not.

## 2. Integration architecture

| Element | Implementation | Consequence |
| --- | --- | --- |
| Where scoring happens | Node service `backend/src/services/duplicateCheck.js` spawns `python predict.py --server` and exchanges newline-delimited JSON over stdio | No HTTP hop, no extra port, one container |
| Request shape | `{pairs: [{first, second}, ...]}` with raw student records | The feature builder runs in Python, so training and serving share one implementation |
| Response shape | `{model_version, results: [{score, features}]}` | Score and the six feature values come back together and are stored with the case |
| Model version | SHA-256 of the artifact file, prefixed `xgboost:` | A stored case names the exact bytes that scored it |
| Failure mode | Predictor unavailable or timed out → registration aborts with **503** and no student row is created | An unscreened beneficiary cannot be registered silently (NFR-20) |
| Batching | All candidates for one registration are sent in a single request | One subprocess round trip per registration, not per pair |
| Training calls in the serving path | None: `predict.py` contains no `.fit(`, `GridSearchCV`, `joblib.dump` or `train_test_split`, and the assertion is enforced by `ml-service/tests/test_training_integrity.py` | Live registrations cannot change the model |

The Python process is long-lived for the life of the API process and is restarted with it. It is not a REST service, and it has no authentication of its own, because it is reachable only through the Node process's stdin.

## 3. Feature specification (the six model inputs)

`ml-service/feature_engineering.py` is the single source of truth; the training scripts and `predict.py` both import it.

| # | Feature | Type and range | Definition | Missing-value behaviour |
| --- | --- | --- | --- | --- |
| 1 | `jaro_winkler` | float 0-1 | **Maximum** of Jaro-Winkler similarity on the concatenated name tokens and on the alphabetically sorted tokens | 0.0 if either side is missing |
| 2 | `dob_match` | float in {0, 0.5, 0.8, 1.0} | 1.0 same date; 0.8 one day apart; 0.5 within seven days; 0.0 otherwise | 0.0 if either side is missing or unparseable |
| 3 | `school_match` | int {0, 1} | Exact match after removing non-alphanumerics and case-folding | 0 |
| 4 | `guardian_match` | float 0-1 | Identifier similarity after stripping shared prefixes (`guardian`, `guard`, `upi`, `student`, `bc`, `g`); 1.0 when equal | 0.0 |
| 5 | `upi_match` | float 0-1 | As above for the UPI | 0.0 |
| 6 | `birth_certificate_match` | float 0-1 | As above for the birth certificate number | 0.0 |

Accepted date patterns are `%Y-%m-%d`, `%Y/%m/%d`, `%d/%m/%Y`, `%d-%m-%Y` and `%d.%m.%Y`. Kenyan day-first convention is assumed; an ambiguous US-style date is deliberately not treated as a confident match, which is the behaviour asserted by `backend/tests/predictorDateNormalization.test.js` (6 tests).

"Missing" is a defined set, not merely an empty string: `''`, `?`, `NA`, `N/A`, `NONE`, `NULL`, `UNKNOWN`, `NOT PROVIDED`, `NOT AVAILABLE`, any value that is all zeros with length four or more, and any value with no alphanumeric characters. A shared placeholder such as `NOT PROVIDED` on both rows therefore produces similarity 0, not 1 — the defect class the integrity checker explicitly tests for.

## 4. Prediction contract

| Function | Input | Output | Used by |
| --- | --- | --- | --- |
| `predict(data)` | one dict of the six named features | `{probability}` rounded to four decimals | Unit tests, one-off scoring |
| `predict_many(list)` | list of feature dicts | list of `{probability}` | Batch paths |
| `predict_pairs(pairs)` | `[{first, second}]` raw records | `[{score, features}]` | The Node service, via the `--server` protocol |
| `predict_duplicate(first, second, threshold=0.5)` | two raw records | `{duplicate_probability, is_duplicate, features}` | Not called by the API; a convenience wrapper used in the service tests |
| `model_version()` | — | `xgboost:<sha256 of artifact bytes>` | Every stored case and every registration response |

`probability` is the raw positive-class score of the classifier. It is **not** a calibrated probability, and the registration response says so explicitly with `score_is_calibrated_probability: false`. A score of 0.6 does not mean "60% chance of being a duplicate"; it means "above the provisional review cut-off".

## 5. Thresholds in force

| Threshold | Value | Environment variable | Effect | Validation status |
| --- | --- | --- | --- | --- |
| Model review cut-off | 0.50 | `ML_REVIEW_SCORE_THRESHOLD` | A pair at or above this score becomes a review case | `thresholds_validated: false`; F1 is flat from 0.30 to 0.60, so no value in that band is defensible over another on the available evidence |
| High-priority cut-off | 0.70 | `DUPLICATE_HIGH_PRIORITY_THRESHOLD` | Presentation only: the case is badged `high`; it cannot approve, reject or pay anything | Provisional; changes ordering, not decisions |
| Legacy review threshold setting | 0.30 | `DUPLICATE_REVIEW_THRESHOLD` | Stored with the case and shown to the administrator as the `standard` band | Kept for compatibility with the settings screen |

All three are readable and updatable at runtime through `GET`/`PUT /api/settings/threshold` (administrator only), and an update is written to the audit log. The values live in process memory (`backend/src/config/settings.js`), so a restart restores the environment defaults. That is a deliberate, documented limitation: a change made through the screen does not survive a redeploy.

## 6. Training data and provenance

| Item | Value |
| --- | --- |
| Training file | `ml-service/training/realistic_pairs_train.csv` — 12 000 labelled pairs over 6 000 groups |
| Holdout file | `ml-service/evaluation/realistic_pairs_holdout.csv` — 12 000 pairs / 6 000 groups |
| Generator | `ml-service/generate_realistic_pairs.py`, seeded, with scripted corruption patterns |
| Positives | `repeat_application` only — one duplicate pattern |
| Negatives | Deliberately hard: siblings, twins and close ages, identifier collisions, common names, unrelated |
| Overlap between splits | 0 shared groups, 0 shared identities, 0 identical rows (measured) |
| Holdout used for fitting | `false`, asserted by the training script |
| Holdout used for model selection | `true` — the same holdout chose XGBoost over Random Forest, so the reported numbers are selection-optimistic |
| Library versions | Python 3.11.9, XGBoost 3.2.0, scikit-learn 1.9.0, pandas 3.0.5, jellyfish 1.2.1, joblib 1.6.0 |
| Seed | 42 |

## 7. Measured performance (synthetic holdout — not an accuracy claim)

Per-pair results on the 12 000-pair holdout at each cut-off, from `ml-service/evaluation/operating_point_2026-10-30.json`:

| Cut-off | Precision | Recall | F1 | Miss rate | FPR on hard negatives | Review share |
| --- | --- | --- | --- | --- | --- | --- |
| 0.30 | 0.8694 | 0.9352 | 0.9011 | 6.48% | 14.05% | 53.78% |
| 0.40 | 0.8985 | 0.9132 | 0.9058 | 8.68% | 10.32% | 50.82% |
| **0.50 (live)** | **0.9204** | **0.8927** | **0.9063** | **10.73%** | **7.72%** | **48.49%** |
| 0.60 | 0.9404 | 0.8647 | 0.9009 | 13.53% | 5.48% | 45.97% |
| 0.70 | 0.9607 | 0.8270 | 0.8888 | 17.30% | 3.38% | 43.04% |
| 0.80 | 0.9791 | 0.7797 | 0.8681 | 22.03% | 1.67% | 39.82% |
| 0.90 | 0.9899 | 0.7037 | 0.8226 | 29.63% | 0.72% | 35.54% |

Ranking quality: ROC-AUC 0.9685, PR-AUC 0.9727. Best F1 is 0.9065 at 0.35; the live 0.50 scores 0.9063 and has the highest Youden J (0.8155). F1 is flat across 0.30-0.60, which is why the cut-off is described as provisional rather than tuned.

Overfitting checks (`docs/ml-training-integrity-2026-10-30.md`):

| Check | Result |
| --- | --- |
| In-sample F1 versus holdout F1 | 0.9196 versus 0.9063 — a 1.33-point gap |
| 5-fold grouped cross-validation inside the training file | 0.9067 mean F1, within 0.0004 of the holdout |
| Learning curve (10% → 100% of groups) | 0.8886 → 0.9063 F1, close to flat |
| Per-feature ROC-AUC | 0.34-0.71; no feature approaches 0.95, so there is no generator shortcut |

The independent per-pair false-positive baseline on 2 000 synthetic unrelated pairs (`docs/ml-evaluation-baseline-2026-10.md`) is **0.35% at cut-off 0.50** (7 pairs), with 0.15% when names are distinct. The 7.72% figure in the table above is measured on a negative set enriched with confusable cases and is **not** interchangeable with 0.35%; both must be reported together or neither.

## 8. From score to case: the registration decision path

Registration never compares only a candidate subset; it scores the new record against every existing student and then applies an aggregation policy.

| Step | Implementation | Output |
| --- | --- | --- |
| 1. Lock | `pg_advisory_xact_lock(hashtext('sbms.student.registration'))` inside a transaction | Serialises concurrent registrations so two registrations cannot interleave their comparisons |
| 2. Candidate set | `SELECT ... FROM students ORDER BY created_at ASC, id ASC FOR UPDATE` | Every existing record, frozen for the transaction |
| 3. Scoring | `scorePairs([{first: submitted, second: candidate}])` in one Python call | A score and feature vector per candidate |
| 4. Exact identifier evidence | `exactReviewIdentifierMatches` compares UPI, birth certificate and national ID | `exact_identifier_matches[]` per case |
| 5. Qualification | Score >= `ML_REVIEW_SCORE_THRESHOLD` **or** an exact identifier agreement | Qualifying candidates |
| 6. Aggregation | `summarizeAggregation` with policy `top-1` (default) or `all` | At most one case, or one case per pair |
| 7. Persistence | `INSERT INTO duplicate_flags ... ON CONFLICT DO NOTHING` | One row per surviving candidate |
| 8. Audit | `duplicate_candidates_considered`, `_qualifying`, `_suppressed`, `_flags_created`, model version, threshold, policy | Audit row plus the `duplicate_screening` response block |

The `top-1` policy ranks exact identifier agreement above score, then score. Its purpose is to stop the review queue growing with registry size: with one case per registration the queue grows linearly in *registrations* rather than in *registrations × registry size*.

The arithmetic that motivated the policy, using the measured per-pair rate p = 0.0035 at cut-off 0.50:

| Existing students N | Expected flags per registration before the fix | Probability of at least one nuisance flag |
| --- | --- | --- |
| 100 | 0.35 | 29.6% |
| 500 | 1.75 | 82.7% |
| 1 000 | 3.5 | 97.0% |
| 5 000 | 17.5 | ~100% |

Holding a 1% registration-level nuisance rate at N = 1 000 would need p <= about 0.001%, roughly 350 times lower than the measured 0.35%. Cut-off tuning therefore cannot substitute for better features, blocking or the corroboration policy. The `top-1` change caps the number of cases per registration; it does **not** reduce the probability that a particular legitimate registration receives one.

## 9. Review policy and what the administrator sees

| Field | Computed by | Meaning |
| --- | --- | --- |
| `risk_level` | fixed `review` | A case exists and no decision has been made. There is deliberately no `critical` level, because no score makes a decision |
| `priority` | `reviewPriority({score, highPriorityThreshold, exactIdentifierCount})` in `mlDuplicateReview.js`, shared by the registration response and the queue | `high` when an identifier agrees exactly or the score reaches 0.70; otherwise `standard` |
| `exact_identifier_matches` | `exactReviewIdentifierMatches` | `['UPI']`, `['birth certificate number']`, `['National ID']` and combinations |
| `review_reason` | registration controller | An exact-match sentence naming the identifier, or a sentence naming the provisional cut-off |
| Stored provenance | `duplicate_flags` columns | `model_version`, `review_threshold`, `comparison_features` |
| Masked identifiers | `duplicateFlags.controller.js:37-42` | Only the last three characters are shown until an audited reveal |

The officer's confirmation screen shows plain language and no model internals: a possible-match sentence, the exact-identifier sentence when applicable, and counts ("checked against N existing students; M flagged; K recorded in the audit log without a separate case"). The administrator's queue shows the score, model version, both cut-offs and the aggregation policy, with the explicit statement that the thresholds are provisional.

## 10. Research artefacts deliberately excluded from the deployed claim

| Artefact | Why it cannot be used as evidence for the deployed system |
| --- | --- |
| `ml-service/experiments/sbms_dataset/` (ten-feature schema, 16 800/2 400/4 800 split) | Adds four presence and conflict flags and drops `upi_match` and `birth_certificate_match`; the archive has no UPI or birth-certificate values and its school labels are not the five SBMS schools, so the artefact cannot be loaded by `predict.py` |
| Supplied-archive results (XGBoost precision 0.906, recall 0.846, PR-AUC 0.953 at 0.50) | Properties of a different, incompatible synthetic archive at 25% positive prevalence; the research model was never integrated |
| `realistic_pairs_xgboost_training_metrics.json` older generations | Superseded; the current holdout figures are the ones in §7, and the integrity checker fails the build if the artifact hash stops matching the metrics |
| `ML_RELIABILITY_REPORT.md` Random Forest figures | Describe a candidate that the application never loads |

Reporting any of these as the production model's performance would be false. They are useful only as comparison evidence and are labelled as research in Chapter Five.

## 11. What this subsystem cannot support, and why

| Claim | Status | Blocked by |
| --- | --- | --- |
| "The system detects duplicates accurately" | **Cannot be supported** | No adjudicated labels exist (D5); every label is synthetic |
| Real-world precision, recall or miss rate | Unmeasured | As above |
| Applicant-population false-positive rate | Unmeasured | The negative sets are synthetic and either random or deliberately enriched |
| "The 0.50 cut-off is the right one" | Unsupported | F1 is flat from 0.30 to 0.60; no owner cost policy exists (D2/D3) |
| Duplicate patterns other than `repeat_application` | Untested | The generator produces one positive pattern |
| Generalisation beyond the simulator | Unknown | Synthetic name, school and identifier distributions |
| Stability across retraining | Unknown | One artifact, one seed; any retrain invalidates the recorded numbers |
| Real-world latency at registry scale | Unmeasured | Screening is linear in N; the only timing recorded is 22.67 ms for 50 pairs |

Two further limitations belong in the report even though they are not model weaknesses. First, registration compares against the entire registry, so the cost per registration grows with the register and the administrator-initiated rescan is quadratic (FR-34). Second, the review queue's ranking is by score and exact-identifier agreement only; it has no notion of reviewer workload, so a surge produces a backlog rather than a prioritised list.

## 12. Decisions still owned by the programme owner

| ID | Decision | Why the model cannot close it |
| --- | --- | --- |
| D1 | Adjudication protocol and reviewers | Only adjudicated pairs can produce real precision and recall |
| D2 | Acceptable miss rate | A trade-off between missed duplicates and review volume; a value judgement |
| D3 | Review capacity | Determines which cut-off is affordable |
| D4 | Candidate blocking | A behavioural change to the controller; requires approval and new tests |
| D5 | Adjudication ownership and data-protection basis | Required before any real pair is labelled |

Providing a recommended default for each of D1-D5 is legitimate; presenting a default as the owner's decision is not. `docs/ml-decision-sheet-2026-10-30.md` keeps that distinction explicit, and this file follows it.

## 13. Reproduction

```powershell
cd ml-service
.\.venv\Scripts\python.exe -m unittest discover -s tests -v            # 33 tests
.\.venv\Scripts\python.exe .\check_training_integrity.py               # leakage and hash audit, ~30 s
.\.venv\Scripts\python.exe .\evaluate_operating_point.py               # writes the operating-point JSON, ~25 s
.\.venv\Scripts\python.exe .\evaluate_false_positive_rate.py --output .\evaluation\fpr_baseline_2026-10-30.json
.\.venv\Scripts\python.exe -m unittest discover -s experiments/sbms_dataset -p test_experiment.py   # 7 research tests
```

All five commands are read-only with respect to the artifact: none trains, overwrites or serialises a model. The integrity checker exits non-zero if the committed report stops describing the live artifact, if the holdout and training splits overlap, if serving features drift from the generator's, or if a feature alone predicts the label.

## 14. Evidence index

| Statement in this file | Source |
| --- | --- |
| Six feature definitions and missing-value rules | `ml-service/feature_engineering.py:11-116` |
| Artifact path, version string, protocol | `ml-service/predict.py:14,50-111` |
| 503 on predictor failure | `backend/src/controllers/students.controller.js:74-96`; `docs/FINAL_TEST_REPORT.md` |
| Cut-off defaults and runtime mutation | `backend/src/config/settings.js` |
| Holdout metrics at each cut-off | `docs/ml-decision-sheet-2026-10-30.md` §1 |
| False-positive baseline | `docs/ml-evaluation-baseline-2026-10.md` §2 |
| Leakage and learning-curve checks | `docs/ml-training-integrity-2026-10-30.md` §1-§3 |
| `top-1` aggregation and its limits | `docs/ml-evaluation-baseline-2026-10.md` §4 |
| Review priority and masking | `backend/src/services/mlDuplicateReview.js`; `docs/frontend-verification-2026-10-30.md` §1 |
| Research incompatibility | `ml-service/reports/sbms_dataset_experiment.md` §"Compatibility and limits" |



