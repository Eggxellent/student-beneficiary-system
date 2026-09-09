"""Score a student pair from JSON input using the trained Random Forest."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import jellyfish
import joblib
import pandas as pd

MODEL_FILE = Path(__file__).parent / "model" / "rf_duplicate_model.joblib"
FEATURE_COLUMNS = ["jaro_winkler", "dob_match", "school_match", "guardian_match"]


def clean_name(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def build_features(first: dict[str, str], second: dict[str, str]) -> list[float]:
    return [
        jellyfish.jaro_winkler_similarity(clean_name(first["full_name"]), clean_name(second["full_name"])),
        int(first["date_of_birth"] == second["date_of_birth"]),
        int(first["school_code"] == second["school_code"]),
        int(first["guardian_id"] == second["guardian_id"]),
    ]


def predict(data: dict[str, float | int]) -> dict[str, float]:
    model = joblib.load(MODEL_FILE)
    feature_values = {column: data[column] for column in FEATURE_COLUMNS}
    feature_frame = pd.DataFrame([feature_values], columns=FEATURE_COLUMNS)
    probability = float(model.predict_proba(feature_frame)[0][1])
    return {"probability": round(probability, 4)}


def predict_duplicate(first: dict[str, str], second: dict[str, str], threshold: float = 0.5) -> dict[str, object]:
    features = build_features(first, second)
    result = predict(dict(zip(FEATURE_COLUMNS, features)))
    probability = result["probability"]
    return {
        "duplicate_probability": probability,
        "is_duplicate": probability >= threshold,
        "features": dict(zip(FEATURE_COLUMNS, features)),
    }


if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
        print(json.dumps(predict(data)))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
