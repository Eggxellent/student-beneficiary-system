"""Data preparation helpers for the isolated FEBRL 4A/4B experiment."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Iterable

import jellyfish
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PREPARED_DIR = ROOT / "prepared"
ARTIFACTS_DIR = ROOT / "artifacts"
SEED = 20261022
SPLIT_RATIOS = {"train": 0.70, "validation": 0.15, "test": 0.15}
ATTRIBUTES = (
    "given_name", "surname", "street_number", "address_1", "address_2",
    "suburb", "postcode", "state", "date_of_birth", "soc_sec_id",
)
STRING_ATTRIBUTES = ("given_name", "surname", "address_1", "address_2", "suburb")
EXACT_ATTRIBUTES = ("street_number", "postcode", "state", "date_of_birth", "soc_sec_id")
BLOCK_FIELDS = ("given_name", "surname", "date_of_birth", "postcode", "soc_sec_id")
FEATURE_COLUMNS = tuple(
    [f"{name}_jaro_winkler" for name in STRING_ATTRIBUTES]
    + [f"{name}_exact" for name in EXACT_ATTRIBUTES]
    + [f"{name}_{flag}" for name in ATTRIBUTES for flag in ("both_missing", "one_missing")]
)
SOURCE_URLS = {
    "dataset4a.csv": "https://raw.githubusercontent.com/J535D165/recordlinkage/v0.16/recordlinkage/datasets/febrl/dataset4a.csv",
    "dataset4b.csv": "https://raw.githubusercontent.com/J535D165/recordlinkage/v0.16/recordlinkage/datasets/febrl/dataset4b.csv",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: object) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = unicodedata.normalize("NFKC", str(value)).casefold().strip()
    text = " ".join(text.split())
    return text or None


def entity_id(record_id: object, dataset: str) -> int:
    """Read the documented FEBRL link key from rec_id; never use row order."""
    value = str(record_id)
    pattern = r"rec-(\d+)-org" if dataset == "4a" else r"rec-(\d+)-dup-0"
    match = re.fullmatch(pattern, value)
    if match is None:
        raise ValueError(f"Unexpected FEBRL {dataset.upper()} record identifier: {value!r}")
    return int(match.group(1))


def load_sources(data_dir: Path = DATA_DIR) -> tuple[pd.DataFrame, pd.DataFrame]:
    paths = (data_dir / "dataset4a.csv", data_dir / "dataset4b.csv")
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Missing {path}; run download_data.py first.")
    a = pd.read_csv(paths[0], index_col="rec_id", dtype="string", skipinitialspace=True)
    b = pd.read_csv(paths[1], index_col="rec_id", dtype="string", skipinitialspace=True)
    for name, frame in (("4a", a), ("4b", b)):
        if frame.index.has_duplicates:
            raise ValueError(f"FEBRL {name.upper()} contains repeated record IDs.")
        if set(frame.columns) != set(ATTRIBUTES):
            raise ValueError(f"Unexpected columns in FEBRL {name.upper()}: {list(frame.columns)}")
        frame["_entity_id"] = [entity_id(record_id, name) for record_id in frame.index]
    ids_a, ids_b = set(a["_entity_id"]), set(b["_entity_id"])
    if len(ids_a) != 5_000 or ids_a != ids_b:
        raise ValueError("FEBRL 4A and 4B must contain the same 5,000 unique entity IDs.")
    if len(a) != 5_000 or len(b) != 5_000:
        raise ValueError("Expected 5,000 rows in each official FEBRL 4 file.")
    return a, b


def source_profile(frame: pd.DataFrame) -> dict[str, object]:
    return {
        "row_count": int(len(frame)),
        "columns": [name for name in frame.columns if name != "_entity_id"],
        "dtypes": {name: str(dtype) for name, dtype in frame.drop(columns="_entity_id").dtypes.items()},
        "missing_values": {
            name: int(count)
            for name, count in frame.drop(columns="_entity_id").isna().sum().items()
        },
        "record_id_count": int(frame.index.nunique()),
        "entity_id_count": int(frame["_entity_id"].nunique()),
    }


def ground_truth_links(a: pd.DataFrame, b: pd.DataFrame) -> set[tuple[str, str]]:
    """Return documented 4A-original to 4B-duplicate links from rec_id keys."""
    b_ids = {int(row["_entity_id"]): record_id for record_id, row in b.iterrows()}
    links = {
        (record_id, b_ids[int(row["_entity_id"])])
        for record_id, row in a.iterrows()
    }
    if len(links) != 5_000:
        raise ValueError("Ground-truth link construction did not produce 5,000 unique links.")
    return links


def split_entities(entities: Iterable[int], seed: int = SEED) -> dict[str, set[int]]:
    ordered = np.asarray(sorted(set(int(value) for value in entities)), dtype=np.int64)
    if len(ordered) < 3:
        raise ValueError("At least three entities are required for train/validation/test splits.")
    np.random.default_rng(seed).shuffle(ordered)
    train_count = int(len(ordered) * SPLIT_RATIOS["train"])
    validation_count = int(len(ordered) * SPLIT_RATIOS["validation"])
    splits = {
        "train": set(ordered[:train_count].tolist()),
        "validation": set(ordered[train_count:train_count + validation_count].tolist()),
        "test": set(ordered[train_count + validation_count:].tolist()),
    }
    if set.union(*splits.values()) != set(ordered.tolist()):
        raise RuntimeError("Entity partitioning lost or duplicated source entities.")
    if any(
        splits[left] & splits[right]
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    ):
        raise RuntimeError("Entity overlap detected in the prepared partitions.")
    return splits


def blocked_pairs(a: pd.DataFrame, b: pd.DataFrame) -> set[tuple[str, str]]:
    """Union of exact, nonmissing blocks; labels are not consulted here."""
    pairs: set[tuple[str, str]] = set()
    for column in BLOCK_FIELDS:
        left_blocks: dict[str, list[str]] = {}
        right_blocks: dict[str, list[str]] = {}
        for record_id, value in a[column].items():
            key = normalize(value)
            if key is not None:
                left_blocks.setdefault(key, []).append(str(record_id))
        for record_id, value in b[column].items():
            key = normalize(value)
            if key is not None:
                right_blocks.setdefault(key, []).append(str(record_id))
        for key in left_blocks.keys() & right_blocks.keys():
            for left_id in left_blocks[key]:
                for right_id in right_blocks[key]:
                    pairs.add((left_id, right_id))
    return pairs


def pair_features(left: pd.Series, right: pd.Series) -> dict[str, float | int]:
    features: dict[str, float | int] = {}
    left_values = {name: normalize(left[name]) for name in ATTRIBUTES}
    right_values = {name: normalize(right[name]) for name in ATTRIBUTES}
    for name in STRING_ATTRIBUTES:
        first, second = left_values[name], right_values[name]
        features[f"{name}_jaro_winkler"] = (
            float(jellyfish.jaro_winkler_similarity(first, second))
            if first is not None and second is not None else 0.0
        )
    for name in EXACT_ATTRIBUTES:
        first, second = left_values[name], right_values[name]
        features[f"{name}_exact"] = int(first is not None and second is not None and first == second)
    for name in ATTRIBUTES:
        first_missing, second_missing = left_values[name] is None, right_values[name] is None
        features[f"{name}_both_missing"] = int(first_missing and second_missing)
        features[f"{name}_one_missing"] = int(first_missing != second_missing)
    return features


def prepare_partitions(data_dir: Path = DATA_DIR, seed: int = SEED) -> tuple[dict[str, pd.DataFrame], dict[str, object]]:
    a, b = load_sources(data_dir)
    links = ground_truth_links(a, b)
    entity_splits = split_entities(a["_entity_id"], seed)
    a_ids = {name: set(a.index[a["_entity_id"].isin(ids)].astype(str)) for name, ids in entity_splits.items()}
    b_ids = {name: set(b.index[b["_entity_id"].isin(ids)].astype(str)) for name, ids in entity_splits.items()}

    entity_overlap = {
        f"{left}_{right}": len(entity_splits[left] & entity_splits[right])
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    }
    record_overlap = {
        f"{left}_{right}": len((a_ids[left] | b_ids[left]) & (a_ids[right] | b_ids[right]))
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    }
    if any(entity_overlap.values()) or any(record_overlap.values()):
        raise RuntimeError("Entity or source record overlap found across partitions.")

    data_frames: dict[str, pd.DataFrame] = {}
    split_counts: dict[str, object] = {}
    total_possible = len(a) * len(b)
    within_partition_possible = 0
    for name, ids in entity_splits.items():
        left = a[a["_entity_id"].isin(ids)]
        right = b[b["_entity_id"].isin(ids)]
        possible = len(left) * len(right)
        within_partition_possible += possible
        pairs = blocked_pairs(left, right)
        partition_links = {(left_id, right_id) for left_id, right_id in links if left_id in left.index and right_id in right.index}
        candidate_true_links = pairs & partition_links
        records = []
        for left_id, right_id in sorted(pairs):
            records.append({**pair_features(left.loc[left_id], right.loc[right_id]), "label": int((left_id, right_id) in links)})
        pair_data = pd.DataFrame.from_records(records, columns=[*FEATURE_COLUMNS, "label"])
        if pair_data.empty or pair_data.label.nunique() != 2:
            raise ValueError(f"{name} candidate set must contain positive and negative pairs.")
        data_frames[name] = pair_data
        split_counts[name] = {
            "entity_count": len(ids),
            "record_count_4a": len(left),
            "record_count_4b": len(right),
            "all_within_partition_pairs": possible,
            "candidate_pairs_after_blocking": len(pairs),
            "candidate_positive_pairs": int(pair_data.label.sum()),
            "candidate_negative_pairs": int((pair_data.label == 0).sum()),
            "ground_truth_positive_pairs": len(partition_links),
            "blocking_positive_recall": len(candidate_true_links) / len(partition_links),
            "positive_pairs_omitted_by_blocking": len(partition_links - pairs),
        }

    report = {
        "seed": seed,
        "split_entity_counts": {name: len(ids) for name, ids in entity_splits.items()},
        "split_proportions": {name: len(ids) / len(a) for name, ids in entity_splits.items()},
        "entity_overlap_counts": entity_overlap,
        "source_record_overlap_counts": record_overlap,
        "total_possible_cross_dataset_pairs": total_possible,
        "within_partition_possible_pairs": within_partition_possible,
        "cross_partition_pairs_not_generated": total_possible - within_partition_possible,
        "splits": split_counts,
        "blocking_fields": list(BLOCK_FIELDS),
        "ground_truth_link_count": len(links),
        "feature_columns": list(FEATURE_COLUMNS),
    }
    return data_frames, report


def manifest_data_profile(data_dir: Path = DATA_DIR) -> dict[str, object]:
    a, b = load_sources(data_dir)
    source_files = {}
    for filename, frame in (("dataset4a.csv", a), ("dataset4b.csv", b)):
        path = data_dir / filename
        source_files[filename] = {
            "url": SOURCE_URLS[filename],
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "row_count": len(frame),
        }
    return {
        "dataset": "FEBRL 4A and 4B",
        "benchmark_type": "synthetic person-record linkage benchmark; not Kenyan beneficiary data",
        "source_files": source_files,
        "dataset4a_profile": source_profile(a),
        "dataset4b_profile": source_profile(b),
        "ground_truth": {
            "method": "The official load_febrl4(return_links=True) API returns rec-i-org to rec-i-dup-0 links. We parse and validate those documented IDs; pair labels are never inferred from row positions.",
            "link_count": len(ground_truth_links(a, b)),
        },
    }


def save_prepared(seed: int = SEED) -> dict[str, object]:
    data_frames, split_report = prepare_partitions(seed=seed)
    PREPARED_DIR.mkdir(parents=True, exist_ok=True)
    for name, frame in data_frames.items():
        frame.to_csv(PREPARED_DIR / f"{name}.csv", index=False)
    report = {
        "source_profile": manifest_data_profile(),
        "pair_preparation": split_report,
    }
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS_DIR / "preparation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
