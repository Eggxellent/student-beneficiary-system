"""Evaluate the existing duplicate model on a separate generated holdout.

This script never calls fit(), training scripts, or model-saving functions. It
creates an evaluation-only CSV and a separate JSON report under evaluation/.
"""

from __future__ import annotations

import hashlib
import json
import random
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
DATASET_FILE = OUTPUT_DIR / "synthetic_student_pairs.csv"
RESULT_FILE = OUTPUT_DIR / "synthetic_student_pairs_metrics.json"
RANDOM_SEED = 42
NUM_PAIRS = 10_000
NUM_GROUPS = 5_000

SCHOOLS = [
    "Highridge Academy",
    "St. Jude Secondary",
    "Mazingira School",
    "Kilimani Primary",
    "Riverside High",
]
FIRST_NAMES = [
    "Mukhwana", "Njenga", "Achieng", "Kiprono", "Wanjiku",
    "Omondi", "Mwangi", "Naliaka", "Kibet", "Mutua",
]
LAST_NAMES = [
    "Kamau", "Otieno", "Maina", "Kariuki", "Chelangat",
    "Oduor", "Njoroge", "Wambui", "Kimani", "Onyango",
]


def generate_evaluation_data() -> pd.DataFrame:
    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)
    group_ids = np.repeat(np.arange(1000, 1000 + NUM_GROUPS), 2)
    labels = [1] * (NUM_PAIRS // 2) + [0] * (NUM_PAIRS // 2)
    random.shuffle(labels)
    rows = []

    for index, label in enumerate(labels):
        group_id = int(group_ids[index])
        name_1 = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
        dob_1 = f"{random.randint(2005, 2012):04d}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"
        school_1 = random.choice(SCHOOLS)
        guardian_1 = f"G{random.randint(100000, 999999)}"
        upi_1 = f"UPI-{random.randint(10000000, 99999999)}"

        if label == 1:
            if random.random() > 0.2:
                name_2 = name_1
                jaro_winkler = 1.0
            else:
                name_2 = name_1[:-2] + name_1[-1] + name_1[-2] if len(name_1) > 2 else name_1
                jaro_winkler = round(random.uniform(0.92, 0.99), 4)
            dob_2 = dob_1 if random.random() > 0.05 else dob_1[:-1] + "1"
            school_2 = school_1 if random.random() > 0.05 else random.choice(SCHOOLS)
            guardian_2 = guardian_1 if random.random() > 0.05 else f"G{random.randint(100000, 999999)}"
            upi_2 = upi_1 if random.random() > 0.10 else f"UPI-{random.randint(10000000, 99999999)}"
            birth_certificate_match = 1
        else:
            name_2 = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
            dob_2 = f"{random.randint(2005, 2012):04d}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"
            school_2 = random.choice(SCHOOLS)
            guardian_2 = f"G{random.randint(100000, 999999)}"
            upi_2 = f"UPI-{random.randint(10000000, 99999999)}"
            jaro_winkler = round(1.0 if name_1 == name_2 else random.uniform(0.35, 0.75), 4)
            birth_certificate_match = 1 if random.random() < 0.0942 else 0

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
            "label": label,
        })

    return pd.DataFrame(rows)


def evaluate() -> dict[str, object]:
    if not MODEL_FILE.exists():
        raise FileNotFoundError(f"Existing prediction model not found: {MODEL_FILE}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset = generate_evaluation_data()
    dataset.to_csv(DATASET_FILE, index=False)

    model_hash_before = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    model = joblib.load(MODEL_FILE)
    probabilities = model.predict_proba(dataset[FEATURE_COLUMNS])[:, 1]
    model_hash_after = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    if model_hash_before != model_hash_after:
        raise RuntimeError("Prediction model artifact changed during inference-only evaluation.")
    predictions = (probabilities >= 0.5).astype(int)
    matrix = confusion_matrix(dataset["label"], predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    result = {
        "evaluation_only": True,
        "model_file": str(MODEL_FILE.relative_to(BASE_DIR)),
        "dataset_file": str(DATASET_FILE.relative_to(BASE_DIR)),
        "dataset_sha256": hashlib.sha256(DATASET_FILE.read_bytes()).hexdigest(),
        "training_dataset_sha256": hashlib.sha256(TRAINING_FILE.read_bytes()).hexdigest(),
        "model_sha256_before": model_hash_before,
        "model_sha256_after": model_hash_after,
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
        "training_performed": False,
        "model_file_modified": model_hash_before != model_hash_after,
        "limitations": [
            "This is a generated holdout and does not measure performance on real student cases.",
            "Positive labels always have birth_certificate_match=1; negative labels have it about 9.42% of the time, creating a strong label shortcut.",
            "The supplied jaro_winkler values are assigned by generator rules rather than recomputed from the names.",
            "The supplied evaluation schools differ from the application's five approved schools.",
        ],
    }
    RESULT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Evaluation dataset: {DATASET_FILE}")
    print(f"Evaluation report: {RESULT_FILE}")
    return result


if __name__ == "__main__":
    evaluate()
