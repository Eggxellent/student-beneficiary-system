# Verification Summary

## Backend Tests

- Jest: 4 suites passed, 9 tests passed.
- API smoke tests: 4 passed, 0 failed.
- Duplicate-flag tests confirm that pending or confirmed duplicates block disbursement with HTTP 409.

## Frontend UAT

- Login and dashboard load successfully.
- Student registration required-field validation works.
- Duplicate Review displays probabilities and supports Confirm Duplicate and Clear actions.
- Reports required-field validation works.
- Production build completes successfully with `npm run build`.

## Performance Baseline

The backend duplicate-check bridge returned 100 predictions in 6,155 ms during a local batch benchmark, with high-similarity and low-similarity cases returning probabilities of 1 and 0 respectively.

This is a local baseline rather than a production capacity target. Repeat the benchmark in the deployment environment with representative traffic before setting service-level objectives.

## ML Verification

The Jaro-Winkler versus normalized-Levenshtein comparison is available in [jaro-winkler-name-similarity-report.pdf](jaro-winkler-name-similarity-report.pdf). The Python prediction service loads `ml-service/model/xgb_duplicate_model.joblib`. The Node.js duplicate-check service has an ML bridge, but a repository reference check found no current callers of its prediction function; current controller decisions therefore still use their own duplicate-scoring logic.

## Production Readiness Note

The application has been validated with the current local start commands and production frontend build. PM2 is not installed in this environment, so configuring a PM2-managed production process remains a deployment-environment step.
