"""Retrain the prediction model on separate data with a 50/50 grouped holdout.

The user's randomized evaluation CSV is never included in training or tuning.
The replacement model is promoted only after the internal holdout and untouched
external evaluation have both completed successfully.
"""

from __future__ import annotations

import hashlib
import json
import random
import shutil
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold, train_test_split

from feature_engineering import FEATURE_COLUMNS, build_pair_features

BASE_DIR = Path(__file__).resolve().parent
MODEL_FILE = BASE_DIR / "model" / "rf_duplicate_model.joblib"
CANDIDATE_FILE = BASE_DIR / "model" / "rf_duplicate_model_retrained_candidate.joblib"
BACKUP_FILE = BASE_DIR / "model" / "rf_duplicate_model_before_grouped_retrain.joblib"
OUTPUT_DIR = BASE_DIR / "evaluation"
TRAINING_DIR = BASE_DIR / "training"
TRAINING_DATA_FILE = TRAINING_DIR / "retrained_training_pairs.csv"
REPORT_FILE = OUTPUT_DIR / "grouped_retraining_metrics.json"
EXTERNAL_TEST_FILE = OUTPUT_DIR / "synthetic_student_pairs_randomized.csv"
SEED = 73219
ROWS = 10_000
GROUP_COUNT = ROWS // 2

SCHOOLS = ["Nairobi School", "Alliance High", "Bishop Gatimu", "Loreto Limuru", "Maranda"]
FIRST_NAMES = [
    "Wanjiku", "Achieng", "Kiprono", "Omondi", "Naliaka", "Kibet", "Fatuma",
    "Juma", "Chebet", "Otieno", "Mukhwana", "Njenga", "Mwangi", "Mutua",
    "Wambui", "Amina", "Barasa", "Wafula", "Nyambura", "Kariuki",
]
LAST_NAMES = [
    "Kamau", "Otieno", "Maina", "Kariuki", "Chelangat", "Oduor", "Njoroge",
    "Wambui", "Kimani", "Onyango", "Amina", "Barasa", "Wafula", "Macharia",
    "Ochieng", "Mwangi", "Muthoni", "Koech", "Jepchirchir", "Musau",
]


def make_student(rng: random.Random) -> dict[str, str | None]:
    return {
        "full_name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
        "date_of_birth": f"{rng.randint(2002, 2015):04d}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"G{rng.randint(100000, 999999)}",
        "upi": f"UPI-{rng.randint(10000000, 99999999)}",
        "birth_certificate_number": f"BC-{rng.randint(100000, 999999)}",
    }


def typo_name(name: str, rng: random.Random) -> str:
    chars = list(name)
    positions = [index for index, char in enumerate(chars) if char.isalpha()]
    if not positions:
        return name
    position = rng.choice(positions)
    operation = rng.choice(("delete", "swap", "replace"))
    if operation == "delete":
        chars.pop(position)
    elif operation == "swap" and position + 1 < len(chars):
        chars[position], chars[position + 1] = chars[position + 1], chars[position]
    else:
        chars[position] = rng.choice("abcdefghijklmnopqrstuvwxyz")
    return "".join(chars)


def duplicate_pair(base: dict[str, str | None], rng: random.Random) -> tuple[dict[str, str | None], dict[str, str | None]]:
    first = dict(base)
    second = dict(base)
    name_mode = rng.choices(("exact", "typo", "swap_order", "partial"), (0.40, 0.30, 0.15, 0.15))[0]
    if name_mode == "typo":
        second["full_name"] = typo_name(str(base["full_name"]), rng)
    elif name_mode == "swap_order":
        second["full_name"] = " ".join(reversed(str(base["full_name"]).split()))
    elif name_mode == "partial":
        second["full_name"] = str(base["full_name"]).split()[0]
    if rng.random() >= 0.78:
        second["date_of_birth"] = make_student(rng)["date_of_birth"]
    if rng.random() >= 0.78:
        second["school_code"] = rng.choice(SCHOOLS)
    if rng.random() >= 0.68:
        second["guardian_id"] = make_student(rng)["guardian_id"]
    if rng.random() >= 0.72:
        second["upi"] = make_student(rng)["upi"]
    if rng.random() >= 0.70:
        second["birth_certificate_number"] = make_student(rng)["birth_certificate_number"]
    return first, second


def distinct_pair(rng: random.Random) -> tuple[dict[str, str | None], dict[str, str | None]]:
    first = make_student(rng)
    second = make_student(rng)
    # Add realistic demographic overlap to non-duplicate pairs without making
    # any single feature a deterministic label proxy.
    if rng.random() < 0.10:
        second["full_name"] = first["full_name"]
    elif rng.random() < 0.24:
        second["full_name"] = typo_name(str(first["full_name"]), rng)
    if rng.random() < 0.12:
        second["date_of_birth"] = first["date_of_birth"]
    if rng.random() < 0.30:
        second["school_code"] = first["school_code"]
    if rng.random() < 0.10:
        second["guardian_id"] = first["guardian_id"]
    if rng.random() < 0.025:
        second["upi"] = first["upi"]
    if rng.random() < 0.025:
        second["birth_certificate_number"] = first["birth_certificate_number"]
    return first, second


def build_training_data(include_names: bool = False) -> pd.DataFrame:
    rng = random.Random(SEED)
    rows = []
    # Each group has two related comparisons and a single ground-truth label.
    for group_index in range(GROUP_COUNT):
        label = int(group_index < GROUP_COUNT // 2)
        base = make_student(rng) if label else None
        for _ in range(2):
            first, second = duplicate_pair(base, rng) if label else distinct_pair(rng)
            rows.append({
                **({"name_1": first["full_name"], "name_2": second["full_name"]} if include_names else {}),
                **build_pair_features(first, second),
                "label": label,
                "group_id": 100_000 + group_index,
            })
    columns = (["name_1", "name_2"] if include_names else []) + [*FEATURE_COLUMNS, "label", "group_id"]
    return pd.DataFrame(rows)[columns]


def metrics(labels: pd.Series, probabilities) -> dict[str, object]:
    predictions = (probabilities >= 0.5).astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
    }


def evaluate() -> dict[str, object]:
    if not MODEL_FILE.exists():
        raise FileNotFoundError(f"Current model not found: {MODEL_FILE}")
    if not EXTERNAL_TEST_FILE.exists():
        raise FileNotFoundError(
            "The previously generated randomized evaluation CSV is missing; refusing to generate or train from it. "
            "Run evaluate_randomized_dataset.py first to restore the held-out evaluation file."
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    external_hash_before = hashlib.sha256(EXTERNAL_TEST_FILE.read_bytes()).hexdigest()
    old_model_hash = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    training_data = build_training_data()
    training_data.to_csv(TRAINING_DATA_FILE, index=False)

    group_table = training_data[["group_id", "label"]].drop_duplicates("group_id")
    train_group_ids, test_group_ids = train_test_split(
        group_table["group_id"],
        test_size=0.50,
        random_state=42,
        stratify=group_table["label"],
    )
    groups = training_data["group_id"]
    train_mask = groups.isin(train_group_ids)
    test_mask = groups.isin(test_group_ids)
    train = training_data.loc[train_mask].reset_index(drop=True)
    test = training_data.loc[test_mask].reset_index(drop=True)
    train_groups = train["group_id"]
    test_groups = test["group_id"]
    if set(train_groups).intersection(test_groups):
        raise RuntimeError("Group leakage detected across the 50/50 split.")

    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)
    search = GridSearchCV(
        RandomForestClassifier(class_weight="balanced", random_state=42, n_jobs=-1),
        param_grid={
            "n_estimators": [100, 200],
            "max_depth": [4, 6],
            "min_samples_leaf": [2, 5],
            "max_features": ["sqrt"],
        },
        scoring="f1",
        cv=cv,
        n_jobs=-1,
        refit=True,
    )
    search.fit(train[FEATURE_COLUMNS], train["label"].astype(int), groups=train_groups)
    model = search.best_estimator_
    internal_probabilities = model.predict_proba(test[FEATURE_COLUMNS])[:, 1]
    internal_metrics = metrics(test["label"].astype(int), internal_probabilities)

    # This exact file was generated for testing only and is never passed to fit,
    # GridSearchCV, threshold selection, or any training-data construction.
    external = pd.read_csv(EXTERNAL_TEST_FILE)
    external_probabilities = model.predict_proba(external[FEATURE_COLUMNS])[:, 1]
    external_metrics = metrics(external["label"].astype(int), external_probabilities)
    external_hash_after = hashlib.sha256(EXTERNAL_TEST_FILE.read_bytes()).hexdigest()
    if external_hash_before != external_hash_after:
        raise RuntimeError("The held-out external evaluation file changed during retraining.")

    joblib.dump(model, CANDIDATE_FILE)
    if hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest() != old_model_hash:
        raise RuntimeError("Current model changed unexpectedly before promotion.")
    shutil.copy2(MODEL_FILE, BACKUP_FILE)
    CANDIDATE_FILE.replace(MODEL_FILE)
    promoted_hash = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()

    result = {
        "model_promoted": True,
        "training_performed": True,
        "training_dataset_file": str(TRAINING_DATA_FILE.relative_to(BASE_DIR)),
        "training_dataset_sha256": hashlib.sha256(TRAINING_DATA_FILE.read_bytes()).hexdigest(),
        "training_rows": int(len(train)),
        "training_groups": int(train["group_id"].nunique()),
        "internal_test_rows": int(len(test)),
        "internal_test_groups": int(test["group_id"].nunique()),
        "split": "50/50 stratified by group_id; no group overlap",
        "cross_validation": "5-fold StratifiedGroupKFold on training half only",
        "seed": SEED,
        "best_parameters": search.best_params_,
        "training_cv_f1": float(search.best_score_),
        "internal_test_threshold": 0.5,
        "internal_test_metrics": internal_metrics,
        "external_evaluation_file": str(EXTERNAL_TEST_FILE.relative_to(BASE_DIR)),
        "external_evaluation_sha256_before_and_after": external_hash_before,
        "external_evaluation_rows": int(len(external)),
        "external_evaluation_used_for_training": False,
        "external_evaluation_threshold": 0.5,
        "external_evaluation_metrics": external_metrics,
        "previous_model_backup": str(BACKUP_FILE.relative_to(BASE_DIR)),
        "previous_model_sha256": old_model_hash,
        "promoted_model_sha256": promoted_hash,
        "scikit_learn_version": sklearn.__version__,
        "limitations": [
            "Training and both evaluations are generated data, not independently labeled real-world outcomes.",
            "The external holdout remains untouched by fitting and hyperparameter selection.",
            "Synthetic generation assumptions still affect measured performance.",
        ],
    }
    REPORT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Promoted model: {MODEL_FILE}")
    print(f"Metrics report: {REPORT_FILE}")
    return result


if __name__ == "__main__":
    evaluate()
