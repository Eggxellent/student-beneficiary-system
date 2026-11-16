# Screening audit for the guardian-led redesign (Phase 2)

**Date:** 2026-11-16 · **Branch:** `redesign/guardian-led-applications` · **Model under test:** the deployed
artefact `ml-service/model/xgb_duplicate_model.joblib` (unchanged, not retrained, not tuned).

## 1. Method

`ml-service/evaluate_adversarial_format_scenarios.py` (already in the repository) was run against the
production artefact with the ML virtual environment:

```powershell
.\ml-service\.venv\Scripts\python.exe ml-service\evaluate_adversarial_format_scenarios.py
```

| Parameter | Value |
| --- | --- |
| Challenge rows | 6500 (26 scenarios × 250) |
| Seed | 20261022 |
| Challenge SHA-256 | `352090d8943b21c70a0dcd7cb62c62c064e5efa9143bcaa41ce8e9c371053111` |
| Threshold used by the harness | 0.5 |
| Training or tuning performed | none (`training_performed`, `training_data_read`, `threshold_tuned` are all false in the report) |

The harness writes `ml-service/evaluation/adversarial_format_scenarios_metrics.json`, which is not tracked
by git; this document is the durable record.

## 2. Results (frozen model, 250 rows per scenario)

| Scenario (positive) | Recall | Mean score |
| --- | ---: | ---: |
| `positive_swapped_punctuated_name` (name order changed) | 1.000 | 0.9982 |
| `positive_diacritic_name` (spelling/accents) | 1.000 | 0.9941 |
| `positive_truncated_name` | 1.000 | 0.9905 |
| `positive_initials` | 1.000 | 0.9867 |
| `positive_date_format_change` | 1.000 | 0.9982 |
| `positive_identifier_separators` | 1.000 | 0.9982 |
| `positive_identifier_case_change` | 1.000 | 0.9982 |
| `positive_unicode_homoglyph` | 1.000 | 0.9940 |
| `positive_rekeyed_identifiers` (all identifiers altered) | 1.000 | 0.9999 |
| `positive_sparse_fields` | **0.316** | 0.3857 |
| `positive_shared_missing_markers` | **0.264** | 0.3769 |

| Scenario (negative) | False-positive rate | Mean score |
| --- | ---: | ---: |
| `negative_common_name_collision` | **1.000** | 0.9999 |
| `negative_twins_shared_household` | **1.000** | 0.9994 |
| `negative_prefix_name_collision` | **1.000** | 0.9998 |
| `negative_unicode_near_name` | **1.000** | 0.9998 |
| `negative_upi_collision_only` | **1.000** | 0.9879 |
| `negative_birth_certificate_collision_only` | **1.000** | 0.9894 |
| `negative_reformatted_id_collision` | **1.000** | 0.9879 |
| `negative_common_name_and_shared_guardian` | **1.000** | 0.9992 |
| `negative_demographic_and_certificate_collision` | **1.000** | 0.9987 |
| `negative_empty_name_normalization` | **1.000** | 0.9995 |
| `negative_placeholder_name_only` | **1.000** | 0.9995 |
| `negative_all_unknown_placeholders` | 0.000 | 0.3204 |
| `negative_shared_placeholder_fields` | 0.000 | 0.0881 |

Aggregate at 0.5: **recall 0.891, precision 0.513, F1 0.651**.

## 3. What this means (and what it does not)

1. **Format perturbations are tolerated on the positive scenarios we were asked to test** — reversed name
   order, spelling/diacritics, truncation, initials, date formats and re-formatted or re-keyed identifiers
   all score ≈0.99 and are recovered. This is measured, not assumed, and it satisfies rule 4 for the
   positive direction.
2. **The same scores are also produced for negatives.** Every collision scenario scores ≈0.99, so a high
   model score does not distinguish a genuine duplicate from a name collision, twins, or a shared
   household. Precision 0.51 at 0.5 confirms the score is uncalibrated and not separable on this
   challenge.
3. **Pairs with little data score low.** Sparse records and placeholder-heavy records fall to 0.26–0.32
   recall. A guardian-led form that leaves identifiers blank would be screened as "not a duplicate"
   regardless of the truth, which is a real operational risk for the redesign and must be visible in the
   UI ("not screened" vs "screened, nothing found").
4. **Therefore:** the score remains advisory evidence only (rule 6), and **case creation must continue to go
   through `services/duplicateAggregation.js`**, which opens a case only on an exact identifier match or at
   least two corroborating fields and suppresses guardian-only (sibling) matches. Thresholding raw scores
   for public submissions would flood the queue with one case per applicant.
5. These are generated scenarios. They do not estimate live accuracy or prevalence, and per
   `ML_RELIABILITY_REPORT.md` no human-verified outcome data exists to do better. No retraining is
   attempted (rule 7).

## 4. Candidate-generation finding

Registration currently selects **every** student row and locks them for the transaction before scoring:

```
students.controller.js:69-73
SELECT ... FROM students ORDER BY created_at ASC, id ASC FOR UPDATE
students.controller.js:75
scorePairs(candidates.map(...))   // every existing student, every submission
```

Consequences for a public, unauthenticated guardian form: N pairs scored per submission (Python bridge,
200 per batch), a table-wide `FOR UPDATE` held for the duration, and a per-application cost that grows with
the register. This is acceptable for staff-paced registration and is not acceptable for public traffic.

**Resolution adopted for Phase 3/4 (recall-safe, no model change):**

- The guardian path keeps the **full candidate scan** — correctness first — but does **not** take
  `FOR UPDATE` over the table; the CHECK constraint and the existing unordered-pair index already prevent
  duplicate cases, and a public submission must never hold a table-wide lock.
- `candidates_considered`, `candidates_qualifying` and `candidates_suppressed` are stored on the
  application, so screening volume is observable rather than silent.
- Case creation still runs through `selectFlaggedCandidates` with `top-1-corroborated`; the guardian path
  does not threshold raw scores.
- A bounded prefilter (exact identifiers OR normalised surname) is recorded in the gap register as a
  scalability optimisation, because it can only be adopted after a recall-safety evaluation that does not
  fit the remaining deadline. Keeping the full scan cannot hide a duplicate; a prefilter could.


## 5. Evidence files

| Item | Location |
| --- | --- |
| Harness | `ml-service/evaluate_adversarial_format_scenarios.py` |
| Generated challenge report (untracked) | `ml-service/evaluation/adversarial_format_scenarios_metrics.json` |
| Prior reliability findings | `ml-service/ML_RELIABILITY_REPORT.md` |
| Design decisions that depend on this | `docs/guardian-led-workflow.md` §8 |

