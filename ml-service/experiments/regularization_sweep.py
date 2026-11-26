"""Compare regularized models on validation only; this script never reads test data."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, brier_score_loss, confusion_matrix, f1_score,
    precision_score, recall_score, roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from feature_engineering import FEATURE_COLUMNS  # noqa: E402
from generate_realistic_pairs import TRAIN_FILE, VALIDATION_FILE  # noqa: E402

REPORT_FILE = BASE / "experiments" / "results" / "model_comparison_validation_20261125.json"
MAX_FPR = 0.05
SEED = 20261126


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def choose_threshold(labels, probabilities) -> dict[str, float | bool]:
    choices = []
    for threshold in (step / 100 for step in range(20, 81)):
        predicted = probabilities >= threshold
        tn, fp, _, _ = confusion_matrix(labels, predicted, labels=[0, 1]).ravel()
        fpr = float(fp / (tn + fp)) if tn + fp else 0.0
        f1 = float(f1_score(labels, predicted, zero_division=0))
        if fpr <= MAX_FPR:
            choices.append((f1, threshold, fpr))
    if not choices:
        return {"threshold": 0.8, "f1": float(f1_score(labels, probabilities >= 0.8)), "fpr": 0.0, "guardrail_satisfied": False}
    f1, threshold, fpr = max(choices, key=lambda item: (item[0], item[1]))
    return {"threshold": threshold, "f1": f1, "fpr": fpr, "guardrail_satisfied": True}


def candidates():
    return {
        "xgb_depth2": make_pipeline(SimpleImputer(strategy="median"), XGBClassifier(
            n_estimators=180, max_depth=2, learning_rate=0.04, min_child_weight=25,
            subsample=0.65, colsample_bytree=0.65, reg_alpha=1.5, reg_lambda=8,
            objective="binary:logistic", eval_metric="logloss", tree_method="hist", random_state=SEED, n_jobs=-1)),
        "xgb_depth3": make_pipeline(SimpleImputer(strategy="median"), XGBClassifier(
            n_estimators=180, max_depth=3, learning_rate=0.04, min_child_weight=20,
            subsample=0.75, colsample_bytree=0.75, reg_alpha=1.5, reg_lambda=8,
            objective="binary:logistic", eval_metric="logloss", tree_method="hist", random_state=SEED, n_jobs=-1)),
        "logistic_regression": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(
            C=0.25, max_iter=2000, class_weight="balanced", random_state=SEED)),
        "random_forest": make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(
            n_estimators=180, max_depth=5, min_samples_leaf=15, max_features=0.8,
            class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)),
        "hist_gradient_boosting": make_pipeline(SimpleImputer(strategy="median"), HistGradientBoostingClassifier(
            max_iter=160, max_leaf_nodes=7, l2_regularization=4.0, min_samples_leaf=25,
            learning_rate=0.05, random_state=SEED)),
    }


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    validation = pd.read_csv(VALIDATION_FILE, float_precision="round_trip")
    x_train, y_train = train[FEATURE_COLUMNS], train.label.astype(int)
    x_valid, y_valid = validation[FEATURE_COLUMNS], validation.label.astype(int)
    results = {}
    for name, estimator in candidates().items():
        estimator.fit(x_train, y_train)
        probabilities = estimator.predict_proba(x_valid)[:, 1]
        selection = choose_threshold(y_valid, probabilities)
        predicted = probabilities >= selection["threshold"]
        results[name] = {
            **selection,
            "accuracy": float(accuracy_score(y_valid, predicted)),
            "precision": float(precision_score(y_valid, predicted, zero_division=0)),
            "recall": float(recall_score(y_valid, predicted, zero_division=0)),
            "roc_auc": float(roc_auc_score(y_valid, probabilities)),
            "brier": float(brier_score_loss(y_valid, probabilities)),
        }

    base_hgb = candidates()["hist_gradient_boosting"]
    calibrated = CalibratedClassifierCV(estimator=base_hgb, method="sigmoid", cv=3)
    calibrated.fit(x_train, y_train)
    calibrated_probabilities = calibrated.predict_proba(x_valid)[:, 1]
    calibrated_selection = choose_threshold(y_valid, calibrated_probabilities)
    calibrated_predicted = calibrated_probabilities >= calibrated_selection["threshold"]
    results["calibrated_hist_gradient_boosting"] = {
        **calibrated_selection,
        "accuracy": float(accuracy_score(y_valid, calibrated_predicted)),
        "precision": float(precision_score(y_valid, calibrated_predicted, zero_division=0)),
        "recall": float(recall_score(y_valid, calibrated_predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_valid, calibrated_probabilities)),
        "brier": float(brier_score_loss(y_valid, calibrated_probabilities)),
        "calibration": "sigmoid; 3-fold CV fitted within training split",
    }
    baseline = DecisionTreeClassifier(max_depth=2, random_state=SEED).fit(x_train, y_train)
    baseline_f1 = float(f1_score(y_valid, baseline.predict(x_valid)))
    selected = max(results, key=lambda name: (results[name]["f1"], results[name]["threshold"]))
    plain_hgb = results["hist_gradient_boosting"]
    calibrated_hgb = results["calibrated_hist_gradient_boosting"]
    calibration_preference_applied = (
        calibrated_hgb["brier"] < plain_hgb["brier"]
        and calibrated_hgb["f1"] >= plain_hgb["f1"] - 0.005
    )
    if calibration_preference_applied:
        selected = "calibrated_hist_gradient_boosting"
    report = {
        "purpose": "Validation-only model and threshold selection; test file is never read by this script.",
        "selection_rule": "Highest validation F1 among thresholds with validation FPR <= 0.05; when sigmoid calibration improves Brier and its F1 is within 0.005, prefer the calibrated estimator; higher threshold breaks ties.",
        "max_validation_fpr": MAX_FPR,
        "selected_candidate": selected,
        "selected_validation_metrics": results[selected],
        "calibration_preference_applied": calibration_preference_applied,
        "validation_candidates": results,
        "candidate_parameters": {
            "xgb_depth2": {"n_estimators": 180, "max_depth": 2, "learning_rate": 0.04, "min_child_weight": 25, "subsample": 0.65, "colsample_bytree": 0.65, "reg_alpha": 1.5, "reg_lambda": 8},
            "xgb_depth3": {"n_estimators": 180, "max_depth": 3, "learning_rate": 0.04, "min_child_weight": 20, "subsample": 0.75, "colsample_bytree": 0.75, "reg_alpha": 1.5, "reg_lambda": 8},
            "logistic_regression": {"C": 0.25, "max_iter": 2000, "class_weight": "balanced"},
            "random_forest": {"n_estimators": 180, "max_depth": 5, "min_samples_leaf": 15, "max_features": 0.8, "class_weight": "balanced_subsample"},
            "hist_gradient_boosting": {"max_iter": 160, "max_leaf_nodes": 7, "l2_regularization": 4.0, "min_samples_leaf": 25, "learning_rate": 0.05},
            "calibrated_hist_gradient_boosting": {"base": "hist_gradient_boosting", "calibration": "sigmoid", "cv": 3},
        },
        "depth2_tree_hardness_gate": {"validation_f1": baseline_f1, "required_below": 0.85, "passed": baseline_f1 < 0.85},
        "training_sha256": sha256(TRAIN_FILE),
        "validation_sha256": sha256(VALIDATION_FILE),
        "feature_columns": FEATURE_COLUMNS,
        "test_data_accessed": False,
    }
    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
