# ML operating-point evidence and decision sheet — 30 October 2026

**Status: D1–D5 are still NOT ANSWERED.** This document supplies the evidence and a
recommended default for each decision. Every recommendation is marked as such; nothing
here is a decision, and no owner answer has been invented. Nothing was retrained, and
neither the artifact nor the 0.50 cutoff was changed.

| Item | Value |
| --- | --- |
| Artifact analysed | `ml-service/model/xgb_duplicate_model.joblib`, `sha256 6ec9f2a3cbe6ed0d…` (unchanged) |
| Cutoff in production | `0.50` (unchanged) |
| Harness | `ml-service/evaluate_operating_point.py` (read-only; never fits, never saves) |
| Raw output | `ml-service/evaluation/operating_point_2026-10-30.json` |
| Labels used | synthetic only — **0 adjudicated pairs exist** |
| Reproduce | `python evaluate_operating_point.py` from `ml-service` (seed 20261030) |
| Tests | 14 in `ml-service/tests/test_operating_point.py`; 33 total in the service suite |

Reproducing the report on the holdout gives F1 `0.9063` at cutoff 0.50, identical to
`realistic_pairs_xgboost_training_metrics.json` (`selected_model_holdout_metrics`), and the
serving feature path reproduced the generator's stored feature columns exactly
(`feature_consistency.exact_match = true`). The numbers below therefore describe the model
the API actually runs, scored the way the API scores it.

## 1. Pair-level performance (synthetic holdout, 12 000 pairs / 6 000 groups)

Positives are `repeat_application` cases (6 000). Negatives are deliberately hard
(6 000): siblings, twins/close ages, identifier collisions, common names, unrelated.

| Cutoff | Precision | Recall | F1 | Miss rate | FPR (hard negatives) | Review share |
| --- | --- | --- | --- | --- | --- | --- |
| 0.30 | 0.8694 | 0.9352 | 0.9011 | 6.48% | 14.05% | 53.78% |
| 0.40 | 0.8985 | 0.9132 | 0.9058 | 8.68% | 10.32% | 50.82% |
| **0.50 (live)** | **0.9204** | **0.8927** | **0.9063** | **10.73%** | **7.72%** | **48.49%** |
| 0.60 | 0.9404 | 0.8647 | 0.9009 | 13.53% | 5.48% | 45.97% |
| 0.70 | 0.9607 | 0.8270 | 0.8888 | 17.30% | 3.38% | 43.04% |
| 0.80 | 0.9791 | 0.7797 | 0.8681 | 22.03% | 1.67% | 39.82% |
| 0.90 | 0.9899 | 0.7037 | 0.8226 | 29.63% | 0.72% | 35.54% |

Ranking quality: **ROC-AUC 0.9685**, **PR-AUC 0.9727** (baseline 0.5).

What this says: F1 is essentially flat between 0.30 and 0.60 (0.9011–0.9065), so **no
cutoff in that band is defensible over another on this data**. The best F1 is 0.9065 at
0.35; the live 0.50 scores 0.9063, i.e. 0.0002 lower, and has the highest Youden J
(0.8155). There is no evidence here that justifies moving the production cutoff.

What this does not say: the FPR column is measured on a negative set that is *enriched*
with confusable cases (25% siblings, 19% twins, 20% identifier collisions). It is not the
false-positive rate of the applicant population, and the 0.35% figure from
`docs/ml-evaluation-baseline-2026-10.md` (random unrelated pairs) is not interchangeable
with it. Report both or neither.

## 2. Why the pair-level numbers do not answer the workload question

Registration compares one new record against **every** existing student, so the quantity
that matters for an administrator is not the pair-level rate but

`P(at least one nuisance flag per legitimate registration) = 1 − (1 − p)^N`

with `p` the per-pair false-positive rate and `N` the registry size. Simulated with the
`top-1` policy (2 000 registrations per cell), at cutoff 0.50:

| Registry size | Nuisance flags per 1 000 legitimate registrations (hard negatives) | … (random unrelated pairs) |
| --- | --- | --- |
| 100 | 1 000 | 293 |
| 500 | 1 000 | 820 |
| 1 000 | 1 000 | 970 |
| 5 000 | 1 000 | 1 000 |

At cutoff 0.90 the random-unrelated column collapses to 0/1 000 for every registry size,
but the hard-negative column stays at 502 (N=100) / 972 (N=500) / 999 (N=1 000) / 1 000
(N=5 000). **Raising the cutoff cannot fix queue volume while the comparison set is the
whole registry**, because the miss rate falls off far faster than the queue does
(recall 0.8927 → 0.7037 between 0.50 and 0.90).

This simulation reproduces the arithmetic already in
`docs/ml-evaluation-baseline-2026-10.md` §3, which is a good sign for both: with
`p = 0.0035` and `N = 1 000`, `1 − (1 − p)^1000 = 96.98%`, and the simulation reports 97.00%.

## 3. A second cost of `top-1`: the flag can point at the wrong student

`top-1` creates one flag per registration. If a nuisance candidate outranks the true
duplicate, the reviewer is shown the wrong pair and the real duplicate is suppressed.
Simulated at cutoff 0.50:

| Registry size | Duplicate detected cleanly | Masked behind a nuisance candidate | Nuisance (hard negatives) |
| --- | --- | --- | --- |
| 100 | 67.6% | 23.8% | 100% |
| 500 | 51.4% | 37.9% | 100% |
| 1 000 | 44.2% | 45.0% | 100% |
| 5 000 | 36.6% | 52.6% | 100% |

With random unrelated pairs at `N = 1 000` the clean-detection rate is 83.9% instead, so
the truth sits between these columns. Either way, at registry scale **roughly a quarter to
a half of detected duplicates are presented to the reviewer attached to the wrong
candidate record**. The controller ranks exact identifier agreement above score, which
rescues identifier-verified duplicates, and this simulation does not model that, so the
masked figures are pessimistic. They are also not negligible, and they are the one
argument for a flag budget above one.

## 4. Which negatives actually reach the review queue

Measured on the holdout's negative families at cutoff 0.50 / 0.70:

| Negative family | Pairs | Flagged @0.50 | Flagged @0.70 |
| --- | --- | --- | --- |
| `identifier_collision` | 1 202 | 22.21% | 11.98% |
| `common_name_same_school` | 1 492 | 7.84% | 2.41% |
| `twins_or_close_age` | 1 150 | 5.57% | 1.57% |
| `siblings_shared_household` | 1 532 | 0.98% | 0.33% |
| `unrelated_candidate` | 624 | **0.00%** | **0.00%** |
| `repeat_application` (positives) | 6 000 | 89.27% recalled | 82.70% recalled |

The model does not produce noise flags: genuinely unrelated synthetic pairs never reach
the cutoff, even at 0.50. The flags are cases a human would want to look at — shared
identifiers, twins, same-age siblings, identical common names. That is the correct
behaviour for a *screening* tool, and it is why the queue volume has to be governed by
candidate selection rather than by pretending the model is wrong.

## 5. Would requiring identifier agreement (`top-1-corroborated`) help?

`top-1-corroborated` suppresses candidates that clear the cutoff on score alone. Measured
coverage of each corroboration rule on the holdout:

| Rule | Duplicates covered | Non-duplicates covered | Flags removed @0.50 | Recall after @0.50 |
| --- | --- | --- | --- | --- |
| Exact UPI or birth-certificate agreement | 40.17% | 12.57% | 463 → 211 (−54%) | 0.381 |
| … or DOB match with name similarity ≥ 0.90 | 60.70% | 17.75% | 463 → 307 (−34%) | 0.576 |

Verdict: corroboration halves the queue only by discarding **60% of true duplicates**
(39% for the wider rule). At registry scale that trade does not even solve the queue —
cutting a 97% nuisance rate by a third still leaves most registrations flagged — while the
miss rate goes from 10.7% to 62%. **Recommendation: do not adopt `top-1-corroborated`** as
a suppression rule, and keep it marked experimental. If a corroboration prior is wanted,
it belongs in ranking, not in filtering.

## 6. Candidate generation (blocking) is the only lever that changes the order of magnitude

Every student is compared with the entire registry today (`students.controller.js` has no
school or name filter). Blocking replaces `N` with a cell size. Two candidate keys were
measured, including what each would **cost in missed duplicates**:

| Key | Block size @N=1 000 | Block size @N=5 000 | Duplicates retained |
| --- | --- | --- | --- |
| Same surname **and** same school | 0.99 | 4.95 | **16.47%** |
| Any shared name token | 29.85 | 149.25 | **80.52%** |

A surname+school key looks perfect on volume and is unusable in practice: it silently
drops 83.5% of duplicates, because the generator (realistically) truncates surnames and
files records against `UNKNOWN` schools.

Projected nuisance rate behind each key (lower bound = block behaves like random pairs;
upper bound = block behaves like the hard-negative pool, which is the realistic case for a
key that selects on name):

| Registry size | Key | @0.50 | @0.70 |
| --- | --- | --- | --- |
| 1 000 | surname+school | 0.35% – 7.65% | 0.10% – 3.35% |
| 1 000 | any name token | 9.94% – 90.90% | 2.94% – 64.21% |
| 5 000 | any name token | 40.74% – 100% | 13.87% – 99.41% |

So blocking moves the problem from "certain" to "somewhere between 3% and 64% of
registrations", which is a real improvement but not a solved problem, and the width of
that range is a direct measure of how much we still do not know without adjudicated data.

## 7. The decisions

Each row states the evidence, the options with their measured consequences, and a
**recommended default that the owner must confirm or replace**. Recommendations are not
decisions and no configuration has been changed to match them.

### D1 — Flag budget per registration

*Evidence:* `top-1` bounds the queue at one case per registration, but hides the true
duplicate behind a higher-scoring nuisance candidate in 23.8% (N=100) to 52.6% (N=5 000) of
detected cases (§3).

| Option | Consequence | Status |
| --- | --- | --- |
| `top-1` (current) | ≤1 flag/registration; 24–53% of detections attributed to the wrong candidate at scale | **Recommended while the pilot registry is small (< ~200 students)** |
| bounded `top-3` | ≤3 flags; masking largely disappears; queue up to 3× | Recommended once the registry passes a few hundred students — needs a code change and tests |
| `all` (legacy) | one flag per qualifying pair; queue grows with `N × p` | Not viable; rejected by §2 |

### D2 — Review capacity per week

*Evidence:* reviewer load is determined entirely by this number, and it is the one input
the project cannot derive. Converting §2 and §6 into cases per **200 registrations** at
`N = 1 000`:

| Configuration | Cases per 200 registrations |
| --- | --- |
| whole registry, cutoff 0.50, random-pair negatives | ~194 |
| whole registry, cutoff 0.50, hard negatives | 200 |
| any-name-token blocking, cutoff 0.70 | 6 – 128 |
| any-name-token blocking, cutoff 0.80 | 0 – 79 |

*Recommendation:* the owner states a real number. If capacity is below ~20 cases per week,
whole-registry screening cannot go live and blocking (D4) becomes mandatory rather than
optional.

### D3 — Miss tolerance

*Evidence:* synthetic miss rate is 6.48% (0.30), 10.73% (0.50), 17.30% (0.70), 29.63%
(0.90). It is measured on `repeat_application` only; no other duplicate pattern is
represented in the labels.

*Recommendation:* if ≤20% is acceptable, the live 0.50 already satisfies the requirement
and **should not be moved** (§1). If ≤10% is required, 0.40 is the only candidate, at the
cost of a larger queue (§2). This analysis says nothing about duplicate patterns the
generator never produced.

### D4 — Cross-school comparison / candidate generation

*Evidence:* only **27.65%** of synthetic duplicates share a school code and 7.62% have
`UNKNOWN` on one side, so **hard-filtering on school would discard roughly 72% of true
duplicates**. Filtering on surname+school retains only 16.47%. Blocking on any shared name
token retains 80.52% while cutting the comparison set by ~33× at `N = 1 000` (§6).

*Recommendation:* do **not** block by school. Replace "compare against every student" with
name-token candidate generation, keep `school_match` as a model feature (it already is),
treat missing school as a wildcard, and cap the candidate list. This is a behavioural
change to `backend/src/controllers/students.controller.js` and requires explicit approval
plus new tests; it has not been implemented.

### D5 — Adjudication owner and protocol

*Evidence:* **0 adjudicated pairs exist.** `evaluation/reviewed_pairs_template.csv` is
header-only, and both `sbms_test` and `student_beneficiary_system` hold 0 students, 0
duplicate flags and 0 review events, so there is no historical adjudication to mine.

Proposed protocol (for the owner to accept, amend or reject):

1. Sample 200–300 pairs stratified by score band (≈100 in 0.30–0.50, 100 in 0.50–0.70,
   100 in 0.70–0.90) so both easy and hard cases are represented.
2. Two reviewers label independently, blind to the model score; disagreements go to an
   adjudicator whose label is final.
3. Store pseudonymous entity IDs and split `tuning` / `holdout` by entity —
   `evaluate_reviewed_pairs.py` already refuses a split where any entity appears in both.
4. Record the reviewer, the date and the data-protection basis in
   `docs/ml-evaluation-policy.md`.

*Recommendation:* the owner names the reviewer(s) and confirms the protocol. This is the
single decision that unblocks every number in §8.

## 8. What still cannot be claimed, and why

| Claim | Status | Blocked by |
| --- | --- | --- |
| "The system detects duplicates accurately" | **Cannot be supported** | D5 — no adjudicated labels |
| Real-world precision / recall / miss rate | Unmeasured | D5 |
| Applicant-population false-positive rate | Unmeasured | D5 |
| The chosen threshold is the right one | Unsupported — F1 is flat from 0.30 to 0.60 | D3 + D5 |
| Duplicate patterns other than `repeat_application` | Untested | D5 / generator coverage |
| The model generalises beyond the simulator | Unknown | D5 |

The pair-level figures in §1 are properties of a synthetic generator. They are useful for
regression testing and for sizing the queue; they are not accuracy claims about Kenyan
student records.

## 9. Reproduction

```powershell
cd ml-service
.\.venv\Scripts\python.exe .\evaluate_operating_point.py             # ~25 s, writes the JSON
.\.venv\Scripts\python.exe -m unittest tests.test_operating_point -v  # 14 tests
.\.venv\Scripts\python.exe -m unittest discover -s tests              # 33 tests
```

`tests/test_operating_point.py` fails if the committed report stops describing the live
artifact, if the pair-level numbers stop reproducing
`realistic_pairs_xgboost_training_metrics.json`, if serving features drift from the
generator's, or if the report stops declaring that its labels are synthetic.

## 10. Limitations (carry these into Chapter 5)

1. All labels are synthetic; positives are one duplicate pattern only.
2. Registration-level rates are simulated with independent candidate draws; real
   registries cluster, so both nuisance and masking are approximations.
3. Block sizes are estimated from the generated name/school distribution, not from a real
   registry.
4. Ranking in the simulation is by score only; the controller ranks exact identifier
   agreement above score, so masking is over-stated.
5. One artifact, one seed. Any retrain invalidates this report, and the tests will say so.



