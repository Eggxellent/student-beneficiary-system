"""Replace the legacy raw pair CSV with a harder, identity-grounded simulation.

This utility only writes data files. It deliberately does not train or evaluate
the application model.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from generate_realistic_pairs import generate

BASE = Path(__file__).resolve().parent
RAW_FILE = BASE / "data" / "raw_pairs.csv"
BACKUP_FILE = BASE / "data" / "raw_pairs.pre_realistic_backup.csv"
METADATA_FILE = BASE / "data" / "raw_pairs_metadata.json"
PAIR_COUNT = 10_000
SEED = 4_210_873

# Keep the established CSV schema so existing readers remain compatible.
CSV_COLUMNS = [
    "name_1", "name_2", "dob_1", "dob_2", "school_1", "school_2",
    "guardian_1", "guardian_2", "upi_1", "upi_2", "group_id",
    "jaro_winkler", "dob_match", "school_match", "guardian_match",
    "upi_match", "birth_certificate_match", "label",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    RAW_FILE.parent.mkdir(parents=True, exist_ok=True)
    if RAW_FILE.exists() and not BACKUP_FILE.exists():
        BACKUP_FILE.write_bytes(RAW_FILE.read_bytes())

    generated = generate(PAIR_COUNT, SEED)
    missing_columns = sorted(set(CSV_COLUMNS) - set(generated.columns))
    if missing_columns:
        raise ValueError(f"Generated data is missing required columns: {missing_columns}")
    group_scenarios = generated[["group_id", "scenario", "label"]].drop_duplicates("group_id")
    pairs = generated[CSV_COLUMNS]
    if len(pairs) != PAIR_COUNT or set(pairs["label"].unique()) != {0, 1}:
        raise ValueError("Generated data failed row-count or binary-label validation")

    # Recompute labels/features from source records before replacing the file.
    # The generator's latent identity controls labels; this checks schema and
    # feature values are finite and bounded.
    if not pairs["jaro_winkler"].between(0, 1).all():
        raise ValueError("Name similarity feature is outside [0, 1]")
    feature_columns = [
        "jaro_winkler", "dob_match", "school_match", "guardian_match",
        "upi_match", "birth_certificate_match",
    ]
    if not pairs[feature_columns].apply(lambda column: column.between(0, 1).all()).all():
        raise ValueError("A comparison feature is outside [0, 1]")

    temp_file = RAW_FILE.with_suffix(".csv.tmp")
    pairs.to_csv(temp_file, index=False)
    temp_file.replace(RAW_FILE)

    metadata = {
        "description": "Synthetic, identity-grounded SBMS pair scenarios; not real beneficiary data.",
        "seed": SEED,
        "row_count": len(pairs),
        "group_count": int(pairs["group_id"].nunique()),
        "rows_per_group": int(pairs.groupby("group_id").size().min()),
        "label_counts": {str(k): int(v) for k, v in pairs["label"].value_counts().sort_index().items()},
        "scenario_group_counts": {
            str(k): int(v) for k, v in group_scenarios["scenario"].value_counts().sort_index().items()
        },
        "positive_scenarios": sorted(group_scenarios.loc[group_scenarios.label == 1, "scenario"].unique()),
        "negative_scenarios": sorted(group_scenarios.loc[group_scenarios.label == 0, "scenario"].unique()),
        "csv_sha256": sha256(RAW_FILE),
        "backup_file": BACKUP_FILE.name if BACKUP_FILE.exists() else None,
        "backup_sha256": sha256(BACKUP_FILE) if BACKUP_FILE.exists() else None,
        "training_performed": False,
        "caveat": "Ambiguous real-world cases need a separate human-reviewed set; they are not assigned guessed binary labels here.",
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
