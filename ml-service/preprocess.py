"""Prepare model features from the generated raw student-pair dataset."""

from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).parent
RAW_PATH = BASE_DIR / "data" / "raw_pairs.csv"
FEATURES_PATH = BASE_DIR / "data" / "features.csv"
FEATURE_COLUMNS = ["jaro_winkler", "dob_match", "school_match", "guardian_match", "upi_match", "label"]


def preprocess() -> pd.DataFrame:
    raw = pd.read_csv(RAW_PATH)
    features = raw[["group_id", "name_similarity", "dob_match", "school_match", "guardian_match", "upi_match", "label"]].rename(
        columns={"name_similarity": "jaro_winkler"}
    )
    features.to_csv(FEATURES_PATH, index=False)
    print(f"Prepared {len(features)} feature rows.")
    print(f"Columns: {', '.join(features.columns)}")
    print(f"Saved to: {FEATURES_PATH}")
    return features


if __name__ == "__main__":
    preprocess()
