# OBJECTIVE–REQUIREMENT–TEST TRACEABILITY (revalidated)

> Re-derived 2026-11-03 at HEAD `cca0625`. Supersedes `docs/final-documentation-content/OBJECTIVE_REQUIREMENT_TEST_
> TRACEABILITY.md` (bound to `d6b5032`) **only for evidence status and test counts**; the objective wording below is
> carried forward unchanged because the approved proposal (§1.3.1) is not in the repository and must not be
> re-invented. The author must confirm the four statements against the approved PDF before submission (E-01).

**Status vocabulary.** **V** = verified by an executed test or recorded observation in this pass; **P** = partially
verified (implemented, but a named property is unasserted or the evidence is documentary); **N** = implemented, no
test; **X** = not implemented (scope or recorded gap).

## 1. Objective (i) — investigate the existing challenges of manual registration and tracking

| Element | Content |
| --- | --- |
| Requirements serving it | none directly; the whole register encodes the problems found |
| Implementation evidence | requirement derivation in `docs/final-documentation-content/CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.2.1 |
| Design element | context diagram (Ch.4 §4.3.1) which fixes the scope of the problem addressed |
| Test evidence | **not applicable** — investigative, not behavioural |
| Conclusion | Chapter 6 §6.2.3 — **partially achieved**, secondary evidence only |
| Status | **P** |

## 2. Objective (ii) — design the architecture, database schema and ML pipeline

| Requirement / design element | Implementation | Demonstration in this pass | Status |
| --- | --- | --- | --- |
| Three-tier architecture (Ch.4 §4.4.1, Fig. 4.12) | `backend/src/index.js`, `routes/*`, `frontend/src/**`, `ml-service/predict.py` | live `GET /api/health` 200, `/api/ready` 200, `POST /api/verify` 200; `auth`/`roleAuthorization`/`securityMiddleware` suites | **V** |
| Relational schema with integrity constraints (Ch.4 §4.6) | `db/schema.sql` + 14 forward migrations | `schemaReadiness.test.js`, `workflow.test.js`; live DB shows all 12 readiness tables present | **V** |
| Six-feature pipeline shared by training and serving (§4.3.11) | `feature_engineering.py:11` `FEATURE_COLUMNS`, `build_pair_features()` | `ml-service/tests` 33/33 (incl. `test_feature_engineering`, `test_predict_artifact_loading`); `mlPredictor.integration.test.js` | **V** |
| **Random Forest classifier as proposed** | not in production; `model/research/rf_attachment_style_candidate.joblib` is research-only | none | **X — deviation (FR-31)** |
| Deployment architecture (§4.7, Fig. 4.24) | `Dockerfile`, `.github/workflows/publish-api-image.yml`, Container App + App Service + PostgreSQL Flexible Server | live inventory; **but the running image is `a3714f8`, 9 commits behind HEAD** | **P** — deployed, not current |

## 3. Objective (iii) — implement registration, unique identifiers, QR identification and RBAC

| Requirement | Implementation | Demonstration | Status |
| --- | --- | --- | --- |
| FR-05, FR-06 registration and school constraint | `students.controller.js`, `config/schools.js`, `schema.sql:43-44` | `students.test.js`; live `GET /api/students` 401 without a token | **V** |
| FR-20 unique QR token + image | `students.controller.js:58-60` (32 random bytes, `QRCode.toDataURL`) | `verification.test.js`; live `POST /api/verify` `{"found":false}` | **V** |
| FR-01–FR-04 authentication and RBAC | `auth.controller.js`, `middleware/auth.js`, `requireRole.js`, 12 route modules | `auth.test.js` (4), `roleAuthorization.test.js` (6), `securityMiddleware.test.js` (9), `loginRateLimit.test.js` (1); live 401 / 403 probes | **V** |
| FR-10–FR-11 masked queue and audited review | `duplicateFlags.controller.js`, `maskIdentifiers` | `duplicateFlags.test.js` (9) | **V** |
| FR-21 public verification with minimal disclosure | `verification.controller.js` | `verification.test.js` (10), `verificationRoute.test.js` (4); live 200/404 behaviour | **V** |
| Camera-based QR scanning on a phone | — | not implemented; officers photograph or retype the token | **X** (G-11) |

## 4. Objective (iv) — validate and evaluate the artefact

| Claim to be evaluated | Evidence produced here | Verdict |
| --- | --- | --- |
| Behaviour is correct | 151 backend tests / 24 suites pass; 33 ML tests pass | **V** (for the code paths tested) |
| Duplicate detection is accurate | synthetic holdout: precision 0.9204, recall 0.8927, ROC-AUC 0.9685 at 0.50; FPR 0.35 % on 2 000 unrelated pairs (see `PRODUCTION_ML_MODEL_VERIFICATION.md`) | **P** — synthetic only, no adjudicated real labels |
| The cut-off is validated | system itself returns `thresholds_validated: false` | **X** |
| The system performs adequately | 50-pair scoring under 3 s (`performance.test.js`) | **P** — nothing above 50 pairs, no load test |
| Usable by real officers | none | **X** (NFR-14, G-06) |
| Deployed and reachable | health/ready/public verify respond; certificate route missing | **P** — deployed build is behind HEAD |
| Recovers from data loss | documented local rehearsal 2026-10-31; not re-executed | **P** — NFR-18 |

## 5. Test-suite → requirement coverage matrix

Per-suite counts below were reconciled against the measured total of **151 tests** produced by `npm test` in this
pass (24 suites; every one of the 151 tests passes — the monolithic run reports 150/151 because the Python sidecar
cannot start under the host's memory pressure, and that test passes alone; see `SBMS_TEST_EVIDENCE_CATALOGUE.md` §1.1),
so the row totals and the executed total agree.

| Suite (tests) | Auth/RBAC | Registration | Screening | Review | Awards | Payments | QR | Certificates | Reporting | Ops |
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

Reading the matrix: certificates are covered by **17 tests** at HEAD (`bursaryCertificates` 12 + `certificateVerify
Route` 5, column "Certificates") — **and none of that coverage applies to the deployed build**, which does not contain
the feature. This is the clearest single illustration that test evidence and deployment evidence are not
interchangeable.

## 6. Conclusion → evidence traceability

| Conclusion (Chapter 6) | Evidence base in this package | Gap IDs |
| --- | --- | --- |
| §6.2.1 problem addressed | Ch.2 document analysis; requirement derivation | — |
| §6.2.2 purpose and DSR approach | Ch.3 methodology; artefact in Ch.4–5 | — |
| §6.2.3 objective (i) partially achieved | documentary evidence only | G-06 |
| §6.2.4 objective (ii) achieved with deviation | architecture/schema/pipeline verified; classifier deviation | G-21 |
| §6.2.5 objective (iii) achieved | suites in §5; live probes | G-11 |
| §6.2.6 objective (iv) partially achieved | §4 above; ML metrics; no UAT, no load test | G-06, G-12, G-18 |
| §6.2.7 engineering quality | security/database suites, error handling | G-17 |
| §6.2.8 contribution | aggregation-policy finding, human-in-the-loop design | G-18 |
| §6.2.9 boundaries | catalogue §1–§3, ML §7 | G-12, G-13, G-19 |

## 7. Exceptions the report must state

1. **Objective (i) rests on documentary evidence only** — no fieldwork, no interviews.
2. **The Random Forest in the proposal was not delivered**; XGBoost was (FR-31, G-21). Objective (ii) is
   "achieved with a declared deviation", never "achieved as specified".
3. **Two requirements are demonstrated by inspection alone** (FR-26 report content, FR-19 reason classes).
4. **Some NFRs have no behavioural test**: NFR-13 (concurrency) is verified by inspection of the advisory lock only;
   NFR-14 (usability), NFR-19 (browsers), NFR-22 (capacity) and NFR-23 (threshold validation) have no executed evidence.
5. **Objective (iv) cannot be fully met**: no adjudicated real duplicate labels, no UAT, no load test.
6. **Certificates are tested but not deployed** — a traceability row cannot cite a §5.3 screenshot of a feature the
   running system does not serve.
7. **Research artefacts are traced separately** — nothing from `ml-service/experiments/` or `model/research/` is
   attributed to the deployed system.

