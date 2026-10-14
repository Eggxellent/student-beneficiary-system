"""Measure Random Forest performance after removing one duplicate feature at a time."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import train_test_split

DATA_FILE = Path(__file__).parent / "data" / "features.csv"
FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]


def evaluate(features, labels):
    train_features, test_features, train_labels, test_labels = train_test_split(
        features, labels, test_size=0.2, random_state=42, stratify=labels
    )
    model = RandomForestClassifier(
        n_estimators=150,
        max_depth=6,
        min_samples_leaf=10,
        max_features="sqrt",
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(train_features, train_labels)
    probabilities = model.predict_proba(test_features)[:, 1]
    predictions = (probabilities >= 0.5).astype(int)
    return {
        "f1": round(f1_score(test_labels, predictions), 4),
        "auc": round(roc_auc_score(test_labels, probabilities), 4),
    }


def main():
    dataset = pd.read_csv(DATA_FILE)
    labels = dataset["label"]
    print("Feature ablation study")
    print("All features:", evaluate(dataset[FEATURE_COLUMNS], labels))
    for removed in FEATURE_COLUMNS:
        remaining = [feature for feature in FEATURE_COLUMNS if feature != removed]
        print(f"Without {removed}:", evaluate(dataset[remaining], labels))


if __name__ == "__main__":
    main()
