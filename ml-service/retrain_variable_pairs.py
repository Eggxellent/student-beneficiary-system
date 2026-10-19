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
from generate_variable_pairs import generate_pairs

BASE = Path(__file__).resolve().parent
CANDIDATE = BASE / "model" / "research" / "rf_variable_noise_candidate.joblib"
TRAIN_FILE = BASE / "training" / "pairs_variable_noise_train.csv"
INTERNAL_FILE = BASE / "evaluation" / "pairs_variable_noise_internal_test.csv"
HOLDOUT_FILE = BASE / "evaluation" / "pairs_variable_noise_holdout.csv"
REPORT = BASE / "evaluation" / "variable_noise_retraining_metrics.json"
COUNT = 10_000
POSITIVE_RATE = 0.05  # Simulation assumption, not a measured SBMS rate.
SPLIT_SEED = 51_042


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
    for path in (TRAIN_FILE.parent, INTERNAL_FILE.parent):
        path.mkdir(parents=True, exist_ok=True)

    generated_train = generate_pairs(COUNT, POSITIVE_RATE, seed=103_117, profile="train")
    # Holdout uses a separate name vocabulary, DOB period, and numeric ID ranges.
    holdout = generate_pairs(COUNT, POSITIVE_RATE, seed=204_229, profile="holdout")
    for left, right in (
        ((set(generated_train.name_1) | set(generated_train.name_2)),
         (set(holdout.name_1) | set(holdout.name_2))),
        ((set(generated_train.dob_1) | set(generated_train.dob_2)),
         (set(holdout.dob_1) | set(holdout.dob_2))),
        ((set(generated_train.guardian_1) | set(generated_train.guardian_2)),
         (set(holdout.guardian_1) | set(holdout.guardian_2))),
        ((set(generated_train.upi_1) | set(generated_train.upi_2)),
         (set(holdout.upi_1) | set(holdout.upi_2))),
        ((set(generated_train.birth_certificate_1) | set(generated_train.birth_certificate_2)),
         (set(holdout.birth_certificate_1) | set(holdout.birth_certificate_2))),
    ):
        if left & right:
            raise RuntimeError("Training and independent holdout share raw values")
    generated_train.to_csv(TRAIN_FILE, index=False)
    holdout.to_csv(HOLDOUT_FILE, index=False)
    holdout_hash = hashlib.sha256(HOLDOUT_FILE.read_bytes()).hexdigest()

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
        "generator": "labels indicate shared latent identity; each field is independently corrupted or collides probabilistically",
        "independent_holdout_domains": "disjoint names, birth-date ranges, guardian IDs, UPIs, and birth-certificate numbers; same five school categories retained",
        "raw_value_columns_used_as_model_features": False,
        "pair_count_per_dataset": COUNT,
        "positive_rate_assumption": POSITIVE_RATE,
        "label_counts": {str(k): int(v) for k, v in generated_train.label.value_counts().sort_index().items()},
        "training_file": str(TRAIN_FILE.relative_to(BASE)),
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
            "The 5% positive rate is a synthetic simulation assumption, not measured real-world prevalence.",
            "Synthetic performance cannot establish real-world duplicate-detection performance.",
        ],
    }
    REPORT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
