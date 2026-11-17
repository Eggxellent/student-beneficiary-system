# Guardian-led applications — Phases 3–5 handover (2026-11-16)

Branch `redesign/guardian-led-applications`. Design contract: `docs/guardian-led-workflow.md`.
Companion records: `docs/guardian-led-handover-2026-11-16.md` (Phase 2 tree and gap register),
`docs/phase3-duplicate-schema-review.md` §7 (locks, P3-2 override, rollback),
`docs/ml-screening-audit-2026-11-16.md` (model evidence).

## 1. Status by phase

| Phase | Scope | State |
| --- | --- | --- |
| 3 | Submission guard (advisory lock), mandatory duplicate-student check at verification, application-subject duplicate cases in the staff queue and resolution path, award gate counting application cases | Complete; `20261116_application_submission_guard.sql` applied to local `sbms_test` |
| 4 | Guardian-facing entry: public application form, public tracking, guardian-led landing copy | Complete |
| 5 | Staff workspace: queue, duplicate triage, field investigation, administrator decision, verification + eligibility, audited identifier reveal | Complete |

Commits added in this window (on top of the Phase 3 commits `e3ef3dc`, `23287da`, `54f4eb9`):

| Commit | Content |
| --- | --- |
| `52f2dc6` | `feat(applications)`: public approved-school list, audited admin-only identifier reveal, two new API tests |
| `f4e017b` | `feat(frontend)`: `Apply.jsx`, `TrackApplication.jsx`, `Applications.jsx`, routing, nav, landing copy |
| `614dcb6` | `chore(ml)`: adversarial format-scenario evaluation outputs |

## 2. Test evidence (observed, not estimated)

| Command | Result |
| --- | --- |
| `npx jest --runInBand --silent tests` (backend, `sbms_test`) | **38 suites / 288 tests pass** |
| `npx jest --runInBand tests/applications.test.js tests/applicationWorkflow.test.js tests/applicationsSchema.test.js tests/duplicateCaseKinds.test.js tests/applicationConcurrency.test.js` | **5 suites / 33 tests pass** in 17.8 s |
| `python -m unittest discover -s tests` (`ml-service`) | **33 tests OK** in 2.98 s |
| `npm run build` (`frontend`, Vite) | **Success**, 2013 modules, 12.37 s |

Per-suite counts behind the 33: `applications.test.js` 10, `applicationsSchema.test.js` 8,
`applicationWorkflow.test.js` 6, `applicationConcurrency.test.js` 5, `duplicateCaseKinds.test.js` 4.
The two tests added in `52f2dc6` are the public school list and the identifier-reveal audit path
(401 anonymous, 403 field officer, 200 administrator, audit row verified).

## 3. Phase 4/5 feature inventory

### 3.1 API surface (`backend/src/routes/applications.routes.js`)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/applications/schools` | public | `APPROVED_SCHOOLS` constant only, no register query, so an anonymous caller cannot learn how many students exist |
| POST | `/api/applications` | public, rate limited | Guardian payload only; server stamps `submitted_via: 'public_form'`, generates the tracking code and stores its hash |
| POST | `/api/applications/track` | public, rate limited | Tracking code **and** date of birth must match; response is the applicant's summary plus timeline |
| GET | `/api/applications` | field officer, admin | Optional `status` filter, `open_cases` count per row |
| GET | `/api/applications/:id` | field officer, admin | Identifiers masked for administrators, `submitted_payload` and `tracking_code_hash` never returned |
| GET | `/api/applications/:id/identifiers` | admin | Writes `APPLICATION_IDENTIFIERS_REVEALED` before returning unmasked values |
| POST | `/api/applications/:id/triage` | admin | `screened` → `needs_investigation`, requires an open case |
| POST | `/api/applications/:id/investigation` | field officer | `needs_investigation` → `investigated`, records findings and a recommendation |
| POST | `/api/applications/:id/resolve` | admin | `duplicate_of_existing` → `resolved` (sets `duplicate_of_student_id`) or `not_duplicate` → back to `screened` |
| POST | `/api/applications/:id/verify` | field officer, admin | Creates the student row, records the eligibility assessment, sets `verified`; refuses confirmed duplicates and unmatched exact matches without an administrator override |

### 3.2 Frontend

| Route | Page | Access |
| --- | --- | --- |
| `/apply` | `pages/Apply.jsx` | public: form → review → tracking code |
| `/apply/track` | `pages/TrackApplication.jsx` | public: code + date of birth, plain-language status and event labels |
| `/applications` | `pages/Applications.jsx` | `ProtectedPage allowedRoles={["admin","field_officer"]}` |

`AppLayout.jsx` shows **Applications** (`Inbox`) for both staff roles; `FieldOfficerDashboard.jsx`
links to the same queue; `Landing.jsx` hero, steps, primary actions and footer now lead with
Apply / Track. The form submits guardian-controlled fields only — never `status`,
`duplicate_of_student_id`, eligibility or decision fields.

### 3.3 Application status machine (as written)

```
submitted ──screen──> screened ──triage(admin)──> needs_investigation ──investigate(officer)──> investigated
                          │                                                                        │
                          │<────────────── resolve(admin) = not_duplicate ─────────────────────────┘
                          │
                          └── resolve(admin) = duplicate_of_existing ──> resolved ──> (verify refused: DUPLICATE_APPLICATION)
screened | resolved ──verify(officer/admin)──> verified   (student row + eligibility assessment created)
```

`rejected`, `withdrawn`, `award_recommended` and `approved` are permitted by
`student_applications_status_check` but **no endpoint writes them** (see gap N-4).

### 3.4 Audit trail

| Action | Written by |
| --- | --- |
| `APPLICATION_SUBMITTED` | `submit` (anonymous actor) |
| `APPLICATION_SCREENED` | `submit`, after the screening transaction commits or fails |
| `APPLICATION_TRIAGED` | `triage` |
| `APPLICATION_INVESTIGATED` | `investigate` |
| `APPLICATION_DUPLICATE_RESOLVED` | `resolveCase` |
| `APPLICATION_VERIFIED` | `verify` (carries override reason, matched fields, eligibility score) |
| `APPLICATION_IDENTIFIERS_REVEALED` | `revealIdentifiers` |

## 4. Security and integrity findings

| # | Finding | Mechanism | Residual risk |
| --- | --- | --- | --- |
| S-1 | Identifier masking is role-asymmetric | `detail()` unmaskes only for `field_officer`; administrators see `****1234` and must call the audited reveal endpoint | Field-officer reads of identifiers are **not** audited, so the trail only records reveals by the role that browses least. Either audit officer reads or mask both roles |
| S-2 | Public surface is deliberately narrow | `GET /schools` reads `APPROVED_SCHOOLS`; both public POSTs run the application rate limiter | Rate limiting is per IP; a shared campus NAT is a single bucket |
| S-3 | Tracking cannot be enumerated | Code **and** date of birth must match, lookup is by `tracking_code_hash`, failure is a generic 404, response carries no IDs, scores or features | Date of birth is low entropy but is only useful with a valid code |
| S-4 | Concurrent submissions serialise | Transaction-scoped advisory lock plus in-transaction pre-checks; a second submission inside 24 h is refused with `APPLICATION_ALREADY_SUBMITTED` and a message that differs for the same guardian vs. another guardian | Two guardians, one child, no shared identifier: serialised but not rejected (N-5) |
| S-5 | Verification is the real duplicate wall | Exact identifier or name + DOB + school match is checked inside the registration lock; override requires an administrator and a reason; audited with `matched_fields` | Small false-negative window for transliterated names; the model score stays advisory |
| S-6 | Guardian payload is evidence | `student_applications_payload_immutable` trigger, tracking code stored as a hash, `detail()` drops `submitted_payload` and `tracking_code_hash` | None observed |
| S-7 | Award gate covers application cases | `bursaryAwards.controller.js` refuses approval while a high-priority case is open, including application-linked cases, and audits `override_reason` | Tested at the workflow level, not in a dedicated DB predicate test |
| S-8 | Screening failure is visible, not silent | `screening_failure_code` persists on the row; the tracking page shows an "under manual review" warning instead of a false clear | No retry worker (G-4) — an unscreened application waits for an operator |

## 5. Outstanding work

| # | Item | Class | Note |
| --- | --- | --- | --- |
| G-2 | No frontend for the workflow | **Closed** | `Apply.jsx`, `TrackApplication.jsx`, `Applications.jsx`, routing and nav shipped in `f4e017b` |
| N-1 | No automated frontend tests (`package.json` has only `dev`, `build`, `preview`) | Before pilot | Pages are validated by a clean Vite build only; add RTL tests for the form validation and the role-gated actions |
| N-2 | Field-officer identifier reads unaudited (S-1) | Before pilot | Cheapest fix: log on every unmasked read, or mask for both roles and let the audited endpoint serve both |
| N-3 | Single JS chunk, 902.77 kB (gzip 200.38 kB), no `React.lazy` in `App.jsx` | Backlog | Code-split the public pages first — guardians are the likeliest mobile users |
| N-4 | `rejected` / `withdrawn` / `award_recommended` / `approved` are allowed by the status check but unreachable | Before pilot | An application that should not be verified stays `screened`; add an administrator reject action that records a reason |
| N-5 | Two guardians, one child, no shared identifier not rejected | Accepted limitation | Documented in `docs/phase3-duplicate-schema-review.md` §7 |
| G-1 | Full `students` scan per screening | Before real register sizes | Needs a measured recall comparison before any prefilter |
| G-3 | Uncalibrated scores (F1 0.651 at 0.5) | Accepted, human in the loop | Keep thresholds configurable |
| G-4 | No re-screen worker for `DUPLICATE_SCREENING_UNAVAILABLE` | Before pilot | Operator action; the failure code already isolates the rows |
| G-5 | Migrations not applied to Azure | **Blocking for any deployment** | `/api/ready` now requires `student_applications` |
| G-6 | No staff notification on application events | Backlog | The audit events exist to key on |
| G-7 | `FINAL_TEST_REPORT.md` still quotes 151 tests | Docs | Now 288 |

## 6. Final status

**Complete for a local demonstration; not deployment-ready.**

Ready for Phase 6 when these are accepted or fixed: N-1 and N-2 (frontend coverage and audit parity),
N-4 (no way to close an application that must not be verified), and G-5 (migrations on the target
database). G-1, G-3, G-4, G-6 and G-7 remain documented limitations with the reasons given above; none
of them blocks the guardian → triage → investigation → decision → verification path demonstrated in
the local environment.

Verification behind this statement: backend 38 suites / 288 tests, ML 33 tests, Vite production build
clean, and the two new API tests exercising the public school list and the audited reveal path.
