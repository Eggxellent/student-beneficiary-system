"""Fit the SBMS duplicate model on identity scenarios and keep two sealed splits.

Split roles:

* training  - fits the preprocessing (median imputer) and the classifier;
* validation- chooses the operating threshold only;
* holdout   - touched once, at the end, to report generalisation.

All three files are generated from disjoint seeds, so no underlying child leaks
across the split. The report keeps the artifact hash, the schema, the per-category
results and representative errors so the numbers can be reproduced and audited.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
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
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier

from feature_engineering import FEATURE_COLUMNS, build_pair_features
from generate_realistic_pairs import HOLDOUT_FILE, SPLIT_SEED, TRAIN_FILE, TRAIN_SEED, VALIDATION_FILE

BASE = Path(__file__).resolve().parent
MODEL = BASE / "model" / "xgb_duplicate_model.joblib"
PREVIOUS_MODEL_BACKUP = BASE / "model" / "backups" / "xgb_duplicate_model_pre_admission_number.joblib"
METADATA = BASE / "model" / "xgb_duplicate_model.metadata.json"
REPORT = BASE / "evaluation" / "realistic_pairs_xgboost_training_metrics.json"
PREVIOUS_REPORT_BACKUP = BASE / "evaluation" / "realistic_pairs_xgboost_training_metrics_upi_v1.json"
SEED = 876_441
SCHEMA_VERSION = "student-pair-v2-admission-number"
REFERENCE_THRESHOLD = 0.50
THRESHOLD_GRID = tuple(round(0.30 + 0.01 * step, 2) for step in range(61))
THRESHOLD_GRID = tuple(round(0.20 + 0.01 * step, 2) for step in range(61))
MAX_VALIDATION_FPR = 0.05
RAW_COLUMNS = (
    "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
    "guardian_1", "guardian_2", "admission_number_1", "admission_number_2",
    "birth_certificate_1", "birth_certificate_2",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def score(labels: pd.Series, probabilities, threshold: float = REFERENCE_THRESHOLD) -> dict[str, object]:
    predicted = (probabilities >= threshold).astype(int)
    tn, fp, fn, tp = map(int, confusion_matrix(labels, predicted, labels=[0, 1]).ravel())
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {
        "threshold": threshold,
        "rows": int(len(labels)),
        "accuracy": float(accuracy_score(labels, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "specificity": float(specificity),
        "false_positive_rate": float(1.0 - specificity),
        "false_negative_rate": float(1.0 - recall),
        "average_precision": float(average_precision_score(labels, probabilities)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": [[tn, fp], [fn, tp]],
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "illustrative_precision_at_assumed_prevalence": {
            str(rate): float((recall * rate) / (recall * rate + (1.0 - specificity) * (1.0 - rate)))
            if recall * rate + (1.0 - specificity) * (1.0 - rate) else 0.0
            for rate in (0.01, 0.05, 0.10)
        },
    }


def _validate(frame: pd.DataFrame, name: str) -> None:
    required = {
        "group_id", "identity_1", "identity_2", "label", "scenario", "variation",
        "difficulty", "difficulty_band", *FEATURE_COLUMNS, *RAW_COLUMNS,
    }
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing columns: {', '.join(missing)}")
    if frame[["group_id", "label", "scenario", "variation", *FEATURE_COLUMNS]].isna().any().any():
        raise ValueError(f"{name} contains missing features, labels, groups, or scenarios")
    if set(frame.label.unique()) != {0, 1}:
        raise ValueError(f"{name} must contain both labels")
    if (frame.groupby("group_id").label.nunique() != 1).any():
        raise ValueError(f"{name} has inconsistent labels within a pair group")
    if (frame.groupby("group_id")["difficulty"].nunique() != 1).any():
        raise ValueError(f"{name} has inconsistent continuous difficulty metadata within a pair group")
    identity_agreement = frame.identity_1.astype(str) == frame.identity_2.astype(str)
    if not (identity_agreement == (frame.label.astype(int) == 1)).all():
        raise ValueError(f"{name} has identity IDs inconsistent with its duplicate labels")
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
            "admission_number": row.admission_number_1,
            "birth_certificate_number": row.birth_certificate_1,
        }
        second = {
            "full_name": row.name_2,
            "date_of_birth": row.dob_2,
            "school_code": row.school_2,
            "guardian_id": row.guardian_2,
            "admission_number": row.admission_number_2,
            "birth_certificate_number": row.birth_certificate_2,
        }
        recomputed = build_pair_features(first, second)
        if any(abs(float(getattr(row, feature)) - float(recomputed[feature])) > 1e-12 for feature in FEATURE_COLUMNS):
            raise ValueError(f"{name} has stored features inconsistent with the raw pair fields")


def select_threshold(labels: pd.Series, probabilities, grid: tuple[float, ...] = THRESHOLD_GRID) -> dict[str, object]:
    """Choose the review cutoff on the validation split only.

    The cutoff maximises F1, with ties broken towards the higher cutoff so an equal
    score never buys extra flags. The holdout is not consulted.
    """
    scored = []
    for threshold in grid:
        predicted = (probabilities >= threshold).astype(int)
        tn, fp, _, _ = confusion_matrix(labels, predicted, labels=[0, 1]).ravel()
        fpr = fp / (tn + fp) if tn + fp else 0.0
        scored.append((float(f1_score(labels, predicted, zero_division=0)), threshold, fpr))
    eligible = [item for item in scored if item[2] <= MAX_VALIDATION_FPR]
    pool = eligible or scored
    best_f1 = max(item[0] for item in pool)
    best_f1, best_threshold, best_fpr = max(
        (item for item in pool if item[0] >= best_f1 - 1e-12), key=lambda item: item[1]
    )
    return {
        "threshold": best_threshold,
        "validation_f1": best_f1,
        "validation_fpr": best_fpr,
        "max_validation_fpr": MAX_VALIDATION_FPR,
        "fpr_guardrail_satisfied": bool(eligible),
        "grid": [grid[0], grid[-1]],
    }


def _group_metrics(frame: pd.DataFrame, probabilities, threshold: float, column: str) -> dict[str, object]:
    predicted = (probabilities >= threshold).astype(int)
    results: dict[str, object] = {}
    for value, subset in frame.groupby(column, sort=True):
        indices = subset.index.to_numpy()
        labels = subset.label.to_numpy()
        outcomes = predicted[indices]
        results[str(value)] = {
            "rows": int(len(subset)),
            "label": int(labels[0]),
            "accuracy": float((outcomes == labels).mean()),
            "positive_recall": float((outcomes == 1).mean()) if labels[0] else None,
            "negative_false_positive_rate": float((outcomes == 1).mean()) if labels[0] == 0 else None,
        }
    return results


def _feature_analysis(frame: pd.DataFrame, probabilities, threshold: float) -> dict[str, object]:
    """Univariate signal per feature: how much one column alone explains."""
    table: dict[str, object] = {}
    predicted = (probabilities >= threshold).astype(int)
    for column in FEATURE_COLUMNS:
        entry: dict[str, object] = {
            "holdout_auc": None,
            "mean_positive": float(frame.loc[frame.label == 1, column].mean()),
            "mean_negative": float(frame.loc[frame.label == 0, column].mean()),
            "single_feature_accuracy_at_half": float(
                ((frame[column] >= 0.5).astype(int) == frame.label).mean()
            ),
        }
        if frame[column].nunique() > 1:
            entry["holdout_auc"] = float(roc_auc_score(frame.label, frame[column]))
        table[column] = entry
    table["_combined_model_accuracy"] = float((predicted == frame.label).mean())
    return table


def _scenario_distribution(frame: pd.DataFrame) -> dict[str, object]:
    """Report synthetic challenge mix by intended scenario tier and identity label."""
    # Positive groups can contain pair rows with different recorded mutations.
    groups = frame.drop_duplicates(["group_id", "difficulty_band"])
    group_counts = groups.groupby(["difficulty_band", "label"]).size()
    pair_counts = frame.groupby(["difficulty_band", "label"]).size()
    return {
        "tier_definition": "Scenario-design categories only; not real-world prevalence or model inputs.",
        "groups_note": "A positive identity group can contribute pair rows to more than one tier.",
        "unique_groups_represented_in_tier": {
            band: {"positive": int(group_counts.get((band, 1), 0)), "negative": int(group_counts.get((band, 0), 0))}
            for band in ("easy", "moderate", "hard")
        },
        "pair_rows": {
            band: {"positive": int(pair_counts.get((band, 1), 0)), "negative": int(pair_counts.get((band, 0), 0))}
            for band in ("easy", "moderate", "hard")
        },
    }


def _examples(frame: pd.DataFrame, probabilities, threshold: float, label: int, prediction: int, limit: int = 5) -> list[dict[str, object]]:
    predicted = (probabilities >= threshold).astype(int)
    mask = (frame.label.to_numpy() == label) & (predicted == prediction)
    subset = frame[mask].copy()
    if subset.empty:
        return []
    subset["pair_score"] = probabilities[mask]
    subset = subset.sort_values("pair_score", ascending=(label == 1))
    rows = []
    for row in subset.head(limit).itertuples(index=False):
        rows.append({
            "score": round(float(row.pair_score), 4),
            "variation": row.variation,
            "name": [row.name_1, row.name_2],
            "date_of_birth": [row.dob_1, row.dob_2],
            "school": [row.school_1, row.school_2],
            "admission_number": [row.admission_number_1, row.admission_number_2],
            "birth_certificate": [row.birth_certificate_1, row.birth_certificate_2],
            "features": {feature: round(float(getattr(row, feature)), 4) for feature in FEATURE_COLUMNS},
        })
    return rows


def _build_selected_model() -> tuple[object, str, dict[str, object]]:
    """Rebuild the candidate selected by the fresh train/validation-only sweep."""
    selection_path = BASE / "experiments" / "results" / "model_comparison_validation_20261125.json"
    selection_report = json.loads(selection_path.read_text(encoding="utf-8"))
    selected = str(selection_report["selected_candidate"])
    from experiments.regularization_sweep import candidates

    choices = candidates()
    if selected == "calibrated_hist_gradient_boosting":
        model = CalibratedClassifierCV(estimator=choices["hist_gradient_boosting"], method="sigmoid", cv=3)
    else:
        model = choices[selected]
    parameters = selection_report["candidate_parameters"][selected]
    return model, selected, parameters


def main() -> dict[str, object]:
    train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    validation = pd.read_csv(VALIDATION_FILE, float_precision="round_trip")
    for frame, name in (
        (train, "training data"),
        (validation, "validation data"),
    ):
        _validate(frame, name)
    for frame in (train, validation):
        frame["label"] = frame.label.astype(int)
        frame.reset_index(drop=True, inplace=True)

    model, selected_candidate, selected_parameters = _build_selected_model()
    model.fit(train[FEATURE_COLUMNS], train.label)

    train_probability = model.predict_proba(train[FEATURE_COLUMNS])[:, 1]
    validation_probability = model.predict_proba(validation[FEATURE_COLUMNS])[:, 1]
    selection = select_threshold(validation.label, validation_probability)
    threshold = float(selection["threshold"])

    # Freeze and persist the selected estimator/cutoff before opening the final test.
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL)
    promoted_model_sha256 = sha256(MODEL)

    # Publish a hash-valid model manifest and run serving smoke cases before the
    # sealed test is opened. A smoke failure stops the run before test evaluation.
    trained_at = datetime.now(timezone.utc).isoformat()
    locked_metadata = {
        "trained_at_utc": trained_at,
        "schema_version": SCHEMA_VERSION,
        "dataset_seed": TRAIN_SEED,
        "component_split_seed": SPLIT_SEED,
        "model_file": str(MODEL.relative_to(BASE)),
        "model_sha256": promoted_model_sha256,
        "model_type": f"{type(model).__module__}.{type(model).__name__}",
        "feature_columns": FEATURE_COLUMNS,
        "feature_count": len(FEATURE_COLUMNS),
        "review_threshold": threshold,
        "review_threshold_source": "validation split, maximum F1 subject to validation FPR <= 0.05; higher cutoff breaks ties",
        "training_sha256": sha256(TRAIN_FILE),
        "validation_sha256": sha256(VALIDATION_FILE),
        "algorithm": selected_candidate,
        "algorithm_parameters": selected_parameters,
        "dataset_provenance": {
            "type": "synthetic identity scenarios; not adjudicated beneficiary data",
            "generator_file": "generate_realistic_pairs.py",
            "generator_sha256": sha256(BASE / "generate_realistic_pairs.py"),
        },
    }
    METADATA.write_text(json.dumps(locked_metadata, indent=2) + "\n", encoding="utf-8")
    smoke = subprocess.run(
        [sys.executable, str(BASE / "test_predictions.py")],
        cwd=BASE, text=True, capture_output=True, check=False,
    )
    print(smoke.stdout, end="")
    if smoke.returncode:
        raise RuntimeError(f"Prediction smoke test failed before final test access:\n{smoke.stderr}")

    # One final read/score pass. Do not use this result to change the estimator,
    # threshold, generator, features, or any selection rule.
    holdout = pd.read_csv(HOLDOUT_FILE, float_precision="round_trip")
    _validate(holdout, "sealed final test")
    holdout["label"] = holdout.label.astype(int)
    holdout.reset_index(drop=True, inplace=True)
    holdout_probability = model.predict_proba(holdout[FEATURE_COLUMNS])[:, 1]

    exact_mask = (holdout.variation == "exact_duplicate").to_numpy()
    exact_metrics = score(holdout.loc[exact_mask, "label"], holdout_probability[exact_mask], threshold)
    near_metrics = score(holdout.loc[~exact_mask, "label"], holdout_probability[~exact_mask], threshold)

    result = {
        "schema_version": SCHEMA_VERSION,
        "dataset_seed": TRAIN_SEED,
        "component_split_seed": SPLIT_SEED,
        "feature_columns": FEATURE_COLUMNS,
        "previous_feature_columns": [
            "jaro_winkler", "dob_match", "school_match", "guardian_match",
            "upi_match", "birth_certificate_match",
        ],
        "training_file": str(TRAIN_FILE.relative_to(BASE)),
        "training_sha256": sha256(TRAIN_FILE),
        "training_rows": int(len(train)),
        "training_groups": int(train.group_id.nunique()),
        "training_unique_identities": int(pd.unique(pd.concat([train.identity_1, train.identity_2])).size),
        "training_class_counts": {str(k): int(v) for k, v in train.label.value_counts().sort_index().items()},
        "scenario_distribution": {
            "training": _scenario_distribution(train),
            "validation": _scenario_distribution(validation),
            "holdout": _scenario_distribution(holdout),
        },
        "generator_metadata_excluded_from_model": [
            "difficulty", "difficulty_band", "scenario", "variation", "mutations",
            "group_id", "identity_1", "identity_2",
        ],
        "validation_file": str(VALIDATION_FILE.relative_to(BASE)),
        "validation_sha256": sha256(VALIDATION_FILE),
        "validation_rows": int(len(validation)),
        "validation_groups": int(validation.group_id.nunique()),
        "validation_unique_identities": int(pd.unique(pd.concat([validation.identity_1, validation.identity_2])).size),
        "holdout_file": str(HOLDOUT_FILE.relative_to(BASE)),
        "holdout_sha256": sha256(HOLDOUT_FILE),
        "holdout_rows": int(len(holdout)),
        "holdout_groups": int(holdout.group_id.nunique()),
        "holdout_unique_identities": int(pd.unique(pd.concat([holdout.identity_1, holdout.identity_2])).size),
        "holdout_class_counts": {str(k): int(v) for k, v in holdout.label.value_counts().sort_index().items()},
        "holdout_used_for_training_or_tuning": False,
        "holdout_used_for_model_selection": False,
        "holdout_used_for_threshold_selection": False,
        "split": "One synthetic population is partitioned by connected identity/guardian components at 70/15/15; train fits preprocessing/model, validation selects candidate and threshold, final test is read only after lock and scored once.",
        "final_test_read_after_lock": True,
        "selection": "Cutoff maximises validation F1, ties broken towards the higher cutoff; no holdout information enters the choice.",
        "threshold_selection": selection,
        "selected_candidate": selected_candidate,
        "selected_parameters": selected_parameters,
        "candidate_selection_file": "experiments/results/model_comparison_validation_20261125.json",
        "training_metrics": score(train.label, train_probability, threshold),
        "validation_metrics": score(validation.label, validation_probability, threshold),
        "selected_model_holdout_metrics": score(holdout.label, holdout_probability, threshold),
        "holdout_metrics_at_reference_threshold": score(holdout.label, holdout_probability, REFERENCE_THRESHOLD),
        "holdout_exact_duplicate_metrics": exact_metrics,
        "holdout_near_duplicate_metrics": near_metrics,
        "holdout_variation_metrics": _group_metrics(holdout, holdout_probability, threshold, "variation"),
        "holdout_feature_analysis": _feature_analysis(holdout, holdout_probability, threshold),
        "holdout_false_positives": _examples(holdout, holdout_probability, threshold, 0, 1),
        "holdout_false_negatives": _examples(holdout, holdout_probability, threshold, 1, 0),
        "holdout_true_positives": _examples(holdout, holdout_probability, threshold, 1, 1, limit=3),
        "deployed_model_fit_rows": int(len(train)),
        "deployed_model_file": str(MODEL.relative_to(BASE)),
        "deployed_model_sha256": promoted_model_sha256,
        "previous_model_backup": str(PREVIOUS_MODEL_BACKUP.relative_to(BASE)) if PREVIOUS_MODEL_BACKUP.exists() else None,
        "model_promoted": True,
        "algorithm": selected_candidate,
        "feature_semantics": {
            "jaro_winkler": "Jaro-Winkler on the concatenated name, also computed on sorted tokens so first/middle/surname order changes still match.",
            "dob_match": "1.0 exact calendar date, 0.8 one day apart, 0.5 up to a week apart, else 0; YYYY-MM-DD, DD/MM/YYYY and separators are accepted.",
            "school_match": "Normalised exact school-code equality.",
            "guardian_match": "Normalised identifier equality after removing the G prefix, otherwise Jaro-Winkler.",
            "admission_number_match": "School-gated: 0 unless both records share a school identity, then 1.0 exact, 0.9 for a character transposition, 0 for any other difference.",
            "birth_certificate_match": "Normalised identifier equality after removing the BC prefix, otherwise Jaro-Winkler.",
        },
        "scikit_learn_version": sklearn.__version__,
        "xgboost_version": xgboost.__version__,
        "limitations": [
            "The data is synthetic and cannot establish performance on real beneficiaries.",
            "The balanced label mix is not the expected operational prevalence; assumed-prevalence precision values are illustrative only.",
            "The hard-negative scenario mix is a challenge distribution, not an estimate of registry prevalence.",
            "Holdout identities come from the same simulator, not an external organisation or adjudicated real sample.",
            "The school gate means an admission number contributes nothing when the school is unknown on either record.",
            "Admission-number reuse inside one school is deliberately present in the negatives, so the feature alone cannot decide a case.",
        ],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    metadata = {
        "trained_at_utc": trained_at,
        "schema_version": SCHEMA_VERSION,
        "model_file": str(MODEL.relative_to(BASE)),
        "model_sha256": result["deployed_model_sha256"],
        "model_type": f"{type(model).__module__}.{type(model).__name__}",
        "feature_columns": FEATURE_COLUMNS,
        "feature_count": len(FEATURE_COLUMNS),
        "review_threshold": threshold,
        "review_threshold_source": "validation split, maximum F1 subject to validation FPR <= 0.05; higher cutoff breaks ties",
        "training_sha256": result["training_sha256"],
        "validation_sha256": result["validation_sha256"],
        "holdout_sha256": result["holdout_sha256"],
        "algorithm_parameters": selected_parameters,
        "training_split": {"rows": int(len(train)), "groups": int(train.group_id.nunique())},
        "validation_split": {"rows": int(len(validation)), "groups": int(validation.group_id.nunique())},
        "holdout_split": {"rows": int(len(holdout)), "groups": int(holdout.group_id.nunique())},
        "dataset_provenance": {
            "type": "synthetic identity scenarios; not adjudicated beneficiary data",
            "generator_file": str(Path("generate_realistic_pairs.py")),
            "generator_sha256": sha256(BASE / "generate_realistic_pairs.py"),
            "training_file": result["training_file"],
            "validation_file": result["validation_file"],
            "holdout_file": result["holdout_file"],
        },
        "training_metrics": result["training_metrics"],
        "validation_metrics": result["validation_metrics"],
        "holdout_metrics": result["selected_model_holdout_metrics"],
        "scikit_learn_version": sklearn.__version__,
        "xgboost_version": xgboost.__version__,
        "metrics_report": str(REPORT.relative_to(BASE)),
        "feature_semantics": result["feature_semantics"],
    }
    METADATA.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()

