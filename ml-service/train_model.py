"""Train and persist the duplicate-detection Random Forest model."""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_validate, train_test_split

DATA_PATH = Path(__file__).parent / "data" / "features.csv"
MODEL_PATH = Path(__file__).parent / "model" / "duplicate_detector.joblib"
FEATURE_COLUMNS = ["jaro_winkler", "dob_match", "school_match", "guardian_match"]


def train_model() -> tuple[RandomForestClassifier, float]:
    dataset = pd.read_csv(DATA_PATH)
    features = dataset[FEATURE_COLUMNS]
    labels = dataset["label"]
    train_features, test_features, train_labels, test_labels = train_test_split(
        features,
        labels,
        test_size=0.2,
        random_state=42,
        stratify=labels,
    )

    base_model = RandomForestClassifier(
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )
    search = GridSearchCV(
        base_model,
        param_grid={
            "n_estimators": [100, 150],
            "max_depth": [4, 6, 8],
            "min_samples_leaf": [2, 5],
            "max_features": ["sqrt"],
        },
        scoring="roc_auc",
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
        n_jobs=-1,
        refit=True,
    )
    search.fit(train_features, train_labels)
    model = search.best_estimator_

    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    validation = cross_validate(
        model,
        train_features,
        train_labels,
        cv=folds,
        scoring={"roc_auc": "roc_auc", "accuracy": "accuracy"},
        return_train_score=True,
        n_jobs=-1,
    )
    mean_train_auc = validation["train_roc_auc"].mean()
    mean_validation_auc = validation["test_roc_auc"].mean()
    auc_gap = mean_train_auc - mean_validation_auc

    model.fit(train_features, train_labels)
    probabilities = model.predict_proba(test_features)[:, 1]
    auc = roc_auc_score(test_labels, probabilities)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_columns": FEATURE_COLUMNS}, MODEL_PATH)
    print(classification_report(test_labels, model.predict(test_features), digits=3))
    print(f"Best parameters: {search.best_params_}")
    print(f"ROC AUC: {auc:.3f}")
    print(f"5-fold train ROC AUC: {mean_train_auc:.3f}")
    print(f"5-fold validation ROC AUC: {mean_validation_auc:.3f}")
    print(f"5-fold train/validation AUC gap: {auc_gap:.3f}")
    print(f"Saved model to {MODEL_PATH}")
    return model, auc


if __name__ == "__main__":
    train_model()
