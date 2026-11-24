"""Fresh XGBoost run on the current model's realistic train/holdout datasets."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import joblib
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
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

BASE = Path(__file__).resolve().parents[2]
DATA_DIR = BASE / "data" / "realistic_pairs_comparison"
TRAIN_FILE = DATA_DIR / "realistic_pairs_train.csv"
HOLDOUT_FILE = DATA_DIR / "realistic_pairs_holdout.csv"
REFERENCE_FILE = DATA_DIR / "current_model_evaluation_metrics.json"
OUT = Path(__file__).resolve().parent
SEED = 20261021
THRESHOLD = 0.5
FEATURES = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]
RECORD_FIELDS = ["name", "dob", "school", "guardian", "upi", "birth_certificate"]
PAIR_FIELDS = [f"{field}_{side}" for field in RECORD_FIELDS for side in (1, 2)]


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip().upper()


def signatures(data: pd.DataFrame) -> tuple[set[tuple[str, ...]], set[tuple[tuple[str, ...], tuple[str, ...]]]]:
    records: set[tuple[str, ...]] = set()
    pairs: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    for row in data[PAIR_FIELDS].itertuples(index=False, name=None):
        first = tuple(normalize(value) for value in row[0::2])
        second = tuple(normalize(value) for value in row[1::2])
        records.update((first, second))
        pairs.add(tuple(sorted((first, second))))
    return records, pairs


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, keep_default_na=True, float_precision="round_trip")
    holdout = pd.read_csv(HOLDOUT_FILE, keep_default_na=True, float_precision="round_trip")
    reference = json.loads(REFERENCE_FILE.read_text(encoding="utf-8"))
    if file_hash(TRAIN_FILE) != reference["training_sha256"]:
        raise ValueError("Training CSV hash does not match the current-model evaluation report")
    if file_hash(HOLDOUT_FILE) != reference["holdout_sha256"]:
        raise ValueError("Holdout CSV hash does not match the current-model evaluation report")
    required = {*FEATURES, "label", "group_id", "scenario", *PAIR_FIELDS}
    for label, frame in (("training", train), ("holdout", holdout)):
        absent = sorted(required - set(frame.columns))
        if absent:
            raise ValueError(f"{label} dataset is missing required columns: {absent}")
        if frame[[*FEATURES, "label", "group_id"]].isna().any().any():
            raise ValueError(f"{label} set has missing feature, target, or group values")
        if set(frame.label.unique()) != {0, 1}:
            raise ValueError(f"{label} set must include binary labels 0 and 1")
        if frame.groupby("group_id").label.nunique().gt(1).any():
            raise ValueError(f"{label} group_id maps to multiple labels")
        if not np.isfinite(frame[FEATURES].to_numpy(dtype=float)).all():
            raise ValueError(f"{label} features must be finite")
        if not frame[FEATURES].apply(lambda col: col.between(0, 1).all()).all():
            raise ValueError(f"{label} comparison features must be in [0, 1]")

    train_records, train_pairs = signatures(train)
    holdout_records, holdout_pairs = signatures(holdout)
    group_overlap = len(set(train.group_id.astype(str)) & set(holdout.group_id.astype(str)))
    record_overlap = len(train_records & holdout_records)
    pair_overlap = len(train_pairs & holdout_pairs)
    y_train, y_test = train.label.astype(int), holdout.label.astype(int)

    # Same XGBoost configuration and threshold as prior XGBoost experiments.
    # All 12k training rows are used; the independently generated 12k holdout
    # is never used for preprocessing fit, training, or tuning.
    pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "classifier",
                XGBClassifier(
                    n_estimators=250,
                    max_depth=4,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    reg_lambda=1.0,
                    objective="binary:logistic",
                    eval_metric="logloss",
                    tree_method="hist",
                    random_state=SEED,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    started = time.perf_counter()
    pipeline.fit(train[FEATURES], y_train)
    training_seconds = time.perf_counter() - started
    started = time.perf_counter()
    probabilities = pipeline.predict_proba(holdout[FEATURES])[:, 1]
    predictions = (probabilities >= THRESHOLD).astype(int)
    evaluation_seconds = time.perf_counter() - started
    matrix = confusion_matrix(y_test, predictions, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())

    model_path = OUT / "realistic_xgboost.joblib"
    report_path = OUT / "realistic_xgboost_comparison.json"
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, model_path)
    metrics = {
        "accuracy": float(accuracy_score(y_test, predictions)),
        "precision": float(precision_score(y_test, predictions, zero_division=0)),
        "recall": float(recall_score(y_test, predictions, zero_division=0)),
        "f1": float(f1_score(y_test, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, probabilities)),
        "pr_auc_average_precision": float(average_precision_score(y_test, probabilities)),
        "confusion_matrix_rows_actual_0_1_columns_predicted_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
    }
    reference_metrics = reference["independent_holdout_metrics"]
    report: dict[str, object] = {
        "experiment": "Fresh XGBoost versus current production-model evaluation on identical holdout rows",
        "dataset": {
            "train_rows": len(train),
            "holdout_rows": len(holdout),
            "train_sha256": file_hash(TRAIN_FILE),
            "holdout_sha256": file_hash(HOLDOUT_FILE),
            "train_groups": int(train.group_id.nunique()),
            "holdout_groups": int(holdout.group_id.nunique()),
            "train_class_counts": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
            "holdout_class_counts": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
            "train_duplicate_rows_retained": int(train.duplicated().sum()),
            "holdout_duplicate_rows_retained": int(holdout.duplicated().sum()),
            "feature_missing_counts": {
                "train": {key: int(train[key].isna().sum()) for key in FEATURES},
                "holdout": {key: int(holdout[key].isna().sum()) for key in FEATURES},
            },
        },
        "leakage_checks": {
            "group_ids_overlapping_splits": group_overlap,
            "exact_record_signatures_overlapping_splits": record_overlap,
            "exact_unordered_pairs_overlapping_splits": pair_overlap,
            "holdout_used_for_training_or_tuning": False,
            "model_features": FEATURES,
            "excluded": ["label", "group_id", "scenario", "raw student names, DOBs, schools, and identifiers"],
        },
        "model": {
            "algorithm": "XGBClassifier",
            "parameters": {
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
            },
            "preprocessing": "median SimpleImputer fit in training-only pipeline; feature columns are complete",
            "threshold": THRESHOLD,
        },
        "xgboost_metrics": metrics,
        "current_random_forest_metrics_same_holdout": {
            key: reference_metrics[key]
            for key in (
                "accuracy", "precision", "recall", "f1", "roc_auc", "average_precision",
                "true_negatives", "false_positives", "false_negatives", "true_positives",
            )
        },
        "timing_seconds": {"training": training_seconds, "holdout_evaluation": evaluation_seconds},
        "interpretation_limit": "The holdout is synthetic and generated by the same documented simulator, not independently reviewed real-world records.",
        "versions": {"xgboost": xgboost.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
        "artifacts": {"model": model_path.name, "model_sha256": file_hash(model_path), "report": report_path.name},
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
