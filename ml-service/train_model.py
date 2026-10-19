"""Legacy command name redirected to the canonical isolated ML experiment."""

from retrain_variable_pairs import main as retrain_and_evaluate


def train_model() -> dict[str, object]:
    return retrain_and_evaluate()


if __name__ == "__main__":
    train_model()
