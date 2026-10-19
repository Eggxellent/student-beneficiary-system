"""Compatibility entry point for the branch's isolated retraining workflow.

Training and evaluation data are read from the checked-in variable-noise CSVs;
the legacy data/features.csv file is intentionally not used here.
"""

from retrain_variable_pairs import main as retrain_and_evaluate


def train_model() -> dict[str, object]:
    return retrain_and_evaluate()


if __name__ == "__main__":
    train_model()
