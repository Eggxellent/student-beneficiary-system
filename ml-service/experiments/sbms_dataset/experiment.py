"""Research-only experiment for the externally supplied synthetic SBMS archive.

Never writes to the archive or active production model. Metadata is used only
for integrity/group checks and challenge-set reporting, never as a feature.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
import sys
import time
import zipfile
from collections import Counter
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import joblib
import jellyfish
import numpy as np
import pandas as pd
import sklearn
import xgboost
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ml-service"))
from feature_engineering import FEATURE_COLUMNS, build_pair_features  # noqa: E402

SEED = 42
SPLITS = ("train", "val", "test")
PAIR_FIELDS = (
    "first_name", "middle_name", "surname", "dob", "gender", "county", "ward",
    "school", "guardian_name", "guardian_phone", "guardian_id_no", "application_year",
)
# Only the first four existing SBMS features have corresponding archive fields.
MODEL_FEATURES = [*FEATURE_COLUMNS[:4], "name_both_present", "dob_both_present",
                  "school_both_present", "guardian_both_present",
                  "dob_conflict", "guardian_conflict"]
RESEARCH_ARTIFACTS = ROOT / "ml-service" / "experiments" / "sbms_dataset" / "artifacts"
REPORTS = ROOT / "ml-service" / "reports"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _required_columns() -> set[str]:
    return {"pair_id", "label", "y", *(f"{side}_{field}" for side in "ab" for field in PAIR_FIELDS)}


def _read_csv(archive: zipfile.ZipFile, name: str) -> pd.DataFrame:
    # keep_default_na=False prevents CSV tokens/identifier-like values being coerced.
    with archive.open(name) as stream:
        return pd.read_csv(stream, dtype=str, keep_default_na=False)


def _record(row: pd.Series, side: str) -> dict[str, str]:
    full_name = " ".join(
        row[f"{side}_{field}"].strip()
        for field in ("first_name", "middle_name", "surname")
        if row[f"{side}_{field}"].strip()
    )
    # The archive has no UPI or birth-certificate fields. These intentionally
    # remain unavailable; their production-model features are excluded below.
    return {
        "full_name": full_name,
        "date_of_birth": row[f"{side}_dob"],
        "school_code": row[f"{side}_school"],
        "guardian_id": row[f"{side}_guardian_id_no"],
        "upi": "",
        "birth_certificate_number": "",
    }


def pair_features(row: pd.Series) -> dict[str, float]:
    first, second = _record(row, "a"), _record(row, "b")
    common = build_pair_features(first, second)
    def present(record: dict[str, str], key: str) -> bool:
        return bool(record[key].strip())
    name_present = present(first, "full_name") and present(second, "full_name")
    dob_present = present(first, "date_of_birth") and present(second, "date_of_birth")
    school_present = present(first, "school_code") and present(second, "school_code")
    guardian_present = present(first, "guardian_id") and present(second, "guardian_id")
    return {
        **{name: float(common[name]) for name in FEATURE_COLUMNS[:4]},
        "name_both_present": float(name_present),
        "dob_both_present": float(dob_present),
        "school_both_present": float(school_present),
        "guardian_both_present": float(guardian_present),
        "dob_conflict": float(dob_present and common["dob_match"] == 0),
        "guardian_conflict": float(guardian_present and common["guardian_match"] < 1),
    }


def _fingerprint(row: pd.Series) -> tuple[tuple[str, ...], tuple[str, ...]]:
    sides = [tuple(row[f"{side}_{field}"] for field in PAIR_FIELDS) for side in "ab"]
    return tuple(sorted(sides))  # orientation does not distinguish the same pair


def _group_overlap(metadata: pd.DataFrame, left: str, right: str, group: str) -> int:
    a = set(metadata.loc[metadata.split == left, f"{group}_a"])
    a |= set(metadata.loc[metadata.split == left, f"{group}_b"])
    b = set(metadata.loc[metadata.split == right, f"{group}_a"])
    b |= set(metadata.loc[metadata.split == right, f"{group}_b"])
    a.discard("")
    b.discard("")
    return len(a & b)


def inspect_archive(archive_path: Path) -> tuple[dict[str, Any], dict[str, pd.DataFrame]]:
    if not archive_path.is_file():
        raise FileNotFoundError(f"Dataset archive not found: {archive_path}")
    with zipfile.ZipFile(archive_path) as archive:
        member_set = set(archive.namelist())
        prefix = "sbms_dataset/"
        required = {prefix + f"pairs_{s}.csv" for s in SPLITS}
        required |= {prefix + "metadata_private.csv", prefix + "validation_report.json", prefix + "config.json"}
        missing = required - member_set
        if missing:
            raise ValueError(f"Archive is missing required members: {sorted(missing)}")
        frames = {s: _read_csv(archive, prefix + f"pairs_{s}.csv") for s in SPLITS}
        metadata = _read_csv(archive, prefix + "metadata_private.csv")
        config = json.loads(archive.read(prefix + "config.json"))
        supplied_validation = json.loads(archive.read(prefix + "validation_report.json"))
        subset_names = sorted(n for n in member_set if n.startswith(prefix + "test_subsets/") and n.endswith(".csv"))
        subsets = {Path(n).stem: _read_csv(archive, n) for n in subset_names}

    required = _required_columns()
    for split, frame in frames.items():
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"{split} missing required columns: {sorted(missing)}")
        if frame.pair_id.eq("").any() or frame.pair_id.duplicated().any():
            raise ValueError(f"{split} has missing or duplicate pair_id values")
        if not set(frame.label).issubset({"match", "non_match", "review"}):
            raise ValueError(f"{split} has unexpected labels")
        # pandas reads the generator's mixed numeric/blank y column as string
        # values "1.0"/"0.0"; validate those exact serialized forms.
        expected_y = frame.label.map({"match": "1.0", "non_match": "0.0", "review": ""})
        if not expected_y.equals(frame.y):
            raise ValueError(f"{split} label/y relationship is invalid")
        for col in (c for c in frame.columns if c.endswith(("_guardian_phone", "_guardian_id_no"))):
            if frame[col].map(lambda value: value != "" and not isinstance(value, str)).any():
                raise ValueError(f"{split} identifier field was not preserved as text")

    if not {"pair_id", "split", "identity_a", "identity_b", "cluster_a", "cluster_b"}.issubset(metadata.columns):
        raise ValueError("private metadata is missing identity/group columns")
    if metadata.pair_id.duplicated().any():
        raise ValueError("private metadata has duplicate pair IDs")
    all_ids = pd.concat([frame.pair_id for frame in frames.values()], ignore_index=True)
    if set(all_ids) != set(metadata.pair_id):
        raise ValueError("pair IDs do not match between visible CSVs and private metadata")
    for split, frame in frames.items():
        meta_split = metadata.loc[metadata.split == split]
        if set(frame.pair_id) != set(meta_split.pair_id):
            raise ValueError(f"{split} CSV and private metadata assignments differ")

    overlaps = {
        f"{group}_overlap_{left}_{right}": _group_overlap(metadata, left, right, group)
        for group in ("identity", "cluster")
        for left, right in (("train", "val"), ("train", "test"), ("val", "test"))
    }
    fingerprint_rows = {s: [_fingerprint(row) for _, row in f.iterrows()] for s, f in frames.items()}
    fingerprints: dict[str, set[Any]] = {s: set(rows) for s, rows in fingerprint_rows.items()}
    exact_pair_overlap = {
        f"exact_pair_overlap_{left}_{right}": len(fingerprints[left] & fingerprints[right])
        for left, right in (("train", "val"), ("train", "test"), ("val", "test"))
    }
    within_split_duplicates = {s: len(fingerprint_rows[s]) - len(fingerprints[s]) for s in SPLITS}
    if any(overlaps.values()) or any(exact_pair_overlap.values()) or any(within_split_duplicates.values()):
        raise ValueError("identity, cluster, or exact-pair leakage detected across/within primary splits")
    subsets_in_test = {}
    test_ids = set(frames["test"].pair_id)
    for subset_name, subset in subsets.items():
        if not required.issubset(subset.columns):
            raise ValueError(f"challenge subset {subset_name} does not match the pair schema")
        subset_ids = set(subset.pair_id)
        subsets_in_test[subset_name] = len(subset_ids - test_ids) == 0
    if not all(subsets_in_test.values()):
        raise ValueError("a challenge subset includes pair IDs outside the main test split")

    quality = {
        "dataset_archive": str(archive_path),
        "archive_sha256": _sha256(archive_path),
        "generator_seed": config.get("seed"),
        "generator_config": config,
        "python": sys.version.split()[0],
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "xgboost": xgboost.__version__,
        "jellyfish": getattr(__import__("jellyfish"), "__version__", "version unavailable"),
        "joblib": joblib.__version__,
        "splits": {},
        "group_overlap_counts": overlaps,
        "exact_pair_overlap_counts": exact_pair_overlap,
        "exact_pair_duplicates_within_split": {s: int(within_split_duplicates[s]) for s in SPLITS},
        "challenge_subsets": {
            name: {"rows": int(len(frame)), "label_counts": dict(Counter(frame.label)), "subset_of_primary_test": subsets_in_test[name]}
            for name, frame in subsets.items()
        },
        "supplied_validation_flags": supplied_validation.get("flags"),
        "supplied_validation_report": supplied_validation,
        "private_metadata_used_as_features": False,
        "missingness": {},
    }
    for split, frame in frames.items():
        quality["splits"][split] = {
            "rows": int(len(frame)),
            "label_counts": {str(k): int(v) for k, v in frame.label.value_counts().items()},
            "binary_positive_prevalence_excluding_review": float(
                (frame.loc[frame.label != "review", "label"] == "match").mean()
            ),
            "missing_cells": {column: int(frame[column].eq("").sum()) for column in frame.columns if column.startswith(("a_", "b_")) and frame[column].eq("").any()},
        }
        quality["missingness"][split] = int(sum(frame[c].eq("").sum() for c in frame.columns if c.startswith(("a_", "b_"))))
    return quality, frames


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame([pair_features(row) for _, row in frame.iterrows()], columns=MODEL_FEATURES)


def standalone_full_name_jw(row: pd.Series) -> float:
    """Standard-order full-name Jaro-Winkler baseline (no token reordering)."""
    names = []
    for side in "ab":
        value = " ".join(row[f"{side}_{part}"].strip() for part in ("first_name", "middle_name", "surname") if row[f"{side}_{part}"].strip())
        names.append("".join(re.findall(r"[a-z]+", value.casefold())))
    if not names[0] or not names[1]:
        return 0.0
    return float(jellyfish.jaro_winkler_similarity(names[0], names[1]))


def binary_part(frame: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    mask = frame.label.isin(("match", "non_match"))
    return frame.loc[mask].reset_index(drop=True), frame.loc[mask, "label"].map({"non_match": 0, "match": 1}).to_numpy(dtype=int)


def threshold_for_f1(y_true: np.ndarray, scores: np.ndarray) -> tuple[float, dict[str, float]]:
    candidates = np.unique(np.concatenate(([0.0, 0.5, 1.0], scores)))
    rows = []
    for threshold in candidates:
        predicted = (scores >= threshold).astype(int)
        rows.append((float(f1_score(y_true, predicted, zero_division=0)),
                     float(recall_score(y_true, predicted, zero_division=0)),
                     float(precision_score(y_true, predicted, zero_division=0)), float(threshold)))
    # Deterministic ties: prefer higher recall, then higher precision, then higher cutoff.
    best = max(rows, key=lambda item: (item[0], item[1], item[2], item[3]))
    return best[3], {"f1": best[0], "recall": best[1], "precision": best[2]}


def metrics(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    predicted = (scores >= threshold).astype(int)
    tn, fp, fn, tp = map(int, confusion_matrix(y_true, predicted, labels=[0, 1]).ravel())
    has_both_classes = len(np.unique(y_true)) == 2
    return {
        "n": int(len(y_true)),
        "positive_prevalence": float(y_true.mean()),
        "threshold": float(threshold),
        "precision": float(precision_score(y_true, predicted, zero_division=0)),
        "recall": float(recall_score(y_true, predicted, zero_division=0)),
        "f1": float(f1_score(y_true, predicted, zero_division=0)),
        "average_precision_pr_auc": float(average_precision_score(y_true, scores)) if has_both_classes else None,
        "roc_auc": float(roc_auc_score(y_true, scores)) if has_both_classes else None,
        "ranking_metrics_note": None if has_both_classes else "Undefined for this single-class slice.",
        "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "false_positive_rate": float(fp / (fp + tn)) if fp + tn else 0.0,
        "false_negative_rate": float(fn / (fn + tp)) if fn + tp else 0.0,
    }


def run(archive_path: Path) -> dict[str, Any]:
    start = time.monotonic()
    quality, splits = inspect_archive(archive_path)
    try:
        quality["jellyfish"] = version("jellyfish")
    except PackageNotFoundError:
        quality["jellyfish"] = "version unavailable"
    train_frame, y_train = binary_part(splits["train"])
    val_frame, y_val = binary_part(splits["val"])
    test_frame, y_test = binary_part(splits["test"])
    x_train = feature_frame(train_frame)
    x_val = feature_frame(val_frame)
    x_test = feature_frame(test_frame)

    # Baseline A: validation-selected full-name Jaro-Winkler threshold.
    jw_val = np.asarray([standalone_full_name_jw(row) for _, row in val_frame.iterrows()])
    jw_test = np.asarray([standalone_full_name_jw(row) for _, row in test_frame.iterrows()])
    jw_threshold, jw_val_metrics = threshold_for_f1(y_val, jw_val)

    # Baseline B: exact DOB plus either similar full name or matching guardian ID.
    # Select only the name cutoff on validation, and document the rest of the rule.
    rule_candidates = np.unique(np.concatenate(([0.0, 0.5, 1.0], x_val["jaro_winkler"].to_numpy())))
    rule_rows = []
    for cutoff in rule_candidates:
        rule_scores = ((x_val["dob_match"].to_numpy() == 1) & (
            (x_val["jaro_winkler"].to_numpy() >= cutoff) | (x_val["guardian_match"].to_numpy() == 1)
        )).astype(float)
        rule_rows.append((float(f1_score(y_val, rule_scores, zero_division=0)), float(recall_score(y_val, rule_scores, zero_division=0)), float(cutoff)))
    rule_cutoff = max(rule_rows, key=lambda item: (item[0], item[1], item[2]))[2]
    rule_val_scores = ((x_val["dob_match"].to_numpy() == 1) & ((x_val["jaro_winkler"].to_numpy() >= rule_cutoff) | (x_val["guardian_match"].to_numpy() == 1))).astype(float)
    rule_test_scores = ((x_test["dob_match"].to_numpy() == 1) & ((x_test["jaro_winkler"].to_numpy() >= rule_cutoff) | (x_test["guardian_match"].to_numpy() == 1))).astype(float)

    candidates = [
        {"n_estimators": n, "max_depth": d, "learning_rate": lr}
        for n, d, lr in itertools.product((120, 240), (2, 4), (0.05, 0.10))
    ]
    search_results = []
    best_model = None
    best_params = None
    for params in candidates:
        model = XGBClassifier(
            **params, min_child_weight=3, subsample=0.85, colsample_bytree=0.9,
            reg_alpha=0.0, reg_lambda=2.0, gamma=0.0, objective="binary:logistic",
            eval_metric="logloss", random_state=SEED, n_jobs=2, tree_method="hist",
        )
        model.fit(x_train, y_train, verbose=False)
        score = model.predict_proba(x_val)[:, 1]
        row = {**params, "validation_average_precision": float(average_precision_score(y_val, score)),
               "validation_f1_at_0_5": float(f1_score(y_val, score >= 0.5, zero_division=0))}
        search_results.append(row)
        ranking = (row["validation_average_precision"], row["validation_f1_at_0_5"])
        if best_model is None or ranking > best_ranking:
            best_model, best_params, best_ranking = model, params, ranking

    xgb_val_scores = best_model.predict_proba(x_val)[:, 1]
    xgb_test_scores = best_model.predict_proba(x_test)[:, 1]
    xgb_threshold, xgb_val_threshold_metrics = threshold_for_f1(y_val, xgb_val_scores)

    baselines = {
        "full_name_jaro_winkler": {
            "validation_threshold": jw_threshold,
            "validation_threshold_selection": jw_val_metrics,
            "validation_at_selected_threshold": metrics(y_val, jw_val, jw_threshold),
            "test_at_default_0_5": metrics(y_test, jw_test, 0.5),
            "test_at_validation_threshold": metrics(y_test, jw_test, jw_threshold),
        },
        "transparent_rule": {
            "rule": "exact parsed DOB AND (full-name Jaro-Winkler >= validation-selected cutoff OR exact guardian-ID similarity)",
            "validation_name_cutoff": rule_cutoff,
            "validation_at_selected_cutoff": metrics(y_val, rule_val_scores, 0.5),
            "test_at_selected_cutoff": metrics(y_test, rule_test_scores, 0.5),
        },
        "xgboost": {
            "validation_selected_parameters": best_params,
            "validation_threshold": xgb_threshold,
            "validation_threshold_selection": xgb_val_threshold_metrics,
            "validation_at_default_0_5": metrics(y_val, xgb_val_scores, 0.5),
            "validation_at_selected_threshold": metrics(y_val, xgb_val_scores, xgb_threshold),
            "test_at_default_0_5": metrics(y_test, xgb_test_scores, 0.5),
            "test_at_validation_threshold": metrics(y_test, xgb_test_scores, xgb_threshold),
            "search_candidates": search_results,
        },
    }

    # Review labels are not converted to match/non-match. This descriptive slice
    # reports score distributions only; it does not invent an abstention cutoff.
    review = splits["test"].loc[splits["test"].label == "review"]
    review_x = feature_frame(review)
    review_scores = best_model.predict_proba(review_x)[:, 1]
    review_diagnostics = {
        "n_review_annotations": int(len(review)),
        "score_mean": float(review_scores.mean()),
        "score_median": float(np.median(review_scores)),
        "fraction_between_0_4_and_0_6_descriptive_only": float(((review_scores >= 0.4) & (review_scores <= 0.6)).mean()),
        "policy": "No UNCERTAIN thresholds selected; review annotation is an evidence-policy label, not binary identity truth. A validated abstention cost/policy is needed before operational cutoffs are chosen.",
    }

    # Challenge subsets intentionally overlap primary test and are reported only
    # as slices after model/threshold selection, never as independent datasets.
    with zipfile.ZipFile(archive_path) as archive:
        subset_results = {}
        for member in sorted(n for n in archive.namelist() if n.startswith("sbms_dataset/test_subsets/") and n.endswith(".csv")):
            subset = _read_csv(archive, member)
            binary, labels = binary_part(subset)
            if len(binary):
                sub_x = feature_frame(binary)
                probs = best_model.predict_proba(sub_x)[:, 1]
                subset_results[Path(member).stem] = {
                    "rows_including_review": int(len(subset)), "binary_rows": int(len(binary)),
                    "overlaps_primary_test": True,
                    "at_validation_threshold": metrics(labels, probs, xgb_threshold),
                }

    result = {
        "experiment": "sbms_synthetic_archive_research_only_v1",
        "seed": SEED,
        "dataset": quality,
        "feature_schema": MODEL_FEATURES,
        "feature_schema_notes": {
            "uses_private_metadata": False,
            "uses_fields_not_in_current_app": False,
            "guardian_id_mapping": "Archive guardian_id_no mapped experimentally to app guardian_id by name only; semantic equivalence is unverified.",
            "school_values": "Generated school strings; not application-approved schools or official codes.",
            "excluded_production_features": ["upi_match", "birth_certificate_match"],
            "raw_name_parts": "Concatenated in first/middle/surname order to approximate app full_name.",
        },
        "search": {"method": "8 fixed configurations, chosen by validation average precision then F1@0.5", "candidate_count": len(candidates),
                   "random_seed": SEED, "duration_seconds": round(time.monotonic() - start, 2),
                   "selected_parameters": best_params},
        "results": baselines,
        "review_case_diagnostics": review_diagnostics,
        "challenge_subsets": subset_results,
        "production_integration": "NOT COMPATIBLE / NOT INTEGRATED; active predictor/model/API unchanged.",
        "limitations": [
            "Synthetic case-control prevalence is 25% among non-review pairs; operational precision/PR-AUC will differ.",
            "Challenge subsets overlap the primary test set.",
            "Identity clusters are synthetic, and canonical pairs repeat within partitions.",
            "Archive school values and guardian ID semantics are not verified against real SBMS data.",
            "No real-data validation or uncertainty intervals were available.",
            "The validation set selected hyperparameters and thresholds; the test set was used only after selection.",
        ],
    }
    RESEARCH_ARTIFACTS.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    model_path = RESEARCH_ARTIFACTS / "sbms_dataset_xgb_research_only.joblib"
    joblib.dump(best_model, model_path)
    result["model_artifact"] = {
        "path": str(model_path.relative_to(ROOT)),
        "sha256": _sha256(model_path),
        "bytes": model_path.stat().st_size,
        "version": "sbms_dataset_xgb_research_only_v1",
    }
    (RESEARCH_ARTIFACTS / "feature_schema.json").write_text(json.dumps({"version": 1, "columns": MODEL_FEATURES}, indent=2, allow_nan=False), encoding="utf-8")
    (RESEARCH_ARTIFACTS / "selected_config.json").write_text(json.dumps({"seed": SEED, "parameters": best_params, "validation_threshold": xgb_threshold, "features": MODEL_FEATURES}, indent=2, allow_nan=False), encoding="utf-8")
    (REPORTS / "sbms_dataset_quality.json").write_text(json.dumps(quality, indent=2, allow_nan=False), encoding="utf-8")
    (REPORTS / "sbms_dataset_experiment_metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True, help="Path to the supplied ZIP; read-only input")
    args = parser.parse_args()
    print(json.dumps(run(args.archive), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
