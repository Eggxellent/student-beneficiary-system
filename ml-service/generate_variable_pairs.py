"""Generate imbalanced pairs with broad, overlapping identity-field variation."""

from __future__ import annotations

import random
from datetime import date, timedelta

import pandas as pd

from feature_engineering import build_pair_features

SCHOOLS = ["Nairobi School", "Alliance High", "Bishop Gatimu", "Loreto Limuru", "Maranda"]
FIRST = [
    "Wanjiku", "Achieng", "Kiprono", "Omondi", "Naliaka", "Kibet", "Fatuma", "Juma",
    "Chebet", "Otieno", "Mukhwana", "Njenga", "Mwangi", "Mutua", "Wambui", "Amina",
    "Barasa", "Wafula", "Nyambura", "Kariuki", "Atieno", "Kamau", "Hassan", "Njeri",
    "Maina", "Ochieng", "Muthoni", "Koech", "Jepchirchir", "Musau", "Njoroge", "Odhiambo",
]
LAST = [
    "Kamau", "Otieno", "Maina", "Kariuki", "Chelangat", "Oduor", "Njoroge", "Wambui",
    "Kimani", "Onyango", "Amina", "Barasa", "Wafula", "Macharia", "Ochieng", "Mwangi",
    "Muthoni", "Koech", "Jepchirchir", "Musau", "Njenga", "Achieng", "Mutua", "Wanjiku",
    "Kiptoo", "Naliaka", "Juma", "Hassan", "Chebet", "Omondi", "Mukhwana", "Kibet",
]
# The independent evaluation dataset has disjoint names and identifier ranges.
HOLDOUT_FIRST = [
    "Abdi", "Adan", "Binti", "Chepkemoi", "Damaris", "Eunice", "Fadhili", "Gathoni",
    "Halima", "Imani", "Jelimo", "Kendi", "Linet", "Mariam", "Nasra", "Okwaro",
    "Pauline", "Qureshi", "Rahma", "Sakina", "Tabitha", "Umi", "Violet", "Wairimu",
    "Xolani", "Yasmin", "Zawadi", "Asman", "Biko", "Chao", "Denge", "Eshe",
]
HOLDOUT_LAST = [
    "Abubakar", "Bett", "Chacha", "Dulo", "Eshun", "Farah", "Gichuru", "Hussein",
    "Ibrahim", "Jabali", "Karanja", "Lagat", "Mabala", "Nduta", "Oloo", "Pasha",
    "Qadri", "Rono", "Said", "Talam", "Umar", "Vumbi", "Wekesa", "Yusuf",
    "Zuberi", "Auma", "Bwire", "Chege", "Dida", "Etyang", "Guda", "Haji",
]
SEVERITY = {
    "light": {"name": 0.92, "dob": 0.95, "school": 0.92, "guardian": 0.88, "upi": 0.94, "birth": 0.92},
    "moderate": {"name": 0.68, "dob": 0.76, "school": 0.68, "guardian": 0.62, "upi": 0.72, "birth": 0.70},
    "severe": {"name": 0.34, "dob": 0.42, "school": 0.38, "guardian": 0.32, "upi": 0.38, "birth": 0.40},
}


def _date(rng: random.Random, profile: str) -> str:
    start = date(2000 if profile == "train" else 2008, 1, 1)
    return (start + timedelta(days=rng.randrange(8 * 365))).isoformat()


def _id(rng: random.Random, prefix: str, size: int, profile: str) -> str:
    midpoint = 10 ** size // 2
    low, high = (0, midpoint) if profile == "train" else (midpoint, 10 ** size)
    return f"{prefix}-{rng.randrange(low, high):0{size}d}"


def _student(rng: random.Random, profile: str) -> dict[str, str]:
    first_names, last_names = (FIRST, LAST) if profile == "train" else (HOLDOUT_FIRST, HOLDOUT_LAST)
    return {
        "full_name": f"{rng.choice(first_names)} {rng.choice(last_names)}",
        "date_of_birth": _date(rng, profile),
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"G{_id(rng, '', 6, profile).lstrip('-')}",
        "upi": _id(rng, "UPI", 8, profile),
        "birth_certificate_number": _id(rng, "BC", 6, profile),
    }


def _typo(value: str, rng: random.Random) -> str:
    chars = list(value)
    letters = [i for i, char in enumerate(chars) if char.isalpha()]
    if not letters:
        return value
    pos = rng.choice(letters)
    operation = rng.choice(("replace", "drop", "swap", "insert"))
    if operation == "drop":
        chars.pop(pos)
    elif operation == "swap" and pos + 1 < len(chars):
        chars[pos], chars[pos + 1] = chars[pos + 1], chars[pos]
    elif operation == "insert":
        chars.insert(pos, rng.choice("abcdefghijklmnopqrstuvwxyz"))
    else:
        chars[pos] = rng.choice("abcdefghijklmnopqrstuvwxyz")
    return "".join(chars)


def _duplicate_pair(base: dict[str, str], rng: random.Random, profile: str) -> tuple[dict[str, str], dict[str, str]]:
    first, second = dict(base), dict(base)
    first_names, last_names = (FIRST, LAST) if profile == "train" else (HOLDOUT_FIRST, HOLDOUT_LAST)
    severity = rng.choices(("light", "moderate", "severe"), (0.25, 0.50, 0.25))[0]
    rates = SEVERITY[severity]

    if rng.random() >= rates["name"]:
        name_mode = rng.choices(("typo", "order", "partial", "different"), (0.40, 0.15, 0.10, 0.35))[0]
        if name_mode == "typo":
            second["full_name"] = _typo(base["full_name"], rng)
        elif name_mode == "order":
            second["full_name"] = " ".join(reversed(base["full_name"].split()))
        elif name_mode == "partial":
            second["full_name"] = base["full_name"].split()[0]
        else:
            second["full_name"] = f"{rng.choice(first_names)} {rng.choice(last_names)}"
    if rng.random() >= rates["dob"]:
        second["date_of_birth"] = _date(rng, profile)
    if rng.random() >= rates["school"]:
        second["school_code"] = rng.choice(SCHOOLS)
    if rng.random() >= rates["guardian"]:
        second["guardian_id"] = f"G{_id(rng, '', 6, profile).lstrip('-')}"
    if rng.random() >= rates["upi"]:
        second["upi"] = _id(rng, "UPI", 8, profile)
    if rng.random() >= rates["birth"]:
        second["birth_certificate_number"] = _id(rng, "BC", 6, profile)
    return first, second


def _nonduplicate_pair(rng: random.Random, profile: str) -> tuple[dict[str, str], dict[str, str]]:
    first, second = _student(rng, profile), _student(rng, profile)
    _, last_names = (FIRST, LAST) if profile == "train" else (HOLDOUT_FIRST, HOLDOUT_LAST)
    difficulty = rng.choices(("ordinary", "similar_demographics", "hard_collision"), (0.65, 0.25, 0.10))[0]
    if difficulty == "similar_demographics":
        if rng.random() < 0.55:
            second["full_name"] = f"{first['full_name'].split()[0]} {rng.choice(last_names)}"
        if rng.random() < 0.25:
            second["date_of_birth"] = first["date_of_birth"]
        if rng.random() < 0.45:
            second["school_code"] = first["school_code"]
        if rng.random() < 0.20:
            second["guardian_id"] = first["guardian_id"]
    elif difficulty == "hard_collision":
        if rng.random() < 0.70:
            second["full_name"] = first["full_name"] if rng.random() < 0.35 else _typo(first["full_name"], rng)
        if rng.random() < 0.50:
            second["date_of_birth"] = first["date_of_birth"]
        if rng.random() < 0.70:
            second["school_code"] = first["school_code"]
        if rng.random() < 0.35:
            second["guardian_id"] = first["guardian_id"]
        if rng.random() < 0.03:
            second["upi"] = first["upi"]
        if rng.random() < 0.03:
            second["birth_certificate_number"] = first["birth_certificate_number"]
    return first, second


def generate_pairs(num_pairs: int = 10_000, positive_rate: float = 0.05, seed: int = 91_427, profile: str = "train") -> pd.DataFrame:
    if num_pairs <= 0 or num_pairs % 2:
        raise ValueError("num_pairs must be a positive even number.")
    if not 0 < positive_rate < 1:
        raise ValueError("positive_rate must be between zero and one.")
    if profile not in {"train", "holdout"}:
        raise ValueError("profile must be 'train' or 'holdout'.")
    rng = random.Random(seed)
    group_count = num_pairs // 2
    positive_groups = round(group_count * positive_rate)
    labels = [1] * positive_groups + [0] * (group_count - positive_groups)
    rng.shuffle(labels)
    rows = []
    for group_index, label in enumerate(labels):
        base = _student(rng, profile) if label else None
        for _ in range(2):
            first, second = _duplicate_pair(base, rng, profile) if label else _nonduplicate_pair(rng, profile)
            rows.append({
                "name_1": first["full_name"],
                "name_2": second["full_name"],
                # Retain synthetic raw values for auditing disjointness. Model fitting
                # selects only FEATURE_COLUMNS, so these columns are never features.
                "dob_1": first["date_of_birth"],
                "dob_2": second["date_of_birth"],
                "school_1": first["school_code"],
                "school_2": second["school_code"],
                "guardian_1": first["guardian_id"],
                "guardian_2": second["guardian_id"],
                "upi_1": first["upi"],
                "upi_2": second["upi"],
                "birth_certificate_1": first["birth_certificate_number"],
                "birth_certificate_2": second["birth_certificate_number"],
                **build_pair_features(first, second),
                "label": int(label),
                "group_id": seed * 100_000 + group_index,
            })
    return pd.DataFrame(rows)
