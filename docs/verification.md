# Verification Summary

> The sections below record an earlier snapshot of this project. Current test counts and the
> bursary certificate checks are in "Current status (2026-11-01)" at the end of this file.

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

## Current status (2026-11-01)

| Check | Result |
| --- | --- |
| Backend Jest suite (`npx jest --runInBand tests`, `NODE_ENV=test`, `backend/.env.test` loaded) | **24 suites / 151 tests passed** |
| Frontend production build (`npm --prefix frontend run build`) | **exit 0**, 2,006 modules, `dist` written |
| Headless-Chrome student QR smoke (`scripts/qr-smoke.mjs`) | Not run — no Chrome DevTools session, API or frontend server running |
| Headless-Chrome certificate verification page | Not run — the page is covered by API tests only |
| Phone-camera QR check | Not run — needs a public HTTPS origin |
| Azure or other production check | Not run |

The "Backend Tests" and "Frontend UAT" sections above are an earlier snapshot of this project and are superseded by the figures in this table.

## Bursary certificate verification

A bursary certificate is a different artefact from a student record, so it has its own QR payload, page, endpoint and rate-limit budget:

| | Student record QR | Bursary certificate QR |
| --- | --- | --- |
| QR payload | `/verify#token=…` | `/verify-certificate#token=…` |
| Endpoint | `POST /api/verify` | `POST /api/certificates/verify` |
| Answer | `{ found: true }` or `{ found: false }` | `valid`, `status`, certificate reference, award period, issue and approval dates, issuing authority — never the student's name, UPI, school or the amount |
| Budget | 10 requests per IP per 15 minutes | 20 requests per IP per 15 minutes |
| Created by | Student registration | An administrator, after award approval |

Verification results: `verified` (active certificate, award still approved at the same amount), `revoked`, `not_current` (the award is no longer approved or its approved amount changed after issue), and `not_recognised` (malformed, unknown or manipulated token, always the same answer). Issuing and revoking write `AWARD_CERTIFICATE_ISSUED` and `AWARD_CERTIFICATE_REVOKED` to the audit log.

What a certificate does not claim: it confirms an approval, not a payment, an identity or an endorsement. See [bursary-certificates-2026-11-01.md](bursary-certificates-2026-11-01.md) for the full contract, the PDF contents and the checks that were not run.

