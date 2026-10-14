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
FEATURE_COLUMNS = ["jaro_winkler", "dob_match", "school_match", "guardian_match", "upi_match", "birth_certificate_match"]


def clean_name(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def build_features(first: dict[str, str], second: dict[str, str]) -> list[float]:
    return [
        jellyfish.jaro_winkler_similarity(clean_name(first["full_name"]), clean_name(second["full_name"])),
        int(first["date_of_birth"] == second["date_of_birth"]),
        int(first["school_code"] == second["school_code"]),
        int(first["guardian_id"] == second["guardian_id"]),
        int(first.get("upi") and first.get("upi") == second.get("upi")),
        int(bool(first.get("birth_certificate_number") and first.get("birth_certificate_number") == second.get("birth_certificate_number"))),
    ]


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
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
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
