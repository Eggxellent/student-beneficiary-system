"""Fit on noisy latent-identity pairs and evaluate on separate generated data."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, average_precision_score, balanced_accuracy_score,
    confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold, train_test_split

from feature_engineering import FEATURE_COLUMNS
BASE = Path(__file__).resolve().parent
CANDIDATE = BASE / "model" / "research" / "rf_attachment_style_candidate.joblib"
TRAIN_FILE = BASE / "training" / "pairs_attachment_style_train.csv"
INTERNAL_FILE = BASE / "evaluation" / "pairs_attachment_style_internal_test.csv"
HOLDOUT_FILE = BASE / "evaluation" / "pairs_attachment_style_holdout.csv"
REPORT = BASE / "evaluation" / "attachment_style_retraining_metrics.json"
COUNT = 10_000
POSITIVE_RATE = 0.50  # Balanced synthetic labels from the attachment, not an SBMS rate.
SPLIT_SEED = 51_042
NONVALUES = {"", "????", "12345", "N/A", "UNKNOWN", "SCH001", "SCH009", "0000-00-00", "G000000", "UPI-00000000", "BC-000000"}


def observed_values(data: pd.DataFrame, columns: tuple[str, str]) -> set[str]:
    return {
        str(value).strip().upper()
        for column in columns
        for value in data[column].dropna()
        if str(value).strip().upper() not in NONVALUES
    }


def score(labels: pd.Series, probabilities) -> dict[str, object]:
    predicted = (probabilities >= 0.5).astype(int)
    matrix = confusion_matrix(labels, predicted, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    return {
        "threshold": 0.5,
        "accuracy": float(accuracy_score(labels, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "average_precision": float(average_precision_score(labels, probabilities)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": matrix.tolist(),
        "true_negatives": tn, "false_positives": fp,
        "false_negatives": fn, "true_positives": tp,
    }


def main() -> dict[str, object]:
    if not TRAIN_FILE.exists() or not HOLDOUT_FILE.exists():
        raise FileNotFoundError(
            "Expected the branch training and independent-holdout CSVs. "
            "Generate them with generate_attachment_style_pairs.py before training."
        )
    generated_train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    holdout = pd.read_csv(HOLDOUT_FILE, float_precision="round_trip")
    required = {*FEATURE_COLUMNS, "label", "group_id"}
    for name, data in (("training", generated_train), ("holdout", holdout)):
        missing = sorted(required - set(data.columns))
        if missing:
            raise ValueError(f"{name} CSV is missing required columns: {', '.join(missing)}")
        if data[list(required)].isnull().any().any():
            raise ValueError(f"{name} CSV has missing features, labels, or group IDs")
        if not set(data.label.unique()).issubset({0, 1}) or data.label.nunique() != 2:
            raise ValueError(f"{name} CSV must contain both binary labels")
        if (data.groupby("group_id").label.nunique() != 1).any():
            raise ValueError(f"Each {name} group_id must have one label")
    raw_columns = {
        "name_1", "name_2", "dob_1", "dob_2", "guardian_1", "guardian_2",
        "upi_1", "upi_2", "birth_certificate_1", "birth_certificate_2",
    }
    for name, data in (("training", generated_train), ("holdout", holdout)):
        missing_raw = sorted(raw_columns - set(data.columns))
        if missing_raw:
            raise ValueError(f"{name} CSV needs raw fields to verify disjointness: {', '.join(missing_raw)}")
    for left, right in (
        (observed_values(generated_train, ("name_1", "name_2")), observed_values(holdout, ("name_1", "name_2"))),
        (observed_values(generated_train, ("dob_1", "dob_2")), observed_values(holdout, ("dob_1", "dob_2"))),
        (observed_values(generated_train, ("guardian_1", "guardian_2")), observed_values(holdout, ("guardian_1", "guardian_2"))),
        (observed_values(generated_train, ("upi_1", "upi_2")), observed_values(holdout, ("upi_1", "upi_2"))),
        (observed_values(generated_train, ("birth_certificate_1", "birth_certificate_2")), observed_values(holdout, ("birth_certificate_1", "birth_certificate_2"))),
    ):
        if left & right:
            raise RuntimeError("Training and independent holdout share raw values")
    holdout_hash = hashlib.sha256(HOLDOUT_FILE.read_bytes()).hexdigest()
    train_hash = hashlib.sha256(TRAIN_FILE.read_bytes()).hexdigest()

    groups = generated_train[["group_id", "label"]].drop_duplicates("group_id")
    train_groups, test_groups = train_test_split(
        groups.group_id, test_size=0.5, random_state=SPLIT_SEED,
        stratify=groups.label,
    )
    train = generated_train[generated_train.group_id.isin(train_groups)].copy()
    internal = generated_train[generated_train.group_id.isin(test_groups)].copy()
    if set(train.group_id) & set(internal.group_id):
        raise RuntimeError("Pair group leakage in train/internal-test split")
    internal.to_csv(INTERNAL_FILE, index=False)

    # Cross-validation is confined to the training half and keeps related pairs together.
    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SPLIT_SEED)
    cv_scores = []
    for fold_train, fold_valid in cv.split(train[FEATURE_COLUMNS], train.label, groups=train.group_id):
        fold_model = RandomForestClassifier(
            n_estimators=160, max_depth=6, min_samples_leaf=4,
            class_weight="balanced", random_state=SPLIT_SEED, n_jobs=-1,
        )
        fold_model.fit(train.iloc[fold_train][FEATURE_COLUMNS], train.iloc[fold_train].label)
        fold_probs = fold_model.predict_proba(train.iloc[fold_valid][FEATURE_COLUMNS])[:, 1]
        cv_scores.append(float(f1_score(train.iloc[fold_valid].label, fold_probs >= 0.5, zero_division=0)))

    model = RandomForestClassifier(
        n_estimators=160, max_depth=6, min_samples_leaf=4,
        class_weight="balanced", random_state=SPLIT_SEED, n_jobs=-1,
    )
    model.fit(train[FEATURE_COLUMNS], train.label)
    internal_metrics = score(internal.label, model.predict_proba(internal[FEATURE_COLUMNS])[:, 1])
    holdout_metrics = score(holdout.label, model.predict_proba(holdout[FEATURE_COLUMNS])[:, 1])
    if hashlib.sha256(HOLDOUT_FILE.read_bytes()).hexdigest() != holdout_hash:
        raise RuntimeError("Independent holdout changed during evaluation")

    CANDIDATE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, CANDIDATE)

    result = {
        "model_promoted": False,
        "candidate_model_file": str(CANDIDATE.relative_to(BASE)),
        "candidate_model_sha256": hashlib.sha256(CANDIDATE.read_bytes()).hexdigest(),
        "generator": "attachment-style noisy scenarios; labels map to shared latent identity and features are recomputed from cleaned record fields",
        "independent_holdout_domains": "disjoint name pools, birth-date ranges, guardian IDs, UPIs, and birth-certificate numbers; same five school categories retained",
        "raw_value_columns_used_as_model_features": False,
        "pair_count_per_dataset": COUNT,
        "positive_rate_assumption": POSITIVE_RATE,
        "training_positive_fraction": float(generated_train.label.mean()),
        "holdout_positive_fraction": float(holdout.label.mean()),
        "label_counts": {str(k): int(v) for k, v in generated_train.label.value_counts().sort_index().items()},
        "training_file": str(TRAIN_FILE.relative_to(BASE)),
        "training_file_sha256": train_hash,
        "train_rows": len(train), "internal_test_rows": len(internal),
        "split": "50/50 stratified by group_id; related pairs kept together",
        "cv": "5-fold StratifiedGroupKFold on training half only",
        "cv_f1_by_fold": cv_scores,
        "internal_test_metrics": internal_metrics,
        "independent_holdout_file": str(HOLDOUT_FILE.relative_to(BASE)),
        "independent_holdout_sha256": holdout_hash,
        "independent_holdout_label_counts": {str(k): int(v) for k, v in holdout.label.value_counts().sort_index().items()},
        "independent_holdout_used_for_training_or_tuning": False,
        "independent_holdout_metrics": holdout_metrics,
        "user_supplied_evaluation_dataset_used_for_training": False,
        "scikit_learn_version": sklearn.__version__,
        "limitations": [
            "The 50% positive rate is a balanced synthetic simulation from the attachment, not measured real-world prevalence.",
            "Synthetic performance cannot establish real-world duplicate-detection performance.",
        ],
    }
    REPORT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
