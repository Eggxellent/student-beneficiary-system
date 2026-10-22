"""Run the two focused SBMS duplicate-detection research comparisons.

The same group-separated train/test split is reused throughout. Candidate models
and reports are written under ml-service/experiments/results; the application
model artifact is never loaded or overwritten.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

import jellyfish
import pandas as pd
import sklearn
import xgboost
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
from xgboost import XGBClassifier

ML_DIR = Path(__file__).resolve().parents[1]
DATA_FILE = Path(
    os.environ.get("SBMS_ML_DATA_FILE", ML_DIR / "training" / "realistic_pairs_train.csv")
).resolve()
RESULTS_DIR = Path(os.environ.get("SBMS_ML_RESULTS_DIR", Path(__file__).resolve().parent / "results")).resolve()
JSON_FILE = RESULTS_DIR / "comparison_results.json"
REPORT_FILE = RESULTS_DIR / "comparison_report.md"
RANDOM_STATE = 42
TEST_SIZE = 0.20
THRESHOLD = 0.5
FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]
SUPPORT_COLUMNS = ["group_id", "label", "name_1", "name_2"]


def clean_name(value: object) -> str:
    return re.sub(r"[^a-z]", "", str(value).lower())


def normalized_levenshtein(first: object, second: object) -> float:
    left = clean_name(first)
    right = clean_name(second)
    longest = max(len(left), len(right))
    if not longest:
        return 1.0
    return 1.0 - jellyfish.levenshtein_distance(left, right) / longest


def load_and_split() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    dataset = pd.read_csv(DATA_FILE)
    required = set(FEATURE_COLUMNS + SUPPORT_COLUMNS)
    missing = sorted(required - set(dataset.columns))
    if missing:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing)}")
    if dataset[list(required)].isnull().any().any():
        raise ValueError("Dataset has missing feature, label, group, or name values.")

    group_labels = dataset.groupby("group_id")["label"].nunique()
    if (group_labels != 1).any():
        raise ValueError("Each group_id must contain examples from only one label.")
    groups = dataset[["group_id", "label"]].drop_duplicates("group_id")
    if groups["label"].nunique() != 2:
        raise ValueError("The dataset must contain both duplicate and non-duplicate groups.")

    train_groups, test_groups = train_test_split(
        groups["group_id"],
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=groups["label"],
    )
    train = dataset[dataset["group_id"].isin(train_groups)].copy()
    test = dataset[dataset["group_id"].isin(test_groups)].copy()
    if set(train["group_id"]).intersection(test["group_id"]):
        raise RuntimeError("Group leakage detected between training and test data.")
    return dataset, train, test


def make_random_forest(**parameters: object) -> RandomForestClassifier:
    return RandomForestClassifier(
        random_state=RANDOM_STATE,
        class_weight="balanced",
        n_jobs=-1,
        **parameters,
    )


def metric_row(
    model: object,
    test_features: pd.DataFrame,
    test_labels: pd.Series,
    training_seconds: float,
) -> dict[str, object]:
    prediction_started = time.perf_counter()
    probabilities = model.predict_proba(test_features)[:, 1]
    prediction_ms = (time.perf_counter() - prediction_started) * 1000
    predictions = (probabilities >= THRESHOLD).astype(int)
    matrix = confusion_matrix(test_labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "precision": float(precision_score(test_labels, predictions, zero_division=0)),
        "recall": float(recall_score(test_labels, predictions, zero_division=0)),
        "f1": float(f1_score(test_labels, predictions, zero_division=0)),
        "accuracy": float(accuracy_score(test_labels, predictions)),
        "roc_auc": float(roc_auc_score(test_labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "true_positives": tp,
        "training_seconds": float(training_seconds),
        "test_batch_prediction_ms": float(prediction_ms),
        "test_prediction_ms_per_pair": float(prediction_ms / len(test_features)),
    }


def evaluate_model_comparison(train: pd.DataFrame, test: pd.DataFrame) -> tuple[dict[str, object], dict[str, object]]:
    train_features = train[FEATURE_COLUMNS]
    train_labels = train["label"].astype(int)
    test_features = test[FEATURE_COLUMNS]
    test_labels = test["label"].astype(int)
    folds = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    random_forest_search = GridSearchCV(
        make_random_forest(),
        {
            "n_estimators": [100, 150],
            "max_depth": [3, 4, 5, 6],
            "min_samples_leaf": [2, 5, 10],
            "max_features": ["sqrt"],
        },
        scoring="f1",
        cv=folds,
        n_jobs=-1,
        refit=True,
    )
    rf_started = time.perf_counter()
    random_forest_search.fit(train_features, train_labels, groups=train["group_id"])
    rf_seconds = time.perf_counter() - rf_started

    xgboost_search = GridSearchCV(
        XGBClassifier(
            objective="binary:logistic",
            eval_metric="logloss",
            tree_method="hist",
            random_state=RANDOM_STATE,
            n_jobs=-1,
            verbosity=0,
        ),
        {
            "n_estimators": [100, 150],
            "max_depth": [3, 5],
            "learning_rate": [0.05, 0.1],
            "min_child_weight": [1, 3, 5],
        },
        scoring="f1",
        cv=folds,
        n_jobs=1,
        refit=True,
    )
    xgb_started = time.perf_counter()
    xgboost_search.fit(train_features, train_labels, groups=train["group_id"])
    xgb_seconds = time.perf_counter() - xgb_started

    results = {
        "Random Forest": metric_row(random_forest_search.best_estimator_, test_features, test_labels, rf_seconds),
        "XGBoost": metric_row(xgboost_search.best_estimator_, test_features, test_labels, xgb_seconds),
    }
    config = {
        "random_forest_best_parameters": random_forest_search.best_params_,
        "random_forest_cv_f1": float(random_forest_search.best_score_),
        "xgboost_best_parameters": xgboost_search.best_params_,
        "xgboost_cv_f1": float(xgboost_search.best_score_),
        "random_forest_candidate_count": 24,
        "xgboost_candidate_count": 24,
        "random_forest_model": random_forest_search.best_estimator_,
    }
    return results, config


def evaluate_similarity_comparison(
    train: pd.DataFrame,
    test: pd.DataFrame,
    random_forest_parameters: dict[str, object],
) -> dict[str, object]:
    train_labels = train["label"].astype(int)
    test_labels = test["label"].astype(int)
    train_name = train.apply(lambda row: normalized_levenshtein(row["name_1"], row["name_2"]), axis=1)
    test_name = test.apply(lambda row: normalized_levenshtein(row["name_1"], row["name_2"]), axis=1)
    results = {}

    for label, name_feature in (
        ("Jaro-Winkler", "jaro_winkler"),
        ("Normalized Levenshtein", "normalized_levenshtein"),
    ):
        train_features = train[FEATURE_COLUMNS].copy()
        test_features = test[FEATURE_COLUMNS].copy()
        if name_feature == "normalized_levenshtein":
            train_features["jaro_winkler"] = train_name
            test_features["jaro_winkler"] = test_name

        model = make_random_forest(**random_forest_parameters)
        started = time.perf_counter()
        model.fit(train_features, train_labels)
        training_seconds = time.perf_counter() - started
        results[label] = metric_row(model, test_features, test_labels, training_seconds)
    return results


def markdown_table(results: dict[str, dict[str, object]]) -> str:
    metrics = [
        ("Precision", "precision"),
        ("Recall", "recall"),
        ("F1-score", "f1"),
        ("Accuracy", "accuracy"),
        ("ROC-AUC", "roc_auc"),
        ("False positives", "false_positives"),
        ("False negatives", "false_negatives"),
        ("Confusion matrix (TN, FP / FN, TP)", "confusion_matrix_labels_0_1"),
        ("Training / tuning time (s)", "training_seconds"),
        ("Test batch prediction time (ms)", "test_batch_prediction_ms"),
    ]
    columns = list(results)
    lines = ["| Metric | " + " | ".join(columns) + " |", "|---|" + "|".join(["---:"] * len(columns)) + "|"]
    for label, key in metrics:
        cells = []
        for column in columns:
            value = results[column][key]
            if key == "confusion_matrix_labels_0_1":
                cell = f"{value[0][0]}, {value[0][1]} / {value[1][0]}, {value[1][1]}"
            elif isinstance(value, float):
                cell = f"{value:.4f}" if key not in {"training_seconds", "test_batch_prediction_ms"} else f"{value:.2f}"
            else:
                cell = str(value)
            cells.append(cell)
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def recommend(results: dict[str, dict[str, object]]) -> str:
    # F1 is primary; error-sensitive metrics and AUC break ties.
    return max(
        results,
        key=lambda key: (
            results[key]["f1"],
            results[key]["recall"],
            results[key]["precision"],
            results[key]["roc_auc"],
        ),
    )


def build_report(result: dict[str, object]) -> str:
    model_results = result["model_comparison"]
    similarity_results = result["name_similarity_comparison"]
    model_choice = recommend(model_results)
    similarity_choice = recommend(similarity_results)
    selected_model = model_results[model_choice]
    other_model_name = next(name for name in model_results if name != model_choice)
    other_model = model_results[other_model_name]
    selected_similarity = similarity_results[similarity_choice]
    other_similarity_name = next(name for name in similarity_results if name != similarity_choice)
    other_similarity = similarity_results[other_similarity_name]
    fp_choice = min(model_results, key=lambda name: model_results[name]["false_positives"])
    fn_choice = min(model_results, key=lambda name: model_results[name]["false_negatives"])
    faster_choice = min(model_results, key=lambda name: model_results[name]["training_seconds"])
    model_tradeoff = (
        f"{fp_choice} had {abs(selected_model['false_positives'] - other_model['false_positives'])} fewer false positives; "
        f"{fn_choice} had {abs(selected_model['false_negatives'] - other_model['false_negatives'])} fewer false negatives. "
        f"{faster_choice} tuned faster ({model_results[faster_choice]['training_seconds']:.2f}s)."
    )
    similarity_decisions_match = all(
        similarity_results[similarity_choice][key] == other_similarity[key]
        for key in ("precision", "recall", "f1", "accuracy", "false_positives", "false_negatives")
    )
    similarity_note = (
        f"The two methods produced the same thresholded test decisions; ROC-AUC was "
        f"{selected_similarity['roc_auc']:.4f} for {similarity_choice} and {other_similarity['roc_auc']:.4f} "
        f"for {other_similarity_name}. The measured difference is small, so keeping the existing method is the simpler choice."
        if similarity_decisions_match
        else f"It produced {selected_similarity['false_positives']} false positives and {selected_similarity['false_negatives']} false negatives."
    )
    return f"""# SBMS duplicate-detection experiments

**Dataset:** `{result['dataset']['file']}` · {result['dataset']['rows']:,} synthetic pairs · {result['dataset']['groups']:,} groups  
**Holdout:** {result['split']['test_percent']}% by group, seed {result['split']['random_state']} · {result['split']['train_rows']:,} train / {result['split']['test_rows']:,} test rows · group overlap {result['split']['group_overlap']}  
**Threshold:** {result['threshold']}  
**Environment:** Python {result['versions']['python']} · scikit-learn {result['versions']['scikit_learn']} · XGBoost {result['versions']['xgboost']} · Jellyfish {result['versions']['jellyfish']}

## 1. Random Forest vs XGBoost

Both models use the same six features, group-separated train/test rows, five-fold `StratifiedGroupKFold` tuning on training data, and 24 parameter candidates each. The held-out test set was not used for parameter selection.

{markdown_table(model_results)}

**Recommended research candidate: {model_choice}.** It led on held-out F1 ({selected_model['f1']:.4f} vs {other_model['f1']:.4f}). {model_tradeoff} A false positive can send a legitimate student to review; a false negative can let a duplicate pass undetected. This is a small synthetic-data advantage, not enough by itself to change the production model.

## 2. Jaro-Winkler vs normalized Levenshtein

The same Random Forest settings selected in Experiment 1, same feature set except for the name-similarity value, same group split, and same test rows were used for both methods. Names are normalized to lowercase letters; Levenshtein similarity is `1 - edit_distance / longer_name_length`.

{markdown_table(similarity_results)}

**Recommended research candidate: {similarity_choice}.** Selection is based on held-out F1, then recall, precision, and ROC-AUC as tie-breakers. {similarity_note}

## Limitations and use

- These results describe a synthetic dataset, not real student records. They do not establish real-world effectiveness.
- The generator encodes chosen synthetic error rates and is not a substitute for real, independently labeled records. Group separation prevents related pairs crossing partitions, but cannot prove generalization to the beneficiary population.
- Group separation keeps pairs generated from the same group together. It cannot remove every synthetic-data bias or prove generalization to the beneficiary population.
- The recommendations are for the capstone research comparison. The SBMS production model and backend decision workflow were not changed by this experiment.
- Training times include model search for Experiment 1 and final model fitting for Experiment 2; timing varies by machine.

Dataset SHA-256: `{result['dataset']['sha256']}`
"""


def main() -> dict[str, object]:
    dataset, train, test = load_and_split()
    model_results, model_config = evaluate_model_comparison(train, test)
    similarity_results = evaluate_similarity_comparison(
        train,
        test,
        model_config["random_forest_best_parameters"],
    )
    result = {
        "dataset": {
            "file": str(DATA_FILE.relative_to(ML_DIR)),
            "sha256": hashlib.sha256(DATA_FILE.read_bytes()).hexdigest(),
            "rows": int(len(dataset)),
            "groups": int(dataset["group_id"].nunique()),
            "features": FEATURE_COLUMNS,
        },
        "split": {
            "method": "stratified holdout split over group_id",
            "train_percent": 100 * (1 - TEST_SIZE),
            "test_percent": 100 * TEST_SIZE,
            "random_state": RANDOM_STATE,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_groups": int(train["group_id"].nunique()),
            "test_groups": int(test["group_id"].nunique()),
            "group_overlap": len(set(train["group_id"]).intersection(test["group_id"])),
            "cross_validation": "5-fold StratifiedGroupKFold, training data only",
        },
        "threshold": THRESHOLD,
        "versions": {
            "python": __import__("sys").version.split()[0],
            "scikit_learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
            "jellyfish": getattr(jellyfish, "__version__", "installed"),
        },
        "model_comparison": model_results,
        "model_search": {key: value for key, value in model_config.items() if key != "random_forest_model"},
        "name_similarity_comparison": similarity_results,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    JSON_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    REPORT_FILE.write_text(build_report(result), encoding="utf-8")
    print(f"Saved metrics: {JSON_FILE}")
    print(f"Saved report: {REPORT_FILE}")
    print(build_report(result))
    return result


if __name__ == "__main__":
    main()
