# SBMS remediation progress

**Updated:** 2026-10-23  
**Status:** In progress; 346 accounts were deactivated in the configured local database to preserve audit history. No production database was changed.

## Repository and architecture audit

- Active project is `student-beneficiary-system`: React 18/Vite frontend, Express 4 API, PostgreSQL via `pg`, and a Python predictor using a scikit-learn pipeline with XGBoost.
- API entry point: `backend/src/index.js`. Frontend pages are under `frontend/src/pages/`. The baseline schema is `backend/src/db/schema.sql`; SQL migration files are manually maintained and there is no migration runner or migration ledger found in the inspected tree.
- Authentication uses bcrypt cost 12 and eight-hour JWTs. Middleware verifies the JWT and reloads the current role from `users`, so an old signed role claim does not grant current permissions. Protected route declarations use backend role middleware.
- Student registration invokes the Python pair scorer before insert and returns 503 if screening fails. Duplicate decisions are admin-only and are recorded with reviewer and reason. Disbursement logic checks unresolved/confirmed duplicate flags.
- Student registration generates a QR image containing a token, but there is no server-side QR verification route. The registration client currently creates the token; the server accepts supplied strings up to 100 characters. A phone scan therefore has no implemented verification destination.
- A model artifact exists at `ml-service/model/xgb_duplicate_model.joblib` (ignored by Git). The six ordered features and shared feature builder are documented in `docs/ml-integration-and-school-identifiers.md`. The reported evaluations are synthetic and do not establish real-world performance.
- No authoritative school-code mapping is present. The five allowed database/API values are school names. County abbreviations in synthetic data are not school identifiers. Do not create or apply a mapping until verified codes are supplied.
- No `beneficiaries` table appears in the baseline schema; both legacy beneficiary routes/models and the newer students workflow exist. The intended relationship between these parallel workflows requires a product/schema decision before reconciliation.

## Changes in this session

- CORS uses validated bare HTTP/HTTPS origins from `CORS_ORIGINS`. It defaults to Vite localhost outside production and to an empty allowlist in production. Invalid entries fail startup. An untrusted `Origin` receives HTTP 403 before parsing or routing; requests without `Origin` continue to API authentication/authorization. CORS is not treated as authentication.
- Added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a Permissions Policy that disables microphone/geolocation while leaving camera permission available for a future QR scan. JSON bodies are capped at 100 KB.
- Added an in-process IP-based sign-in request limiter: 10 requests per 15-minute window shared by both login routes, with a 10,000-address map cap. It is not distributed across API instances; new addresses beyond the cap are temporarily denied. Behind a reverse proxy, `req.ip` may represent the proxy because Express proxy trust is not enabled; configuring that safely requires a known proxy topology.
- Uncaught errors now return generic 5xx responses and safe generic 4xx responses, and log a fixed message. Errors after headers are sent are passed to Express. Removed exception details from the legacy beneficiary audit failure log.
- Added isolated Jest coverage for CORS configuration and app behavior, headers, JSON limits, malformed bodies, rate-limit wiring, and sanitized errors. Added an isolated unit test for the limiter threshold.
- Documented CORS, migration caution, and backup/restore command patterns in the README. No backup was created or restore verified.
- Removed the prior UI-only `SCH001`–`SCH005` labels because they were unverified. Registration continues to use the existing school-name API contract until a confirmed mapping is available.
- Added `users.is_active` and applied `20261023_retain_primary_accounts.sql` to the configured local database. The primary admin and primary field-officer accounts remain active; 346 other accounts are deactivated, not deleted, because 505 audit-log rows reference those accounts. Authentication rejects inactive accounts, and `/api/users` lists active accounts only. No student or beneficiary rows were changed.

## Verification

- Git status was inspected before edits; unrelated changes were preserved. `git diff --check` passes after these changes.
- Changed JavaScript files pass `node --check` when source is piped through stdin.
- A Node inline harness evaluated the actual CORS parser, limiter, and error-handler source without filesystem module resolution. Checks passed for dev/prod defaults, valid/malformed origins, the 10-request 429 response, and absence of exception text in the response and log. This did not verify Express/CORS integration.
- Targeted Jest tests and the frontend build remain blocked. Node 22 starts inline scripts, but filesystem resolution fails with `EPERM` while traversing `C:\Users\user`. PowerShell can read the workspace, but Node cannot resolve files below that denied parent. Jest and Vite are present under project `node_modules`; this is a path-access failure, not a missing Node dependency. No permissions were changed.
- `pytest` is not installed in the selected Python environment; no packages were installed. Python testing is outside Phase 2A.
- A read-only API check returned exactly two active users from `/api/users` and rejected an inactive account token with 401. The frontend production build passes. Database-backed Jest and smoke suites remain unrun because they can create/delete records or submit disbursement requests. The local user-account migration was applied in a transaction and verified; all 505 historical audit references remained intact. No production database was connected to, and no student or beneficiary data was changed.

## Priority issues and next steps

1. **Run the new isolated Jest security suite** (`loginRateLimit.test.js`, `securityMiddleware.test.js`) where Node can resolve project files without relaxing system-wide permissions. The frontend production build now passes.
2. **Clarify legacy beneficiary route scope.** `/api/beneficiaries` GET list/detail permits either authenticated role and has no per-officer scope filter. The legacy table is absent from the baseline schema and the frontend does not call these routes, so policy/schema reconciliation is needed before changing behavior.
3. **JWT configuration needs fail-fast validation.** JWTs expire after eight hours and authorization reloads the current database role; startup does not reject a missing or weak `JWT_SECRET`. Define a production secret policy and test setup before enforcing it.
4. **Legacy beneficiary audit failures are swallowed.** Exception text is no longer logged, but the write can still succeed if its audit event fails. Decide whether this workflow requires atomic auditing before changing behavior.
5. **QR verification is absent.** Define a privacy-limited response and token lifecycle, then implement server-issued high-entropy tokens and a scan route. Do not expose student details by token possession alone.
6. **School identifiers remain names.** Obtain an authoritative code-to-name source before preparing a preflight migration; do not apply it without backup, restore verification, and explicit authorization.
7. **Database reconciliation is incomplete.** Resolve legacy `beneficiaries` versus current `students` workflows and design migration tracking after validating schema ordering.
8. **Production rate limiting needs shared storage and proxy configuration.** The current limiter is process-local; reverse-proxy IP behavior must be based on the deployment topology.
9. **ML evaluation remains synthetic.** Authorized representative real-world validation is unavailable.

## Recovery

Re-enable the 346 accounts with a reviewed local SQL rollback before reverting the `is_active` authentication and listing changes. Their user rows and audit history remain intact. Revert only the specific code, migration, and documentation changes listed above; preserve unrelated working-tree edits.

## Bursary accountability implementation (2026-10-23)

- Added an **unapplied** manual migration at `backend/src/db/migrations/20261023_bursary_award_reconciliation.sql`. It adds award records, verification and payment reconciliation event tables, nullable award/payment evidence fields for existing disbursements, and integrity checks. No migration was executed, no database was accessed, and no records were changed.
- Added authenticated `/api/awards` routes. Field officers submit awards and record verification outcomes with notes and an evidence reference. Admins approve or reject with a reason; approvals require verified beneficiary status and no open duplicate flags. The existing duplicate model and review process were not changed. Award approval and payment issuance take the same registration advisory lock as student registration before checking duplicate flags.
- Payment issuance requires an approved verified award, method, amount, and date. Split payments are supported up to the remaining approved balance. Issued, cleared, failed/cancelled, and officer-assisted receipt acknowledgement are separate events. Clearance requires evidence; receipt amount mismatches remain visible for follow-up. Existing unlinked payments remain visible as exceptions. Admins may link one only to an approved award for the same student; linking does not certify its payment or receipt status.
- Added an admin Awards view through the existing disbursement page and sidebar. Field officers submit awards and record beneficiary checks. Admins decide awards. Both roles can record payment status and officer-assisted receipt details. The UI states that acknowledgement is not independent school confirmation. QR remains deferred.
- Added dashboard and PDF accountability summaries for approvals, awards without payment, payments recorded as issued or cleared, clearance, receipt follow-up, optional overdue count, partial awards, discrepancies, and incomplete verification. The report separates the current accountability snapshot from date-range totals. Potential duplicate counts include pending and needs-verification cases; ML scores do not automatically reject a student.
- `ACKNOWLEDGEMENT_OVERDUE_DAYS` is optional and validated as an integer from 1 to 3650. It is intentionally unset by default because the programme deadline was not provided. Without it, the UI and report state that the overdue deadline is not configured.
- Added isolated tests for transition and exception rules (`backend/tests/bursaryRules.test.js`) and mocked controller flows (`bursaryAwards.controller.test.js`, `disbursementReconciliation.controller.test.js`) covering decisions, duplicate gating, split-payment balance, clearance evidence, receipt mismatch, and audit writes. They use no database. The Jest tests could not launch: Node cannot `lstat C:\Users\user` (`EPERM`). A separate inline harness against the actual `bursaryRules.js` source passed the transition, amount, deadline, and exception-reason checks. Vite build also could not launch for the same Node filesystem error. Direct `npm` invocation is blocked by the PowerShell execution policy, so `npm.cmd` was used and reached that error. No permissions were changed and no packages were installed. `git diff --check` passes.
- Database-backed tests and API flows were not run: they may mutate PostgreSQL and the required schema migration is unapplied. The production build is unverified in this environment. No database, report export, live user data, or beneficiary records were accessed for this task.

### Remaining decisions and next steps

1. Have the programme owner define required document types, the evidence storage/reference convention, the acknowledgement deadline, and acceptable payment methods. The current generic evidence reference is not a document checklist or upload workflow; payment method remains free text because no payment integration or approved method list was supplied.
2. Confirm whether field officers may reconcile all disbursements or need assigned-student or geographical scope. Existing roles provide no such scope, so this change uses current role permissions.
3. Review the migration against the actual target schema, then back up and verify a restore in a separate database. An authorised operator must apply it; API flows require it.
4. From a permitted working directory where Node can resolve `node_modules`, run only `bursaryRules.test.js` first and the frontend build. Then exercise award review, split payment, clearance, acknowledgement mismatch, and legacy linkage using a disposable synthetic database. Never run the existing DB-backed suite against a live/configured database.
5. Review unrelated pre-existing working-tree changes separately; they were preserved and are not covered by this feature verification.
