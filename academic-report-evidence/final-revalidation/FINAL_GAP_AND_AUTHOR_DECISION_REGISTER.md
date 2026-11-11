# FINAL GAP AND AUTHOR DECISION REGISTER

> Register valid at HEAD `cca0625`, 2026-11-03. This file **continues** the numbering of
> `docs/final-documentation-content/DOCUMENTATION_GAP_REGISTER.md` (G-01 … G-28) and adds the gaps found during the
> final revalidation (G-29 … G-36), the evidence exceptions (E-01 … E-03) and the decisions only the author can take.
> Nothing here changes the code; every entry is either a documentary action or a declared limitation.

## 1. Status key

| Status | Meaning |
| --- | --- |
| **CLOSED** | Evidence now exists and is recorded in this package |
| **PARTLY** | Some evidence exists; the entry names exactly what is missing |
| **OPEN** | No evidence; must be declared as a limitation or resolved before submission |
| **AUTHOR** | Cannot be resolved by inspection; requires a decision from the author or the programme owner |

Gap IDs already cited inside `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md`, `SBMS_TEST_EVIDENCE_CATALOGUE.md`,
`OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md`, `CHAPTER_4_FINAL_EVIDENCE_PACKAGE.md` and
`CHAPTER_5_FINAL_EVIDENCE_PACKAGE.md` all resolve to a row in §2 or §3 below. There is no dangling ID.

## 2. Carried gaps (G-01 … G-14)

| ID | Gap | Status at `cca0625` | Evidence | Action |
| --- | --- | --- | --- | --- |
| G-01 | Workstation and device specification | **OPEN** | not in the repository | author writes §5.2.1; this package records only the OS family (`win32`) and that Node, Python 3 and PostgreSQL were used |
| G-02 | Free memory during the 149–150/151 sweeps | **CLOSED** | pass 2 reproduced and explained the mechanism: the only failures were the Python sidecar (`Python predictor process exited`, `Production XGBoost model artifact could not be loaded`) at 0.55 GB free on a 7.4 GB host; each passes alone, and the grouped runs give 80/80 and 70/71 (`SBMS_TEST_EVIDENCE_CATALOGUE.md` §1.1) | cite the ledger; describe the limit as host memory, not as a defect |
| G-03 | Statement that Figures 4.1–4.24 were produced | **OPEN** | none exist | `SBMS_DIAGRAM_SPECIFICATIONS.md` gives each figure's content |
| G-04 | Screenshots for Figures 4.13–4.23 | **OPEN** | none exist | `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` S-01 … S-30 |
| G-05 | Confirmation that no real beneficiary data appears | **OPEN** | live database holds demonstration records (G-13) | use synthetic seed; redact identifiers |
| G-06 | User acceptance study | **OPEN** | `docs/uat-test-plan.md` records no participants | declare "no UAT conducted"; see AD-2 |
| G-07 | Treatment of `docs/uat-test-plan.md` | **AUTHOR** | its `PASS` rows have no participants | mark superseded or withdraw (AD-4) |
| G-08 | Treatment of `docs/verification.md` | **AUTHOR** | claims no controller calls the predictor; `students.controller.js:69` does | mark superseded (AD-4) |
| G-09 | AI-assistance disclosure | **AUTHOR** | none in the repository | author writes it to school policy |
| G-10 | Author name, admission number, supervisor | **AUTHOR** | placeholder in every document | author fills the title page |
| G-11 | Phone-camera scan of a printed QR code | **OPEN** | no camera/decoder in `frontend/src`; tokens are typed | state as not implemented (FR-33 partial) |
| G-12 | Load and concurrency evidence (500 / 1 000 candidates; two simultaneous registrations) | **OPEN** | NFR-01 verified at 50 candidates only | recommend a load test (Ch.6 §6.4) |
| G-13 | Removal of the two `E2E Probe` students from the live database | **OPEN** | demonstration artefacts remain | delete before any live screenshot |
| G-14 | Administrator password re-alignment and re-run of the reveal smoke script | **PARTLY** | reveal covered by `duplicateFlags` tests at HEAD; the live smoke still 401s | re-run after the redeploy (AD-1) |

## 3. Carried gaps (G-15 … G-28)

| ID | Gap | Status at `cca0625` | Evidence | Action |
| --- | --- | --- | --- | --- |
| G-15 | Print verification of the certificate PDF and the report export | **PARTLY** | the certificate PDF bytes are asserted (`bursaryCertificates.test.js:221-233`: `%PDF` magic, >5 000 bytes); the report export has no content assertion; nothing has been printed | print both, photograph the output |
| G-16 | Accessibility audit and cross-browser testing | **OPEN** | Chrome only | NFR-14/NFR-19 remain unverified |
| G-17 | Tests for eligibility arithmetic, dashboard counters, report content | **PARTLY** | `eligibility` tests exist but are thin; report content has no byte-level assertion | table-driven tests still needed |
| G-18 | Adjudicated pair labels and a re-run of the reviewed-pairs evaluation | **OPEN** | metrics are on synthetic labels | Ch.6 §6.4.1 |
| G-19 | Hosted disaster-recovery drill | **OPEN** | rehearsal was local | Ch.6 §6.4.8 |
| G-20 | One clean 151/151 run on an adequate machine | **CLOSED** | T-01 + §1.1: 24 suites / 151 tests; monolithic attempts 150/151 (Python sidecar), grouped runs 80/80 and 70/71 with the single failure passing alone, 2026-11-03 | cite the ledger with its date; do not quote one summary line alone |
| G-21 | Proposal Random Forest / four features vs delivered XGBoost / six features | **CLOSED as a declaration** | `PRODUCTION_ML_MODEL_VERIFICATION.md` §2, §7 | declare in Ch.4 and Ch.6 (C-1) |
| G-22 | Proposal Linux VM with Nginx/PM2 vs Azure Container Apps + App Service | **CLOSED** | `AZURE_DEPLOYMENT_VERIFICATION.md` §1, §3 — `PYTHON_EXECUTABLE` proves the in-container predictor | redraw Figure 4.24 |
| G-23 | `docs/verification.md` stale claim (no callers of the prediction function) | **AUTHOR** | contradicted at `students.controller.js:69` | do not cite the file; mark superseded |
| G-24 | `docs/uat-test-plan.md` `PASS` rows and stale predictor sentence | **AUTHOR** | — | same as G-07 |
| G-25 | Two test totals in `docs/FINAL_TEST_REPORT.md` (21/128 and 24/151) | **CLOSED** | this package cites 24/151 at `cca0625` only | quote counts with dates |
| G-26 | Four working checkouts on different branches with differing documents | **CLOSED as a declaration** | Ch.5 §5.6 | name the checkout used: `student-beneficiary-system` at `cca0625` |
| G-27 | `.gitignore` lists `ml-service/model/*.joblib` while two `.joblib` files are tracked | **OPEN** | `git ls-files ml-service/model` returns `xgb_duplicate_model.joblib` and `research/rf_attachment_style_candidate.joblib` | note that tracking wins over the ignore rule; do not delete the artefact |
| G-28 | Untracked root reports (`SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md`) | **OPEN** | `git status --porcelain` shows both as `??` | commit them or exclude them from the evidence trail (see G-30) |

## 4. Gaps found in this revalidation (G-29 … G-36)

| ID | Gap | Severity | Evidence | What the report must do |
| --- | --- | --- | --- | --- |
| G-29 | **The deployed API image is 9 commits behind HEAD.** `ca-sbms-api` runs `a3714f8`; HEAD is `cca0625`; the certificate feature (FR-22–FR-24) is therefore absent from the deployment | **High** — it invalidates any "deployed and working" claim about certificates | `AZURE_DEPLOYMENT_VERIFICATION.md` §5 (`POST /api/certificates/verify` → 404 `Cannot POST /api/certificates/verify`; `git merge-base --is-ancestor f3686ec a3714f8` → false). Do **not** cite SPA bundle hashes: `VITE_API_ORIGIN` is inlined at build time | caption certificate screenshots as local build; state the deployed commit; choose AD-1 |
| G-30 | **The evidence package itself is untracked** (`academic-report-evidence/` shows as `??`), so it is not part of the audited commit | Medium | `git status --porcelain` | commit the folder or archive it with the submission and say which |
| G-31 | **Deployment has no automated verification**: the GitHub Actions workflow is `workflow_dispatch` build-and-publish only — no tests, no deploy step, no post-deploy probe | Medium | `.github/workflows/*` (§4 of the Azure document) | describe deployment as manual and unverified |
| G-32 | **`render.yaml` is dead configuration** describing a hosting target that is not used | Low | `render.yaml` present; no Render service exists | do not describe Render as the deployment target |
| G-33 | **No security headers beyond the hand-rolled set**: `index.js:33-39` sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a permissions policy; there is **no CSP** and `helmet` is not used | Medium | `backend/src/index.js:33-39`; NFR-10 | state exactly which headers exist; do not claim a CSP |
| G-34 | **Thresholds are runtime-editable and audited, but held in process memory**: `settings.js` keeps `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (0.70), `DUPLICATE_REVIEW_THRESHOLD` (0.30) and `ML_REVIEW_SCORE_THRESHOLD` (0.50) in module variables; `settings.controller.js:52` writes an `ADMIN_UPDATE_DUPLICATE_THRESHOLDS` audit entry with before/after values, but the new values are **lost when the container restarts** (and `minReplicas 0` means restarts happen) | Medium | `backend/src/config/settings.js`; `backend/src/controllers/settings.controller.js:52-64`; `AZURE_DEPLOYMENT_VERIFICATION.md` §3.2 (no threshold env vars, so code defaults apply) | say that a threshold change is audited but not durable, and that the values in force are the code defaults; report the cut-off as **provisional** (`thresholds_validated: false`). Each existing flag keeps the `review_threshold` stored when it was created (`duplicateFlags.controller.js:73`), so later changes do not retroactively reclassify open cases |
| G-35 | **Predictor failure is fail-closed but not graceful**: if `predict.py` cannot start, registration returns **503** `DUPLICATE_SCREENING_UNAVAILABLE` (`students.controller.js:76-82`); there is no rule-based fallback (the legacy engine is `@deprecated`) | Medium | `duplicateCheck.js`; ML doc §6 | describe the availability/accuracy trade-off honestly; it is a design choice, not a defect |
| G-36 | **No PR-based CI history is verifiable from this workstation** (`gh` CLI unavailable), so the repository's PR/checks narrative cannot be evidenced | Low | attempted `gh` invocation failed | do not cite PR checks or build badges as evidence |

All eight gaps in this section are **OPEN**; the third column records severity rather than resolution status because these
were discovered in this pass. None of them can be closed by re-reading the repository — each needs a deploy, a run, or an
author decision.

## 5. Evidence exceptions (E-01 … E-03)

These are cited where a claim rests on a document that is **outside the audited repository**. They are not gaps in
the system; they are sources the author must confirm.

| ID | Exception | Cited in | What the author must do |
| --- | --- | --- | --- |
| E-01 | The four Chapter 1 objectives were re-stated, not re-read: Chapters 1–3 are not in the repository, so the wording in `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §1 is a faithful paraphrase | traceability §1, Ch.6 §1 | paste the four original objective sentences and confirm each verdict still holds |
| E-02 | The approved proposal is the only source for the Random Forest / four-feature and single-VM claims (G-21, G-22); no copy of it is tracked | ML doc §2; Ch.5 §5.2 | confirm the section numbers quoted from the proposal |
| E-03 | School policy on AI-assistance disclosure and on UAT ethics is not available from the repository | G-06, G-09 | supply the policy text and the disclosure statement |

## 6. Author decisions (AD-1 … AD-6)

| ID | Decision | Options | Recommended | Consequence of each option |
| --- | --- | --- | --- | --- |
| AD-1 | How to handle the 9-commit deployment lag (G-29) | (a) redeploy `cca0625`, re-run the live probes, then capture certificate screenshots from the live site; (b) leave the deployment as it is and label every certificate figure as a local build | **(a)** if time allows, otherwise (b) with explicit labels | (a) removes the largest evidential weakness and lets Chapter 5 quote live certificate responses; (b) is honest but concedes the feature is not evidenced in the deployment |
| AD-2 | Whether to run a user acceptance study (G-06) | (a) run a small UAT with 3–5 field officers and report it; (b) declare that none was conducted | **(b)** for the current submission, with (a) named as future work | (a) requires ethics approval and time; (b) means objective (iv) stays "partially achieved" |
| AD-3 | Whether to validate the 0.50 cut-off against adjudicated labels (G-18) | (a) adjudicate 200–400 pairs and re-run `evaluate_reviewed_pairs.py`; (b) keep the synthetic holdout figures with the prevalence caveat | **(b)** now, (a) as future work | (a) is the only route to a defensible field-accuracy claim; (b) keeps every metric tied to a synthetic distribution |
| AD-4 | Disposition of the two stale documents (G-07/G-08/G-23/G-24) | (a) mark `docs/verification.md` and `docs/uat-test-plan.md` as superseded in place; (b) withdraw them from the appendix | **(a)** | (a) leaves an audit trail showing the correction; (b) removes contradictory text but loses the history |
| AD-5 | Whether to commit the evidence package (G-30) | (a) commit `academic-report-evidence/` to the branch; (b) archive it with the submission only | **(a)** | (a) makes every claim traceable to the same commit; (b) relies on the archive being submitted intact |
| AD-6 | Which commit the report names as the system of record | (a) `cca0625` (HEAD, everything tested here); (b) neither, quote the deployed `a3714f8` | **(a)**, with the deployment lag declared in the same paragraph | (b) contradicts 151 tests that only pass at HEAD |

## 7. Resolution summary

| Status | Count | IDs |
| --- | --- | --- |
| CLOSED | 6 | G-02 (mechanism identified: host memory, not code), G-20 (all 151 tests pass across the run ledger), G-21 (declared deviation), G-22 (deployment architecture confirmed), G-25 (dated counts), G-26 (single checkout named) — G-21 and G-26 are closed *as declarations*, i.e. the report must state them, and stating them discharges the gap |
| PARTLY | 3 | G-14, G-15, G-17 |
| OPEN | 21 | G-01, G-03, G-04, G-05, G-06, G-11, G-12, G-13, G-16, G-18, G-19, G-27, G-28, G-29, G-30, G-31, G-32, G-33, G-34, G-35, G-36 |
| AUTHOR | 6 | G-07, G-08, G-09, G-10, G-23, G-24 |
| **Total** | **36** | G-01 … G-36 — every ID appears in exactly one row |

The two entries that most affect the report's defensibility are **G-29** (the deployed image predates the code) and
**G-18** (no adjudicated labels). Everything else is either a missing input from the author or a documented limit of a
prototype.

## 8. Cross-document resolution check

| Document | Gap IDs it cites | All resolve? |
| --- | --- | --- |
| `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` | G-11, G-12, G-17, G-18, G-21, G-29, G-33, G-34 | yes — §4 of that document |
| `SBMS_TEST_EVIDENCE_CATALOGUE.md` | G-02, G-15, G-16, G-17, G-20, G-29 | yes — §6 of that document |
| `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` | E-01, G-06, G-11, G-12, G-13, G-17, G-18, G-19, G-21 | yes — §7 of that document |
| `PRODUCTION_ML_MODEL_VERIFICATION.md` | E-02, G-18, G-21, G-34, G-35 | yes — §8 of that document |
| `AZURE_DEPLOYMENT_VERIFICATION.md` | G-22, G-29, G-31, G-32, G-33, G-34, G-36 | yes — §7 of that document |
| `CHAPTER_4_FINAL_EVIDENCE_PACKAGE.md` | E-01, G-03, G-04, G-21, G-29, G-32 | yes — §6 of that document |
| `CHAPTER_5_FINAL_EVIDENCE_PACKAGE.md` | G-01, G-05, G-06, G-13, G-16, G-19, G-24, G-26, G-28, C-5 | yes — §7 of that document (C-5 is defined in `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md`, outside this package) |
| `CHAPTER_6_FINAL_EVIDENCE_PACKAGE.md` | G-01, G-02, G-06, G-11, G-12, G-16, G-18, G-19, G-20, G-21, G-23, G-24, G-25, G-28, G-29, G-30, G-36 | yes — cited inline in §1, §2 and §6 (Chapter 6 has no separate gap section) |
| `SBMS_DIAGRAM_SPECIFICATIONS.md` | G-05 | yes — §4 of that document |
| `SBMS_SCREENSHOT_INSERTION_CHECKLIST.md` | G-05, G-11 | yes — §4 of that document |
| `CLAUDE_FINAL_HANDOFF_GUIDE.md` | AD-1 … AD-6, G-21, G-23, G-24, G-27, G-36 | yes — §2 and §6 of that document |
| `EVIDENCE_SOURCE_INDEX.md` | AD-1, AD-4, AD-5, AD-6, E-01, E-03, G-01, G-18, G-19, G-23, G-24, G-25, G-27, G-28, G-30, G-31, G-32, G-34, G-35, G-36 | yes — §5 of that document |
| `README.md` | AD-1 … AD-6, E-01, E-03, G-01, G-06, G-11, G-12, G-18, G-19, G-21, G-29, G-30, G-36 | yes — "What is not established" and "Before submission" |
| `CURRENT_REPOSITORY_STATE.md` | none | n/a — descriptive only, cites no gap |



