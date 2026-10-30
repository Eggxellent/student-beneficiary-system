# ML evaluation and duplicate-review policy

**Status: decisions D1–D5 are NOT ANSWERED.** This file is the agreed place to
record them (`docs/SBMS_PROJECT_HANDOVER_2026-10.md` §5 and §11). It currently
records only what is *implemented* and *measured*; it does not invent owner
answers. Anything marked "proposed" below is a recommendation from the handover,
not a decision.

**Evidence for each decision is now measured**, on synthetic labels only, in
[`docs/ml-decision-sheet-2026-10-30.md`](ml-decision-sheet-2026-10-30.md) (§5 below
summarises it). The owner answers are still blank, and no configuration has been
changed to match any recommendation.

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
| D1 | `DUPLICATE_AGGREGATION_POLICY` in `backend/.env`; `backend/src/services/duplicateAggregation.js` | Implemented and tested. Default `top-1` (≤ 1 flag per registration). `all` = legacy, `top-1-corroborated` = experimental. The admin re-scan endpoint is intentionally excluded (it enumerates pairs and skips known ones) |
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

Update — 30 October 2026: the *synthetic* versions of two blocked rows now exist and are
recorded in `docs/ml-decision-sheet-2026-10-30.md`: pair-level precision/recall/F1/PR-AUC
(ROC-AUC 0.9685, PR-AUC 0.9727, F1 0.9063 at 0.50) and a registration-level simulation.
`top-1-corroborated` was measured and is **not recommended**: it removes 34–54% of nuisance
flags at the cost of 39–60% of true duplicates. None of this is an accuracy claim, and
D5 still blocks the real evaluation.

## 5. Evidence available for each decision (synthetic labels only)

Source: `ml-service/evaluate_operating_point.py`, output
`ml-service/evaluation/operating_point_2026-10-30.json`, narrative
`docs/ml-decision-sheet-2026-10-30.md`. Artifact `6ec9f2a3…`, cutoff 0.50 unchanged.

| Decision | What is now measured | What is still missing |
| --- | --- | --- |
| D1 | `top-1` masks the true duplicate behind a nuisance candidate in 23.8% (N=100) to 52.6% (N=5 000) of detections | Whether the owner prefers bounded masking (top-3) or bounded queue (top-1) |
| D2 | Cases per 200 registrations, whole registry at N=1 000: ~194–200; with name-token blocking at 0.70: 6–128 | The owner's actual weekly review capacity |
| D3 | Synthetic miss rate 6.48% (0.30) / 10.73% (0.50) / 17.30% (0.70) / 29.63% (0.90) | The acceptable miss rate, and labels for duplicate patterns other than `repeat_application` |
| D4 | School filtering would discard ~72% of duplicates (27.65% share a school code); surname+school blocking retains 16.47%, any-name-token blocking retains 80.52% | The owner's approval to change candidate selection |
| D5 | 0 adjudicated pairs in the repository and 0 in both databases; a review protocol is proposed in the decision sheet | The reviewer's name(s) and the data-protection basis |

## 6. Change log

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-30 | Created as a scaffold; D1–D5 recorded as unanswered | this file |
| 2026-10-30 | Aggregation policy implemented with `top-1` default | `backend/src/services/duplicateAggregation.js`, `backend/tests/duplicateAggregation.test.js` |
| 2026-10-30 | Per-pair baseline measured | `docs/ml-evaluation-baseline-2026-10.md` |
| 2026-10-30 | Operating-point evidence measured: pair-level metrics, registration-level simulation, blocking projection. D1–D5 remain unanswered | `docs/ml-decision-sheet-2026-10-30.md`, `ml-service/evaluation/operating_point_2026-10-30.json` |
| 2026-10-30 | `top-1-corroborated` measured and **not recommended**: removes 34–54% of nuisance flags but loses 39–60% of true duplicates | decision sheet §5 |
| 2026-10-30 | 14 tests added that fail if the report stops describing the live artifact or the simulation arithmetic drifts | `ml-service/tests/test_operating_point.py` |

When a decision is answered, append the answer, the date, the owner, and the
concrete configuration change in the same commit as the change.
