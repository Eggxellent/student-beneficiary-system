"""Run inference-only evaluation on the user's randomized synthetic holdout.

This script does not call fit(), training scripts, or model-saving functions.
It writes the generated CSV and metrics only under ml-service/evaluation/.
"""

from __future__ import annotations

import hashlib
import json
import random
import string
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score

from feature_engineering import FEATURE_COLUMNS

BASE_DIR = Path(__file__).resolve().parent
MODEL_FILE = BASE_DIR / "model" / "xgb_duplicate_model.joblib"
TRAINING_FILE = BASE_DIR / "data" / "features.csv"
OUTPUT_DIR = BASE_DIR / "evaluation"
DATASET_FILE = OUTPUT_DIR / "synthetic_student_pairs_randomized.csv"
RESULT_FILE = OUTPUT_DIR / "synthetic_student_pairs_randomized_metrics.json"


def generate_unpredictable_pairs(num_pairs: int = 10_000, num_groups: int = 5_000, seed: int = 12_345) -> pd.DataFrame:
    random.seed(seed)
    np.random.seed(seed)

    schools = [
        "Highridge Academy", "St. Jude Secondary", "Mazingira School",
        "Kilimani Primary", "Riverside High",
    ]
    first_names = [
        "Mukhwana", "Njenga", "Achieng", "Kiprono", "Wanjiku", "Omondi",
        "Mwangi", "Naliaka", "Kibet", "Mutua", "Fatuma", "Juma", "Hassan",
        "Chebet", "Otieno",
    ]
    last_names = [
        "Kamau", "Otieno", "Maina", "Kariuki", "Chelangat", "Oduor",
        "Njoroge", "Wambui", "Kimani", "Onyango", "Amina", "Barasa", "Wafula",
    ]

    def add_noise_to_string(text: str, noise_prob: float = 0.3) -> str:
        if random.random() > noise_prob or len(text) < 3:
            return text
        chars = list(text)
        action = random.choice(["swap", "drop", "insert", "replace"])
        position = random.randint(0, len(chars) - 2)
        if action == "swap":
            chars[position], chars[position + 1] = chars[position + 1], chars[position]
        elif action == "drop":
            chars.pop(position)
        elif action == "insert":
            chars.insert(position, random.choice(string.ascii_lowercase))
        else:
            chars[position] = random.choice(string.ascii_lowercase)
        return "".join(chars)

    def random_dob() -> str:
        return f"{random.randint(2002, 2015):04d}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"

    rows = []
    group_ids = np.repeat(np.arange(1000, 1000 + num_groups), 2)
    labels = [1] * (num_pairs // 2) + [0] * (num_pairs // 2)
    random.shuffle(labels)

    for index, label in enumerate(labels):
        group_id = int(group_ids[index])
        first_name = random.choice(first_names)
        last_name = random.choice(last_names)
        name_1 = f"{first_name} {last_name}"
        dob_1 = random_dob()
        school_1 = random.choice(schools)
        guardian_1 = f"G{random.randint(100000, 999999)}"
        upi_1 = f"UPI-{random.randint(10000000, 99999999)}"

        if label == 1:
            name_mode = random.choices(["exact", "typo", "swapped", "partial"], weights=[0.35, 0.35, 0.15, 0.15])[0]
            if name_mode == "exact":
                name_2 = name_1
            elif name_mode == "typo":
                name_2 = add_noise_to_string(name_1, noise_prob=0.8)
            elif name_mode == "swapped":
                name_2 = f"{last_name} {first_name}"
            else:
                name_2 = first_name
            dob_2 = dob_1 if random.random() < 0.70 else random_dob()
            school_2 = school_1 if random.random() < 0.65 else random.choice(schools)
            guardian_2 = guardian_1 if random.random() < 0.60 else f"G{random.randint(100000, 999999)}"
            upi_2 = upi_1 if random.random() < 0.55 else f"UPI-{random.randint(10000000, 99999999)}"
            birth_certificate_match = int(random.random() > 0.05)
        else:
            second_first_name = first_name if random.random() < 0.10 else random.choice(first_names)
            second_last_name = last_name if random.random() < 0.20 else random.choice(last_names)
            name_2 = f"{second_first_name} {second_last_name}"
            if random.random() < 0.15:
                name_2 = add_noise_to_string(name_2, noise_prob=0.5)
            dob_2 = dob_1 if random.random() < 0.12 else random_dob()
            school_2 = school_1 if random.random() < 0.30 else random.choice(schools)
            guardian_2 = guardian_1 if random.random() < 0.08 else f"G{random.randint(100000, 999999)}"
            upi_2 = upi_1 if random.random() < 0.03 else f"UPI-{random.randint(10000000, 99999999)}"
            birth_certificate_match = int(random.random() < 0.0942)

        base_jw = 1.0 if name_1 == name_2 else random.uniform(0.20, 0.95) if label == 1 else random.uniform(0.10, 0.85)
        jaro_winkler = float(np.clip(round(base_jw + np.random.normal(0, 0.08), 4), 0.0, 1.0))
        rows.append({
            "name_1": name_1,
            "name_2": name_2,
            "dob_1": dob_1,
            "dob_2": dob_2,
            "school_1": school_1,
            "school_2": school_2,
            "guardian_1": guardian_1,
            "guardian_2": guardian_2,
            "upi_1": upi_1,
            "upi_2": upi_2,
            "group_id": group_id,
            "jaro_winkler": jaro_winkler,
            "dob_match": int(dob_1 == dob_2),
            "school_match": int(school_1 == school_2),
            "guardian_match": int(guardian_1 == guardian_2),
            "upi_match": int(upi_1 == upi_2),
            "birth_certificate_match": birth_certificate_match,
            "label": int(label),
        })
    return pd.DataFrame(rows)


def evaluate() -> dict[str, object]:
    if not MODEL_FILE.exists():
        raise FileNotFoundError(f"Existing prediction model not found: {MODEL_FILE}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset = generate_unpredictable_pairs()
    dataset.to_csv(DATASET_FILE, index=False)

    model_hash_before = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    model = joblib.load(MODEL_FILE)
    probabilities = model.predict_proba(dataset[FEATURE_COLUMNS])[:, 1]
    model_hash_after = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    if model_hash_before != model_hash_after:
        raise RuntimeError("Model artifact changed during inference-only evaluation.")

    predictions = (probabilities >= 0.5).astype(int)
    matrix = confusion_matrix(dataset["label"], predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    result = {
        "evaluation_only": True,
        "training_performed": False,
        "model_file_modified": False,
        "model_file": str(MODEL_FILE.relative_to(BASE_DIR)),
        "model_sha256_before": model_hash_before,
        "model_sha256_after": model_hash_after,
        "dataset_file": str(DATASET_FILE.relative_to(BASE_DIR)),
        "dataset_sha256": hashlib.sha256(DATASET_FILE.read_bytes()).hexdigest(),
        "training_dataset_sha256": hashlib.sha256(TRAINING_FILE.read_bytes()).hexdigest(),
        "dataset_is_same_file_as_training_data": DATASET_FILE.resolve() == TRAINING_FILE.resolve(),
        "rows": int(len(dataset)),
        "groups": int(dataset["group_id"].nunique()),
        "label_counts": {str(key): int(value) for key, value in dataset["label"].value_counts().sort_index().items()},
        "features": FEATURE_COLUMNS,
        "threshold": 0.5,
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "accuracy": float(accuracy_score(dataset["label"], predictions)),
        "precision": float(precision_score(dataset["label"], predictions, zero_division=0)),
        "recall": float(recall_score(dataset["label"], predictions, zero_division=0)),
        "f1": float(f1_score(dataset["label"], predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(dataset["label"], probabilities)),
        "limitations": [
            "This generated holdout is not real student data and does not estimate field performance.",
            "Names, field corruption, similarity jitter, and birth-certificate match rates are synthetic assumptions.",
            "Group IDs are included as requested but are not used to split this evaluation dataset.",
            "School names are specific to this evaluation generator and do not change application school settings.",
        ],
    }
    RESULT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Evaluation dataset: {DATASET_FILE}")
    print(f"Evaluation report: {RESULT_FILE}")
    return result


if __name__ == "__main__":
    evaluate()
