"""Generate attachment-style noisy records with labels tied to latent identity.

The pasted generator randomized labels and similarity features independently of
the records. This version keeps its malformed/missing/noisy-value scenarios but
labels pairs from whether both records share a hidden student identity and
derives comparison features from the cleaned record values.
"""

from __future__ import annotations

import random
import string
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

from feature_engineering import build_pair_features

SCHOOLS = ["Nairobi School", "Alliance High", "Bishop Gatimu", "Loreto Limuru", "Maranda"]
TRAIN_NAMES = [
    "Mukhwana Njenga", "Achieng Otieno", "Kiprono Kamau", "Wanjiku Mwangi",
    "Omondi Njoroge", "Naliaka Wambui", "Kibet Chelangat", "Mutua Kimani",
    "Fatuma Juma", "Hassan Ali", "John Doe", "Test User", "????", "12345",
]
HOLDOUT_NAMES = [
    "Abdi Farah", "Adan Hussein", "Binti Wekesa", "Chepkemoi Bett",
    "Damaris Gichuru", "Eunice Nduta", "Fadhili Chacha", "Gathoni Karanja",
    "Halima Yusuf", "Imani Chege", "Jelimo Lagat", "Kendi Auma",
    "Linet Oloo", "Mariam Said", "Nasra Dulo", "Okwaro Bwire",
    "Pauline Talam", "Qureshi Jabali", "Rahma Zuberi", "Sakina Guda",
    "Tabitha Etyang", "Umi Mabala", "Violet Haji", "Wairimu Rono",
    "Xolani Dida", "Yasmin Umar", "Zawadi Pasha", "Asman Vumbi",
]
INVALID = {
    "????", "12345", "N/A", "UNKNOWN", "SCH001", "SCH009", "0000-00-00",
    "G000000", "UPI-00000000", "BC-000000",
}


def _random_garbage(rng: random.Random, profile: str) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return profile[0].upper() + "".join(rng.choices(alphabet, k=rng.randint(3, 12)))


def _dob(rng: random.Random, profile: str) -> str:
    base_year = 1995 if profile == "train" else 2008
    value = date(base_year, 1, 1) + timedelta(days=rng.randrange(8 * 365))
    mode = rng.random()
    if mode < 0.15:
        # Profile-coded invalid values cannot collide between the two datasets.
        return f"BAD-{profile[0].upper()}-{_random_garbage(rng, profile)}"
    if mode < 0.35:
        return value.strftime("%d/%m/%Y")
    return value.isoformat()


def _identifier(rng: random.Random, prefix: str, profile: str) -> str:
    if rng.random() < 0.20:
        return _random_garbage(rng, profile)
    midpoint = 500_000
    number = rng.randrange(100_000, midpoint) if profile == "train" else rng.randrange(midpoint, 900_000)
    return f"{prefix}{number}"


def _record(rng: random.Random, profile: str) -> dict[str, str]:
    names = TRAIN_NAMES if profile == "train" else HOLDOUT_NAMES
    name = _random_garbage(rng, profile) if rng.random() < 0.20 else rng.choice(names)
    school_choices = [*SCHOOLS, "SCH001", "SCH009", "Unknown", "N/A"]
    return {
        "full_name": name,
        "date_of_birth": _dob(rng, profile),
        "school_code": rng.choice(school_choices),
        "guardian_id": _identifier(rng, "G", profile),
        "upi": _identifier(rng, "UPI-", profile),
        "birth_certificate_number": _identifier(rng, "BC-", profile),
    }


def _corrupt_field(record: dict[str, str], field: str, rng: random.Random, profile: str) -> None:
    if field == "full_name":
        record[field] = _random_garbage(rng, profile) if rng.random() < 0.35 else rng.choice(
            TRAIN_NAMES if profile == "train" else HOLDOUT_NAMES
        )
    elif field == "date_of_birth":
        record[field] = _dob(rng, profile)
    elif field == "school_code":
        record[field] = rng.choice([*SCHOOLS, "SCH001", "SCH009", "Unknown", "N/A"])
    elif field == "guardian_id":
        record[field] = _identifier(rng, "G", profile)
    elif field == "upi":
        record[field] = _identifier(rng, "UPI-", profile)
    else:
        record[field] = _identifier(rng, "BC-", profile)


def _pair_for_identity(base: dict[str, str], rng: random.Random, profile: str) -> tuple[dict[str, str], dict[str, str], str]:
    first, second = dict(base), dict(base)
    scenario = rng.choice(("identical", "slight_similarity", "completely_different", "garbage"))
    if scenario == "identical":
        pass
    elif scenario == "slight_similarity":
        second["full_name"] = " ".join(reversed(base["full_name"].split())) if len(base["full_name"].split()) > 1 else base["full_name"] + " Jr"
        for field, rate in (("school_code", 0.50), ("upi", 0.50), ("birth_certificate_number", 0.35)):
            if rng.random() < rate:
                _corrupt_field(second, field, rng, profile)
    elif scenario == "completely_different":
        for field in second:
            if rng.random() < 0.85:
                _corrupt_field(second, field, rng, profile)
    else:
        second.update({
            "full_name": _random_garbage(rng, profile),
            "date_of_birth": "0000-00-00",
            "school_code": "N/A",
            "guardian_id": "G000000",
            "upi": "UPI-00000000",
            "birth_certificate_number": "BC-000000",
        })
    return first, second, scenario


def _nonidentity_pair(first: dict[str, str], rng: random.Random, profile: str) -> tuple[dict[str, str], dict[str, str], str]:
    second = _record(rng, profile)
    scenario = rng.choice(("similar_demographics", "hard_collision", "completely_different", "garbage"))
    if scenario == "similar_demographics":
        second["full_name"] = first["full_name"] if rng.random() < 0.25 else second["full_name"]
        for field, rate in (("date_of_birth", 0.45), ("school_code", 0.70), ("guardian_id", 0.55)):
            if rng.random() < rate:
                second[field] = first[field]
        # Different stable identifiers keep the records distinct despite shared demographics.
        for field in ("upi", "birth_certificate_number"):
            if second[field] == first[field]:
                _corrupt_field(second, field, rng, profile)
    elif scenario == "hard_collision":
        for field, rate in (("full_name", 0.75), ("date_of_birth", 0.60), ("school_code", 0.90), ("guardian_id", 0.75)):
            if rng.random() < rate:
                second[field] = first[field] if rng.random() < 0.65 else second[field]
        # At least one stable identifier differs, while rare collisions remain possible.
        if second["upi"] == first["upi"] and rng.random() < 0.98:
            _corrupt_field(second, "upi", rng, profile)
        if second["birth_certificate_number"] == first["birth_certificate_number"] and rng.random() < 0.98:
            _corrupt_field(second, "birth_certificate_number", rng, profile)
    elif scenario == "garbage":
        second.update({
            "full_name": _random_garbage(rng, profile),
            "date_of_birth": "0000-00-00",
            "school_code": "N/A",
            "guardian_id": "G000000",
            "upi": "UPI-00000000",
            "birth_certificate_number": "BC-000000",
        })
    return first, second, scenario


def _clean_record(record: dict[str, str]) -> dict[str, str | None]:
    name = record["full_name"].strip().title()
    school = record["school_code"].strip().title()
    if name.upper() in INVALID:
        name = ""
    if school.upper() not in {item.upper() for item in SCHOOLS}:
        school = ""
    try:
        dob = datetime.strptime(record["date_of_birth"], "%Y-%m-%d").date().isoformat()
    except ValueError:
        try:
            dob = datetime.strptime(record["date_of_birth"], "%d/%m/%Y").date().isoformat()
        except ValueError:
            dob = ""
    return {
        "full_name": name,
        "date_of_birth": dob,
        "school_code": school,
        "guardian_id": record["guardian_id"].strip().upper() if record["guardian_id"].upper() not in INVALID else "",
        "upi": record["upi"].strip().upper() if record["upi"].upper() not in INVALID else "",
        "birth_certificate_number": record["birth_certificate_number"].strip().upper() if record["birth_certificate_number"].upper() not in INVALID else "",
    }


def generate_pairs(num_pairs: int = 10_000, positive_rate: float = 0.5, seed: int = 42, profile: str = "train") -> pd.DataFrame:
    if num_pairs <= 0 or num_pairs % 2:
        raise ValueError("num_pairs must be a positive even number")
    if not 0 < positive_rate < 1 or profile not in {"train", "holdout"}:
        raise ValueError("positive_rate must be between zero and one and profile must be train or holdout")
    rng = random.Random(seed)
    group_count = num_pairs // 2
    positive_groups = round(group_count * positive_rate)
    labels = [1] * positive_groups + [0] * (group_count - positive_groups)
    rng.shuffle(labels)
    rows = []
    for group_index, label in enumerate(labels):
        first_identity = _record(rng, profile)
        for _ in range(2):
            if label:
                first, second, scenario = _pair_for_identity(first_identity, rng, profile)
            else:
                first, second, scenario = _nonidentity_pair(first_identity, rng, profile)
            clean_first, clean_second = _clean_record(first), _clean_record(second)
            rows.append({
                "name_1": first["full_name"], "name_2": second["full_name"],
                "dob_1": first["date_of_birth"], "dob_2": second["date_of_birth"],
                "school_1": first["school_code"], "school_2": second["school_code"],
                "guardian_1": first["guardian_id"], "guardian_2": second["guardian_id"],
                "upi_1": first["upi"], "upi_2": second["upi"],
                "birth_certificate_1": first["birth_certificate_number"],
                "birth_certificate_2": second["birth_certificate_number"],
                **build_pair_features(clean_first, clean_second),
                "label": int(label), "group_id": seed * 100_000 + group_index,
                "pair_scenario": scenario,
            })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    base = Path(__file__).resolve().parent
    (base / "training").mkdir(exist_ok=True)
    (base / "evaluation").mkdir(exist_ok=True)
    generate_pairs(seed=315_117, profile="train").to_csv(base / "training" / "pairs_attachment_style_train.csv", index=False)
    generate_pairs(seed=426_229, profile="holdout").to_csv(base / "evaluation" / "pairs_attachment_style_holdout.csv", index=False)
