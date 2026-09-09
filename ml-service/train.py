import joblib
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split

INPUT_FILE = "data/features.csv"
MODEL_FILE = "model/rf_duplicate_model.joblib"
FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
]


def train_model():
    df = pd.read_csv(INPUT_FILE)
    X = df[FEATURE_COLUMNS]
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )

    print("Training data:", X_train.shape)
    print("Testing data:", X_test.shape)

    rf = RandomForestClassifier(
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )

    param_grid = {
        "n_estimators": [100, 150],
        "max_depth": [4, 6, 8],
        "min_samples_leaf": [2, 5],
        "max_features": ["sqrt"],
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    grid_search = GridSearchCV(
        estimator=rf,
        param_grid=param_grid,
        cv=cv,
        scoring="f1",
        n_jobs=-1,
        verbose=1,
    )

    print("\nStarting hyperparameter tuning...")
    grid_search.fit(X_train, y_train)
    best_model = grid_search.best_estimator_

    print("\nBest parameters:")
    print(grid_search.best_params_)
    print("\nBest cross-validation F1:")
    print(grid_search.best_score_)

    train_f1 = f1_score(y_train, grid_search.best_estimator_.predict(X_train))
    cv_f1 = grid_search.best_score_
    print("\nTrain F1:")
    print(train_f1)
    print("Train/CV F1 gap:")
    print(train_f1 - cv_f1)

    predictions = best_model.predict(X_test)
    probabilities = best_model.predict_proba(X_test)[:, 1]

    print("\nClassification Report:")
    print(classification_report(y_test, predictions))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, predictions))
    print("\nAUC-ROC:")
    print(roc_auc_score(y_test, probabilities))

    joblib.dump(best_model, MODEL_FILE)
    print("\nModel saved successfully:")
    print(MODEL_FILE)


if __name__ == "__main__":
    train_model()
