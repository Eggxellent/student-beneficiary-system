# MASTER EVIDENCE REGISTER

> **What this file is.** The central register: one ID per substantive claim, with the exact repository location that
> supports it, the verification status, and the limitation that keeps the claim honest. Repository
> `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`.
>
> **Status vocabulary** (the six categories the brief requires): **IMPL** = VERIFIED AND IMPLEMENTED; **NOT IMPL**
> = VERIFIED BUT NOT IMPLEMENTED; **PASS** = TESTED AND PASSED; **FAIL** = TESTED AND FAILED; **NOT TESTED**;
> **UNKNOWN** = UNKNOWN / REQUIRES CONFIRMATION.
>
> **Evidence hierarchy applied:** code and schema first, then executed tests, then reproducible runs, then
> deployment logs, then version-controlled documentation, then drafts, and never a draft as proof of implementation.

---

## 1. System structure and data

| ID | Claim | Evidence | Status | Limitation |
| --- | --- | --- | --- | --- |
| EV-01 | The API is an Express application with 14 controllers and 12 route modules | `backend/src/index.js`; `backend/src/routes/*.js`; `backend/src/controllers/*.js` | IMPL | — |
| EV-02 | The frontend is a React SPA with 14 page components, 3 shared components, an auth context and a hash-token hook | `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/context/AuthContext.jsx`, `frontend/src/hooks/useHashToken.js` | IMPL | — |
| EV-03 | The ML service is a separate Python package invoked as a subprocess from Node | `ml-service/predict.py --server`; `backend/src/services/duplicateCheck.js:262` | IMPL | Spawned per process; not containerised in the local path |
| EV-04 | PostgreSQL holds 13 application tables | `backend/src/db/schema.sql`; `backend/src/db/migrations/`; schema doc §2 | IMPL | Table count excludes the migration ledger |
| EV-05 | Schema changes are forward-only, ledger-tracked and checksum-verified | 14 forward migrations plus one `.down.sql` in `backend/src/db/migrations/`; `backend/src/services/databaseStartup.js` | IMPL | Not replayed against a fresh cluster in this pass |
| EV-06 | Database readiness is checked before traffic is accepted | `backend/src/services/databaseReadiness.js` | IMPL | Readiness false-pass was a defect, now fixed (see §3) |
| EV-07 | Payment state is gated by database constraints as well as API checks | schema doc §9; `disbursements` constraints | IMPL | Triggers inspected, not fuzzed |

## 2. Behaviour

| ID | Claim | Evidence | Status | Limitation |
| --- | --- | --- | --- | --- |
| EV-08 | Two sign-in endpoints issue a JWT; bcrypt hashes passwords | `backend/src/controllers/auth.controller.js`; `backend/src/config/jwtSecret.js` | IMPL | bcrypt cost not benchmarked on the host (NFR-02) |
| EV-09 | Role is re-read from the database on each request, not trusted from the token | `backend/src/middleware/auth.js`; `requireRole.js` | IMPL | — |
| EV-10 | Login and verification endpoints are rate limited | `loginRateLimit.js`, `verificationRateLimit.js`, `certificateRateLimit.js` | IMPL | Limits are per-process, so horizontal scale weakens them |
| EV-11 | Registration validates fields with Zod inside the controller | `backend/src/controllers/students.controller.js` | IMPL | — |
| EV-12 | Only five configured schools are accepted | `backend/src/config/schools.js` | IMPL | The five are a project assumption, not a ministry list |
| EV-13 | Screening compares the submitted record with every registry record | `students.controller.js:75`; `mlDuplicateReview.js:84` (`scorePairs`) | IMPL | Quadratic; 22.67 ms measured at 50 pairs only |
| EV-14 | Pair scores are aggregated to one candidate per record (`top-1`) | `backend/src/services/duplicateAggregation.js` | IMPL | Aggregation choice is a design decision, not validated against alternatives |
| EV-15 | Model version is pinned for the duration of a scan | `duplicateFlags.controller.js:188–196` | IMPL | Guard raises on change; no retry logic |
| EV-16 | ML failure degrades to manual review rather than a silent pass | `backend/src/services/duplicateCheck.js` | IMPL | Degradation path tested at route level only |
| EV-17 | The duplicate queue masks identifiers; reveal is explicit and audited | `duplicateFlags.controller.js`; `duplicate_review_events` | IMPL | — |
| EV-18 | Decisions require a reason and move the case to a terminal state | `duplicateFlags.controller.js`; state machine in schema doc §9 | IMPL | — |
| EV-19 | Eligibility is computed from five weighted factors into four categories | `backend/src/services/eligibility.js`, `bursaryRules.js` | IMPL | Arithmetic partially tested (FR-12 partial) |
| EV-20 | Awards require verification evidence before approval | `bursaryAwards.controller.js`; `bursary_award_verification_events` | IMPL | — |
| EV-21 | Disbursements support issue, clearance, officer-assisted acknowledgement and discrepancy detection | `disbursements.controller.js`; `disbursement_reconciliation_events` | IMPL | — |
| EV-22 | QR tokens are 32 random bytes carried in the URL fragment | `verification.controller.js`; `frontend/src/hooks/useHashToken.js` | IMPL | Fragment handling stops token leakage into logs; it does not make the token secret to the holder |
| EV-23 | Public verification asserts existence only | `verification.controller.js`; `verificationRoute.test.js` | PASS | Confirms existence, never identity, eligibility or payment |
| EV-24 | Certificates store a snapshot, carry a reference and a token, and produce an A4 landscape PDF | `certificates.controller.js`; `certificateDocument.js` | IMPL | PDF content asserted at route level, not visually verified (FR-26 partial) |
| EV-25 | Certificate state `not_current` is honoured when an award changes | `certificates.controller.js`; `bursary_certificates` | IMPL | — |
| EV-26 | Audit rows are written for administrative and reveal actions | `backend/src/services/auditLog.js` | IMPL | Append-only by convention, not by constraint (NFR-21 partial) |

---

## 3. Tests, defects and deployment

| ID | Claim | Evidence | Status | Limitation |
| --- | --- | --- | --- | --- |
| EV-27 | The Jest suite passes 24 suites / 151 tests | `npx jest --runInBand tests`, 2026-11-01 | PASS | One earlier sweep returned 149 or 150 of 151 under memory pressure (G-02) |
| EV-28 | The native suite passes 43/43 in-process and 3/3 out-of-process | `node --test`, 2026-10-31 | PASS | Separate layer; not additive with EV-27 |
| EV-29 | 33 ML-service tests and 7 research-helper tests pass | `unittest discover`, 2026-10-31 | PASS | Unit-level only |
| EV-30 | Browser checks pass 23/23, 9/9 and 11/11 | `scripts/browser-smoke.mjs`, `qr-smoke.mjs`, `registration-fields-smoke.mjs`, 2026-10-30 and 2026-11-01 | PASS | A fourth harness, `admin-reveal-smoke.mjs`, was not re-run (admin password drifted) and is recorded as not run |
| EV-31 | The frontend builds for production | `npm --prefix frontend run build`, exit 0, 2026-11-01 | PASS | Build only; no bundle-size budget asserted |
| EV-32 | A backup can be restored into an independent database with matching digests | `pg_dump` / `pg_restore`, 2026-10-31 | PASS | One rehearsal on synthetic data (NFR-16 partial) |
| EV-33 | Six defects were found in testing and fixed, each with a validating test | `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` §5.4.7 | PASS | Table is scoped to six; the wider history is in the handover and Azure logs |
| EV-34 | A deployed instance answers health and registration-field checks | `docs/azure-deployment-log-2026-10-31.md`; `registration-fields-smoke.mjs` | PASS | Demonstration instance, not production |
| EV-35 | The ML operating point is precision 0.9204, recall 0.8927, F1 0.9063 at a 0.50 cut-off, with a 7.72% hard-negative false-positive rate | `ml-service/evaluate_operating_point.py` output, transcribed in `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §7 | PASS | **Synthetic data only**; pair-level, not beneficiary-level |
| EV-36 | The independent per-pair baseline is 0.35% on 2 000 synthetic unrelated pairs | `docs/ml-evaluation-baseline-2026-10.md` | PASS | Answers a different question from EV-35; both must be quoted together |
| EV-37 | The production model is XGBoost over six features, not the proposal's Random Forest over four | `ml-service/model/`; `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §5 | PASS | Deviation must be stated in Chapters 4, 5 and 6 (G-21) |
| EV-38 | A ten-feature Random Forest exists only as a research candidate | `ml-service/model/research/rf_attachment_style_candidate.joblib` | IMPL | Must never be presented as the production model |
| EV-39 | Screening latency is 22.67 ms at 50 candidate pairs | `performance.test.js` | PASS | Nothing measured above 50 pairs; no load test exists |
| EV-40 | The Docker image is built by CI, not locally | `.github/workflows/`; `Dockerfile` | IMPL | Engine unavailable on the development host, so no local build was observed |

---

## 4. Claims with no supporting evidence, recorded as such

| ID | Claim | Why it has no evidence | Status |
| --- | --- | --- | --- |
| EV-41 | Real-world duplicate-detection accuracy | No adjudicated labels exist | NOT TESTED |
| EV-42 | User acceptance and usability | No study, no participants, no consent record | NOT TESTED |
| EV-43 | Behaviour under load or at scale | No load test was run | NOT TESTED |
| EV-44 | A phone camera scanning a printed QR code | No device capture exists | NOT TESTED |
| EV-45 | Penetration-test resistance | No assessment was commissioned | NOT TESTED |
| EV-46 | Production uptime, monitoring or backup schedule | Demonstration instance only | NOT TESTED |
| EV-47 | The exact Chapter 1 objective wording | Chapters 1–3 are not in this repository | UNKNOWN |
| EV-48 | The wording of supervisor findings SBMS-01…SBMS-18 | Unrecoverable; `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` §4 records the loss | UNKNOWN |
| EV-49 | Whether the deployment's ML path is containerised or subprocess-spawned at runtime | Azure configuration shows the app service; the local path spawns Python | UNKNOWN (G-22) |
| EV-50 | Whether `docs/verification.md` and `docs/uat-test-plan.md` remain part of the evidence base | Both conflict with the implementation; the decision is the author's | UNKNOWN (G-07, G-08) |
| EV-51 | Whether the hardware specification can be reconstructed | Never recorded | UNKNOWN (G-01) |

---

## 5. How to cite an ID

In a chapter: "(EV-27, `MASTER_EVIDENCE_REGISTER.md`)" or, where a section is more useful, the section reference the
row already carries. Two rules:

1. **An ID never travels alone.** Any claim quoted from this register must keep the limitation column with it; the
   limitation is the part that makes the claim defensible.
2. **No new ID without a location.** If a sentence in a draft cannot be tied to a row here, either the sentence is
   wrong or a row is missing; it must not be written and left unsupported.

---

## 6. Related files

`EVIDENCE_AND_VERIFICATION_REPORT.md` §2–§6 (claim-level index in prose),
`SBMS_TEST_EVIDENCE_CATALOGUE.md` §2 (every test artefact with date and command),
`SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §4 (the forbidden claims),
`ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` §3 (the same gaps in academic-coverage form).

