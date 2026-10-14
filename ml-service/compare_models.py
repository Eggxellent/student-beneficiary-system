"""Compare the six-feature Random Forest and XGBoost duplicate models."""

from __future__ import annotations

import time
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

DATA_FILE = Path(__file__).parent / "data" / "features.csv"
MODEL_FILE = Path(__file__).parent / "model" / "rf_duplicate_model.joblib"
FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]


def metrics(model, test_features, test_labels):
    started = time.perf_counter()
    probabilities = model.predict_proba(test_features)[:, 1]
    prediction_time_ms = (time.perf_counter() - started) * 1000
    predictions = (probabilities >= 0.5).astype(int)
    return {
        "accuracy": round(accuracy_score(test_labels, predictions), 4),
        "precision": round(precision_score(test_labels, predictions), 4),
        "recall": round(recall_score(test_labels, predictions), 4),
        "f1": round(f1_score(test_labels, predictions), 4),
        "auc": round(roc_auc_score(test_labels, probabilities), 4),
        "prediction_time_ms": round(prediction_time_ms, 2),
    }


def main():
    dataset = pd.read_csv(DATA_FILE)
    features = dataset[FEATURE_COLUMNS]
    labels = dataset["label"]
    train_features, test_features, train_labels, test_labels = train_test_split(
        features, labels, test_size=0.2, random_state=42, stratify=labels
    )

    random_forest = joblib.load(MODEL_FILE)
    xgboost = XGBClassifier(
        n_estimators=150,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )
    xgboost.fit(train_features, train_labels)

    print("Six-feature duplicate model comparison")
    print("Random Forest:", metrics(random_forest, test_features, test_labels))
    print("XGBoost:", metrics(xgboost, test_features, test_labels))


if __name__ == "__main__":
    main()
