# CHAPTER 4 FINAL EVIDENCE PACKAGE

> Evidence for `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`, revalidated 2026-11-03 at HEAD `cca0625`. Section numbering
> follows the existing draft so the file can be used beside it without renumbering. This file does **not** re-write
> Chapter 4; it states, per section, what the chapter may assert, what source supports it at HEAD, and what the author
> must fix.

## 1. Section-by-section evidence

| Section | What it may assert | Evidence at HEAD | Verdict | Author action |
| --- | --- | --- | --- | --- |
| 4.2.1 Requirement sources | 37 FR + 24 NFR derived from the approved proposal and document analysis | `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §1–§3 (this package) | OK | Paste Chapter 1 objective sentences (E-01) |
| 4.2.2 Functional requirements | 37 numbered requirements | same catalogue; 14 controllers, 12 route modules | OK | Use the recount (24 verified / 8 partial / 5 not implemented) |
| 4.2.3 Non-functional requirements | 24 numbered NFRs | same catalogue §2 (15 verified / 5 partial / 4 not tested) | OK | Do not present NFR-14, NFR-19, NFR-22 or NFR-23 as met |
| 4.2.4 Data requirements | **12 tables**, constraints, audit trail | `backend/src/db/schema.sql` creates 8 (`users, students, duplicate_flags, duplicate_review_events, disbursements, audit_logs, reports, beneficiaries`); migrations add 4 (`bursary_awards`, `bursary_award_verification_events`, `bursary_certificates`, `disbursement_reconciliation_events`) = **12**; `databaseReadiness.js` requires exactly these and all were confirmed live | **CORRECTION REQUIRED** | The draft says 13 tables; the code has 12. Correct the number (do not invent a thirteenth table) |
| 4.2.5 Interface requirements | 45 endpoints, three roles, one public verifier | 41 `router.<verb>(` declarations across 12 route modules + 4 inline routes in `index.js` (`/api/verify`, `/api/certificates/verify`, `/api/health`, `/api/ready`) = **45** | OK | Count confirmed this pass |
| 4.3.1 Context diagram | external actors: officer, admin, public verifier | `SBMS_DIAGRAM_SPECIFICATIONS.md` Figure 4.1 | OK | Redraw only if actor list changed — it has not |
| 4.3.2 Use case diagram | 7 use-case groups | Figure 4.2 | OK | — |
| 4.3.3 Registration/screening activity | advisory flag, never blocks | `students.controller.js:69-108` | OK | — |
| 4.3.4 Review/award/payment activity | human gates, duplicate gate on approval | `bursaryAwards.controller.js:169-188` | OK | — |
| 4.3.5 Class diagram | 12 entities + services | `schema.sql`, 6 migration tables; `models/*.js` | OK (correct 13→12) | Redraw with 12 entity classes |
| 4.3.6–4.3.9 Sequence diagrams | registration, review, award+payment+certificate, public verification | controllers + `mlDuplicateReview.js` + `duplicateAggregation.js` | OK | Certificate sequence describes HEAD; note that it is not in the deployed build (`AZURE_DEPLOYMENT_VERIFICATION.md` §5) |
| 4.3.10 ER diagram | **12 tables**, FKs, unique keys | `schema.sql` + migrations | OK (correct 13→12) | — |
| 4.3.11 ML pipeline | **six features, XGBoost, advisory score, aggregation policy** | `feature_engineering.py:11`; `predict.py`; `duplicateAggregation.js` | **CORRECTION REQUIRED** | Rewrite any sentence that says "four features / Random Forest"; state the deviation explicitly (FR-31) |
| 4.4.1 Architecture | three tiers: React SPA, Node/Express API, Python predictor in-container, PostgreSQL | `index.js`; `Dockerfile`; `requirements.txt`; live Azure inventory | OK | Add that the predictor is a **child process of the API**, not a separate service |
| 4.4.2 Backend modules | controllers / routes / services / middleware / models | directory counts (14/12/10/8) | OK | — |
| 4.4.3 Auth design | JWT 8 h, DB role re-read, rate-limited sign-in | `middleware/auth.js`, `requireRole.js`, `loginRateLimit.js` | OK | — |
| 4.4.4 ML integration design | batching, timeouts, version pinning, fail-closed | `duplicateCheck.js:241`; `mlDuplicateReview.js:84` | OK | — |
| 4.4.5 Workflow and state | award and payment state machines, evidence requirements | `schema.sql` transition constraints; `workflow.test.js` | OK | — |
| 4.4.6 Security and privacy | bcrypt 12, masking, minimal public disclosure, audit, hardened headers | `auth.controller.js:26`; `duplicateFlags.controller.js`; `verification.controller.js`; `index.js:33-39` (nosniff, DENY, no-referrer, permissions-policy) | OK | State plainly that masking is **API-layer** and headers are hand-rolled (no CSP) |
| 4.4.7 Validation and error handling | Zod schemas, `errorHandler`, no stack leakage | `zod` schemas in controllers; `middleware/errorHandler.js` | OK | — |
| 4.5.1–4.5.8 Interface design | 14 React pages, 3 shared components | `frontend/src/pages`, `components` | OK | Screenshots must match `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` |
| 4.6 Schema | **12 tables** with columns, constraints, indexes | `schema.sql` + 6 migration tables; all 12 confirmed live | OK (correct 13→12) | — |
| 4.6.1 Migration policy | forward-only with one `.down.sql` | 15 files in `db/migrations/` | OK | Note that only one migration has a rollback file |
| 4.7 Physical deployment | Azure Container App (API) + App Service (SPA) + PostgreSQL Flexible Server | `AZURE_DEPLOYMENT_VERIFICATION.md` §1–§3 | **CORRECTION REQUIRED** | Remove Render as the deployment target; `render.yaml` is dead config. Add region, SKUs (F1 / B1ms / 0–1 replicas) |
| 4.8 Summary | scope met with declared exceptions | catalogue §3 | OK | — |

## 2. Figures (4.1–4.24)

`SBMS_DIAGRAM_SPECIFICATIONS.md` specifies all 24 figures, each with the exact entities, actors and arrows it must
encode. **Two must be redrawn**: Figure 4.11 (ML pipeline — classifier and feature count changed) and Figure 4.24
(deployment — the hosting target changed). Figures 4.1–4.10 can be reused as drawn; Figures 4.13–4.23 are
screenshots, and three of them must be retaken (see the checklist).

## 3. Statements that must not appear in Chapter 4

1. "A Random Forest classifier is used" — it is XGBoost (FR-31 deviation).
2. "Four similarity features" — there are six; national ID is *not* one of them.
3. "The system is deployed on Render" — Render was abandoned; `render.yaml` is dead configuration.
4. "The ML service runs as a separate microservice" — it runs as a Python child process inside the API container.
5. "Certificates are available to users" — the feature exists at HEAD but is absent from the deployed image.
6. "The score is a calibrated probability" — the API itself returns `score_is_calibrated_probability: false`.

## 4. Numbers to use, and where they came from

| Quantity | Value | Source |
| --- | --- | --- |
| Functional requirements | 37 | catalogue §1 |
| Non-functional requirements | **24** | catalogue §2 (15 verified / 5 partial / 4 not tested) |
| Tables | **12** | 8 in `schema.sql` + 6 `CREATE TABLE` statements in `db/migrations/`, two of which repeat `beneficiaries` and `duplicate_review_events` → 8 + 6 − 2 = 12, exactly the `databaseReadiness.js` set |
| Endpoints | **45** | 41 router declarations + 4 inline routes in `index.js` |
| Forward migrations | 14 (+1 rollback) | `db/migrations/` |
| Backend controllers / routes / services / middleware | 14 / 12 / 10 / 8 | directory counts |
| React pages / shared components | 14 / 3 | `frontend/src` |
| Models in the ML pipeline | 1 (XGBoost, `xgboost:6ec9f2a3…`) | artifact hash |
| Model features | 6 | `feature_engineering.py:11` |
| Review threshold | 0.50 (provisional) | `config/settings.js` default |

## 5. Provenance

Every row above was checked against the checkout at `cca0625` on 2026-11-03. The earlier Chapter 4 draft was bound
to `d6b5032`; between the two commits the certificate feature (`f3686ec`), the UPI/birth-certificate capture
(`730a62e`), the identifier-evidence change (`9fc14df`) and three duplicate-review fixes were added, so **any Chapter 4
text describing the registration form, the identifier set or the certificate entity is out of date if it predates
`d6b5032`**. Cross-reference: `EVIDENCE_SOURCE_INDEX.md`.

## 6. Gap references

| ID | Relevance to Chapter 4 |
| --- | --- |
| G-03 | No figure has been drawn; the chapter needs rendered images |
| G-04 | Figures 4.13–4.23 need screenshots |
| G-21 | Figure 4.11 must show XGBoost and six features, not Random Forest and four |
| G-29 | Figure 4.24 must state that the deployed image is `a3714f8`, and the certificate entity must not be drawn as live |
| G-32 | `render.yaml` must not appear in any deployment figure |

