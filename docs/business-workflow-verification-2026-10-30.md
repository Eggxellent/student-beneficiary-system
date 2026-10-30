# Business workflow verification — 30 October 2026

**Scope:** registration → duplicate screening → administrator review → duplicate confirmation /
rejection → award verification and approval → disbursement → payment reconciliation → audit
trail, plus role boundaries.
**Result:** 21 suites / 128 backend tests pass, including a new 11-test end-to-end workflow
suite. **One production defect was found and fixed: payment clearance never worked.**

## 1. The chain, and the two gates that protect it

| Step | Who | Endpoint | Gate |
| --- | --- | --- | --- |
| Register student | field officer | `POST /api/students` | duplicate screening; a case is created, the student is still registered |
| Record verification | field officer | `POST /api/awards/:id/verification` | `outcome: verified` requires an evidence reference |
| **Approve award** | **admin** | `PATCH /api/awards/:id/decision` | **verified ∪ no `pending`/`needs_verification`/`confirmed_duplicate` flag on either side** |
| **Record disbursement** | admin / field officer | `POST /api/disbursements` | **approved award ∪ no unresolved or confirmed duplicate ∪ within the approved amount** |
| Clear payment | admin / field officer | `PATCH /api/disbursements/:id/payment-status` | clearance requires an evidence reference |
| Acknowledge receipt | admin / field officer | `PATCH /api/disbursements/:id/acknowledgement` | flags a shortfall as `discrepancy` |
| Adjudicate a case | **admin** | `PATCH /api/duplicate-flags/:id` | terminal; a resolved case cannot be re-decided |

Both gates query `student_id = $1 OR matched_student_id = $1`, so a student is blocked whether
they are the *new* record or the *existing* one they were matched against.

## 2. The defect: payment clearance always failed (fixed)

*Symptom:* `PATCH /api/disbursements/:id/payment-status` returned **500 "Internal server
error"** for every status change, so an administrator could never record that a payment had
cleared, and all reconciliation reporting downstream was unreachable.

*Root cause:* PostgreSQL error `42P08 inconsistent types deduced for parameter $1`. The
statement reused `$1` for three incompatible type positions:

```sql
UPDATE disbursements SET payment_status = $1, status = $1,        -- varchar(20) and varchar(50)
       cleared_by = CASE WHEN $1 = 'cleared' THEN $2 ELSE NULL END -- and a text comparison
```

`payment_status` is `VARCHAR(20)` and `status` is `VARCHAR(50)`, so the server could not infer a
single type for the parameter. Nothing in the test suite exercised this endpoint before, which
is why it survived.

*Fix:* explicit casts (`$1::text`, `$2::uuid`, `$4::uuid`) and a comment recording why they must
stay.

*Not the cause:* the sanitised error handler returned "Internal server error", so the initial
suspicion was a missing `cleared_by` (the table has a `disbursements_clearance_fields_check`
that requires `cleared_by`, `cleared_at` and a non-empty `clearance_evidence_ref`). A direct
database probe proved that constraint passes with a real user id and fails only with `NULL`,
which ruled it out and pointed at the parameter typing.

## 3. Evidence (`backend/tests/workflow.test.js`, new — 11 tests)

The suite drives the real Express app against a real PostgreSQL test database, with real
field-officer and admin accounts created per run.

| # | Check | Result |
| --- | --- | --- |
| 1 | A re-registration raises one review case with identifier evidence and candidate counts | pass |
| 2 | An award cannot be approved before the beneficiary is verified | pass (409) |
| 3 | A pending duplicate blocks award approval **and** disbursement | pass (409, 409) |
| 4 | Confirming a duplicate keeps the beneficiary unpayable | pass (409) |
| 5 | A resolved case cannot be re-decided | pass (404) |
| 6 | `needs_verification` still blocks; clearing the case unblocks the award | pass |
| 7 | A payment cannot exceed the approved amount | pass (409) |
| 8 | Clearance needs evidence and is written to the reconciliation trail | pass (400 → 200) |
| 9 | Acknowledgement records `discrepancy` then `acknowledged`, two events | pass |
| 10 | The audit trail records every step (`CREATE`, `AWARD_VERIFICATION_RECORDED`, `DUPLICATE_CONFIRMED_DUPLICATE`, `DUPLICATE_NOT_DUPLICATE`, `AWARD_APPROVED`, `PAYMENT_ISSUED`, `PAYMENT_CLEARED`, `RECEIPT_ACKNOWLEDGED_OFFICER_ASSISTED`) | pass |
| 11 | Role boundaries hold across the workflow | pass |

Role boundaries proven in test 11: a field officer cannot adjudicate a case (403) or approve an
award (403); an admin cannot register a student (403) or create an award (403).

## 4. Observations that are behaviour, not defects

- **A confirmed duplicate is terminal.** `confirmed_duplicate` leaves the case unpayable and
  cannot be reversed through the API. That is the correct policy (a confirmed duplicate is not
  a beneficiary), but it means a mistaken confirmation can only be corrected in the database.
- **`deadline_days: null`.** `/api/disbursements/exceptions` reports `null` when
  `ACKNOWLEDGEMENT_OVERDUE_DAYS` is unset, rather than inventing a deadline. Set it in the
  deployment environment if overdue-acknowledgement reporting is wanted.
- **Registration is never blocked by a duplicate.** The student row is created and a review case
  is raised; no automatic rejection or deletion happens anywhere in the chain.

## 5. Remaining gaps (not claimed as done)

1. No automated browser test of this chain; the workflow suite is API-level. The Phase 3 browser
   suite covers the registration and review screens.
2. Bulk operations, reporting exports and the beneficiaries module were not exercised here.
3. Audit rows are append-only by convention only — there is no database-level immutability or
   retention policy.
4. Role checks are covered for the main routes; every route in every router is not exhaustively
   enumerated.
