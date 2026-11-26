import sys
import tempfile
import unittest
import hashlib
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feature_engineering import FEATURE_COLUMNS
from predict import MODEL_FILE, load_metadata, load_model, model_type, model_version, predict_pairs


class FakeModel:
    def predict_proba(self, frame):
        self.columns = list(frame.columns)
        return np.array([[0.123456, 0.876544]])


class ProductionArtifactLoadingTests(unittest.TestCase):
    def test_default_loader_uses_the_production_artifact_only(self):
        class SchemaModel:
            feature_names_in_ = FEATURE_COLUMNS

        sentinel_model = SchemaModel()
        digest = hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest()
        with patch("predict.joblib.load", return_value=sentinel_model) as load, patch(
            "predict.load_metadata", return_value={"model_sha256": digest, "model_type": model_type(sentinel_model)}
        ):
            self.assertIs(load_model(), sentinel_model)

        load.assert_called_once_with(MODEL_FILE)
        self.assertEqual(MODEL_FILE.name, "xgb_duplicate_model.joblib")
        self.assertEqual(MODEL_FILE.parent.name, "model")

    def test_missing_artifact_fails_with_a_specific_error(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "xgb_duplicate_model.joblib"
            with self.assertRaisesRegex(FileNotFoundError, "(?i)production model artifact is missing"):
                load_model(missing)

    def test_corrupt_artifact_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            corrupt = Path(directory) / "xgb_duplicate_model.joblib"
            corrupt.write_bytes(b"not a valid joblib model")
            with self.assertRaisesRegex(RuntimeError, "could not be loaded"):
                load_model(corrupt)

    def test_artifact_metadata_hash_mismatch_fails_closed(self):
        class SchemaModel:
            feature_names_in_ = FEATURE_COLUMNS

        with patch("predict.joblib.load", return_value=SchemaModel()), patch(
            "predict.load_metadata",
            return_value={"model_sha256": "0" * 64, "model_type": model_type(SchemaModel())},
        ):
            with self.assertRaisesRegex(RuntimeError, "hash does not match its metadata"):
                load_model()

    def test_prediction_preserves_feature_order_and_valid_output(self):
        first = {
            "full_name": "Amina Wanjiku",
            "date_of_birth": "2010-05-14",
            "school_code": "Nairobi School",
            "guardian_id": "G-4101",
            "upi": "UPI-4101",
            "birth_certificate_number": "BC-4101",
        }
        second = {**first, "full_name": "Amina Wanjikuu", "upi": "UPI-4102"}
        model = FakeModel()

        result = predict_pairs([{"first": first, "second": second}], model)[0]

        self.assertEqual(model.columns, FEATURE_COLUMNS)
        self.assertEqual(list(result["features"]), FEATURE_COLUMNS)
        self.assertEqual(result["score"], 0.8765)
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 1)

    def test_tracked_production_artifact_scores_a_synthetic_pair(self):
        model = load_model()
        first = {
            "full_name": "Amina Wanjiku",
            "date_of_birth": "2010-05-14",
            "school_code": "Nairobi School",
            "guardian_id": "G-4101",
            "upi": "UPI-4101",
            "birth_certificate_number": "BC-4101",
        }
        second = {**first, "full_name": "Amina Wanjikuu", "upi": "UPI-4102"}

        result = predict_pairs([{"first": first, "second": second}], model)[0]

        self.assertEqual(list(result["features"]), FEATURE_COLUMNS)
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 1)

    def test_metadata_and_model_version_identify_the_fitted_estimator(self):
        model = load_model()
        metadata = load_metadata()

        self.assertEqual(
            metadata["model_type"],
            "sklearn.pipeline.Pipeline(SimpleImputer, HistGradientBoostingClassifier)",
        )
        self.assertEqual(model_version(model).split(":", 1)[0], "histgradientboostingclassifier")

    def test_default_python_decision_cutoff_matches_model_metadata(self):
        from predict import DEFAULT_REVIEW_THRESHOLD

        self.assertEqual(float(load_metadata()["review_threshold"]), DEFAULT_REVIEW_THRESHOLD)


if __name__ == "__main__":
    unittest.main()
