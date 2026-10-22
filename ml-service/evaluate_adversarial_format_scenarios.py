"""Inference-only stress test for malformed formats and name shortcuts.

The challenge is generated from explicit latent-identity scenarios and reads no
training or previous evaluation CSVs. It scores frozen models only.
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import date, timedelta
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, average_precision_score, balanced_accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score

from feature_engineering import FEATURE_COLUMNS, build_pair_features

BASE = Path(__file__).resolve().parent
DATA_FILE = BASE / "evaluation" / "adversarial_format_scenarios.csv"
REPORT_FILE = BASE / "evaluation" / "adversarial_format_scenarios_metrics.json"
MODELS = {
    "current_xgboost_model": BASE / "model" / "xgb_duplicate_model.joblib",
}
SEED = 20261022
ROWS_PER_SCENARIO = 250
THRESHOLD = 0.5
FIELDS = ("full_name", "date_of_birth", "school_code", "guardian_id", "upi", "birth_certificate_number")
GIVEN = ("Nyaru", "Taveti", "Elunai", "Mbedzi", "Kivuli", "Chisomo", "Tarehe", "Zuberiya", "Kahindi", "Mwangaza", "Tembeka", "Lukonde", "Mirembe", "Ntabo", "Wekulo", "Kasenyi")
SURNAMES = ("Vumbari", "Chisale", "Nkomola", "Tembozi", "Mabundani", "Kavulani", "Ndalama", "Zawadika", "Kalumbwe", "Chilufya", "Lukwesa", "Chibale", "Nankhuni", "Vundla", "Mulebwa", "Kisandji")
SCHOOLS = ("Mawingu East Academy", "Kijani Ridge School", "Taveta Learning Centre", "Ndalama Valley School", "Kisiwa View Academy", "Mtoni Plains School")

SCENARIOS = {
    "positive_case_whitespace": 1,
    "positive_swapped_punctuated_name": 1,
    "positive_diacritic_name": 1,
    "positive_initials": 1,
    "positive_truncated_name": 1,
    "positive_date_format_change": 1,
    "positive_identifier_separators": 1,
    "positive_identifier_case_change": 1,
    "positive_unicode_homoglyph": 1,
    "positive_rekeyed_identifiers": 1,
    "positive_sparse_fields": 1,
    "positive_shared_missing_markers": 1,
    "positive_garbage_name": 1,
    "negative_common_name_collision": 0,
    "negative_all_unknown_placeholders": 0,
    "negative_shared_placeholder_fields": 0,
    "negative_prefix_name_collision": 0,
    "negative_upi_collision_only": 0,
    "negative_birth_certificate_collision_only": 0,
    "negative_twins_shared_household": 0,
    "negative_unicode_near_name": 0,
    "negative_empty_name_normalization": 0,
    "negative_placeholder_name_only": 0,
    "negative_demographic_and_certificate_collision": 0,
    "negative_reformatted_id_collision": 0,
    "negative_common_name_and_shared_guardian": 0,
}


def student(rng: random.Random, index: int) -> dict[str, str]:
    birth = date(2001, 1, 1) + timedelta(days=rng.randrange(16 * 365))
    return {
        "full_name": f"{rng.choice(GIVEN)} {rng.choice(SURNAMES)}",
        "date_of_birth": birth.isoformat(),
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"FMT-G-{index:08d}",
        "upi": f"FMT-UPI-{index:09d}",
        "birth_certificate_number": f"FMT-BC-{index:09d}",
    }


def distinct_student(rng: random.Random, index: int, source: dict[str, str]) -> dict[str, str]:
    result = student(rng, index)
    while result["full_name"] == source["full_name"]:
        result["full_name"] = f"{rng.choice(GIVEN)} {rng.choice(SURNAMES)}"
    return result


def format_mutation(scenario: str, first: dict[str, str], rng: random.Random, index: int) -> dict[str, str]:
    second = dict(first)
    name = first["full_name"]
    given, surname = name.split(" ", 1)
    if scenario == "positive_case_whitespace":
        second["full_name"] = f"  {given.upper()}   {surname.lower()}  "
    elif scenario == "positive_swapped_punctuated_name":
        second["full_name"] = f"{surname}, {given}"
    elif scenario == "positive_diacritic_name":
        second["full_name"] = name.replace("a", "á", 1) if "a" in name else f"{given}é {surname}"
    elif scenario == "positive_initials":
        second["full_name"] = f"{given[0]}. {surname}"
    elif scenario == "positive_truncated_name":
        second["full_name"] = given
    elif scenario == "positive_date_format_change":
        year, month, day = first["date_of_birth"].split("-")
        second["date_of_birth"] = f"{day}/{month}/{year}"
    elif scenario == "positive_identifier_separators":
        second["upi"] = first["upi"].replace("-", " ")
        second["birth_certificate_number"] = first["birth_certificate_number"].replace("-", "")
    elif scenario == "positive_identifier_case_change":
        for field in ("guardian_id", "upi", "birth_certificate_number"):
            second[field] = first[field].lower()
    elif scenario == "positive_unicode_homoglyph":
        second["full_name"] = name.replace("a", "а", 1) if "a" in name else name.replace("i", "і", 1)
    elif scenario == "positive_rekeyed_identifiers":
        second["guardian_id"] = f"FMT-G-{index + 10_000_000:08d}"
        second["upi"] = f"FMT-UPI-{index + 10_000_000:09d}"
        second["birth_certificate_number"] = f"FMT-BC-{index + 10_000_000:09d}"
    elif scenario == "positive_sparse_fields":
        second["full_name"] = f"{given[0]} {surname}"
        for field in ("date_of_birth", "school_code", "guardian_id", "upi", "birth_certificate_number"):
            second[field] = ""
    elif scenario == "positive_shared_missing_markers":
        for field, marker in (("date_of_birth", "UNKNOWN"), ("school_code", "N/A"), ("guardian_id", "UNKNOWN"), ("upi", "000000"), ("birth_certificate_number", "000000")):
            first[field] = marker
            second[field] = marker
        second["full_name"] = f"{given[0]}. {surname}"
    elif scenario == "positive_garbage_name":
        second["full_name"] = "### 12345 !!!"
    return second


def negative_pair(scenario: str, first: dict[str, str], rng: random.Random, index: int) -> dict[str, str]:
    second = distinct_student(rng, index + 5_000_000, first)
    if scenario == "negative_common_name_collision":
        first["full_name"] = second["full_name"] = "John Doe"
    elif scenario == "negative_all_unknown_placeholders":
        for record in (first, second):
            record.update({"full_name": "UNKNOWN", "date_of_birth": "UNKNOWN", "school_code": "N/A", "guardian_id": "UNKNOWN", "upi": "UNKNOWN", "birth_certificate_number": "UNKNOWN"})
    elif scenario == "negative_shared_placeholder_fields":
        second["date_of_birth"] = first["date_of_birth"] = "UNKNOWN"
        second["school_code"] = first["school_code"] = "N/A"
        second["guardian_id"] = first["guardian_id"] = "UNKNOWN"
        second["upi"] = first["upi"] = "UNKNOWN"
        second["birth_certificate_number"] = first["birth_certificate_number"] = "UNKNOWN"
    elif scenario == "negative_prefix_name_collision":
        first["full_name"] = "Kahindi Mwangaza"
        second["full_name"] = "Kahindi Mwangazani"
    elif scenario == "negative_upi_collision_only":
        second["upi"] = first["upi"]
    elif scenario == "negative_birth_certificate_collision_only":
        second["birth_certificate_number"] = first["birth_certificate_number"]
    elif scenario == "negative_twins_shared_household":
        first["full_name"] = "Mirembe Kalumbwe"
        second["full_name"] = "Mirembe Kalumbwea"
        second["date_of_birth"] = first["date_of_birth"]
        second["school_code"] = first["school_code"]
        second["guardian_id"] = first["guardian_id"]
    elif scenario == "negative_unicode_near_name":
        first["full_name"] = "Jose Nchimbi"
        second["full_name"] = "José Nchimbi"
    elif scenario == "negative_empty_name_normalization":
        first["full_name"] = "12345"
        second["full_name"] = "????"
    elif scenario == "negative_placeholder_name_only":
        first["full_name"] = second["full_name"] = "N/A"
    elif scenario == "negative_demographic_and_certificate_collision":
        second["full_name"] = "Mirembe Kalumbwea"
        first["full_name"] = "Mirembe Kalumbwe"
        second["date_of_birth"] = first["date_of_birth"]
        second["school_code"] = first["school_code"]
        second["guardian_id"] = first["guardian_id"]
        second["birth_certificate_number"] = first["birth_certificate_number"]
    elif scenario == "negative_reformatted_id_collision":
        first["upi"] = f"FMT-UPI-{index:09d}"
        second["upi"] = f"FMTUPI{index:09d}"
    elif scenario == "negative_common_name_and_shared_guardian":
        first["full_name"] = second["full_name"] = "John Doe"
        second["guardian_id"] = first["guardian_id"]
    return second


def make_rows() -> pd.DataFrame:
    rng = random.Random(SEED)
    rows = []
    next_id = 1
    for scenario, label in SCENARIOS.items():
        for index in range(ROWS_PER_SCENARIO):
            first = student(rng, next_id)
            next_id += 1
            if label:
                second = format_mutation(scenario, first, rng, index)
            else:
                second = negative_pair(scenario, first, rng, index)
            row = {
                "group_id": f"format-{scenario}-{index}",
                "scenario": scenario,
                "label": label,
                "name_1": first["full_name"], "name_2": second["full_name"],
                "dob_1": first["date_of_birth"], "dob_2": second["date_of_birth"],
                "school_1": first["school_code"], "school_2": second["school_code"],
                "guardian_1": first["guardian_id"], "guardian_2": second["guardian_id"],
                "upi_1": first["upi"], "upi_2": second["upi"],
                "birth_certificate_1": first["birth_certificate_number"],
                "birth_certificate_2": second["birth_certificate_number"],
                **build_pair_features(first, second),
            }
            rows.append(row)
    return pd.DataFrame(rows)


def metrics(labels: pd.Series, probabilities) -> dict[str, object]:
    predicted = (probabilities >= THRESHOLD).astype(int)
    matrix = confusion_matrix(labels, predicted, labels=[0, 1])
    tn, fp, fn, tp = (int(x) for x in matrix.ravel())
    return {
        "threshold": THRESHOLD,
        "accuracy": float(accuracy_score(labels, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "average_precision": float(average_precision_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn, "false_positives": fp,
        "false_negatives": fn, "true_positives": tp,
    }


def main() -> dict[str, object]:
    dataset = make_rows()
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(DATA_FILE, index=False)
    data_hash = hashlib.sha256(DATA_FILE.read_bytes()).hexdigest()
    model_results = {}
    for name, path in MODELS.items():
        if not path.exists():
            continue
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        model = joblib.load(path)
        scores = model.predict_proba(dataset[FEATURE_COLUMNS])[:, 1]
        after = hashlib.sha256(path.read_bytes()).hexdigest()
        if before != after:
            raise RuntimeError(f"Model changed during inference: {name}")
        scenario_results = {}
        for scenario, group in dataset.groupby("scenario", sort=True):
            positions = group.index.to_numpy()
            scenario_scores = scores[positions]
            labels = group.label.astype(int)
            preds = (scenario_scores >= THRESHOLD).astype(int)
            label = int(labels.iloc[0])
            scenario_results[scenario] = {
                "label": label,
                "rows": int(len(group)),
                "accuracy": float(accuracy_score(labels, preds)),
                "mean_duplicate_score": float(scenario_scores.mean()),
                "false_positive_rate": float(preds.mean()) if label == 0 else None,
                "recall": float(preds.mean()) if label == 1 else None,
            }
        model_results[name] = {
            "model_file": str(path.relative_to(BASE)),
            "model_sha256_before": before,
            "model_sha256_after": after,
            "overall_metrics": metrics(dataset.label.astype(int), scores),
            "scenario_metrics": scenario_results,
        }

    result = {
        "evaluation_only": True,
        "training_performed": False,
        "training_data_read": False,
        "threshold_tuned": False,
        "seed": SEED,
        "threshold": THRESHOLD,
        "rows_per_scenario": ROWS_PER_SCENARIO,
        "scenario_count": len(SCENARIOS),
        "challenge_file": str(DATA_FILE.relative_to(BASE)),
        "challenge_sha256": data_hash,
        "rows": int(len(dataset)),
        "class_counts": {str(k): int(v) for k, v in dataset.label.value_counts().sort_index().items()},
        "scenario_labels": SCENARIOS,
        "feature_columns": FEATURE_COLUMNS,
        "models": model_results,
        "limitations": [
            "The challenge cases are generated and do not estimate live SBMS performance.",
            "Scenario counts are balanced by design; aggregate accuracy is not production accuracy.",
            "Malformed strings and placeholder conventions are stress cases, not claims about the frequency of such records.",
            "This report is evaluation-only; the challenge must not be used as training or threshold-tuning data.",
        ],
    }
    REPORT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
