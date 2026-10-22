"""Score student pairs using the deployed XGBoost duplicate model."""

from __future__ import annotations

import json
import hashlib
import sys
from pathlib import Path

import joblib
import pandas as pd
from feature_engineering import FEATURE_COLUMNS, build_pair_features

MODEL_FILE = Path(__file__).parent / "model" / "xgb_duplicate_model.joblib"
def build_features(first: dict[str, str], second: dict[str, str]) -> list[float]:
    features = build_pair_features(first, second)
    return [features[column] for column in FEATURE_COLUMNS]


def predict(data: dict[str, float | int], model=None) -> dict[str, float]:
    model = model or joblib.load(MODEL_FILE)
    feature_values = {column: data[column] for column in FEATURE_COLUMNS}
    feature_frame = pd.DataFrame([feature_values], columns=FEATURE_COLUMNS)
    probability = float(model.predict_proba(feature_frame)[0][1])
    return {"probability": round(probability, 4)}


def predict_many(data: list[dict[str, float | int]], model=None) -> list[dict[str, float]]:
    model = model or joblib.load(MODEL_FILE)
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
        {"score": result["probability"], "features": feature}
        for feature, result in zip(features, probabilities, strict=True)
    ]


def model_version() -> str:
    digest = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
    return f"xgboost:{digest}"


def predict_duplicate(first: dict[str, str], second: dict[str, str], threshold: float = 0.5) -> dict[str, object]:
    features = build_features(first, second)
    result = predict(dict(zip(FEATURE_COLUMNS, features)))
    probability = result["probability"]
    return {
        "duplicate_probability": probability,
        "is_duplicate": probability >= threshold,
        "features": dict(zip(FEATURE_COLUMNS, features)),
    }


def run_server() -> None:
    model = joblib.load(MODEL_FILE)
    version = model_version()
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
