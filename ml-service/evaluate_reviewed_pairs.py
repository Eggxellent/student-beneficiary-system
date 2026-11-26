"""Evaluate the live SBMS duplicate system on manually adjudicated pairs.

The input includes raw pair attributes, but the output contains aggregate metrics
only. Run it locally on an authorized dataset; do not send the input CSV elsewhere.
The system's observed decision is evaluated separately from model-only scores.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
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
from predict import MODEL_FILE, load_model

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BASE_DIR / "evaluation" / "reviewed_pairs_metrics.json"
REQUIRED_COLUMNS = {
    "pair_id", "entity_id_1", "entity_id_2", "partition", "label", "system_flagged",
    "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
    "guardian_1", "guardian_2", "admission_number_1", "admission_number_2",
    "birth_certificate_1", "birth_certificate_2",
}
RAW_FIELDS = (
    ("full_name", "name_1", "name_2"),
    ("date_of_birth", "dob_1", "dob_2"),
    ("school_code", "school_1", "school_2"),
    ("guardian_id", "guardian_1", "guardian_2"),
    ("admission_number", "admission_number_1", "admission_number_2"),
    ("birth_certificate_number", "birth_certificate_1", "birth_certificate_2"),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
        raise ValueError("label must be 1 for human-confirmed same student, 0 for different students.")
    if not data["system_flagged"].isin({"0", "1"}).all():
        raise ValueError("system_flagged must be 1 if the system surfaced the pair for review, otherwise 0.")
    if not data["partition"].isin({"tuning", "holdout"}).all():
        raise ValueError("partition must be 'tuning' or 'holdout'.")
    for column in ("pair_id", "entity_id_1", "entity_id_2", "partition", "label", "system_flagged"):
        if data[column].eq("").any():
            raise ValueError(f"{column} cannot be blank.")

    data["label"] = data["label"].astype(int)
    data["system_flagged"] = data["system_flagged"].astype(int)
    if (data.loc[data.label == 1, "entity_id_1"] != data.loc[data.label == 1, "entity_id_2"]).any():
        raise ValueError("Confirmed duplicate rows must have the same stable entity ID on both sides.")
    if (data.loc[data.label == 0, "entity_id_1"] == data.loc[data.label == 0, "entity_id_2"]).any():
        raise ValueError("Confirmed non-duplicate rows must have different stable entity IDs.")

    entity_partitions: dict[str, set[str]] = {}
    for row in data.itertuples(index=False):
        for entity_id in (row.entity_id_1, row.entity_id_2):
            entity_partitions.setdefault(entity_id, set()).add(row.partition)
    leaked = sum(len(partitions) > 1 for partitions in entity_partitions.values())
    if leaked:
        raise ValueError(
            f"{leaked} entities occur in both tuning and holdout. Split by entity before evaluation."
        )

    for partition, rows in data.groupby("partition"):
        if rows.label.nunique() != 2:
            raise ValueError(f"The {partition} partition must contain both labels.")
    if set(data.partition) != {"tuning", "holdout"}:
        raise ValueError("Both tuning and holdout rows are required.")
    return data


def pair_features(row) -> dict[str, float | int]:
    first = {}
    second = {}
    for feature, left_column, right_column in RAW_FIELDS:
        first[feature] = getattr(row, left_column)
        second[feature] = getattr(row, right_column)
    return build_pair_features(first, second)


def metrics(labels, predictions) -> dict[str, object]:
    labels = np.asarray(labels, dtype=int)
    predictions = np.asarray(predictions, dtype=int)
    tn, fp, fn, tp = (int(value) for value in confusion_matrix(labels, predictions, labels=[0, 1]).ravel())
    return {
        "pair_count": int(len(labels)),
        "positive_count": int(labels.sum()),
        "negative_count": int((labels == 0).sum()),
        "accuracy": float(accuracy_score(labels, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "confusion_matrix_labels_0_1": [[tn, fp], [fn, tp]],
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
    }


def threshold_metrics(labels, probabilities, threshold: float) -> dict[str, object]:
    result = metrics(labels, np.asarray(probabilities) >= threshold)
    result["threshold"] = float(threshold)
    return result


def select_tuning_threshold(labels, probabilities) -> dict[str, float]:
    # Threshold selection uses tuning only. Ties choose the higher threshold.
    scored = [
        (float(f1_score(labels, np.asarray(probabilities) >= threshold, zero_division=0)), threshold)
        for threshold in np.linspace(0.0, 1.0, 101)
    ]
    best_f1 = max(value for value, _ in scored)
    threshold = max(value for f1, value in scored if f1 >= best_f1 - 1e-12)
    return {"threshold": float(threshold), "tuning_f1": float(best_f1)}


def evaluate(input_path: Path, model_path: Path, output_path: Path, system_threshold: float) -> dict[str, object]:
    data = load_reviewed_pairs(input_path)
    feature_rows = [pair_features(row) for row in data.itertuples(index=False)]
    features = pd.DataFrame(feature_rows, columns=FEATURE_COLUMNS)
    model = load_model(model_path)
    probabilities = model.predict_proba(features)[:, 1]
    tuning = data.partition.eq("tuning").to_numpy()
    holdout = data.partition.eq("holdout").to_numpy()
    chosen = select_tuning_threshold(data.loc[tuning, "label"], probabilities[tuning])
    selected_threshold = chosen["threshold"]

    partitions = {}
    for name, mask in (("tuning", tuning), ("holdout", holdout)):
        labels = data.loc[mask, "label"].to_numpy()
        scores = probabilities[mask]
        observed = data.loc[mask, "system_flagged"].to_numpy()
        partitions[name] = {
            "observed_system_decision": metrics(labels, observed),
            "model_at_configured_system_threshold": threshold_metrics(labels, scores, system_threshold),
            "model_at_tuning_selected_threshold": threshold_metrics(labels, scores, selected_threshold),
            "model_roc_auc": float(roc_auc_score(labels, scores)),
            "model_average_precision": float(average_precision_score(labels, scores)),
        }

    result = {
        "input_sha256": sha256(input_path),
        "model_sha256": sha256(model_path),
        "pair_count": int(len(data)),
        "unique_entity_count": int(pd.unique(pd.concat([data.entity_id_1, data.entity_id_2])).size),
        "entity_overlap_between_tuning_and_holdout": 0,
        "configured_system_threshold": float(system_threshold),
        "tuning_selected_model_threshold": chosen,
        "feature_columns": FEATURE_COLUMNS,
        "partitions": partitions,
        "interpretation": (
            "Observed system-decision metrics score the actual system result recorded in system_flagged. "
            "Model threshold metrics score the frozen model separately. The holdout was not used to "
            "select a threshold. Results apply only to this manually reviewed sample."
        ),
        "privacy": "This report contains aggregate metrics and hashes only; it omits pair values and entity IDs.",
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Local CSV of manually reviewed pairs")
    parser.add_argument("--model", type=Path, default=MODEL_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--system-threshold", type=float, default=0.50,
        help="Configured ML review threshold used during system testing (default: backend default 0.50)",
    )
    args = parser.parse_args()
    if not 0 <= args.system_threshold <= 1:
        parser.error("--system-threshold must be between 0 and 1")
    if not args.model.is_file():
        raise FileNotFoundError(f"Production model not found: {args.model}")
    result = evaluate(args.input, args.model, args.output, args.system_threshold)
    print(json.dumps({"pair_count": result["pair_count"], "output": str(args.output.resolve())}, indent=2))


if __name__ == "__main__":
    main()
