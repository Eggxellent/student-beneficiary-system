# Guardian-led application workflow (redesign, Phase 1)

**Status:** approved 2026-11-16 by the project author.  
**Branch:** `redesign/guardian-led-applications`, based on `fix/sbms-completion-work` at `f54ecdc`.  
**Baseline before any change:** backend Jest `33 suites / 255 tests, all passing` (227.9 s) on the local
guarded `sbms_test` database; log captured in `%TEMP%\sbms-baseline.log`. The "151 tests" figure in
`docs/FINAL_TEST_REPORT.md` and the revalidation catalogue is superseded by this run.

This document freezes what is built in Phases 3–5. Anything not listed under *In scope* is out of scope
and must be recorded in the gap register rather than improvised.

## 1. Why the workflow changes

Today a Field Officer registers a student directly, so the record only exists once staff have typed it in
(`backend/src/routes/students.routes.js:8`), and duplicate review, eligibility and award approval are
bolted onto that single record. The redesign makes the **guardian** the originator: the guardian submits
the application, the system screens it for duplicates, a human investigates anything the screen raises,
the Field Officer verifies the submission once, the rules engine assesses eligibility, and the
Administrator approves or rejects the award.

Nothing that already works is removed: duplicate triage, review events, duplicate resolution, saved
eligibility assessments, award decisions, certificates, notifications and audit logging are reused.

## 2. Actors

| Actor | Authentication | Responsibility |
| --- | --- | --- |
| Guardian | None. Holds a tracking code issued at submission | Submits the application once, tracks its status |
| Field Officer | JWT, role `field_officer` | Verifies a submitted application, investigates duplicate cases assigned to them, records the eligibility assessment, recommends an award |
| Administrator | JWT, role `admin` | Triages screened applications, reveals identifiers, resolves duplicate cases, approves or rejects awards |
| System | none | Screens on submission with the existing XGBoost model, records evidence, never decides |

The database role check (`users_role_supported_check`, `backend/src/db/schema.sql:12`) stays
`('admin','field_officer')`. No guardian account, password or session exists, so no identity migration is
required.

## 3. Approved decisions

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | No-login public application form plus a tracking code | Fastest path inside the deadline, no external identity surface, no credential support burden |
| D2 | Applications live in a separate `student_applications` table; a `students` row is created only at Field Officer verification | Keeps "student" meaning verified beneficiary, and leaves the submitted values untouched (rule 8) |
| D3 | Branch from `fix/sbms-completion-work` | That branch carries the 2026-11-15 eligibility-assessment and duplicate-resolution migrations that `dev` lacks |
| D4 | Reuse `services/eligibility.js` unchanged | No invented NG-CDF criteria or allocation ranges (rule 10) |
| D5 | Award approval is blocked while a high-priority duplicate case is open, with an audited override that requires a reason | Prevents an award on an unresolved identity conflict without making the model a decision-maker (rule 6) |

## 4. Application lifecycle

| # | State | Actor | Entry condition | Writes |
| --- | --- | --- | --- | --- |
| 1 | `submitted` | Guardian | Valid form, per-IP rate limit not exceeded | `student_applications` row + `audit_logs` `APPLICATION_SUBMITTED` |
| 2 | `screened` | System | Screening completed (or explicitly recorded as unavailable) | screening columns on the row, duplicate case rows, `audit_logs` `APPLICATION_SCREENED` |
| 3 | `needs_investigation` | Administrator | At least one case at review threshold | `duplicate_flags.status='pending'`, `audit_logs` `APPLICATION_TRIAGED` |
| 4 | `investigated` | Field Officer | A case exists for this application | `duplicate_review_events` with `stage='field_investigation'`, `audit_logs` `APPLICATION_INVESTIGATED` |
| 5 | `resolved` | Administrator | Investigation recorded | case status finalised, `duplicate_resolutions` or `student_applications.duplicate_of_student_id`, `audit_logs` `APPLICATION_DUPLICATE_RESOLVED` |
| 6 | `verified` | Field Officer | No open high-priority case, or administrator cleared it | `students` row, `student_applications.verified_student_id`, `eligibility_assessments` row, `audit_logs` `APPLICATION_VERIFIED` |
| 7 | `award_recommended` | Field Officer | Verified application with a saved assessment | `bursary_awards` row (existing endpoint), `audit_logs` `AWARD_CREATED` |
| 8 | `approved` / `rejected` | Administrator | Award exists, gate satisfied | existing decision endpoint, certificate issued on approval as today |

`rejected` and `withdrawn` are terminal. A rejected application keeps every submitted value and every
review event; nothing is deleted. Screening never writes a terminal state (rule 6).

A cleared case does **not** move the application backwards: `needs_investigation` may be left by
`resolved` (duplicate confirmed) or by `verified` (case closed as not a duplicate). This keeps the
guardian's view monotonic and avoids re-submission.

## 5. Data model changes (two migrations)

> **Status (2026-11-16):** both migrations are written, applied to the local guarded `sbms_test`
> database and covered by `backend/tests/applicationsSchema.test.js`. Endpoints, screening service,
> award gate and test evidence are listed in `docs/guardian-led-handover-2026-11-16.md`. One
> correction was made to §5.2: the legacy unlimited-pair index had to become **partial**
> (`WHERE application_id IS NULL`), because PostgreSQL's `LEAST`/`GREATEST` ignore NULL and would
> otherwise treat every application case against the same student as one index key.

### 5.1 `20261116_student_applications.sql`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | `gen_random_uuid()` |
| `tracking_code_hash` | TEXT NOT NULL UNIQUE | SHA-256 of the code; the plain code is returned once and never stored |
| `status` | VARCHAR(30) NOT NULL DEFAULT `submitted` | CHECK against the eight states in §4 |
| `submitted_payload` | JSONB NOT NULL | Verbatim normalised submission; a trigger rejects any later UPDATE of this column |
| `guardian_name`, `guardian_phone`, `guardian_email`, `relationship_to_student` | text columns | Guardian's own details, collected once |
| `full_name`, `date_of_birth`, `school_code`, `upi`, `birth_certificate_number`, `national_id_number`, `primary_phone` | typed columns | Copies used for screening and verification; the payload stays authoritative for what was submitted |
| `screening_score`, `screening_model_version`, `screening_priority`, `screened_at` | NUMERIC(5,4) / TEXT / VARCHAR(20) / TIMESTAMP | Written by screening only |
| `screening_failure_code` | VARCHAR(40) | Set when the predictor is unavailable, so "not screened" is never confused with "screened clean" |
| `verified_student_id` | UUID REFERENCES `students(id)` | Set once at verification |
| `verified_by`, `verified_at`, `decision_reason` | UUID / TIMESTAMP / TEXT | Audit of the human decision |
| `duplicate_of_student_id` | UUID REFERENCES `students(id)` | Set only when a case is resolved as a confirmed duplicate |
| `created_at`, `updated_at` | TIMESTAMP | `updated_at` maintained in the service layer |

Indexes: `status`, `lower(full_name)`, `tracking_code_hash` (unique), `verified_student_id`.
Immutability: `BEFORE UPDATE` trigger raises if `submitted_payload` differs from `OLD.submitted_payload`
(rule 8).

### 5.2 `20261116_application_duplicate_cases.sql`

| Change | Purpose |
| --- | --- |
| `duplicate_flags.application_id UUID REFERENCES student_applications(id)` | Lets an application enter the existing triage queue |
| `duplicate_flags.student_id` becomes NULLable | Application cases carry `application_id` + `matched_student_id`; registration cases keep `student_id` + `matched_student_id` |
| CHECK `student_id IS NOT NULL OR application_id IS NOT NULL` | No orphan case |
| Unique index `(application_id, matched_student_id) WHERE application_id IS NOT NULL` | Re-screening cannot duplicate a case |
| `duplicate_review_events.stage VARCHAR(20) NOT NULL DEFAULT 'admin_review'` CHECK in (`admin_review`,`field_investigation`) | Distinguishes the Field Officer investigation from the administrator decision in one audit trail |

`duplicate_resolutions` is unchanged: it resolves *student* pairs, and an application case only reaches
resolution after verification has produced a student, or through `student_applications.duplicate_of_student_id`
when the administrator decides the application duplicates an existing beneficiary.

## 6. Permission matrix

| Endpoint | Method | Public | Field Officer | Administrator |
| --- | --- | --- | --- | --- |
| `/api/applications` | POST | yes (rate limited) | – | – |
| `/api/applications/track` | POST | yes (rate limited, code + date of birth) | – | – |
| `/api/applications` | GET | – | own-school list | all |
| `/api/applications/:id` | GET | – | full detail | detail with masked identifiers |
| `/api/applications/:id/identifiers` | GET | – | full detail | reveal, audited |
| `/api/applications/:id/triage` | POST | – | – | yes |
| `/api/applications/:id/investigation` | POST | – | yes | – |
| `/api/applications/:id/resolve` | POST | – | – | yes |
| `/api/applications/:id/verify` | POST | – | yes | – |
| `/api/duplicate-flags/*` | – | – | read own application cases + investigation | unchanged (full queue) |
| `/api/eligibility`, `/api/awards`, `/api/awards/:id/decision` | – | – | unchanged | unchanged |

Public responses never include another person's identifiers, scores, or model features: the tracking view
returns status, timeline timestamps and the applicant's own submitted summary only. The tracking endpoint
requires the code **and** the applicant's date of birth, and is rate limited per IP.

## 7. Validation and anti-abuse rules

- Submission requires: student full name, date of birth, school (must satisfy the existing supported-school
  constraint), guardian name, guardian phone, and at least one identifier (UPI, birth certificate number or
  national ID). Optional fields stay optional; the model tolerates missing values.
- Tracking code: 10 characters from an unambiguous alphabet, generated with `crypto.randomBytes`, returned
  only in the submission response.
- Rate limits: submission and tracking share the existing limiter pattern used by
  `verificationRateLimit`/`loginRateLimit`; limits are per IP and configured, not hard-coded in the handler.
- A second submission by the same guardian phone and child identifiers within 24 hours is refused with a
  pointer to the tracking endpoint rather than creating a second application.

## 8. Screening rules (ML)

| Rule | Detail |
| --- | --- |
| Screening is advisory | The score, the model version and the comparison features are recorded as evidence; nothing is rejected or merged automatically (rule 6) |
| Model and features unchanged | `ml-service/model/xgb_duplicate_model.joblib`, six features from `ml-service/feature_engineering.py`; no retraining, no promotion, no threshold retuning in this sprint (rules 3, 7) |
| Candidate generation | Reuse the generator already used for registration in `students.controller.create`. It is extracted into a service without changing behaviour; the existing duplicate tests must pass unchanged, which is the proof the extraction was behaviour-preserving |
| Thresholds | `DUPLICATE_REVIEW_THRESHOLD` (default 0.30) decides whether a case is opened; `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (default 0.70) or any exact identifier match sets priority `high` (`services/mlDuplicateReview.js:50-59`) |
| Predictor unavailable | The application is still accepted, `screening_failure_code` is set, the administrator sees "not screened", and no case is invented. This mirrors the existing failure semantics instead of pretending a clean screen |
| Model change mid-comparison | Rejected by the existing version-consistency check (`mlDuplicateReview.js:105-107`); the application is marked unscreened rather than half-screened |
| Explainability | Every case stores `comparison_features` so a reviewer can see which fields agreed |

## 9. Eligibility and award rules

- The assessment runs at verification, once, through the unmodified `services/eligibility.js`.
- Inputs are the values the Field Officer confirms, not the guardian's declared figures; the submitted
  payload remains available for comparison, so a mismatch is visible and auditable.
- `eligibility_assessments` keeps storing the inputs, the score, the category and the recommended range,
  including `recommendation_provisional = true` while no approved ranges are configured (rule 10).
- Award creation stays Field-Officer-only and award decision stays Administrator-only (unchanged routes).
- Gate (D5): `PATCH /api/awards/:id/decision` refuses to approve while the student has an open case with
  priority `high`. The refusal names the case id. An administrator may pass `overrideReason`, which is
  stored in the award decision event and the audit log; rejection is never gated.

## 10. Audit and preservation

| Event | Audit action |
| --- | --- |
| Application submitted | `APPLICATION_SUBMITTED` |
| Screening completed / failed | `APPLICATION_SCREENED`, `APPLICATION_SCREENING_FAILED` |
| Case triaged | `APPLICATION_TRIAGED` |
| Field Officer investigation | `APPLICATION_INVESTIGATED` |
| Duplicate resolved | `APPLICATION_DUPLICATE_RESOLVED` |
| Verification, student creation | `APPLICATION_VERIFIED`, `STUDENT_CREATED` |
| Eligibility assessed | existing `ELIGIBILITY_CALCULATED` |
| Identifier reveal | `APPLICATION_IDENTIFIERS_REVEALED` |
| Award gate override | `AWARD_APPROVAL_OVERRIDDEN` |

`submitted_payload` is immutable by trigger, duplicate review events are append-only (existing design), and
no delete route is added for applications or awards.

## 11. Acceptance criteria

1. A guardian submits with no account and receives a tracking code; the same code plus date of birth
   returns the status timeline and no other party's data.
2. The submitted payload is byte-identical after screening, triage, investigation, resolution and
   verification; an UPDATE that changes it fails with a database error.
3. A submission that resembles an existing student opens exactly one case per matched student, with
   score, model version and features stored.
4. A submission with no resemblance to any student opens no case and is still visible to the Field Officer.
5. With the predictor stopped, submission succeeds, `screening_failure_code` is set, and the administrator
   sees an explicit "not screened" state.
6. A Field Officer cannot triage or resolve; an Administrator cannot verify; neither can be reached
   unauthenticated (permission tests per endpoint).
7. Verification creates exactly one student row, links it to the application, and stores one eligibility
   assessment.
8. Award approval is refused while a high-priority case is open, and succeeds with a stored
   `overrideReason` when an administrator overrides; the refusal and the override are both audited.
9. Duplicate resolution keeps both records and their history; nothing is merged or deleted.
10. `npm test` in `backend/` reports no regression against the 33-suite / 255-test baseline, and no existing
    assertion is weakened, skipped or deleted (rule 11).
11. `ml-service` unit tests still pass unchanged (`python -m unittest discover -s tests`).
12. Frontend: `/apply` and `/apply/track` render without authentication; staff screens remain role-gated;
    production build succeeds.

## 12. Out of scope (recorded, not attempted)

Document authentication or OCR, KRA integration, payment processing or disbursement changes, guardian
accounts and passwords, model retraining or promotion, threshold retuning, Azure deployment, live database
changes, SMS/email delivery to guardians, and any change to certificate verification.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Predictor spawn is heavy under memory pressure (known `mlPredictor.integration` failure mode) | Screening failure is a first-class state; the suite is run per group if the full run is unstable |
| Six-hour budget | Two migrations only; reuse of every existing workflow; frontend limited to two new public pages plus two staff screens |
| Candidate generator extraction could change behaviour | Extraction is behaviour-preserving and proven by the existing duplicate suites passing unchanged |
| Duplicate cases now have a nullable `student_id` | The CHECK constraint plus the existing unique unordered-pair index are re-verified by tests before and after the migration |



