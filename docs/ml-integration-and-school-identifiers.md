# ML duplicate review and school identifiers

## Current school identifier behavior

The `students.school_code` column and the registration API field have historically held one of five school **names**: Nairobi School, Alliance High, Bishop Gatimu, Loreto Limuru, or Maranda. The approved-school list, request validation, and database check constraint use those names. The synthetic model training data instead uses synthetic identifiers such as `SCH001` through `SCH010`; no mapping between those synthetic values and approved schools is present. The model's `school_match` feature is an exact normalized pairwise comparison, shared between training and inference in `ml-service/feature_engineering.py`, so the model consumes whether two submitted identifiers match, not a school lookup table.

The repository does not contain an authoritative unique code for each of those five schools. Some synthetic demo data contains county abbreviations paired with school names, and several schools appear in more than one county. Those abbreviations are not reliable school identifiers and must not be used as a mapping. The Duplicate Review page therefore labels the displayed database value as a **school identifier**. Its value can still be a school name until an authoritative code list and name-to-code mapping are provided.

No existing school data has been changed or migrated. Before converting to actual school codes, provide a confirmed mapping with one stable unique code per approved school. A migration should first report all stored distinct values and block if any value is unmapped; only then should it update existing rows, the database check constraint, registration options, API validation, and the UI. Preserve the school name separately if it is useful for display.

## Model interface

The active artifact is `ml-service/model/xgb_duplicate_model.joblib`, a scikit-learn Pipeline with an imputer and XGBoost classifier. It accepts the six ordered features `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `upi_match`, and `birth_certificate_match`. The Python service accepts raw record pairs and calls `build_pair_features`, the same feature builder used by training. It returns the class-1 `predict_proba` value as a score and includes the feature values and artifact SHA-256 as the model version.

The returned value is not calibrated for real beneficiaries. The saved report says the 12,000-row holdout influenced model selection, all examples are synthetic, and the data's positive/negative balance does not represent expected operational prevalence. The default `ML_REVIEW_SCORE_THRESHOLD=0.50` is a provisional human-review cutoff matching the experiment's reported operating point; it is not an evaluated deployment threshold. Admins may adjust it in memory in Settings. Registration and scans also queue exact normalized UPI, birth-certificate, or National ID matches for human review outside the model score. These signals do not make final duplicate decisions. Every new flag stores the model hash, threshold, and feature vector. Admin review remains the only way to confirm or dismiss a potential match.

Registration stops with HTTP 503 if screening fails before inserting a student. An existing-record scan also reports a failed scan and can be rerun; unordered student pairs are protected by a unique index so already-created flags are not duplicated. Scanning compares all unflagged pairs and is quadratic in the number of students, so large production datasets need a validated candidate-generation strategy before use at scale.

Disbursements are paused while a potential duplicate is pending or needs further verification, and remain blocked if an Admin confirms a duplicate. A decision of “not a duplicate” clears the review hold. Model scores alone never confirm a duplicate or reject a student.

## Database change

Apply `backend/src/db/migrations/20261022_ml_duplicate_provenance.sql` before using the new registration or scan flow. It adds nullable provenance columns and a unique index over unordered student pairs. It stops rather than collapsing flags if duplicate pairs already exist. The companion `.down.sql` refuses to remove provenance columns while they contain audit data. These migrations have not been run by this change.
