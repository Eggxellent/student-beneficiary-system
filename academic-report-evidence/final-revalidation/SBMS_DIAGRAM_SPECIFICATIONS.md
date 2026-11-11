# SBMS DIAGRAM SPECIFICATIONS (Figures 4.1–4.24)

> Every figure required by Chapter 4, with the exact content it must encode at HEAD `cca0625`. A figure that omits a
> named element is wrong even if it looks correct. Screenshots (4.13–4.23) are specified in
> `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md`.

**Verdict key:** **REUSE** = matches HEAD, no redraw; **REDRAW** = content changed, redraw required; **CAPTURE** =
screenshot; **RETAXE** = screenshot must be retaken because the UI changed.

## 1. Analysis and design diagrams (4.1–4.12)

| Fig | Type | Must encode | Sources | Verdict |
| --- | --- | --- | --- | --- |
| 4.1 | Context diagram | SBMS as a single process; external entities: field officer, administrator, public verifier (phone), GitHub Container Registry, Azure hosting, PostgreSQL; no NEMIS connection (out of scope) | `index.js`; catalogue FR-32 | **REUSE** |
| 4.2 | Use-case diagram | actors: field officer, administrator, public verifier; use cases: sign in, register beneficiary, screen for duplicates, review duplicate case, score eligibility, submit award, verify award, approve/reject award, record payment, record clearance, record acknowledgement, issue certificate, verify student QR, verify certificate QR, verify certificate reference, export report, view dashboard, manage users, change thresholds, view audit log | 12 route modules | **REUSE** |
| 4.3 | Activity: registration and screening | start → authenticate → validate fields → advisory lock → read registry `FOR UPDATE` → build pairs → batch score → aggregate (exact-identifier then score, `top-1`) → create student → insert flag(s) `pending` → return record + flags; **no branch aborts registration on a flag** | `students.controller.js:69-118` | **REUSE** |
| 4.4 | Activity: review → award → payment | queue → reveal (audited) → decision (`confirmed_duplicate`/`not_duplicate`/`needs_verification`) with reason → award submission → verification event → approval gate (blocked if unverified or any open/confirmed case) → payment `issued` → clearance → acknowledgement (shortfall → `discrepancy`) → certificate (HEAD only) | `duplicateFlags`, `bursaryAwards`, `disbursements`, `certificates` controllers | **REUSE** |
| 4.5 | Class diagram | 12 entity classes `users, students, beneficiaries, duplicate_flags, duplicate_review_events, disbursements, audit_logs, reports, bursary_awards, bursary_award_verification_events, bursary_certificates, disbursement_reconciliation_events` + service classes `duplicateCheck`, `mlDuplicateReview`, `duplicateAggregation`, `eligibility`, `bursaryRules`, `auditLog`, `databaseReadiness` | `schema.sql` + 6 migrations; `services/*` | **REDRAW** (13 → 12 entities if the earlier draft counted 13) |
| 4.6 | Sequence: registration | officer → API → DB (lock, select) → predictor (`predict.py --server`, batch ≤ 200) → aggregation → DB (insert student, flags) → officer | `students.controller.js`, `duplicateCheck.js:241` | **REUSE** |
| 4.7 | Sequence: duplicate review decision | admin → queue (masked) → reveal (audited) → decision with reason → `duplicate_review_events` → award gate re-check | `duplicateFlags.controller.js` | **REUSE** |
| 4.8 | Sequence: award approval, payment, certificate | officer submits → admin verifies → admin approves (gates) → officer records payment → clearance → acknowledgement → admin issues certificate (HEAD only) → public verify | `bursaryAwards`, `disbursements`, `certificates` | **REUSE**, but annotate that the certificate leg is not in the deployed image |
| 4.9 | Sequence: public QR verification | phone → SPA verification page → `POST /api/verify` (rate-limited, 100 kb) → DB lookup by token hash/value → `{found:true|false}` only | `index.js:65`; `verification.controller.js` | **REUSE** |
| 4.10 | ER diagram | 12 tables, PK/FK pairs (`students.id` → `duplicate_flags.student_id`/`matched_student_id`, `bursary_awards.student_id`, `bursary_certificates.award_id`, `disbursement_reconciliation_events.disbursement_id`), unique keys (`students.upi`, `students.qr_token`, one certificate per award), CHECKs (school enum, status enums, amount ≥ 0) | `schema.sql` + migrations | **REDRAW** (13 → 12 tables) |
| 4.11 | ML pipeline | 6 features in `FEATURE_COLUMNS` order (`jaro_winkler, dob_match, school_match, guardian_match, upi_match, birth_certificate_match`); shared builder `build_pair_features()` used by training **and** serving; XGBoost `XGBClassifier` (250 trees, depth 4, lr 0.05); artifact `xgb_duplicate_model.joblib`; score → `ML_REVIEW_SCORE_THRESHOLD` 0.50 → aggregation `top-1` → advisory flag; **national ID is review evidence, not a feature** | `feature_engineering.py:11`; `predict.py`; `train_model.py` | **REDRAW** (Random Forest / four features are wrong) |
| 4.12 | Architecture (logical, three tiers) | React SPA → REST API (Express, 45 endpoints) → PostgreSQL; API → Python predictor **as a child process inside the same container**; GHCR supplies the API image | `index.js`; `Dockerfile`; `AZURE_DEPLOYMENT_VERIFICATION.md` §3 | **REDRAW** if the earlier version drew the predictor as a separate service |

## 2. Interface figures (4.13–4.23)

| Fig | Screen | Must show | Route in the app | Verdict |
| --- | --- | --- | --- | --- |
| 4.13 | Field-officer sign-in | email + password, error state, no role selector | `/login` | **CAPTURE** |
| 4.14 | Administrator sign-in | same form, admin entry point | `/admin/login` | **CAPTURE** |
| 4.15 | Registry list | search, school filter, count, row action to open a record | `/students` | **RETAXE** (identifier columns changed after `d6b5032`) |
| 4.16 | Registration form | all captured fields incl. **UPI, birth certificate no., national ID**, guardian, school select (5 options), household/eligibility inputs | `/students/register` | **RETAXE** — mandatory: the form gained fields |
| 4.17 | Screening confirmation | student created + "possible duplicate" notice with score band and the advisory wording; must not imply blocking | post-registration panel | **RETAXE** |
| 4.18 | Eligibility result | five factor inputs, total score out of 100, category badge, explanation | `/eligibility` | **CAPTURE** |
| 4.19 | Administrator dashboard | totals, six-month trend, recent activity | `/dashboard` | **CAPTURE** |
| 4.20 | Duplicate review queue | masked identifiers in the list, priority label, case count | `/duplicate-review` | **CAPTURE** |
| 4.21 | Duplicate case dialog | side-by-side comparison, per-feature evidence, revealed identifiers after audited reveal, decision form with mandatory reason | `/duplicate-review`, dialog | **CAPTURE** |
| 4.22 | Awards and payments | award record with verification state, approval controls, payment recording, reconciliation | `/students` (award panel) and `/disbursements` | **CAPTURE** |
| 4.23 | Public verification page | token/QR input, "record found / not found", no beneficiary data | `/verify` | **CAPTURE** |

Not in the 4.13–4.23 range but required elsewhere in Chapter 5: the certificate panel (issue, A4 printable view, PDF
download) and the public certificate verification result — **Certificate verified** for a real issued certificate,
reached by QR token or by the typed printed reference (`/verify-certificate`). Figure S-23 is reused for that second
capture. Number them as Chapter 5 figures and caption them `local build, HEAD cca0625` — **the live deployment returns
404 for that route**. There is no revoke figure: revocation is not part of SBMS.

## 3. Deployment figure (4.24)

| Fig | Type | Must encode | Verdict |
| --- | --- | --- | --- |
| 4.24 | Physical deployment | Browser → `https://sbms-web.azurewebsites.net` (App Service, plan `asp-sbms-web`, **F1 Free**, Windows, `alwaysOn: false`); SPA calls `https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io` (Container App, external ingress, port 5000, **0–1 replicas**, revision `ca-sbms-api--latest`, image `ghcr.io/eggxellent/sbms-api:a3714f8…`); Container App → PostgreSQL Flexible Server `pg-sbms` v16, Burstable B1ms, 32 GB, 7-day backup, same region; GitHub Actions (`workflow_dispatch`) → GHCR → Container App; zip deploy → App Service. **Do not draw Render.** | **REDRAW** |

Caption that must accompany 4.24: "The deployed API image is built from commit `a3714f8`; the repository HEAD at the
time of writing is `cca0625`."

## 4. Conventions

- One figure per section listed in Chapter 4; do not merge 4.3 and 4.4 (they answer different questions).
- Every DB element in a figure must exist in `schema.sql` or a migration — nothing invented.
- Every arrow into the ML box must be one of the six features; a seventh arrow is an error.
- Screenshots must not contain real beneficiary data (G-05). Use the synthetic seed (`npm run seed:synthetic`).
- Caption format: `Figure 4.n: <title>. Source: <file or screen> at commit cca0625, captured <date>.`

