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


## 13. Implementation update — 2026-10-30 (database and end-to-end verification)

### 13.1 Commits on `fix/sbms-completion-work`

| Commit | Contents |
|---|---|
| `cd4ff0e` | `fix(db)`: schema parity, readiness-verified bootstrap, `PUBLIC_APP_URL` boot check, DOB normalisation, test-database provisioning |
| `c9ccc45` | merge of `origin/dev` (`78d1a87`, the admin-bootstrap email regex fix; conflict resolved in favour of this branch's stricter validation, which already carried the regex fix) |

`git status` is clean and the branch is **9 ahead, 0 behind** `origin/dev`. Nothing has
been pushed; no deployment has happened.

### 13.2 The §7 bootstrap blocker is closed

Root cause, confirmed empirically: `schema.sql` created **10 of the 11** tables that
`GET /api/ready` requires, and `beneficiaries` had no DDL anywhere in the repository.
A from-scratch bootstrap therefore reported success while returning `503` from
`/api/ready`, and every model query touching `beneficiaries` failed with `42P01`.

Fixes:

1. `backend/src/db/schema.sql` — `beneficiaries` DDL added, shape measured from the
   live deployment (serial integer primary key, no foreign keys, so it cannot couple
   to the UUID-keyed tables).
2. `backend/src/db/migrations/20261025_legacy_beneficiaries_baseline.sql` — idempotent
   baseline for databases created before the DDL existed; registered in
   `MIGRATION_ORDER`.
3. `backend/scripts/bootstrap-production-schema.js` — runs `checkDatabaseReadiness`
   **inside** the transaction and rolls back instead of committing an unusable schema.
4. `backend/test/databaseBootstrap.node.test.js` — the fake client now answers the
   readiness query, plus a new regression case proving bootstrap refuses to commit a
   schema with a missing table.

Evidence: a database built only from `schema.sql` + registered migrations now returns
`GET /api/ready` → `200 {"status":"ready"}`, and all 11 required tables resolve in
`public`.

### 13.3 Second defect: date-of-birth skew in the model features

`pg` returns `DATE` as a JS `Date` at local midnight; JSON serialisation to the
predictor converted it to UTC and shifted the calendar day for any UTC+ offset, so two
identical dates scored `dob_match: 0`. Fixed at the single predictor boundary in
`backend/src/services/mlDuplicateReview.js` (`dateOnly` / `predictorRecord`). Live proof
over HTTP: identical-DOB pair → `dob_match: 1`, `probability 0.9982`.

### 13.4 Third defect: registration could fail with a per-request 500

`PUBLIC_APP_URL` was only read when a registration was submitted. It is now resolved at
boot (`backend/src/index.js`), so a missing or unusable origin stops startup instead of
breaking one request. `backend/tests/testEnvironment.js` supplies a fixture origin for
the Jest suite and is wired first in `jest.config.js` `setupFiles`.

### 13.5 Local environment prerequisites (why "the code works" hid these bugs)

`backend/.env` must now contain, in addition to `DATABASE_URL` and `JWT_SECRET`:

```dotenv
NODE_ENV=development
PUBLIC_APP_URL=http://localhost:3000
SBMS_EXPECTED_DATABASE_NAME=student_beneficiary_system
```

Without the last three, `src/index.js` exits with "Startup blocked" (missing expected
database name) or registration refuses to build a QR origin. Loopback HTTP is only
accepted when `NODE_ENV=development`; production requires a public HTTPS origin.

New script: `npm run db:provision-test` (`backend/scripts/provision-test-database.js`)
creates the loopback-only `sbms_test` database and `sbms_test_runner` role from a
password supplied in the environment. It writes nothing into the repository; the
generated `.env.test` is git-ignored.

### 13.6 Test evidence from this session

- `npx jest --runInBand tests` against a real local `sbms_test`: **19 suites, 103 tests
  passed**.
- `node --test` over the six native suites with the API running: **35 passed, 0 failed**
  (previously 30 passed / 4 failed — one genuine regression caused by the new readiness
  check, three smoke tests that need a live server).
- Live end-to-end run on `sbms_test` through real HTTP and the real XGBoost child
  process (`xgboost:6ec9f2a3…`, threshold 0.50, policy `top-1`):

| Step | Result |
|---|---|
| 1. field-officer and admin logins | `200` / `200` |
| 2. first registration | `201`, `candidates_considered: 0`, 0 flags |
| 3. identical re-registration | `201`, **1 flag**, `probability 0.9982`, `dob_match 1`, exact UPI + birth certificate + National ID reason |
| 4. admin queue `GET /api/duplicate-flags?status=pending` | `200`, case present, `high_priority_pending: 1` |
| 5. `PATCH /api/duplicate-flags/:id` → `confirmed_duplicate` | `200` |
| 6. persistence | 1 `duplicate_review_events` row, audit action `DUPLICATE_CONFIRMED_DUPLICATE`, flag status persisted |
| 7. cleanup | probe students, flags, audit rows and the probe officer removed; `sbms_test` back to 0 students / 0 flags |

- `frontend`: `npm run build` succeeds (only the pre-existing >500 kB chunk warning).

### 13.7 Local development database remediated

`student_beneficiary_system` was missing `bursary_awards`,
`bursary_award_verification_events` and `disbursement_reconciliation_events`, so the
application could not start against it either. The idempotent
`20261023_bursary_award_reconciliation.sql` was applied in a single transaction
(0 existing disbursement rows, so the added constraints could not be violated);
`missing_tables` is now `[]`.

### 13.8 Known gaps carried forward

- `frontend/src/pages/StudentRegistration.jsx` styles a case as red when
  `risk_level === 'critical'`, but the API only ever emits `'review'`, so that branch is
  unreachable. Either the API publishes a severity or the branch is removed — a product
  decision, not a bug fix.
- The new `duplicate_screening` fields (`model_version`, `review_threshold`,
  `aggregation_policy`, `candidates_considered`, `candidates_suppressed`) are still not
  surfaced in the UI.
- D1–D5 remain unanswered, so no accuracy, precision, recall or miss-rate claim is
  supported.
- Nothing is pushed to `origin`, and no Azure resource has been provisioned.

## 14. Overfitting audit - 2026-10-30

The §4.2 baseline, the §12.2 holdout F1, and the 0.50 review cutoff all assume the model
was trained on one dataset and judged on another. That assumption is now tested, not
asserted. Full evidence: `docs/ml-training-integrity-2026-10-30.md`; harness
`ml-service/check_training_integrity.py`; raw output
`ml-service/evaluation/training_integrity_report.json`.

| Check | Result |
| --- | --- |
| Artifact, training file and holdout hashes vs the metrics report | all three match |
| Shared pair groups / person identities / identical rows across splits | 0 / 0 / 0 |
| In-sample F1 vs holdout F1 | 0.9196 vs 0.9063 (+0.0133) |
| 5-fold grouped CV (inside the training file) vs holdout F1 | 0.9067 vs 0.9063 |
| Holdout F1 at 10% / 25% / 50% / 100% of training groups | 0.8886 / 0.8989 / 0.9010 / 0.9063 |
| Strongest single feature (holdout AUC) | `jaro_winkler` 0.710 (no shortcut) |
| Training calls in the serving path or the backend | none |

**Conclusion: no evidence of overfitting, and no evaluation on training data.** The
model's in-sample advantage is 1.3 points of F1, grouped CV reproduces the holdout score
to four decimal places, and the learning curve is nearly flat at one tenth of the data.

Two caveats stand: the holdout also informed the XGBoost-versus-Random-Forest choice
(recorded as `holdout_used_for_model_selection: true`), so the number is
selection-optimistic at the margin; and all data is synthetic. A final unbiased figure
still requires adjudicated real pairs (D1/D5).

The artifact was **not** retrained: hash unchanged at `6ec9f2a3...`, so the deployed model
and the 0.50 cutoff are untouched by this audit.

Enforcement: `ml-service/tests/test_training_integrity.py`, 9 tests, part of the 19-test
ml-service suite (`python -m unittest discover -s tests`, 1.8 s).

## 15. Phase 1 - Git synchronization, 2026-10-30

### 15.1 What was pushed

| Item | Value |
| --- | --- |
| Feature head | `d3325e0a2c01e63506c777bc9c4d84a38719e3f4` (`fix/sbms-completion-work`) |
| Base before merge | `78d1a8790d4664fbab56f12a7c4cfb4606f3aea0` (`origin/dev`) |
| Pull request | **#12**, 11 commits, 48 files, +3 804 / -237 |
| Merge commit | `f3d5a30365e033f572b9537e3d721d632dcc0086` (`origin/dev`) |
| `origin/main` | `d4f546bd1c9267629465da8e3c3c7f4bf2e3b751` - **unchanged** |

Merged with a merge commit, no squash and no force-push, so the 11 individual commits and
the earlier `origin/dev` merge stay in the history. The feature branch was left in place
because Phase 2-8 work continues on it.

Not touched: local branch `dev` (worktree `student-beneficiary-system-dev`, 1 ahead /
10 behind and carrying 6 uncommitted files), `fix/sbms-production-readiness`
(worktree `student-beneficiary-system-admin-login-fix`), `experiment/raw-pair-model-training`
(worktree `sbms-raw-pair-model-training`, 6 uncommitted files), `ml-experiments`, and
`experiment/febrl-record-linkage`. Those dirty worktrees are pre-existing; nothing was
stashed, reset or cleaned.

### 15.2 Verification evidence at `d3325e0`

Run before merging, because this PR has **no automated CI**: `.github/workflows/deployment-build.yml`
exists only on branch `codex/render-deployment`. It is absent from `main`, `dev` and this
branch, so GitHub reported `check-runs total=0`. Neither `dev` nor `main` has branch
protection (the protection API returns 404 for both), so "keep `main` stable" depends on
process, not on settings. Moving that workflow to `dev`/`main` is worth doing before Azure.

| Check | Result |
| --- | --- |
| `npm test` (backend, all 19 suites) | **19 suites, 103 tests passed** |
| `node --test` (5 non-HTTP native suites) | **32 passed** |
| `npm run test:smoke` (against a live API) | **3 passed** |
| ml-service `unittest discover` | **19 passed** |
| `check_training_integrity.py` | `verdict: pass` |
| `npm run build` (frontend) | built in 10.54 s |
| `GET /api/health` / `GET /api/ready` | 200 / 200 `{"status":"ready"}` |

### 15.3 The environment recipe (previously undocumented, and it matters)

A first attempt at `npm test` reported **6 failed suites / 34 failed tests**. That was not
a regression: the six failures were exactly the database-backed suites, and the cause was
a wrong connection string (`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a
string`). The Jest guard only validates the *shape* of the URL, so it lets a password-less
URL through and PostgreSQL rejects it later. Two traps:

- `backend/.env.test` is **not** auto-loaded. Neither `tests/testEnvironment.js` nor the
  guard reads it; only `PUBLIC_APP_URL` is defaulted in code.
- A live API pointed at `sbms_test` also needs `SBMS_EXPECTED_DATABASE_NAME=sbms_test`,
  otherwise `assertAuthenticationSchemaReady()` aborts startup with "Startup blocked".

Working recipe (values are read from `.env.test`, never echoed):

```powershell
cd backend
$vars = @{}
Get-Content .env.test | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $vars[$matches[1]] = $matches[2].Trim().Trim('"') }
}
foreach ($k in @('NODE_ENV', 'DATABASE_URL', 'SBMS_TEST_DATABASE_URL')) { Set-Item "Env:$k" $vars[$k] }
npm test                      # 19 suites / 103 tests

# live HTTP smoke test (separate shell, API bound to the test database)
$env:SBMS_EXPECTED_DATABASE_NAME = 'sbms_test'
$env:PUBLIC_APP_URL = 'https://sbms-test-fixture.ac.ke'
$env:PORT = '5000'
node src/index.js             # then, in the first shell:
$env:API_URL = 'http://localhost:5000'
npm run test:smoke            # 3 tests
```

State of `sbms_test` used for this run: 12 public tables, 2 active admin accounts
(`admin@sbms.com`, `bootstrap-admin@example.invalid`), 0 students, 0 duplicate flags,
0 disbursements - the suites clean up after themselves.

### 15.4 Findings for the owner

1. **No CI runs on this repository's PRs.** Action: relocate
   `.github/workflows/deployment-build.yml` from `codex/render-deployment` onto `dev`.
2. **No branch protection** on `dev` or `main`. Recommend requiring the build workflow
   once it is on `dev`, so `main` stability is enforced rather than remembered.
3. **Draft PR #8** (`codex/render-deployment` -> `dev`, "Prepare SBMS for Render
   deployment") is still open and predates the switch to Azure. It should be closed or
   re-scoped, but that is the owner's call and it was not touched.
4. The local `dev` worktree and two sibling worktrees carry uncommitted changes. They are
   untouched; someone should decide whether those edits are still wanted.

## 16. Phase 2 - ML decision evidence, 2026-10-30

Nothing was retrained. The artifact is still `sha256 6ec9f2a3cbe6ed0d…` and the cutoff is
still `0.50`; no configuration was changed to match any recommendation.

### 16.1 What was added

| File | Purpose |
| --- | --- |
| `ml-service/evaluate_operating_point.py` | Read-only harness: scores the labelled holdout through the serving feature path, then reports pair-level metrics, per-scenario flag rates, a registration-level `top-1` simulation, corroboration variants and a blocking projection |
| `ml-service/evaluation/operating_point_2026-10-30.json` | Raw output (provenance, all cutoffs, all registry sizes, limitations) |
| `ml-service/tests/test_operating_point.py` | 14 tests: confusion-matrix arithmetic, cutoff inclusivity, `top-1` masking, reproducibility, blocking retention, and guards that the committed report describes the live artifact and still reproduces `realistic_pairs_xgboost_training_metrics.json` |
| `docs/ml-decision-sheet-2026-10-30.md` | Evidence + recommended default for D1–D5, still unanswered |
| `docs/ml-evaluation-policy.md` | §4 update, new §5 evidence table, change-log rows; owner answers deliberately left blank |

### 16.2 What it measured (synthetic labels only)

| Quantity | Result |
| --- | --- |
| Holdout pairs / groups | 12 000 / 6 000 (6 000 positives, 6 000 hard negatives) |
| Ranking | ROC-AUC 0.9685, PR-AUC 0.9727 (baseline 0.5) |
| F1 at live cutoff 0.50 | 0.9063 - reproduces the stored metrics exactly |
| Feature path | identical to serving, `max_abs_difference = 0` |
| Miss rate | 6.48% (0.30) / 10.73% (0.50) / 17.30% (0.70) / 29.63% (0.90) |
| Best F1 cutoff | 0.35 at 0.9065 - only 0.0002 above the live 0.50 |
| Truly unrelated negatives | **0.00%** flagged at 0.50 - no noise flags |
| Worst negative family | `identifier_collision`, 22.21% at 0.50 |
| Registration nuisance (whole registry, `top-1`, 0.50) | 97% of legitimate registrations at N=1 000 even with random-pair negatives |
| `top-1` masking | 23.8% (N=100) to 52.6% (N=5 000) of detections attributed to the wrong candidate |
| School as a filter | would discard ~72% of duplicates (only 27.65% share a school code) |
| Blocking retention | surname+school 16.47%; any-name-token 80.52% |
| `top-1-corroborated` | removes 34–54% of nuisance flags but loses 39–60% of duplicates - **not recommended** |

### 16.3 Adjudicated ground truth

None exists. `evaluation/reviewed_pairs_template.csv` is header-only, and read-only queries
against both `sbms_test` and `student_beneficiary_system` returned 0 students, 0 duplicate
flags and 0 `duplicate_review_events`. So no precision/recall/miss-rate claim about real
beneficiaries is possible, and none is made. D5 remains the blocking decision.

### 16.4 Commands

```powershell
cd ml-service
.\.venv\Scripts\python.exe .\evaluate_operating_point.py              # ~25 s
.\.venv\Scripts\python.exe -m unittest tests.test_operating_point -v   # 14 tests
.\.venv\Scripts\python.exe -m unittest discover -s tests               # 33 tests
```

### 16.5 Evidence-file hardening

Both harnesses could silently overwrite their own committed evidence with a reduced run,
which happened once during this phase. Both now refuse:

- `evaluate_operating_point.py` requires an explicit `--output` when `--cutoffs`,
  `--registry-sizes`, `--simulations` or `--negatives` differ from the defaults.
- `check_training_integrity.py --fast` requires an explicit `--output`, because fast mode
  omits the grouped CV and the learning curve.

A full re-run of the integrity audit now reproduces `training_integrity_report.json`
byte-for-byte, so `git status` stays clean after an audit.

## 17. Phase 3 - Frontend completion, 2026-10-30

No model, cutoff or aggregation setting changed. Full narrative:
`docs/frontend-verification-2026-10-30.md`.

### 17.1 The `critical`/`review` contract

- `risk_level` stays `'review'` for every case. The API never calls a record a duplicate, and
  the UI no longer pretends otherwise.
- Severity is now published: `priority` (`high`/`standard`) plus `exact_identifier_matches`,
  both on the registration flag.
- `reviewPriority()` in `backend/src/services/mlDuplicateReview.js` is the single rule used by
  the registration response **and** the admin queue, so the two cannot disagree.
- The frontend colours red only for exact identifier agreement, amber for other review cases,
  green when nothing is flagged.

### 17.2 Two defects found while fixing it

1. The queue treated `score >= review_threshold` (0.50) as high priority, so every model case
   was `high` and `DUPLICATE_HIGH_PRIORITY_THRESHOLD` (0.70) was never used.
2. The queue policy published `high_priority_threshold: null`, which the admin screen
   rendered as **"high 0.00"**. It now publishes the real value and keeps
   `thresholds_validated: false`.

### 17.3 Where screening information is surfaced

`/students/register` is field-officer-only, so an admin panel there would have been another
unreachable branch. Instead: the officer sees plain-language counts with no model internals;
the administrator sees priority, score, model version, cutoffs and aggregation policy on the
review screen, and the stored counters (considered / qualifying / suppressed) as readable
text in the audit log.

### 17.4 Files changed

| File | Change |
| --- | --- |
| `backend/src/services/mlDuplicateReview.js` | new `reviewPriority()` |
| `backend/src/controllers/students.controller.js` | flag `priority` + `exact_identifier_matches`; screening `candidates_qualifying`, `high_priority_threshold`, `thresholds_validated` |
| `backend/src/controllers/duplicateFlags.controller.js` | shared priority rule; real `high_priority_threshold`; `aggregation_policy` in the queue policy |
| `backend/tests/students.test.js` | asserts the new contract fields |
| `backend/tests/mlDuplicateReview.test.js` | 4 tests for `reviewPriority()` |
| `frontend/src/pages/StudentRegistration.jsx` | unreachable `critical` branch replaced; plain-language screening sentence |
| `frontend/src/pages/DuplicateReview.jsx` | policy line shows both cutoffs, aggregation policy, null-safe formatting |
| `frontend/src/pages/AuditLogs.jsx` | details rendered as `key: value` instead of raw JSON |
| `scripts/browser-smoke.mjs` | **new** 23-check real-browser suite |
| `backend/scripts/seed-verification-accounts.js` | **new** env-driven, loopback-only account seeding |
| `package.json`, `backend/package.json` | `smoke:browser`, `seed:verification` |

### 17.5 Evidence

| Check | Result |
| --- | --- |
| Backend Jest (all suites) | **19 suites, 107 tests passed** (was 103) |
| `npm run smoke:browser` (headless Chrome) | **23/23 checks passed**, exit 0 |
| Frontend production build | success |

### 17.6 Remaining gaps

- No visual or accessibility regression testing; the browser checks assert rendered text,
  classes and navigation.
- Priority banding relies on an unvalidated cutoff and changes presentation order only.
- QR camera, disbursement restrictions and the full workflow are Phases 4-5.

## 18. Phase 4 - QR verification, 2026-10-30

Full narrative: `docs/qr-verification-2026-10-30.md`. No model or cutoff changed.

### 18.1 Findings

1. **Stale verification result (fixed).** The public page verified once on mount, so a second
   code opened in the same tab (hash-only navigation) kept showing the previous answer — a
   valid code followed by an invalid one still read "Record found". It now re-verifies on
   `hashchange`.
2. **StrictMode double-invoke (fixed).** Development runs effects twice; re-reading the hash
   inside the effect made the second pass report "invalid". The token is captured during
   render instead. A compile-only check would have shipped both defects.
3. **Rate limiting behind a proxy (hook added).** The limiter keyed on the socket address, so
   behind Azure every public user would share one bucket of 10 per 15 minutes. `TRUST_PROXY_HOPS`
   now sets Express `trust proxy`; default 0 keeps current behaviour, forwarded headers are
   never trusted unless set.
4. **Camera test blocked by design.** `publicAppUrl.js` accepts only public HTTPS (or loopback
   in development), so a LAN address cannot be used. The scan must happen against the Azure
   deployment or an HTTPS tunnel. Measured: localhost/127.0.0.1 accepted in development, LAN
   addresses rejected, `https://…` accepted in production, `http://…` rejected in production.

### 18.2 Files changed

| File | Change |
| --- | --- |
| `backend/tests/verification.test.js` | **new** 10 route-level tests including the QR payload proof and rate limiting |
| `backend/src/middleware/verificationRateLimit.js` | key on `req.ip` |
| `backend/src/index.js` | `TRUST_PROXY_HOPS` hook (default off) |
| `frontend/src/pages/Verification.jsx` | re-verify on hash change; token captured at render |
| `scripts/qr-smoke.mjs` | **new** 9-check browser suite |
| `docs/qr-verification-2026-10-30.md` | **new** evidence, blocker, camera checklist |

### 18.3 Evidence

| Check | Result |
| --- | --- |
| Backend Jest (all suites) | 20 suites, 117 tests passed |
| `node scripts/qr-smoke.mjs` (headless Chrome) | **9/9 passed**, exit 0 |
| Frontend production build | success |

### 18.4 Remaining gaps

- The phone-camera step is manual and needs a public HTTPS origin (Phase 6).
- No token expiry, revocation or re-issue path.
- The rate limiter is in-process, so it is not shared across instances.

## 19. Phase 5 - Business workflow, 2026-10-30

Full narrative: `docs/business-workflow-verification-2026-10-30.md`. No model or cutoff changed.

### 19.1 Production defect found and fixed

`PATCH /api/disbursements/:id/payment-status` returned **500 for every call**. PostgreSQL raised
`42P08 inconsistent types deduced for parameter $1` because the statement reused `$1` as both
`payment_status VARCHAR(20)` and `status VARCHAR(50)`, plus a text comparison. **Payment
clearance had never worked**, which also made every downstream reconciliation figure
unreachable. Fixed with explicit casts and a comment explaining why they must stay.

Finding it took a direct constraint probe: the sanitised error handler only said "Internal
server error", and the obvious suspect (the `disbursements_clearance_fields_check` requiring
`cleared_by`) turned out to pass with a real user id.

### 19.2 What the new suite proves

`backend/tests/workflow.test.js` (11 tests, new) drives the real app against the real test
database: registration → review case → verification → **two independent duplicate gates** (award
approval and disbursement) → approval → disbursement → clearance → acknowledgement → audit
trail → role boundaries. Confirmed duplicates stay unpayable and cannot be re-decided;
`needs_verification` blocks until cleared; over-disbursement is refused; short payment
acknowledgement is recorded as `discrepancy`.

### 19.3 Files changed

| File | Change |
| --- | --- |
| `backend/src/controllers/disbursements.controller.js` | fixed the `42P08` parameter typing |
| `backend/tests/workflow.test.js` | **new** 11-test end-to-end workflow suite |
| `docs/business-workflow-verification-2026-10-30.md` | **new** evidence, defect analysis, gaps |
| `backend/tests/testEnvironment.js` | per-file limiter reset (added in Phase 4, used here) |

### 19.4 Evidence

| Check | Result |
| --- | --- |
| Backend Jest (all suites) | **21 suites, 128 tests passed** (was 117) |
| Frontend production build | success |
| `sbms_test` after the run | 0 students, 0 duplicate flags, 0 disbursements |

### 19.5 Behaviour worth knowing

- A **confirmed duplicate is terminal**: it cannot be reversed through the API, by design.
- `/api/disbursements/exceptions` returns `deadline_days: null` unless
  `ACKNOWLEDGEMENT_OVERDUE_DAYS` is set; it does not invent a deadline.
- Registration is never blocked by a duplicate; no automatic rejection or deletion exists.





