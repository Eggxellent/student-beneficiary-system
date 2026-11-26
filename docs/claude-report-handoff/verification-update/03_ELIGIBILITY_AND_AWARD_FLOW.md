# Eligibility and award flow verification

**Basis:** Current local backend/frontend/SQL source inspection, not a fresh end-to-end run. No database was altered or queried for this package.

## Guardian application to eligibility

1. Guardian submits through `POST /api/guardian/applications` (role protected). Required assessment fields are fee balance, vulnerability status, number of siblings in school, and prior bursary history; household income is optional in the schema and can result in an incomplete assessment if absent.
2. `guardian.controller.js:createApplication` stores the application in `guardian_applications` with `under_review`, then `guardianApplicationLink.js:linkGuardianApplicationStudent` creates/links a student and invokes screening inside the transaction.
3. If duplicate screening is unavailable, the transaction is rolled back and the endpoint returns 503; it does not silently accept an un-screened application.
4. `automaticAssessment.js:assessAutomatically` checks the student's duplicate state. `pending` or `needs_verification` flags, unresolved `confirmed_duplicate`, or a student already marked as duplicate block assessment. A clean record is assessed under `registration_screening`; an Administrator clearing a false positive can trigger `duplicate_clearance`.
5. Missing scoring inputs are recorded as `incomplete` with named `missing_inputs`; they are not replaced with zero. Complete input is passed to `eligibility.js:calculateEligibility`, and the assessment is persisted. The automatic score/recommendation is not an identity decision or guaranteed award.

## Duplicate review and clearance

`backend/src/controllers/duplicateFlags.controller.js` implements review decisions (`confirmed_duplicate`, `not_duplicate`, `needs_verification`) and a separate resolution operation requiring a confirmed case and a canonical record. Clearing a false positive triggers eligibility assessment for the Guardian-linked student when applicable. `automaticAssessment.js:duplicateBlockReason` and award controller checks make unresolved duplicate cases consequential gates.

## Award and certificate flow

- `backend/src/routes/bursaryAwards.routes.js`: Field Officer lists and proposes (`POST /`); Admin reads detail and decides (`PATCH /:id/decision`). Admin-only correction/void routes are also present.
- `bursaryAwards.controller.js:create` refuses records marked as duplicates or held by unresolved duplicate cases. A submitted award requires Admin approval/rejection; approval checks unresolved duplicate cases, canonical identity, annual award conflicts, and separation of duties (the proposer cannot approve their own award).
- On approval, the certificate is issued in the same transaction. Certificate retrieval/PDF routes are available. Certificate verification describes the approved award record; it is not proof that bursary funds were disbursed.

## Verification gate distinction

Migration `backend/src/db/migrations/20261111_remove_award_verification_gate.sql` drops `bursary_awards_approval_verification_check`. It explicitly preserves the `verification_status` column and its history table. Thus the former beneficiary-verification status is **not a database approval gate** in the current migration history. There remains a separate **duplicate review gate**: pending/needs-verification or unresolved confirmed duplicate cases block eligibility/award progression. Do not conflate these gates.

The migration log notes it was applied in the November deployment history; current live database schema was not queried in this audit. Current local source/migration evidence establishes the intended local schema, but not live schema parity.

## Relevant limits

- This audit did not test workflows against a running API or database.
- Guardian “More Info Required” field reopening/resubmission is absent; see `01_CURRENT_IMPLEMENTATION_VERIFICATION.md`.
- Synthetic model score and automated eligibility recommendation both require appropriate human review; neither alone establishes beneficiary identity or guarantees an award.
