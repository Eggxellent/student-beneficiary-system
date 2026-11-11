# SBMS Phase 2 — supervisor findings review

**Prepared:** 2026-10-31
**Repository:** `student-beneficiary-system`
**Branch / commit reviewed:** `fix/sbms-completion-work` @ `621f23f`
**Mode of work:** read-only inspection. No source file, schema, migration, configuration,
or document in the repository was modified while producing this review, and no
migration, deployment, or database write was performed.

---

## 1. Purpose and scope

Phase 1 of the capstone (deployment plus end-to-end acceptance) is recorded as complete in
`docs/azure-deployment-log-2026-10-31.md:126-128`. The immediate next action named there is:

> `2. Phase 2: supervisor gap remediation **SBMS-01…18**.`

This review was commissioned to turn that line into an actionable Phase 2 checklist by:

1. recovering the actual supervisor findings identified as **SBMS-01 … SBMS-18**;
2. separating genuine SBMS defects from material that belongs to a different system;
3. reconciling each finding against the current implementation, so that work which is
   already done is not re-done and work that is outstanding is not silently dropped.

**Scope:** the tracked repository at `621f23f`, the documentation under `docs/` and the
repository root, and the local document stores that a capstone student would plausibly
have used to receive supervisor feedback.

**Out of scope:** changing code, running migrations, contacting the supervisor, and any
editorial judgement about the quality of the supervisor's comments.

---

## 2. Constraints and integrity rules applied

These rules governed every statement in this document.

| Rule | Consequence |
| --- | --- |
| No finding may be invented. | An ID whose wording could not be recovered is marked **Original finding: unavailable**, never paraphrased into a plausible-sounding requirement. |
| Confirmed facts and assumptions must be separated. | Facts carry a file/line or command citation. Inferences are labelled *Assumption* and are kept out of §6 entirely. |
| Absence of evidence is reported as absence of evidence. | "Not found in the repository" is not restated as "does not exist"; §11 names what is missing. |
| A finding is only "resolved" against the supervisor's own words. | Without the wording, no ID can be closed. Implementation evidence is recorded but does not close an ID. |
| Unrelated systems are not absorbed into scope. | The flood/IoT specification found on disk is analysed in §8 and excluded, not mined for pseudo-findings. |

---

## 3. Evidence sources and search coverage

### 3.1 Repository searches performed

| Search | Command (abbreviated) | Result |
| --- | --- | --- |
| Identifier scan of the whole tracked tree | `git grep -n -E 'SBMS-(0[2-9]\|1[0-8])'` | **0 hits** |
| Identifier scan, first ID only | `git grep -n -E 'SBMS-01'` | **1 hit**: `docs/azure-deployment-log-2026-10-31.md:128` |
| History scan for the identifier | `git log --all -S'SBMS-01' -- . ':!node_modules'` | **1 commit**: `a90277d docs(azure): record the live deployment, its evidence and the stop log` |
| History scan for the surrounding phrase | `git log --all -S'supervisor gap'` | no additional content beyond the same document |
| Text scan of all documentation | `Select-String -Path 'docs\*.md','*.md' -Pattern 'Phase 2\|supervisor'` | 15 hits, all in `docs/`; **none is a findings list** |

### 3.2 Documents read in full or in part

Repo documentation: `docs/azure-deployment-log-2026-10-31.md`,
`docs/SBMS_PROJECT_HANDOVER_2026-10.md`, `docs/REMEDIATION_PROGRESS.md`,
`docs/FINAL_TEST_REPORT.md`, `docs/FINAL_COMPLETION_AUDIT.md`,
`docs/ml-evaluation-policy.md`, `docs/repository-cleanup-2026-10-31.md`,
`docs/CAPSTONE_DEMO_CHECKLIST.md`, `docs/CHAPTER_5_EVIDENCE_FILL.md`,
`docs/DATABASE_RECONCILIATION_AUDIT.md`, `docs/PRODUCTION_DATABASE_RECOVERY_AUDIT.md`,
`docs/business-workflow-verification-2026-10-30.md`, `docs/qr-verification-2026-10-30.md`,
`docs/ml-decision-sheet-2026-10-30.md`, `docs/eligibility-rules.md`,
`docs/uat-test-plan.md`, `docs/user-guide.md`, plus root `README.md`,
`PROJECT_CONTEXT.md`, `DEVELOPMENT_TEST_DATA.md`.

Implementation: `backend/src/index.js`, `middleware/auth.js`, `middleware/requireRole.js`,
the controllers (auth, students, duplicateFlags, disbursements, bursaryAwards, reports,
adminDashboard, users, eligibility, beneficiaries), the services (duplicateCheck,
duplicateAggregation, mlDuplicateReview, bursaryRules, auditLog, studentRecordFormat,
databaseReadiness), `config/settings.js`, `db/schema.sql`, all 14 files in
`backend/src/db/migrations/`, and every file in `backend/src/routes/`.
Frontend: `frontend/src/App.jsx` and the page inventory under `frontend/src/pages/`.
ML: the file listing and `requirements.txt` of `ml-service/`.

### 3.3 External locations scanned

| Location | Item found | Bearing on SBMS-01…18 |
| --- | --- | --- |
| `Downloads` | `Student-Beneficiary-Management-System-Specification.pdf` | Title matches SBMS; **content is a flood/IoT monitoring specification**. Excluded — see §8. |
| `Downloads` | `SBMS_Chapters_4_and_5_Working_Draft.docx`, `NgigiPeter_161361_SBMS_Report_with_Ch4_Ch5.docx`, `NgigiPeter_SBMS_Chapters_4_and_5_Completed.docx` | Chapter text only. No `SBMS-NN` identifier, no supervisor comment part (`word/comments.xml`), no findings list. |
| `Desktop`, `Documents`, `OneDrive`, `sbms-db-backups` | no supervisor findings document | — |

---

## 4. What is confirmed about the finding set

**Confirmed:**

1. The Phase 2 work item is named in exactly one place in the repository,
   `docs/azure-deployment-log-2026-10-31.md:128`, as the summary label
   `supervisor gap remediation **SBMS-01…18**`.
2. That label is a **pointer, not a list**. It enumerates no titles, descriptions, severity,
   or acceptance criteria for any of the eighteen items.
3. The ellipsis form `01…18` is the only occurrence of the numbering scheme at `621f23f`;
   **no individual identifier `SBMS-02` … `SBMS-18` appears anywhere** in tracked files,
   code comments, or test names.
4. The commit that introduced the label (`a90277d`) added no accompanying findings
   document; it only records the Azure deployment, its evidence and the stop log.
5. No deleted findings document was found: searching all reachable history with
   `git log --all -S` on the identifier and on the phrase `supervisor gap` produced no
   additional content.
6. No file on disk in the scanned locations contains the eighteen findings.

**Therefore:** the wording of SBMS-01 … SBMS-18 is **not recoverable from this workspace**.
The list reached the project through a channel the repository cannot see — realistically the
supervisor's marked script, a feedback email, or a returned progress report (§11).

**Not assumed:** that the eighteen items correspond one-for-one to the eighteen gaps this
review can independently observe in the repository. A match in counts would be an artefact of
writing, not evidence.

---

## 5. Classification scheme

Each ID in §6 receives exactly one classification and one reconciliation state.

| Classification | Meaning |
| --- | --- |
| **Genuine SBMS defect** | A supervisor finding about the student beneficiary management system that describes behaviour the current code or documentation does not satisfy. |
| **Already resolved** | A genuine SBMS finding whose behaviour the current implementation demonstrably satisfies, verified against the finding's own wording. |
| **Not applicable / out of scope** | A finding that concerns a different system, a different deliverable, or an item outside the capstone's agreed scope. |
| **Requires clarification** | The finding cannot be classified because its wording, target, or acceptance criterion is missing or ambiguous. |

| Reconciliation state | Meaning |
| --- | --- |
| **Verifiable** | Both the finding and the relevant implementation evidence exist in hand. |
| **Unverifiable — wording missing** | The ID is known to exist (by number) but its content is not available. No closure is possible. |
| **Verified present** | An independent repository observation (not a supervisor finding) that is recorded here for the Phase 2 owner. |

---

## 6. Reconciliation table, SBMS-01 … SBMS-18

All eighteen IDs are listed so that the table is a complete record of the audit, not a
sample. Where the original wording is missing, the row states that plainly rather than
guessing. The final column names what is required before the row can move.

| ID | Original finding (verbatim) | Classification | Reconciliation state | Evidence in hand | Action required to progress |
| --- | --- | --- | --- | --- | --- |
| SBMS-01 | unavailable | Requires clarification | Unverifiable — wording missing | Only the existence of the ID range is confirmed (`azure-deployment-log-2026-10-31.md:128`) | Obtain verbatim wording |
| SBMS-02 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-03 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-04 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-05 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-06 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-07 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-08 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-09 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-10 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-11 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-12 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-13 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-14 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-15 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-16 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-17 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |
| SBMS-18 | unavailable | Requires clarification | Unverifiable — wording missing | as above | Obtain verbatim wording |

**Reading the table:** eighteen rows of "unavailable" is the finding of this review, not a
formatting failure. Any row filled with an invented requirement would be worse than useless —
it would send Phase 2 work in a direction the supervisor never asked for, and it would make the
final report unverifiable against the marked script.

---

## 7. Verified implementation baseline (read-only)

This section records what the code at `621f23f` actually does. It exists so that, once the
wording arrives, each finding can be reconciled in minutes rather than re-investigated. Nothing
here is attributed to a supervisor ID.

### 7.1 Application surface

| Capability | Evidence |
| --- | --- |
| API mounts twelve routers plus one direct verification route (beneficiaries, auth, audit logs, students, duplicate flags, disbursements, awards, settings, reports, eligibility, admin dashboard, users) | `backend/src/index.js:85-96`, verification route at `:63` |
| Liveness `GET /api/health` is process-only | `backend/src/index.js:66-68` |
| Readiness `GET /api/ready` checks DB name and required relations via the API pool | `backend/src/index.js:70-83`, `services/databaseReadiness.js` |
| Public QR verification `POST /api/verify` is rate-limited before body parsing | `backend/src/index.js:62-64` (single registration; corrected after review — see `SBMS_O10_O11_IMPLEMENTATION_REPORT.md`) |
| Verification returns existence only — a 64-hex token is accepted, `{found:true\|false}` is returned, and no student field is ever returned; failures are a generic 503 | `controllers/verification.controller.js:3, 5-24` |

### 7.2 Authentication and authorisation

| Capability | Evidence |
| --- | --- |
| Role guard returns 401 unauthenticated and 403 for a role that is not allowed | `middleware/requireRole.js:1-19` |
| Only two roles exist: `admin` and `field_officer` | `db/schema.sql:12, 22` |

Route-level matrix as declared (verified by reading every file in `backend/src/routes/`):

| Area | admin | field_officer | Evidence |
| --- | --- | --- | --- |
| Admin dashboard summary | yes | no | `adminDashboard.routes.js:8` |
| Audit log list | yes | no | `audit.routes.js:8` |
| User management (all routes) | yes | no | `users.routes.js:8` |
| Student list/detail/create, school list | **no** | yes | `students.routes.js:8-12` |
| Duplicate flags list / evaluate / scan / decide | yes | no | `duplicateFlags.routes.js:9-12` |
| Reports export (PDF) | yes | no | `reports.routes.js:11` |
| Duplicate threshold get/update | yes | no | `settings.routes.js:8-9` |
| Awards: list | yes | yes | `bursaryAwards.routes.js:8` |
| Awards: create, record verification | no | yes | `bursaryAwards.routes.js:9-10` |
| Awards: approve/reject decision | yes | no | `bursaryAwards.routes.js:11` |
| Disbursements: list exceptions, create payment | yes | yes | `disbursements.routes.js:10-11` |
| Disbursements: link legacy payment to award | yes | no | `disbursements.routes.js:12` |
| Disbursements: payment status, receipt acknowledgement | yes | yes | `disbursements.routes.js:13-14` |
| Eligibility calculation | no | yes | `eligibility.routes.js:8` |
| Legacy beneficiary CRUD | no | yes | `beneficiaries.routes.js:12-14` |

### 7.3 Duplicate detection and human review

| Capability | Evidence |
| --- | --- |
| Decisions are constrained to `confirmed_duplicate`, `not_duplicate`, `needs_verification`, each with a mandatory reason of 5–1000 characters | `controllers/duplicateFlags.controller.js:13-17` |
| Review payloads mask UPI / birth-certificate / National ID values before display | `controllers/duplicateFlags.controller.js:37-42` |
| Priority is computed from the model score plus exact-identifier matches, and the same helper is shared with the registration response so queue and confirmation screen cannot disagree | `controllers/duplicateFlags.controller.js:69-84` |
| Thresholds are environment-configurable: high-priority 0.70, review 0.30, ML review score 0.50 | `config/settings.js:6-8` |
| Flags and review events are separate tables | `db/schema.sql:75, 98` |
| A payment cannot be issued while any flag for the student is pending, needs verification, or is a confirmed duplicate (HTTP 409) | `controllers/disbursements.controller.js:86-95` |
| An award cannot be approved under the same conditions (HTTP 409), and open duplicate counts are surfaced on the award list | `controllers/bursaryAwards.controller.js:34-47, 178-187` |

### 7.4 Reconciliation, reporting and audit

| Capability | Evidence |
| --- | --- |
| Admin dashboard returns headline counts plus monthly series, open duplicate count, the four latest audit actions, and award-versus-disbursement reconciliation figures (approved but unpaid, issued awaiting clearance, receipt discrepancies) | `controllers/adminDashboard.controller.js:23-62` |
| PDF report export is implemented with `pdfkit` and covers the same reconciliation figures | `controllers/reports.controller.js:3, 9, 49-65` |
| Clearing a payment requires an evidence reference; failing or cancelling requires a reason of at least five characters | `controllers/disbursements.controller.js:17-27` |
| Receipt acknowledgement records an acknowledged amount, an evidence reference and optional notes; overdue days come from configuration | `controllers/disbursements.controller.js:29-33, 5-6, 40-51` |
| Payment-state transitions and exception reasons are centralised in a rules service rather than duplicated in the controller | `services/bursaryRules.js` (used at `disbursements.controller.js:6, 45, 57`) |
| Mutations write to `audit_logs`, which is a first-class table and is read back by the dashboard | `services/auditLog.js`, `db/schema.sql:123`, `adminDashboard.controller.js:36` |

### 7.5 Data layer, migrations and tests

| Fact | Evidence |
| --- | --- |
| Baseline schema declares `users`, `students`, `duplicate_flags`, `duplicate_review_events`, `disbursements`, `audit_logs`, `reports`, `beneficiaries` | `db/schema.sql:5, 27, 75, 98, 112, 123, 134, 151` |
| Bursary award and reconciliation tables are introduced by migration, not by the baseline schema | `db/migrations/20261023_bursary_award_reconciliation.sql` |
| The migrations directory holds 14 SQL files (13 forward, 1 down) | directory listing of `backend/src/db/migrations/` |
| Full guarded backend suite passed on a disposable, loopback-only PostgreSQL 17 container: 16/16 suites, 79/79 tests | `docs/REMEDIATION_PROGRESS.md:67` |
| Frontend page inventory: AdminDashboard, AuditLogs, Disbursements, DuplicateReview, Eligibility, FieldOfficerDashboard, Login, Reports, Settings, StudentRegistration, Students, UserManagement, Verification | `frontend/src/pages/` |
| The ML service is a Python package with training, evaluation, integrity-check and prediction scripts, including `predict.py`, `train_model.py`, `evaluate_operating_point.py` and `check_training_integrity.py` | `ml-service/` |

**Limit of this baseline:** everything above is static inspection of source plus the repository's
own recorded test run. No server was started, no query was issued, and no browser flow was
driven while preparing this review, so none of it constitutes runtime verification.

---

## 8. Out-of-scope material: the flood/IoT specification

`Student-Beneficiary-Management-System-Specification.pdf`, held outside the repository, carries a
title that matches this capstone but does not describe this system. Its content concerns
sensor-driven environmental monitoring — water-level and rainfall sensing, IoT gateway telemetry,
threshold-based flood alerts and emergency notification — and it contains no student, guardian,
school, bursary award, disbursement, duplicate-review or audit construct.

Consequences, stated explicitly:

1. It is **not** a source of SBMS-01 … SBMS-18 and must not be cited as one.
2. It must not be used to generate "missing feature" findings. Doing so would produce a checklist
   for building a different system into SBMS.
3. If the supervisor's list turns out to contain items that appear only in that document (for
   example, alerting, mapping or telemetry requirements), that is itself a clarification issue to
   raise with the supervisor — the item would need to be either withdrawn or restated in SBMS
   terms. It would not become an SBMS defect by default.

The three `SBMS` chapter documents found alongside it are in scope as background reading but are
not a findings list; they contain no supervisor annotations and no `SBMS-NN` identifiers.

---

## 9. Observations register (not supervisor findings)

These are gaps this review can evidence independently from the repository. They are listed so the
Phase 2 owner does not have to rediscover them, and they are **deliberately kept separate from
§6**. Several are plausible candidates for what the supervisor noticed, but that is an
*assumption* and is not used to populate any ID.

| # | Observation | Evidence | Status |
| --- | --- | --- | --- |
| O1 | Policy questions D1–D5 are unanswered, and the handover states Phase 2 cannot finish until they are | `docs/SBMS_PROJECT_HANDOVER_2026-10.md:200` | Open — blocks Phase 2 completion |
| O2 | The ML decision cutoff (0.50) is unvalidated because no adjudicated ground truth exists | `docs/FINAL_TEST_REPORT.md:241`, `docs/ml-evaluation-policy.md:38` | Open |
| O3 | Reported ML evaluations are synthetic and do not establish real-world performance | `docs/REMEDIATION_PROGRESS.md:19` | Open |
| O4 | The Azure container app has no log stream (D7), so a failed revision's cause is unreadable | `docs/azure-deployment-log-2026-10-31.md:112` | Open — operational |
| O5 | The legacy `beneficiaries` workflow and the newer `students` workflow coexist, and their intended relationship needs a product/schema decision | `docs/REMEDIATION_PROGRESS.md:21`, `docs/FINAL_COMPLETION_AUDIT.md:34` | Open — decision required |
| O6 | The QR verification token has no expiry or revocation mechanism in the inspected path | `docs/REMEDIATION_PROGRESS.md:18` | Open |
| O7 | Rate limiting for the public verify endpoint is in-process, so it does not hold across instances | `docs/FINAL_COMPLETION_AUDIT.md:20` | Open |
| O8 | There is no production-grade migration runner and no initial-admin seed | `docs/FINAL_COMPLETION_AUDIT.md:17, 35` | Open |
| O9 | No authoritative school-code mapping exists; the five allowed school values are names | `docs/REMEDIATION_PROGRESS.md:20` | Open — awaiting verified codes |
| O10 | All `/api/students` routes are `field_officer`-only, so an `admin` receives HTTP 403 when listing or reading students, even though admins own duplicate review and the dashboard | `backend/src/routes/students.routes.js:8` | **Resolved 2026-10-31:** intended least-privilege separation, no permission change; policy pinned by `tests/roleAuthorization.test.js` and `tests/students.test.js` |
| O11 | `POST /api/verify` is declared twice in the app: once to attach the rate limiter before body parsing (`index.js:57`) and once to attach the handler (`index.js:82`). It works only because Express continues to the later matching route | `backend/src/index.js:57, 82` | **Fixed 2026-10-31:** registered once as limiter → parser → handler (`index.js:62-64`); pinned by `tests/verificationRoute.test.js` |

O10 and O11 were both acted on after this review: O10 was confirmed as intended behaviour and left
unchanged (with the policy now pinned by tests), and O11 was fixed by registering `POST /api/verify`
once. The evidence citations inside those two rows describe the pre-fix file; the current wiring and
the reasoning are recorded in `SBMS_O10_O11_IMPLEMENTATION_REPORT.md`.

O1, O2, O3, O5, O6 and O9 are the items most likely to appear on a supervisor's list for a project
of this type, and O10/O11 are the kind of detail a careful marker notices. None of them may be
written into §6 as SBMS-01 … SBMS-18 without the supervisor's own wording.

---

## 10. Counts and conclusions

### 10.1 Counts for this review

| Measure | Count |
| --- | --- |
| IDs known to exist | 18 (`SBMS-01` … `SBMS-18`) |
| IDs whose verbatim wording was recovered | **0** |
| Classified **Genuine SBMS defect** | **0** |
| Classified **Already resolved** | **0** |
| Classified **Not applicable / out of scope** | **0** |
| Classified **Requires clarification** | **18** |
| Out-of-scope documents identified and excluded | 1 (the flood/IoT specification) |
| Independent repository observations recorded (not findings) | 11 (§9) |
| Verified implementation capabilities catalogued for later reconciliation | §7 |

### 10.2 Conclusions

1. **The Phase 2 checklist cannot be produced from this workspace.** The eighteen findings exist
   as a label in one documentation line and nowhere else; their content is external.
2. **No finding can yet be called a genuine defect, resolved, or out of scope.** Those three
   classifications all require the supervisor's text as the reference point. Marking any ID today
   would be fabrication.
3. **The out-of-scope risk is one identifiable artefact, not a hidden subset of the list.** The
   flood/IoT specification is a different system; excluding it is straightforward. Whether any of
   SBMS-01 … SBMS-18 actually came from it cannot be judged without the list.
4. **Phase 2 is not blocked on engineering capability.** §7 shows registration, duplicate
   screening with human review, RBAC, awards, disbursements, reconciliation, reporting and audit
   are all present in source with tests recorded as passing. The likely remaining Phase 2 work is
   evidential and policy work (O1–O3, O9), plus whatever the supervisor's own words add.
5. **The single highest-value next action is administrative, not technical:** obtain the written
   findings.

---

## 11. Documents required to complete the review

### 11.1 Missing inputs, in priority order

| # | Document | Why it is needed | Where it would normally live |
| --- | --- | --- | --- |
| 1 | The supervisor's findings list, numbered `SBMS-01` … `SBMS-18` (signed or emailed) | The only artefact that can populate the "Original finding" column and permit classification | Supervisor's email, department portal, or a returned printed copy |
| 2 | The marked or annotated script / proposal / progress report the findings were written against | Supplies the wording *and* the exact page or section each item refers to, which determines the acceptance criterion | Student's own file copies |
| 3 | Any meeting minutes, feedback sheet, or continuous-assessment form containing the same items | Corroborates item counts and severity if the list is incomplete | Department records |
| 4 | The rubric or second-marker form, if one was used | Distinguishes a genuine SBMS defect from a presentation or documentation remark | Department records |
| 5 | Confirmation of the system version the findings refer to (commit, date, or demonstration session) | Without it, "resolved" claims could be measured against the wrong build | The deployment log already fixes Phase 1 to 2026-10-31, but not the version assessed |

Nothing in the repository substitutes for items 1 and 2. The closest internal artefacts are the
forward reference at `docs/azure-deployment-log-2026-10-31.md:128` and the eleven observations in
§9, and both are explicitly excluded as substitutes.

### 11.2 What to do the moment the list arrives

1. Transcribe the eighteen items **verbatim** into a tracked document using the repository's
   existing naming convention, for example `docs/supervisor-findings-2026-10.md`. Verbatim matters:
   a paraphrase cannot be checked against the supervisor later.
2. Freeze that document. Findings are evidence; they are not edited to match the implementation.
3. Re-run §6 against it and fill the table in this file, or regenerate it, using this row shape:

   ```
   | SBMS-07 | <verbatim text> | Genuine defect / Already resolved / Not applicable / Requires clarification | Verifiable | <file:line or doc:line evidence> | <action> |
   ```

4. Re-check every "Already resolved" row at runtime — start the API, exercise the route, capture
   the response — not only by reading source. §7 is static evidence and is not a substitute.
5. Update `docs/azure-deployment-log-2026-10-31.md:128` so the Phase 2 line points at the tracked
   findings document instead of the bare label `SBMS-01…18`.
6. Only then decide which of §9's observations are in scope, and record that decision rather than
   letting it be inferred.

### 11.3 A note on the count

Eighteen supervisor identifiers against eleven independently observable repository gaps is a
mismatch this review makes no attempt to close. Nothing in §9 was trimmed or padded to bring the
counts into line, and no observation is promoted into an ID to fill a slot. If the recovered list
contains items that no observation in §9 covers — very likely, since the supervisor saw the system,
the report and the demonstration — that is expected. The supervisor's list is the authority on what
Phase 2 must fix.

---

**Statement of integrity.** This review reports what the repository and the accessible documents
contain, and reports the absence of a findings list as an absence. It does not invent requirements,
does not attribute any repository observation to a supervisor identifier, does not treat the
flood/IoT specification as SBMS scope, and does not claim runtime verification that was not
performed. Prepared at `621f23f` on branch `fix/sbms-completion-work`; the repository was not
modified apart from the addition of this file.
