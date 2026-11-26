"""Validate and optionally integrate artifacts exported by the SBMS Colab notebook.

Run from ml-service with the project's Python environment:

    python integrate_colab_artifacts.py --artifacts <downloaded-colab-output>
    python integrate_colab_artifacts.py --artifacts <downloaded-colab-output> --apply

Validation is the default. --apply preserves every existing destination file under
integration_backups/<timestamp>/ before copying the passing Colab evidence/model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib

BASE = Path(__file__).resolve().parent
EXPECTED_FEATURES = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "admission_number_match",
    "birth_certificate_match",
]
REQUIRED_FILES = [
    "model/xgb_duplicate_model.joblib",
    "model/xgb_duplicate_model.metadata.json",
    "training/realistic_pairs_train.csv",
    "evaluation/realistic_pairs_validation.csv",
    "evaluation/realistic_pairs_holdout.csv",
    "evaluation/realistic_pairs_xgboost_training_metrics.json",
    "evaluation/training_integrity_report.json",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, object]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot read valid JSON from {path}: {error}") from error


def validate(artifacts: Path) -> tuple[dict[str, object], list[str]]:
    missing = [name for name in REQUIRED_FILES if not (artifacts / name).is_file()]
    if missing:
        raise ValueError("Colab output is missing: " + ", ".join(missing))

    metadata = read_json(artifacts / "model/xgb_duplicate_model.metadata.json")
    metrics = read_json(artifacts / "evaluation/realistic_pairs_xgboost_training_metrics.json")
    audit = read_json(artifacts / "evaluation/training_integrity_report.json")
    model_path = artifacts / "model/xgb_duplicate_model.joblib"
    model_hash = sha256(model_path)

    if audit.get("verdict") != "pass":
        raise ValueError(f"Colab integrity audit did not pass: {audit.get('violations', [])}")
    if metadata.get("feature_columns") != EXPECTED_FEATURES:
        raise ValueError(f"Unexpected model feature schema: {metadata.get('feature_columns')}")
    if metrics.get("feature_columns") != EXPECTED_FEATURES:
        raise ValueError(f"Metrics report uses a different feature schema: {metrics.get('feature_columns')}")
    if metadata.get("model_sha256") != model_hash:
        raise ValueError("Model SHA-256 does not match its metadata")
    if metrics.get("deployed_model_sha256") != model_hash:
        raise ValueError("Model SHA-256 does not match the training metrics report")
    if audit.get("provenance", {}).get("artifact_sha256") != model_hash:
        raise ValueError("Model SHA-256 does not match the integrity report")
    if audit.get("provenance", {}).get("artifact_matches_metrics_report") is not True:
        raise ValueError("Integrity report says the model and metrics report differ")
    if metrics.get("holdout_used_for_training_or_tuning") is not False:
        raise ValueError("Holdout is not declared as excluded from training and tuning")

    data_hash_fields = {
        "training/realistic_pairs_train.csv": "training_sha256",
        "evaluation/realistic_pairs_validation.csv": "validation_sha256",
        "evaluation/realistic_pairs_holdout.csv": "holdout_sha256",
    }
    for relative, field in data_hash_fields.items():
        if sha256(artifacts / relative) != metadata.get(field):
            raise ValueError(f"Dataset hash does not match metadata: {relative}")
        if sha256(artifacts / relative) != metrics.get(field):
            raise ValueError(f"Dataset hash does not match metrics report: {relative}")

    provenance = metadata.get("dataset_provenance", {})
    generator = BASE / "generate_realistic_pairs.py"
    if provenance.get("generator_sha256") != sha256(generator):
        raise ValueError("Colab used a different dataset generator than this local checkout")

    sys.path.insert(0, str(BASE))
    from predict import verify_model_schema

    try:
        model = joblib.load(model_path)
        verify_model_schema(model, model_path)
    except Exception as error:
        raise ValueError(f"Colab model cannot be loaded with the expected schema: {error}") from error

    return metadata, REQUIRED_FILES.copy()


def integrate(artifacts: Path, files: list[str]) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_root = BASE / "integration_backups" / stamp
    for relative in files:
        destination = BASE / relative
        if destination.is_file():
            backup = backup_root / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, backup)
    for relative in files:
        destination = BASE / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(artifacts / relative, destination)

    sys.path.insert(0, str(BASE))
    from predict import load_model

    load_model()
    return backup_root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True, type=Path, help="Extracted Colab output folder")
    parser.add_argument("--apply", action="store_true", help="Back up and copy validated artifacts into ml-service")
    arguments = parser.parse_args()
    artifacts = arguments.artifacts.resolve()

    try:
        metadata, files = validate(artifacts)
    except ValueError as error:
        print(f"REJECTED: {error}", file=sys.stderr)
        return 1

    print("Colab model, schema, dataset hashes, and integrity audit all validate.")
    print(f"Feature schema: {', '.join(EXPECTED_FEATURES)}")
    print(f"Validation-selected review threshold: {metadata.get('review_threshold')}")
    print("Threshold policy remains unchanged; review this value against operational evidence separately.")
    if not arguments.apply:
        print("Dry run only. Add --apply to back up and integrate the validated files.")
        return 0

    backup = integrate(artifacts, files)
    print(f"Integrated artifacts. Existing files backed up at: {backup}")
    print("Restart the local backend so its predictor process loads the replacement model.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
