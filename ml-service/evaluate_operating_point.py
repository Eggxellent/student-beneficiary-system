"""Measure the deployed model's operating points without training or tuning it.

This is a read-only analysis. It loads the live artifact, scores the held-out
labelled pairs through the *serving* feature path, and reports what a reviewer
would actually experience at each cutoff:

* pair-level precision / recall / F1 / false-positive rate / PR-AUC,
* which synthetic negative families cause the flags,
* registration-level queue volume under the ``top-1`` aggregation policy,
* how often ``top-1`` masks a true duplicate behind a nuisance candidate,
* whether the ``top-1-corroborated`` policy would help or would drop duplicates.

It answers "what would this cutoff do?" It does **not** answer "how accurate is
the system on real applicants?" — that needs adjudicated pairs, which do not
exist yet (see ``docs/ml-evaluation-policy.md``, decision D5).

Usage (from ``ml-service/``):

    .venv/Scripts/python.exe evaluate_operating_point.py
    .venv/Scripts/python.exe evaluate_operating_point.py --cutoffs 0.4 0.5 0.6 --registry-sizes 100 1000

Limitations to state whenever this output is quoted:

* Every label is synthetic. Positives are all ``repeat_application`` cases, so the
  recall figure covers that one duplicate pattern only.
* Negatives are deliberately hard (siblings, twins, identifier collisions, common
  names), but they are still generated, not sampled from real applicants.
* Registration-level rates are simulated. Candidate scores are drawn with
  replacement from the negative pool and treated as independent, which real
  registries violate.
* Scores are rounded to 4 decimals by ``predict.predict_many``, the same resolution
  the review cutoff is applied at in production.
* No ground-truth (adjudicated) pair set exists yet, so none of this is an accuracy
  claim about real beneficiaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

import predict
from evaluate_false_positive_rate import unrelated_student
from feature_engineering import FEATURE_COLUMNS, build_pair_features

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HOLDOUT = BASE_DIR / "evaluation" / "realistic_pairs_holdout.csv"
DEFAULT_OUTPUT = BASE_DIR / "evaluation" / "operating_point_2026-10-30.json"
DEFAULT_CUTOFFS = tuple(round(0.30 + 0.05 * step, 2) for step in range(14))
DEFAULT_REGISTRY_SIZES = (100, 500, 1000, 5000)
DEFAULT_SIMULATIONS = 2000
DEFAULT_SEED = 20261030

# The holdout stores one column per raw field; serving consumes the API's names.
FIELD_MAP = {
    "name": "full_name",
    "dob": "date_of_birth",
    "school": "school_code",
    "guardian": "guardian_id",
    "upi": "upi",
    "birth_certificate": "birth_certificate_number",
}

CORROBORATION_VARIANTS = {
    "identifier": "upi_match == 1 or birth_certificate_match == 1",
    "identifier_or_name_and_dob": "identifier or (dob_match == 1 and jaro_winkler >= 0.90)",
}

LIMITATIONS = [
    "All labels are synthetic; positives are only repeat_application cases, so recall "
    "covers that single duplicate pattern.",
    "Negatives are generated hard negatives (siblings, twins, identifier collisions, "
    "common names), not a sample of real applicants.",
    "Registration-level rates come from simulation with independent candidate draws, "
    "which understates clustering in a real registry.",
    "No adjudicated (human-reviewed) pair set exists, so precision, recall and miss "
    "rate describe this simulator and are not an accuracy claim about real records.",
    "One artifact, one seed. Re-run and diff after any retraining before adopting a "
    "replacement model.",
]


def load_labelled_pairs(path: Path) -> pd.DataFrame:
    """Read a labelled pair CSV without letting blanks become real feature values."""
    data = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = sorted(column for column in ("label", "scenario", "group_id") if column not in data.columns)
    if missing:
        raise ValueError(f"Input CSV is missing columns: {', '.join(missing)}")
    for prefix in FIELD_MAP:
        for position in (1, 2):
            if f"{prefix}_{position}" not in data.columns:
                raise ValueError(f"Input CSV is missing column: {prefix}_{position}")
    if data.empty:
        raise ValueError("Input CSV has no labelled pairs.")
    if not data["label"].isin({"0", "1"}).all():
        raise ValueError("label must be 0 or 1.")
    data["label"] = data["label"].astype(int)
    return data


def pair_records(data: pd.DataFrame) -> list[dict[str, dict[str, str]]]:
    """Convert CSV rows into the record shape the service sends to the model."""
    pairs = []
    for row in data.itertuples(index=False):
        pair: dict[str, dict[str, str]] = {"first": {}, "second": {}}
        for prefix, field in FIELD_MAP.items():
            pair["first"][field] = getattr(row, f"{prefix}_1")
            pair["second"][field] = getattr(row, f"{prefix}_2")
        pairs.append(pair)
    return pairs


def score_pairs(data: pd.DataFrame, model) -> tuple[np.ndarray, pd.DataFrame]:
    """Score through predict.predict_pairs, i.e. the exact path serving uses."""
    scored = predict.predict_pairs(pair_records(data), model)
    scores = np.array([item["score"] for item in scored], dtype=float)
    features = pd.DataFrame([item["features"] for item in scored], columns=FEATURE_COLUMNS)
    return scores, features


def feature_consistency(data: pd.DataFrame, features: pd.DataFrame) -> dict[str, object]:
    """Compare serving features with the feature columns stored in the holdout CSV.

    The stored columns were produced by the generator. A mismatch would mean the score
    under analysis is not the score serving computes, so it is reported, not hidden.
    """
    if not set(FEATURE_COLUMNS).issubset(data.columns):
        return {"checked": False, "reason": "holdout CSV has no stored feature columns"}
    stored = data[FEATURE_COLUMNS].astype(float).reset_index(drop=True)
    difference = (stored - features.reset_index(drop=True)).abs()
    return {
        "checked": True,
        "max_abs_difference": round(float(difference.to_numpy().max()), 10),
        "rows_differing": int((difference.max(axis=1) > 1e-9).sum()),
        "exact_match": bool((difference.to_numpy() <= 1e-9).all()),
    }


def threshold_row(labels: np.ndarray, scores: np.ndarray, cutoff: float) -> dict[str, object]:
    """Confusion matrix and derived rates for one cutoff."""
    predicted = scores >= cutoff
    positive = labels == 1
    tp = int((predicted & positive).sum())
    fp = int((predicted & ~positive).sum())
    fn = int((~predicted & positive).sum())
    tn = int((~predicted & ~positive).sum())
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    return {
        "cutoff": cutoff,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "miss_rate": round(1 - recall, 4),
        "f1": round(2 * precision * recall / (precision + recall), 4) if (precision + recall) else 0.0,
        "specificity": round(specificity, 4),
        "false_positive_rate": round(1 - specificity, 4),
        "review_share_of_pairs": round(float(predicted.mean()), 4),
        "youden_j": round(recall + specificity - 1, 4),
    }


def ranking_metrics(labels: np.ndarray, scores: np.ndarray) -> dict[str, object]:
    """Ranking quality, which does not depend on a cutoff choice."""
    positive = labels == 1
    curves = {}
    for cutoff in np.round(np.arange(0.30, 0.96, 0.05), 2):
        row = threshold_row(labels, scores, float(cutoff))
        curves[f"{cutoff:.2f}"] = {
            "precision": row["precision"],
            "recall": row["recall"],
            "f1": row["f1"],
        }
    best = max(curves.items(), key=lambda item: float(item[1]["f1"]))
    return {
        "pairs": int(len(labels)),
        "positives": int(positive.sum()),
        "negatives": int((~positive).sum()),
        "positive_base_rate": round(float(positive.mean()), 4),
        "roc_auc": round(float(roc_auc_score(labels, scores)), 4),
        "average_precision_pr_auc": round(float(average_precision_score(labels, scores)), 4),
        "pr_auc_baseline": round(float(positive.mean()), 4),
        "best_f1_cutoff": float(best[0]),
        "best_f1": best[1]["f1"],
        "score_summary": {
            "positives_median": round(float(np.median(scores[positive])), 4),
            "positives_5th_percentile": round(float(np.percentile(scores[positive], 5)), 4),
            "negatives_median": round(float(np.median(scores[~positive])), 4),
            "negatives_95th_percentile": round(float(np.percentile(scores[~positive], 95)), 4),
            "negatives_max": round(float(scores[~positive].max()), 4),
        },
        "precision_recall_curve_by_cutoff": curves,
    }


def registration_simulation(
    positive_scores: np.ndarray,
    negative_scores: np.ndarray,
    sizes: tuple[int, ...],
    cutoffs: tuple[float, ...],
    simulations: int,
    rng: np.random.Generator,
) -> dict[str, object]:
    """Simulate registry screening under the ``top-1`` policy.

    A legitimate registration is compared against ``size`` existing students; a
    duplicate registration adds one candidate that really is the same person. Only the
    single best candidate produces a flag, which is what
    ``backend/src/services/duplicateAggregation.js`` does by default.

    Four outcomes are counted per duplicate registration:

    * ``clean_detection`` - the true pair is the best candidate and clears the cutoff,
      so the reviewer is shown the right pair;
    * ``masked`` - the true pair clears the cutoff but a nuisance candidate scores
      higher, so the single flag points at the wrong student;
    * ``below_cutoff`` - the true pair never clears the cutoff;
    * everything except ``clean_detection`` is a missed duplicate for review purposes.

    Ranking here is by score only. The controller ranks exact identifier agreement
    above score, which reduces masking for identifier-verified duplicates, so the
    masked figure is a pessimistic upper bound.
    """
    negatives = np.asarray(negative_scores, dtype=float)
    positives = np.asarray(positive_scores, dtype=float)
    results: dict[str, object] = {}
    for size in sizes:
        # The maximum over ``size`` candidate draws does not depend on the cutoff, so
        # draw once per registry size and evaluate every cutoff on the same sample.
        maxima = np.array(
            [negatives[rng.integers(0, negatives.size, size=size)].max() for _ in range(simulations)]
        )
        truths = positives[rng.integers(0, positives.size, size=simulations)]
        per_cutoff: dict[str, object] = {}
        for cutoff in cutoffs:
            nuisance = maxima >= cutoff
            truth_flags = truths >= cutoff
            clean = truth_flags & (truths > maxima)
            masked = truth_flags & (maxima > truths)
            ties = truth_flags & (maxima == truths)
            below = ~truth_flags
            nuisance_rate = float(nuisance.mean())
            per_cutoff[f"{cutoff:.2f}"] = {
                "nuisance_flag_rate": round(nuisance_rate, 4),
                "nuisance_flags_per_1000_registrations": round(nuisance_rate * 1000, 1),
                "clean_detection_rate": round(float(clean.mean()), 4),
                "masked_by_top1_rate": round(float(masked.mean()), 4),
                "exact_tie_rate": round(float(ties.mean()), 4),
                "below_cutoff_rate": round(float(below.mean()), 4),
                "missed_for_review_rate": round(float((masked | below | ties).mean()), 4),
            }
        results[f"registry_{size}"] = {
            "registry_size": size,
            "simulations": simulations,
            "by_cutoff": per_cutoff,
        }
    return results


def negatives_by_scenario(
    data: pd.DataFrame, labels: np.ndarray, scores: np.ndarray, cutoffs: tuple[float, ...]
) -> dict[str, object]:
    """Show which synthetic negative families reach the cutoff."""
    report: dict[str, object] = {}
    negatives = labels == 0
    frame = pd.DataFrame(
        {"scenario": data.loc[negatives, "scenario"].to_numpy(), "score": scores[negatives]}
    )
    for scenario, rows in frame.groupby("scenario"):
        entry: dict[str, object] = {"pairs": int(len(rows))}
        for cutoff in cutoffs:
            flagged = int((rows["score"] >= cutoff).sum())
            entry[f"flag_rate_at_{cutoff:.2f}"] = round(flagged / len(rows), 4)
        report[str(scenario)] = entry
    positives = labels == 1
    positive_frame = pd.DataFrame(
        {"scenario": data.loc[positives, "scenario"].to_numpy(), "score": scores[positives]}
    )
    for scenario, rows in positive_frame.groupby("scenario"):
        entry = {"pairs": int(len(rows))}
        for cutoff in cutoffs:
            detected = int((rows["score"] >= cutoff).sum())
            entry[f"recall_at_{cutoff:.2f}"] = round(detected / len(rows), 4)
        report[f"positive:{scenario}"] = entry
    return report


def _name_tokens(value: object) -> frozenset[str]:
    """Alphabetic name tokens, used as a candidate-generation key."""
    return frozenset(re.findall(r"[a-z]+", str(value).lower()))


def _surname(value: object) -> str:
    """Last alphabetic token of a name, lower-cased; empty when there is none."""
    tokens = re.findall(r"[A-Za-z]+", str(value))
    return tokens[-1].lower() if tokens else ""


def blocking_projection(
    data: pd.DataFrame,
    labels: np.ndarray,
    scores: np.ndarray,
    easy_scores: np.ndarray,
    sizes: tuple[int, ...],
    cutoffs: tuple[float, ...],
    seed: int = 0,
) -> dict[str, object]:
    """Estimate the queue if candidates were blocked instead of screening the registry.

    Screening every registration against the entire registry makes a nuisance flag
    almost certain: with per-pair rate ``p`` and ``N`` students,
    ``P(at least one flag) = 1 - (1 - p) ** N``. Blocking compares a registration only
    with students in the same small cell, so the relevant count is the cell size.

    Cell sizes are **estimated** from the generated population by grouping records by
    (school, surname). Two per-pair rates are used to bracket the answer:

    * lower bound - the measured rate on random unrelated pairs, i.e. the block behaves
      like an arbitrary sample of the registry;
    * upper bound - the measured rate on the holdout's hard negatives, which is what a
      block *selected for name similarity* is more likely to look like.

    The true answer lies between them, and only real adjudicated data can narrow it.
    """
    records = pd.concat(
        [
            pd.DataFrame({"school": data["school_1"], "name": data["name_1"]}),
            pd.DataFrame({"school": data["school_2"], "name": data["name_2"]}),
        ],
        ignore_index=True,
    )
    records["surname"] = records["name"].astype(str).str.extract(r"([A-Za-z]+)\s*$")[0].str.lower()
    records["school"] = records["school"].astype(str).str.upper().str.strip()
    records = records[
        records["surname"].notna()
        & (records["surname"] != "")
        & ~records["school"].isin({"", "UNKNOWN", "NAN", "NONE"})
    ]
    if records.empty:
        return {"available": False, "reason": "no usable school/surname values"}
    share = records.groupby(["school", "surname"]).size() / len(records)
    concentration = float((share.to_numpy() ** 2).sum())

    # A surname+school key is precise but blind to truncated or misspelled names, which
    # the generator produces on purpose. Measure what each candidate key retains and how
    # large its block is, so the queue estimate comes with its recall cost attached.
    token_sets = [_name_tokens(value) for value in records["name"].tolist()]
    sampling = np.random.default_rng(seed)
    sample_size = min(20000, max(1000, len(token_sets) * 4))
    left = sampling.integers(0, len(token_sets), size=sample_size)
    right = sampling.integers(0, len(token_sets), size=sample_size)
    token_overlap_rate = float(np.mean([bool(token_sets[a] & token_sets[b]) for a, b in zip(left, right)]))

    positive = data[labels == 1]
    surname_school_hits = 0
    token_hits = 0
    for row in positive.itertuples(index=False):
        school_a, school_b = row.school_1.upper().strip(), row.school_2.upper().strip()
        surname_a, surname_b = _surname(row.name_1), _surname(row.name_2)
        if (
            surname_a
            and surname_a == surname_b
            and school_a == school_b
            and school_a not in {"", "UNKNOWN"}
        ):
            surname_school_hits += 1
        if _name_tokens(row.name_1) & _name_tokens(row.name_2):
            token_hits += 1
    duplicate_count = max(1, len(positive))
    duplicate_retention = {
        "surname_and_school": round(surname_school_hits / duplicate_count, 4),
        "any_name_token": round(token_hits / duplicate_count, 4),
    }
    negatives = labels == 0
    report: dict[str, object] = {
        "available": True,
        "records_used": int(len(records)),
        "distinct_surnames": int(records["surname"].nunique()),
        "distinct_schools": int(records["school"].nunique()),
        "populated_cells": int(len(share)),
        "concentration_sum_share_squared": round(concentration, 6),
        "random_record_token_overlap_rate": round(token_overlap_rate, 6),
        "duplicate_retention": duplicate_retention,
        "expected_block_size": {
            "surname_and_school": {f"registry_{size}": round(size * concentration, 2) for size in sizes},
            "any_name_token": {f"registry_{size}": round(size * token_overlap_rate, 2) for size in sizes},
        },
        "per_pair_rate": {
            "lower_bound_random_pairs": {
                f"cutoff_{cutoff:.2f}": (
                    round(float((easy_scores >= cutoff).mean()), 6) if easy_scores.size else 0.0
                )
                for cutoff in cutoffs
            },
            "upper_bound_hard_negatives": {
                f"cutoff_{cutoff:.2f}": (
                    round(float((scores[negatives] >= cutoff).mean()), 6) if negatives.any() else 0.0
                )
                for cutoff in cutoffs
            },
        },
        "projected_nuisance_rate": {},
        "assumption": (
            "Block sizes come from the generated name/school distribution, not from a real "
            "registry. Blocking on surname also selects harder negatives, so the upper "
            "bound is the more realistic of the two."
        ),
    }
    for size in sizes:
        block = size * concentration
        token_block = size * token_overlap_rate
        per_cutoff: dict[str, object] = {}
        for cutoff in cutoffs:
            p_low = float((easy_scores >= cutoff).mean()) if easy_scores.size else 0.0
            p_high = float((scores[negatives] >= cutoff).mean()) if negatives.any() else 0.0
            per_cutoff[f"{cutoff:.2f}"] = {
                "surname_school_block_size": round(block, 2),
                "surname_school_nuisance_lower_bound": round(1 - (1 - p_low) ** block, 4),
                "surname_school_nuisance_upper_bound": round(1 - (1 - p_high) ** block, 4),
                "token_block_size": round(token_block, 2),
                "token_nuisance_lower_bound": round(1 - (1 - p_low) ** token_block, 4),
                "token_nuisance_upper_bound": round(1 - (1 - p_high) ** token_block, 4),
            }
        report["projected_nuisance_rate"][f"registry_{size}"] = per_cutoff
    return report


def corroboration_analysis(
    labels: np.ndarray,
    scores: np.ndarray,
    features: pd.DataFrame,
    cutoffs: tuple[float, ...],
) -> dict[str, object]:
    """Test whether requiring exact identifier agreement would help or hurt.

    ``top-1-corroborated`` suppresses candidates that only clear the cutoff on score.
    That helps only if nuisance flags lack identifier agreement, and it is safe only if
    real duplicates usually have it.
    """
    positive = labels == 1
    flagged = {cutoff: scores >= cutoff for cutoff in cutoffs}
    masks = {
        "identifier": ((features["upi_match"] == 1) | (features["birth_certificate_match"] == 1)).to_numpy(),
        "identifier_or_name_and_dob": (
            (features["upi_match"] == 1)
            | (features["birth_certificate_match"] == 1)
            | ((features["dob_match"] == 1) & (features["jaro_winkler"] >= 0.90))
        ).to_numpy(),
    }
    report: dict[str, object] = {}
    for name, corroborated in masks.items():
        corroborated = corroborated.astype(bool)
        per_cutoff: dict[str, object] = {}
        for cutoff in cutoffs:
            above = flagged[cutoff]
            kept = above & corroborated
            true_positives = int((kept & positive).sum())
            kept_total = int(kept.sum())
            per_cutoff[f"{cutoff:.2f}"] = {
                "false_positives_before": int((above & ~positive).sum()),
                "false_positives_after": int((kept & ~positive).sum()),
                "true_positives_before": int((above & positive).sum()),
                "true_positives_after": true_positives,
                "recall_after": round(true_positives / max(1, int(positive.sum())), 4),
                "precision_after": round(true_positives / kept_total, 4) if kept_total else 0.0,
                "duplicates_lost_to_suppression": int((above & positive & ~corroborated).sum()),
                "nuisance_flags_suppressed": int((above & ~corroborated & ~positive).sum()),
            }
        report[name] = {
            "definition": CORROBORATION_VARIANTS[name],
            "positive_coverage": round(float(corroborated[positive].mean()), 4),
            "negative_coverage": round(float(corroborated[~positive].mean()), 4),
            "by_cutoff": per_cutoff,
        }
    return report


def label_coverage(holdout_path: Path) -> dict[str, object]:
    """State which labels exist, so no number can be mistaken for real evidence."""
    reviewed = [
        path
        for path in sorted(BASE_DIR.glob("evaluation/reviewed_pairs*.csv"))
        if path.name != "reviewed_pairs_template.csv"
    ]
    adjudicated_rows = 0
    for path in reviewed:
        try:
            adjudicated_rows += len(pd.read_csv(path, dtype=str, keep_default_na=False))
        except (OSError, ValueError, pd.errors.EmptyDataError):
            continue
    return {
        "synthetic_holdout_file": holdout_path.name,
        "adjudicated_files_found": [path.name for path in reviewed],
        "adjudicated_pair_count": adjudicated_rows,
        "template_path": "evaluation/reviewed_pairs_template.csv (header only, no rows)",
        "consequence": (
            "No human-adjudicated pairs exist, so precision, recall and miss rate below "
            "describe the synthetic generator only. They must not be reported as "
            "real-world accuracy. Decision D5 is what unblocks a real evaluation."
        ),
    }


def summarize(report: dict[str, object], label: str) -> None:
    """Print the few lines an operator needs; the JSON keeps everything."""
    ranking = report["pair_level"]["ranking"]
    print(f"[{label}] pairs={ranking['pairs']} roc_auc={ranking['roc_auc']} pr_auc={ranking['average_precision_pr_auc']}")
    print("  cutoff  precision  recall  f1      false_positive_rate  review_share")
    for row in report["pair_level"]["thresholds"]:
        if round(row["cutoff"], 2) in {0.40, 0.50, 0.60, 0.70}:
            print(
                f"  {row['cutoff']:.2f}    {row['precision']:.4f}     {row['recall']:.4f}  "
                f"{row['f1']:.4f}  {row['false_positive_rate']:.4f}               {row['review_share_of_pairs']:.4f}"
            )
    hard = report["registration_level"]["hard_negatives"]["registry_1000"]["by_cutoff"]["0.50"]
    easy = report["registration_level"]["easy_negatives"]["registry_1000"]["by_cutoff"]["0.50"]
    print("  at cutoff 0.50, registry of 1 000:")
    print(
        f"    hard negatives: {hard['nuisance_flags_per_1000_registrations']} nuisance flags per 1 000 "
        f"legitimate registrations, clean detection {hard['clean_detection_rate']:.4f}, "
        f"masked {hard['masked_by_top1_rate']:.4f}"
    )
    print(
        f"    easy negatives: {easy['nuisance_flags_per_1000_registrations']} nuisance flags per 1 000 "
        f"legitimate registrations, clean detection {easy['clean_detection_rate']:.4f}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Operating-point analysis of the deployed duplicate model.")
    parser.add_argument("--holdout", type=Path, default=DEFAULT_HOLDOUT, help="labelled pair CSV")
    parser.add_argument("--model", type=Path, default=predict.MODEL_FILE, help="artifact to analyse (read-only)")
    parser.add_argument("--output", type=Path, default=None, help="defaults to the dated evidence file")
    parser.add_argument("--cutoffs", type=float, nargs="+", default=list(DEFAULT_CUTOFFS))
    parser.add_argument("--registry-sizes", type=int, nargs="+", default=list(DEFAULT_REGISTRY_SIZES))
    parser.add_argument("--simulations", type=int, default=DEFAULT_SIMULATIONS)
    parser.add_argument("--negatives", type=int, default=2000, help="easy negative pairs to generate")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    arguments = parser.parse_args()

    cutoffs = tuple(sorted({round(cutoff, 2) for cutoff in arguments.cutoffs}))
    if not cutoffs or min(cutoffs) <= 0 or max(cutoffs) > 1:
        raise SystemExit("--cutoffs must all lie in (0, 1].")
    sizes = tuple(sorted({size for size in arguments.registry_sizes if size > 0}))
    if not sizes:
        raise SystemExit("--registry-sizes must contain at least one positive size.")
    if not arguments.holdout.is_file():
        raise FileNotFoundError(f"Labelled pair CSV not found: {arguments.holdout}")
    if not arguments.model.is_file():
        raise FileNotFoundError(f"Model artifact not found: {arguments.model}")

    # The dated report is committed evidence quoted by the decision sheet. A reduced run
    # (fewer cutoffs, sizes or simulations) must not overwrite it by accident, which is
    # exactly what happened once with the integrity checker's --fast mode.
    if arguments.output is None:
        is_default_run = (
            cutoffs == tuple(sorted({round(0.30 + 0.05 * step, 2) for step in range(14)}))
            and sizes == tuple(sorted(DEFAULT_REGISTRY_SIZES))
            and arguments.simulations == DEFAULT_SIMULATIONS
            and arguments.negatives == 2000
        )
        if not is_default_run:
            raise SystemExit(
                "Non-default --cutoffs/--registry-sizes/--simulations/--negatives require an "
                "explicit --output, so the committed evidence file is not overwritten."
            )
        arguments.output = DEFAULT_OUTPUT

    data = load_labelled_pairs(arguments.holdout)
    model = predict.load_model(arguments.model)
    scores, features = score_pairs(data, model)
    labels = data["label"].to_numpy()

    positive_scores = scores[labels == 1]
    hard_negatives = scores[labels == 0]
    rng = np.random.default_rng(arguments.seed)

    # Easy negatives come from the generator the FPR harness uses, so both reports stay
    # comparable: random unrelated pairs that share a school.
    random_source = random.Random(arguments.seed)
    easy_pairs = [
        {
            "first": unrelated_student(random_source, "SCH_A"),
            "second": unrelated_student(random_source, "SCH_A"),
        }
        for _ in range(arguments.negatives)
    ]
    easy_scores = np.array([item["score"] for item in predict.predict_pairs(easy_pairs, model)], dtype=float)

    report: dict[str, object] = {
        "provenance": {
            "model_file": str(arguments.model.resolve()),
            "model_sha256": hashlib.sha256(arguments.model.read_bytes()).hexdigest(),
            "model_version": (
                predict.model_version()
                if arguments.model.resolve() == predict.MODEL_FILE.resolve()
                else None
            ),
            "holdout_file": str(arguments.holdout.resolve()),
            "holdout_sha256": hashlib.sha256(arguments.holdout.read_bytes()).hexdigest(),
            "scoring_path": "predict.predict_pairs -> feature_engineering.build_pair_features",
            "score_resolution": "4 decimals, as returned by predict.predict_many",
            "seed": arguments.seed,
            "simulations": arguments.simulations,
            "registry_sizes": list(sizes),
            "cutoffs": list(cutoffs),
        },
        "label_coverage": label_coverage(arguments.holdout),
        "feature_consistency": feature_consistency(data, features),
        "pair_level": {
            "ranking": ranking_metrics(labels, scores),
            "thresholds": [threshold_row(labels, scores, cutoff) for cutoff in cutoffs],
        },
        "negatives_by_scenario": negatives_by_scenario(data, labels, scores, (0.50, 0.60, 0.70)),
        "registration_level": {
            "policy": "top-1 (one flag per registration, best candidate only)",
            "hard_negatives": registration_simulation(
                positive_scores, hard_negatives, sizes, cutoffs, arguments.simulations, rng
            ),
            "easy_negatives": registration_simulation(
                positive_scores, easy_scores, sizes, cutoffs, arguments.simulations, rng
            ),
        },
        "corroboration": corroboration_analysis(labels, scores, features, (0.50, 0.60, 0.70)),
        "blocking_projection": blocking_projection(
            data, labels, scores, easy_scores, sizes, (0.50, 0.60, 0.70, 0.80), arguments.seed
        ),
        "limitations": LIMITATIONS,
    }

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    summarize(report, arguments.holdout.name)
    print(f"written: {arguments.output.resolve()}")


if __name__ == "__main__":
    main()
