"""Generate latent-identity pair data for SBMS duplicate-review scenarios.

This is a documented simulation, not a substitute for adjudicated beneficiary data.
Each group is one underlying child seen in two submissions. The label is the
identity relationship - same child (1) or two different children (0) - never the
similarity of the fields that happen to agree.

One population is generated and partitioned by connected components over student
identity, pair group, and non-missing guardian ID. This keeps related identities
and household clusters inside one split. `variation` names the relationship
scenario and `mutations` lists entry differences for evaluation only.
"""

from __future__ import annotations

import random
import string
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from data.kenyan_names import FIRST_NAMES, SCHOOLS, SURNAMES
from feature_engineering import build_pair_features

BASE = Path(__file__).resolve().parent
TRAIN_FILE = BASE / "training" / "realistic_pairs_train.csv"
VALIDATION_FILE = BASE / "evaluation" / "realistic_pairs_validation.csv"
HOLDOUT_FILE = BASE / "evaluation" / "realistic_pairs_holdout.csv"
TRAIN_SEED = 20_261_126
VALIDATION_SEED = TRAIN_SEED
HOLDOUT_SEED = TRAIN_SEED
SPLIT_SEED = 20_261_127
TRAIN_PAIRS = 21_000
VALIDATION_PAIRS = 4_500
HOLDOUT_PAIRS = 4_500
MISSING_MARKERS = ("", "UNKNOWN", "N/A", "NOT PROVIDED")
IDENTIFIER_FIELDS = ("guardian_id", "birth_certificate_number")
MISSING_RATE = 0.06
CHALLENGE_FRACTION = 0.45
COMMON_KENYAN_NAMES = ("Brian Kamau", "Faith Chepkoech", "Mary Wanjiku", "John Kamau")


def _admission_number(rng: random.Random) -> str:
    return f"ADM-{rng.randrange(2008, 2027)}-{rng.randrange(0, 10_000):04d}"


def _record(rng: random.Random) -> dict[str, str]:
    given = rng.choice(FIRST_NAMES)
    surname = rng.choice(SURNAMES)
    if rng.random() < 0.20:
        given = f"{given} {rng.choice(FIRST_NAMES)}"
    return {
        "full_name": f"{given} {surname}",
        "date_of_birth": (date(2002, 1, 1) + timedelta(days=rng.randrange(15 * 365))).isoformat(),
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"G-{rng.randrange(10_000_000, 99_999_999)}",
        "admission_number": _admission_number(rng),
        "birth_certificate_number": f"BC-{rng.randrange(100_000, 999_999)}",
    }


def _other_school(current: str, rng: random.Random) -> str:
    options = [school for school in SCHOOLS if school != current]
    return rng.choice(options) if options else current


def _typo(value: str, rng: random.Random) -> str:
    positions = [index for index, character in enumerate(value) if character.isalnum()]
    if not positions:
        return value
    index = rng.choice(positions)
    mode = rng.choice(("replace", "delete", "transpose", "insert"))
    if mode == "replace":
        return value[:index] + rng.choice(string.ascii_lowercase) + value[index + 1:]
    if mode == "delete":
        return value[:index] + value[index + 1:]
    if mode == "transpose" and index + 1 < len(value):
        return value[:index] + value[index + 1] + value[index] + value[index + 2:]
    return value[:index + 1] + rng.choice(string.ascii_lowercase) + value[index + 1:]


def _swap_digits(value: str, rng: random.Random) -> str:
    """Transpose two adjacent characters: the slip a written register produces."""
    positions = [index for index, character in enumerate(value) if character.isalnum()]
    if len(positions) < 2:
        return value
    index = rng.choice(positions[:-1])
    return value[:index] + value[index + 1] + value[index] + value[index + 2:]


def _mutate_name(value: str, rng: random.Random) -> tuple[str, str]:
    tokens = value.split()
    mode = rng.choice(("typo", "typo", "reorder", "initial", "drop_middle", "punctuation"))
    if mode == "typo":
        return _typo(value, rng), "name_spelling_error"
    if mode == "reorder" and len(tokens) > 1:
        # First, middle and surname order changes. The sorted-token comparison in
        # the feature builder is what makes this a recoverable variation.
        rotated = tokens[1:] + tokens[:1] if len(tokens) > 2 else list(reversed(tokens))
        return " ".join(rotated), "name_reorder"
    if mode == "initial" and len(tokens) > 1:
        return f"{tokens[0][0]}. {' '.join(tokens[1:])}", "middle_initial"
    if mode == "drop_middle" and len(tokens) > 2:
        return " ".join([tokens[0], tokens[-1]]), "missing_middle_name"
    return value.replace(" ", "-"), "name_punctuation"


def _challenge_name(value: str, rng: random.Random) -> tuple[str, str]:
    """Apply a plausible Guardian-form name omission or entry discrepancy."""
    tokens = value.split()
    mode = rng.choice(("minor_typo", "minor_typo", "initial", "surname_variant", "drop_middle"))
    if mode == "initial" and len(tokens) > 1:
        return f"{tokens[0][0]}. {' '.join(tokens[1:])}", "name_initial_omission"
    if mode == "drop_middle" and len(tokens) > 2:
        return " ".join((tokens[0], tokens[-1])), "missing_middle_name"
    if mode == "surname_variant" and len(tokens) > 1:
        changed = _typo(tokens[-1], rng)
        return " ".join((*tokens[:-1], changed)), "surname_transcription"
    changed = _typo(value, rng)
    if changed == value:
        changed = f"{value}a"
    return changed, "name_spelling_error"


def _mutate_dob(value: str, rng: random.Random) -> tuple[str, str]:
    year, month, day = map(int, value.split("-"))
    original = date(year, month, day)
    mode = rng.choice(("format", "format", "day_error", "month_day_swap", "year_error"))
    if mode == "format":
        return original.strftime("%d/%m/%Y"), "dob_format"
    if mode == "day_error":
        return (original + timedelta(days=rng.choice((-2, -1, 1, 2)))).isoformat(), "dob_day_error"
    if mode == "month_day_swap" and day <= 12:
        try:
            return date(year, day, month).isoformat(), "dob_month_day_swap"
        except ValueError:
            pass
    if mode == "year_error":
        return (original + timedelta(days=365 * rng.choice((-1, 1)))).isoformat(), "dob_year_error"
    return value, "dob_unchanged"


def _mutate_admission(value: str, rng: random.Random) -> tuple[str, str]:
    mode = rng.choice(("format", "format", "prefix_drop", "transpose"))
    parts = value.split("-")
    if mode == "format" and len(parts) == 3:
        return f"{parts[1]}/{parts[2]}", "admission_format"
    if mode == "prefix_drop" and len(parts) == 3:
        return f"{parts[1]}{parts[2]}", "admission_prefix_drop"
    return _swap_digits(value, rng), "admission_transposition"


def _mutate_birth_certificate(value: str, rng: random.Random) -> tuple[str, str]:
    mode = rng.choice(("transpose", "transpose", "digit_error"))
    if mode == "transpose":
        return _swap_digits(value, rng), "birth_certificate_transposition"
    characters = list(value)
    positions = [index for index, character in enumerate(characters) if character.isdigit()]
    if not positions:
        return value, "birth_certificate_unchanged"
    index = rng.choice(positions)
    characters[index] = str((int(characters[index]) + rng.choice((-2, -1, 1, 2))) % 10)
    return "".join(characters), "birth_certificate_digit_error"


def _apply_missing(observed: dict[str, str], rng: random.Random) -> list[str]:
    """Missing fields occur independently of whether the pair is a duplicate."""
    missing = []
    for field in observed:
        if rng.random() < MISSING_RATE:
            observed[field] = rng.choice(MISSING_MARKERS)
            missing.append(f"missing_{field}")
    return missing


def _duplicate_observation(
    record: dict[str, str], rng: random.Random, difficulty: float, *, challenging: bool = False
) -> tuple[dict[str, str], list[str]]:
    """Second submission of the same child, with entry differences."""
    if challenging:
        observed = dict(record)
        mutations: list[str] = []
        # Keep a realistic mixture: some forms omit identifiers only, while
        # others also have a name transcription/omission, occasional DOB error,
        # school transfer, or changed guardian. This teaches the model that
        # identifiers can be absent without making the other fields disappear.
        if rng.random() < 0.65:
            observed["full_name"], name_mutation = _challenge_name(record["full_name"], rng)
            mutations.append(name_mutation)
        if rng.random() < 0.30:
            observed["date_of_birth"], dob_mutation = _mutate_dob(record["date_of_birth"], rng)
            mutations.append(dob_mutation)
        if rng.random() < 0.10:
            observed["school_code"] = _other_school(record["school_code"], rng)
            mutations.append("school_transfer")
        if rng.random() < 0.15:
            observed["guardian_id"] = _record(rng)["guardian_id"]
            mutations.append("guardian_changed")
        observed["birth_certificate_number"] = ""
        observed["admission_number"] = ""
        mutations.extend(("missing_birth_certificate_number", "missing_admission_number", "hard_positive_identifier_case"))
        return observed, mutations

    if not challenging and rng.random() < 0.05:
        observed = dict(record)
        return observed, ["exact_copy"]
    observed = dict(record)
    mutations: list[str] = []
    if rng.random() < 0.45 + 0.50 * difficulty:
        observed["full_name"], mutation = _mutate_name(record["full_name"], rng)
        mutations.append(mutation)
    if rng.random() < 0.35 + 0.55 * difficulty:
        observed["date_of_birth"], mutation = _mutate_dob(record["date_of_birth"], rng)
        mutations.append(mutation)
    if rng.random() < 0.25 + 0.35 * difficulty:
        # A school transfer reissues the admission number: the child is the same,
        # the register entry is not.
        observed["school_code"] = _other_school(record["school_code"], rng)
        observed["admission_number"] = _admission_number(rng)
        mutations.append("school_transfer")
    elif rng.random() < 0.45 + 0.40 * difficulty:
        observed["admission_number"], mutation = _mutate_admission(record["admission_number"], rng)
        mutations.append(mutation)
    if rng.random() < 0.25 + 0.35 * difficulty:
        observed["guardian_id"] = _record(rng)["guardian_id"]
        mutations.append("guardian_changed")
    if rng.random() < 0.35 + 0.45 * difficulty:
        observed["birth_certificate_number"], mutation = _mutate_birth_certificate(
            record["birth_certificate_number"], rng
        )
        mutations.append(mutation)
    return observed, mutations


def _positive_category(mutations: list[str]) -> str:
    if mutations == ["exact_copy"]:
        return "exact_duplicate"
    entry_changes = [
        mutation
        for mutation in mutations
        if not mutation.startswith("missing_") and not mutation.endswith("_unchanged")
    ]
    if len(entry_changes) > 2:
        return "combined_changes"
    if any(mutation.startswith("name_") or mutation == "middle_initial" for mutation in entry_changes):
        return "name_variation"
    if "school_transfer" in entry_changes:
        return "school_transfer"
    if any(mutation.startswith("dob_") and mutation != "dob_unchanged" for mutation in entry_changes):
        return "dob_entry_error"
    if any(mutation.startswith("admission_") for mutation in entry_changes):
        return "admission_number_format"
    if any(mutation.startswith("birth_certificate_") for mutation in entry_changes):
        return "birth_certificate_transcription"
    if "guardian_changed" in entry_changes:
        return "guardian_change"
    # Everything left is a second submission where only fields went missing.
    return "missing_fields"


def _difficulty_band(features: dict[str, float | int]) -> str:
    """Feature-evidence tier derived without labels or scenario names."""
    identifier = max(float(features["admission_number_match"]), float(features["birth_certificate_match"]))
    name = float(features["jaro_winkler"])
    dob = float(features["dob_match"])
    school = float(features["school_match"])
    guardian = float(features["guardian_match"])
    if identifier >= 0.9:
        return "easy"
    corroborating = sum((name >= 0.8, dob >= 0.5, school >= 0.85, guardian >= 0.8))
    return "hard" if identifier < 0.5 and corroborating >= 2 else "moderate"

def _increment_last_digit(value: str, rng: random.Random) -> str:
    """Neighbouring register entry: the number after (or before) this one."""
    prefix, _, number = value.rpartition("-")
    if not number.isdigit():
        return _admission_number(rng)
    neighbour = int(number) + rng.choice((-1, 1))
    return f"{prefix}-{neighbour % 10_000:04d}"


def _negative_pair(
    rng: random.Random, *, blocked_collision: bool = False
) -> tuple[dict[str, str], dict[str, str], str, list[str]]:
    """Two genuinely different children who may share fields.

    Every family is a relationship an adjudicator could confirm from the school
    register: a sibling, a namesake, a register typo, a reused number. None of the
    labels is derived from how similar the two rows look.
    """
    first, second = _record(rng), _record(rng)
    if blocked_collision:
        family = rng.choice(("twins_same_dob", "siblings_same_household", "same_school_same_dob_classmates"))
        first["school_code"] = rng.choice(SCHOOLS)
        second["school_code"] = first["school_code"]
        first["guardian_id"] = f"G-{rng.randrange(10_000_000, 99_999_999)}"
        second["guardian_id"] = first["guardian_id"]
        if family == "twins_same_dob":
            first["full_name"], second["full_name"] = "Brian Kamau", "Faith Kamau"
            second["date_of_birth"] = first["date_of_birth"]
        elif family == "siblings_same_household":
            first["full_name"], second["full_name"] = "Mary Wanjiku", "John Wanjiku"
            first_date = date.fromisoformat(first["date_of_birth"])
            second["date_of_birth"] = date(first_date.year + rng.choice((1, 2, 3)), first_date.month, min(first_date.day, 28)).isoformat()
        else:
            common_name = rng.choice(COMMON_KENYAN_NAMES)
            first["full_name"] = common_name
            second["full_name"] = common_name
            second["date_of_birth"] = first["date_of_birth"]
        # Both identifiers are absent on one registration, leaving a hard
        # household/school candidate pair rather than a perfect-ID negative.
        second["birth_certificate_number"] = ""
        second["admission_number"] = ""
        return first, second, family, [
            "different_child", "blocked_collision_scenario", "shared_guardian", "shared_school",
            "missing_birth_certificate_number", "missing_admission_number",
        ]

    family = rng.choices(
        (
            "shared_guardian",
            "siblings_same_household",
            "same_school",
            "similar_names",
            "similar_admission_numbers",
            "admission_number_reuse",
            "similar_birth_certificate_numbers",
            "same_admission_different_school",
            "partial_identity",
            "twins_same_dob",
            "namesake_same_dob",
            "registry_collision",
            "same_school_same_dob_classmates",
        ),
        # This is a deliberate challenge-set mix, not an estimate of operational
        # prevalence. The generator overproduced easy negatives, so hard family
        # and namesake cases are represented more often for stress evaluation.
        weights=(8, 10, 3, 5, 5, 10, 6, 3, 6, 18, 10, 16, 4),
        k=1,
    )[0]
    mutations = ["different_child"]

    if family == "shared_guardian":
        second["guardian_id"] = first["guardian_id"]
        second["full_name"] = f"{second['full_name'].split()[0]} {first['full_name'].split()[-1]}"
        if rng.random() < 0.85:
            second["school_code"] = first["school_code"]
        mutations.append("shared_guardian")
    elif family == "siblings_same_household":
        second["guardian_id"] = first["guardian_id"]
        second["full_name"] = f"{second['full_name'].split()[0]} {first['full_name'].split()[-1]}"
        second["school_code"] = first["school_code"]
        if rng.random() < 0.55:
            first_date = date.fromisoformat(first["date_of_birth"])
            year = first_date.year + rng.choice((-2, -1, 1, 2))
            second["date_of_birth"] = date(year, first_date.month, min(first_date.day, 28)).isoformat()
        mutations.extend(["shared_guardian", "shared_school", "close_date_of_birth"])
    elif family == "same_school":
        second["school_code"] = first["school_code"]
        mutations.append("shared_school")
    elif family == "similar_names":
        second["full_name"] = _mutate_name(first["full_name"], rng)[0]
        if rng.random() < 0.5:
            second["school_code"] = first["school_code"]
        mutations.append("similar_name")
    elif family == "similar_admission_numbers":
        second["school_code"] = first["school_code"]
        second["admission_number"] = _increment_last_digit(first["admission_number"], rng)
        mutations.extend(["shared_school", "neighbouring_admission_number"])
    elif family == "admission_number_reuse":
        # A register error: the office entered the same admission number twice for
        # two children. The number is not unique evidence on its own.
        second["school_code"] = first["school_code"]
        second["admission_number"] = first["admission_number"]
        mutations.extend(["shared_school", "reused_admission_number"])
    elif family == "similar_birth_certificate_numbers":
        # Distinct children can have nearby certificate numbers because issuing
        # offices often allocate them in batches. This keeps certificate similarity
        # from becoming a shortcut for the positive identity label.
        digits = first["birth_certificate_number"].removeprefix("BC-")
        if digits.isdigit():
            second["birth_certificate_number"] = f"BC-{(int(digits) + 1) % 1_000_000:06d}"
        mutations.append("neighbouring_birth_certificate")
    elif family == "twins_same_dob":
        # Siblings can share a guardian, school, and date of birth. Keep their
        # admission and birth-certificate numbers independent: they are different
        # children even when several other fields agree.
        second["guardian_id"] = first["guardian_id"]
        second["school_code"] = first["school_code"]
        second["date_of_birth"] = first["date_of_birth"]
        second["admission_number"] = _increment_last_digit(first["admission_number"], rng)
        certificate_digits = first["birth_certificate_number"].removeprefix("BC-")
        if certificate_digits.isdigit():
            second["birth_certificate_number"] = f"BC-{(int(certificate_digits) + 1) % 1_000_000:06d}"
        second_given = second["full_name"].split()[0]
        first_surname = first["full_name"].split()[-1]
        second["full_name"] = f"{second_given} {first_surname}"
        if second["full_name"].casefold() == first["full_name"].casefold():
            second["full_name"] = f"{second_given} {first_surname} Junior"
        mutations.extend(["shared_guardian", "shared_school", "shared_date_of_birth", "siblings"])
    elif family == "namesake_same_dob":
        # Namesakes can share a name, school, and birth date without sharing a
        # guardian or either identity number.
        second["full_name"] = first["full_name"]
        second["date_of_birth"] = first["date_of_birth"]
        second["school_code"] = first["school_code"]
        second["admission_number"] = _increment_last_digit(first["admission_number"], rng)
        certificate_digits = first["birth_certificate_number"].removeprefix("BC-")
        if certificate_digits.isdigit():
            second["birth_certificate_number"] = f"BC-{(int(certificate_digits) + 1) % 1_000_000:06d}"
        mutations.extend(["shared_name", "shared_date_of_birth", "shared_school"])
    elif family == "registry_collision":
        # Distinct children in the same school can have several deceptively
        # consistent fields: sibling/guardian overlap plus an admission-register
        # reuse and nearby certificate numbers. Labels still follow latent person
        # identity, never feature values.
        second["school_code"] = first["school_code"]
        second["guardian_id"] = first["guardian_id"]
        second["admission_number"] = first["admission_number"]
        first_date = date.fromisoformat(first["date_of_birth"])
        second["date_of_birth"] = (first_date + timedelta(days=rng.choice((-2, -1, 0, 1, 2)))).isoformat()
        first_tokens = first["full_name"].split()
        second_tokens = second["full_name"].split()
        second["full_name"] = f"{second_tokens[0]} {first_tokens[-1]}"
        if rng.random() < 0.5:
            digits = first["birth_certificate_number"].removeprefix("BC-")
            second["birth_certificate_number"] = f"BC-{(int(digits) + rng.choice((-2, -1, 1, 2))) % 1_000_000:06d}"
        mutations.extend(["shared_school", "shared_guardian", "reused_admission_number", "close_date_of_birth"])
    elif family == "same_school_same_dob_classmates":
        first["school_code"] = second["school_code"] = rng.choice(SCHOOLS)
        first["full_name"], second["full_name"] = rng.sample(COMMON_KENYAN_NAMES, 2)
        second["date_of_birth"] = first["date_of_birth"]
        mutations.extend(["shared_school", "shared_date_of_birth", "common_name_collision"])
    elif family == "same_admission_different_school":
        second["admission_number"] = first["admission_number"]
        second["school_code"] = _other_school(first["school_code"], rng)
        mutations.append("admission_number_at_another_school")
    else:
        if rng.random() < 0.5:
            second["date_of_birth"] = first["date_of_birth"]
            mutations.append("shared_date_of_birth")
        else:
            second["full_name"] = f"{second['full_name'].split()[0]} {first['full_name'].split()[-1]}"
            mutations.append("shared_surname")

    return first, second, family, mutations


def _light_noise(
    record: dict[str, str], rng: random.Random, difficulty: float, *, preserve_guardian: bool = False
) -> tuple[dict[str, str], list[str]]:
    """Vary record-entry quality without making it a proxy for the pair label."""
    observed = dict(record)
    mutations: list[str] = []
    if rng.random() < 0.10 + 0.18 * difficulty:
        observed["full_name"], mutation = _mutate_name(record["full_name"], rng)
        mutations.append(mutation)
    if rng.random() < 0.08 + 0.16 * difficulty:
        observed["date_of_birth"], mutation = _mutate_dob(record["date_of_birth"], rng)
        mutations.append(mutation)
    if rng.random() < 0.10 + 0.16 * difficulty:
        observed["admission_number"], mutation = _mutate_admission(record["admission_number"], rng)
        mutations.append(mutation)
    if not preserve_guardian and rng.random() < 0.05 + 0.12 * difficulty:
        observed["guardian_id"] = _record(rng)["guardian_id"]
        mutations.append("guardian_id_entry_error")
    if rng.random() < 0.04 + 0.12 * difficulty:
        observed["birth_certificate_number"], mutation = _mutate_birth_certificate(
            record["birth_certificate_number"], rng
        )
        mutations.append(mutation)
    return observed, mutations


def _row(
    seed: int,
    group_index: int,
    identity_1: str,
    identity_2: str,
    label: int,
    variation: str,
    mutations: list[str],
    first: dict[str, str],
    second: dict[str, str],
    difficulty: float,
    rng: random.Random,
) -> dict[str, object]:
    # Missingness is applied to both classes by the same mechanism, after the
    # class-specific scenarios have been generated. This avoids a label cue from
    # one class masking fewer records than the other.
    first, second = dict(first), dict(second)
    missing = _apply_missing(first, rng)
    missing.extend(_apply_missing(second, rng))
    mutations = [*mutations, *missing]
    features = build_pair_features(first, second)
    return {
        "group_id": f"{seed}-{group_index}",
        "identity_1": identity_1,
        "identity_2": identity_2,
        "scenario": variation,
        "variation": variation,
        "difficulty_band": _difficulty_band(features),
        "mutations": "|".join(mutations),
        "difficulty": round(difficulty, 4),
        "label": int(label),
        "name_1": first["full_name"], "name_2": second["full_name"],
        "dob_1": first["date_of_birth"], "dob_2": second["date_of_birth"],
        "school_1": first["school_code"], "school_2": second["school_code"],
        "guardian_1": first["guardian_id"], "guardian_2": second["guardian_id"],
        "admission_number_1": first["admission_number"],
        "admission_number_2": second["admission_number"],
        "birth_certificate_1": first["birth_certificate_number"],
        "birth_certificate_2": second["birth_certificate_number"],
        **features,
    }


def generate(pair_count: int, seed: int) -> pd.DataFrame:
    if pair_count < 2 or pair_count % 2:
        raise ValueError("pair_count must be a positive even number")
    rng = random.Random(seed)
    rows: list[dict[str, object]] = []
    group_count = pair_count // 2
    labels = [1] * (group_count // 2) + [0] * (group_count - group_count // 2)
    rng.shuffle(labels)
    positive_groups = [index for index, label in enumerate(labels) if label == 1]
    negative_groups = [index for index, label in enumerate(labels) if label == 0]
    hard_positive_groups = set(rng.sample(positive_groups, round(CHALLENGE_FRACTION * len(positive_groups))))
    hard_negative_groups = set(rng.sample(negative_groups, round(CHALLENGE_FRACTION * len(negative_groups))))
    # Draw quality values before generating either class, so class-specific
    # branches cannot shift the random stream and couple difficulty to label.
    difficulties = [rng.betavariate(2.0, 2.0) for _ in labels]
    for group_index, (label, difficulty) in enumerate(zip(labels, difficulties)):
        if label:
            base = _record(rng)
            identity = f"{seed}-{group_index}-student"
            for _ in range(2):
                observed, mutations = _duplicate_observation(
                    base, rng, difficulty, challenging=group_index in hard_positive_groups
                )
                rows.append(_row(
                    seed, group_index, identity, identity, 1, _positive_category(mutations), mutations,
                    base, observed, difficulty, rng,
                ))
        else:
            first_base, second_base, family, family_mutations = _negative_pair(
                rng, blocked_collision=group_index in hard_negative_groups
            )
            identity_1 = f"{seed}-{group_index}-student-a"
            identity_2 = f"{seed}-{group_index}-student-b"
            for _ in range(2):
                is_blocked_collision = group_index in hard_negative_groups
                first, first_mutations = _light_noise(first_base, rng, difficulty, preserve_guardian=is_blocked_collision)
                second, second_mutations = _light_noise(second_base, rng, difficulty, preserve_guardian=is_blocked_collision)
                mutations = family_mutations + first_mutations + second_mutations
                rows.append(_row(
                    seed, group_index, identity_1, identity_2, 0, family, mutations,
                    first, second, difficulty, rng,
                ))
    return pd.DataFrame(rows).sample(frac=1, random_state=seed).reset_index(drop=True)


def _component_splits(frame: pd.DataFrame, seed: int = 451_202) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split complete identity/guardian connected components, never individual rows."""
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[b] = a

    groups = frame.groupby("group_id", sort=False)
    for group_id, rows in groups:
        group_node = f"group:{group_id}"
        find(group_node)
        for column in ("identity_1", "identity_2"):
            for identity in rows[column].unique():
                if pd.notna(identity):
                    union(group_node, f"identity:{identity}")
        for column in ("guardian_1", "guardian_2"):
            for guardian in rows[column].unique():
                compact = "".join(char for char in str(guardian).casefold() if char.isalnum())
                if compact and compact not in {"unknown", "notprovided", "na", "none"}:
                    union(group_node, f"guardian:{compact}")

    components: dict[str, list[str]] = defaultdict(list)
    for group_id in groups.groups:
        components[find(f"group:{group_id}")].append(group_id)
    items = list(components.values())
    random.Random(seed).shuffle(items)
    target_rows = (TRAIN_PAIRS, VALIDATION_PAIRS, HOLDOUT_PAIRS)
    assigned: list[list[str]] = [[], [], []]
    sizes = [0, 0, 0]
    # Greedy size balancing. Components are indivisible, so output sizes may vary
    # slightly from targets; preserving identity isolation is the priority.
    for component in sorted(items, key=len, reverse=True):
        destination = min(range(3), key=lambda index: sizes[index] / target_rows[index])
        assigned[destination].extend(component)
        sizes[destination] += sum(len(groups.get_group(group_id)) for group_id in component)
    return tuple(frame[frame.group_id.isin(group_ids)].reset_index(drop=True) for group_ids in assigned)


def main() -> None:
    for path in (TRAIN_FILE, VALIDATION_FILE, HOLDOUT_FILE):
        path.parent.mkdir(parents=True, exist_ok=True)
    # Generate one population before splitting so shared identities and guardian
    # clusters are visible to the connected-component allocator.
    population = generate(TRAIN_PAIRS + VALIDATION_PAIRS + HOLDOUT_PAIRS, TRAIN_SEED)
    train, validation, holdout = _component_splits(population, seed=SPLIT_SEED)
    train.to_csv(TRAIN_FILE, index=False)
    validation.to_csv(VALIDATION_FILE, index=False)
    holdout.to_csv(HOLDOUT_FILE, index=False)
    print(f"Wrote {len(train)} training rows to {TRAIN_FILE}")
    print(f"Wrote {len(validation)} validation rows to {VALIDATION_FILE}")
    print(f"Wrote {len(holdout)} final-test rows to {HOLDOUT_FILE}")


if __name__ == "__main__":
    main()
