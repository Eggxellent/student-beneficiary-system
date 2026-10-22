"""Generate latent-identity pair data for SBMS duplicate-review scenarios.

This is a documented simulation, not a substitute for adjudicated beneficiary data.
Each group represents the same pair of underlying people across two submissions.
"""

from __future__ import annotations

import random
import string
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from data.kenyan_names import FIRST_NAMES, SCHOOLS, SURNAMES
from feature_engineering import build_pair_features

BASE = Path(__file__).resolve().parent
TRAIN_FILE = BASE / "training" / "realistic_pairs_train.csv"
HOLDOUT_FILE = BASE / "evaluation" / "realistic_pairs_holdout.csv"
TRAIN_SEED = 872_341
HOLDOUT_SEED = 992_117
PAIRS_PER_SPLIT = 12_000
MISSING_MARKERS = ("", "UNKNOWN", "N/A", "NOT PROVIDED")
IDENTIFIER_FIELDS = ("guardian_id", "upi", "birth_certificate_number")


def _record(rng: random.Random) -> dict[str, str]:
    given = rng.choice(FIRST_NAMES)
    surname = rng.choice(SURNAMES)
    if rng.random() < 0.15:
        given = f"{given} {rng.choice(FIRST_NAMES)}"
    return {
        "full_name": f"{given} {surname}",
        "date_of_birth": (date(2002, 1, 1) + timedelta(days=rng.randrange(15 * 365))).isoformat(),
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"G-{rng.randrange(10_000_000, 99_999_999)}",
        "upi": f"UPI-{rng.randrange(100_000_000, 999_999_999)}",
        "birth_certificate_number": f"BC-{rng.randrange(100_000, 999_999)}",
    }


def _typo(value: str, rng: random.Random) -> str:
    positions = [i for i, char in enumerate(value) if char.isalnum()]
    if not positions:
        return value
    i = rng.choice(positions)
    mode = rng.choice(("replace", "delete", "transpose", "insert"))
    if mode == "replace":
        return value[:i] + rng.choice(string.ascii_letters + string.digits) + value[i + 1:]
    if mode == "delete":
        return value[:i] + value[i + 1:]
    if mode == "transpose" and i + 1 < len(value):
        return value[:i] + value[i + 1] + value[i] + value[i + 2:]
    return value[:i + 1] + rng.choice(string.ascii_letters + string.digits) + value[i + 1:]


def _mutate_name(value: str, rng: random.Random) -> str:
    tokens = value.split()
    mode = rng.choice(("typo", "typo", "reorder", "initial", "drop", "alias", "punctuation"))
    if mode == "typo":
        return _typo(value, rng)
    if mode == "reorder" and len(tokens) > 1:
        return " ".join(reversed(tokens))
    if mode == "initial" and len(tokens) > 1:
        return f"{tokens[0][0]}. {' '.join(tokens[1:])}"
    if mode == "drop" and len(tokens) > 1:
        return " ".join(tokens[:-1])
    if mode == "alias" and len(tokens) > 1:
        return f"{rng.choice(FIRST_NAMES)} {' '.join(tokens[1:])}"
    return value.replace(" ", "-")


def _mutate_dob(value: str, rng: random.Random) -> str:
    year, month, day = map(int, value.split("-"))
    original = date(year, month, day)
    mode = rng.choice(("format", "format", "day_error", "month_day_swap", "year_error"))
    if mode == "format":
        return original.strftime("%d/%m/%Y")
    if mode == "day_error":
        return (original + timedelta(days=rng.choice((-2, -1, 1, 2)))).isoformat()
    if mode == "month_day_swap" and day <= 12:
        try:
            return date(year, day, month).isoformat()
        except ValueError:
            pass
    if mode == "year_error":
        return (original + timedelta(days=365 * rng.choice((-1, 1)))).isoformat()
    return value


def _corrupt(
    record: dict[str, str], rng: random.Random, positive: bool, difficulty: float = 0.0
) -> dict[str, str]:
    observed = dict(record)
    # Both submissions can contain entry errors. A true repeat may also reflect
    # a school move, changed caregiver, or reissued identifier.
    rates = {
        "full_name": (0.22 + 0.50 * difficulty) if positive else 0.10,
        "date_of_birth": (0.20 + 0.50 * difficulty) if positive else 0.10,
        "school_code": (0.25 + 0.50 * difficulty) if positive else 0.08,
        "guardian_id": (0.20 + 0.48 * difficulty) if positive else 0.06,
        "upi": (0.25 + 0.50 * difficulty) if positive else 0.025,
        "birth_certificate_number": (0.25 + 0.50 * difficulty) if positive else 0.02,
    }
    for field, rate in rates.items():
        if rng.random() >= rate:
            continue
        if field == "full_name":
            observed[field] = _mutate_name(record[field], rng)
        elif field == "date_of_birth":
            observed[field] = _mutate_dob(record[field], rng)
        elif field == "school_code":
            observed[field] = rng.choice(SCHOOLS)
        elif field in IDENTIFIER_FIELDS:
            if rng.random() < 0.55:
                observed[field] = _typo(record[field], rng)
            else:
                observed[field] = _record(rng)[field]
    # Missing fields occur independently of whether the pair is a match.
    for field in observed:
        if rng.random() < 0.08:
            observed[field] = rng.choice(MISSING_MARKERS)
    return observed


def _negative_people(rng: random.Random) -> tuple[dict[str, str], dict[str, str], str]:
    first, second = _record(rng), _record(rng)
    relation = rng.choices(
        ("siblings_shared_household", "twins_or_close_age", "common_name_same_school", "identifier_collision", "unrelated_candidate"),
        weights=(25, 20, 25, 20, 10),
        k=1,
    )[0]
    if relation in {"siblings_shared_household", "twins_or_close_age"}:
        second["guardian_id"] = first["guardian_id"]
        second["school_code"] = first["school_code"] if rng.random() < 0.90 else second["school_code"]
        first_surname = first["full_name"].split()[-1]
        second_given = second["full_name"].split()[0]
        if rng.random() < 0.90:
            second["full_name"] = f"{second_given} {first_surname}"
        if relation == "twins_or_close_age" and rng.random() < 0.90:
            second["date_of_birth"] = first["date_of_birth"]
        elif rng.random() < 0.65:
            first_date = date.fromisoformat(first["date_of_birth"])
            year = first_date.year + rng.choice((-2, -1, 1, 2))
            second["date_of_birth"] = date(year, first_date.month, min(first_date.day, 28)).isoformat()
    elif relation == "common_name_same_school":
        second["full_name"] = first["full_name"] if rng.random() < 0.35 else _mutate_name(first["full_name"], rng)
        second["school_code"] = first["school_code"]
        if rng.random() < 0.35:
            second["date_of_birth"] = first["date_of_birth"]
    elif relation == "identifier_collision":
        collision_field = rng.choice(IDENTIFIER_FIELDS)
        second[collision_field] = first[collision_field]
        if rng.random() < 0.25:
            second_collision_field = rng.choice(
                [field for field in IDENTIFIER_FIELDS if field != collision_field]
            )
            second[second_collision_field] = first[second_collision_field]
        if rng.random() < 0.45:
            second["school_code"] = first["school_code"]
        if rng.random() < 0.30:
            second["date_of_birth"] = first["date_of_birth"]
        if rng.random() < 0.55:
            second["school_code"] = first["school_code"]
        if rng.random() < 0.35:
            second["full_name"] = _mutate_name(first["full_name"], rng)
    return first, second, relation


def generate(pair_count: int, seed: int) -> pd.DataFrame:
    if pair_count < 2 or pair_count % 2:
        raise ValueError("pair_count must be a positive even number")
    rng = random.Random(seed)
    rows: list[dict[str, object]] = []
    group_count = pair_count // 2
    labels = [1] * (group_count // 2) + [0] * (group_count - group_count // 2)
    rng.shuffle(labels)
    for group_index, label in enumerate(labels):
        if label:
            first_base = _record(rng)
            second_base = dict(first_base)
            relation = "repeat_application"
            difficulty = rng.betavariate(2.0, 2.0)
        else:
            first_base, second_base, relation = _negative_people(rng)
            difficulty = 0.0
        for replicate in range(2):
            first = _corrupt(first_base, rng, bool(label), difficulty)
            second = _corrupt(second_base, rng, bool(label), difficulty)
            rows.append({
                "group_id": f"{seed}-{group_index}",
                "scenario": relation,
                "label": int(label),
                "name_1": first["full_name"], "name_2": second["full_name"],
                "dob_1": first["date_of_birth"], "dob_2": second["date_of_birth"],
                "school_1": first["school_code"], "school_2": second["school_code"],
                "guardian_1": first["guardian_id"], "guardian_2": second["guardian_id"],
                "upi_1": first["upi"], "upi_2": second["upi"],
                "birth_certificate_1": first["birth_certificate_number"],
                "birth_certificate_2": second["birth_certificate_number"],
                **build_pair_features(first, second),
            })
    return pd.DataFrame(rows).sample(frac=1, random_state=seed).reset_index(drop=True)


def main() -> None:
    TRAIN_FILE.parent.mkdir(parents=True, exist_ok=True)
    HOLDOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generate(PAIRS_PER_SPLIT, TRAIN_SEED).to_csv(TRAIN_FILE, index=False)
    generate(PAIRS_PER_SPLIT, HOLDOUT_SEED).to_csv(HOLDOUT_FILE, index=False)
    print(f"Wrote {PAIRS_PER_SPLIT} training pairs to {TRAIN_FILE}")
    print(f"Wrote {PAIRS_PER_SPLIT} independent holdout pairs to {HOLDOUT_FILE}")


if __name__ == "__main__":
    main()
