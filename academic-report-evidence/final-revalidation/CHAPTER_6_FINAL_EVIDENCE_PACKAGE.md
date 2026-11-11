# CHAPTER 6 FINAL EVIDENCE PACKAGE

> Evidence for `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md`, revalidated 2026-11-03 at HEAD `cca0625`.
> Gap and decision IDs are the ones defined in `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md`, which continues the
> numbering of `docs/final-documentation-content/DOCUMENTATION_GAP_REGISTER.md` (G-01 … G-28) and adds G-29 … G-36.

## 1. Objective-by-objective conclusions — approved wording

| Objective | Verdict to write | Evidence that supports it | Evidence that would be needed for "fully achieved" |
| --- | --- | --- | --- |
| (i) Investigate existing challenges | **Partially achieved** | documentary analysis only (Ch.2); no fieldwork | interviews, registry audit data (G-06) |
| (ii) Design architecture, schema and ML pipeline | **Achieved with a declared deviation** | three tiers live; 12 tables with constraints; six-feature pipeline tested 33/33 | a Random Forest as proposed — not delivered (G-21) |
| (iii) Implement registration, identifiers, QR, RBAC | **Achieved** for everything except phone-camera scanning and token re-issue | 151 backend tests across 24 suites; live 200/401/403 probes; QR verification live | camera scan (G-11), token recovery (FR-35) |
| (iv) Validate and evaluate | **Partially achieved** | 151 + 33 tests pass; ML metrics on synthetic holdout; deployment reachable | adjudicated real labels (G-18), UAT (G-06), load test (G-12), hosted DR drill (G-19) |

Two sentences the chapter must contain, in this or equivalent form:

1. "The classifier delivered is XGBoost over six features; the proposal specified Random Forest over four. The change
   was made to raise recall on the identifier-collision and sibling scenarios, it is documented in FR-31 and G-21, and
   every metric reported in this chapter belongs to the delivered XGBoost artefact (`xgboost:6ec9f2a3…`)."
2. "The certificate feature (FR-22–FR-24) is implemented and covered by 17 tests at HEAD, but the deployed image is
   built from commit `a3714f8` and does not contain it; the live `/api/certificates/verify` returns 404. Screenshots
   of that feature are therefore labelled as a local build."

## 2. §6.2.7 quality conclusions — what testing actually established

| Established | Not established |
| --- | --- |
| 151 backend tests / 24 suites pass at `cca0625`; no test expectation has ever been observed to fail (2026-11-03; monolithic run 150/151, grouped runs 80/80 and 70/71, standalone reruns pass — §1.1 of the test catalogue) | that the Python sidecar will start on every machine: it failed to start twice and to load its model once while the host had under 1 GB free (G-02) |
| 33 ML tests pass in the project virtualenv | that the model generalises to real registry data |
| Access control, masking and public-disclosure limits behave as designed | concurrency behaviour beyond one registration at a time |
| Readiness fails closed when a table is missing | recovery from loss of the *managed* database (G-19) |
| CORS allowlist and body limits reject foreign origins and oversized bodies | browser coverage beyond one build (G-16) |

## 3. §6.2.8 contribution — safe phrasing

Claimable without overreach: an advisory, versioned ML screen inside a human-review workflow, with an aggregation
policy that caps flags per registration; a working three-tier artefact deployed on a zero-cost hosting profile; and a
documented evidence trail that separates what was tested, what was deployed and what was assumed.

Not claimable: novel detection accuracy, field-validated thresholds, production-scale performance, or organisational
impact.

## 4. §6.3 recommendations — ownership

| Recommendation | Owner | Prerequisite evidence |
| --- | --- | --- |
| Answer policy questions D1–D5 (score use, flag budget, retention) | programme owner | none — a policy decision |
| Refresh the deployment to HEAD and add a deploy step to CI | technical maintainer | G-29 |
| Collect adjudicated duplicate labels and re-evaluate | programme owner + maintainer | G-18 |
| Run a UAT with field officers | author + programme owner | G-06 |
| Load-test at 500 and 1 000 registry rows | maintainer | G-12 |
| Drill restore on the managed server | maintainer | G-19 |
| Add a CSP and move to `helmet` | maintainer | none |
| Add automated frontend tests | maintainer | none |

Each recommendation must name the stakeholder and the action; do not write "the system should be improved".

## 5. §6.4 future work — each item must point at the gap it answers

| Future-work item | Gap it answers | Why it is future work and not a defect |
| --- | --- | --- |
| 6.4.1 Adjudicated ground truth and real evaluation | G-18 | requires recorded decisions that do not exist yet |
| 6.4.2 Candidate generation (blocking) | G-12, FR-34 | the current quadratic scan is correct, just costly |
| 6.4.3 A calibrated, explainable score | FR-28, ML §3 | thresholds are provisional by admission in the API payload |
| 6.4.4 Flag budget and review capacity | D3 policy question | needs an organisational decision, not code |
| 6.4.5 Multi-registry operation and shared identity | FR-32 | out of scope at `d6b5032` |
| 6.4.6 Identity assurance and token lifecycle | FR-35, FR-36 | accepted limit: no re-issue, no rotation |
| 6.4.7 Independent confirmation of receipt | FR-18 | officer-assisted acknowledgement only |
| 6.4.8 Operational hardening and scale | G-19, G-29, G-30 | free-tier hosting, manual deployment |
| 6.4.9 Accessibility and acceptance | NFR-14, NFR-19, G-06, G-16 | no UAT, no accessibility audit |
| 6.4.10 Documentation and evidence hygiene | G-23, G-24, G-25, G-28 | stale documents and untracked reports |

## 6. Claim limits for the whole of Chapter 6

| Forbidden claim | Why | Say instead |
| --- | --- | --- |
| "92 % detection accuracy in practice" | synthetic, balanced holdout; 10.5 % precision at 1 % prevalence | "0.9204 precision on a balanced synthetic holdout at a 0.50 cut-off; 0.105 at 1 % prevalence" |
| "The system prevents duplicate payments" | the screen is advisory; a human decides | "the system surfaces candidates and blocks approval while a case is open" |
| "Deployed and fully functional" | deployed image is 9 commits behind HEAD; certificates 404 | "deployed at `a3714f8`; the certificate feature exists only at HEAD" |
| "Validated by users" | no participants | "not evaluated with users (G-06)" |
| "Production ready" | free tier, manual deploy, no CSP, no load test | "a working artefact at prototype deployment scale" |
| "Random Forest implemented" | XGBoost delivered | "XGBoost, a declared deviation (G-21)" |
| "Recovery verified" | local rehearsal only | "rehearsed locally on 2026-10-31; a managed-server drill is outstanding (G-19)" |

## 7. Numbers Chapter 6 must keep consistent with Chapters 4–5

| Item | Value |
| --- | --- |
| Requirements | 37 FR (24 verified / 8 partial / 5 not implemented), 24 NFR (15 verified / 5 partial / 4 not tested) |
| Backend tests | 24 suites / 151 tests, all 151 passing at `cca0625` (see the run ledger) |
| ML tests | 33 / 33 |
| Model | XGBoost, six features, `xgboost:6ec9f2a3…`, cut-off 0.50 (provisional) |
| ML metrics | precision 0.9204 · recall 0.8927 · F1 0.9063 · ROC-AUC 0.9685 · PR-AUC 0.9727 · FPR 0.35 % on 2 000 negatives |
| Tables / endpoints | 12 tables · 45 endpoints |
| Deployment | Container App `ca-sbms-api` (UAE North, `minReplicas 0`, API image `a3714f8`) + App Service `sbms-web` on plan `asp-sbms-web` (F1 Free) + PostgreSQL Flexible Server `pg-sbms` v16 Burstable B1ms (32 GB, 7-day backup) |
| Repository | `Eggxellent/student-beneficiary-system`, branch `fix/sbms-completion-work`, HEAD `cca0625` |

