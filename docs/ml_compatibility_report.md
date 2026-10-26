# SBMS ML compatibility investigation

**Date:** 2026-10-23

**Scope:** Read-only inspection of the active production prediction path and the separately trained synthetic-data experiment. Only this report was created. No model was trained or loaded, and no application code or database was changed.

## Finding

The experimental model is **not compatible with the active production predictor**. The active model consumes six ordered features; the research model has a ten-feature schema. More fundamentally, the research data does not establish compatible school values or guardian-ID semantics, does not include UPI/birth-certificate values, and constructs names differently from the current registration form. Do not point the production predictor at the experimental artifact.

## Production request-to-prediction data flow

1. `frontend/src/pages/StudentRegistration.jsx` uses `api.post("/students", ...)`. The shared Axios client in `frontend/src/services/api.js` uses `/api` and adds the saved bearer token. The form constructs `full_name` from first and last name, and submits DOB, school, National ID, primary phone, and QR token. It does **not** submit `guardian_id`, `upi`, or `birth_certificate_number`.
2. `backend/src/index.js` mounts the router at `/api/students`. `backend/src/routes/students.routes.js` requires an authenticated `field_officer` for student routes. The `POST /` route invokes `students.controller.create`.
3. `studentSchema` in `backend/src/controllers/students.controller.js` requires `full_name` and one of the configured school values; the backend permits DOB and guardian ID, UPI, birth-certificate number, and National ID to be optional. The DOB is validated as ISO `YYYY-MM-DD`. The UI currently makes DOB required even though the API allows it to be omitted.
4. In `create`, the controller selects existing student candidates and maps the submitted record and each candidate into `{ first, second }` pairs. It calls `scorePairs` before inserting the new student. Scores at or above `ML_REVIEW_SCORE_THRESHOLD` (default 0.5 in `backend/src/config/settings.js`) or an exact National ID match produce pending human-review flags. National ID is **not** a production model feature; `exactNationalIdMatch` in `backend/src/services/mlDuplicateReview.js` is a separate backend comparison. Screening failure returns 503 and prevents registration.
5. `scorePairs` in `backend/src/services/mlDuplicateReview.js` sends batches of at most 200 pairs to `scoreStudentPairs` in `backend/src/services/duplicateCheck.js`. That module starts `ml-service/predict.py --server` as a child process, preferring `ml-service/.venv/Scripts/python.exe` if it exists and otherwise checking the workspace `.venv` path. Requests and responses use newline-delimited JSON over stdin/stdout; the bridge times out after 30 seconds and rejects malformed responses.
6. `run_server` in `ml-service/predict.py` loads the active artifact once when the Python process starts. For each pair it calls `build_pair_features` from `ml-service/feature_engineering.py`, creates a pandas row in `FEATURE_COLUMNS` order, and calls `predict_proba`.
7. The pair response from Python is `{"model_version":"xgboost:<sha256>","results":[{"score":0.0,"features":{...}}]}`. The scalar score is rounded to four decimal places. The backend validates the score range, result count, and model version. API registration marks `score_is_calibrated_probability: false`; these scores are used to queue human review, not as a final fraud or eligibility decision.

The other active callers use the same bridge: the admin-only `POST /api/duplicate-flags/evaluate` endpoint accepts up to 30 test pairs, and admin `POST /api/duplicate-flags/scan` compares stored students. Both routes are mounted in `backend/src/index.js` and protected in `backend/src/routes/duplicateFlags.routes.js`. The evaluation endpoint also marks the score as uncalibrated. No endpoint was called during this investigation.

The production artifact path is `ml-service/model/xgb_duplicate_model.joblib` (421,089 bytes; SHA-256 `6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9`). Its contents were not deserialized for this investigation. The feature contract above comes from the source code; the hash is a read-only file identity check.

`backend/src/services/duplicateCheck.js` also contains older JavaScript similarity/rule helpers and a legacy feature builder. Repository call-site search shows the active score bridge is `scoreStudentPairs`; `buildDuplicateFeatures` is used in the duplicate-review controller to produce display evidence. It should not be confused with the active Python model's six input columns.

## Exact production feature contract

The feature order is declared by `FEATURE_COLUMNS` in `ml-service/feature_engineering.py` and used to construct the DataFrame in `ml-service/predict.py`:

| Order | Feature | Production record fields | Computation and missing handling |
|---:|---|---|---|
| 1 | `jaro_winkler` | `full_name` | Tokenizes letters, joins tokens, and takes the larger of direct-order and sorted-token Jaro–Winkler similarity. Missing values score 0. |
| 2 | `dob_match` | `date_of_birth` | Parses supported ISO/year-first and day-first formats. Equal dates score 1; one day apart 0.8; within seven days 0.5; otherwise 0. Invalid or missing values score 0. |
| 3 | `school_match` | `school_code` | Normalizes to lowercase alphanumeric and returns exact equality (0/1); missing values score 0. |
| 4 | `guardian_match` | `guardian_id` | Normalizes identifiers, strips recognized common prefixes, then uses exact match or Jaro–Winkler similarity. Missing values score 0. |
| 5 | `upi_match` | `upi` | Same identifier similarity logic as guardian ID. Missing values score 0. |
| 6 | `birth_certificate_match` | `birth_certificate_number` | Same identifier similarity logic. Missing values score 0. |

`_missing` treats blank, `?`, `NA`, `N/A`, `NONE`, `NULL`, `UNKNOWN`, `NOT PROVIDED`, `NOT AVAILABLE`, and sufficiently long all-zero values as missing. Pairwise features encode unavailable values as zero; there are no explicit missing flags in the production six-feature schema.

## Experimental model input contract

The research feature order is in `ml-service/experiments/sbms_dataset/artifacts/feature_schema.json`; its pair adapter and `pair_features` are in `ml-service/experiments/sbms_dataset/experiment.py`:

1. `jaro_winkler`
2. `dob_match`
3. `school_match`
4. `guardian_match`
5. `name_both_present`
6. `dob_both_present`
7. `school_both_present`
8. `guardian_both_present`
9. `dob_conflict`
10. `guardian_conflict`

The experimental adapter joins first/middle/surname in that order and calls the production shared builder for the first four features. It supplies empty UPI and birth-certificate inputs, then excludes those two production features from the research model. The extra availability flags use raw non-empty strings; unlike production `_missing`, they do not recognize sentinel strings or all-zero identifiers as missing. `dob_conflict` is defined as both raw DOB strings being non-empty while `dob_match == 0`; `guardian_conflict` is both raw guardian ID strings being non-empty while `guardian_match < 1`.

The experimental artifact is `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` (183,445 bytes; SHA-256 `72a005b030167512783c6371132d3a5024d4fff2845f95d9455a18696a448567`). The selected config records seed 42 and a validation threshold of about 0.4162. The report's threshold is an experimental F1 choice, not an approved operational setting. The experiment artifact was not deserialized or invoked against production data here.

## Field mapping

Status meanings: **verified** means source code/schema supports that field correspondence; **unverified** means the names look related or a conversion is plausible, but semantics or data equivalence are not established; **unavailable** means no corresponding production input exists; **incompatible** means the current value domain or data shape does not align with what the experimental feature learned.

| Experimental feature | Experimental source field(s) | Closest production field(s) | Status | Reason |
|---|---|---|---|---|
| `jaro_winkler` | `a_`/`b_first_name`, `middle_name`, `surname`, joined by the experiment adapter | `full_name` | unverified | The shared similarity function is reused, but the generator supplies three name parts; the live form only constructs first + last. No authoritative normalization/ordering contract connects all existing records to that generated representation. |
| `dob_match` | `a_dob`, `b_dob` | `date_of_birth` | verified | Both represent the student's date of birth and the experiment calls the same production feature builder. The application validates new API DOBs as ISO; archive format distribution is still synthetic. |
| `school_match` | `a_school`, `b_school` | `school_code` | incompatible | The production column is named `school_code` but the schema restricts it to five school-name strings. The archive uses fictional generated school names/variants; generator-internal `SCH...` values are not an official mapping and are not the visible input values used by the experiment. Exact comparison on these domains is not transferable. |
| `guardian_match` | `a_guardian_id_no`, `b_guardian_id_no` | `guardian_id` | unverified | Similar labels do not prove these identifiers have the same subject, issuance, format, or meaning. The registration UI does not submit production `guardian_id`; it is optional at the API/schema level. |
| `name_both_present` | Presence of joined name parts on both sides | `full_name` | incompatible | The production create API requires a non-empty full name (and the UI requires first and last names); the synthetic training distribution contains incomplete name parts. The flag would be nearly constant for new production registrations. |
| `dob_both_present` | Non-empty `a_dob` and `b_dob` | `date_of_birth` | verified | Presence can be computed from nullable production DOB fields. Registration UI requires it, although API and database permit null. Sentinel/invalid string handling differs from the experiment's raw non-empty check. |
| `school_both_present` | Non-empty `a_school` and `b_school` | `school_code` | verified | Presence can be computed from the nullable DB field; new registration requires one of the supported values. This verifies only availability, not value-domain compatibility with `school_match`. |
| `guardian_both_present` | Non-empty `a_guardian_id_no` and `b_guardian_id_no` | `guardian_id` | unverified | A production field exists, but whether it represents the same identifier as archive `guardian_id_no` is unknown. |
| `dob_conflict` | Both DOB strings non-empty and `dob_match == 0` | `date_of_birth` | unverified | The code can derive this rule after field mapping, but it conflates an unparseable value with a date difference greater than seven days and has not been validated as the application's intended “conflict” meaning. |
| `guardian_conflict` | Both guardian ID strings non-empty and `guardian_match < 1` | `guardian_id` | unverified | It depends on the unresolved guardian identifier mapping and treats any partial similarity below 1 as a conflict. |

### Related production fields that are not experimental features

| Production field / behavior | Experimental counterpart | Status and consequence |
|---|---|---|
| `upi` / `upi_match` | No UPI field or feature in the archive/model | unavailable to the experiment. UPI exists in the DB/API but the current registration UI does not send it. The active model expects `upi_match`. |
| `birth_certificate_number` / `birth_certificate_match` | No matching field or feature | unavailable to the experiment. It exists in the DB/API but is not sent by the current UI; the active model expects this feature. |
| `national_id_number` | No experiment feature; not an active Python model feature | Production performs an exact National ID check separately in backend code. It is not part of either listed model feature schema. |
| `primary_phone` | Archive has `guardian_phone`, which belongs to the guardian | incompatible: student phone and guardian phone cannot be treated as equivalent. Neither is an experimental model feature. |
| `guardian_name` | No corresponding student schema/API feature | unavailable. |
| `gender`, `county`, `ward`, `application_year` | No corresponding student prediction input in current schema | unavailable to production; experiment deliberately excludes them. |
| QR token | No experiment counterpart and not a matching feature | unavailable / not applicable to duplicate feature generation. |

`backend/src/db/schema.sql` defines identifier columns as `VARCHAR`, and application fields are passed as strings; no numeric school-code mapping or guardian-ID equivalence was found. `backend/src/config/schools.js` lists `Nairobi School`, `Alliance High`, `Bishop Gatimu`, `Loreto Limuru`, and `Maranda`. Those are names despite the `school_code` field name; this report does not invent official codes.

## Is a shared feature-generation module feasible?

Yes, but not by replacing the current shared builder in place. Production `feature_engineering.py` and the existing active artifact are a six-feature contract. The experiment's XGBoost artifact expects ten columns. Feeding either schema to the other artifact would cause a feature-count/order mismatch or, worse, silently assign different meanings to columns if order drifted.

After the unresolved field semantics are confirmed, use versioned feature builders (for example, retain the current v1 builder and add a v2 builder) with:

- one canonical record adapter shared by experiment training and inference;
- a fixed ordered feature list stored in model metadata and tested against the estimator's expected columns;
- explicit, identical normalization and missing/sentinel rules;
- regression tests proving training-row and runtime features match, including names, date formats, identifier strings/leading zeros, missing values, and conflicts;
- a model version containing both artifact hash and feature-schema/builder version.

The current experiment already reuses the first four production calculations, which is useful groundwork. Its raw-field adapter and four extra availability/conflict flags are still experiment-specific and are not yet a shared inference implementation.

## Minimum work before safe integration

1. Confirm the intended meanings and allowed formats for `guardian_id` versus `guardian_id_no`, and provide an authoritative school identifier/name source if identifiers are required. Confirm whether UPI and birth-certificate values should be inputs and how their absence should be represented.
2. Obtain an authorized dataset with fields matching the actual app contract—or explicitly define a reduced production model contract. Do not fill missing UPI/birth-certificate features with fabricated values or zeros when production may provide them.
3. Rebuild training and inference feature generation against the same canonical app record shape. Re-evaluate group leakage, threshold policy, and operational false-positive/false-negative costs. The synthetic experiment's 0.416 threshold is not automatically transferable.
4. Keep the v1 artifact and v1 feature builder intact. Add schema/version checks so each model can only load with its matching feature builder and ordered columns. Preserve the existing backend response contract and fail closed on artifact/schema errors.
5. Add regression tests for the current v1 predictor and the new version independently, plus tests for field adaptation, output validation, missing artifacts, malformed input/output, and model-version reporting.

## Safe comparison, rollout, and rollback

1. Start with offline comparison on synthetic fixtures and an approved, de-identified evaluation set in an isolated test environment. Do not connect this comparison to production registration, flag creation, eligibility, or disbursement decisions.
2. If a later shadow trial is approved, call the experimental predictor in a non-decision side path. Continue to use only the active model for all user-visible flags. Do not persist experimental pair-level scores beside beneficiary records; record only appropriately protected aggregate comparisons, and avoid logging raw identifiers or names.
3. Review aggregate disagreement, precision/recall at expected operational prevalence, and human-review workload with domain owners before a canary. Require explicit approval before any traffic can influence duplicate flags.
4. For rollout, retain both versioned artifacts and builders, pin the selected model/schema version, preserve model-version provenance on any generated review flag, and monitor service failures and review outcomes. Roll back by restoring the previous predictor selection/artifact and v1 builder; do not delete or rewrite prior review decisions.

No shadow scoring, deployment, database write, or production decision change was performed in this investigation.

## Unresolved questions

- Is `guardian_id` a guardian's national ID number, another guardian reference, or something else? Is it the same as synthetic `guardian_id_no`?
- Are the five current `school_code` values intended to be school names or unique official codes? What authoritative code/name source should training use?
- Should UPI and birth-certificate numbers be model features? Which workflows actually collect and populate them, given the current registration UI does not submit them?
- Should National ID remain an exact backend-only check, or should it ever be a model feature? What privacy and false-match policy applies?
- Are historical student full names always normalized as first/middle/surname order? The current UI creates first + last only.
- What does “conflicting DOB” or “conflicting guardian ID” mean operationally, and what should missing/sentinel values mean?
- What false-positive, false-negative, and manual-review costs should determine thresholds and an `UNCERTAIN` band?
- What authorized, de-identified data and approval process can support real-world validation and any future shadow run?

## Safe checks performed

- Inspected the route, controller, backend-to-Python bridge, shared feature builder, prediction script, model-schema JSON, experiment adapter, frontend request, school configuration, and baseline schema. No database connection was made.
- Ran `& .\ml-service\.venv\Scripts\python.exe -m unittest ml-service.tests.test_feature_engineering ml-service.experiments.sbms_dataset.test_experiment -v`: 10 tests passed. These test shared feature behavior and experiment helpers; they do not validate the production model artifact.
- Inspected `backend/tests/mlPredictor.integration.test.js`; it only sends a synthetic pair to the predictor bridge and does not connect to PostgreSQL. Attempting to run the targeted Jest file failed before test startup because Node 22 raised `EPERM` resolving `C:\Users\user`. No permissions were changed. Therefore the actual Node-to-production-Python bridge remains unverified in this environment.
- Did not run database-backed tests, load either serialized artifact, train a model, or install packages. The active and experimental artifact hashes above were read without deserializing either file.
