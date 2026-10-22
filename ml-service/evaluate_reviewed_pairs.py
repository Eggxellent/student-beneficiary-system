"""Evaluate a frozen candidate on human-reviewed pairs with identity separation.

The reviewed CSV must assign each pair to either ``tuning`` or ``holdout``.
No entity may occur in both partitions. This script never fits or saves a model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
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

from feature_engineering import FEATURE_COLUMNS, build_pair_features

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = BASE_DIR / "model" / "research" / "rf_attachment_style_candidate.joblib"
DEFAULT_OUTPUT = BASE_DIR / "evaluation" / "reviewed_pairs_metrics.json"
REQUIRED_COLUMNS = {
    "pair_id", "entity_id_1", "entity_id_2", "partition", "label",
    "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
    "guardian_1", "guardian_2", "upi_1", "upi_2",
    "birth_certificate_1", "birth_certificate_2",
}
THRESHOLDS = (0.30, 0.40, 0.50, 0.60, 0.70)
MISSING_MARKERS = {"", "UNKNOWN", "N/A", "NA", "NULL", "NONE", "????"}


def normalized_value(value: str) -> str | None:
    return None if value.strip().upper() in MISSING_MARKERS else value


def load_reviewed_pairs(path: Path) -> pd.DataFrame:
    data = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = sorted(REQUIRED_COLUMNS - set(data.columns))
    if missing:
        raise ValueError(f"Input CSV is missing columns: {', '.join(missing)}")
    if data.empty:
        raise ValueError("Input CSV has no reviewed pairs.")
    if data["pair_id"].duplicated().any():
        raise ValueError("pair_id values must be unique.")
    if not data["label"].isin({"0", "1"}).all():
        raise ValueError("label must be 1 for confirmed duplicate or 0 for confirmed non-duplicate.")
    if not data["partition"].isin({"tuning", "holdout"}).all():
        raise ValueError("partition must be 'tuning' or 'holdout'.")
    if data[list(REQUIRED_COLUMNS)].eq("").any().any():
        raise ValueError("Required values cannot be blank. Use stable pseudonymous entity IDs.")

    data["label"] = data["label"].astype(int)
    if (data.loc[data.label == 1, "entity_id_1"] != data.loc[data.label == 1, "entity_id_2"]).any():
        raise ValueError("Confirmed duplicate rows must have the same adjudicated entity ID on both sides.")
    if (data.loc[data.label == 0, "entity_id_1"] == data.loc[data.label == 0, "entity_id_2"]).any():
        raise ValueError("Confirmed non-duplicate rows must have different entity IDs.")

    entity_partitions: dict[str, set[str]] = {}
    for row in data.itertuples(index=False):
        for entity_id in (row.entity_id_1, row.entity_id_2):
            entity_partitions.setdefault(entity_id, set()).add(row.partition)
    leaked = sorted(entity_id for entity_id, parts in entity_partitions.items() if len(parts) > 1)
    if leaked:
        raise ValueError(
            f"{len(leaked)} adjudicated entities occur in both tuning and holdout. "
            "Rebuild the split by entity before evaluation."
        )

    for partition, rows in data.groupby("partition"):
        if rows.label.nunique() != 2:
            raise ValueError(f"The {partition} partition must contain both labels.")
    return data


def add_features(data: pd.DataFrame) -> pd.DataFrame:
    feature_rows = []
    for row in data.itertuples(index=False):
        first = {
            "full_name": normalized_value(row.name_1),
            "date_of_birth": normalized_value(row.dob_1),
            "school_code": normalized_value(row.school_1),
            "guardian_id": normalized_value(row.guardian_1),
            "upi": normalized_value(row.upi_1),
            "birth_certificate_number": normalized_value(row.birth_certificate_1),
        }
        second = {
            "full_name": normalized_value(row.name_2),
            "date_of_birth": normalized_value(row.dob_2),
            "school_code": normalized_value(row.school_2),
            "guardian_id": normalized_value(row.guardian_2),
            "upi": normalized_value(row.upi_2),
            "birth_certificate_number": normalized_value(row.birth_certificate_2),
        }
        feature_rows.append(build_pair_features(first, second))
    features = pd.DataFrame(feature_rows, columns=FEATURE_COLUMNS)
    if features.isnull().any().any():
        raise ValueError("Feature generation produced missing values.")
    return features


def metric_row(labels: pd.Series, probabilities, threshold: float) -> dict[str, object]:
    predictions = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return {
        "threshold": threshold,
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "accuracy": float(accuracy_score(labels, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predictions)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "review_candidates": int(predictions.sum()),
    }


def evaluate(input_path: Path, model_path: Path, output_path: Path) -> dict[str, object]:
    data = load_reviewed_pairs(input_path)
    features = add_features(data)
    model = joblib.load(model_path)
    probabilities = model.predict_proba(features)[:, 1]

    partitions: dict[str, object] = {}
    for name in ("tuning", "holdout"):
        mask = data.partition.eq(name)
        labels = data.loc[mask, "label"].astype(int).reset_index(drop=True)
        scores = probabilities[mask.to_numpy()]
        partitions[name] = {
            "pair_count": int(mask.sum()),
            "positive_count": int(labels.sum()),
            "negative_count": int((labels == 0).sum()),
            "roc_auc": float(roc_auc_score(labels, scores)),
            "average_precision": float(average_precision_score(labels, scores)),
            "threshold_metrics": [metric_row(labels, scores, threshold) for threshold in THRESHOLDS],
        }

    result = {
        "input_file": str(input_path.resolve()),
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "model_file": str(model_path.resolve()),
        "model_sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        "pair_count": len(data),
        "entity_count": int(pd.unique(pd.concat([data.entity_id_1, data.entity_id_2])).size),
        "partitions": partitions,
        "interpretation": (
            "Tuning metrics may guide a threshold choice. Holdout metrics are the final "
            "evaluation and must not be used to choose that threshold. These results apply "
            "only to this reviewed sample and its case-selection process."
        ),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Authorized human-reviewed pair CSV")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if not args.model.is_file():
        raise FileNotFoundError(f"Candidate model not found: {args.model}")
    result = evaluate(args.input, args.model, args.output)
    print(json.dumps({"pair_count": result["pair_count"], "output": str(args.output.resolve())}, indent=2))


if __name__ == "__main__":
    main()
