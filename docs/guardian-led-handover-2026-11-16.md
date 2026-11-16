# Guardian-led applications — handover and gap register

Branch: `redesign/guardian-led-applications`, forked from `f54ecdc` (`fix/sbms-completion-work`).
Design contract: `docs/guardian-led-workflow.md`. Model evidence: `docs/ml-screening-audit-2026-11-16.md`.

## 1. What is implemented

| Layer | Artefact | State |
| --- | --- | --- |
| Schema | `backend/src/db/migrations/20261116_student_applications.sql` | Applied to local `sbms_test`; immutable payload trigger verified |
| Schema | `backend/src/db/migrations/20261116_application_duplicate_cases.sql` | Applied to local `sbms_test`; nullable `student_id`, partial legacy pair index, application pair index, `duplicate_review_events.stage` |
| Migration inventory | `backend/scripts/migrate.js` | Both migrations added to `MIGRATION_ORDER` |
| Screening | `backend/src/services/applicationScreening.js` | Full candidate scan, **no `FOR UPDATE`**, reuses `duplicateAggregation` and the existing predictor bridge |
| Public API | `POST /api/applications`, `POST /api/applications/track` | Rate limited per IP; tracking requires code **and** date of birth |
| Staff API | `GET /api/applications`, `GET /api/applications/:id`, `POST /:id/triage`, `POST /:id/investigation`, `POST /:id/resolve`, `POST /:id/verify` | Triage/resolve = administrator; investigation/verify = field officer |
| Award gate | `backend/src/controllers/bursaryAwards.controller.js` | Approval blocked while a high-priority application case is open; audited `override_reason` |
| Tests | `tests/applications.test.js`, `tests/applicationsSchema.test.js`, `tests/applicationWorkflow.test.js` | 20 tests; full backend suite 38 suites / 286 tests pass (Phase 3 tree); ML suite 33 tests pass |

## 2. Deliberate deviations from the design document

| Design | As built | Why |
| --- | --- | --- |
| Duplicate gate on award approval (D5) | Gate implemented at **verification** and repeated at award approval | Verification is where the conflict is actually introduced; the award check also catches the administrator-override path |
| Field-officer list scoped to own school | Both roles receive the queue; **state transitions** carry the permission boundary | `users` has no school assignment; inventing one mid-sprint would change the permission model |
| `screening_priority`, masked admin detail | Implemented | As designed |

## 3. Gap register (deferred, with the reason)

| # | Gap | Risk if ignored | Next step |
| --- | --- | --- | --- |
| G-1 | Candidate generation is a full `SELECT … FROM students` per submission (no bounded prefilter) | Cost grows linearly with the register; a real deployment needs an index-backed shortlist | Cannot be added without measuring recall loss (audit showed score is uncalibrated); evaluate on frozen evaluation set before shipping |
| G-2 | No frontend for submission, tracking, triage, investigation or verification | The workflow is API-only; a guardian cannot use it through the UI | Build the public form + tracking page and the two staff queues against the endpoints listed above |
| G-3 | Screening scores are uncalibrated (F1 0.651 at threshold 0.5) | Precision 0.513 means roughly half of cases are not duplicates; only acceptable because review is human | Calibrate or re-train out of scope; keep thresholds configurable |
| G-4 | Screening failure (`DUPLICATE_SCREENING_UNAVAILABLE`) has no retry worker | An application screened while the bridge was down stays unscreened until manually re-run | Add an operator re-screen action; the failure code already distinguishes the state |
| G-5 | Migrations are not applied to Azure | Deploying the branch without running migrations breaks `/api/ready` (it now requires `student_applications`) | Run `npm run db:bootstrap-empty`/`migrate` per `deploy/` procedure under explicit approval |
| G-6 | Field officer and administrator notifications for application events | Staff must poll the queue | Extend `services/notifications.js`; the audit events already exist to key on |
| G-7 | `FINAL_TEST_REPORT.md` still quotes the stale 151-test figure | Reports understate coverage | Refresh from the 286-test run when the report is next regenerated |
| G-8 | Submission race, missing duplicate-student check at verification, staff queue vs. count mismatch | **Closed by P3-1/P3-2/P3-3/P3-4/P3-5** (branch): submissions serialise on advisory locks with in-transaction pre-checks, `verify` refuses a second register record for the same child without an administrator override, and the staff queue/detail serve application-subject cases. Residual: two guardians submitting the same child with no shared identifier are serialised but not rejected | `docs/phase3-duplicate-schema-review.md` §7 for the locks, the limitation and the rollback |

## 4. Verification performed

- `node --test test/migrate.unit.test.js` — 4/4 pass (inventory order still explicit).
- `npx jest --runInBand tests/applications.test.js` — 8/8.
- `npx jest --runInBand tests/applicationsSchema.test.js` — 6/6 (payload immutability, code uniqueness, case indexes, stage constraint).
- `npx jest --runInBand tests/applicationWorkflow.test.js` — 6/6 (role boundaries, triage/investigate/resolve/verify, override audits on both verification and award approval, confirmed duplicate never becomes a student).
- `npx jest --runInBand tests` — 38 suites / 286 tests pass (275 at the branch point; Phase 3 adds
  `tests/applicationConcurrency.test.js`, `tests/duplicateCaseKinds.test.js` and two schema guards).
- `python -m unittest discover -s tests` in `ml-service` — 33 tests OK.
- Existing duplicate suites re-run unchanged after `duplicate_flags.student_id` became nullable: 52 tests pass.

## 5. Not touched

No Azure resource, no live database, no model retraining, no change to `services/eligibility.js`. Eligibility ranges remain marked provisional.
