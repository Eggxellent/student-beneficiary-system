# SBMS Project Handover — October 2026

**Purpose:** single source of truth for the next work session (DeepSeek or otherwise).
**Prepared:** 2026-10-30
**Branch inspected:** `fix/sbms-completion-work` (worktree `student-beneficiary-system`)
**Evidence rule:** every row below was verified by reading code or running it. Claims that were
only *documented* previously are marked as such.

Read §3 and §4 before touching any ML code. Read §7 before provisioning any database.

> **Update, 2026-10-30 (later session):** §11 items 2, 3, and 5 are done, and the
> three unpushed commits now exist on `fix/sbms-completion-work`. See **§12** for
> what changed, the measured evidence, and what is still outstanding. The audit
> rows in §1–§6 below are left as originally written so the defect history stays
> traceable; where §12 contradicts them, §12 is current.

---

## 1. Position: what is now verified

### 1.1 Toolchain (fixed this session, re-verified)

| Check | Result |
|---|---|
| Circular `file:` dependencies repo-wide | **0** (was the blocker for installs and `npm ci`) |
| Backend `npm ls` | clean, no `UNMET` |
| Backend unit tests (no DB) | **pass** — 19/19 re-run in the two ML/duplicate suites, no live database needed. Jest still **requires** the guard env vars (`NODE_ENV=test`, `DATABASE_URL`, `SBMS_TEST_DATABASE_URL` = same local `sbms_test` URL) or it aborts before running anything. A 25/25 run across the wider no-DB subset was recorded previously. |
| Frontend `npm run build` | pass (2002 modules, 334 kB) |
| `npm ci --omit=dev --dry-run` | succeeds |
| `ml-service/.venv` | xgboost 3.2.0, scikit-learn 1.9.0, pandas 3.0.5 — loads the artifact |
| Full Jest suite | still gated on a local `sbms_test` Postgres (by design, not a defect) |

### 1.2 Status matrix

Statuses: **Verified** (read + executed), **Implemented** (code exists, not executed
end-to-end), **Partial**, **Not implemented**, **Defect**.

| # | Capability | Status | Evidence / notes |
|---|---|---|---|
| 1 | Auth: bcrypt + JWT + roles | Implemented | `controllers/auth.controller.js`, `middleware/auth.js`, `requireRole.js`; route tests exist |
| 2 | Student registration | Implemented | `controllers/students.controller.js:29-124`; unit-tested; not E2E-verified (needs DB) |
| 3 | ML wired into registration | **Verified** | `students.controller.js:69` calls `scorePairs`; aborts with 503 on predictor failure (`:70-76`) |
| 4 | Node→Python model bridge | **Verified live** | Drove `ml-service/predict.py` through `predict_pairs`; returned `model_version` `xgboost:6ec9f2a3…` |
| 5 | Production artifact identity | **Verified** | `model/xgb_duplicate_model.joblib` SHA-256 `6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9` — matches `docs/ml_audit.md` |
| 6 | Six-feature contract order | **Verified** | `feature_engineering.py:11-18` `FEATURE_COLUMNS` == backend payload `duplicateCheck.js:201-208` == `predict.py:29` |
| 7 | Review threshold 0.5 | Implemented, **not validated** | `config/settings.js:8`; no reviewed real-data evidence for this value |
| 8 | Pair→registration flag aggregation | **Defect (measured)** | Any single pair ≥ threshold flags the student `students.controller.js:77-101`; see §4 |
| 9 | Candidate generation / blocking | **Not implemented** | Registration compares against **every** student `students.controller.js:63-67`; scan is O(N²) `duplicateFlags.controller.js:208-222` |
| 10 | Legacy weighted-rule engine | Dead code, still exported | `duplicateCheck.js:17-24,163-191`; **no production callers** — only tests use it |
| 11 | Duplicate review + admin decision | Implemented | `duplicateFlags.controller.js` (`decisionSchema`, review events); not E2E-verified |
| 12 | Disbursement duplicate guard | Implemented | `disbursements.controller.js:86-96` blocks on `pending`/`needs_verification`/`confirmed_duplicate` |
| 13 | QR generation + public verification | Partial | token + QR at `students.controller.js:53-55`; `verification.*` exists; phone-camera flow never executed |
| 14 | Fresh-DB bootstrap (`schema.sql`) | **Defect** | `schema.sql` creates 7 tables; startup requires **11**, incl. `beneficiaries` — see §8 |
| 15 | Azure deployment | Not started | — |
| 16 | Frontend functional audit | Not done | 18 pages compile; none functionally tested against a live API in this session |
| 17 | Documentation accuracy | 3 stale claims | corrected in §3 |

### 1.3 Repository reality

Four sibling folders are **git worktrees of one repo** on different branches:
`student-beneficiary-system` (`fix/sbms-completion-work`), `-dev` (`dev`),
`-admin-login-fix`, `sbms-raw-pair-model-training`.
**A commit on one branch does not reach the others.** The `.gitignore` guard that prevents
re-committing the deleted nested artifact exists **only** on `fix/sbms-completion-work`.

---

## 2. What this document corrects

The previous handover said the live workflow "used weighted rule-based duplicate detection
rather than the XGBoost model." **That is no longer true on this branch, and instructing an
agent to "connect the model to live registration" would waste a session chasing a solved
problem.** Details in §3.

The real ML problem is different and is quantified in §4: the model is connected, the
*decision rule around it* is unsound.

---

## 3. Corrections to the previous handover

| # | Previous claim | Verified reality | Source |
|---|---|---|---|
| C1 | "The live registration/review workflow uses weighted rule-based detection rather than XGBoost." | **False on this branch.** Registration calls the Python XGBoost predictor before insert and blocks registration (503) if screening fails. | `students.controller.js:69`, `mlDuplicateReview.js:41-72`, `predict.py:84-98` |
| C2 | "The default 0.5 threshold has not been established as optimal." | **Still true, and now quantifiably unsafe** — but not for the reason assumed. Threshold is secondary; aggregation dominates (§4). | `config/settings.js:8` |
| C3 | "Connect the validated model to live registration" is an outstanding ML task. | **Already connected.** The outstanding task is to *validate and re-threshold* it, and to replace the decision rule. | as C1 |
| C4 | `dev`'s `PROJECT_CONTEXT.md:8` states there are "no current controller callers" of the ML predictor. | **Stale/wrong** — contradicts `docs/ml_audit.md` (2026-10-23) and the code. Two branches disagree; `dev` must not be trusted as current state. | `PROJECT_CONTEXT.md` on `dev` |
| C5 | The system "has an XGBoost model." | True, with a caveat that matters: the loaded artifact was trained on **generated synthetic scenario pairs**, and the research artifacts (10-feature, and `rf_attachment_style_candidate`) must stay separate. | `RETRAINING_EVALUATION.md`, `ML_RELIABILITY_REPORT.md` |

**Instruction for the next agent:** do not "integrate" the model. It is integrated.
Do not retrain from `data/raw_pairs.csv` — its labels leak through `birth_certificate_match`
(AUC 0.953 on that single feature; `ML_RELIABILITY_REPORT.md:8`).

---

## 4. Priority 1: the ML defect, measured

### 4.1 What the code does today

1. Registration opens a transaction, takes an advisory lock, and selects **all** students
   `FOR UPDATE` (`students.controller.js:61-67`).
2. It scores the new student against **every** existing student (`:69`), in batches of 200
   (`mlDuplicateReview.js:4`), sequentially.
3. **If any single pair scores ≥ 0.5, the new student is flagged** (`:77-83`); then the student
   is inserted and one `duplicate_flags` row is written per matching candidate (`:85-92`).

Step 3 is the defect. There is no candidate blocking, no top-k limit, and no
"require corroboration" rule. The student-level decision is `OR` over N pair decisions.


### 4.2 Measured pair-level performance

**(a) Live artifact, reproducible harness (added with this handover).**
`ml-service/evaluate_false_positive_rate.py`, default seed, 2,000 pairs of deliberately
unrelated students sharing a school, independent realistic identifiers (8-digit guardian ID,
10-char alphanumeric UPI, 7-digit birth certificate).

| Cutoff | Flagged | Rate |
|---:|---:|---:|
| 0.30 | 14 / 2000 | 0.70% |
| 0.50 | 7 / 2000 | **0.35%** |
| 0.70 | 2 / 2000 | 0.10% |
| 0.80 | 0 / 2000 | 0.00% |

Restricting to pairs with provably different full names (the hardest easy-negative) gives
0.15% at 0.50. Score distribution on unrelated pairs: p50 0.019, p90 0.050, p99 0.198,
max 0.744.

**The model is well-behaved on easy negatives.** That is the good news — and it is why
threshold-tweaking alone will not fix the review queue.

**(b) Project's own dataset result** (`reports/sbms_dataset_experiment.md:45`,
XGBoost at 0.50, 4,512 test rows): TP 954, FP 99, TN 3,285, FN 174 →
precision 0.906, recall 0.846, F1 0.875, PR-AUC 0.953, **FPR 2.93%**.

The two FPRs (0.35% vs 2.93%) describe different negative populations: the probe measures
*random unrelated* pairs; the dataset contains *hard* synthetic negatives (siblings, twins,
common names). Both are legitimate, and the conclusion in §4.3 holds under either.

**Sensitivity note (kept deliberately):** an earlier probe version reused padded identifier
formats (`G00001…`, `BC00001…`) and produced a 4.3% FPR. That was an artifact of formatting,
but it is a real lesson: `upi_match` / `birth_certificate_match` are Jaro-Winkler
**similarities**, so structurally similar identifier formats score high. Unrelated
identifiers average ≈0.50 similarity (measured separately over 4,000 pairs), meaning these
two features carry substantial noise that the model must learn to discount.

### 4.3 The aggregation defect, quantified

With per-pair FPR `p`, N existing students, and independence assumed:

- probability a legitimate registration gets ≥1 flag = `1 − (1−p)^N`
- expected false flags per legitimate registration = `N·p`
- flag-level precision ≈ `recall / (recall + N·p)`, recall ≈ 0.88

| N existing | P(legit reg flagged), p=0.35% | exp. false flags | flag precision |
|---:|---:|---:|---:|
| 50 | 16.1% | 0.18 | 83.4% |
| 100 | 29.6% | 0.35 | 71.5% |
| 250 | 58.4% | 0.88 | 50.1% |
| 500 | 82.7% | 1.75 | 33.5% |
| 1000 | **97.0%** | 3.50 | **20.1%** |

| N existing | P(legit reg flagged), p=2.93% | exp. false flags | flag precision |
|---:|---:|---:|---:|
| 50 | 77.4% | 1.47 | 37.5% |
| 100 | **94.9%** | 2.93 | 23.1% |
| 250 | 99.9% | 7.33 | 10.7% |
| 500 | 100.0% | 14.65 | 5.7% |
| 1000 | **100.0%** | 29.30 | **2.9%** |

**Conclusion.** At 1,000 students the queue approaches "every registration flagged" — exactly
the outcome the owner rejected. Pair-level precision of 0.90 becomes flag-level precision of
roughly 3–20%. This is the arithmetic of the `OR` rule, not a model-quality failure, and it
degrades with enrolment. It must be fixed before any demonstration that shows the review
queue.

### 4.4 Root causes, ranked

1. **`OR` aggregation over unbounded N** — primary cause (`students.controller.js:77-83`).
2. **No candidate blocking** — comparing across schools and unrelated students multiplies N
   with no information gain (`:63-67`).
3. **Unvalidated cutoff** — 0.5 is an experiment operating point, not a reviewed-data choice
   (`RETRAINING_EVALUATION.md:15`).
4. **Synthetic-only training** — no adjudicated real pairs exist in the repo
   (`ML_RELIABILITY_REPORT.md:38`).
5. **Fuzzy identifier features** — similarity rather than exact agreement for
   UPI / birth certificate / guardian ID (`feature_engineering.py:89-104`).

### 4.5 The model never rejects a student — confirmed, keep it that way

Every path writes `status='pending'`, and responses carry
`score_is_calibrated_probability: false` (`students.controller.js:119`). No code deletes or
rejects on model output. The stated product principle is already satisfied in code.


---

## 5. Decisions only the owner can make (do not let an agent guess these)

These are policy, not code. Phase 2 cannot finish until they are answered; an agent that
"picks something reasonable" here will produce an indefensible thesis result.

| ID | Decision | Why it blocks work | Suggested starting point |
|---|---|---|---|
| D1 | **Flag budget**: how many cases per registration may reach an administrator? | Determines the aggregation rule. `top-1 above cutoff` is the simplest defensible policy. | 1 case per registration |
| D2 | **Review capacity**: how many cases per week can realistically be adjudicated? | Sets the operating point and therefore the threshold. | State a number |
| D3 | **Miss tolerance**: what fraction of true duplicates may be missed? | Sets the recall floor, which constrains precision. | e.g. miss ≤ 20% |
| D4 | **Cross-school comparison**: should a student be compared against other schools? | If schools are distinct catchments, blocking by school cuts N by ~5x with little loss. | Block by school |
| D5 | **Adjudication owner**: who reviews the first 200–300 pairs to create ground truth? | Without reviewed labels there is no real evaluation (see §6). | Named reviewer + data-protection rule |

Record the answers in `docs/ml-evaluation-policy.md` before tuning.

---

## 6. Phase 2 protocol (scientific, uses tooling that already exists)

Do **not** tune by watching the dashboard. The repository already contains the correct
machinery; nothing new needs to be invented.

**Ground truth already exists.** Administrators write decisions to `duplicate_review_events`
(`schema.sql:98-106`, `decision IN ('confirmed_duplicate','not_duplicate','needs_verification')`).
Each flag also stores `model_version`, `review_threshold`, and the full `comparison_features`
(`schema.sql:81-83`) — so historic flags can be rescored offline and audited.

### Steps

1. **Export reviewed pairs.** One row per adjudicated flag, joined
   `duplicate_flags` → `duplicate_review_events` (latest decision wins) → both student
   records. Map to the template expected by `ml-service/evaluate_reviewed_pairs.py`
   (`reviewed_pairs_template.csv`): `label`, `entity_id_1`, `entity_id_2`, `partition`,
   plus the six raw fields. Exclude `needs_verification` rows.
2. **Partition by entity, not by row.** Every person appears in exactly one of
   `tuning` / `holdout` (`REVIEWED_DATA_EVALUATION.md:11`). This is non-negotiable;
   violating it produces inflated metrics.
3. **Freeze the model.** Evaluate the artifact by hash; any change invalidates the run.
4. **Select the threshold on `tuning` only**, under D1–D3. Report precision, recall, F1,
   PR-AUC, FPR, and confusion matrix at 0.30/0.40/0.50/0.60/0.70 — never accuracy alone.
5. **Report `holdout` once.** No iteration after seeing it.
6. **Evaluate aggregation policies** on the same holdout, in this order — this is the part
   that fixes §4:
   - P0: current `OR` over all students (baseline, expected to fail);
   - P1: top-1 only, per registration;
   - P2: P1 + corroboration (≥2 corroborating fields, or exact identifier agreement);
   - P3: P2 + school blocking; then also report cross-school recall loss.
7. **Record the result** in `docs/ml_evaluation_2026-11.md` with hashes, N, prevalence, and
   reproduction commands.

### Exit criteria for Phase 2

- [ ] ≥200 adjudicated pairs, entity-disjoint tuning/holdout split, documented provenance.
- [ ] Confusion matrix + precision/recall/F1/PR-AUC/FPR on **holdout** for the chosen policy.
- [ ] At current enrolment, predicted flag rate per 100 legitimate registrations is stated
      and accepted by the owner (`N·p` from §4.3).
- [ ] Aggregation policy implemented in `students.controller.js` and covered by a unit test
      that asserts *only one* flag per registration under a multi-candidate scenario.
- [ ] Threshold overridable by env var, with the chosen value documented in `.env.example`.
- [ ] Legacy rule engine deleted or explicitly quarantined (`duplicateCheck.js` legacy exports)
      so no future reader mistakes it for the live path.

If reviewed real pairs are not obtainable, say so explicitly in the report and present the
synthetic results as **synthetic**, with §4.3's arithmetic as the headline limitation.


---

## 7. New blocker found: the repo cannot bootstrap the database it requires

This is almost certainly the same class of failure as the Render `42P01` ("users table
missing"), and it will recur on Azure unless fixed first.

| Fact | Evidence |
|---|---|
| `databaseReadiness.js` requires **11** tables | `databaseReadiness.js:3-15` |
| `schema.sql` creates **7** tables | `schema.sql` (users, students, duplicate_flags, duplicate_review_events, disbursements, audit_logs, reports) |
| `beneficiaries` is required and queried, but **no SQL file creates it** | required at `databaseReadiness.js:6`; queried at `beneficiary.model.js:4,9,15,33`; `CREATE TABLE beneficiaries` exists nowhere in `backend/src` |
| `bursary_awards`, `bursary_award_verification_events`, `disbursement_reconciliation_events` are **not** in `schema.sql` | created only by `migrations/20261023_bursary_award_reconciliation.sql` |
| 14 `disbursements` columns used by code are added **only** by that migration | `award_id`, `payment_status`, `receipt_status`, `acknowledged_*`, `cleared_*`, … |

**Consequence:** a fresh database provisioned from the repository's documented fresh-install
schema **cannot pass the startup readiness check**, so registration, awards, and
disbursements cannot be demonstrated. `schema.sql` is not a complete install script.

**Phase 5 fix (in this order):**
1. Decide the fate of the legacy `/api/beneficiaries` + `scholarship_amount` feature
   (see §8, Phase 3) — either give it DDL or delete the model/route/controller.
2. Produce one canonical, ordered install path (`schema.sql` + numbered migrations, or a
   regenerated single schema) and a `npm run db:init` script.
3. Add an automated test that creates a scratch database, applies the install path, and
   asserts `READINESS_QUERY` returns zero missing tables. This is the only way to stop a
   repeat of Render.
4. Do this against `sbms_test` only. Never against an existing database with real rows.

---

## 8. Phase plan and exit criteria

Order is deliberate: correctness → data → deployment → documentation. Do not jump to Azure.

| Phase | Work | Exit criteria |
|---|---|---|
| **1. Audit closure** | Finish frontend/backend/DB audit; reconcile docs with code (start with §3) | Every §1.2 row has a status and evidence; contradictions resolved |
| **2. ML correction** | §6 protocol; fix aggregation; decide threshold on reviewed data | §6 exit checklist fully ticked |
| **3. Business logic** | Registration, review, disbursement, reconciliation, audit trail; resolve `beneficiaries`/`scholarship_amount` ownership | Guard proven by integration test: an unresolved duplicate **cannot** be disbursed; award totals reconcile |
| **4. QR verification** | Generate → phone camera → public verify; invalid/expired token; legacy token-only QRs; privacy of response | Manual test log with screenshots; response contains no student PII; rate limit verified |
| **5. Database** | §7; backup + restore rehearsal | `db:init` builds a DB that satisfies readiness; a documented, tested restore exists |
| **6. Azure** | §9 | Auth, registration, ML screening, review, disbursement all exercised **in Azure** |
| **7. Testing** | Backend/frontend/integration/E2E/security/performance/ML/UAT | `docs/FINAL_TEST_REPORT.md` regenerated with real outputs, not intentions |
| **8. Documentation** | Chapters 4–5, screenshots from the deployed system, ML results from Phase 2, demo checklist | Reviewer can reproduce every number in the report |


---

## 9. Azure: cost-first decision framework

The previous target was Render; the new target is Azure. Nothing has been provisioned.
**No price in this section is asserted as fact — every figure must be checked in the Azure
pricing calculator for the chosen region before anything is created.**

### 9.1 The real risk

The `$0` constraint is compatible with static hosting and small app hosting, but **managed
PostgreSQL is normally the paid component**. Decide the database question *before* choosing
the compute, because it drives the whole bill.

### 9.2 Verify these, in this order, and write the answers down

1. Does the Microsoft account qualify for the student/sponsorship credit, and does it
   currently exist for this account? (If yes, it changes everything; if no, the plan must
   be genuinely $0.)
2. Azure Static Web Apps free plan — current limits (custom domain, bandwidth, build minutes).
3. Azure App Service free (F1) tier — availability in the chosen region, and whether the
   Node version required by the backend is supported there.
4. Azure Database for PostgreSQL Flexible Server — cheapest burstable SKU, monthly cost,
   and whether any free allowance applies to this account.
5. Egress, log storage, and any per-request charges on the ML path.

### 9.3 Candidate architectures

| Option | Frontend | API | Postgres | Notes |
|---|---|---|---|---|
| A | Static Web Apps (free) | App Service F1 | Azure Flexible Server | Cleanest Azure story; DB likely the only real cost |
| B | Static Web Apps (free) | App Service F1 | **Existing Neon** (free) | $0 candidate; repo already depends on `@neon/config`, `.neon` exists |
| C | Static Web Apps (free) | Container Apps (scale-to-zero) | Azure Flexible Server | More moving parts; cold starts hurt a live demo |

Option B is the only one that plausibly satisfies "don't create another database **and**
don't pay." Evaluate A vs B explicitly, and record why the loser was rejected.

### 9.4 Non-negotiables for the deployment itself

- Reuse/migrate the existing database if it passes the §7 readiness check; do not create a
  second one "just in case."
- The Python predictor runs as a **child process** (`duplicateCheck.js:232-237`). App Service
  must therefore ship Python + the artifact + `requirements.txt`, or screening fails closed
  with 503 and registration breaks. This is the single most likely Azure failure mode.
  Decide: bundle Python in the API image, or convert the bridge to an HTTP service.
- `PUBLIC_APP_URL` must be the real https URL, or QR generation fails strict validation.
- Secrets (`DATABASE_URL`, `JWT_SECRET`) live in app settings/vault, never in the repo.
  `.env`, `.env.*`, `.neon`, and `ml-service/model/*.joblib` are correctly ignored today —
  keep it that way, and never bake the artifact into the frontend bundle.
- Run the §7 install path against the hosted DB **before** pointing the frontend at it.


---

## 10. Evidence standard (the rule that changes behaviour)

From now on, a feature is only "done" when a **recorded** result exists. Use exactly four
statuses, and cite the artefact:

| Status | Means | Must provide |
|---|---|---|
| **Verified** | executed, output captured | command + output (or screenshot) |
| **Implemented** | code path exists, never executed | file:line, and the gap |
| **Partial** | some paths execute | which paths, which do not |
| **Not implemented** | absent | — |

Banned as evidence: "the file exists", "the endpoint is defined", "the docs say".
Also banned: reporting accuracy alone, or a balanced-dataset F1, as duplicate-detection
performance. Always state prevalence alongside precision (§4.3 shows why).

---

## 11. Immediate next actions

1. **Answer D1–D5 in §5.** Nothing in Phase 2 can be finished without them; write them into
   `docs/ml-evaluation-policy.md`.
2. **Run the FPR harness** (`ml-service/evaluate_false_positive_rate.py`, added with this
   handover) and paste its JSON into the Phase 2 report as the current baseline.
3. **Fix the aggregation rule** in `students.controller.js:77-101`: top-1 per registration,
   plus an explicit policy switch for corroboration, and a unit test asserting one flag per
   registration when several candidates exceed the cutoff. Do not change the model yet.
4. **Fix §7 before any deployment**: choose the fate of `beneficiaries`, build `db:init`,
   and add the readiness test. Nothing on Azure will work until this is done.
5. **Delete or quarantine the legacy rule engine** (`duplicateCheck.js:17-24,163-191`) and
   re-point `performance.test.js` at `scoreStudentPairs` — right now the performance test
   benchmarks dead code, so the only performance number in the project describes a path
   nothing uses.
6. **Commit per branch.** Four worktrees; a commit on `fix/sbms-completion-work` does not
   reach `dev`, `-admin-login-fix`, or `sbms-raw-pair-model-training`. Propagate the
   `.gitignore` nested-artifact guard to all branches when merging.

---

## Appendix A — Evidence index

| Claim | Source |
|---|---|
| ML called at registration | `backend/src/controllers/students.controller.js:69` |
| Flag on any pair ≥ threshold | `students.controller.js:77-83,85-92` |
| Compares against all students, `FOR UPDATE` | `students.controller.js:61-67` |
| Batching 200, validation of response | `backend/src/services/mlDuplicateReview.js:4,41-72` |
| Threshold defaults 0.50 / 0.70 / 0.30 | `backend/src/config/settings.js:6-8` |
| Six-feature order | `ml-service/feature_engineering.py:11-18` |
| Payload order matches | `backend/src/services/duplicateCheck.js:201-208` |
| Predictor server loop | `ml-service/predict.py:84-98` |
| Artifact path + hash | `ml-service/predict.py:14`, `model_version()` `:68-70` |
| Legacy rule engine, no production callers | `duplicateCheck.js:17-24,163-191`; tests only |
| Disbursement duplicate guard | `backend/src/controllers/disbursements.controller.js:86-96` |
| Required tables (11) | `backend/src/services/databaseReadiness.js:3-15` |
| `beneficiaries` has no DDL | absent from `schema.sql` and all migrations; used at `beneficiary.model.js:4` |
| Reviewed-decision schema | `backend/src/db/schema.sql:98-106` |
| Stale doc claim | `PROJECT_CONTEXT.md:8` on branch `dev` |

## Appendix B — Reproduction commands

```powershell
# backend unit tests (no live database required, but the Jest guard needs env set)
cd backend
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgres://sbms_test_runner@localhost:5432/sbms_test'
$env:SBMS_TEST_DATABASE_URL = $env:DATABASE_URL
npx jest tests/mlDuplicateReview.test.js tests/duplicateCheck.test.js
# full suite additionally needs a real local sbms_test database

# empirical false-positive harness (read-only; loads the live artifact)
cd ..\ml-service; .\.venv\Scripts\python.exe .\evaluate_false_positive_rate.py

# reviewed-pair evaluation (requires an adjudicated CSV)
cd ml-service; .\.venv\Scripts\python.exe .\evaluate_reviewed_pairs.py C:\approved\reviewed_pairs.csv `
  --model .\model\xgb_duplicate_model.joblib --output .\evaluation\reviewed_pairs_metrics.json
```

## Appendix C — Artifacts and their status

| Artifact | Role | Status |
|---|---|---|
| `ml-service/model/xgb_duplicate_model.joblib` | **live** model (6 features) | in use; synthetic-only training |
| `ml-service/model/rf_duplicate_model.joblib` | historical RF | not loaded by `predict.py` |
| `ml-service/model/research/rf_attachment_style_candidate.joblib` | research candidate | never promoted |
| `ml-service/experiments/sbms_dataset/artifacts/sbms_dataset_xgb_research_only.joblib` | 10-feature research | **must not** be mixed with production |

`.joblib` artifacts are git-ignored (`.gitignore`) — they are not in the repository, so a
fresh clone cannot run screening until the artifact is supplied. Note this for Azure.

---

## 12. Implementation update — 2026-10-30 (later session)

### 12.1 Commits on `fix/sbms-completion-work` (unpushed)

| Commit | Contents |
|---|---|
| `2c2c479` | `chore(deps)`: removed the circular workspace self-references, ignored the nested install artifact |
| `0bc0de0` | `docs`: recorded the completion audit and this handover |
| `ee8503e` | `feat(ml)`: per-pair false-positive-rate harness |
| `46d2777` | `feat(duplicate)`: top-1 registration flag policy, legacy engine quarantined, performance test re-pointed |

`git status` is clean. The branch is still `ahead 4, behind 1` of `origin/dev`; **nothing
has been pushed**, so none of this has reached `dev`, `-admin-login-fix`, or
`sbms-raw-pair-model-training`.

### 12.2 Status of the §11 actions

| §11 action | Status | Evidence |
|---|---|---|
| 1. Answer D1–D5 | **Still blocked** | `docs/ml-evaluation-policy.md` exists as a scaffold and records every decision as *not answered* |
| 2. Run the FPR harness | **Verified** | 2 000 pairs, seed 20261030, artifact `6ec9f2a3…`: 7 / 2 000 = **0.35%** at cutoff 0.50 (0.15% for distinct names only). JSON: `ml-service/evaluation/fpr_baseline_2026-10-30.json`; narrative: `docs/ml-evaluation-baseline-2026-10.md` |
| 3. Fix the aggregation rule | **Implemented and unit-verified**; DB path not exercised | `backend/src/services/duplicateAggregation.js`; `selectFlaggedCandidates()` default `top-1`; 13 tests in `backend/tests/duplicateAggregation.test.js`, including one flag out of three qualifying candidates |
| 4. Fix §7 database bootstrap | **Still blocked** | unchanged: `schema.sql` creates 7 of 11 required tables, `beneficiaries` has no DDL |
| 5. Quarantine legacy rule engine | **Implemented** | `duplicateCheck.js` now has a module header plus `@deprecated` on the rule engine and a grouped export list; `performance.test.js` scores **50 live candidate pairs in 22.67 ms** through `scoreStudentPairs()` |
| 6. Propagate per branch | **Still outstanding** | the toolchain fix and the new work exist only on this branch |

### 12.3 Recorded test evidence

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgres://sbms_test_runner@localhost:5432/sbms_test'
$env:SBMS_TEST_DATABASE_URL = $env:DATABASE_URL
npx jest --runInBand tests/duplicateAggregation.test.js tests/mlDuplicateReview.test.js `
  tests/duplicateCheck.test.js tests/performance.test.js
# 4 suites passed, 33 tests passed, 21.3 s
```

- `duplicateAggregation.test.js` — 13/13 (new)
- `mlDuplicateReview.test.js` + `duplicateCheck.test.js` — 19/19 (unchanged)
- `performance.test.js` — 1/1 against the live artifact: `Screened 50 candidate pairs in 22.67 ms`

The full suite (DB-backed suites included) still requires a local `sbms_test`
database and was not run here.

### 12.4 Behaviour change to communicate before the demo

1. A registration now creates **at most one** duplicate flag by default. Setting
   `DUPLICATE_AGGREGATION_POLICY=all` restores the old one-flag-per-pair behaviour
   for a side-by-side demonstration, and `top-1-corroborated` is available but
   experimentally unvalidated.
2. `POST /api/students` responses gained three additive fields inside
   `duplicate_screening` (`aggregation_policy`, `candidates_considered`,
   `candidates_suppressed`) plus one extra audit-log entry. The frontend was not
   re-checked against them.
3. When only one case can be raised, an exact UPI / birth-certificate / National-ID
   match now outranks a higher model score. This is deliberate: an exact
   identifier is stronger evidence than a synthetic-data score.

### 12.5 What this update does not prove

- No integration test of the new controller path against a database (no local
  `sbms_test` instance in this session); only the pure selection logic is covered.
- No frontend verification of the new response fields.
- No accuracy, precision, recall, or miss-rate claim: there is still no
  adjudicated pair set, so D5 remains the gate on every such claim.
- Nothing has been deployed or provisioned on Azure.

