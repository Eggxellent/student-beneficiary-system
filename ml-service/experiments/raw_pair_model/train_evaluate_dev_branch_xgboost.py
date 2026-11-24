"""Train fresh XGBoost on the selected dev-branch train/holdout datasets."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import joblib
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
DATA_DIR = BASE / "data" / "dev_branch_attachment_style"
TRAIN_FILE = DATA_DIR / "pairs_attachment_style_train.csv"
HOLDOUT_FILE = DATA_DIR / "pairs_attachment_style_holdout.csv"
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
RAW_FIELDS = ["name", "dob", "school", "guardian", "upi", "birth_certificate"]
SIDES = [f"{field}_{side}" for field in RAW_FIELDS for side in (1, 2)]
MISSING_MARKERS = {
    "", "????", "12345", "N/A", "UNKNOWN", "SCH001", "SCH009", "0000-00-00",
    "G000000", "UPI-00000000", "BC-000000", "NONE", "NULL",
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip().upper()


def signatures(frame: pd.DataFrame) -> tuple[set[tuple[str, ...]], set[tuple[tuple[str, ...], tuple[str, ...]]]]:
    records: set[tuple[str, ...]] = set()
    pairs: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    for values in frame[SIDES].itertuples(index=False, name=None):
        left = tuple(clean(value) for value in values[0::2])
        right = tuple(clean(value) for value in values[1::2])
        records.update((left, right))
        pairs.add(tuple(sorted((left, right))))
    return records, pairs


def field_value_overlap(train: pd.DataFrame, holdout: pd.DataFrame) -> dict[str, int]:
    overlaps: dict[str, int] = {}
    for field in RAW_FIELDS:
        train_values = {
            clean(value)
            for side in (1, 2)
            for value in train[f"{field}_{side}"].dropna()
            if clean(value) not in MISSING_MARKERS
        }
        holdout_values = {
            clean(value)
            for side in (1, 2)
            for value in holdout[f"{field}_{side}"].dropna()
            if clean(value) not in MISSING_MARKERS
        }
        overlaps[field] = len(train_values & holdout_values)
    return overlaps


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, keep_default_na=True, float_precision="round_trip")
    holdout = pd.read_csv(HOLDOUT_FILE, keep_default_na=True, float_precision="round_trip")
    required = {*FEATURES, "label", "group_id", "pair_scenario", *SIDES}
    for name, frame in (("training", train), ("holdout", holdout)):
        missing_columns = sorted(required - set(frame.columns))
        if missing_columns:
            raise ValueError(f"{name} dataset missing columns: {missing_columns}")
        if frame[[*FEATURES, "label", "group_id"]].isna().any().any():
            raise ValueError(f"{name} data contains missing features, labels, or groups")
        if set(frame.label.unique()) != {0, 1}:
            raise ValueError(f"{name} labels must contain both 0 and 1")
        if frame.groupby("group_id").label.nunique().gt(1).any():
            raise ValueError(f"{name} group_id maps to multiple labels")
        if not frame[FEATURES].apply(lambda col: col.between(0, 1).all()).all():
            raise ValueError(f"{name} has comparison features outside [0, 1]")

    train_record_signatures, train_pair_signatures = signatures(train)
    holdout_record_signatures, holdout_pair_signatures = signatures(holdout)
    group_overlap = len(set(train.group_id.astype(str)) & set(holdout.group_id.astype(str)))
    record_overlap = len(train_record_signatures & holdout_record_signatures)
    pair_overlap = len(train_pair_signatures & holdout_pair_signatures)
    y_train, y_test = train.label.astype(int), holdout.label.astype(int)

    # Same fixed XGBoost configuration/features/threshold as the raw-pair run.
    # The dev dataset supplies a separately generated holdout; it is never used
    # for fitting, threshold selection, or tuning.
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
    predicted = (probabilities >= THRESHOLD).astype(int)
    evaluation_seconds = time.perf_counter() - started

    matrix = confusion_matrix(y_test, predicted, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    model_path = OUT / "dev_branch_xgboost.joblib"
    report_path = OUT / "dev_branch_xgboost_metrics.json"
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, model_path)

    report: dict[str, object] = {
        "experiment": "fresh XGBoost trained on dev branch attachment-style training CSV",
        "source_branch": "origin/dev (read-only; no changes made)",
        "dataset": {
            "train_file": "ml-service/data/dev_branch_attachment_style/pairs_attachment_style_train.csv",
            "holdout_file": "ml-service/data/dev_branch_attachment_style/pairs_attachment_style_holdout.csv",
            "train_sha256": file_hash(TRAIN_FILE),
            "holdout_sha256": file_hash(HOLDOUT_FILE),
            "train_rows": int(len(train)),
            "holdout_rows": int(len(holdout)),
            "train_class_counts": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
            "holdout_class_counts": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
            "train_groups": int(train.group_id.nunique()),
            "holdout_groups": int(holdout.group_id.nunique()),
            "train_exact_duplicate_rows_retained": int(train.duplicated().sum()),
            "holdout_exact_duplicate_rows_retained": int(holdout.duplicated().sum()),
            "feature_missing_values": {
                "train": {col: int(train[col].isna().sum()) for col in FEATURES},
                "holdout": {col: int(holdout[col].isna().sum()) for col in FEATURES},
            },
            "raw_school_missing_values": {
                "train_school_1": int(train.school_1.isna().sum()),
                "train_school_2": int(train.school_2.isna().sum()),
                "holdout_school_1": int(holdout.school_1.isna().sum()),
                "holdout_school_2": int(holdout.school_2.isna().sum()),
            },
        },
        "validity": {
            "group_ids_overlapping_train_holdout": group_overlap,
            "exact_record_signatures_overlapping_train_holdout": record_overlap,
            "exact_unordered_pairs_overlapping_train_holdout": pair_overlap,
            "valid_raw_field_value_overlap_excluding_known_placeholders": field_value_overlap(train, holdout),
            "features_used": FEATURES,
            "excluded_from_model": ["label", "group_id", "pair_scenario", "raw names/dates/schools/IDs"],
            "test_set_used_for_fit_or_tuning": False,
            "limitation": "Independent synthetic domains are used; this evaluates generalization to the supplied holdout, not real-world records.",
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
            "preprocessing": "training-fitted median SimpleImputer; comparison features had no missing values",
            "threshold": THRESHOLD,
        },
        "metrics": {
            "accuracy": float(accuracy_score(y_test, predicted)),
            "precision": float(precision_score(y_test, predicted, zero_division=0)),
            "recall": float(recall_score(y_test, predicted, zero_division=0)),
            "f1": float(f1_score(y_test, predicted, zero_division=0)),
            "roc_auc": float(roc_auc_score(y_test, probabilities)),
            "pr_auc_average_precision": float(average_precision_score(y_test, probabilities)),
            "confusion_matrix_rows_actual_0_1_columns_predicted_0_1": matrix.tolist(),
            "true_negatives": tn,
            "false_positives": fp,
            "false_negatives": fn,
            "true_positives": tp,
        },
        "timing_seconds": {"training": training_seconds, "holdout_evaluation": evaluation_seconds},
        "versions": {"xgboost": xgboost.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
        "artifacts": {"model": model_path.name, "model_sha256": file_hash(model_path), "report": report_path.name},
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
