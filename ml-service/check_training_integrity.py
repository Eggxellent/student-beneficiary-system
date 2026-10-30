"""Prove the deployed model is fitted on training data and judged on separate data.

Every performance number the project quotes (the 0.35% false-positive baseline, the
holdout F1, the choice of the 0.50 review cutoff) is only meaningful if three things
hold. This script tests all three against the files on disk, and fails loudly when a
future run breaks one of them.

1. **Provenance** - the shipped artifact is byte-for-byte the one the metrics report
   describes, and the report's training/holdout hashes match the files on disk.
2. **Separation** - training and holdout share no pair group, no person identity, and
   no identical row, so no holdout record could have been memorised.
3. **Generality** - the artifact performs as well on data it never saw as it does on
   data it was fitted to. A large in-sample advantage means the reported holdout
   numbers are not the whole story, and grouped cross-validation plus a learning curve
   distinguish "generalises" from "memorises specific rows".

It also scans the serving path for training calls, because a model that retrains on
live registrations cannot be audited this way at all.

Usage (from ``ml-service/``):

    .\\.venv\\Scripts\\python.exe .\\check_training_integrity.py
    .\\.venv\\Scripts\\python.exe .\\check_training_integrity.py --fast --output .\\evaluation\\probe.json

Exit code 0 means every check passed; 1 means at least one violation was found.
The script is read-only: it never trains the deployed artifact, never writes to
``training/`` or ``evaluation/realistic_pairs_holdout.csv``, and only writes the JSON
report you ask for.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
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

from feature_engineering import FEATURE_COLUMNS, _missing
from generate_realistic_pairs import HOLDOUT_FILE, TRAIN_FILE
from predict import MODEL_FILE

BASE = Path(__file__).resolve().parent
METRICS_FILE = BASE / "evaluation" / "realistic_pairs_xgboost_training_metrics.json"
DEFAULT_OUTPUT = BASE / "evaluation" / "training_integrity_report.json"
CUTOFF = 0.50
SEED = 20261021

# Thresholds are deliberately loose: they catch memorisation and leakage, not noise.
MAX_INSAMPLE_F1_ADVANTAGE = 0.10   # in-sample minus holdout F1
MAX_HOLDOUT_VS_CV_GAP = 0.03       # |holdout F1 - grouped CV mean F1|
SHORTCUT_AUC = 0.95                # single feature that nearly determines the label
CURVE_FRACTIONS = (0.10, 0.25, 0.50, 1.00)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics_for(labels, probabilities) -> dict[str, object]:
    labels = np.asarray(labels, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    predicted = (probabilities >= CUTOFF).astype(int)
    tn, fp, fn, tp = map(int, confusion_matrix(labels, predicted, labels=[0, 1]).ravel())
    return {
        "rows": int(labels.size),
        "accuracy": float(accuracy_score(labels, predicted)),
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(labels, probabilities)),
        "average_precision": float(average_precision_score(labels, probabilities)),
        "confusion_matrix_labels_0_1": [[tn, fp], [fn, tp]],
        "false_positives": fp,
        "false_negatives": fn,
    }


def build_model() -> Pipeline:
    """Rebuild the deployed configuration from the recorded selected parameters."""
    recorded = json.loads(METRICS_FILE.read_text(encoding="utf-8"))["selected_parameters"]
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "classifier",
                XGBClassifier(
                    **recorded,
                    objective="binary:logistic",
                    eval_metric="logloss",
                    tree_method="hist",
                    random_state=SEED,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def person_keys(frame: pd.DataFrame) -> tuple[set[tuple[str, str, str]], int]:
    """Identity of every person appearing on either side of every pair.

    Missing placeholders ("NOT PROVIDED", NaN, ...) are normalised away with the same
    helper the feature builder uses. Without that, every record whose fields are all
    blank collapses to one identical key and the disjointness test reports phantom
    collisions between two different people who both happened to omit their details.

    A key must carry a name or a UPI. A birth date on its own does not identify anyone
    (about 1 in 5 500 records share any given date), so such records are counted in the
    second return value instead of being compared.
    """
    keys: set[tuple[str, str, str]] = set()
    unidentifiable = 0
    for side in ("1", "2"):
        names = frame[f"name_{side}"].tolist()
        dobs = frame[f"dob_{side}"].tolist()
        upis = frame[f"upi_{side}"].tolist()
        for name, dob, upi in zip(names, dobs, upis, strict=True):
            key = (
                "" if _missing(name) else re.sub(r"[^a-z]", "", str(name).casefold()),
                "" if _missing(dob) else str(dob).strip(),
                "" if _missing(upi) else re.sub(r"[^a-z0-9]", "", str(upi).casefold()),
            )
            if key[0] or key[2]:
                keys.add(key)
            else:
                unidentifiable += 1
    return keys, unidentifiable


def name_pool_overlap(train: pd.DataFrame, holdout: pd.DataFrame) -> int:
    """Shared *names* are expected (finite Kenyan name pools) and are not leakage."""
    left = set(train.name_1.str.casefold()) | set(train.name_2.str.casefold())
    right = set(holdout.name_1.str.casefold()) | set(holdout.name_2.str.casefold())
    return len(left & right)


def exact_row_overlap(train: pd.DataFrame, holdout: pd.DataFrame) -> int:
    """Rows identical in every raw field across the split, i.e. literal copies."""
    columns = [column for column in train.columns if column in set(holdout.columns)]
    left = set(map(tuple, train[columns].astype(str).to_numpy()))
    right = set(map(tuple, holdout[columns].astype(str).to_numpy()))
    return len(left & right)


def single_feature_auc(train: pd.DataFrame, holdout: pd.DataFrame) -> dict[str, dict[str, float | None]]:
    """A feature with AUC near 1 is a generator shortcut, as raw_pairs.csv had."""
    table: dict[str, dict[str, float | None]] = {}
    for column in FEATURE_COLUMNS:
        entry: dict[str, float | None] = {"training_auc": None, "holdout_auc": None}
        for name, frame in (("training_auc", train), ("holdout_auc", holdout)):
            if frame[column].nunique() > 1:
                entry[name] = float(roc_auc_score(frame.label, frame[column]))
        table[column] = entry
    return table


def grouped_cross_validation(train: pd.DataFrame, folds: int) -> list[dict[str, object]]:
    """Refit inside the training file with whole groups held out, never the holdout file."""
    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=SEED)
    features = train[FEATURE_COLUMNS]
    labels = train.label.to_numpy()
    scores: list[dict[str, object]] = []
    for index, (fit_rows, test_rows) in enumerate(
        splitter.split(features, labels, groups=train.group_id.to_numpy()), start=1
    ):
        model = build_model()
        model.fit(features.iloc[fit_rows], labels[fit_rows])
        probabilities = model.predict_proba(features.iloc[test_rows])[:, 1]
        fold = metrics_for(labels[test_rows], probabilities)
        scores.append({"fold": index, "f1": fold["f1"], "roc_auc": fold["roc_auc"], "rows": fold["rows"]})
    return scores


def learning_curve(train: pd.DataFrame, holdout: pd.DataFrame) -> list[dict[str, object]]:
    """Score the untouched holdout after fitting on increasing shares of the training groups.

    A curve that keeps climbing at 100% suggests the model is still short of data. A curve
    that is already flat well below the in-sample score suggests stable, generalisable
    structure rather than memorisation.
    """
    groups = train[["group_id", "label"]].drop_duplicates("group_id")
    results: list[dict[str, object]] = []
    for fraction in CURVE_FRACTIONS:
        if fraction >= 1.0:
            subset = train
        else:
            chosen = set(
                groups.groupby("label", group_keys=False)
                .sample(frac=fraction, random_state=SEED)
                .group_id
            )
            subset = train[train.group_id.isin(chosen)]
        model = build_model()
        model.fit(subset[FEATURE_COLUMNS], subset.label.to_numpy())
        holdout_metrics = metrics_for(holdout.label, model.predict_proba(holdout[FEATURE_COLUMNS])[:, 1])
        results.append(
            {
                "training_fraction": fraction,
                "training_rows": int(len(subset)),
                "training_groups": int(subset.group_id.nunique()),
                "holdout_f1": holdout_metrics["f1"],
                "holdout_roc_auc": holdout_metrics["roc_auc"],
                "holdout_accuracy": holdout_metrics["accuracy"],
            }
        )
    return results


def runtime_training_scan(*paths: Path) -> list[dict[str, object]]:
    """The serving path must load an artifact, never fit one."""
    banned = (".fit(", "GridSearchCV", "joblib.dump", "train_model", "train_test_split")
    results = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        found = [token for token in banned if token in text]
        results.append({"file": str(path.relative_to(BASE)), "banned_tokens_found": found, "clean": not found})
    return results


def run(fast: bool = False, folds: int = 5) -> dict[str, object]:
    """Execute every integrity check and return the report plus a violation list."""
    recorded = json.loads(METRICS_FILE.read_text(encoding="utf-8"))
    train = pd.read_csv(TRAIN_FILE)
    holdout = pd.read_csv(HOLDOUT_FILE)
    train["label"] = train.label.astype(int)
    holdout["label"] = holdout.label.astype(int)
    model = joblib.load(MODEL_FILE)

    artifact_sha = sha256(MODEL_FILE)
    train_sha = sha256(TRAIN_FILE)
    holdout_sha = sha256(HOLDOUT_FILE)

    in_sample = metrics_for(train.label, model.predict_proba(train[FEATURE_COLUMNS])[:, 1])
    on_holdout = metrics_for(holdout.label, model.predict_proba(holdout[FEATURE_COLUMNS])[:, 1])

    train_keys, train_unidentifiable = person_keys(train)
    holdout_keys, holdout_unidentifiable = person_keys(holdout)
    shared_groups = set(train.group_id) & set(holdout.group_id)

    cv_scores = [] if fast else grouped_cross_validation(train, folds)
    cv_f1 = float(np.mean([score["f1"] for score in cv_scores])) if cv_scores else None
    cv_auc = float(np.mean([score["roc_auc"] for score in cv_scores])) if cv_scores else None

    auc_table = single_feature_auc(train, holdout)
    duplicates = exact_row_overlap(train, holdout)
    serving = runtime_training_scan(BASE / "predict.py")

    violations: list[str] = []
    if artifact_sha != recorded.get("deployed_model_sha256"):
        violations.append("artifact hash does not match the recorded metrics report")
    if train_sha != recorded.get("training_sha256"):
        violations.append("training file hash does not match the recorded metrics report")
    if holdout_sha != recorded.get("holdout_sha256"):
        violations.append("holdout file hash does not match the recorded metrics report")
    if recorded.get("holdout_used_for_training_or_tuning") is not False:
        violations.append("metrics report does not assert the holdout was excluded from training")
    if shared_groups:
        violations.append(f"{len(shared_groups)} pair groups appear in both training and holdout")
    if train_keys & holdout_keys:
        violations.append(f"{len(train_keys & holdout_keys)} person identities appear in both splits")
    if duplicates:
        violations.append(f"{duplicates} identical rows appear in both splits")

    advantage = float(in_sample["f1"]) - float(on_holdout["f1"])
    if advantage > MAX_INSAMPLE_F1_ADVANTAGE:
        violations.append(
            f"in-sample F1 beats holdout F1 by {advantage:.3f} "
            f"(limit {MAX_INSAMPLE_F1_ADVANTAGE}); the model is memorising training rows"
        )
    if cv_f1 is not None and abs(float(on_holdout["f1"]) - cv_f1) > MAX_HOLDOUT_VS_CV_GAP:
        violations.append(
            f"holdout F1 differs from grouped CV F1 by {abs(float(on_holdout['f1']) - cv_f1):.3f} "
            f"(limit {MAX_HOLDOUT_VS_CV_GAP}); the split distributions may differ"
        )
    for column, entry in auc_table.items():
        holdout_auc = entry.get("holdout_auc")
        if holdout_auc is not None and holdout_auc >= SHORTCUT_AUC:
            violations.append(f"feature {column} alone has holdout AUC {holdout_auc:.3f}, a label shortcut")
    if not all(item["clean"] for item in serving):
        violations.append("the serving path contains training or serialisation calls")

    return {
        "verdict": "pass" if not violations else "fail",
        "violations": violations,
        "provenance": {
            "artifact_file": str(MODEL_FILE.relative_to(BASE)),
            "artifact_sha256": artifact_sha,
            "artifact_matches_metrics_report": artifact_sha == recorded.get("deployed_model_sha256"),
            "training_file": str(TRAIN_FILE.relative_to(BASE)),
            "training_sha256_matches_report": train_sha == recorded.get("training_sha256"),
            "holdout_file": str(HOLDOUT_FILE.relative_to(BASE)),
            "holdout_sha256_matches_report": holdout_sha == recorded.get("holdout_sha256"),
        },
        "separation": {
            "training_rows": int(len(train)),
            "training_groups": int(train.group_id.nunique()),
            "holdout_rows": int(len(holdout)),
            "holdout_groups": int(holdout.group_id.nunique()),
            "shared_groups": len(shared_groups),
            "shared_person_identities": len(train_keys & holdout_keys),
            "identical_rows_across_splits": duplicates,
            "records_without_name_or_upi": {
                "training": train_unidentifiable,
                "holdout": holdout_unidentifiable,
            },
            "shared_names_expected_from_finite_pools": name_pool_overlap(train, holdout),
        },
        "overfitting": {
            "in_sample_metrics": in_sample,
            "holdout_metrics": on_holdout,
            "in_sample_f1_advantage": round(advantage, 6),
            "in_sample_f1_advantage_limit": MAX_INSAMPLE_F1_ADVANTAGE,
            "grouped_cv_folds": cv_scores,
            "grouped_cv_mean_f1": cv_f1,
            "grouped_cv_mean_roc_auc": cv_auc,
            "holdout_minus_cv_f1": None if cv_f1 is None else round(float(on_holdout["f1"]) - cv_f1, 6),
            "learning_curve": [] if fast else learning_curve(train, holdout),
        },
        "label_shortcuts": auc_table,
        "serving_path": serving,
        "reported_by_metrics_file": {
            "holdout_used_for_training_or_tuning": recorded.get("holdout_used_for_training_or_tuning"),
            "holdout_used_for_model_selection": recorded.get("holdout_used_for_model_selection"),
            "threshold": recorded.get("selected_model_holdout_metrics", {}).get("threshold"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit training/holdout separation and overfitting.")
    parser.add_argument("--fast", action="store_true", help="skip grouped CV and the learning curve")
    parser.add_argument("--folds", type=int, default=5, help="grouped CV folds on the training file")
    parser.add_argument("--output", type=Path, default=None, help="optional JSON report path")
    arguments = parser.parse_args()

    report = run(fast=arguments.fast, folds=arguments.folds)
    separation, overfitting = report["separation"], report["overfitting"]
    print(f"verdict: {report['verdict']}")
    print(
        f"separation: {separation['shared_groups']} shared groups, "
        f"{separation['shared_person_identities']} shared identities, "
        f"{separation['identical_rows_across_splits']} identical rows"
    )
    print(
        f"in-sample F1 {overfitting['in_sample_metrics']['f1']:.4f} vs holdout F1 "
        f"{overfitting['holdout_metrics']['f1']:.4f} (advantage {overfitting['in_sample_f1_advantage']:.4f})"
    )
    if overfitting["grouped_cv_mean_f1"] is not None:
        print(
            f"grouped CV F1 {overfitting['grouped_cv_mean_f1']:.4f} vs holdout F1 "
            f"{overfitting['holdout_metrics']['f1']:.4f}"
        )
    for point in overfitting["learning_curve"]:
        print(
            f"  {point['training_fraction']:.0%} of groups ({point['training_rows']} rows): "
            f"holdout F1 {point['holdout_f1']:.4f}, AUC {point['holdout_roc_auc']:.4f}"
        )
    for violation in report["violations"]:
        print(f"VIOLATION: {violation}")

    if arguments.fast and arguments.output is None:
        raise SystemExit(
            "--fast skips the grouped CV and learning curve, which are part of the committed "
            "evidence. Pass an explicit --output so evaluation/training_integrity_report.json "
            "is not overwritten with a reduced report."
        )
    output = arguments.output or DEFAULT_OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"report: {output}")
    return 0 if report["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
