"""Legacy command name redirected to the attachment-style ML experiment."""

from retrain_attachment_style import main as retrain_and_evaluate


def train_model() -> dict[str, object]:
    return retrain_and_evaluate()


if __name__ == "__main__":
    train_model()
