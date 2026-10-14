"""Train a reproducible six-feature Random Forest research baseline.

Related pairs sharing a ``group_id`` stay together during the holdout split and
cross-validation. The research artifact is saved separately from the deployed
model so a baseline run cannot silently replace the model used by predict.py.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold, train_test_split

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "data" / "features.csv"
MODEL_FILE = BASE_DIR / "model" / "research" / "rf_six_feature_group_split.joblib"
RESULT_FILE = BASE_DIR / "results" / "rf_six_feature_group_split.json"
RANDOM_STATE = 42
TEST_SIZE = 0.20
FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]


def train_model() -> dict[str, object]:
    dataset = pd.read_csv(INPUT_FILE)
    required_columns = [*FEATURE_COLUMNS, "label", "group_id"]
    missing = sorted(set(required_columns) - set(dataset.columns))
    if missing:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing)}")
    if dataset[required_columns].isnull().any().any():
        raise ValueError("Dataset contains missing feature, label, or group values.")

    features = dataset[FEATURE_COLUMNS]
    labels = dataset["label"].astype(int)
    groups = dataset["group_id"]
    if labels.nunique() != 2:
        raise ValueError("Baseline requires both duplicate and non-duplicate labels.")
    if groups.nunique() < 5:
        raise ValueError("At least five distinct groups are required for grouped CV.")

    group_labels = dataset.groupby("group_id")["label"].nunique()
    if (group_labels != 1).any():
        raise ValueError("Each group_id must contain examples from only one label.")
    group_records = dataset[["group_id", "label"]].drop_duplicates("group_id")
    train_group_ids, test_group_ids = train_test_split(
        group_records["group_id"],
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=group_records["label"],
    )
    train_indices = dataset.index[groups.isin(train_group_ids)]
    test_indices = dataset.index[groups.isin(test_group_ids)]
    train_features = features.loc[train_indices]
    test_features = features.loc[test_indices]
    train_labels = labels.loc[train_indices]
    test_labels = labels.loc[test_indices]
    train_groups = groups.loc[train_indices]
    test_groups = groups.loc[test_indices]
    if set(train_groups).intersection(test_groups):
        raise RuntimeError("Group leakage detected between train and test partitions.")

    estimator = RandomForestClassifier(
        random_state=RANDOM_STATE,
        class_weight="balanced",
        n_jobs=-1,
    )
    parameter_grid = {
        "n_estimators": [100, 150],
        "max_depth": [3, 4, 5, 6],
        "min_samples_leaf": [2, 5, 10],
        "max_features": ["sqrt"],
    }
    folds = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    search = GridSearchCV(
        estimator=estimator,
        param_grid=parameter_grid,
        scoring="f1",
        cv=folds,
        n_jobs=-1,
        refit=True,
    )

    training_started = time.perf_counter()
    search.fit(train_features, train_labels, groups=train_groups)
    training_time_seconds = time.perf_counter() - training_started
    model = search.best_estimator_

    prediction_started = time.perf_counter()
    probabilities = model.predict_proba(test_features)[:, 1]
    prediction_time_ms = (time.perf_counter() - prediction_started) * 1000
    predictions = (probabilities >= 0.5).astype(int)
    matrix = confusion_matrix(test_labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    metrics = {
        "accuracy": float(accuracy_score(test_labels, predictions)),
        "precision": float(precision_score(test_labels, predictions, zero_division=0)),
        "recall": float(recall_score(test_labels, predictions, zero_division=0)),
        "f1": float(f1_score(test_labels, predictions, zero_division=0)),
        "auc_roc": float(roc_auc_score(test_labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "training_time_seconds": training_time_seconds,
        "test_batch_prediction_time_ms": prediction_time_ms,
    }
    result = {
        "experiment": "six_feature_random_forest_grouped_baseline",
        "dataset_path": str(INPUT_FILE.relative_to(BASE_DIR)),
        "dataset_sha256": hashlib.sha256(INPUT_FILE.read_bytes()).hexdigest(),
        "dataset_rows": int(len(dataset)),
        "dataset_groups": int(groups.nunique()),
        "feature_columns": FEATURE_COLUMNS,
        "split": {
            "method": "stratified holdout by group label",
            "test_size": TEST_SIZE,
            "random_state": RANDOM_STATE,
            "train_rows": int(len(train_indices)),
            "test_rows": int(len(test_indices)),
            "train_groups": int(train_groups.nunique()),
            "test_groups": int(test_groups.nunique()),
            "group_overlap": 0,
        },
        "validation": {
            "method": "StratifiedGroupKFold",
            "folds": 5,
            "best_cross_validation_f1": float(search.best_score_),
        },
        "model": "RandomForestClassifier",
        "best_parameters": search.best_params_,
        "threshold": 0.5,
        "sklearn_version": sklearn.__version__,
        "metrics": metrics,
        "feature_importance": {
            name: float(value)
            for name, value in zip(FEATURE_COLUMNS, model.feature_importances_)
        },
        "limitations": [
            "Evaluation uses synthetic data and does not establish real-world performance.",
            "Threshold 0.5 is recorded for comparison and has not been operationally optimized.",
        ],
    }

    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_FILE)
    RESULT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Research model saved to: {MODEL_FILE}")
    print(f"Metrics saved to: {RESULT_FILE}")
    return result


if __name__ == "__main__":
    train_model()
