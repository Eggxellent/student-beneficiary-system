"""Compare Jaro-Winkler and Levenshtein name features."""

from __future__ import annotations

import re
from pathlib import Path

import jellyfish
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import train_test_split

DATA_FILE = Path(__file__).parent / "data" / "features.csv"
BASE_FEATURES = [
    "dob_match",
    "school_match",
    "guardian_match",
    "upi_match",
    "birth_certificate_match",
]


def clean_name(value):
    return re.sub(r"[^a-z]", "", str(value).lower())


def levenshtein_similarity(first, second):
    left = clean_name(first)
    right = clean_name(second)
    longest = max(len(left), len(right))
    if not longest:
        return 1.0
    return 1 - (jellyfish.levenshtein_distance(left, right) / longest)


def evaluate(dataset, name_column):
    features = dataset[[name_column, *BASE_FEATURES]]
    labels = dataset["label"]
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
    dataset["levenshtein"] = [
        levenshtein_similarity(first, second)
        for first, second in zip(dataset["name_1"], dataset["name_2"])
    ]
    print("Name similarity comparison")
    print("Jaro-Winkler:", evaluate(dataset, "jaro_winkler"))
    print("Levenshtein:", evaluate(dataset, "levenshtein"))


if __name__ == "__main__":
    main()
