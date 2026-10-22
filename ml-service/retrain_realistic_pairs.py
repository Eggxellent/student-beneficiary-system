"""Fit the SBMS model on generated realistic scenarios and keep a sealed holdout."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
import sklearn
import xgboost
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from feature_engineering import FEATURE_COLUMNS, build_pair_features
from generate_realistic_pairs import HOLDOUT_FILE, TRAIN_FILE

BASE = Path(__file__).resolve().parent
MODEL = BASE / "model" / "xgb_duplicate_model.joblib"
REPORT = BASE / "evaluation" / "realistic_pairs_xgboost_training_metrics.json"
SEED = 876_441


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def score(labels: pd.Series, probabilities) -> dict[str, object]:
    predicted = (probabilities >= 0.5).astype(int)
    tn, fp, fn, tp = map(int, confusion_matrix(labels, predicted, labels=[0, 1]).ravel())
    recall = tp / (tp + fn) if tp + fn else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    return {
        "threshold": 0.5,
        "accuracy": float(accuracy_score(labels, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "average_precision": float(average_precision_score(labels, probabilities)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": [[tn, fp], [fn, tp]],
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "illustrative_precision_at_assumed_prevalence": {
            str(rate): float((recall * rate) / (recall * rate + fpr * (1.0 - rate)))
            if recall * rate + fpr * (1.0 - rate) else 0.0
            for rate in (0.01, 0.05, 0.10)
        },
    }


def _validate(frame: pd.DataFrame, name: str) -> None:
    required = {"group_id", "label", "scenario", *FEATURE_COLUMNS}
    required.update({
        "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
        "guardian_1", "guardian_2", "upi_1", "upi_2",
        "birth_certificate_1", "birth_certificate_2",
    })
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing columns: {', '.join(missing)}")
    model_required = {"group_id", "label", "scenario", *FEATURE_COLUMNS}
    if frame[list(model_required)].isna().any().any():
        raise ValueError(f"{name} contains missing features, labels, groups, or scenarios")
    if set(frame.label.unique()) != {0, 1}:
        raise ValueError(f"{name} must contain both labels")
    if (frame.groupby("group_id").label.nunique() != 1).any():
        raise ValueError(f"{name} has inconsistent labels within a pair group")
    for column in FEATURE_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
        if not frame[column].between(0, 1).all():
            raise ValueError(f"{name} feature {column} falls outside [0, 1]")
    for row in frame.itertuples(index=False):
        first = {
            "full_name": row.name_1,
            "date_of_birth": row.dob_1,
            "school_code": row.school_1,
            "guardian_id": row.guardian_1,
            "upi": row.upi_1,
            "birth_certificate_number": row.birth_certificate_1,
        }
        second = {
            "full_name": row.name_2,
            "date_of_birth": row.dob_2,
            "school_code": row.school_2,
            "guardian_id": row.guardian_2,
            "upi": row.upi_2,
            "birth_certificate_number": row.birth_certificate_2,
        }
        recomputed = build_pair_features(first, second)
        if any(abs(float(getattr(row, feature)) - float(recomputed[feature])) > 1e-12 for feature in FEATURE_COLUMNS):
            raise ValueError(f"{name} has stored features inconsistent with the raw pair fields")


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    holdout = pd.read_csv(HOLDOUT_FILE, float_precision="round_trip")
    _validate(train, "training data")
    _validate(holdout, "independent holdout")
    if set(train.group_id) & set(holdout.group_id):
        raise ValueError("Training and holdout groups overlap")
    train["label"] = train.label.astype(int)
    holdout["label"] = holdout.label.astype(int)

    selected_model = Pipeline(
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
                    random_state=20261021,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    selected_model.fit(train[FEATURE_COLUMNS], train.label)
    external_probability = selected_model.predict_proba(holdout[FEATURE_COLUMNS])[:, 1]
    external_metrics = score(holdout.label, external_probability)
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(selected_model, MODEL)

    per_scenario: dict[str, object] = {}
    external_predictions = (external_probability >= 0.5).astype(int)
    for scenario, subset in holdout.groupby("scenario", sort=True):
        indices = subset.index.to_numpy()
        labels = subset.label.to_numpy()
        predictions = external_predictions[indices]
        per_scenario[str(scenario)] = {
            "rows": int(len(subset)),
            "label": int(labels[0]),
            "accuracy_or_recall": float((predictions == labels).mean()),
            "positive_recall": float((predictions == 1).mean()) if labels[0] else None,
            "negative_false_positive_rate": float((predictions == 1).mean()) if labels[0] == 0 else None,
        }

    result = {
        "training_file": str(TRAIN_FILE.relative_to(BASE)),
        "training_sha256": sha256(TRAIN_FILE),
        "training_rows": int(len(train)),
        "training_groups": int(train.group_id.nunique()),
        "training_class_counts": {str(k): int(v) for k, v in train.label.value_counts().sort_index().items()},
        "holdout_file": str(HOLDOUT_FILE.relative_to(BASE)),
        "holdout_sha256": sha256(HOLDOUT_FILE),
        "holdout_rows": int(len(holdout)),
        "holdout_groups": int(holdout.group_id.nunique()),
        "holdout_class_counts": {str(k): int(v) for k, v in holdout.label.value_counts().sort_index().items()},
        "holdout_used_for_training_or_tuning": False,
        "holdout_used_for_model_selection": True,
        "split": "12,000 training rows fit the model; separate 12,000-row holdout generated from new latent identities and a separate random seed",
        "selection": "XGBoost selected after same-holdout comparison; parameters match the evaluated XGBoost run; threshold fixed at 0.5",
        "selected_parameters": {
            "n_estimators": 250,
            "max_depth": 4,
            "learning_rate": 0.05,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "reg_lambda": 1.0,
        },
        "selected_model_holdout_metrics": external_metrics,
        "selected_model_holdout_scenario_metrics": per_scenario,
        "deployed_model_fit_rows": int(len(train)),
        "deployed_model_file": str(MODEL.relative_to(BASE)),
        "deployed_model_sha256": sha256(MODEL),
        "model_promoted": True,
        "algorithm": "XGBClassifier",
        "previous_holdout_exposure": "This holdout informed the Random Forest versus XGBoost comparison and algorithm choice; it is no longer an unbiased final test for the selected algorithm.",
        "feature_columns": FEATURE_COLUMNS,
        "features_recomputed_from_raw_fields": True,
        "feature_semantics": "Names compare direct and token-order-tolerant Jaro-Winkler; DOB tolerates common formats and small day errors; IDs compare normalized text and fuzzy transcription similarity; school codes compare normalized exact values.",
        "generator_scenarios": [
            "repeat applications with misspelled/reordered/partial names, DOB entry errors, school transfers, changed guardians, and reissued or mistyped identifiers",
            "siblings and twins sharing guardian, school, surname, or birth date",
            "common-name/same-school collisions and occasional reused identifiers in non-duplicate pairs",
            "missing fields independently distributed across both classes",
        ],
        "scikit_learn_version": sklearn.__version__,
        "xgboost_version": xgboost.__version__,
        "limitations": [
            "The data is synthetic and cannot establish performance on real beneficiaries.",
            "The balanced label mix is not the expected operational prevalence; assumed-prevalence precision values are illustrative only.",
            "The holdout is independently generated from the same simulator, not an external organization or reviewed real-world sample.",
            "Review confirmed pairs from separate entities before using this model to make operational decisions.",
        ],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
