"""Report whether the synthetic validation set passes the shallow-tree hardness gate."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
from sklearn.metrics import f1_score
from sklearn.tree import DecisionTreeClassifier

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from feature_engineering import FEATURE_COLUMNS  # noqa: E402
from generate_realistic_pairs import TRAIN_FILE, VALIDATION_FILE  # noqa: E402

MAX_ACCEPTED_F1 = 0.85


def main() -> int:
    train = pd.read_csv(TRAIN_FILE, float_precision="round_trip")
    validation = pd.read_csv(VALIDATION_FILE, float_precision="round_trip")
    model = DecisionTreeClassifier(max_depth=2, random_state=451202)
    model.fit(train[FEATURE_COLUMNS], train.label.astype(int))
    score = float(f1_score(validation.label.astype(int), model.predict(validation[FEATURE_COLUMNS])))
    passed = score < MAX_ACCEPTED_F1
    print(f"depth-2 validation F1: {score:.4f}; required: < {MAX_ACCEPTED_F1:.2f}; verdict: {'PASS' if passed else 'FAIL'}")
    if not passed:
        print("The synthetic pair generator remains too separable for the intended challenge evaluation.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
