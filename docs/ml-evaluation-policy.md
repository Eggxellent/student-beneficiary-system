# ML evaluation and duplicate-review policy

**Status: decisions D1–D5 are NOT ANSWERED.** This file is the agreed place to
record them (`docs/SBMS_PROJECT_HANDOVER_2026-10.md` §5 and §11). It currently
records only what is *implemented* and *measured*; it does not invent owner
answers. Anything marked "proposed" below is a recommendation from the handover,
not a decision.

Why the distinction matters: every one of these choices changes how many real
duplicate cases are missed or how much review work is created. An engineer cannot
choose them from the code, and picking silently would make the evaluation
unfalsifiable.

## 1. Decisions to record

Fill the "Owner answer" column, then set the "Recorded by / date" column. Do not
tune the threshold or switch aggregation policy before D1–D3 have answers.

| ID | Question | Why it matters | Proposed default (handover) | Owner answer | Recorded by / date |
| --- | --- | --- | --- | --- | --- |
| **D1** | **Flag budget:** how many duplicate cases per registration may reach an administrator? | Determines the aggregation rule. | 1 case per registration | _not answered_ | |
| **D2** | **Review capacity:** how many cases per week can realistically be adjudicated? | Sets the operating point and therefore the cutoff. | State a number | _not answered_ | |
| **D3** | **Miss tolerance:** what fraction of true duplicates may be missed? | Sets the recall floor, which constrains precision. | e.g. miss ≤ 20% | _not answered_ | |
| **D4** | **Cross-school comparison:** should a student be compared against other schools? | If schools are distinct catchments, blocking by school cuts `N` by ~5× with little loss. | Block by school | _not answered_ | |
| **D5** | **Adjudication owner:** who reviews the first 200–300 pairs to create ground truth? | Without reviewed labels there is no real evaluation (see §4). | Named reviewer + data-protection rule | _not answered_ | |

## 2. Where each answer lands in the system

| Decision | Configuration / code | Current state |
| --- | --- | --- |
| D1 | `DUPLICATE_AGGREGATION_POLICY` in `backend/.env`; `backend/src/services/duplicateAggregation.js` | Implemented and tested. Default `top-1` (≤ 1 flag per registration). `all` = legacy, `top-1-corroborated` = experimental |
| D2 | `ML_REVIEW_SCORE_THRESHOLD` (default `0.50`); `backend/src/config/settings.js` | Cutoff is configurable; value is **not validated** against reviewed data |
| D3 | Same cutoff; reported as miss rate / recall in the Phase 2 report | Not measured — no adjudicated pairs |
| D4 | Candidate query in `backend/src/controllers/students.controller.js` (`FROM students` with no school filter) and the O(N²) scan | Compares against **all** schools. Blocking is **not implemented** |
| D5 | `ml-service/evaluation/reviewed_pairs_template.csv` → adjudicated copy | Template exists; no adjudicated rows. Handover §6 defines the review protocol |

## 3. What is implemented right now (measured, not proposed)

- **Aggregation (D1):** `selectFlaggedCandidates()` in
  `backend/src/services/duplicateAggregation.js`. Default `top-1`: at most one
  flag per registration, ranking exact identifier agreement above model score;
  deterministic tie-break by comparison order. Covered by
  `backend/tests/duplicateAggregation.test.js` (13 tests), including
  "creates only one flag when several candidates exceed the cutoff".
- **Auditability:** each registration writes `duplicate_aggregation_policy`,
  `duplicate_candidates_considered`, `duplicate_candidates_qualifying`,
  `duplicate_candidates_suppressed`, and `duplicate_flags_created` to the audit
  log, and returns `aggregation_policy`, `candidates_considered`, and
  `candidates_suppressed` in `duplicate_screening`.
- **Per-pair baseline:** 0.35% of 2 000 synthetic unrelated pairs score ≥ 0.50
  (`docs/ml-evaluation-baseline-2026-10.md`). This is a queue-volume input, **not**
  an accuracy claim.
- **Screening latency:** 50 candidate pairs scored in 22.67 ms on the development
  machine (`backend/tests/performance.test.js`, live artifact, warm predictor).

## 4. What remains blocked

| Blocked item | Blocked by |
| --- | --- |
| Choosing the production cutoff on evidence | D1, D2, D3, D5 |
| Precision / recall / F1 / PR-AUC / confusion matrix | D5 (no adjudicated labels) |
| Deciding whether `top-1-corroborated` is safe to adopt | D3 + D5 + comparison on adjudicated pairs |
| School-blocking optimisation (cuts `N`, changes D4 semantics) | D4 |
| Any claim that the system "detects duplicates accurately" | D5 — cannot be supported today |

## 5. Change log

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-30 | Created as a scaffold; D1–D5 recorded as unanswered | this file |
| 2026-10-30 | Aggregation policy implemented with `top-1` default | `backend/src/services/duplicateAggregation.js`, `backend/tests/duplicateAggregation.test.js` |
| 2026-10-30 | Per-pair baseline measured | `docs/ml-evaluation-baseline-2026-10.md` |

When a decision is answered, append the answer, the date, the owner, and the
concrete configuration change in the same commit as the change.
