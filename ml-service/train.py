"""Generate realistic SBMS training data and train the application model."""

from generate_realistic_pairs import main as generate_data
from retrain_realistic_pairs import main as retrain_and_evaluate


def train_model() -> dict[str, object]:
    generate_data()
    return retrain_and_evaluate()


if __name__ == "__main__":
    train_model()
