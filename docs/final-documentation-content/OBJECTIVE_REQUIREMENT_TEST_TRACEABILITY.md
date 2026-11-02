# OBJECTIVE–REQUIREMENT–TEST TRACEABILITY

**Purpose.** This file maps each specific objective from Chapter One to the requirements that operationalise it, the code
that implements them, the design elements that explain them, the tests that demonstrate them, and the conclusion that
reports the result. It is the audit trail supporting the claim in Chapter Six that no conclusion rests on untested
functionality.

**References:** `Project Proposal- 169613.pdf` §1.3.1 (objectives), Chapter 4 of this documentation set (requirements and
design), Chapter 5 (implementation and testing), Chapter 6 (conclusions), repository at `fix/sbms-completion-work` @
`d6b5032`.

**Status vocabulary:** **V** = verified by an executed test or recorded observation; **P** = partially verified; **N** =
implemented but not tested; **X** = not implemented (by scope or as a recorded gap). Where a requirement is implemented and
exercised incidentally but the property it names is never asserted, the row is marked **P** and the missing assertion is
named; `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` uses the same verdict for the same requirement, so the two files can be
read side by side without reconciling numbers.

---

## 1. Objective → requirement → evidence map

### Objective (i): investigate the existing challenges of manual registration and tracking

| Element | Content |
| --- | --- |
| Requirements serving the objective | The register as a whole encodes the identified problems; the objective itself is documentary rather than functional |
| Implementation evidence | Chapter Two document analysis (Auditor-General, Controller of Budget, NG-CDF); requirement register derived from it in Chapter 4 §4.2.1 |
| Design elements | Chapter 4 §4.3.1 (context diagram, which fixes the scope of the problem addressed) |
| Test evidence | Not applicable — investigative, not behavioural |
| Conclusion | Chapter 6 §6.2.3: **partially achieved** (secondary evidence only; no fieldwork) |
| Status | **P** |

### Objective (ii): design architecture, database schema and ML pipeline

| Requirement / design element | Implementation | Demonstration | Status |
| --- | --- | --- | --- |
| Three-tier architecture (Ch.4 §4.4.1, Fig. 4.12) | `backend/src/index.js`, `backend/src/routes/*`, `frontend/src/**`, `ml-service/predict.py` | Live deployment checks (Ch.5 §5.3.12); `api.smoke.test.js` 3/3 | **V** |
| Relational schema with integrity constraints (Ch.4 §4.6, Fig. 4.10) | `db/schema.sql`, 14 migration files | `schemaReadiness.test.js` (5); `workflow.test.js` (11) exercise the constraints; recorded 12 tables / 56 constraints | **V** |
| Six-feature ML pipeline shared by training and serving (Ch.4 §4.3.11, §4.4.4) | `ml-service/feature_engineering.py`, `predict.py` | `ml-service/tests` 33/33 including feature-consistency and artefact loading; `mlPredictor.integration.test.js` | **V** |
| Random Forest classifier as specified in the proposal | Not in production; research candidate only | `ML_RELIABILITY_REPORT.md` records the candidate's metrics | **X (deviation, Ch.6 §6.2.4)** |
| Deployment architecture (Ch.4 §4.7, Fig. 4.24) | `Dockerfile`, `.github/workflows/publish-api-image.yml`, Azure resources | Image gates; live deployment checks | **V** |

### Objective (iii): implement registration, unique identifiers, QR identification and RBAC

| Requirement | Implementation | Demonstration | Status |
| --- | --- | --- | --- |
| FR-05, FR-06 registration and school constraint | `students.controller.js`, `student.model.js` | `students.test.js` (9); `browser-smoke` checks 2–3 | **V** |
| FR-20 unique QR token and image | `students.controller.js:58-60`, `publicAppUrl.js` | `verification.test.js` checks 1–3 | **V** |
| FR-21 public verification, existence only | `verification.controller.js` | `verification.test.js` (10), `verificationRoute.test.js` (4), `qr-smoke` 9/9 | **V** |
| FR-01 to FR-04 authentication and RBAC | `auth.controller.js`, `middleware/auth.js`, `requireRole.js` | `auth.test.js` (4), `roleAuthorization.test.js` (6), `securityMiddleware.test.js` (9) | **V** |
| FR-22 to FR-24 certificate issue, verification, `not_current` | `certificates.controller.js`, `bursaryCertificate.model.js` | `bursaryCertificates.test.js` (12), `certificateVerificationRoute.test.js` (5) | **V** |
| Physical QR scanning by a phone | Implemented artefact; no camera run | — | **N (gap G-11)** |

### Objective (iv): validate, test and evaluate effectiveness

| Requirement / claim | Implementation | Demonstration | Status |
| --- | --- | --- | --- |
| FR-07 screening on registration | `students.controller.js:69-73`, `mlDuplicateReview.js` | `duplicateFlags.test.js`, `mlPredictor.integration.test.js`, `performance.test.js` | **V** except at registry scale (gap G-12) |
| FR-08 no automatic rejection | No delete or status-change path exists | `workflow.test.js` check 1; `browser-smoke` check 5 | **V** |
| FR-09 provenance per case | `duplicate_flags` columns; migration `20261022` | `duplicateFlags.test.js` | **V** |
| FR-10 masked identifiers, audited reveal | `duplicateFlags.controller.js:37-42, 434-446` | `duplicateFlags.test.js` | **V** |
| FR-11 decision with reason, terminal case | `duplicateFlags.controller.js:452-503` | `duplicateFlags.test.js`; `workflow.test.js` checks 4–6 | **V** |
| FR-15, FR-16 duplicate gates on approval and payment | `bursaryAwards.controller.js:173-189`; `disbursements.controller.js` | `workflow.test.js` checks 2–4; `disbursements.test.js` check 4 | **V** |
| FR-17, FR-18 clearance evidence and discrepancy | `bursaryRules.js`; `disbursements.controller.js` | `disbursementReconciliation.controller.test.js` (4); `workflow.test.js` checks 8–9 | **V** |
| FR-19 exception derivation | `bursaryRules.js:32-52` | `workflow.test.js`; `bursaryRules.test.js` | **P** (not all eleven reason codes asserted) |
| FR-25 dashboard, FR-26 report | `adminDashboard.controller.js`, `reports.controller.js` | `roleAuthorization.test.js` (authorisation); arithmetic untested | **P** |
| FR-27 audit trail | `services/auditLog.js` | `workflow.test.js` check 10 (ten actions) | **V** |
| FR-12 eligibility scoring | `services/eligibility.js` | Route and role only | **P** (gap G-17) |
| Detection effectiveness on real records | — | Synthetic holdout only | **X** with existing evidence (gap G-18) |

---

## 2. Non-functional requirement traceability

| NFR | Implementation location | Demonstration | Status |
| --- | --- | --- | --- |
| NFR-01 screening ≤ 3 s | Batching in `mlDuplicateReview.js` | `performance.test.js` (50 candidates) | **P** (small registry only) |
| NFR-02 password hashing | `auth.controller.js:26` | `auth.test.js` | **V** |
| NFR-03 JWT signing and expiry | `auth.controller.js:55-59`; `jwtSecret.js` | `auth.test.js`; `jwtSecret.validation.node.cjs` | **V** |
| NFR-04 role not trusted from token | `middleware/auth.js:20-24` | `roleAuthorization.test.js` | **V** |
| NFR-05 identifier masking | `duplicateFlags.controller.js:37-42` | `duplicateFlags.test.js` | **V** |
| NFR-06 no beneficiary data in public responses | `verification.controller.js`; `certificates.controller.js:53-89` | `verification.test.js`; `bursaryCertificates.test.js` | **V** |
| NFR-07 public rate limits, separate budgets | `rateLimitWindow.js`, `verificationRateLimit.js`, `certificateRateLimit.js` | `verificationRoute.test.js`; `certificateVerificationRoute.test.js` | **V** (in-process only) |
| NFR-08 sign-in rate limit | `loginRateLimit.js` | `loginRateLimit.test.js` | **V** |
| NFR-09 body size limit | `index.js:64` | `securityMiddleware.test.js` | **V** |
| NFR-10 no internal detail in errors | `errorHandler.js` | `securityMiddleware.test.js` | **V** |
| NFR-11 CORS allowlist | `config/cors.js`; `index.js:40-47` | `securityMiddleware.test.js` | **V** |
| NFR-12 database-enforced integrity | `schema.sql`; migrations | `workflow.test.js`; `bursaryCertificates.test.js` | **V** |
| NFR-13 registration serialisation | advisory lock in `students.controller.js:68` | Every registration test passes through the lock; no test asserts isolation | **P** (lock present; no concurrency assertion; gap G-12) |
| NFR-14 usability | `AppLayout.jsx`; screen components | `browser-smoke` (behaviour, not usability) | **P** (renders and behaves; no usability study; gap G-06) |
| NFR-15 maintainability | shared feature module; ordered migrations; three test frameworks | Builds and suites | **V** |
| NFR-16 cost envelope | `render.yaml`; deployment log | Deployment record | **P** (configuration recorded; no billed month reconciled) |
| NFR-17 human oversight | role-gated decision endpoints | `workflow.test.js` check 11 | **V** |
| NFR-18 recovery | `docs/database-recovery-rehearsal-2026-10-31.md` | Rehearsal record | **P** (no schedule; gap G-19) |
| NFR-19 browser compatibility | SPA over HTTPS | Chrome only | **P** (gap G-16) |
| NFR-20 predictable degradation | 503 on predictor failure | `students.test.js` | **V** |
| NFR-21 audit completeness | `auditLog.js` | `workflow.test.js` check 10 | **P** (attributed in tested flows; no immutability control) |

---

## 3. Figure and table traceability

| Design element | Requirement(s) it explains | Where the behaviour is demonstrated |
| --- | --- | --- |
| Fig. 4.1 context diagram | Scope of FR-01 to FR-37 (what is inside the boundary) | Ch.5 §5.6.2 (boundaries) |
| Fig. 4.2 use case diagram | FR-01 to FR-30 | Map in Ch.4 §4.3.2 |
| Fig. 4.3 registration activity | FR-05 to FR-11 | `students.test.js`; `workflow.test.js` check 1 |
| Fig. 4.4 review/approval/payment activity | FR-11, FR-15 to FR-19 | `workflow.test.js` checks 2–9 |
| Fig. 4.5 class diagram | Whole domain | Suite inventory in Ch.5 §5.4.3 |
| Fig. 4.6 registration SSD | FR-05, FR-07, FR-20 | `verification.test.js`; `students.test.js` |
| Fig. 4.7 review sequence | FR-10, FR-11 | `duplicateFlags.test.js` |
| Fig. 4.8 approval-to-certificate sequence | FR-13 to FR-18, FR-22 to FR-24 | `workflow.test.js`; `bursaryCertificates.test.js` |
| Fig. 4.9 public verification sequence | FR-21, FR-23, FR-24 | `verification.test.js`; `certificateVerificationRoute.test.js` |
| Fig. 4.10 ERD | FR-09 to FR-27 (storage) | `schemaReadiness.test.js` |
| Fig. 4.11 ML pipeline | FR-07, FR-09 | `ml-service/tests` (33); `duplicateAggregation.test.js` |
| Fig. 4.12 architecture | All | Deployment checks |
| Figs. 4.13–4.23 screens | FR-01 to FR-26 (interface realisation) | `browser-smoke` 23/23; `qr-smoke` 9/9; `registration-fields-smoke` 11/11 |
| Fig. 4.24 deployment | NFR-07, NFR-16 | Deployment log §1–§2 |

---

## 4. Test suite → requirement coverage matrix

Cell values give the number of tests in that suite that bear on the requirement group; a blank means the suite is not
relevant. Suite totals sum to 151.

| Suite (tests) | Auth / RBAC | Registration | Screening | Review | Awards | Payments | QR | Certificates | Reporting | Ops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `auth` (4) | 4 | | | | | | | | | |
| `students` (9) | 2 | 5 | 2 | | | | | | | |
| `duplicateFlags` (9) | 1 | | 1 | 6 | | 1 | | | | |
| `duplicateAggregation` (13) | | | 13 | | | | | | | |
| `mlDuplicateReview` (8) | | | 8 | | | | | | | |
| `predictorDateNormalization` (6) | | | 6 | | | | | | | |
| `duplicateCheck` (15) | | 1 | 14 | | | | | | | |
| `mlPredictor.integration` (1) | | | 1 | | | | | | | |
| `workflow` (11) | 1 | | 2 | 3 | 2 | 3 | | | | |
| `bursaryAwards.controller` (5) | 1 | | | 1 | 3 | | | | | |
| `disbursements` (4) | 1 | | | 1 | | 2 | | | | |
| `disbursementReconciliation.controller` (4) | | | | | | 4 | | | | |
| `bursaryRules` (4) | | | | | | 4 | | | | |
| `bursaryCertificates` (12) | 1 | | | | 2 | | | 9 | | |
| `certificateVerificationRoute` (5) | | | | | | | | 5 | | |
| `verification` (10) | | | | | | | 10 | | | |
| `verificationRoute` (4) | | | | | | | 4 | | | |
| `roleAuthorization` (6) | 5 | | | | | | | | 1 | |
| `securityMiddleware` (9) | 3 | | | | | | | | | 6 |
| `schemaReadiness` (5) | | | | | | | | | | 5 |
| `loginRateLimit` (1) | 1 | | | | | | | | | |
| `performance` (1) | | | 1 | | | | | | | |
| `kenyanSyntheticDataset` (4) | | | 4 | | | | | | | |
| `health` (1) | | | | | | | | | | 1 |

---

## 5. Conclusion → evidence traceability

| Conclusion (Chapter 6) | Evidence base | Gaps |
| --- | --- | --- |
| §6.2.1 problem addressed | Ch.1 (as approved), Ch.2 literature, Ch.4 §4.2.1 requirement derivation | — |
| §6.2.2 purpose and DSR approach | Ch.3 methodology (proposal §3.2–§3.3); artefact and evaluation in Ch.4–5 | — |
| §6.2.3 objective (i) partially achieved | Ch.4 §4.2.1; absence of primary fieldwork | G-06 (no user study) |
| §6.2.4 objective (ii) achieved with deviation | Ch.4 §4.4–§4.7; `feature_engineering.py`; `predict.py`; migration inventory | G-21 |
| §6.2.5 objective (iii) achieved | Ch.5 §5.3.2–§5.3.9, §5.3.12; suites listed in §5.4.3; deployment checks | G-11 (camera scan) |
| §6.2.6 objective (iv) partially achieved | Ch.5 §5.4 (all suites), §5.5.2, §5.5.5 | G-12, G-18 |
| §6.2.7 engineering quality | Ch.5 §5.4.5 (security, database), §5.5.3, §5.5.4 | G-17 |
| §6.2.8 contribution | Ch.5 §5.5.5 (aggregation finding); Ch.4 §4.4.4 | G-18 |
| §6.2.9 boundaries | Ch.5 §5.6.2–§5.6.6 | G-12, G-13, G-19 |

---

## 6. Traceability exceptions to note in the report

1. **Two requirements are demonstrated only by inspection** (FR-26 report content; FR-19 all reason codes). The report
   says so rather than marking them verified.
2. **Two requirements have no behavioural test** (NFR-13 concurrency; NFR-14 usability). Both are stated as unverified
   in Chapter Five and carried into the gap register as G-12 and G-06.
3. **One objective's evidence is documentary only** (objective (i)). Chapter Six states this explicitly.
4. **One proposal requirement is not implemented and is reported as a deviation**, not as an omission (Random Forest;
   G-21).
5. **The production model and the research artefacts are traced separately** so that no metric from
   `ml-service/experiments/` or `model/research/` is attributed to the deployed system.
