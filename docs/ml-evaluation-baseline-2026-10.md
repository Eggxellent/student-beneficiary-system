# ML screening baseline — 30 October 2026

**Status:** measured per-pair baseline; **no adjudicated (reviewed) data yet**.
**Scope:** the live XGBoost artifact, the review cutoff, and the registration-level
flag arithmetic. This document does **not** claim model accuracy, precision, or
recall; those require adjudicated pairs (see `docs/ml-evaluation-policy.md`, D1).

## 1. Artifact and reproduction

| Item | Value |
| --- | --- |
| Model version | `xgboost:6ec9f2a3cbe6ed0dcf80c79b15f47364d9f4f7bd3e27da25c690d0436bb0a6f9` |
| Harness | `ml-service/evaluate_false_positive_rate.py` |
| Negative-pair design | random unrelated pairs, same school |
| Pairs scored | 2 000 |
| Seed | 20261030 |
| Raw result | `ml-service/evaluation/fpr_baseline_2026-10-30.json` |

Reproduce (from the repository root, with the `ml-service` virtual environment
present):

```powershell
cd ml-service
.\.venv\Scripts\python.exe .\evaluate_false_positive_rate.py --output .\evaluation\fpr_baseline_2026-10-30.json
```

The harness is read-only: it loads the committed artifact, scores synthetic
unrelated pairs, and writes JSON. It does not train, tune, connect to the
database, or overwrite the artifact. Re-running it is deterministic for a given
artifact and seed.

## 2. Measured flag rates (fraction of unrelated pairs above the cutoff)

| Cutoff | All synthetic pairs | Pairs with distinct names only |
| --- | --- | --- |
| 0.30 | 14 / 2 000 = 0.70% | 12 / 2 000 = 0.60% |
| 0.40 | 9 / 2 000 = 0.45% | 7 / 2 000 = 0.35% |
| **0.50 (live cutoff)** | **7 / 2 000 = 0.35%** | **3 / 2 000 = 0.15%** |
| 0.60 | 4 / 2 000 = 0.20% | 2 / 2 000 = 0.10% |
| 0.70 | 2 / 2 000 = 0.10% | 2 / 2 000 = 0.10% |
| 0.80 | 0 / 2 000 = 0.00% | 1 / 2 000 = 0.05% |

Score distribution for unrelated pairs: median 0.019, p90 0.050, p99 0.198,
maximum 0.744.

At the live cutoff, 6 of the 7 flagged pairs had name similarity below 0.70 —
i.e. the flags were not driven by near-identical names. Four of the seven shared
a date of birth, and all seven shared a school (by construction of the negative
sample).

## 3. Why this matters at registration level

Registration compares a new record against **every** existing student. Before
30 October 2026 the controller created one flag per candidate pair at or above
the cutoff, so the number of flags per registration grew with the registry:

- expected flags per legitimate registration ≈ `N × p`
- probability of **at least one** nuisance flag ≈ `1 − (1 − p)^N`

with `N` existing students and per-pair rate `p`. Using the measured
`p = 0.0035` at cutoff 0.50:

| Existing students `N` | Expected flags (pre-fix) | P(at least one flag) |
| --- | --- | --- |
| 100 | 0.35 | 29.6% |
| 500 | 1.75 | 82.7% |
| 1 000 | 3.5 | 97.0% |
| 5 000 | 17.5 | ≈ 100% |

The arithmetic assumes independent candidates, which is optimistic in a real
registry (applicants cluster by school, guardian, and date of birth), so treat
these as a floor on the queue volume, not an exact prediction.

The same arithmetic explains why **raising the cutoff cannot fix this on its
own**: holding a 1% registration-level nuisance rate at `N = 1 000` requires
`p ≤ ~1 × 10⁻⁵` (about 0.001%), roughly 350× lower than the measured 0.35% at
cutoff 0.50. Cutoff tuning trades queue volume against miss rate; it cannot
remove the `N × p` growth.

## 4. What changed on 30 October 2026

`backend/src/controllers/students.controller.js` now passes scored candidates
through `backend/src/services/duplicateAggregation.js`, which defaults to
`DUPLICATE_AGGREGATION_POLICY=top-1`:

- at most **one** flag per registration (best candidate, exact identifier
  agreement ranked above score);
- the number of qualifying and suppressed candidates is written to the audit
  log and returned in `duplicate_screening`;
- `all` reproduces the legacy one-flag-per-pair behaviour for comparison.

What this does and does not do:

- **Does:** cap flags per registration at 1, so queue growth is bounded and each
  registration produces at most one case for a reviewer.
- **Does not:** reduce the probability that a *particular legitimate*
  registration receives a nuisance flag. Under the same independence assumption
  that probability is still `1 − (1 − p)^N`; the registration now gets one case
  instead of `N × p` cases. Reducing that probability requires either a lower
  per-pair rate (better model / features / cutoff) or the corroboration policy.
- **Unmeasured:** whether `top-1-corroborated` lowers nuisance flags without
  raising the miss rate. It suppresses candidates that pass on score alone, so it
  must be evaluated on adjudicated data before any owner adopts it.

## 5. Limitations (read before citing)

1. **These are not accuracy metrics.** The scores are documented as not
   calibrated probabilities
   (`duplicate_screening.score_is_calibrated_probability = false`). "0.35%" means
   0.35% of synthetic unrelated pairs scored at or above 0.50, not that 0.35% of
   true non-duplicates will be flagged in production.
2. **The negatives are synthetic.** They are generated unrelated pairs sharing a
   school — harder than fully random pairs, but they are not a random sample of
   the real applicant population.
3. **No adjudicated pairs were used.** Precision, recall, and the miss rate at
   each cutoff remain unmeasured.
   `ml-service/evaluation/reviewed_pairs_template.csv` is the intended input once
   an owner adjudicates pairs.
4. **One seed, one artifact.** The result is reproducible for this artifact and
   seed; it says nothing about stability across retraining runs.
5. **Independence.** Section 3's arithmetic assumes independent candidates; real
   registries violate that, so the table understates clustering effects.

## 6. Next evidence required

- Adjudicated pair set (owner decision D1) → precision/recall/miss rate per
  cutoff, replacing sections 2 and 5.3.
- Decisions D2 (acceptable miss rate) and D3 (review capacity) → which cutoff and
  which aggregation policy is defensible.
- Re-run this harness after any retraining and diff the JSON before adopting a new
  artifact.
