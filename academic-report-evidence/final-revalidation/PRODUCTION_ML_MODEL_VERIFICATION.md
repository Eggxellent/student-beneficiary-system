# PRODUCTION ML MODEL VERIFICATION

> Inspected 2026-11-03. Sources: `ml-service/predict.py`, `ml-service/feature_engineering.py`,
> `backend/src/services/duplicateCheck.js`, `backend/src/services/mlDuplicateReview.js`,
> `backend/src/services/duplicateAggregation.js`, `backend/src/config/settings.js`,
> `ml-service/evaluation/*.json`, `ml-service/model/*.joblib`.

## 1. What the production model actually is

| Question | Answer | Evidence |
| --- | --- | --- |
| Production algorithm | **XGBoost gradient-boosted trees** (`xgboost.XGBClassifier`) | `ml-service/train_model.py`; metric file records `n_estimators 250, max_depth 4, learning_rate 0.05, subsample 0.9, colsample_bytree 0.9, reg_lambda 1` |
| Artifact | `ml-service/model/xgb_duplicate_model.joblib` | file exists, 421,089 bytes |
| Artifact hash | `sha256 6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9` | `Get-FileHash -Algorithm SHA256` |
| Version string returned by the service | `xgboost:6ec9f2a3…` | `fpr_baseline_2026-10-30.json.model_version` matches the hash above — the stored evaluation was produced by **this** artifact |
| Artifact git history | one commit, `f383a79 "Use XGBoost with Jaro-Winkler name feature"` | `git log -- ml-service/model/xgb_duplicate_model.joblib` |
| Research-only artifact | `ml-service/model/research/rf_attachment_style_candidate.joblib` (10-feature Random Forest) | must never be cited as production |
| Proposal's method | Random Forest over four similarity features (FR-31) | `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` FR-31, transcribed from the approved proposal |

**Verdict:** the delivered classifier is XGBoost, not the proposal's Random Forest. This is a genuine deviation,
not a naming difference, and it must be stated as such in Chapters 4, 5 and 6.

## 2. Features, order and preprocessing

`ml-service/feature_engineering.py:11` — `FEATURE_COLUMNS`, in this exact order:

1. `jaro_winkler` — Jaro–Winkler similarity of normalised full names (`jellyfish`), continuous 0–1
2. `dob_match` — 1 when the parsed dates of birth are equal, else 0
3. `school_match` — 1 when school codes are equal
4. `guardian_match` — 1 when normalised guardian identifiers are equal
5. `upi_match` — 1 when normalised UPI values are equal
6. `birth_certificate_match` — 1 when normalised birth-certificate numbers are equal

Preprocessing: a single shared builder, `build_pair_features()`, used by both training and inference (the module is
documented as "single source of truth for the six SBMS student-pair model inputs"). Normalisation strips case and
non-alphanumerics; a `MISSING_VALUES` set (`""`, `?`, `NA`, `N/A`, `NONE`, `NULL`, `UNKNOWN`, `NOT PROVIDED`,
`NOT AVAILABLE`) plus all-zero placeholders are treated as absent so two missing values never "match". Dates are
normalised to `YYYY-MM-DD` **before** reaching the predictor (`mlDuplicateReview.dateOnly`), because `pg` returns
`DATE` columns as local-midnight `Date` objects that would otherwise serialise to the previous calendar day.

**Important omission to report honestly:** `national_id_number` is captured and used as *exact-match review
evidence* (`mlDuplicateReview.REVIEW_IDENTIFIER_FIELDS`, `duplicateAggregation.CORROBORATION_FIELDS`) but it is
**not** a model feature. The model cannot learn from national-ID evidence; only the human-review layer sees it.

## 3. Configured thresholds

| Threshold | Value | Where set | Role |
| --- | --- | --- | --- |
| Model operating point | **0.50** | fixed by the evaluation ("threshold fixed at 0.5") | the cut-off the reported metrics describe |
| Human-review cutoff used at registration | **0.50** | `ML_REVIEW_SCORE_THRESHOLD`, default `0.50` in `config/settings.js`; **not** in the Container App environment list → default applies | a pair at or above this becomes review evidence |
| High-priority cutoff | **0.70** | `DUPLICATE_HIGH_PRIORITY_THRESHOLD` default; unset in Azure | priority label only (`reviewPriority`) |
| Aggregation policy | **`top-1`** | `DUPLICATE_AGGREGATION_POLICY` default; unset in Azure | at most one flag per registration |
| Legacy rule-engine threshold | 0.30 | `DUPLICATE_REVIEW_THRESHOLD` | belongs to the deprecated rule engine, not the model |

Exact identifier agreement (UPI / birth certificate / national ID) outranks the score: it forces `high` priority
and qualifies a candidate for a flag even below the cutoff.
## 4. Evaluation data, method and metrics

- Training file `ml-service/training/realistic_pairs_train.csv`: 12,000 pairs / 6,000 groups, balanced 6,000/6,000.
- Holdout `ml-service/evaluation/realistic_pairs_holdout.csv`: 12,000 pairs / 6,000 groups, balanced, drawn from
  **new latent identities and a separate random seed**; `holdout_used_for_training_or_tuning: false` but
  `holdout_used_for_model_selection: true` — i.e. the model *family* was chosen against this holdout, so it is not
  a virgin test set.
- Both files carry a recorded SHA-256 in the metrics file; the data is **synthetic pair-level**, generated from
  latent identities, not real beneficiary records.
- **Provenance of the metrics file:** it is written by the tracked script
  `ml-service/retrain_realistic_pairs.py` (`REPORT = BASE / "evaluation" / "realistic_pairs_xgboost_training_metrics.json"`),
  and it records its own inputs — `training_sha256 7b585680…d6a5`, `holdout_sha256 533e1fc7…35ee`, row/group counts,
  class counts, split description and the selected hyper-parameters. Nothing in it is hand-written, and it does not
  reference any real registry extract.

Holdout results at the 0.50 cut-off (`realistic_pairs_xgboost_training_metrics.json`):

| Metric | Value |
| --- | --- |
| Accuracy | 0.9078 |
| Balanced accuracy | 0.9078 |
| Precision | 0.9204 |
| Recall | 0.8927 |
| F1 | 0.9063 |
| ROC-AUC | 0.9685 |
| PR-AUC (average precision) | 0.9727 |
| Confusion matrix (labels 0/1) | TN 5,537 · FP 463 · FN 644 · TP 5,356 |

Because the holdout is balanced 50/50 and real registries are not, the metrics file also carries
precision at assumed prevalence: **0.105 at 1 %**, **0.378 at 5 %**, **0.562 at 10 %**. Cite this beside the
headline precision or the 0.9204 figure is misleading.

Per-scenario false-positive rates (label-0 stress scenarios, threshold 0.50):

| Scenario | Rows | False-positive rate |
| --- | --- | --- |
| `identifier_collision` | 1,202 | 0.2221 |
| `common_name_same_school` | 1,492 | 0.0784 (`operating_point_2026-10-30.json` records 0.0772 for the same scenario — a small run-to-run difference; quote one and attribute it) |
| `twins_or_close_age` | 1,150 | 0.0557 |
| `siblings_shared_household` | 1,532 | 0.0098 |
| `unrelated_candidate` | 624 | 0.0000 |
| `repeat_application` (label 1) | 6,000 | recall 0.8927 |

Independent per-pair false-positive baseline (`fpr_baseline_2026-10-30.json`, 2,000 synthetic unrelated pairs that
share a school, seed 20261030, `model_version xgboost:6ec9f2a3…`):

| Cut-off | Flagged | Rate |
| --- | --- | --- |
| 0.30 | 14 / 2,000 | 0.70 % |
| 0.40 | 9 / 2,000 | 0.45 % |
| **0.50** | **7 / 2,000** | **0.35 %** |
| 0.60 | 4 / 2,000 | 0.20 % |
| 0.70 | 2 / 2,000 | 0.10 % |
| 0.80 | 0 / 2,000 | 0.00 % |

Score distribution on those negatives: min 0.0046, p50 0.0193, p90 0.0495, p99 0.198, max 0.7437. A separate
`distinct_name_only` slice flags 3/2,000 (0.15 %) at 0.50 — one pair scoring 0.82, which is the honest evidence that
single pairs can be badly wrong.

## 5. How the model is wired into the API

1. `students.controller.create` opens a transaction, takes `pg_advisory_xact_lock(hashtext('sbms.student.registration'))`,
   and selects **every** existing student `FOR UPDATE`.
2. It builds one pair per registry record and calls `scorePairs()` (`mlDuplicateReview.js:84`), which batches at
   `PREDICTION_BATCH_SIZE = 200` and calls `scoreStudentPairs()`.
3. `scoreStudentPairs()` (`duplicateCheck.js:241`) writes one line of JSON to the stdin of a long-lived
   `python predict.py --server` child process and resolves on the next stdout line; 30-second timeout per request;
   interpreter resolution order is `PYTHON_EXECUTABLE` → `ml-service/.venv/...` → a sibling `.venv` → `python`.
4. `predict.py` loads the joblib artifact once, builds `FEATURE_COLUMNS` through the shared builder and returns
   `{"model_version": "xgboost:<sha>", "results": [{"score": p, "features": {...}}]}`.
5. `mlDuplicateReview.scorePairs` validates every score is finite within [0,1], requires `features` on each result,
   rejects a response whose `model_version` changes mid-comparison, and re-throws failures as an error with
   `code = 'DUPLICATE_PREDICTOR_FAILED'`.
6. `duplicateAggregation.selectFlaggedCandidates` applies the `top-1` policy: exact-identifier agreement first, then
   score, at most one flag. `summarizeAggregation` records considered / qualifying / selected / suppressed counts,
   which are written to the audit log and returned to the client.

## 6. Recommendation, not decision — and what happens on failure

- The model never decides. A flag is inserted with `status = 'pending'`; the student record is **created anyway**
  (`duplicateFlags` are advisory). Approval of an award is blocked while any `pending`, `needs_verification` or
  `confirmed_duplicate` case exists (`bursaryAwards.controller.js:178-188`) — the block is applied by the
  human-workflow layer, not by the model.
- The API response to the client states the limits itself: `thresholds_validated: false` and
  `score_is_calibrated_probability: false` (`students.controller.js:146-156`). Cite this — it is the system's own
  admission that 0.50 is provisional.
- **On failure the registration request fails closed.** There is no silent fallback to the legacy weighted rule
  engine in a request path: the legacy engine is marked `@deprecated` in `duplicateCheck.js` with "no production
  callers", and a predictor failure is re-thrown with `code = 'DUPLICATE_PREDICTOR_FAILED'` and mapped by the caller to
  **503** `DUPLICATE_SCREENING_UNAVAILABLE` (`students.controller.js:76-82`); the admin rescan maps the same code to 503
  (`duplicateFlags.controller.js:258-263`). The student is not registered, no flag is written, and the transaction is
  rolled back. Only an *uncoded* failure (e.g. an invalid predictor response) reaches `errorHandler` and becomes a
  generic 500.
- Consequence to report: predictor unavailability is an availability risk for registration, not a
  duplicate-detection risk. `NFR-20` is satisfied as *predictable* (fail closed, no false "no duplicate" answer),
  but it is not a graceful degradation path.

## 7. Claims that must not be made

- "The system detects duplicates with 92 % precision in the field." — the 0.9204 figure is synthetic, pair-level
  and balanced; at 1 % prevalence the same model yields ≈10.5 % precision.
- "The Random Forest model described in the proposal was implemented." — XGBoost was delivered; the RF artifact is
  research-only.
- "The model was validated against real beneficiary duplicates." — no adjudicated labels exist (`EV-41`).
- "The cut-off was tuned/validated." — 0.50 is provisional and the system says so in its own response payload.

## 8. Gap references

| ID | Relevance |
| --- | --- |
| G-18 | No adjudicated labels exist, so every metric here is on synthetic data |
| G-21 | Random Forest/four features (proposal) versus XGBoost/six (delivered) — the declared deviation |
| G-34 | Thresholds are runtime-editable, audited, non-durable, and are the code defaults in the deployed container |
| G-35 | Predictor failure is fail-closed (HTTP 503 `DUPLICATE_SCREENING_UNAVAILABLE`), with no rule-based fallback |
| E-02 | The proposal itself is not tracked; its section numbers must be confirmed by the author |

