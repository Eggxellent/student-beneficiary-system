"""Fresh, grouped train/test experiment over the supplied raw_pairs.csv."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
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

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "raw_pairs.csv"
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
RECORD_FIELDS = ["name", "dob", "school", "guardian", "upi"]
SIDE_PAIRS = [(f"{field}_1", f"{field}_2") for field in RECORD_FIELDS]
REQUIRED = {
    *(field for pair in SIDE_PAIRS for field in pair),
    *FEATURES,
    "label",
    "group_id",
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip().upper()


def record_signature(row: tuple, columns: dict[str, int], side: int) -> tuple[str, ...]:
    return tuple(normalized(row[columns[f"{field}_{side}"]]) for field in RECORD_FIELDS)


def audit_overlaps(data: pd.DataFrame, train_idx: np.ndarray, test_idx: np.ndarray) -> dict[str, int]:
    columns = {name: position for position, name in enumerate(data.columns)}
    train_records: set[tuple[str, ...]] = set()
    test_records: set[tuple[str, ...]] = set()
    train_pairs: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    test_pairs: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()

    for indices, record_set, pair_set in (
        (train_idx, train_records, train_pairs),
        (test_idx, test_records, test_pairs),
    ):
        for values in data.iloc[indices].itertuples(index=False, name=None):
            first = record_signature(values, columns, 1)
            second = record_signature(values, columns, 2)
            record_set.update((first, second))
            pair_set.add(tuple(sorted((first, second))))

    train_groups = set(data.iloc[train_idx]["group_id"].astype(str))
    test_groups = set(data.iloc[test_idx]["group_id"].astype(str))
    return {
        "group_ids_in_both_splits": len(train_groups & test_groups),
        "exact_record_signatures_in_both_splits": len(train_records & test_records),
        "exact_unordered_pairs_in_both_splits": len(train_pairs & test_pairs),
    }


def main() -> dict[str, object]:
    if not DATA.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATA}")
    data = pd.read_csv(DATA, keep_default_na=True, float_precision="round_trip")
    missing_columns = sorted(REQUIRED - set(data.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")
    if data["label"].isna().any() or set(data["label"].unique()) != {0, 1}:
        raise ValueError("label must contain both classes, encoded as 0 and 1, with no missing values")
    if data["group_id"].isna().any():
        raise ValueError("group_id is required for leakage-resistant splitting")
    if data.groupby("group_id")["label"].nunique().gt(1).any():
        raise ValueError("A group_id maps to more than one label")
    if not np.isfinite(data[FEATURES].to_numpy(dtype=float)).all():
        raise ValueError("Comparison features must be finite numeric values")
    if not data[FEATURES].apply(lambda s: s.between(0, 1).all()).all():
        raise ValueError("Comparison features must fall within [0, 1]")

    # One held-out fold from a deterministic stratified grouped 5-fold split.
    # Group IDs are never model inputs. No tuning or threshold selection occurs.
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    train_idx, test_idx = next(splitter.split(data[FEATURES], data["label"], data["group_id"]))
    train, test = data.iloc[train_idx], data.iloc[test_idx]
    y_train = train["label"].astype(int)
    y_test = test["label"].astype(int)

    pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=200,
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
    probabilities = pipeline.predict_proba(test[FEATURES])[:, 1]
    predictions = (probabilities >= THRESHOLD).astype(int)
    evaluation_seconds = time.perf_counter() - started
    matrix = confusion_matrix(y_test, predictions, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())

    exact_duplicates = int(data.duplicated().sum())
    duplicate_train = int(train.duplicated().sum())
    duplicate_test = int(test.duplicated().sum())
    split_overlap = audit_overlaps(data, train_idx, test_idx)

    report: dict[str, object] = {
        "experiment": "fresh raw_pairs.csv model experiment; no production model loaded or changed",
        "dataset": {
            "path": "ml-service/data/raw_pairs.csv",
            "sha256": file_hash(DATA),
            "rows": int(len(data)),
            "target": "label (0=non-duplicate, 1=duplicate)",
            "feature_count": len(FEATURES),
            "features": FEATURES,
            "column_data_types": {key: str(value) for key, value in data.dtypes.items()},
            "raw_record_fields_available": [f for pair in SIDE_PAIRS for f in pair],
            "source_type": "synthetic pair data with raw student fields and precomputed comparison features",
            "class_counts": {str(k): int(v) for k, v in data.label.value_counts().sort_index().items()},
            "raw_field_missing_counts": {
                key: int(value) for key, value in data.isna().sum().items()
                if key in {f for pair in SIDE_PAIRS for f in pair}
            },
            "feature_missing_counts": {key: int(data[key].isna().sum()) for key in FEATURES},
            "exact_duplicate_rows_retained": exact_duplicates,
            "unique_comparison_feature_vectors": int(data[FEATURES].drop_duplicates().shape[0]),
            "feature_vectors_seen_with_both_labels": int(
                data.groupby(FEATURES, dropna=False)["label"].nunique().gt(1).sum()
            ),
        },
        "split": {
            "method": "first fold of StratifiedGroupKFold(n_splits=5, shuffle=True)",
            "seed": SEED,
            "ratio": "approximately 80/20",
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_groups": int(train.group_id.nunique()),
            "test_groups": int(test.group_id.nunique()),
            "train_class_counts": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
            "test_class_counts": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
            "duplicate_rows_train": duplicate_train,
            "duplicate_rows_test": duplicate_test,
            **split_overlap,
            "identity_limit": "group_id keeps each generated pair group together; the CSV has no canonical student IDs, so unseen-student generalization cannot be fully established",
        },
        "model": {
            "algorithm": "RandomForestClassifier",
            "parameters": {"n_estimators": 200, "random_state": SEED, "n_jobs": -1},
            "preprocessing": "median SimpleImputer in a training-fitted pipeline; features complete, so no values were imputed",
            "threshold": THRESHOLD,
            "features_used": FEATURES,
            "excluded": ["label (target)", "group_id (split key)", "raw names, DOBs, schools, and identifiers"],
        },
        "metrics": {
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
        },
        "timing_seconds": {
            "training": training_seconds,
            "test_evaluation": evaluation_seconds,
        },
        "validity_notes": [
            "Test rows were not used to fit preprocessing or the model; no hyperparameter or threshold tuning was performed.",
            "No group IDs, row identifiers, scenario labels, or existing model predictions were used as features.",
            "The input CSV has precomputed comparison features; birth_certificate_match is provided but the corresponding raw birth certificate values are absent, so that one feature cannot be independently recomputed from this file.",
            "Repeated exact rows were retained; grouped splitting keeps duplicate rows from a group in one partition.",
            "The supplied data is synthetic; these scores describe this dataset only and do not establish real-world accuracy.",
        ],
        "versions": {"python": __import__("sys").version.split()[0], "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
    }

    OUT.mkdir(parents=True, exist_ok=True)
    model_path = OUT / "raw_pair_random_forest.joblib"
    report_path = OUT / "raw_pair_experiment_metrics.json"
    manifest_path = OUT / "raw_pair_split_manifest.csv"
    joblib.dump(pipeline, model_path)
    report["artifacts"] = {
        "model": model_path.name,
        "model_sha256": file_hash(model_path),
        "report": report_path.name,
        "split_manifest": manifest_path.name,
    }
    manifest = pd.DataFrame({"row_index": data.index, "group_id": data.group_id.astype(str)})
    manifest["split"] = "train"
    manifest.loc[test_idx, "split"] = "test"
    manifest.to_csv(manifest_path, index=False)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
