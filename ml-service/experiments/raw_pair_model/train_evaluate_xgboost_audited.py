"""Audit and train a fresh, training-CV-selected XGBoost model on raw_pairs.csv."""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
import xgboost
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, StratifiedGroupKFold
from xgboost import XGBClassifier

from train_evaluate_raw_pairs import DATA, FEATURES, OUT, audit_overlaps, file_hash

SEED = 20261021
SEARCH_SPLITS = 5
SEARCH_ITERATIONS = 24
THRESHOLD_TIE_REFERENCE = 0.5


def _distribution() -> dict[str, list[object]]:
    """Transparent search range: shallow/moderate trees and regularization."""
    return {
        "n_estimators": [100, 200, 350, 500],
        "max_depth": [2, 3, 4, 5, 6],
        "learning_rate": [0.01, 0.03, 0.05, 0.1],
        "min_child_weight": [1, 3, 5, 10],
        "subsample": [0.7, 0.85, 1.0],
        "colsample_bytree": [0.7, 0.85, 1.0],
        "gamma": [0.0, 0.1, 0.5, 1.0],
        "reg_lambda": [0.1, 1.0, 5.0, 10.0],
    }


def _json_safe_parameters(model: XGBClassifier) -> dict[str, object]:
    parameters = model.get_params(deep=False)
    return {
        key: (None if isinstance(value, (float, np.floating)) and not math.isfinite(float(value)) else value)
        for key, value in parameters.items()
    }


def _metrics(y_true: pd.Series, probabilities: np.ndarray, threshold: float) -> dict[str, object]:
    predictions = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(y_true, predictions, labels=[0, 1])
    tn, fp, fn, tp = map(int, matrix.ravel())
    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy_score(y_true, predictions)),
        "precision": float(precision_score(y_true, predictions, zero_division=0)),
        "recall": float(recall_score(y_true, predictions, zero_division=0)),
        "f1": float(f1_score(y_true, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, probabilities)),
        "pr_auc_average_precision": float(average_precision_score(y_true, probabilities)),
        "confusion_matrix_rows_actual_0_1_columns_predicted_0_1": matrix.tolist(),
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
    }


def _select_f1_threshold(y_true: pd.Series, probabilities: np.ndarray) -> dict[str, float]:
    precision, recall, thresholds = precision_recall_curve(y_true, probabilities)
    if not len(thresholds):
        raise ValueError("Could not derive a threshold from out-of-fold training probabilities")
    denominator = precision[:-1] + recall[:-1]
    f1_values = np.divide(
        2 * precision[:-1] * recall[:-1], denominator,
        out=np.zeros_like(denominator), where=denominator > 0,
    )
    best_f1 = float(f1_values.max())
    tied = np.flatnonzero(np.isclose(f1_values, best_f1, rtol=0, atol=1e-12))
    # A deterministic, documented tie-break keeps the selected value closest
    # to the conventional equal-cost probability threshold.
    best_index = min(tied, key=lambda i: abs(float(thresholds[i]) - THRESHOLD_TIE_REFERENCE))
    return {
        "threshold": float(thresholds[best_index]),
        "oof_f1": best_f1,
        "oof_precision": float(precision[best_index]),
        "oof_recall": float(recall[best_index]),
    }


def main() -> dict[str, object]:
    data = pd.read_csv(DATA, keep_default_na=True, float_precision="round_trip")
    required = {
        "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
        "guardian_1", "guardian_2", "upi_1", "upi_2", "group_id", "label", *FEATURES,
    }
    missing_columns = sorted(required - set(data.columns))
    if missing_columns:
        raise ValueError(f"raw_pairs.csv is missing required columns: {missing_columns}")
    if data["label"].isna().any() or set(data["label"].unique()) != {0, 1}:
        raise ValueError("Expected nonmissing binary labels encoded as 0 and 1")
    if data["group_id"].isna().any() or data.groupby("group_id")["label"].nunique().gt(1).any():
        raise ValueError("Every pair group must have one nonmissing target label")
    feature_matrix = data[FEATURES].apply(pd.to_numeric, errors="raise")
    if feature_matrix.isna().any().any() or not np.isfinite(feature_matrix.to_numpy(dtype=float)).all():
        raise ValueError("Comparison features must be complete and finite")
    if not feature_matrix.apply(lambda column: column.between(0, 1).all()).all():
        raise ValueError("Comparison features must be in [0, 1]")
    data[FEATURES] = feature_matrix
    data["label"] = data.label.astype(int)

    # Keep the pre-existing group split for a paired comparison with the old
    # raw-XGB and raw-RF runs. The test fold has been reported previously, so
    # that repeated exposure is explicitly disclosed in the final audit.
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    train_idx, test_idx = next(outer.split(data[FEATURES], data.label, data.group_id))
    train, test = data.iloc[train_idx].copy(), data.iloc[test_idx].copy()
    x_train, y_train = train[FEATURES], train.label
    x_test, y_test = test[FEATURES], test.label

    # No imputer/scaler is needed: all six precomputed numeric features are
    # validated complete, and the existing RF fit used the same feature matrix.
    base_model = XGBClassifier(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        booster="gbtree",
        scale_pos_weight=1,
        random_state=SEED,
        n_jobs=1,
        verbosity=0,
    )
    search_cv = StratifiedGroupKFold(n_splits=SEARCH_SPLITS, shuffle=True, random_state=SEED + 1)
    search = RandomizedSearchCV(
        estimator=base_model,
        param_distributions=_distribution(),
        n_iter=SEARCH_ITERATIONS,
        scoring="average_precision",
        cv=search_cv,
        refit=True,
        n_jobs=1,
        random_state=SEED,
        return_train_score=True,
        error_score="raise",
    )
    search_started = time.perf_counter()
    search.fit(x_train, y_train, groups=train.group_id)
    search_seconds = time.perf_counter() - search_started
    best_model = search.best_estimator_  # refit by CV search on training partition only

    # Choose the classification cutoff from OOF predictions within training
    # groups. F1 balances precision and recall; there is no adjudicated cost
    # matrix to justify weighting one error type more than the other.
    threshold_cv = StratifiedGroupKFold(n_splits=SEARCH_SPLITS, shuffle=True, random_state=SEED + 2)
    oof_probabilities = np.empty(len(train), dtype=float)
    threshold_started = time.perf_counter()
    for fold_train, fold_valid in threshold_cv.split(x_train, y_train, train.group_id):
        fold_model = clone(best_model)
        fold_model.fit(x_train.iloc[fold_train], y_train.iloc[fold_train])
        oof_probabilities[fold_valid] = fold_model.predict_proba(x_train.iloc[fold_valid])[:, 1]
    threshold_selection = _select_f1_threshold(y_train, oof_probabilities)
    threshold_seconds = time.perf_counter() - threshold_started

    # Lock the threshold and parameters before accessing the final test labels.
    eval_started = time.perf_counter()
    test_probabilities = best_model.predict_proba(x_test)[:, 1]
    final_metrics = _metrics(y_test, test_probabilities, threshold_selection["threshold"])
    evaluation_seconds = time.perf_counter() - eval_started
    overlap = audit_overlaps(data, train_idx, test_idx)

    old_xgb = json.loads((OUT / "raw_pair_xgboost_metrics.json").read_text(encoding="utf-8"))
    old_rf = json.loads((OUT / "raw_pair_experiment_metrics.json").read_text(encoding="utf-8"))
    production_config = json.loads((OUT / "production_rf_config_snapshot.json").read_text(encoding="utf-8"))
    if old_xgb.get("dataset_sha256") != file_hash(DATA):
        raise ValueError("Pre-audit XGBoost baseline is not for this exact raw CSV")
    if old_xgb["split"]["test_rows"] != len(test):
        raise ValueError("Pre-audit XGBoost baseline does not use the same test fold")

    # Training-only check for exact feature-vector collisions with both labels.
    mixed_train_vectors = int(
        train.groupby(FEATURES, dropna=False).label.nunique().gt(1).sum()
    )
    total_train_vectors = int(train[FEATURES].drop_duplicates().shape[0])

    model_path = OUT / "raw_pair_xgboost_audited.joblib"
    report_path = OUT / "raw_pair_xgboost_audited_metrics.json"
    search_path = OUT / "raw_pair_xgboost_search_cv.csv"
    manifest_path = OUT / "raw_pair_xgboost_audited_split.csv"
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(best_model, model_path)
    cv_results = pd.DataFrame(search.cv_results_).sort_values("rank_test_score")
    keep = [
        "rank_test_score", "mean_test_score", "std_test_score", "mean_train_score",
        "params",
    ]
    cv_results[keep].to_csv(search_path, index=False)
    manifest = pd.DataFrame({"row_index": data.index, "group_id": data.group_id.astype(str)})
    manifest["split"] = "train"
    manifest.loc[test_idx, "split"] = "test"
    manifest.to_csv(manifest_path, index=False)

    old_xgb_metrics = old_xgb["metrics"]
    old_rf_metrics = old_rf["metrics"]
    report: dict[str, object] = {
        "experiment": "audited raw-pair XGBoost; parameters and threshold selected without test data",
        "dataset": {
            "sha256": file_hash(DATA),
            "rows": int(len(data)),
            "labels": {str(k): int(v) for k, v in data.label.value_counts().sort_index().items()},
            "test_previously_reported": True,
            "test_previous_exposure_note": "This group-held-out fold was scored in the earlier raw RF and fixed-parameter XGBoost experiments. It was not used in this run's CV or selection; repeated reporting limits its status as a pristine once-only final test.",
            "duplicate_rows_retained": int(data.duplicated().sum()),
            "feature_missing_counts": {key: int(data[key].isna().sum()) for key in FEATURES},
            "feature_vectors_in_training": total_train_vectors,
            "training_feature_vectors_with_both_labels": mixed_train_vectors,
        },
        "split": {
            "method": "first fold of StratifiedGroupKFold(n_splits=5, shuffle=True)",
            "seed": SEED,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_groups": int(train.group_id.nunique()),
            "test_groups": int(test.group_id.nunique()),
            "train_labels": {str(k): int(v) for k, v in y_train.value_counts().sort_index().items()},
            "test_labels": {str(k): int(v) for k, v in y_test.value_counts().sort_index().items()},
            **overlap,
            "identity_limit": "group_id keeps each synthetic pair group together; raw CSV has no canonical student IDs, so unseen-student generalization cannot be fully proven",
        },
        "existing_production_model_configuration": production_config,
        "pre_audit_raw_xgboost": {
            "hyperparameters": old_xgb["model"]["parameters"],
            "preprocessing": old_xgb["model"]["preprocessing"],
            "features": old_xgb["model"]["features"],
            "threshold": old_xgb["model"]["threshold"],
            "metrics_same_test": old_xgb_metrics,
        },
        "pre_audit_raw_random_forest": {
            "parameters": old_rf["model"]["parameters"],
            "threshold": old_rf["model"]["threshold"],
            "metrics_same_test": old_rf_metrics,
        },
        "audited_xgboost": {
            "algorithm": "XGBClassifier",
            "selected_parameters": search.best_params_,
            "effective_parameters": _json_safe_parameters(best_model),
            "feature_columns": FEATURES,
            "preprocessing": "None; features were validated complete, numeric, and in [0,1]",
            "class_weighting_or_resampling": "None; dataset is exactly balanced 50/50",
            "threshold": threshold_selection["threshold"],
            "threshold_selection": {
                "method": "maximize F1 on 5-fold group-stratified out-of-fold training probabilities",
                "cv_split_seed": SEED + 2,
                "tie_break": "closest to 0.5",
                **threshold_selection,
            },
            "hyperparameter_selection": {
                "method": "RandomizedSearchCV on training partition only",
                "cv": "5-fold StratifiedGroupKFold",
                "cv_seed": SEED + 1,
                "scoring": "average_precision",
                "scoring_rationale": "Ranks duplicate candidates across cutoffs; threshold selection is handled separately using training-only out-of-fold F1.",
                "candidate_draws": SEARCH_ITERATIONS,
                "candidate_ranges": _distribution(),
                "range_rationale": "The search covers shallow-to-moderate tree depths, multiple boosting budgets/rates, and explicit row/feature sampling and regularization levels. Results are conditional on this finite search space.",
                "best_mean_cv_average_precision": float(search.best_score_),
                "best_n_estimators_at_search_upper_bound": search.best_params_["n_estimators"] == max(_distribution()["n_estimators"]),
            },
        },
        "final_test_metrics": final_metrics,
        "same_test_comparison": {
            "pre_audit_fixed_xgb": old_xgb_metrics,
            "audited_cv_selected_xgb": final_metrics,
            "pre_audit_rf": old_rf_metrics,
            "test_fold_note": "All three raw-pair runs use the same group-held-out rows; only the audited XGB's parameter/threshold selection was changed to training-only CV.",
        },
        "audit_findings": [
            "The previous raw XGBoost used manually specified parameters and a fixed 0.50 threshold; it did not tune on test data, but those choices lacked documented selection rationale.",
            "The previous and audited XGBoost use the same six comparison features as the current RF. group_id and label are excluded from model inputs.",
            "The prior SimpleImputer was a no-op because all comparison features are complete; removed from the audited XGBoost path. The production RF also fits directly on the features.",
            "Missing raw values are handled upstream by the established feature builder as zero similarity/match; the raw CSV stores complete numeric features but does not encode missingness separately.",
            "Both raw experiment models used no class weights or resampling; this is appropriate for the dataset's balanced classes, though it does not represent operational prevalence.",
            "No existing estimator or prediction was used for fitting or labels. The production RF artifact was inspected only to verify its effective configuration; historical metrics are read for audit comparison.",
            "The raw data generator creates labels from latent identity. Its positive repeat-application and difficult-negative scenarios are useful ground truth construction but remain simulator-specific; scenario is not a feature in raw_pairs.csv.",
            "raw_pairs.csv has precomputed features. It lacks the original birth-certificate values, so birth_certificate_match cannot be independently recomputed from this file.",
        ],
        "timing_seconds": {
            "hyperparameter_search_and_refit": search_seconds,
            "threshold_oof_generation_and_selection": threshold_seconds,
            "final_test_evaluation": evaluation_seconds,
        },
        "limitations": [
            "The dataset is synthetic and balanced; results do not establish real-world accuracy or operational precision.",
            "There are no canonical student IDs in raw_pairs.csv; grouping by group_id and checking exact record/pair signatures prevents detectable overlap but cannot prove all person identities are disjoint.",
            "The final test fold was previously scored in earlier experiments, so although it was excluded from this run's tuning, it is not a pristine first-use holdout.",
            "F1 treats precision and recall symmetrically. A production threshold should be chosen from adjudicated operational costs and prevalence when available.",
        ],
        "artifacts": {
            "model": "raw_pair_xgboost_audited.joblib",
            "model_sha256": file_hash(model_path),
            "report": report_path.name,
            "cv_search_results": search_path.name,
            "split_manifest": manifest_path.name,
            "production_configuration_snapshot": "production_rf_config_snapshot.json",
            "pre_audit_fixed_runner": "train_evaluate_xgboost_pre_audit.py",
        },
        "versions": {"xgboost": xgboost.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()
