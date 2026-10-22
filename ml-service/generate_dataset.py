"""Generate realistic synthetic student pairs for duplicate detection."""

from __future__ import annotations

import argparse
import random
import string
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from data.kenyan_names import FIRST_NAMES, SCHOOLS, SURNAMES
from feature_engineering import build_pair_features

SEED = 42
PAIR_COUNT = 10_000
DUPLICATE_COUNT = PAIR_COUNT // 2
OUTPUT_DIR = Path(__file__).parent / "data"

random.seed(SEED)


def random_date() -> str:
    """Generate a realistic student date of birth."""
    start = date(2000, 1, 1)
    end = date(2015, 12, 31)
    days = (end - start).days
    return (start + timedelta(days=random.randint(0, days))).isoformat()


def random_guardian_id() -> str:
    return f"G{random.randint(100000, 999999)}"


def random_upi() -> str:
    return f"UPI-{random.randint(10000000, 99999999)}"


def random_birth_certificate_number() -> str:
    return f"BC-{random.randint(100000, 999999)}"


def make_name() -> str:
    return f"{random.choice(FIRST_NAMES)} {random.choice(SURNAMES)}"


def typo_name(name: str) -> str:
    characters = list(name)
    letters = [index for index, character in enumerate(characters) if character.isalpha()]
    if not letters:
        return name
    index = random.choice(letters)
    operation = random.choice(("delete", "swap", "replace"))
    if operation == "delete":
        del characters[index]
    elif operation == "swap" and index + 1 < len(characters):
        characters[index], characters[index + 1] = characters[index + 1], characters[index]
    else:
        characters[index] = random.choice(string.ascii_letters)
    return "".join(characters)


def variation(name: str) -> str:
    options = [
        name,
        name,
        name.lower(),
        name.replace(" ", "  "),
        typo_name(name),
        typo_name(typo_name(name)),
    ]
    return random.choice(options)


def student_record() -> dict[str, str]:
    return {
        "full_name": make_name(),
        "date_of_birth": random_date(),
        "school_code": random.choice(SCHOOLS),
        "guardian_id": random_guardian_id(),
        "upi": random_upi(),
        "birth_certificate_number": random_birth_certificate_number(),
    }


def duplicate_variation(original: dict[str, str]) -> dict[str, str]:
    """Create a noisy second record for the same student."""
    duplicate = original.copy()

    duplicate["full_name"] = variation(original["full_name"])

    duplicate["date_of_birth"] = (
        original["date_of_birth"]
        if random.random() < 0.85
        else random_date()
    )

    duplicate["school_code"] = (
        original["school_code"]
        if random.random() < 0.88
        else random.choice(SCHOOLS)
    )

    duplicate["guardian_id"] = (
        original["guardian_id"]
        if random.random() < 0.78
        else random_guardian_id()
    )

    duplicate["upi"] = (
        original["upi"]
        if random.random() < 0.65
        else random_upi()
    )

    duplicate["birth_certificate_number"] = (
        original["birth_certificate_number"]
        if random.random() < 0.85
        else random_birth_certificate_number()
    )

    return duplicate


def different_student(first: dict[str, str]) -> dict[str, str]:
    """Create a non-duplicate, including difficult sibling/name-collision cases."""
    second = student_record()

    if random.random() < 0.18:
        second["full_name"] = first["full_name"]
    elif random.random() < 0.38:
        second["full_name"] = typo_name(first["full_name"])

    if random.random() < 0.30:
        second["date_of_birth"] = first["date_of_birth"]

    if random.random() < 0.60:
        second["school_code"] = first["school_code"]

    if random.random() < 0.35:
        second["guardian_id"] = first["guardian_id"]

    # Siblings and twins can share several demographic fields without being duplicates.
    if random.random() < 0.12:
        second["date_of_birth"] = first["date_of_birth"]
        second["school_code"] = first["school_code"]
        second["guardian_id"] = first["guardian_id"]

    second["upi"] = random_upi()
    if random.random() < 0.02:
        second["upi"] = first["upi"]
    if random.random() < 0.01:
        second["birth_certificate_number"] = first["birth_certificate_number"]

    return second


def feature_row(first: dict[str, str], second: dict[str, str], label: int, group_id: int) -> dict[str, object]:
    return {
        "name_1": first["full_name"],
        "name_2": second["full_name"],
        "dob_1": first["date_of_birth"],
        "dob_2": second["date_of_birth"],
        "school_1": first["school_code"],
        "school_2": second["school_code"],
        "guardian_1": first["guardian_id"],
        "guardian_2": second["guardian_id"],
        "upi_1": first["upi"],
        "upi_2": second["upi"],
        "group_id": group_id,
        **build_pair_features(first, second),
        "label": label,
    }


def generate_dataset() -> pd.DataFrame:
    duplicate_rows = []
    for group_id in range(DUPLICATE_COUNT // 2):
        original = student_record()
        for _ in range(2):
            duplicate = duplicate_variation(original)
            duplicate_rows.append(feature_row(original, duplicate, 1, group_id))

    non_duplicate_rows = []
    for group_id in range(DUPLICATE_COUNT // 2, PAIR_COUNT // 2):
        first = student_record()
        for _ in range(2):
            second = different_student(first)
            non_duplicate_rows.append(feature_row(first, second, 0, group_id))

    rows = duplicate_rows + non_duplicate_rows
    random.shuffle(rows)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate labelled synthetic student pairs.")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--name", help="Optional feature CSV name without extension; keeps default filenames when omitted.")
    arguments = parser.parse_args()

    dataset = generate_dataset()
    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"{arguments.name}_" if arguments.name else ""
    raw_path = arguments.output_dir / f"{prefix}raw_pairs.csv"
    features_path = arguments.output_dir / f"{arguments.name or 'features'}.csv"
    dataset.to_csv(raw_path, index=False)
    dataset.to_csv(features_path, index=False)
    print(f"Generated {len(dataset)} labelled student pairs.")
    print("\nClass distribution:")
    print(dataset["label"].value_counts().sort_index().to_dict())

    print("\nNumber of groups:")
    print(dataset["group_id"].nunique())

    print("\nUPI match distribution by class:")
    print(
        pd.crosstab(
            dataset["label"],
            dataset["upi_match"],
            normalize="index",
        ).round(3)
    )

    print("\nFeature means by class:")
    print(dataset.groupby("label")[[
        "jaro_winkler",
        "dob_match",
        "school_match",
        "guardian_match",
        "upi_match",
        "birth_certificate_match",
    ]].mean().round(3))

    print(f"Wrote {raw_path}")
    print(f"Wrote {features_path}")
