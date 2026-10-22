"""Grouped validation, threshold, ablation, and independent challenge analysis.

This script writes research artifacts only; it never changes the deployed model.
The final test partition is evaluated once after model and threshold selection.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold, train_test_split

from data.kenyan_names import FIRST_NAMES, SCHOOLS, SURNAMES
from feature_engineering import FEATURE_COLUMNS, build_pair_features

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_FILE = BASE_DIR / "data" / "raw_pairs.csv"
RESULT_FILE = BASE_DIR / "results" / "reliability_analysis.json"
RANDOM_STATE = 42
THRESHOLD_CANDIDATES = (0.30, 0.40, 0.50, 0.60, 0.70)


def split_by_group(dataset: pd.DataFrame, seed: int = RANDOM_STATE):
    required = {"group_id", "label", *FEATURE_COLUMNS}
    missing = sorted(required - set(dataset.columns))
    if missing:
        raise ValueError(f"Dataset is missing columns: {', '.join(missing)}")
    if dataset[sorted(required)].isnull().any().any():
        raise ValueError("Features, labels, and group IDs must be non-null before splitting.")
    group_labels = dataset.groupby("group_id")["label"].nunique()
    if (group_labels != 1).any():
        raise ValueError("Each group must have one ground-truth label.")
    group_table = dataset[["group_id", "label"]].drop_duplicates("group_id")
    train_validation_groups, test_groups = train_test_split(
        group_table["group_id"], test_size=0.20, random_state=seed,
        stratify=group_table["label"],
    )
    train_validation = group_table[group_table.group_id.isin(train_validation_groups)]
    train_groups, validation_groups = train_test_split(
        train_validation["group_id"], test_size=0.20, random_state=seed + 1,
        stratify=train_validation["label"],
    )
    parts = tuple(
        dataset[dataset.group_id.isin(groups)].copy().reset_index(drop=True)
        for groups in (train_groups, validation_groups, test_groups)
    )
    group_sets = [set(part.group_id) for part in parts]
    if any(group_sets[left] & group_sets[right] for left in range(3) for right in range(left + 1, 3)):
        raise RuntimeError("Group leakage detected between train, validation, and test partitions.")
    return parts


def metric_row(labels, probabilities, threshold: float) -> dict[str, object]:
    predictions = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "threshold": threshold,
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "accuracy": float(accuracy_score(labels, predictions)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "false_positives": fp,
        "false_negatives": fn,
        "review_queue_cases": int(predictions.sum()),
        "true_negatives": tn,
        "true_positives": tp,
    }


def make_model(**parameters):
    return RandomForestClassifier(
        class_weight="balanced", random_state=RANDOM_STATE, n_jobs=-1, **parameters
    )


def synthetic_student(rng: random.Random) -> dict[str, str | None]:
    return {
        "full_name": f"{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)}",
        "date_of_birth": f"{rng.randint(2000, 2015)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "school_code": rng.choice(SCHOOLS),
        "guardian_id": f"G-{rng.randint(10000, 99999)}",
        "upi": f"UPI-{rng.randint(10000000, 99999999)}",
        "birth_certificate_number": f"BC-{rng.randint(100000, 999999)}",
    }


def independent_challenge_set(size: int = 1000, seed: int = 2042) -> pd.DataFrame:
    """Generate challenge pairs through a separate scenario-based process."""
    rng = random.Random(seed)
    rows = []
    scenarios = (
        "same_student", "same_student_missing", "same_student_school_change",
        "same_student_id_typo", "same_student_dob_typo", "same_student_guardian_change",
        "name_collision", "shared_guardian", "school_transfer", "identifier_conflict",
        "missing_fields", "twin_collision",
    )
    for index in range(size):
        scenario = scenarios[index % len(scenarios)]
        first = synthetic_student(rng)
        second = dict(first)
        label = int(scenario.startswith("same_student"))
        if label:
            second["full_name"] = first["full_name"] if rng.random() < 0.6 else first["full_name"].replace("a", "e", 1)
            if rng.random() < 0.2: second["date_of_birth"] = synthetic_student(rng)["date_of_birth"]
            if rng.random() < 0.2: second["school_code"] = rng.choice(SCHOOLS)
            if rng.random() < 0.35: second["upi"] = synthetic_student(rng)["upi"]
            if rng.random() < 0.25: second["birth_certificate_number"] = synthetic_student(rng)["birth_certificate_number"]
            if scenario == "same_student_school_change": second["school_code"] = rng.choice(SCHOOLS)
            if scenario == "same_student_id_typo": second["upi"] = first["upi"][:-1] + str((int(first["upi"][-1]) + 1) % 10)
            if scenario == "same_student_dob_typo": second["date_of_birth"] = synthetic_student(rng)["date_of_birth"]
            if scenario == "same_student_guardian_change": second["guardian_id"] = synthetic_student(rng)["guardian_id"]
            if scenario == "same_student_missing":
                for field in ("date_of_birth", "school_code", "guardian_id", "upi", "birth_certificate_number"):
                    if rng.random() < 0.45:
                        first[field] = None
                    if rng.random() < 0.45:
                        second[field] = None
        else:
            second = synthetic_student(rng)
            if scenario == "name_collision":
                second["full_name"] = first["full_name"] if rng.random() < 0.5 else first["full_name"].replace("a", "e", 1)
            if scenario == "shared_guardian":
                second["guardian_id"] = first["guardian_id"]
            if scenario == "school_transfer":
                second["full_name"] = first["full_name"]
                second["date_of_birth"] = first["date_of_birth"]
            if scenario == "identifier_conflict":
                second["upi"] = first["upi"]
            if scenario == "missing_fields":
                for field in ("date_of_birth", "school_code", "guardian_id", "upi", "birth_certificate_number"):
                    if rng.random() < 0.5:
                        first[field] = None
                    if rng.random() < 0.5:
                        second[field] = None
            if scenario == "twin_collision":
                second["date_of_birth"] = first["date_of_birth"]
                second["school_code"] = first["school_code"]
                second["guardian_id"] = first["guardian_id"]
        for field in ("date_of_birth", "school_code", "guardian_id", "upi", "birth_certificate_number"):
            if rng.random() < 0.06:
                first[field] = None
            if rng.random() < 0.06:
                second[field] = None
        rows.append({**build_pair_features(first, second), "label": label, "scenario": scenario})
    return pd.DataFrame(rows)


def threshold_table(labels, probabilities):
    return [metric_row(labels, probabilities, threshold) for threshold in THRESHOLD_CANDIDATES]


def main(data_file: Path = DEFAULT_DATA_FILE, result_file: Path = RESULT_FILE) -> dict[str, object]:
    data_file = data_file.resolve()
    result_file = result_file.resolve()
    dataset = pd.read_csv(data_file)
    train, validation, test = split_by_group(dataset)
    features = train[FEATURE_COLUMNS]
    labels = train.label.astype(int)
    groups = train.group_id
    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    search = GridSearchCV(
        make_model(),
        {"n_estimators": [100, 150], "max_depth": [3, 6], "min_samples_leaf": [2, 10]},
        scoring="f1", cv=cv, n_jobs=-1, refit=True,
    )
    search.fit(features, labels, groups=groups)
    model = search.best_estimator_
    validation_probabilities = model.predict_proba(validation[FEATURE_COLUMNS])[:, 1]
    validation_thresholds = threshold_table(validation.label.astype(int), validation_probabilities)
    selected_threshold = max(validation_thresholds, key=lambda item: (item["f1"], item["recall"], item["precision"]))["threshold"]

    test_probabilities = model.predict_proba(test[FEATURE_COLUMNS])[:, 1]
    test_metrics = metric_row(test.label.astype(int), test_probabilities, selected_threshold)
    ablation = {}
    for removed in FEATURE_COLUMNS:
        included = [column for column in FEATURE_COLUMNS if column != removed]
        ablated = make_model(**search.best_params_).fit(features[included], labels)
        ablated_validation = ablated.predict_proba(validation[included])[:, 1]
        ablated_threshold = max(threshold_table(validation.label.astype(int), ablated_validation), key=lambda item: (item["f1"], item["recall"], item["precision"]))["threshold"]
        ablated_test = ablated.predict_proba(test[included])[:, 1]
        ablation[removed] = metric_row(test.label.astype(int), ablated_test, ablated_threshold)

    permutation = permutation_importance(
        model, test[FEATURE_COLUMNS], test.label.astype(int), scoring="roc_auc",
        n_repeats=10, random_state=RANDOM_STATE, n_jobs=-1,
    )
    challenge = independent_challenge_set()
    challenge_metrics = metric_row(challenge.label, model.predict_proba(challenge[FEATURE_COLUMNS])[:, 1], selected_threshold)
    dataset_labels = dataset.label.astype(int)
    single_feature_diagnostics = {}
    for column in FEATURE_COLUMNS:
        feature_auc = float(roc_auc_score(dataset_labels, dataset[column]))
        single_feature_diagnostics[column] = {
            "positive_mean": float(dataset.loc[dataset_labels == 1, column].mean()),
            "negative_mean": float(dataset.loc[dataset_labels == 0, column].mean()),
            "auc_best_direction": max(feature_auc, 1.0 - feature_auc),
        }
    result = {
        "dataset_file": str(data_file),
        "dataset_sha256": __import__("hashlib").sha256(data_file.read_bytes()).hexdigest(),
        "dataset_rows": len(dataset),
        "class_distribution": {str(label): int(count) for label, count in dataset.label.value_counts().sort_index().items()},
        "groups": int(dataset.group_id.nunique()),
        "split": {"train_rows": len(train), "validation_rows": len(validation), "test_rows": len(test), "train_groups": int(train.group_id.nunique()), "validation_groups": int(validation.group_id.nunique()), "test_groups": int(test.group_id.nunique()), "group_overlap": 0},
        "features": FEATURE_COLUMNS,
        "single_feature_diagnostics_full_dataset": single_feature_diagnostics,
        "best_parameters": search.best_params_,
        "training_group_cv_f1": float(search.best_score_),
        "validation_threshold_metrics": validation_thresholds,
        "selected_threshold": selected_threshold,
        "test_metrics": test_metrics,
        "feature_ablation_test_metrics": ablation,
        "permutation_importance_roc_auc_mean": {name: float(value) for name, value in zip(FEATURE_COLUMNS, permutation.importances_mean)},
        "independent_challenge": {"rows": len(challenge), "scenarios": challenge.scenario.value_counts().to_dict(), "metrics": challenge_metrics},
        "limitations": ["Synthetic evaluation only; it does not establish real-world performance.", "Permutation importance measures model reliance, not causation or field trustworthiness.", "Threshold selected on validation groups and evaluated once on held-out test groups."],
    }
    result_file.parent.mkdir(parents=True, exist_ok=True)
    result_file.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-file", type=Path, default=DEFAULT_DATA_FILE,
                        help=f"Input CSV (default: {DEFAULT_DATA_FILE})")
    parser.add_argument("--result-file", type=Path, default=RESULT_FILE,
                        help=f"JSON output path (default: {RESULT_FILE})")
    arguments = parser.parse_args()
    main(arguments.data_file, arguments.result_file)
