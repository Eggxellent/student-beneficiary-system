"""Compare current RF, XGBoost, and normalized-Levenshtein RF on one holdout.

All fitting and CV use separate regenerated training pairs. The randomized
evaluation CSV is passed only to predict_proba and is never used for tuning.
No model artifact is written or modified by this script.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

import joblib
import jellyfish
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold, train_test_split
from xgboost import XGBClassifier

from feature_engineering import FEATURE_COLUMNS
from retrain_grouped import build_training_data

BASE_DIR = Path(__file__).resolve().parent
MODEL_FILE = BASE_DIR / "model" / "rf_duplicate_model.joblib"
TRAINING_FILE = BASE_DIR / "training" / "retrained_training_pairs.csv"
EVALUATION_FILE = BASE_DIR / "evaluation" / "synthetic_student_pairs_randomized.csv"
RESULT_FILE = BASE_DIR / "evaluation" / "model_comparison_on_randomized_holdout.json"
SEED = 42
THRESHOLD = 0.5
RF_GRID = {
    "n_estimators": [100, 200],
    "max_depth": [4, 6],
    "min_samples_leaf": [2, 5],
    "max_features": ["sqrt"],
}


def clean_name(value: object) -> str:
    return re.sub(r"[^a-z]", "", str(value or "").lower())


def normalized_levenshtein(first: object, second: object) -> float:
    left, right = clean_name(first), clean_name(second)
    longest = max(len(left), len(right))
    if longest == 0:
        return 1.0
    return 1.0 - jellyfish.levenshtein_distance(left, right) / longest


def report_metrics(model: object, data: pd.DataFrame, features: pd.DataFrame, name: str) -> dict[str, object]:
    started = time.perf_counter()
    probabilities = model.predict_proba(features)[:, 1]
    prediction_ms = (time.perf_counter() - started) * 1000
    predictions = (probabilities >= THRESHOLD).astype(int)
    labels = data["label"].astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "name": name,
        "threshold": THRESHOLD,
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
        "prediction_batch_ms": prediction_ms,
    }


def main() -> dict[str, object]:
    if not MODEL_FILE.exists() or not TRAINING_FILE.exists() or not EVALUATION_FILE.exists():
        raise FileNotFoundError("Model, separate training data, or held-out evaluation CSV is missing.")

    evaluation_hash_before = hashlib.sha256(EVALUATION_FILE.read_bytes()).hexdigest()
    model_hash_before = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    generated_training = build_training_data(include_names=True)
    saved_training = pd.read_csv(TRAINING_FILE)
    compare_columns = [*FEATURE_COLUMNS, "label", "group_id"]
    regenerated = generated_training[compare_columns].reset_index(drop=True)
    saved = saved_training[compare_columns].reset_index(drop=True)
    if not np.array_equal(regenerated[["label", "group_id"]].to_numpy(), saved[["label", "group_id"]].to_numpy()):
        raise ValueError("Regenerated training labels/groups do not match the saved retraining dataset.")
    if not np.allclose(regenerated[FEATURE_COLUMNS].to_numpy(), saved[FEATURE_COLUMNS].to_numpy(), rtol=0, atol=1e-12):
        raise ValueError("Regenerated training features do not match the saved retraining dataset.")

    group_rows = generated_training[["group_id", "label"]].drop_duplicates("group_id")
    train_groups, _internal_test_groups = train_test_split(
        group_rows["group_id"], test_size=0.50, random_state=SEED,
        stratify=group_rows["label"],
    )
    train = generated_training[generated_training["group_id"].isin(train_groups)].copy()
    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    x_train = train[FEATURE_COLUMNS]
    y_train = train["label"].astype(int)
    groups = train["group_id"]

    rf_search = GridSearchCV(
        RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1),
        RF_GRID,
        scoring="f1",
        cv=cv,
        n_jobs=-1,
        refit=True,
    )
    rf_search.fit(x_train, y_train, groups=groups)

    xgb_search = GridSearchCV(
        XGBClassifier(
            objective="binary:logistic", eval_metric="logloss", tree_method="hist",
            random_state=SEED, n_jobs=-1, verbosity=0,
        ),
        {
            "n_estimators": [100, 200],
            "max_depth": [3, 5],
            "learning_rate": [0.05, 0.1],
            "min_child_weight": [1],
        },
        scoring="f1",
        cv=cv,
        n_jobs=1,
        refit=True,
    )
    xgb_search.fit(x_train, y_train, groups=groups)

    train_lev = train.apply(lambda row: normalized_levenshtein(row["name_1"], row["name_2"]), axis=1)
    levenshtein_train_features = x_train.copy()
    levenshtein_train_features["jaro_winkler"] = train_lev.to_numpy()
    levenshtein_search = GridSearchCV(
        RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1),
        RF_GRID,
        scoring="f1",
        cv=cv,
        n_jobs=-1,
        refit=True,
    )
    levenshtein_search.fit(levenshtein_train_features, y_train, groups=groups)

    evaluation = pd.read_csv(EVALUATION_FILE)
    x_evaluation = evaluation[FEATURE_COLUMNS]
    evaluation_lev = evaluation.apply(
        lambda row: normalized_levenshtein(row["name_1"], row["name_2"]), axis=1
    )
    levenshtein_evaluation_features = x_evaluation.copy()
    levenshtein_evaluation_features["jaro_winkler"] = evaluation_lev.to_numpy()
    current_rf = joblib.load(MODEL_FILE)

    results = {
        "Random Forest + Jaro-Winkler (current)": report_metrics(current_rf, evaluation, x_evaluation, "Current promoted model"),
        "XGBoost + Jaro-Winkler": report_metrics(xgb_search.best_estimator_, evaluation, x_evaluation, "XGBoost"),
        "Random Forest + normalized Levenshtein": report_metrics(
            levenshtein_search.best_estimator_, evaluation, levenshtein_evaluation_features,
            "Normalized Levenshtein",
        ),
    }
    evaluation_hash_after = hashlib.sha256(EVALUATION_FILE.read_bytes()).hexdigest()
    model_hash_after = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    if evaluation_hash_before != evaluation_hash_after:
        raise RuntimeError("Held-out evaluation dataset changed during comparison.")
    if model_hash_before != model_hash_after:
        raise RuntimeError("Promoted model artifact changed during comparison.")

    report = {
        "evaluation_only_dataset": str(EVALUATION_FILE.relative_to(BASE_DIR)),
        "evaluation_dataset_sha256_before_and_after": evaluation_hash_before,
        "evaluation_rows": int(len(evaluation)),
        "training_data": str(TRAINING_FILE.relative_to(BASE_DIR)),
        "training_data_sha256": hashlib.sha256(TRAINING_FILE.read_bytes()).hexdigest(),
        "training_rows_used": int(len(train)),
        "training_groups_used": int(train["group_id"].nunique()),
        "cv": "5-fold StratifiedGroupKFold on training half only",
        "test_threshold": THRESHOLD,
        "test_dataset_used_for_fitting_or_tuning": False,
        "promoted_rf_model_hash_before_and_after": model_hash_before,
        "xgboost_best_parameters": xgb_search.best_params_,
        "xgboost_cv_f1": float(xgb_search.best_score_),
        "levenshtein_rf_best_parameters": levenshtein_search.best_params_,
        "levenshtein_rf_cv_f1": float(levenshtein_search.best_score_),
        "results": results,
        "limitations": [
            "The held-out examples are generated and do not establish real-world field performance.",
            "Levenshtein replaces the Jaro-Winkler name feature; the other five features and Random Forest family are held constant for that comparison.",
            "XGBoost is compared using the six Jaro-Winkler feature columns.",
        ],
    }
    RESULT_FILE.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Comparison report: {RESULT_FILE}")
    return report


if __name__ == "__main__":
    main()
