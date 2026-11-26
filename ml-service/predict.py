"""Score student pairs using the deployed duplicate model artifact."""

from __future__ import annotations

import json
import hashlib
import sys
from pathlib import Path

import joblib
import pandas as pd
from feature_engineering import FEATURE_COLUMNS, build_pair_features
from review_evidence import build_review_evidence

MODEL_FILE = Path(__file__).parent / "model" / "xgb_duplicate_model.joblib"
MODEL_METADATA = Path(__file__).parent / "model" / "xgb_duplicate_model.metadata.json"
DEFAULT_REVIEW_THRESHOLD = 0.63


def _feature_names(model) -> list[str] | None:
    """Feature order the fitted artifact expects, or None when it records none."""
    candidates = [model]
    named_steps = getattr(model, "named_steps", None)
    if isinstance(named_steps, dict):
        candidates.extend(named_steps.values())
    for candidate in candidates:
        names = getattr(candidate, "feature_names_in_", None)
        if names is not None:
            return [str(name) for name in names]
    return None


def model_type(model) -> str:
    """Return a stable description including the estimator inside a pipeline."""
    module = type(model).__module__
    class_name = type(model).__name__
    named_steps = getattr(model, "named_steps", None)
    if isinstance(named_steps, dict):
        steps = ", ".join(type(step).__name__ for step in named_steps.values())
        return f"{module}.{class_name}({steps})"
    return f"{module}.{class_name}"


def verify_model_schema(model, model_file: Path = MODEL_FILE) -> list[str]:
    """Refuse to serve an artifact that was trained on a different feature schema.

    A model trained on the retired `upi_match` schema would silently receive an
    admission-number column in the same position and score nonsense, so the schema
    is checked at load time instead of trusted.
    """
    names = _feature_names(model)
    if names is None:
        raise RuntimeError(
            f"Production model artifact does not record its feature schema: {model_file}"
        )
    if names != FEATURE_COLUMNS:
        raise RuntimeError(
            f"Production model artifact feature schema {names} does not match the expected "
            f"schema {FEATURE_COLUMNS}: {model_file}"
        )
    return names


def load_metadata(metadata_file: Path = MODEL_METADATA) -> dict[str, object]:
    try:
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise FileNotFoundError(f"Production model metadata is missing: {metadata_file}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Production model metadata could not be parsed: {metadata_file}") from error
    if metadata.get("feature_columns") != FEATURE_COLUMNS:
        raise RuntimeError(
            f"Production model metadata declares feature schema {metadata.get('feature_columns')} "
            f"but the service expects {FEATURE_COLUMNS}: {metadata_file}"
        )
    return metadata


def load_model(model_file: Path = MODEL_FILE, metadata_file: Path | None = None):
    """Load the production model artifact and prove it matches the serving schema."""
    try:
        model = joblib.load(model_file)
    except FileNotFoundError as error:
        raise FileNotFoundError(f"Production model artifact is missing: {model_file}") from error
    except Exception as error:
        raise RuntimeError(f"Production model artifact could not be loaded: {model_file}") from error
    verify_model_schema(model, model_file)
    metadata = load_metadata(metadata_file if metadata_file is not None else model_file.parent / MODEL_METADATA.name)
    actual_model_type = model_type(model)
    if metadata.get("model_type") != actual_model_type:
        raise RuntimeError(
            f"Production model type {actual_model_type} does not match its metadata "
            f"{metadata.get('model_type')}: {model_file}"
        )
    actual_hash = hashlib.sha256(model_file.read_bytes()).hexdigest()
    if metadata.get("model_sha256") != actual_hash:
        raise RuntimeError(
            f"Production model artifact hash does not match its metadata: {model_file}"
        )
    return model



def build_features(first: dict[str, str], second: dict[str, str]) -> list[float]:
    features = build_pair_features(first, second)
    return [features[column] for column in FEATURE_COLUMNS]


def predict(data: dict[str, float | int], model=None) -> dict[str, float]:
    model = model if model is not None else load_model()
    feature_values = {column: data[column] for column in FEATURE_COLUMNS}
    feature_frame = pd.DataFrame([feature_values], columns=FEATURE_COLUMNS)
    probability = float(model.predict_proba(feature_frame)[0][1])
    return {"probability": round(probability, 4)}


def predict_many(data: list[dict[str, float | int]], model=None) -> list[dict[str, float]]:
    model = model if model is not None else load_model()
    feature_frame = pd.DataFrame(
        [{column: item[column] for column in FEATURE_COLUMNS} for item in data],
        columns=FEATURE_COLUMNS,
    )
    probabilities = model.predict_proba(feature_frame)[:, 1]
    return [{"probability": round(float(probability), 4)} for probability in probabilities]


def predict_pairs(pairs: list[dict[str, dict[str, str]]], model=None) -> list[dict[str, object]]:
    """Score raw record pairs using the same feature builder used for training."""
    if not isinstance(pairs, list):
        raise ValueError("pairs must be a list")
    if not pairs:
        return []
    features = []
    for pair in pairs:
        if not isinstance(pair, dict) or not isinstance(pair.get("first"), dict) or not isinstance(pair.get("second"), dict):
            raise ValueError("each pair must contain first and second student records")
        features.append(build_pair_features(pair["first"], pair["second"]))
    probabilities = predict_many(features, model)
    return [
        {
            "score": result["probability"],
            "features": feature,
            "review_evidence": build_review_evidence(pair["first"], pair["second"]),
        }
        for pair, feature, result in zip(pairs, features, probabilities, strict=True)
    ]


def model_version(model=None) -> str:
    model = model if model is not None else load_model()
    digest = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    estimator = model
    named_steps = getattr(model, "named_steps", None)
    if isinstance(named_steps, dict) and named_steps:
        estimator = list(named_steps.values())[-1]
    estimator_name = type(estimator).__name__.lower()
    return f"{estimator_name}:{digest}"


def predict_duplicate(
    first: dict[str, str],
    second: dict[str, str],
    threshold: float | None = None,
) -> dict[str, object]:
    if threshold is None:
        threshold = float(load_metadata().get("review_threshold", DEFAULT_REVIEW_THRESHOLD))
    features = build_features(first, second)
    result = predict(dict(zip(FEATURE_COLUMNS, features)))
    probability = result["probability"]
    return {
        "duplicate_probability": probability,
        "is_duplicate": probability >= threshold,
        "features": dict(zip(FEATURE_COLUMNS, features)),
    }


def run_server() -> None:
    try:
        model = load_model()
    except Exception as error:
        # The backend treats a dead predictor as "screening unavailable" and refuses
        # the registration. Never start serving with an artifact that failed the
        # schema check.
        print(json.dumps({"error": str(error), "fatal": True}), flush=True)
        raise SystemExit(1) from error
    version = model_version(model)

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            if isinstance(data, dict) and "pairs" in data:
                result = {"model_version": version, "results": predict_pairs(data["pairs"], model)}
            else:
                result = predict_many(data, model) if isinstance(data, list) else predict(data, model)
            print(json.dumps(result), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)


if __name__ == "__main__":
    try:
        if "--server" in sys.argv:
            run_server()
        else:
            data = json.loads(sys.stdin.read())
            if isinstance(data, list):
                print(json.dumps(predict_many(data)))
            else:
                print(json.dumps(predict(data)))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
