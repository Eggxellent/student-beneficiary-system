# SBMS project context

## Verified architecture

- The frontend is React/Vite in `frontend/`; Express/Node API code is in `backend/`; the Python duplicate model and data-generation tools are in `ml-service/`.
- PostgreSQL stores users, students, duplicate flags, disbursements and audit logs. `backend/src/db/schema.sql` is the fresh-install schema; dated SQL files under `backend/src/db/migrations/` update an existing database.
- JWT authentication reads a role stored on the user. Backend `requireRole` middleware protects role-specific routes.
- `ml-service/predict.py` loads the active `ml-service/model/xgb_duplicate_model.joblib` and expects six pairwise features. The Node.js duplicate-check service has a Python ML bridge, but there are no current controller callers of its prediction function; current API decisions still use the controllers' weighted rule scores.

## Current ML data and known risks

- The checked-in synthetic pair CSV has 10,000 rows, 5,000 pair-family groups and balanced labels. Each group contains two generated pairs.
- The saved comparison artifact identifies the CSV with SHA-256 `e214f9b28af17cff5f461bef051f7dd92b83af0a4c6a30eb71d8e91b669a3aa7`; the current file hash matches.
- A read-only inspection found birth-certificate match in all 5,000 duplicate rows and 471 of 5,000 non-duplicate rows. UPI match appears in 3,485 duplicate rows and no non-duplicate rows. These are highly label-predictive generator rules and explain why excellent synthetic metrics do not establish real-world reliability.
- The current generator source has since been edited to vary duplicate certificate values, but the checked-in CSV was not regenerated from that source. The virtualenv Python launcher points to a missing Windows Store Python installation. The raw-pairs reliability analysis was run with system Python using the virtualenv's installed packages; see `ml-service/ML_RELIABILITY_REPORT.md`.
- `ml-service/experiments/run_research_comparisons.py` uses a 20% group holdout, seed 42, and grouped cross-validation for model tuning. The grouping keeps the two rows assigned the same synthetic group together, but does not establish identity-level independence in real records.
- `train.py` and `train_model.py` generate realistic synthetic pairs, train the XGBoost model, and evaluate it on a separate synthetic holdout. They do not read `data/raw_pairs.csv`. Historical analyses of `data/features.csv` remain synthetic diagnostics, not real-world performance evidence.
- The legacy app review cutoffs default to 0.30 and 0.70. They are adjustable by an administrator at runtime and may be initialized from environment variables; no validation-set study currently supports those particular values.

## Duplicate review workflow

- New student registration and full-record scans generate candidate flags using deterministic identifiers plus a weighted, non-ML similarity policy.
- A flag means a pair warrants a human check; it does not prove fraud. Review decisions are now recorded as `confirmed_duplicate`, `not_duplicate`, or `needs_verification`, with a required reason and an append-only review history.
- Admins access the duplicate review queue and record review decisions. Field Officers register and manage student records. Sensitive student identifiers are masked in case details. Unresolved verification and pending cases block disbursement; an Admin decision is required to resolve them.
- Review counts and pagination are computed server-side from persisted candidate cases. The score remains a provisional weighted rule score, not a calibrated model probability. Pending and further-verification flags alone do not block disbursement; only an authorized reviewer-confirmed duplicate does.

## Worktree/branch note

The active branch is `ml/retraining-evaluation`. The working tree contains existing dashboard, registration, synthetic-data, comparison-report and ML evaluation changes. Those changes have been preserved.

## Verification status

- Backend Jest suite: 7 suites, 39 tests passed.
- Frontend production build: passed.
- Local frontend route and API health endpoint: HTTP 200.
- Python raw-pairs reliability analysis: run on `data/raw_pairs.csv`; the JSON artifact includes the dataset hash. Python test suite: not run.
