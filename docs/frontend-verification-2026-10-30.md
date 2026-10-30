# Frontend verification — 30 October 2026

**Scope:** the `critical`/`review` mismatch, surfacing duplicate-screening information, and
browser-level testing of registration, review, error handling and role behaviour.
**Result:** 23/23 browser checks pass in real Chrome, 107/107 backend tests pass, production
build succeeds. No production model, threshold or aggregation setting was changed.

## 1. The `risk_level` mismatch, resolved

The frontend styled a case red when `risk_level === 'critical'`; the API only ever emitted
`'review'`, so that branch was unreachable — the code and the API disagreed about what
"severe" means.

The resolution follows the project's own documented position: **no score makes a duplicate
decision**, and exact identifier agreement is *separate evidence* a reviewer checks against
source documents. So the API keeps publishing `risk_level: 'review'` for every case, and now
publishes the two things the UI actually needs:

| Field | Where | Meaning |
| --- | --- | --- |
| `risk_level` | registration flags | always `review`; a case exists, no decision has been made |
| `priority` | registration flags **and** admin queue | `high` when exact identifiers agree **or** the score reaches `DUPLICATE_HIGH_PRIORITY_THRESHOLD`; otherwise `standard` |
| `exact_identifier_matches` | registration flags | `['UPI']`, `['birth certificate number']`, `['National ID']`, … |

`priority` is computed by one shared function (`reviewPriority` in
`backend/src/services/mlDuplicateReview.js`) used by **both** the registration response and
the admin queue, so the confirmation screen and the queue cannot drift apart again. The
frontend now colours a case red only for exact identifier agreement, amber for any other
review case, and green when nothing is flagged.

### A second defect this exposed

The queue computed priority as `score >= review_threshold` (the 0.50 review cutoff), so
**every** model-created case was `high` and `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (0.70) was
dead configuration. The queue policy block also published `high_priority_threshold: null`,
which the admin screen rendered as **"high 0.00"**. Both are fixed: priority uses the
high-priority cutoff, and the policy block now publishes the real value. `0.70` is still
**provisional** (`thresholds_validated: false`) and the UI says so.

## 2. Screening information: who sees what

`/students/register` is restricted to `allowedRoles={["field_officer"]}`; an administrator
is redirected to `/dashboard`. An admin-only panel on that page would have been a second
unreachable branch, so the split is by *audience*, not by role on one screen:

| Audience | Screen | What is shown |
| --- | --- | --- |
| Field officer | Register student → confirmation | Plain language only: "Possible duplicate match found. An administrator must review this case before any disbursement.", the exact-identifier sentence, and "Checked against N existing students; M candidates flagged for a second look; K further matches recorded in the audit log without a separate case." No model version, no cutoffs, no score. |
| Administrator | Duplicate review | Per case: priority, XGBoost score, model version, cutoff, reason. Policy line: both cutoffs, aggregation policy, "provisional; validation is unavailable". |
| Administrator | Audit log | The stored counters (`duplicate candidates considered / qualifying / suppressed / flags created`) rendered as readable text instead of raw JSON. |

New response fields (all additive): `priority`, `exact_identifier_matches` on each flag, and
`candidates_qualifying`, `high_priority_threshold`, `thresholds_validated` in
`duplicate_screening`; the queue policy gained `aggregation_policy`.

## 3. Browser evidence

`scripts/browser-smoke.mjs` drives headless Chrome over the DevTools Protocol (no new
dependencies — Node 22 provides `WebSocket`). It signs in through the real login forms, fills
the real React-controlled inputs, submits, and reads the rendered DOM.

| # | Check | Result |
| --- | --- | --- |
| 1 | Field officer signs in through the UI | pass |
| 2 | Normal registration succeeds | pass |
| 3 | Screening sentence shown to the officer | pass |
| 4 | Officer sees no model internals | pass |
| 5 | Re-registration is created (no automatic rejection) | pass |
| 6 | Duplicate warning displayed | pass |
| 7 | Exact identifier named in plain language | pass |
| 8 | Suspicious case uses the stronger colour (`red`) | pass |
| 9 | Third registration succeeds | pass |
| 10 | Several qualifying candidates collapse to one case and are counted | pass |
| 11 | No cutoffs or model internals reach the officer | pass |
| 12 | Blocked API shows an error, not a false success | pass (`Failed to register student.`) |
| 13 | No confirmation panel on failure | pass |
| 14 | The blocked request produced exactly one expected network error | pass |
| 15 | Admin signs in through the UI | pass |
| 16 | Queue lists the case as pending review | pass |
| 17 | Admin sees both cutoffs | pass (`standard 0.50, high 0.70`) |
| 18 | Admin sees the aggregation policy | pass (`aggregation top-1`) |
| 19 | High-priority cases counted | pass |
| 20 | Case detail shows model version and cutoff | pass (`xgboost:6ec9f2a3…`, `cutoff: 0.5`) |
| 21 | Case detail states the score is not a decision | pass |
| 22 | Audit log renders counters readably | pass (`considered: 14 · qualifying: 14 · suppressed: 13`) |
| 23 | Admin redirected away from the registration page | pass (`pathname=/dashboard`) |

Reproduce: see the header of `scripts/browser-smoke.mjs` (three services plus
`backend$ npm run seed:verification`, which requires `SBMS_VERIFY_PASSWORD`).

Observed aggregation behaviour: three identical registrations against a growing registry
produced **one** case each time. The audit log recorded 14 candidates considered, 14
qualifying and 13 suppressed on the last one — `top-1` working as configured, and the
suppressed candidates still visible to the administrator.

## 4. Operational notes

- The verification accounts (`phase3.admin@example.invalid`, `phase3.officer@example.invalid`)
  live only in the local `sbms_test` database. No password is committed; `seed:verification`
  reads `SBMS_VERIFY_PASSWORD` and refuses to write to any non-loopback host.
- The students the browser run creates are removed afterwards; `sbms_test` was left with 0
  students and 0 duplicate flags.
- Chrome's headless profile directory is temporary and was deleted after the run.

## 5. Residual gaps (not claimed as done)

1. No automated *visual* regression or accessibility audit; the checks assert rendered text,
   classes and navigation, not appearance.
2. The QR camera test, disbursement restrictions and the full business workflow belong to
   Phases 4–5.
3. Priority banding now depends on `DUPLICATE_HIGH_PRIORITY_THRESHOLD`, which remains
   unvalidated (see `docs/ml-decision-sheet-2026-10-30.md`, D3/D5). It changes presentation
   order only; it cannot approve or reject anything.

