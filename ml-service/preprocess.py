"""Prepare model features from the generated raw student-pair dataset."""

from pathlib import Path

import pandas as pd
from feature_engineering import FEATURE_COLUMNS

BASE_DIR = Path(__file__).parent
RAW_PATH = BASE_DIR / "data" / "raw_pairs.csv"
FEATURES_PATH = BASE_DIR / "data" / "features.csv"


def preprocess() -> pd.DataFrame:
    raw = pd.read_csv(RAW_PATH)
    required = ["group_id", *FEATURE_COLUMNS, "label"]
    missing = sorted(set(required) - set(raw.columns))
    if missing:
        raise ValueError(f"Raw pair data is missing columns: {', '.join(missing)}")
    features = raw[required]
    features.to_csv(FEATURES_PATH, index=False)
    print(f"Prepared {len(features)} feature rows.")
    print(f"Columns: {', '.join(features.columns)}")
    print(f"Saved to: {FEATURES_PATH}")
    return features


if __name__ == "__main__":
    preprocess()
