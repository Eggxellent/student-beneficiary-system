"""Generate labelled synthetic student pairs for duplicate detection."""

from __future__ import annotations

import random
import re
import string
from datetime import date, timedelta
from pathlib import Path

import jellyfish
import pandas as pd
from faker import Faker

from data.kenyan_names import FIRST_NAMES, SCHOOLS, SURNAMES

SEED = 42
PAIR_COUNT = 10_000
DUPLICATE_COUNT = PAIR_COUNT // 2
OUTPUT_DIR = Path(__file__).parent / "data"

fake = Faker()
Faker.seed(SEED)
random.seed(SEED)


def random_date() -> str:
    start = date(1995, 1, 1)
    return (start + timedelta(days=random.randint(0, 4_000))).isoformat()


def random_guardian_id() -> str:
    return f"G{random.randint(100000, 999999)}"


def clean_name(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


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
        name.lower(),
        name.upper(),
        name.replace(" ", "  "),
        typo_name(name),
    ]
    return random.choice(options)


def student_record() -> dict[str, str]:
    return {
        "full_name": make_name(),
        "date_of_birth": random_date(),
        "school_code": random.choice(SCHOOLS),
        "guardian_id": random_guardian_id(),
    }


def duplicate_pair() -> tuple[dict[str, str], dict[str, str], int]:
    while True:
        original = student_record()
        duplicate = original.copy()
        duplicate["full_name"] = variation(original["full_name"])
        duplicate["date_of_birth"] = original["date_of_birth"] if random.random() < 0.9 else random_date()
        duplicate["school_code"] = original["school_code"] if random.random() < 0.95 else random.choice(SCHOOLS)
        duplicate["guardian_id"] = original["guardian_id"] if random.random() < 0.9 else random_guardian_id()
        similarity = jellyfish.jaro_winkler_similarity(
            clean_name(original["full_name"]), clean_name(duplicate["full_name"])
        )
        if similarity >= 0.75:
            return original, duplicate, 1


def non_duplicate_pair() -> tuple[dict[str, str], dict[str, str], int]:
    while True:
        first = student_record()
        second = student_record()
        if second["full_name"] == first["full_name"]:
            continue
        similarity = jellyfish.jaro_winkler_similarity(
            clean_name(first["full_name"]), clean_name(second["full_name"])
        )
        if similarity < 0.70:
            return first, second, 0


def feature_row(first: dict[str, str], second: dict[str, str], label: int) -> dict[str, object]:
    first_name = clean_name(first["full_name"])
    second_name = clean_name(second["full_name"])
    return {
        "name_1": first["full_name"],
        "name_2": second["full_name"],
        "dob_1": first["date_of_birth"],
        "dob_2": second["date_of_birth"],
        "school_1": first["school_code"],
        "school_2": second["school_code"],
        "guardian_1": first["guardian_id"],
        "guardian_2": second["guardian_id"],
        "name_similarity": jellyfish.jaro_winkler_similarity(first_name, second_name),
        "dob_match": int(first["date_of_birth"] == second["date_of_birth"]),
        "school_match": int(first["school_code"] == second["school_code"]),
        "guardian_match": int(first["guardian_id"] == second["guardian_id"]),
        "label": label,
    }


def generate_dataset() -> pd.DataFrame:
    rows = []
    for generator, count in ((duplicate_pair, DUPLICATE_COUNT), (non_duplicate_pair, PAIR_COUNT - DUPLICATE_COUNT)):
        for _ in range(count):
            first, second, label = generator()
            rows.append(feature_row(first, second, label))
    random.shuffle(rows)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    dataset = generate_dataset()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = OUTPUT_DIR / "raw_pairs.csv"
    features_path = OUTPUT_DIR / "features.csv"
    dataset.to_csv(raw_path, index=False)
    dataset.to_csv(features_path, index=False)
    print(f"Generated {len(dataset)} labelled student pairs.")
    print(dataset["label"].value_counts().sort_index().to_dict())
    print(f"Wrote {raw_path}")
    print(f"Wrote {features_path}")
