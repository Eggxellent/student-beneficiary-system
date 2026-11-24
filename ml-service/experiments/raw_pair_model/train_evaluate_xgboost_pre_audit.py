"""Historical pre-audit run retained for comparison; not the default workflow."""

from __future__ import annotations

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
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from train_evaluate_raw_pairs import DATA, FEATURES, OUT, SEED, THRESHOLD, audit_overlaps, file_hash


def main() -> dict[str, object]:
    data = pd.read_csv(DATA, keep_default_na=True, float_precision="round_trip")
    if data[FEATURES + ["label", "group_id"]].isna().any().any():
        raise ValueError("Features, labels, and group IDs must not be missing")
    if set(data.label.unique()) != {0, 1}:
        raise ValueError("Expected binary labels encoded as 0 and 1")
    if data.groupby("group_id").label.nunique().gt(1).any():
        raise ValueError("A group_id maps to multiple target labels")

    # Match the Random Forest experiment exactly: same first grouped fold,
    # seed, features, threshold, and no hyperparameter/threshold tuning.
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    train_idx, test_idx = next(splitter.split(data[FEATURES], data.label, data.group_id))
    train, test = data.iloc[train_idx], data.iloc[test_idx]
    y_train, y_test = train.label.astype(int), test.label.astype(int)

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
    probabilities = pipeline.predict_proba(test[FEATURES])[:, 1]
    predictions = (probabilities >= THRESHOLD).astype(int)
    evaluation_seconds = time.perf_counter() - started
    matrix = confusion_matrix(y_test, predictions, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    overlap = audit_overlaps(data, train_idx, test_idx)

    model_path = OUT / "raw_pair_xgboost.joblib"
    report_path = OUT / "raw_pair_xgboost_metrics.json"
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, model_path)
    report: dict[str, object] = {
        "experiment": "fresh XGBoost model trained only on raw_pairs.csv training partition",
        "dataset_sha256": file_hash(DATA),
        "rows": int(len(data)),
        "target": "label (0=non-duplicate, 1=duplicate)",
        "class_counts": {str(k): int(v) for k, v in data.label.value_counts().sort_index().items()},
        "split": {
            "method": "same first fold of StratifiedGroupKFold(n_splits=5, shuffle=True) as Random Forest run",
            "seed": SEED,
            "ratio": "approximately 80/20",
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_groups": int(train.group_id.nunique()),
            "test_groups": int(test.group_id.nunique()),
            "train_class_counts": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
            "test_class_counts": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
            **overlap,
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
            "preprocessing": "median SimpleImputer in train-fitted pipeline; feature columns are complete",
            "features": FEATURES,
            "threshold": THRESHOLD,
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
        "timing_seconds": {"training": training_seconds, "test_evaluation": evaluation_seconds},
        "validity_notes": [
            "Fresh estimator; no existing model weights were loaded.",
            "Same test rows, features, and fixed 0.5 threshold as the Random Forest comparison; test set was not used for tuning.",
            "No group IDs or target column were model inputs; exact group, pair, and record overlap checks are recorded in the split section.",
            "Data is synthetic and has no canonical student IDs; results do not establish real-world accuracy or definitively prove unseen-student generalization.",
        ],
        "versions": {"xgboost": xgboost.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
        "artifacts": {"model": model_path.name, "model_sha256": file_hash(model_path), "report": report_path.name},
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
