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

Re-verified on 2026-11-17 against a freshly provisioned local PostgreSQL cluster (`sbms_test`, user
`sbms_test_runner`). Jest was run in alphabetical chunks with `--runInBand` because the workstation had
under 1 GB of free RAM; the chunks together cover every Jest file exactly once.

| Command | Result |
| --- | --- |
| `npx jest --runInBand --silent tests/a tests/b` — then `tests/c tests/d tests/e` — then `tests/f tests/h tests/i tests/k tests/l tests/m` — then `tests/n tests/p tests/r tests/s tests/v tests/w` | **39 suites / 293 tests pass** (86 + 93 + 26 + 88), exit 0 on every chunk |
| `node --test "test/*.test.js"` in `backend` with the API running on `:5000` | **35 tests / 35 pass**, exit 0 |
| `python -m unittest discover -s tests` (`ml-service`) | **33 tests OK** in 2.68 s |
| `python -m unittest discover -s experiments/sbms_dataset -p test_experiment.py` | **7 tests OK** in 0.29 s |
| `python -m unittest discover -s experiments/febrl_record_linkage/tests` | **4 tests OK** in 0.01 s |
| `npm run build` (`frontend`, Vite) | **Success**, 15.07 s, 2013 modules, 908.10 kB JS (gzip 201.04 kB) |

`test/*.unit.test.js` and the two database bootstrap files are `node:test` suites, not Jest suites, so
they are counted in the second row only. The three `api.smoke` assertions need a live API and a seeded
administrator (`admin@sbms.com`); without a server they fail with `fetch failed`, which is what an
earlier partial run recorded before the server was started.

Suites added or extended on 2026-11-17:

- `backend/tests/applicationClosure.test.js` — 3 tests: reject closes an open application with an
  audited reason, withdraw records the actor, and both refuse `verified`/`rejected`/`withdrawn` with
  `INVALID_STATE`, plus the open-case refusal.
- `backend/tests/applicationWorkflow.test.js` — new test: a **cleared** application case no longer
  blocks award approval and writes no `AWARD_DUPLICATE_OVERRIDE`.
- `backend/tests/duplicateFlags.test.js` — new test: a confirmed duplicate cannot be bypassed by
  calling the decision endpoint directly with `override_reason` / `confirm_duplicate_allocation`.
- `backend/tests/applications.test.js` — the reveal assertion now also checks the audit `user_id` of
  each caller, `created_at`, and that a 404 reveal discloses nothing and writes no audit row.
- `backend/tests/applicationsSchema.test.js` — made hermetic: each test inserts its own student instead
  of relying on an ambient `students` row.

## 3. Phase 4/5 feature inventory

### 3.1 API surface (`backend/src/routes/applications.routes.js`)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/applications/schools` | public | `APPROVED_SCHOOLS` constant only, no register query, so an anonymous caller cannot learn how many students exist |
| POST | `/api/applications` | public, rate limited | Guardian payload only; server stamps `submitted_via: 'public_form'`, generates the tracking code and stores its hash |
| POST | `/api/applications/track` | public, rate limited | Tracking code **and** date of birth must match; response is the applicant's summary plus timeline |
| GET | `/api/applications` | field officer, admin | Optional `status` filter, `open_cases` count per row |
| GET | `/api/applications/:id` | field officer, admin | Identifiers masked for **both** roles, `submitted_payload` and `tracking_code_hash` never returned |
| GET | `/api/applications/:id/identifiers` | field officer, admin | Writes `APPLICATION_IDENTIFIERS_REVEALED` (actor, role, fields) before returning unmasked values |
| POST | `/api/applications/:id/triage` | admin | `screened` → `needs_investigation`, requires an open case |
| POST | `/api/applications/:id/investigation` | field officer | `needs_investigation` → `investigated`, records findings and a recommendation |
| POST | `/api/applications/:id/resolve` | admin | `duplicate_of_existing` → `resolved` (sets `duplicate_of_student_id`) or `not_duplicate` → back to `screened` |
| POST | `/api/applications/:id/verify` | field officer, admin | Creates the student row, records the eligibility assessment, sets `verified`; refuses confirmed duplicates and unmatched exact matches without an administrator override |
| POST | `/api/applications/:id/reject` | admin | `submitted`/`screened`/`needs_investigation`/`investigated`/`resolved` → `rejected`; requires a reason of at least 10 characters, refuses while a duplicate case is open (`OPEN_DUPLICATE_CASE`), writes `APPLICATION_REJECTED` |
| POST | `/api/applications/:id/withdraw` | field officer, admin | Same source statuses → `withdrawn`; same reason and open-case rules, writes `APPLICATION_WITHDRAWN` |

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

`pages/Applications.jsx` (2026-11-17) adds the staff workspace completion: a `withdrawn` status
filter, uniform masking with a role-agnostic **Reveal** button that calls the audited endpoint per
record, the closure evidence block (`closure_reason`, `closed_by`, `closed_at`), and a reject/withdraw
form (reason ≥ 10 characters, reject offered to administrators only, both blocked with a visible
warning while a duplicate case is open).

### 3.3 Application status machine (as written)

```
submitted ──screen──> screened ──triage(admin)──> needs_investigation ──investigate(officer)──> investigated
                          │                                                                        │
                          │<────────────── resolve(admin) = not_duplicate ─────────────────────────┘
                          │
                          └── resolve(admin) = duplicate_of_existing ──> resolved ──> (verify refused: DUPLICATE_APPLICATION)
screened | resolved ──verify(officer/admin)──> verified   (student row + eligibility assessment created)
submitted | screened | needs_investigation | investigated | resolved ──reject(admin)──> rejected
submitted | screened | needs_investigation | investigated | resolved ──withdraw(officer/admin)──> withdrawn
```

`rejected` and `withdrawn` are now written by the closure endpoints (`applicationClosure.test.js`);
both close the case permanently — the record and its evidence stay readable but no later step may move
it again. `award_recommended` and `approved` are still permitted by
`student_applications_status_check` and still unreachable, because awards carry that state in
`bursary_awards` instead.

### 3.4 Audit trail

| Action | Written by |
| --- | --- |
| `APPLICATION_SUBMITTED` | `submit` (anonymous actor) |
| `APPLICATION_SCREENED` | `submit`, after the screening transaction commits or fails |
| `APPLICATION_TRIAGED` | `triage` |
| `APPLICATION_INVESTIGATED` | `investigate` |
| `APPLICATION_DUPLICATE_RESOLVED` | `resolveCase` |
| `APPLICATION_VERIFIED` | `verify` (carries override reason, matched fields, eligibility score) |
| `APPLICATION_REJECTED` | `reject` (administrator, carries the closure reason) |
| `APPLICATION_WITHDRAWN` | `withdraw` (officer or administrator, carries the closure reason) |
| `APPLICATION_IDENTIFIERS_REVEALED` | `revealIdentifiers` |

## 4. Security and integrity findings

| # | Finding | Mechanism | Residual risk |
| --- | --- | --- | --- |
| S-1 | Identifier masking is now role-symmetric | `detail()` masks UPI, guardian phone, national ID and birth certificate for **every** role; the only unmasked path is `GET /:id/identifiers`, which writes `APPLICATION_IDENTIFIERS_REVEALED` with actor, role, fields and timestamp | Closed 2026-11-17: the officer/admin asymmetry (old N-2) is gone. The duplicate-case reveal remains administrator-only |
| S-2 | Public surface is deliberately narrow | `GET /schools` reads `APPROVED_SCHOOLS`; both public POSTs run the application rate limiter | Rate limiting is per IP; a shared campus NAT is a single bucket |
| S-3 | Tracking cannot be enumerated | Code **and** date of birth must match, lookup is by `tracking_code_hash`, failure is a generic 404, response carries no IDs, scores or features | Date of birth is low entropy but is only useful with a valid code |
| S-4 | Concurrent submissions serialise | Transaction-scoped advisory lock plus in-transaction pre-checks; a second submission inside 24 h is refused with `APPLICATION_ALREADY_SUBMITTED` and a message that differs for the same guardian vs. another guardian | Two guardians, one child, no shared identifier: serialised but not rejected (N-5) |
| S-5 | Verification is the real duplicate wall | Exact identifier or name + DOB + school match is checked inside the registration lock; override requires an administrator and a reason; audited with `matched_fields` | Small false-negative window for transliterated names; the model score stays advisory |
| S-6 | Guardian payload is evidence | `student_applications_payload_immutable` trigger, tracking code stored as a hash, `detail()` drops `submitted_payload` and `tracking_code_hash` | None observed |
| S-7 | Award gate covers application cases | `bursaryAwards.controller.js` refuses approval while a high-priority case is open, including application-linked cases, and audits `override_reason` | Covered on 2026-11-17 by `applicationWorkflow.test.js`: an open application case blocks approval, a cleared one does not, and no override audit row is written for the cleared path |
| S-8 | Screening failure is visible, not silent | `screening_failure_code` persists on the row; the tracking page shows an "under manual review" warning instead of a false clear | No retry worker (G-4) — an unscreened application waits for an operator |

## 5. Outstanding work

| # | Item | Class | Note |
| --- | --- | --- | --- |
| G-2 | No frontend for the workflow | **Closed** | `Apply.jsx`, `TrackApplication.jsx`, `Applications.jsx`, routing and nav shipped in `f4e017b` |
| N-1 | No automated frontend tests (`package.json` has only `dev`, `build`, `preview`) | Before pilot | Pages are validated by a clean Vite build only; add RTL tests for the form validation and the role-gated actions |
| N-2 | Field-officer identifier reads unaudited (S-1) | **Closed 2026-11-17** | Both roles are masked in `detail()`; `revealIdentifiers` is the only unmasked path and is audited for officers and administrators alike |
| N-3 | Single JS chunk, 908.10 kB (gzip 201.04 kB), no `React.lazy` in `App.jsx` | Backlog | Code-split the public pages first — guardians are the likeliest mobile users |
| N-4 | `rejected` / `withdrawn` unreachable; `award_recommended` / `approved` still unreachable | **Closed for reject/withdraw 2026-11-17** | `POST /:id/reject` (admin) and `POST /:id/withdraw` (officer/admin) close the case with an audited reason and a 10-character minimum. `award_recommended`/`approved` stay unused by design |
| N-5 | Two guardians, one child, no shared identifier not rejected | Accepted limitation | Documented in `docs/phase3-duplicate-schema-review.md` §7 |
| G-1 | Full `students` scan per screening | Before real register sizes | Needs a measured recall comparison before any prefilter |
| G-3 | Uncalibrated scores (F1 0.651 at 0.5) | Accepted, human in the loop | Keep thresholds configurable |
| G-4 | No re-screen worker for `DUPLICATE_SCREENING_UNAVAILABLE` | Before pilot | Operator action; the failure code already isolates the rows |
| G-5 | Migrations not applied to Azure | **Blocking for any deployment** | `/api/ready` now requires `student_applications`. Two migrations are pending on the target: `20261102_guardian_applications.sql` and **`20261117_application_closure.sql`** (adds `closure_reason`, `closed_by`, `closed_at`, the closure status values and the `*_closure_evidence` check). Do **not** apply either to production from this workstation |
| G-6 | No staff notification on application events | Backlog | The audit events exist to key on |
| G-7 | `FINAL_TEST_REPORT.md` still quotes 151 tests | Docs | Backend is now 293 Jest tests + 35 `node:test` tests |

## 6. Final status

**Complete and locally verified; still not deployment-ready until G-5.**

Ready for Phase 6: N-1 (no frontend unit tests yet) and G-5 (migrations on the target database) are the
only open items that block a pilot. N-2 and N-4 are closed as of 2026-11-17. G-1, G-3, G-4, G-6 and G-7
remain documented limitations with the reasons given above; none of them blocks the guardian → triage →
investigation → decision → verification or the new reject/withdraw closure path.

Verification behind this statement: backend **39 suites / 293 Jest tests** and **35 `node:test` tests**,
ML **33 + 7 + 4 tests**, Vite production build clean (exit 0, 15.07 s).

## 7. Release verification, 2026-11-17

### 7.1 How it was run

- Database: a user-owned PostgreSQL cluster at `%LOCALAPPDATA%\sbms-verify-pg` (port 5432) with database
  `sbms_test` and role `sbms_test_runner`, taken from `backend/.env.test`. The Windows PostgreSQL service
  could not be started without elevation, so a throwaway cluster owned by the current user was used and
  every command loaded `backend/.env.test` into the environment first.
- Backend Jest: four alphabetical chunks with `--runInBand --silent` (memory ceiling ≈ 0.5 GB free; a
  single full run OOM'd). 86 + 93 + 26 + 88 = **293 tests, 39 suites, exit 0**.
- `node --test "test/*.test.js"`: **35/35 pass**, run against a live API on `:5000`
  (`NODE_ENV=development`, `PUBLIC_APP_URL=http://localhost:4174`) and a seeded `admin@sbms.com`
  (`Admin123!`, test database only). Server stopped afterwards by PID.
- ML: `ml-service/.venv/Scripts/python.exe -m unittest discover -s tests` → 33 OK; plus the two
  research suites → 7 OK and 4 OK. No model artifact, config or threshold was modified.
- Frontend: `npm run build` → exit 0, 15.07 s, 2013 modules, `dist/assets/index-BHKLQ0yk.js` 908.10 kB
  (gzip 201.04 kB), CSS 56.95 kB. The >500 kB chunk warning is pre-existing (N-3).

### 7.2 Changed in this release

| File | Change |
| --- | --- |
| `backend/src/db/migrations/20261117_application_closure.sql` | New, **not applied anywhere**: `closure_reason`, `closed_by`, `closed_at`, closure statuses, evidence check |
| `backend/scripts/migrate.js` | Picks up the new migration; still fails loudly on error |
| `backend/src/controllers/applications.controller.js` | `closeApplication` shared by `reject`/`withdraw`; `detail()` masks for both roles |
| `backend/src/routes/applications.routes.js` | `POST /:id/reject` (admin), `POST /:id/withdraw` (officer/admin), `GET /:id/identifiers` opened to officers |
| `frontend/src/pages/Applications.jsx` | `withdrawn` filter, role-agnostic reveal, closure evidence block, reject/withdraw form |
| `backend/tests/*` | New `applicationClosure.test.js`; extended `applications`, `applicationWorkflow`, `duplicateFlags`, `applicationsSchema` |

### 7.3 Manual browser checklist (not automatable here)

1. `/apply` → submit a guardian application → tracking code shown once.
2. `/apply/track` → code + date of birth shows status and timeline; wrong date of birth is a generic 404.
3. Administrator `/applications` → masked identifiers → **Reveal** → values appear; audit row written.
4. Administrator triage → officer investigation → administrator resolve → officer verify → student row.
5. Reject with a 9-character reason is refused; with a 10-character reason the row shows `rejected`,
   `closure_reason`, `closed_by`, `closed_at`, and all later actions are gone.
6. Withdraw as a field officer shows `withdrawn` and keeps the evidence readable.
7. Confirm a duplicate case, then attempt the award decision with override fields → 409
   `DUPLICATE_REVIEW_OPEN`, award stays `submitted`.
8. 375 px viewport: the closure form and the reveal button stay usable.

### 7.4 Azure prerequisites before any deploy

- Run both pending migrations with `backend/scripts/migrate.js` against the target database, in order,
  during a maintenance window: `20261102_guardian_applications.sql` then
  `20261117_application_closure.sql`. **Not performed here.**
- Verify `/api/ready` reports the new tables and columns after migration.
- Seed at least one administrator; confirm `JWT_SECRET`, `PUBLIC_APP_URL` and the ML `ML_SERVICE_URL`
  point at the deployed values.
- No ML artifact, threshold or `model_config.json` change is required for this release.
