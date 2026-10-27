# SBMS database reconciliation audit

**Review type:** Static source review. No database was connected to, queried, changed, or migrated. No runtime result is inferred from this review. The current table list below is the operator-supplied snapshot, not a fresh database inspection.

## Findings

### Application schema and legacy schema

The supplied current database inventory is `audit_logs`, `beneficiaries`, `disbursements`, `duplicate_flags`, `duplicate_review_events`, `reports`, `students`, and `users`. The repository's base schema in [`backend/src/db/schema.sql`](../backend/src/db/schema.sql:5) defines these core tables but no `bursary_awards`, `bursary_award_verification_events`, or `disbursement_reconciliation_events` tables. It also defines the older disbursement fields (`student_id`, `amount`, `disbursement_date`, `status`, `created_by`, `created_at`; lines 112–121).

Current controllers and models additionally require:

- `students`: `is_synthetic`, `birth_certificate_number`, `national_id_number`, `primary_phone`, `qr_token`, eligibility fields; base schema lines 27–44 and student model [`backend/src/models/student.model.js`](../backend/src/models/student.model.js:9).
- `duplicate_flags`: `updated_at`, `model_version`, `review_threshold`, `comparison_features`, and unordered-pair uniqueness; base schema lines 75–96 and provenance migration [`20261022_ml_duplicate_provenance.sql`](../backend/src/db/migrations/20261022_ml_duplicate_provenance.sql:1).
- `audit_logs.details` and `duplicate_review_events`; base schema lines 98–132 and migrations `20261019_admin_field_officer_roles.sql` and `20261019_duplicate_review_workflow.sql`.
- `disbursements`: `award_id`, `payment_method`, `payment_reference`, `payment_status`, clearing evidence/actor/time, receipt status and acknowledgement fields; [`20261023_bursary_award_reconciliation.sql`](../backend/src/db/migrations/20261023_bursary_award_reconciliation.sql:56).
- Award and reconciliation tables and their decision, verification, payment, receipt, and event fields; the same migration lines 3–54 and 103–117.
- `users.is_active`: required by authentication and user administration ([`auth.js`](../backend/src/middleware/auth.js:20), [`users.controller.js`](../backend/src/controllers/users.controller.js:87)). The account-policy migration also adds it but then deactivates accounts; a new additive migration [`20261024_add_user_activation_flag.sql`](../backend/src/db/migrations/20261024_add_user_activation_flag.sql:1) adds it with `TRUE` default without changing existing account state.

The migration-defined constraints and indexes include award status/decision/verification checks, award/student/user foreign keys, and award-history indexes; disbursement payment-status and receipt-status checks, acknowledgement amount and evidence/actor/time consistency checks, award/user foreign keys and award-status index; reconciliation-event type/status checks, payment/event and actor foreign keys and history index; plus duplicate-pair provenance and uniqueness. New reconciliation columns remain nullable for legacy rows. The user-activation migration adds no constraint or index.

`beneficiaries` remains a separate legacy API model at [`backend/src/models/beneficiary.model.js`](../backend/src/models/beneficiary.model.js:13), exposing `name`, `school`, `grade_level`, and `scholarship_amount`. No mapping from `scholarship_amount` to requested/approved/payment amounts is established or proposed here. Keep the table and records intact. `/api/beneficiaries` remains mounted in [`backend/src/index.js`](../backend/src/index.js:49); do not retire it until external consumers and legacy dependencies are confirmed.

### Migration dependencies and data risks

There was no runner or migration ledger before this work. Filename ordering alone is unsafe: `20261019_limit_synthetic_schools.sql` reads `is_synthetic`, while that column is added by `20261019_synthetic_student_marker.sql`; record standardization uses registration columns. The new runner in [`backend/scripts/migrate.js`](../backend/scripts/migrate.js:1) encodes an explicit order, excludes `.down.sql`, requires the exact loopback `sbms_test` / `sbms_test_runner` identity, verifies the connected identity, takes a PostgreSQL advisory lock for adoption/application, tracks committed migrations, and uses a transaction per migration. It never runs at API startup. If the database has no ledger, `apply` refuses; `adopt` requires an explicit list of previously applied migrations after a human reviews the current schema/history, and executes no migration SQL. The primary-account migration is listed as manual-only because it changes existing user activation state. A separate additive migration makes the auth column available without making that account-policy decision.

Automatic order: synthetic marker → field-officer registration columns → student record standardization → synthetic school normalization → admin/field-officer role constraints → duplicate review workflow → supported-school constraint → removal of obsolete duplicate assignment → ML provenance → award/payment reconciliation → user activation flag. `20261023_retain_primary_accounts.sql` remains manual-only; `20261022_ml_duplicate_provenance.down.sql` is never an automatic migration.

The runner refuses application if the expected legacy core tables or `students.birth_certificate_number` baseline are absent. This is deliberate: `schema.sql` is a bootstrap schema, not a proven migration from every legacy variant. The account-policy migration [`20261023_retain_primary_accounts.sql`](../backend/src/db/migrations/20261023_retain_primary_accounts.sql:1) locks `users`, requires two named accounts, then changes `is_active` for all other accounts; it is not included in automatic migration application.

The award reconciliation migration adds nullable `award_id` and nullable reconciliation columns to existing disbursements; it does not backfill awards, payment status, acknowledgement, or links. Existing rows can remain unlinked with null payment/receipt status. New `ON DELETE RESTRICT` relationships protect awards and reconciliation history, while the base disbursement-to-student relationship uses `ON DELETE CASCADE` (schema lines 112–119). Existing values may fail only if a constraint is later added over incompatible populated columns; the migration's current checks permit null payment/receipt fields, but the actual database contents and constraints were not inspected. Do not create award rows or link legacy payments without reliable source evidence and human reconciliation.

Additional risks: `20261019_limit_synthetic_schools.sql` rewrites synthetic school values; `20261019_standardize_student_records.sql` normalizes student identifiers and assigns generated phones to synthetic records; `20261022_ml_duplicate_provenance.sql` aborts if unordered duplicate pairs already exist; and the account-policy migration can deactivate accounts. These effects require a reviewed backup and a disposable test run before any live migration.

## Query and test findings

### Disbursements GET 500

[`backend/src/models/disbursement.model.js`](../backend/src/models/disbursement.model.js:23) `getAll()` selects `students.is_synthetic`, joins `bursary_awards` through `disbursements.award_id`, reads `payment_status` and receipt fields, and joins `disbursement_reconciliation_events` (lines 25–47). If the supplied table inventory is exhaustive, this query's `LEFT JOIN bursary_awards` cannot resolve because that relation is absent; the migration also adds `award_id`, `payment_status`, and other queried columns, and creates the reconciliation-event table. Thus the failing source path and schema mismatch are identified; the exact PostgreSQL error text was not captured and the migration has not been run. Runtime verification remains outstanding.

### POST test failures

[`backend/src/controllers/disbursements.controller.js`](../backend/src/controllers/disbursements.controller.js:10) requires `award_id`, a positive `amount`, and `payment_method`; it then requires the award to be approved and verified and rejects open duplicate states (lines 74–96). The old smoke request sent only `student_id` and `amount`, so schema validation returned 400 before duplicate checking. The prior expected 409 was not a valid test of the duplicate rule. The smoke test's hard-coded student ID and externally selected `API_URL` also did not create an isolated fixture. That mutating/workflow assertion has been moved to the Jest integration suite, whose existing setup guard remains unchanged; the updated test creates a verified approved award and pending duplicate fixture in the guarded test database.

The Jest guard [`backend/tests/testDatabaseGuard.js`](../backend/tests/testDatabaseGuard.js:1) requires `NODE_ENV=test` and matching local database URLs for database `sbms_test` and role `sbms_test_runner`. It has not been bypassed. The older database-dependent suite has not been run in this environment. No test result is claimed here.

## Payment calculations currently in source

| Surface | Existing SQL behavior | Consequence |
|---|---|---|
| Award list, [`bursaryAwards.controller.js`](../backend/src/controllers/bursaryAwards.controller.js:29) | `SUM(d.amount)` and `COUNT(*)` for an award where `payment_status IS NULL OR payment_status NOT IN ('failed','cancelled')` (lines 39–42). | Includes issued, cleared, and null/unverified rows; excludes failed/cancelled. |
| Payment creation/remaining-cap check, [`disbursements.controller.js`](../backend/src/controllers/disbursements.controller.js:98) | Same sum filter; reject when prior sum plus requested new payment exceeds approved amount (lines 98–102). | Null/unverified legacy rows consume available award balance if linked. |
| Disbursement GET award total, [`disbursement.model.js`](../backend/src/models/disbursement.model.js:35) | Same sum filter (lines 36–38). | Same treatment as award list. |
| Dashboard accountability, [`adminDashboard.controller.js`](../backend/src/controllers/adminDashboard.controller.js:38) | `disbursed_awards` counts distinct award IDs and `disbursed_amount` sums only `payment_status IN ('issued','cleared')`; no-payment, partial, and overpaid calculations use the broader non-failed/non-cancelled predicate (lines 40–60). | Dashboard amount excludes null status, but partial/no-payment/overpaid counts can include it. |
| Date-range PDF, [`reports.controller.js`](../backend/src/controllers/reports.controller.js:32) | Counts and sums every disbursement in date range with no payment-status predicate (lines 32–36); details show legacy `d.status` (lines 74–78). | Includes failed/cancelled and unverified rows; detail status may differ from `payment_status`. |
| PDF accountability snapshot, [`reports.controller.js`](../backend/src/controllers/reports.controller.js:47) | Approved/partial/no-payment counts use broad predicate; `cleared_amount` sums only `payment_status='cleared'`; issued and cleared counts are separate; receipt counts use receipt status (lines 47–71). | Current all-time snapshot has different amount semantics from date-range totals and dashboard totals. |
| Frontend remaining amount, [`frontend/src/pages/Disbursements.jsx`](../frontend/src/pages/Disbursements.jsx:70) | Displays `approved_amount - total_disbursed`, where backend `total_disbursed` uses the broad predicate. | Issued and null-status linked amounts reduce displayed balance. |

## Proposed terminology and reporting rules (not current behavior)

| Term | Proposed meaning/filter |
|---|---|
| Requested award amount | Applicant request (`bursary_awards.requested_amount`); never a payment. |
| Approved award amount | Authorized ceiling (`approved_amount`) only after approved and verified decision. |
| Issued payment amount | Sum of payments with `payment_status='issued'`; a commitment awaiting clearance. |
| Cleared payment amount | Sum with `payment_status='cleared'` and valid clearance evidence; report separately from issued. |
| Failed/cancelled amount | Separate exception totals; excluded from recognized paid amount and remaining-balance usage after human-confirmed status. |
| Unverified legacy amount | Sum with `payment_status IS NULL`; report separately and never silently label issued, cleared, or paid. Do not allocate it to an award without evidence. |
| Receipt acknowledgement | `acknowledged_amount` is recipient-confirmed receipt, separate from payment `amount`; discrepancies remain exceptions. |
| Remaining approved balance | Proposed formula: approved amount minus issued plus cleared payments, using explicit status filters and integer cents. Display unknown/unlinked legacy payment exposure separately. |
| Date-range payment totals | Use `disbursement_date` and explicitly named status buckets; exclude cancelled/failed from issued/cleared totals and show them in separate exception lines. |
| Accountability snapshot | Label as-of date/time and apply the same payment filters as the date-range totals. |

Human approval is needed for whether issued payments reserve the full award balance; how null-status legacy rows affect balances and date-range totals; whether cleared status requires bank settlement evidence semantics beyond a reference; whether zero-value acknowledgements are valid; and whether status changes may be corrected after acknowledgement. This audit does not change any of those rules.

### Payment concurrency and retry behavior

Payment creation runs in a transaction, locks the selected award with `FOR UPDATE`, takes the shared `sbms.student.registration` advisory transaction lock, checks unresolved duplicate flags, and sums linked payments excluding only `failed` and `cancelled` rows before insertion ([`disbursements.controller.js`](../backend/src/controllers/disbursements.controller.js:65), [`disbursement.model.js`](../backend/src/models/disbursement.model.js:5)). The per-award row lock serializes concurrent balance checks for the same award, so those requests cannot both spend the same remaining balance and exceed the approved cap. The update query and payment/event/audit writes commit together.

No request idempotency key or uniqueness constraint is visible. `payment_reference` is optional and has no database uniqueness rule ([`20261023_bursary_award_reconciliation.sql`](../backend/src/db/migrations/20261023_bursary_award_reconciliation.sql:56)); therefore a client retry can create a second payment when both amounts still fit within the award cap. Before enforcing duplicate-request prevention, the programme/payment provider owner must decide whether idempotency is keyed by a client-generated request token or by a provider reference, and define the uniqueness scope (for example, provider plus reference). This remains an implementation and test decision; no payment rule is inferred here.

## QR-code trace

Student registration creates a 32-byte random token and QR data URL in [`students.controller.js`](../backend/src/controllers/students.controller.js:51), stores the token with the student, and returns the QR image (lines 51–55, 84–117). The registration UI displays that returned image ([`StudentRegistration.jsx`](../frontend/src/pages/StudentRegistration.jsx:57)). [`student.model.js`](../backend/src/models/student.model.js:5) removes `qr_token` from student records returned by model methods; the schema/migrations add a partial unique index for non-null tokens. [`publicAppUrl.js`](../backend/src/config/publicAppUrl.js:164) builds `/verify#token=...`. The frontend [`Verification.jsx`](../frontend/src/pages/Verification.jsx:7) reads the fragment, removes it from browser history, and posts the token. `/api/verify` is public (no authentication middleware), rate-limited in-process, requires the exact `{token}` body and 64 lowercase hex characters, then returns only whether a record exists ([`verification.controller.js`](../backend/src/controllers/verification.controller.js:5), [`verificationRateLimit.js`](../backend/src/middleware/verificationRateLimit.js:1)).

This is an existence check, not identity display or proof of beneficiary entitlement. The inspected flow shows no token expiry/revocation control, no distributed rate limit, no QR-specific automated test, and no separate camera scanner; scanning is expected to open the QR URL. Browser/API behavior has not been runtime-tested.

## Changes and safe verification

This work adds a guarded migration runner and unit tests, updates the disbursement integration fixture to the award contract, and removes the unsafe hard-coded duplicate-payment request from the external smoke test. It does not alter live data or run migrations. The award migration now leaves transaction boundaries to the runner so the schema change and ledger row commit or roll back together.

After a disposable local `sbms_test` database and `sbms_test_runner` role have been explicitly provisioned, set `SBMS_MIGRATION_DATABASE_URL` in the process environment using a protected secret input. Do not use the ordinary `student_beneficiary_system` URL. Then, from `backend`:

```powershell
npm run migrate -- status
npm run migrate -- dry-run
$backupFile = Join-Path $env:TEMP 'sbms_test-before-migrations.dump'
pg_dump --dbname='service=sbms-backup' --format=custom --file=$backupFile
# Restore only through a separately configured service pointing to an empty disposable verification database.
pg_restore --dbname='service=sbms-restore' --exit-on-error $backupFile
$env:SBMS_MIGRATIONS_APPROVED = 'sbms_test'
# Only after reviewing schema and migration history, explicitly initialize/adopt the ledger:
npm run migrate -- adopt --confirm-sbms-test --confirm-schema-baseline --mark-applied=none
npm run migrate -- apply --confirm-sbms-test
$env:NODE_ENV = 'test'
$env:DATABASE_URL = $env:SBMS_MIGRATION_DATABASE_URL
$env:SBMS_TEST_DATABASE_URL = $env:SBMS_MIGRATION_DATABASE_URL
npx jest --runInBand tests/disbursements.test.js tests/duplicateFlags.test.js
npm run test:smoke
```

The runner allows status/dry-run/adopt/apply only for local `sbms_test` as `sbms_test_runner`; adopt/apply additionally require both the environment approval value and explicit command flags. Status/dry-run do not create the ledger. The `--mark-applied=none` example is valid only if inspection proves none of the listed migrations has already been applied; otherwise supply the exact, verified names. Do not adopt when history is uncertain. After adoption, apply records each successful migration with its DDL in one transaction, and rolls back a failed migration without recording it. The runner keeps the primary-account policy migration manual-only. Preserve the backup outside source control and treat it as sensitive. Do not apply to development/production or use `schema.sql` as a substitute for reviewing the existing schema.

## Remaining dependency

Before any database-backed verification: provision or identify an explicitly disposable local `sbms_test` database under the required role, inspect its schema against runner preconditions, take a verified backup, and review the manual data decisions above. Then run status/dry-run and inspect their output before explicitly authorizing the test migration. The ordinary development database and hosted databases remain untouched.
