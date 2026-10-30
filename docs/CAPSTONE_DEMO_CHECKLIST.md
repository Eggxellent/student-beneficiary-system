# SBMS capstone demo checklist

Use only a verified local or explicitly approved test environment with synthetic records. The reported production database has no application tables, so do not use it for a live feature demo until schema recovery, admin provisioning, and readiness are verified.

## Before the demo

- [ ] Select an isolated database and confirm the API points to that database without displaying its connection string.
- [ ] Apply only the reviewed schema/migrations appropriate for that isolated environment; the existing runner only allows local `sbms_test` with `sbms_test_runner`.
- [ ] Provision a named demo admin using an approved secure process; do not use a default password.
- [ ] Start the API, frontend, and ML predictor using documented local configuration.
- [ ] Check `/api/health` for process liveness and `/api/ready` for database/table readiness. A ready response alone does not verify all columns or workflow integrity.
- [ ] Use only synthetic student data and confirm any required test suite completed.

## Demonstration flow

1. Sign in with the prepared demo account and show role-protected navigation.
2. Register a synthetic student. Explain that similarity scores flag candidates; an authorized human reviewer makes the final duplicate decision.
3. Open the duplicate-review queue, inspect a candidate, and record a reasoned human decision.
4. Generate or scan the student's QR code. Show that verification returns record existence only and does not expose student details or confirm identity, eligibility, award, or payment.
5. Submit a bursary award, record verification evidence, and demonstrate approval/rejection authorization and duplicate-review blocking where applicable.
6. Record an issued payment, then separately demonstrate clearance and acknowledgement/reconciliation using synthetic references. Explain that acknowledgement is officer-assisted under current behavior.
7. Show a report/dashboard total and its documented status definitions; do not interpret the legacy `scholarship_amount` without an approved mapping.
8. Show audit events for the reviewed actions, avoiding display of private personal data.

## Stop conditions

- Stop if `/api/ready` is not ready, schema checks fail, a model prediction errors, or the target database is uncertain.
- Do not use production records or make production schema/account/payment changes during the capstone demo.
- Do not describe workflows as end-to-end verified until they have passed in the selected isolated environment.
