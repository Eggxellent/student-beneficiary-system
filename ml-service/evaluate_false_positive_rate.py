"""Measure the live artifact's false-positive rate on unrelated student pairs.

This is a read-only diagnostic. It does not train, tune, or overwrite any artifact,
and it does not connect to the database.

It answers one question the existing project reports do not:

    Given two records that are genuinely different people, how often does the
    deployed model reach the human-review cutoff?

That per-pair false-positive rate is the input to the registration-level arithmetic in
``docs/SBMS_PROJECT_HANDOVER_2026-10.md`` (section 4.3), because registration currently
flags a student when *any single* candidate pair exceeds the cutoff.

Usage (from ``ml-service/``):

    .\\.venv\\Scripts\\python.exe .\\evaluate_false_positive_rate.py
    .\\.venv\\Scripts\\python.exe .\\evaluate_false_positive_rate.py --pairs 5000 --output .\\evaluation\\fpr_probe.json

Limitations to state whenever this output is quoted:

* The negatives are *random unrelated* pairs, i.e. easy negatives. Real queues also contain
  hard negatives (siblings, twins, common names), which the project's synthetic dataset
  covers and which score higher. Report both figures, never one alone.
* Name pools are deliberately narrow to mimic common Kenyan names, so accidental full-name
  collisions occur at a realistic rate.
* The aggregation arithmetic in the handover treats per-pair outcomes as independent. Real
  pairs share the new record and are therefore correlated, so that arithmetic is an
  approximation, not a proof.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import predict
from feature_engineering import FEATURE_COLUMNS

GIVEN_NAMES = [
    "Brian", "Kevin", "Dennis", "Patrick", "Samuel", "Joseph", "Peter", "Daniel",
    "Collins", "Felix", "Victor", "Elijah", "Moses", "Isaac", "George", "Martin",
    "Faith", "Mercy", "Grace", "Joyce", "Amina", "Cynthia", "Brenda", "Esther",
    "Naomi", "Purity", "Sharon", "Lydia", "Winnie", "Rehema", "Hellen", "Irene",
]
SURNAMES = [
    "Otieno", "Wanjiku", "Mutiso", "Cheruiyot", "Odhiambo", "Kamau", "Wafula",
    "Njoroge", "Kariuki", "Achieng", "Barasa", "Chebet", "Kilonzo", "Maina",
    "Nyambura", "Owino", "Simiyu", "Wekesa", "Mbugua", "Onyango",
]

DEFAULT_CUTOFFS = (0.30, 0.40, 0.50, 0.60, 0.70, 0.80)


def unrelated_student(rng: random.Random, school_code: str) -> dict[str, str]:
    """Build one record for a person unrelated to every other generated record."""
    given = rng.choice(GIVEN_NAMES)
    surname = rng.choice(SURNAMES)
    # Kenyan identifier shapes: national-ID-style 8 digits, NEMIS-style alphanumeric
    # UPI, 7-digit birth-certificate number. Values are independent between records.
    upi = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") for _ in range(10))
    return {
        "full_name": f"{given} {surname}",
        "date_of_birth": f"{rng.randint(14, 19):04d}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "school_code": school_code,
        "guardian_id": str(rng.randint(10**7, 10**8 - 1)),
        "upi": upi,
        "birth_certificate_number": str(rng.randint(10**6, 10**7 - 1)),
    }


def distinct_name_pairs(rng: random.Random, count: int, school_code: str) -> list[dict]:
    """Pairs that always differ in full name: the hardest same-school negative."""
    pairs = []
    for _ in range(count):
        first = unrelated_student(rng, school_code)
        second = unrelated_student(rng, school_code)
        for _ in range(20):
            if second["full_name"] != first["full_name"]:
                break
            second = unrelated_student(rng, school_code)
        pairs.append({"first": first, "second": second})
    return pairs


def summarize(scored: list[dict], cutoffs: tuple[float, ...], total: int) -> dict:
    """Report flag counts and rates per cutoff, plus the score distribution."""
    report: dict[str, object] = {}
    for cutoff in cutoffs:
        flagged = sum(1 for item in scored if item["score"] >= cutoff)
        report[f"cutoff_{cutoff}"] = {"flagged": flagged, "rate": round(flagged / total, 4)}
    scores = sorted(item["score"] for item in scored)
    report["distribution"] = {
        "min": scores[0],
        "p50": scores[total // 2],
        "p90": scores[int(total * 0.90)],
        "p99": scores[int(total * 0.99)],
        "max": scores[-1],
    }
    return report


def feature_drivers(scored: list[dict], cutoff: float) -> dict:
    """Describe which features carry the false flags, to guide investigation."""
    flagged = [item for item in scored if item["score"] >= cutoff]
    if not flagged:
        return {"flagged": 0}
    return {
        "flagged": len(flagged),
        "identical_full_name": sum(1 for item in flagged if item["features"]["jaro_winkler"] == 1.0),
        "name_similarity_ge_0.90": sum(1 for item in flagged if item["features"]["jaro_winkler"] >= 0.90),
        "name_similarity_lt_0.70": sum(1 for item in flagged if item["features"]["jaro_winkler"] < 0.70),
        "any_dob_match": sum(1 for item in flagged if item["features"]["dob_match"] > 0),
        "mean_features": {
            column: round(sum(item["features"][column] for item in flagged) / len(flagged), 4)
            for column in FEATURE_COLUMNS
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Per-pair false-positive rate of the deployed model.")
    parser.add_argument("--pairs", type=int, default=2000, help="number of unrelated pairs to score")
    parser.add_argument("--seed", type=int, default=20261030, help="random seed for reproducibility")
    parser.add_argument("--school", default="SCH_A", help="school_code shared by both records in a pair")
    parser.add_argument("--cutoff", type=float, default=0.50, help="cutoff used for the feature breakdown")
    parser.add_argument("--output", type=Path, default=None, help="optional JSON output path")
    arguments = parser.parse_args()

    rng = random.Random(arguments.seed)
    model = predict.load_model()

    pairs = [
        {
            "first": unrelated_student(rng, arguments.school),
            "second": unrelated_student(rng, arguments.school),
        }
        for _ in range(arguments.pairs)
    ]
    scored = predict.predict_pairs(pairs, model)

    report = {
        "model_version": predict.model_version(),
        "negatives": "random unrelated pairs sharing a school",
        "pairs": arguments.pairs,
        "seed": arguments.seed,
        "all_pairs": summarize(scored, DEFAULT_CUTOFFS, arguments.pairs),
        "distinct_name_only": summarize(
            predict.predict_pairs(distinct_name_pairs(rng, arguments.pairs, arguments.school), model),
            DEFAULT_CUTOFFS,
            arguments.pairs,
        ),
        f"drivers_at_{arguments.cutoff}": feature_drivers(scored, arguments.cutoff),
    }

    text = json.dumps(report, indent=2)
    print(text)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

