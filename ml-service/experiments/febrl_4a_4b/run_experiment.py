"""Entity-disjoint FEBRL 4A/4B binary pair-classification experiment."""

from __future__ import annotations

import hashlib
import json
import platform
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import jellyfish
import numpy as np
import pandas as pd
import sklearn
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
from sklearn.model_selection import train_test_split


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "outputs"
SEED = 20261022
BLOCK_FIELDS = ("given_name", "surname", "date_of_birth", "soc_sec_id", "postcode", "suburb")
ATTRIBUTE_FIELDS = (
    "given_name", "surname", "street_number", "address_1", "address_2",
    "suburb", "postcode", "state", "date_of_birth", "soc_sec_id",
)
ID_PATTERN = re.compile(r"rec-(\d+)-(org|dup-0)\Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def load_records(filename: str, suffix: str) -> pd.DataFrame:
    frame = pd.read_csv(DATA_DIR / filename, dtype=str, keep_default_na=False, skipinitialspace=True)
    frame.columns = [column.strip() for column in frame.columns]
    required = {"rec_id", *ATTRIBUTE_FIELDS}
    if set(frame.columns) != required:
        raise ValueError(f"Unexpected columns in {filename}: {frame.columns.tolist()}")
    parsed = frame["rec_id"].str.fullmatch(ID_PATTERN)
    if not parsed.all():
        raise ValueError(f"Malformed record IDs in {filename}")
    groups = frame["rec_id"].str.extract(ID_PATTERN)[0]
    id_suffix = frame["rec_id"].str.extract(ID_PATTERN)[1]
    if not id_suffix.eq(suffix).all() or groups.duplicated().any():
        raise ValueError(f"Unexpected or repeated entity IDs in {filename}")
    frame["_entity"] = groups.astype(int)
    for column in ATTRIBUTE_FIELDS:
        frame[column] = frame[column].map(lambda x: str(x).strip())
    return frame


def split_entities(entity_ids: list[int]) -> dict[str, set[int]]:
    train_entities, remainder = train_test_split(
        entity_ids, test_size=0.30, random_state=SEED, shuffle=True
    )
    validation_entities, test_entities = train_test_split(
        remainder, test_size=0.50, random_state=SEED, shuffle=True
    )
    result = {
        "train": set(train_entities),
        "validation": set(validation_entities),
        "test": set(test_entities),
    }
    if any(result[a] & result[b] for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))):
        raise AssertionError("Entity leakage across partitions")
    return result


def make_block_index(right: pd.DataFrame) -> dict[str, dict[str, set[str]]]:
    index: dict[str, dict[str, set[str]]] = {}
    for field in BLOCK_FIELDS:
        value_map: dict[str, set[str]] = defaultdict(set)
        for row in right[["rec_id", field]].itertuples(index=False, name=None):
            normalized = normalize(row[1])
            if normalized:
                value_map[normalized].add(row[0])
        index[field] = value_map
    return index


def pair_features(left: pd.Series, right: pd.Series) -> dict[str, float | int]:
    features: dict[str, float | int] = {}
    for field in ATTRIBUTE_FIELDS:
        first, second = normalize(left[field]), normalize(right[field])
        features[f"{field}_jaro_winkler"] = (
            float(jellyfish.jaro_winkler_similarity(first, second)) if first and second else 0.0
        )
        features[f"{field}_exact"] = int(bool(first) and first == second)
        features[f"{field}_both_missing"] = int(not first and not second)
        features[f"{field}_one_missing"] = int(bool(first) != bool(second))
    return features


def build_partition_pairs(left: pd.DataFrame, right: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    """Score every cross-file pair sharing >=1 exact normalized blocking value."""
    index = make_block_index(right)
    left_by_id = {row["rec_id"]: row for _, row in left.iterrows()}
    right_by_id = {row["rec_id"]: row for _, row in right.iterrows()}
    rows: list[dict[str, float | int]] = []
    candidate_pairs: set[tuple[str, str]] = set()
    for _, left_row in left.iterrows():
        candidates: set[str] = set()
        for field in BLOCK_FIELDS:
            key = normalize(left_row[field])
            if key:
                candidates.update(index[field].get(key, ()))
        for right_id in candidates:
            candidate_pairs.add((left_row["rec_id"], right_id))

    positive_candidates = 0
    positive_links = len(left)
    for left_id, right_id in sorted(candidate_pairs):
        left_row = left_by_id[left_id]
        right_row = right_by_id[right_id]
        label = int(left_row["_entity"] == right_row["_entity"])
        positive_candidates += label
        rows.append({**pair_features(left_row, right_row), "label": label})

    result = pd.DataFrame(rows)
    if result.empty or result["label"].nunique() != 2:
        raise ValueError("Candidate generation must yield both classes")
    counts = {
        "entities": int(left["_entity"].nunique()),
        "records_4a": int(len(left)),
        "records_4b": int(len(right)),
        "all_possible_cross_pairs": int(len(left) * len(right)),
        "candidate_pairs": int(len(result)),
        "positive_candidates": int(result["label"].sum()),
        "negative_candidates": int(len(result) - result["label"].sum()),
        "positive_links_in_partition": int(positive_links),
        "blocking_candidate_recall": float(positive_candidates / positive_links),
    }
    return result, counts


def choose_f1_threshold(y_true: np.ndarray, scores: np.ndarray) -> tuple[float, float]:
    precision, recall, thresholds = precision_recall_curve(y_true, scores)
    if not len(thresholds):
        raise ValueError("Cannot select threshold without validation score variation")
    f1 = 2 * precision[:-1] * recall[:-1] / np.maximum(precision[:-1] + recall[:-1], 1e-15)
    best = np.flatnonzero(np.isclose(f1, f1.max()))
    # A higher threshold wins exact ties, favoring fewer manual-review alerts.
    chosen = int(best[-1])
    return float(thresholds[chosen]), float(f1[chosen])


def evaluate(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, object]:
    prediction = scores >= threshold
    tn, fp, fn, tp = confusion_matrix(y_true, prediction, labels=[0, 1]).ravel()
    return {
        "accuracy": float(accuracy_score(y_true, prediction)),
        "precision": float(precision_score(y_true, prediction, zero_division=0)),
        "recall": float(recall_score(y_true, prediction, zero_division=0)),
        "f1": float(f1_score(y_true, prediction, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, scores)),
        "pr_auc_average_precision": float(average_precision_score(y_true, scores)),
        "threshold": float(threshold),
        "confusion_matrix": {"true_negative": int(tn), "false_positive": int(fp), "false_negative": int(fn), "true_positive": int(tp)},
        "positive_count": int(np.sum(y_true == 1)),
        "negative_count": int(np.sum(y_true == 0)),
    }


def dataset_description(a: pd.DataFrame, b: pd.DataFrame) -> dict[str, object]:
    info: dict[str, object] = {}
    for name, frame, file in (("4A", a, DATA_DIR / "dataset4a.csv"), ("4B", b, DATA_DIR / "dataset4b.csv")):
        raw = pd.read_csv(file, dtype=str, keep_default_na=False, skipinitialspace=True)
        raw.columns = raw.columns.str.strip()
        info[name] = {
            "records": int(len(raw)),
            "columns": raw.columns.tolist(),
            "inferred_pandas_types": {c: str(raw[c].dtype) for c in raw.columns},
            "experiment_load_types": "all columns loaded as strings to preserve leading zeroes and treat empty cells consistently",
            "missing_by_column": {c: int(raw[c].map(lambda x: not str(x).strip()).sum()) for c in raw.columns},
            "duplicate_full_rows": int(raw.duplicated().sum()),
            "duplicate_record_ids": int(raw["rec_id"].duplicated().sum()),
            "entity_ids": int(frame["_entity"].nunique()),
            "sha256": sha256(file),
        }
    return info


def main() -> None:
    a = load_records("dataset4a.csv", "org")
    b = load_records("dataset4b.csv", "dup-0")
    if set(a["_entity"]) != set(b["_entity"]):
        raise ValueError("4A/4B entity IDs do not form the documented one-to-one links")
    if len(a) != 5000 or len(b) != 5000:
        raise ValueError("Unexpected FEBRL 4A/4B record counts")

    split = split_entities(sorted(a["_entity"].unique().tolist()))
    pair_sets: dict[str, pd.DataFrame] = {}
    split_stats: dict[str, dict[str, object]] = {}
    for name, entities in split.items():
        left = a[a["_entity"].isin(entities)].copy()
        right = b[b["_entity"].isin(entities)].copy()
        pairs, counts = build_partition_pairs(left, right)
        pair_sets[name] = pairs
        split_stats[name] = {
            **counts,
            "entity_proportion": float(len(entities) / len(a["_entity"].unique())),
            "positive_proportion_of_candidates": float(pairs["label"].mean()),
            "entity_ids_sha256": hashlib.sha256(",".join(map(str, sorted(entities))).encode()).hexdigest(),
        }

    feature_columns = [c for c in pair_sets["train"].columns if c != "label"]
    if any(column in feature_columns for column in ("rec_id", "_entity", "label")):
        raise AssertionError("An identifier or target entered model features")

    params = {
        "n_estimators": 300,
        "criterion": "gini",
        "max_depth": None,
        "min_samples_split": 2,
        "min_samples_leaf": 2,
        "max_features": "sqrt",
        "class_weight": "balanced_subsample",
        "random_state": SEED,
        "n_jobs": -1,
    }
    model = RandomForestClassifier(**params)
    train_x, train_y = pair_sets["train"][feature_columns], pair_sets["train"]["label"].to_numpy()
    validation_x, validation_y = pair_sets["validation"][feature_columns], pair_sets["validation"]["label"].to_numpy()
    test_x, test_y = pair_sets["test"][feature_columns], pair_sets["test"]["label"].to_numpy()
    train_start = time.perf_counter()
    model.fit(train_x, train_y)
    training_seconds = time.perf_counter() - train_start

    validation_scores = model.predict_proba(validation_x)[:, 1]
    threshold, validation_f1 = choose_f1_threshold(validation_y, validation_scores)
    test_start = time.perf_counter()
    test_scores = model.predict_proba(test_x)[:, 1]
    inference_seconds = time.perf_counter() - test_start
    test_metrics = evaluate(test_y, test_scores, threshold)
    test_metrics["model_recall_times_blocking_candidate_recall"] = float(
        test_metrics["recall"] * split_stats["test"]["blocking_candidate_recall"]
    )
    exact_feature_diagnostics = {}
    test_pairs = pair_sets["test"]
    for field in ATTRIBUTE_FIELDS:
        exact_column = f"{field}_exact"
        exact_rows = test_pairs[test_pairs[exact_column] == 1]
        exact_feature_diagnostics[field] = {
            "positive_agreement_rate": float(test_pairs.loc[test_pairs.label == 1, exact_column].mean()),
            "negative_agreement_rate": float(test_pairs.loc[test_pairs.label == 0, exact_column].mean()),
            "positive_fraction_when_exact_agreement": float(exact_rows.label.mean()) if len(exact_rows) else None,
            "exact_agreement_candidate_count": int(len(exact_rows)),
        }
    feature_importances = sorted(
        ({"feature": name, "importance": float(value)} for name, value in zip(feature_columns, model.feature_importances_)),
        key=lambda item: item["importance"], reverse=True,
    )
    overlap_counts = {
        "train_validation": len(split["train"] & split["validation"]),
        "train_test": len(split["train"] & split["test"]),
        "validation_test": len(split["validation"] & split["test"]),
    }
    if any(overlap_counts.values()):
        raise AssertionError(f"Entity leakage detected: {overlap_counts}")

    metadata_file = ROOT / "dataset_metadata.json"
    metadata = json.loads(metadata_file.read_text(encoding="utf-8")) if metadata_file.exists() else {}
    results = {
        "experiment": "FEBRL 4A/4B fresh entity-disjoint Random Forest pair classifier",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "branch_expected": "experiment/raw-pair-model-training",
        "seed": SEED,
        "dataset": dataset_description(a, b),
        "dataset_source_metadata": metadata,
        "ground_truth": "Entity key parsed from documented rec-<integer>-org and rec-<integer>-dup-0 IDs; IDs are used only for labels and grouped splitting.",
        "split": {"method": "group split on entity IDs before candidate-pair construction", "requested_ratio": "70/15/15", "seed": SEED, "partitions": split_stats, "entity_overlap": overlap_counts},
        "candidate_generation": {
            "method": "Cross-file union of exact normalized-value blocks on given_name, surname, date_of_birth, soc_sec_id, postcode, or suburb; all candidates are retained. No all-pairs Cartesian expansion.",
            "normalization": "casefold and retain ASCII letters and digits; empty values do not block",
            "positive_pairs_are_not_injected": True,
            "limitation": "Evaluation covers candidate pairs admitted by this blocker. Blocking recall is reported separately; model recall multiplied by test blocking recall approximates end-to-end recall on FEBRL links.",
        },
        "model": {"name": "sklearn.ensemble.RandomForestClassifier", "parameters": params, "class_balance": "balanced_subsample class weights; no resampling", "training_seconds": training_seconds, "test_prediction_seconds": inference_seconds},
        "features": {"columns": feature_columns, "count": len(feature_columns), "definitions": "Per available person attribute: normalized Jaro-Winkler similarity, exact normalized agreement, both-missing indicator, and one-missing indicator.", "attributes": list(ATTRIBUTE_FIELDS), "excluded": ["rec_id", "numeric entity key", "row order", "target label", "filenames"]},
        "preprocessing": "Deterministic pairwise normalization/similarity only; no learned imputation, scaling, encoding, selection, or transformation fitted on validation/test.",
        "threshold_selection": {"method": "maximize validation-set F1 over thresholds returned by precision_recall_curve; choose the highest threshold among tied maxima", "threshold": threshold, "validation_f1_at_selected_threshold": validation_f1},
        "test_metrics": test_metrics,
        "test_exact_agreement_diagnostics": exact_feature_diagnostics,
        "model_feature_importances": feature_importances,
        "software": {"python": platform.python_version(), "pandas": pd.__version__, "scikit_learn": sklearn.__version__, "jellyfish": getattr(jellyfish, "__version__", "unknown")},
        "validity": {"fresh_fit": True, "existing_model_loaded": False, "test_used_for_fit_or_threshold": False, "same_entity_cross_partition": False, "synthetic_data": True, "real_world_accuracy_claim": False},
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    write_report(results)
    print(json.dumps({"split": split_stats, "threshold": threshold, "test_metrics": test_metrics}, indent=2))


def write_report(result: dict[str, object]) -> None:
    stats = result["split"]["partitions"]
    metrics = result["test_metrics"]
    lines = [
        "# FEBRL 4A/4B independent pair-classification experiment",
        "",
        "> FEBRL is synthetic. These results do not establish accuracy on Kenyan beneficiary records.",
        "",
        "## Dataset and labels",
        "",
        "The experiment uses FEBRL 4A originals and 4B corrupted copies. The documented numeric portion of `rec_id` supplies the shared entity key. That key is used only to label pairs and split entities; it is excluded from model inputs.",
        "",
        f"Dataset source: [{result['dataset_source_metadata'].get('source_repository', 'Record Linkage Toolkit repository')}]({result['dataset_source_metadata'].get('source_repository', 'https://github.com/J535D165/recordlinkage')}). Files and SHA-256 hashes are recorded in `dataset_metadata.json`.",
        "",
        "## Entity split and candidate generation",
        "",
        "Entities were split 70/15/15 (train/validation/test; seed 20261022) before pairs were built. All cross-file candidates sharing an exact normalized value on at least one of given name, surname, date of birth, social security ID, postcode, or suburb were retained. There is no cross-partition pairing.",
        "",
        "| Partition | Entities | 4A records | 4B records | Candidate pairs | Positive | Negative | Blocking recall |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in ("train", "validation", "test"):
        s = stats[name]
        lines.append(f"| {name} | {s['entities']} | {s['records_4a']} | {s['records_4b']} | {s['candidate_pairs']} | {s['positive_candidates']} | {s['negative_candidates']} | {s['blocking_candidate_recall']:.4f} |")
    lines += [
        "",
        "## Model and evaluation",
        "",
        "Fresh `RandomForestClassifier` with 300 trees, Gini criterion, unlimited depth, minimum leaf size 2, sqrt feature sampling, balanced-sub-sample class weights, and seed 20261022. No resampling or existing model was used. Threshold was chosen on validation by maximum F1; ties select the higher threshold.",
        "",
        f"Test decision threshold: **{metrics['threshold']:.6f}**. Candidate-set class counts: {metrics['positive_count']} positive and {metrics['negative_count']} negative.",
        "",
        "| Metric | Test result |",
        "|---|---:|",
    ]
    for key in ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc_average_precision"):
        lines.append(f"| {key} | {metrics[key]:.4f} |")
    cm = metrics["confusion_matrix"]
    lines += [
        "",
        f"Confusion matrix: TN {cm['true_negative']}, FP {cm['false_positive']}, FN {cm['false_negative']}, TP {cm['true_positive']}.",
        f"Test blocking candidate recall: {stats['test']['blocking_candidate_recall']:.4f}; classifier recall among admitted candidates: {metrics['recall']:.4f}; their product is {metrics['model_recall_times_blocking_candidate_recall']:.4f} as an approximate end-to-end recall over true FEBRL links.",
        "",
        "A false positive is a different synthetic person pair flagged for review; a false negative is a true pair missed among generated candidates. Blocking misses are separately reflected in blocking recall. Precision is conditional on this candidate-generation strategy and must not be read as deployment precision at another pair prevalence.",
        "",
        "The very high results were investigated. The exact-agreement diagnostics and feature importances in `results.json` show how strongly particular synthetic attributes separate candidates. In this FEBRL test candidate set, some exact address and social-security-ID agreements occurred only on true links; this is an inherent property of this synthetic sample and increases separability. It is not a Kenyan deployment estimate or evidence that such fields are equally reliable in SBMS.",
        "",
        "## Features and limits",
        "",
        "For each of the ten available attributes (given name, surname, street number, address fields 1 and 2, suburb, postcode, state, date of birth, social security ID), features are normalized Jaro-Winkler similarity, exact normalized agreement, both-missing, and one-missing indicators. Identifiers and ground truth do not enter features. No SBMS-specific school, guardian, UPI, or birth-certificate fields exist in FEBRL. FEBRL is fictitious Australian-style person data, not Kenyan beneficiary data; production use would require authorized, representative Kenyan data and independent validation, including candidate recall and human-review outcomes.",
        "",
        "## Reproduction",
        "",
        "From the repository root, run `python ml-service/experiments/febrl_4a_4b/download_data.py` and then `python ml-service/experiments/febrl_4a_4b/run_experiment.py`. Exact dependency versions are in `requirements.txt`.",
        "",
    ]
    (OUTPUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
