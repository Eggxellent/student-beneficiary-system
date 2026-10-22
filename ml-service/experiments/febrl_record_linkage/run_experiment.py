"""Tune a fresh Random Forest on FEBRL training/validation data and test once."""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from febrl_pipeline import (
    ARTIFACTS_DIR,
    FEATURE_COLUMNS,
    PREPARED_DIR,
    ROOT,
    SEED,
    sha256_file,
)

MODEL_PATH = ARTIFACTS_DIR / "febrl_random_forest_v1.joblib"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"
PARAMETER_GRID = (
    {"max_depth": 8, "min_samples_leaf": 2},
    {"max_depth": 12, "min_samples_leaf": 2},
    {"max_depth": 16, "min_samples_leaf": 4},
    {"max_depth": None, "min_samples_leaf": 5},
)


def load_prepared(name: str) -> pd.DataFrame:
    path = PREPARED_DIR / f"{name}.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Missing {path}; run prepare_data.py first.")
    data = pd.read_csv(path)
    expected = {*FEATURE_COLUMNS, "label"}
    if set(data.columns) != expected:
        raise ValueError(f"Unexpected columns in {path}; source IDs must not be model features.")
    if data[list(expected)].isna().any().any() or data.label.nunique() != 2:
        raise ValueError(f"{path} must contain complete features and both labels.")
    data["label"] = data["label"].astype(int)
    return data


def metric_row(labels: pd.Series, probabilities: np.ndarray, threshold: float) -> dict[str, object]:
    predicted = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(labels, predicted, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "threshold": float(threshold),
        "pair_count": int(len(labels)),
        "positive_count": int(labels.sum()),
        "negative_count": int((labels == 0).sum()),
        "accuracy": float(accuracy_score(labels, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "average_precision_pr_auc": float(average_precision_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "predicted_review_alerts": int(predicted.sum()),
    }


def select_threshold(labels: pd.Series, probabilities: np.ndarray) -> tuple[float, dict[str, object]]:
    candidates = np.arange(0.01, 1.00, 0.01)
    rows = [metric_row(labels, probabilities, float(value)) for value in candidates]
    selected = max(rows, key=lambda row: (row["f1"], row["recall"], row["precision"], row["threshold"]))
    return float(selected["threshold"]), selected


def file_hashes() -> dict[str, str]:
    return {
        name: sha256_file(PREPARED_DIR / f"{name}.csv")
        for name in ("train", "validation", "test")
    }


def main() -> dict[str, object]:
    started = time.perf_counter()
    train, validation, test = (load_prepared(name) for name in ("train", "validation", "test"))
    if set(train.columns) != set(validation.columns) or set(train.columns) != set(test.columns):
        raise ValueError("Prepared split schemas do not match.")
    input_hashes = file_hashes()
    x_train, y_train = train[list(FEATURE_COLUMNS)], train.label
    x_validation, y_validation = validation[list(FEATURE_COLUMNS)], validation.label
    x_test, y_test = test[list(FEATURE_COLUMNS)], test.label

    tuning_results = []
    best_model = None
    best_probabilities = None
    best_params = None
    train_seconds = 0.0
    for parameters in PARAMETER_GRID:
        model = RandomForestClassifier(
            n_estimators=200,
            max_features="sqrt",
            class_weight="balanced_subsample",
            random_state=SEED,
            n_jobs=-1,
            **parameters,
        )
        fit_start = time.perf_counter()
        model.fit(x_train, y_train)
        train_seconds += time.perf_counter() - fit_start
        probabilities = model.predict_proba(x_validation)[:, 1]
        result = {
            "parameters": {"n_estimators": 200, "max_features": "sqrt", "class_weight": "balanced_subsample", **parameters},
            "validation_average_precision": float(average_precision_score(y_validation, probabilities)),
            "validation_f1_at_0_5": float(f1_score(y_validation, probabilities >= 0.5, zero_division=0)),
        }
        tuning_results.append(result)
        if best_probabilities is None or result["validation_average_precision"] > max(
            item["validation_average_precision"] for item in tuning_results[:-1]
        ):
            best_model, best_probabilities, best_params = model, probabilities, result["parameters"]

    threshold, validation_metrics = select_threshold(y_validation, best_probabilities)
    fit_probabilities = best_model.predict_proba(x_train)[:, 1]
    fit_metrics = metric_row(y_train, fit_probabilities, threshold)

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(best_model, MODEL_PATH)
    saved_model = joblib.load(MODEL_PATH)
    fixed_count = min(256, len(x_validation))
    predictions_before_reload = best_model.predict_proba(x_validation.iloc[:fixed_count])[:, 1]
    predictions_after_reload = saved_model.predict_proba(x_validation.iloc[:fixed_count])[:, 1]
    reload_max_error = float(np.max(np.abs(predictions_before_reload - predictions_after_reload)))
    reload_equivalent = bool(np.allclose(predictions_before_reload, predictions_after_reload, rtol=0.0, atol=1e-12))
    if not reload_equivalent:
        raise RuntimeError("Reloaded model predictions differ from the freshly trained model.")

    test_start = time.perf_counter()
    test_probabilities = saved_model.predict_proba(x_test)[:, 1]
    test_seconds = time.perf_counter() - test_start
    test_metrics = metric_row(y_test, test_probabilities, threshold)
    preparation_path = ARTIFACTS_DIR / "preparation_report.json"
    preparation = json.loads(preparation_path.read_text(encoding="utf-8"))
    test_positive_total = preparation["pair_preparation"]["splits"]["test"]["ground_truth_positive_pairs"]
    test_metrics["end_to_end_recall_including_blocking_misses"] = (
        test_metrics["true_positives"] / test_positive_total if test_positive_total else 0.0
    )

    dummy = DummyClassifier(strategy="most_frequent").fit(x_train, y_train)
    baseline_probabilities = dummy.predict_proba(x_test)[:, list(dummy.classes_).index(1)] if 1 in dummy.classes_ else np.zeros(len(x_test))
    baseline_metrics = metric_row(y_test, baseline_probabilities, 0.5)
    elapsed = time.perf_counter() - started
    result = {
        "experiment": "FEBRL 4A/4B entity-disjoint binary record-pair classification",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": preparation["source_profile"],
        "split_and_pair_preparation": preparation["pair_preparation"],
        "prepared_split_sha256": input_hashes,
        "model": {
            "type": "RandomForestClassifier",
            "trained_from_scratch": True,
            "selected_parameters": best_params,
            "random_state": SEED,
            "selection_metric": "validation average precision (PR-AUC)",
            "hyperparameter_validation_results": tuning_results,
            "class_imbalance_handling": "class_weight='balanced_subsample'; no oversampling or downsampling",
            "feature_columns": list(FEATURE_COLUMNS),
            "identifier_columns_excluded": ["rec_id", "entity_id", "label"],
            "model_file": str(MODEL_PATH.relative_to(ROOT)),
            "model_sha256": sha256_file(MODEL_PATH),
            "reload_prediction_check": {
                "sample_count": fixed_count,
                "sample_source": "validation",
                "equivalent_with_absolute_tolerance": 1e-12,
                "maximum_absolute_probability_difference": reload_max_error,
                "passed": reload_equivalent,
            },
        },
        "threshold_selection": {
            "method": "Validation threshold maximizing F1; ties favor recall, then precision, then higher threshold.",
            "threshold": threshold,
            "validation_metrics": validation_metrics,
            "test_threshold_selected_using_test": False,
        },
        "fit_metrics_at_validation_threshold": fit_metrics,
        "test_metrics_at_validation_threshold": test_metrics,
        "test_majority_class_baseline": baseline_metrics,
        "runtime_seconds": {
            "total_including_model_search_and_evaluation": elapsed,
            "sum_of_model_fit_seconds": train_seconds,
            "final_test_prediction_seconds": test_seconds,
        },
        "environment": {
            "python": __import__("platform").python_version(),
            "scikit_learn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "limitations": [
            "FEBRL records are synthetic and do not represent Kenyan beneficiaries or Kenyan identifiers.",
            "Reported classifier metrics are conditional on the documented candidate blocking rules; blocking misses are reported separately and included in end-to-end recall.",
            "The source contains exactly one duplicate for each original, so its entity distribution differs from production deduplication workloads.",
            "The selected threshold balances precision and recall with F1 on validation data; operational review costs may require a different policy.",
        ],
    }
    METRICS_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "selected_parameters": best_params,
        "threshold": threshold,
        "test_metrics": test_metrics,
        "model_file": str(MODEL_PATH),
        "report_file": str(METRICS_PATH),
    }, indent=2))
    return result


if __name__ == "__main__":
    main()
