# CHAPTER 4 EVIDENCE PACKAGE: SYSTEM ANALYSIS AND DESIGN

> **What this file is.** The evidence a writer needs for Chapter 4, condensed to "what may be stated, on what
> basis, and where the full detail lives". It is the Chapter 4 entry point of the nine-file handover set.
> Repository `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`.
>
> **Where the full detail lives.** Prose: `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` (§4.1–§4.8). Architecture:
> `SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md`. Schema: `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md`.
> Interfaces: `SBMS_API_ENDPOINT_CATALOGUE.md`, `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md`. Controls:
> `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md`. Figures: `DIAGRAM_SPECIFICATIONS.md`.

---

## 1. What Chapter 4 may assert, and on what basis

| Assertion the chapter needs | Basis (code-level) | Status |
| --- | --- | --- |
| Three-tier system: React SPA, Express API, PostgreSQL, Python ML service | `frontend/`, `backend/`, `ml-service/`, `docker-compose.yml` | VERIFIED AND IMPLEMENTED |
| Three roles, enforced server-side, role re-read per request | `backend/src/middleware/auth.js` and route guards | VERIFIED AND IMPLEMENTED |
| 45 HTTP endpoints in ten families | `SBMS_API_ENDPOINT_CATALOGUE.md` §2–§4 | VERIFIED AND IMPLEMENTED |
| 13 tables, 14 forward migrations with a ledger and checksums | `backend/src/db/migrations/`, `backend/src/db/schema.sql`; schema doc §2–§3 | VERIFIED AND IMPLEMENTED |
| Screening compares each new record with the whole registry, then scores pairs in the ML service | `backend/src/services/duplicateCheck.js`, `duplicateAggregation.js`, `mlDuplicateReview.js` (which spawns `ml-service/predict.py --server`) | VERIFIED AND IMPLEMENTED |
| The ML score is advisory: an administrator decides, with a recorded reason | `backend/src/controllers/duplicateFlags.controller.js`; `duplicate_flags` state machine | VERIFIED AND IMPLEMENTED |
| Payments are gated in the database as well as the API | schema doc §9 (constraints and triggers) | VERIFIED AND IMPLEMENTED |
| QR codes identify a student record only — never identity, eligibility or payment | `backend/src/controllers/verification.controller.js`; 10 route tests | VERIFIED AND IMPLEMENTED |
| Design is reproducible from specifications alone | 24 figure specifications, each with implementation references | Specifications complete; drawings not produced |

## 2. Requirement analysis: the numbers a writer must use

| Group | Count | Verified | Partial | Deviated | Gaps |
| --- | --- | --- | --- | --- | --- |
| Functional requirements delivered (FR-01…FR-30) | 30 | 24 | 6 | 0 | 0 |
| Proposal requirements carried as deviations (FR-31…FR-33) | 3 | 0 | 0 | 3 | 0 |
| Functional gaps reported as gaps (FR-34…FR-37) | 4 | 0 | 0 | 0 | 4 |
| Non-functional requirements (NFR-01…NFR-21) | 21 | 14 | 7 | 0 | 0 |

The six partial FRs are FR-12, FR-19, FR-25, FR-26, FR-28 and FR-29; the seven partial NFRs are NFR-01,
NFR-13, NFR-14, NFR-16, NFR-18, NFR-19 and NFR-21. These are counted from the status cells in
`SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §6–§8, not maintained as a separate figure.

**The deviation the chapter must state, not hide** (G-21): the proposal named a Random Forest over four
similarity features; the delivered classifier is XGBoost over six features (`ml-service/model/`). Three of the
six inputs are the proposal's features; three are added signals. Chapter Four states this in the FR-31 row of
§4.2.2 and again in §4.4.4, and Chapter Six repeats it in §6.2.4.

## 3. Analysis artefacts required, and what each must encode

| Artefact | Must encode | Specification |
| --- | --- | --- |
| System context (Figure 4.1) | SBMS as one process; four external actors; three external systems | `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.3.1 |
| Use case (Figure 4.2) | Three actors outside the boundary; 14 use cases; `<<include>>` screening | §4.3.2 |
| Activity: registration and screening (Figure 4.3) | Four swimlanes; validation failure path; advisory-score branch | §4.3.3 |
| Activity: review, approval, payment gate (Figure 4.4) | Three swimlanes; terminal states; reminder and escalation | §4.3.4 |
| Class diagram (Figure 4.5) | 13 classes with multiplicities and state enums | §4.3.5 |
| Sequence: registration (Figure 4.6) | Synchronous API, subprocess ML call, write-then-flag ordering | §4.3.6 |
| Sequence: duplicate decision (Figure 4.7) | Reveal-then-decide, audit rows, terminal outcome | §4.3.7 |
| Sequence: approval to certificate (Figure 4.8) | Snapshot, token, PDF, revocation path | §4.3.8 |
| Sequence: public verification (Figure 4.9) | Fragment token, rate limiter, existence-only response | §4.3.9 |
| ER diagram (Figure 4.10) | Chen notation, all 13 tables, cardinalities, FK actions | §4.3.10 |
| ML pipeline (Figure 4.11) | Offline lane (data → features → train → artifact) and online lane (request → score → advisory flag) | §4.3.11 |
| Architecture (Figure 4.12) | Tiers, trust boundaries, the human decision gate drawn explicitly | §4.4.1 |


## 4. Design facts that must match the code

| Design area | Fact | Evidence |
| --- | --- | --- |
| Deployment | Frontend and API on Azure App Service; PostgreSQL Flexible Server; ML service containerised or run as a subprocess | `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` §3–§7 |
| Authentication | Short-lived JWT, bcrypt hashing, role claims re-validated per request | `backend/src/middleware/auth.js` |
| Validation | Zod schema per route, defined in each controller; five-school constraint from `backend/src/config/schools.js`; phone and identifier normalisation in `backend/src/services/studentRecordFormat.js` | `backend/src/controllers/` |
| Screening | Advisory lock per sweep; whole-registry comparison; `top-1` aggregation in `duplicateAggregation.js`; model version pinned per scan | `backend/src/services/` |
| State machines | Duplicate flag, award, disbursement and certificate lifecycles reject illegal transitions | schema doc §9 |
| Privacy | Masked identifiers in the queue; explicit audited reveal | `backend/src/controllers/duplicateFlags.controller.js` |
| ML integration | Six features; 0.50 cut-off; score stored; ML failure degrades to manual review, never a silent pass | `ml-service/predict.py`; `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §5–§6 |

## 5. Interface design: what each screen figure must show

Twelve screen figures (4.13–4.24) are specified in §4.5.1–§4.5.8 and itemised in
`FIGURE_PLACEHOLDER_CHECKLIST.md` §2. Each specification names the route, the audience, the data requested, the
controls that must be visible and the states the screen must render, so a screenshot can be checked against the
specification rather than the specification being reverse-engineered from a screenshot.

## 6. What Chapter 4 must not claim

- A number of users, records or deployments: no production usage exists, so no usage figure is supportable.
- That the ML model decides duplicates: the human gate is a design control and must be drawn as a boundary.
- That figures exist: they are specified only, and every placeholder says so.
- That a phone camera scanned a printed code: no such capture exists (G-11).

## 7. Open items affecting Chapter 4

| Item | Effect | Owner |
| --- | --- | --- |
| G-03/G-04/G-05 figures and screenshots | The interface section cannot be illustrated | Author |
| A-2 use-case table granularity | §4.3.2 may need more or fewer use-case tables | Author |
| A-3 screenshot provenance | Captions must say whether the instance is Azure or local | Author |

`ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` §3 carries the full gap list; `MASTER_EVIDENCE_REGISTER.md` carries the
evidence IDs behind every row above.

## 8. Related files

`CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` (the chapter), `DIAGRAM_SPECIFICATIONS.md` (figure register),
`SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` (schema), `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md` (screens).
