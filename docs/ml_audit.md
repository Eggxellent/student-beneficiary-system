# SBMS ML and supplied dataset audit

**Audit date:** 2026-10-23  
**Scope:** Read-only inspection of the supplied synthetic dataset, its generator, and the existing ML/application path. No database connection or model artifact replacement was made.

## Current implementation and data flow

- `backend/src/controllers/students.controller.js` validates a student record, loads existing students, and calls `scorePairs` before registration. A predictor failure aborts registration with HTTP 503. `backend/src/controllers/duplicateFlags.controller.js` also scores requested pairs and existing-student comparisons.
- `backend/src/services/mlDuplicateReview.js` batches pairs and checks result count, score range, and model version. `backend/src/services/duplicateCheck.js` starts `ml-service/predict.py --server` as a Python child process and streams JSON lines over stdin/stdout. This is not a separate HTTP ML service.
- `ml-service/predict.py` loads `ml-service/model/xgb_duplicate_model.joblib`, creates a pandas frame in the declared order, and returns scores. The local artifact exists (421,089 bytes; SHA-256 `6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9`) and is ignored by Git. The serialized artifact was not unpickled during this audit.
- Training entry point `ml-service/train.py` calls data generation and `ml-service/retrain_realistic_pairs.py`. That training script writes the active model path and evaluation report; it must not be used for this experiment because it can replace the ignored active artifact.

## Existing feature schema

`ml-service/feature_engineering.py:FEATURE_COLUMNS` defines exactly six ordered inputs: `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `upi_match`, `birth_certificate_match`. `build_pair_features` reads `full_name`, `date_of_birth`, `school_code`, `guardian_id`, `upi`, and `birth_certificate_number` from each app record. The backend student schema in `backend/src/controllers/students.controller.js` has these fields (and `national_id_number` / phone); the current six-feature builder does not include National ID.

## Supplied dataset structure and labels

The supplied files are outside the repository:

- Archive: `C:\Users\user\Downloads\sbms_dataset.zip`
- Generator: `C:\Users\user\Downloads\generate_sbms_dataset.py`

The archive contains 24,000 model-visible pairs, a private metadata CSV, a dataset card, config and validation reports, and six test challenge subsets. The primary splits are 16,800 train, 2,400 validation, and 4,800 test rows. Each split has 6% review rows; among the remaining binary rows, the configured positive:negative ratio is 1:3. Train counts are 3,948 match / 11,844 non-match / 1,008 review; validation 564 / 1,692 / 144; test 1,128 / 3,384 / 288. `y` is missing on review rows. Per the dataset card, `review` means insufficient evidence and is not a third identity truth; half of those pairs are same-identity and half different-identity.

Visible columns are a pair ID, twelve `a_` fields and twelve `b_` fields (first/middle/surname, DOB, gender, county, ward, school, guardian name/phone/ID number, application year), plus `label` and `y`. CSV identifiers remain text when read with the standard CSV parser; the generator emits phone values beginning with `07` and ID-like values as decimal strings. Do not cast these to numbers. An inventory of missing values, label counts, and split integrity is in the archive's `validation_report.json`/`validation_report.md`; generator output includes nonsemantic probes near chance and no exact pair duplicate flags.

The generator uses seed 42, synthesizes 160 fictional schools, and applies correlated corruption profiles. It emits school IDs such as `SCH0000` in its private identity construction, while visible school values are generated school names/variants; these are not authoritative Kenyan school codes. Generator scenarios include namesakes, families, twins, missing values, and contradictory fields. `pair_row` creates `y` only for binary labels; `build_ambiguous` creates review examples. Metadata has identities, clusters, difficulty and generation details and must never enter model features.

## Data quality, leakage and evaluation risks

- The archive's supplied validation report flags no identity or cluster overlap across train/validation/test and no exact duplicate pairs within or across the primary splits. Its metadata reports repeated canonical identity pairs within a split (maximum 9 train, 10 validation, 7 test), with different corruptions. This is a group-held-out split, not independent samples within each partition.
- The six challenge CSVs are subsets of the same test population by design, not six independent external test sets. The dataset card lists their row counts. Do not count them as additional test observations or tune on their results.
- The binary class prevalence is 25% by construction, not a real bursary duplicate prevalence. Precision and average precision therefore will not transfer directly to operations. Real candidate-generation prevalence may be much lower.
- `metadata_private.csv` contains direct identity/cluster and generator variables, including `true_same_identity`; any use in model features would leak target information. It is appropriate only for split checks and after-the-fact subgroup reporting.
- The generator's limited, invented name/place pools, repeated canonical pairs, designed corruption mechanisms, and synthetic records constrain generalization. The dataset card itself says real-world performance needs authorized de-identified records or an independent validation process.
- The validation report reports nonsemantic probe AUCs close to 0.5; that is reassuring but not a proof against all leakage. Application year and school distributions show notable class shifts (reported TVD 0.052 and 0.149). Those features should be scrutinized; IDs and metadata are excluded from modeling.

## Compatibility with the application

The supplied dataset has no UPI or birth-certificate fields, which are two of the active model's six expected features. Its guardian ID field is generated as a synthetic guardian identifier and is not documented as semantically equivalent to the app's `guardian_id`; visible `school` values are generated school labels and do not match the app's five-value `APPROVED_SCHOOLS` contract (`backend/src/config/schools.js`). It also has separate name parts, whereas the application stores `full_name`. Therefore the archive cannot directly train a compatible replacement for the current six-feature production predictor without assumptions and an inference/schema change. National ID is available in the app but is also absent from this dataset.

The safe experiment boundary is a separately versioned research feature schema using only defensible fields from this archive, with no change to `ml-service/model/xgb_duplicate_model.joblib`, `predict.py`, or backend contracts. Any result from that experiment is not deployable until a representative, approved dataset and a shared training/inference schema resolve the field mismatches.

## Recommended next steps

1. Build a read-only archive preparation/quality pipeline that preserves strings, excludes private metadata from features, and asserts split/group integrity.
2. Use only the supplied train and validation partitions for feature/model/threshold selection; evaluate the primary test split once after selection. Treat challenge sets as overlapping slices.
3. Compare full-name Jaro–Winkler, a transparent rule, and a modest reproducible XGBoost search on a fixed research schema. Report binary metrics separately from review-case abstention and make prevalence limitations explicit.
4. Keep all experiment artifacts separate from the active model. Do not integrate the result until the application-field and feature-order mismatch is resolved and regression tests pass.
5. Validate with an authorized, de-identified representative set and review operational false-positive/false-negative costs before making a deployment decision.

## Verification notes

The audit read the archive directly without extracting it, printed no pair records, and did not connect to PostgreSQL. System Python 3.11.9 lacks pandas, scikit-learn, XGBoost, jellyfish and joblib. The existing `ml-service/.venv` Python 3.11.9 has those libraries but not pytest; exact installed package versions are recorded below. No dependency was installed.

## Research experiment completion

The separately scoped experiment and tests are under `ml-service/experiments/sbms_dataset/`; generated reports are under `ml-service/reports/`. The installed virtual environment versions were recorded (pandas 3.0.5, scikit-learn 1.9.0, XGBoost 3.2.0, jellyfish 1.2.1, joblib 1.6.0). The quality checker confirmed zero identity, cluster, and exact-pair overlap across train/validation/test and zero duplicate observed pairs within each split. The experiment fits binary labels only and chooses all parameters/thresholds from validation before using test.

On the 4,512 binary primary test rows, selected-threshold XGBoost obtained precision 0.874, recall 0.880, F1 0.877, average precision 0.953, ROC-AUC 0.978 (TP 993, FP 143, TN 3,241, FN 135). Standard-order full-name Jaro–Winkler at its validation-selected F1 cutoff had F1 0.626; the transparent DOB/name-or-guardian rule had F1 0.784. See `ml-service/reports/sbms_dataset_experiment.md` for default-threshold results, challenge slices, and interpretation.

The research model was saved separately at `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib`. It is explicitly not compatible with the app's six-feature contract and was not integrated. No operational `UNCERTAIN` thresholds were selected because a review-cost policy is not established. These synthetic results are not real-world performance evidence.
