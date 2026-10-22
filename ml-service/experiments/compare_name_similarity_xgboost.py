"""Compare Jaro-Winkler and normalized Levenshtein with identical XGBoost runs."""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

import jellyfish
import numpy as np
import pandas as pd
import sklearn
import xgboost
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

ML_DIR = Path(__file__).resolve().parents[1]
TRAIN_FILE = ML_DIR / "training" / "realistic_pairs_train.csv"
HOLDOUT_FILE = ML_DIR / "evaluation" / "realistic_pairs_holdout.csv"
OUTPUT_FILE = ML_DIR / "evaluation" / "xgboost_name_similarity_comparison.json"
METRIC_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]
RECORD_COLUMNS = [
    "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
    "guardian_1", "guardian_2", "upi_1", "upi_2",
    "birth_certificate_1", "birth_certificate_2",
]
SEED = 20261021
THRESHOLD = 0.5
XGB_PARAMS = {
    "n_estimators": 250,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "reg_lambda": 1.0,
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "tree_method": "hist",
    "random_state": SEED,
    "n_jobs": -1,
    "verbosity": 0,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_name(value: object) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if text.upper() in {"", "?", "NA", "N/A", "NONE", "NULL", "UNKNOWN", "NOT PROVIDED", "NOT AVAILABLE"}:
        return ""
    compact = re.sub(r"[^A-Z0-9]", "", text.upper())
    if len(compact) >= 4 and set(compact) == {"0"}:
        return ""
    return re.sub(r"[^a-z]", "", text.lower())


def normalized_levenshtein(first: object, second: object) -> float:
    left, right = clean_name(first), clean_name(second)
    if not left or not right:
        return 0.0
    return float(1.0 - jellyfish.levenshtein_distance(left, right) / max(len(left), len(right)))


def features(frame: pd.DataFrame, name_metric: str) -> pd.DataFrame:
    result = frame[METRIC_COLUMNS].copy()
    if name_metric == "normalized_levenshtein":
        result["jaro_winkler"] = [
            normalized_levenshtein(first, second)
            for first, second in zip(frame.name_1, frame.name_2, strict=True)
        ]
    return result


def make_model() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("classifier", XGBClassifier(**XGB_PARAMS)),
    ])


def score(labels: pd.Series | np.ndarray, probabilities: np.ndarray) -> dict[str, object]:
    predictions = (probabilities >= THRESHOLD).astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    return {
        "threshold": THRESHOLD,
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "pr_auc_average_precision": float(average_precision_score(labels, probabilities)),
        "confusion_matrix_actual_0_1_predicted_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
    }


def grouped_oof(frame: pd.DataFrame, x: pd.DataFrame, y: pd.Series) -> tuple[dict[str, object], float]:
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    probabilities = np.full(len(frame), np.nan, dtype=float)
    started = time.perf_counter()
    for fit_idx, validation_idx in splitter.split(x, y, groups=frame.group_id):
        model = make_model()
        model.fit(x.iloc[fit_idx], y.iloc[fit_idx])
        probabilities[validation_idx] = model.predict_proba(x.iloc[validation_idx])[:, 1]
    if not np.isfinite(probabilities).all():
        raise RuntimeError("Grouped OOF scoring left rows without predictions")
    return score(y, probabilities), time.perf_counter() - started


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    holdout = pd.read_csv(HOLDOUT_FILE, float_precision="round_trip")
    required = {"group_id", "label", *RECORD_COLUMNS, *METRIC_COLUMNS}
    for name, frame in (("training", train), ("holdout", holdout)):
        absent = sorted(required - set(frame.columns))
        if absent:
            raise ValueError(f"{name} data missing columns: {absent}")
        if frame[["group_id", "label", *METRIC_COLUMNS]].isna().any().any():
            raise ValueError(f"{name} has missing groups, labels, or stored features")
        if frame.groupby("group_id").label.nunique().gt(1).any():
            raise ValueError(f"{name} has inconsistent labels within a pair group")
        if set(frame.label.astype(int).unique()) != {0, 1}:
            raise ValueError(f"{name} must contain both labels")
        if not frame[METRIC_COLUMNS].apply(lambda column: column.between(0, 1).all()).all():
            raise ValueError(f"{name} features must be in [0,1]")

    group_overlap = len(set(train.group_id.astype(str)) & set(holdout.group_id.astype(str)))
    if group_overlap:
        raise ValueError("Training and holdout group IDs overlap")
    train_labels, test_labels = train.label.astype(int), holdout.label.astype(int)
    results: dict[str, object] = {}

    for label, method in (("Jaro-Winkler", "jaro_winkler"), ("Normalized Levenshtein", "normalized_levenshtein")):
        train_x = features(train, method)
        holdout_x = features(holdout, method)
        cv_metrics, cv_seconds = grouped_oof(train, train_x, train_labels)
        model = make_model()
        started = time.perf_counter()
        model.fit(train_x, train_labels)
        fit_seconds = time.perf_counter() - started
        started = time.perf_counter()
        test_probabilities = model.predict_proba(holdout_x)[:, 1]
        test_seconds = time.perf_counter() - started
        results[label] = {
            "training_grouped_cv_oof": cv_metrics,
            "heldout_test": score(test_labels, test_probabilities),
            "timing_seconds": {
                "grouped_cv": cv_seconds,
                "full_training_fit": fit_seconds,
                "heldout_evaluation": test_seconds,
            },
        }

    report = {
        "experiment": "Paired XGBoost comparison of name similarity features",
        "dataset": {
            "training_file": str(TRAIN_FILE.relative_to(ML_DIR)),
            "training_sha256": sha256(TRAIN_FILE),
            "training_rows": len(train),
            "training_groups": int(train.group_id.nunique()),
            "training_class_counts": {str(k): int(v) for k, v in train_labels.value_counts().sort_index().items()},
            "holdout_file": str(HOLDOUT_FILE.relative_to(ML_DIR)),
            "holdout_sha256": sha256(HOLDOUT_FILE),
            "holdout_rows": len(holdout),
            "holdout_groups": int(holdout.group_id.nunique()),
            "holdout_class_counts": {str(k): int(v) for k, v in test_labels.value_counts().sort_index().items()},
            "group_id_overlap": group_overlap,
        },
        "model": {
            "algorithm": "XGBClassifier",
            "parameters": XGB_PARAMS,
            "preprocessing": "Median imputer fit within each training fold; validated features are complete.",
            "threshold": THRESHOLD,
        },
        "feature_comparison": {
            "shared_features": ["dob_match", "school_match", "guardian_match", "upi_match", "birth_certificate_match"],
            "jaro_winkler": "Existing stored feature, calculated with direct and token-order-tolerant Jaro-Winkler.",
            "normalized_levenshtein": "Replace only the name feature with 1 - Levenshtein distance / longer cleaned-name length; missing names score 0.",
            "both_name_features_calculated_from_raw_names_at_prediction_time": True,
        },
        "results": results,
        "limitations": [
            "The datasets are synthetic and do not establish performance on real beneficiaries.",
            "The holdout was previously used in the Random Forest versus XGBoost comparison, so it is not a pristine first-use evaluation.",
            "The Jaro-Winkler and Levenshtein holdout results are descriptive; the training-only grouped OOF results are the cleaner basis for comparing name metrics.",
        ],
        "versions": {"xgboost": xgboost.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
