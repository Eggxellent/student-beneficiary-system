"""Audit group, identity, guardian, row, and ordered/unordered pair split isolation.

This is a structural audit only. It reads identifiers and raw pair fields needed to
verify separation, but never loads labels, engineered features, model scores, or test
metrics. Final test labels are opened only by the locked final evaluation run.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd

from feature_engineering import _missing
from generate_realistic_pairs import HOLDOUT_FILE, TRAIN_FILE, VALIDATION_FILE

BASE = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BASE / "evaluation" / "training_integrity_report.json"
PAIR_RECORD_COLUMNS = ("name", "dob", "school", "guardian", "admission_number", "birth_certificate")
STRUCTURAL_COLUMNS = (
    "group_id", "identity_1", "identity_2", "name_1", "name_2", "dob_1", "dob_2",
    "school_1", "school_2", "guardian_1", "guardian_2", "admission_number_1",
    "admission_number_2", "birth_certificate_1", "birth_certificate_2",
)


def person_keys(frame: pd.DataFrame) -> tuple[set[tuple[str, str, str]], int]:
    """Return latent IDs when present, otherwise conservative raw identity keys."""
    keys: set[tuple[str, str, str]] = set()
    unidentifiable = 0
    if {"identity_1", "identity_2"}.issubset(frame.columns):
        for column in ("identity_1", "identity_2"):
            for value in frame[column]:
                if _missing(value):
                    unidentifiable += 1
                else:
                    keys.add((str(value), "", ""))
        return keys, unidentifiable
    for side in ("1", "2"):
        for name, dob, school, admission in zip(
            frame[f"name_{side}"], frame[f"dob_{side}"],
            frame[f"school_{side}"], frame[f"admission_number_{side}"], strict=True,
        ):
            name_key = "" if _missing(name) else re.sub(r"[^a-z]", "", str(name).casefold())
            school_key = "" if _missing(school) else re.sub(r"[^a-z0-9]", "", str(school).casefold())
            admission_key = "" if _missing(admission) else re.sub(r"[^a-z0-9]", "", str(admission).casefold())
            admission_key = f"{school_key}:{admission_key}" if school_key and admission_key else ""
            if name_key or admission_key:
                keys.add((name_key, "" if _missing(dob) else str(dob).strip(), admission_key))
            else:
                unidentifiable += 1
    return keys, unidentifiable


def guardian_keys(frame: pd.DataFrame) -> set[str]:
    return {
        re.sub(r"[^a-z0-9]", "", str(value).casefold())
        for column in ("guardian_1", "guardian_2") for value in frame[column]
        if not _missing(value)
    }


def _value(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip().casefold()


def _pair_record(row, side: str) -> tuple[str, ...]:
    return tuple(_value(getattr(row, f"{column}_{side}")) for column in PAIR_RECORD_COLUMNS)


def directed_pair_keys(frame: pd.DataFrame) -> set[tuple[tuple[str, ...], tuple[str, ...]]]:
    """Fingerprint ordered (A,B) pairs."""
    return {(_pair_record(row, "1"), _pair_record(row, "2")) for row in frame.itertuples(index=False)}


def canonical_pair_keys(frame: pd.DataFrame) -> set[tuple[tuple[str, ...], tuple[str, ...]]]:
    """Fingerprint unordered pairs; this also catches reversed (B,A) records."""
    return {tuple(sorted((_pair_record(row, "1"), _pair_record(row, "2")))) for row in frame.itertuples(index=False)}


def directed_pair_overlap(first: pd.DataFrame, second: pd.DataFrame) -> int:
    return len(directed_pair_keys(first) & directed_pair_keys(second))


def unordered_pair_overlap(first: pd.DataFrame, second: pd.DataFrame) -> int:
    return len(canonical_pair_keys(first) & canonical_pair_keys(second))


def exact_row_overlap(first: pd.DataFrame, second: pd.DataFrame) -> int:
    columns = [column for column in first.columns if column in set(second.columns)]
    return len(set(map(tuple, first[columns].astype(str).to_numpy())) & set(map(tuple, second[columns].astype(str).to_numpy())))


def run_separation_audit() -> dict[str, object]:
    """Compare structural identifiers across all three partitions, without labels."""
    paths = {"training": TRAIN_FILE, "validation": VALIDATION_FILE, "test": HOLDOUT_FILE}
    frames = {name: pd.read_csv(path, usecols=list(STRUCTURAL_COLUMNS)) for name, path in paths.items()}
    groups = {name: set(frame.group_id.dropna().astype(str)) for name, frame in frames.items()}
    people = {name: person_keys(frame)[0] for name, frame in frames.items()}
    guardians = {name: guardian_keys(frame) for name, frame in frames.items()}
    splits = ("training", "validation", "test")
    overlaps: dict[str, dict[str, int]] = {}
    violations: list[str] = []
    for index, left_name in enumerate(splits):
        for right_name in splits[index + 1:]:
            left, right = frames[left_name], frames[right_name]
            name = f"{left_name}_{right_name}"
            counts = {
                "groups": len(groups[left_name] & groups[right_name]),
                "identity_ids": len(people[left_name] & people[right_name]),
                "guardian_clusters": len(guardians[left_name] & guardians[right_name]),
                "identical_rows": exact_row_overlap(left, right),
                "directed_pairs": directed_pair_overlap(left, right),
                "undirected_pairs_including_reversals": unordered_pair_overlap(left, right),
            }
            overlaps[name] = counts
            violations.extend(f"{count} {kind} overlap in {name}" for kind, count in counts.items() if count)
    return {
        "audit_type": "structural-only; labels, features, predictions, and test metrics were not loaded",
        "verdict": "pass" if not violations else "fail",
        "violations": violations,
        "splits": {
            name: {"file": str(paths[name].relative_to(BASE)), "rows": len(frame),
                   "groups": len(groups[name]), "identity_ids": len(people[name]),
                   "guardian_clusters": len(guardians[name])}
            for name, frame in frames.items()
        },
        "pairwise_overlaps": overlaps,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check split isolation without evaluating the sealed test set.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = run_separation_audit()
    print(f"verdict: {report['verdict']} ({report['audit_type']})")
    for pair, counts in report["pairwise_overlaps"].items():
        print(f"{pair}: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    for violation in report["violations"]:
        print(f"VIOLATION: {violation}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"report: {args.output}")
    return 0 if report["verdict"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
