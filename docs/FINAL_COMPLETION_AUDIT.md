# SBMS final completion audit

**Audit date:** 2026-10-27
**Scope:** Current local checkout and safe local verification. No production database, Render setting, credential, or deployment was changed.

## Executive result

SBMS is **not production-complete or demo-ready against the reported Render database**. The user-supplied production catalog result found no application tables, including `public.users`; login therefore cannot work until a reviewed schema/source recovery decision is made and approved. Startup does not apply migrations. This work adds a local `/api/ready` check to distinguish DB/table readiness from process liveness, but it has not been deployed and does not replace migration/schema verification.

## Repository and architecture findings

- Checkout: `experiment/febrl-record-linkage`, starting and final commit `22435ecf11080a18003211a3d1bcb979d6c0e00b`, tracking `origin/experiment/febrl-record-linkage`, nine commits ahead. No branch switch, commit, or push. Existing untracked `docs/PRODUCTION_DATABASE_RECOVERY_AUDIT.md` was preserved and updated.
- Express mounts authentication, legacy beneficiaries, students, duplicate flags, disbursements, awards, settings, reports, eligibility, dashboard, users, audit logs, and QR verification in `backend/src/index.js:66-78`.
- `backend/src/config/db.js:3-5` reads `DATABASE_URL`. `backend/src/index.js:80-86` configures JWT and starts the listener; it does not run schema initialization or migrations.
- `backend/src/models/auth.model.js:3-8` selects `id`, `full_name`, `email`, `password_hash`, `role`, `is_active` from unqualified `users`. The reported PostgreSQL `42P01` and missing production `public.users` are consistent; this production evidence is user-supplied and was not re-queried.
- `backend/src/db/schema.sql` creates users, students, duplicate flags/review events, disbursements, audit logs, and reports. It contains `DROP` operations at lines 47-49 and several `ALTER`s. It does not create legacy `beneficiaries` or newer bursary/reconciliation tables. The latter are introduced in `20261023_bursary_award_reconciliation.sql` and require prior core tables. Foreign keys include cascade deletion for duplicate flags/review events and baseline disbursements (`schema.sql:77-78,100,114`); bursary award and reconciliation references use `RESTRICT` (`20261023_bursary_award_reconciliation.sql:3,13-18,40,44,55-64,103,110`).
- `backend/scripts/migrate.js:4-20,27-41` explicitly orders 11 normal migrations plus one manual migration and refuses targets except loopback `sbms_test` with role `sbms_test_runner`. It is not a production migration runner. The manual primary-account migration is intentionally excluded from automatic local order because it changes activation state. No safe production bootstrap or initial-admin seed exists.
- Local backup metadata was checked without printing contents: archive catalog readable (59 TOC lines), but a complete restore was blocked by local PostgreSQL authentication (`fe_sendauth: no password supplied`). No temporary DB was created. User-reported local aggregate counts and backup contents are not proof of production source-of-truth.
- The tracked production XGBoost artifact loads as an sklearn pipeline with the six-feature order documented in the existing model tests; the ten-feature research artifact remains separate. Model helper checks pass, but no target-container/Docker verification was possible.
- QR verification checks token-to-record existence and intentionally returns no student details; it does not prove identity, eligibility, award, or payment. The rate limit is in-process (`README.md`, existing verifier implementation).
- Existing bursary/payment workflows document separate award approval, issued/cleared states and acknowledgement; payment policy questions and legacy `scholarship_amount` meaning remain unresolved in the existing recovery/business-rule documentation. This task made no payment-rule changes.
- Frontend production build completed locally. A static search of built files found none of `DATABASE_URL`, `JWT_SECRET`, either model artifact name, or `joblib`. This is a narrow scan, not a general secret audit.
- Render configuration remains a Docker API and static frontend in Singapore, API `free`, `DATABASE_URL` private input, generated `JWT_SECRET`, service-derived frontend origin/CORS, `/api/health` liveness, and auto-deploy off. No live Render change was made; Blueprint acceptance and deployment were not verified.

## Change made locally

Added `GET /api/ready` backed by `backend/src/services/databaseReadiness.js`. It queries through the API pool and checks the current DB name against `SBMS_EXPECTED_DATABASE_NAME` and that the required public relations exist, resolve unqualified to the same relations, and are ordinary/partitioned tables. It returns only generic ready/not-ready values; DB errors return generic 503 with a fixed log label. `/api/health` remains process liveness so Render does not restart a live API merely because its DB schema is missing. This is not deployed. The readiness check does not validate columns, constraints, indexes, migration ledger/checksums, feature dependencies, or data.

## Decisions and blockers

1. Identify and approve the authoritative/recoverable data source before deciding between restore and clean initialization. Local backup is not assumed production-authoritative.
2. Finish the local isolated restore with valid local credentials, then compare schema/aggregate counts without exposing records.
3. Design and test an immutable, identity-guarded, locked, non-destructive bootstrap/migration mechanism. Do not use the current baseline blindly.
4. Resolve the legacy `beneficiaries` table/data/consumer dependency and the required current schema before declaring readiness.
5. Approve a secure one-time initial-admin process; there is no seed/default admin.
6. Backend Jest/API integration suites and Docker build/startup remain unverified (details in `FINAL_TEST_REPORT.md`).
7. Production schema, admin login, and hosted workflows remain unverified; no deployment was performed.

No production database, Render environment, credentials, or deployment were changed. No Git commit or push was made.
