import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feature_engineering import FEATURE_COLUMNS, build_pair_features
from generate_dataset import feature_row
from predict import build_features, predict_pairs


class FeatureEngineeringTest(unittest.TestCase):
    def test_training_rows_and_runtime_prediction_share_the_same_features(self):
        first = {
            "full_name": "Amina Wanjiku",
            "date_of_birth": "2010-05-14",
            "school_code": "SCH-041",
            "guardian_id": "G-4101",
            "upi": "UPI-4101",
            "birth_certificate_number": "BC-4101",
        }
        second = {**first, "full_name": "Amina Wanjikuu", "upi": "UPI-4102"}
        shared_features = build_pair_features(first, second)
        training_row = feature_row(first, second, label=1, group_id=42)

        self.assertEqual([shared_features[column] for column in FEATURE_COLUMNS], build_features(first, second))
        self.assertEqual({column: training_row[column] for column in FEATURE_COLUMNS}, shared_features)

    def test_two_missing_values_do_not_count_as_a_match(self):
        first = {"full_name": "Nia Wanjiku"}
        second = {"full_name": "Nia Wanjiku"}
        features = build_pair_features(first, second)

        self.assertEqual(features["dob_match"], 0)
        self.assertEqual(features["school_match"], 0)
        self.assertEqual(features["guardian_match"], 0)
        self.assertEqual(features["upi_match"], 0)
        self.assertEqual(features["birth_certificate_match"], 0)

    def test_pair_prediction_uses_shared_features_and_returns_positive_class_score(self):
        class FakeModel:
            classes_ = [0, 1]

            def predict_proba(self, frame):
                self.columns = list(frame.columns)
                self.values = frame.iloc[0].tolist()
                return np.array([[0.2, 0.8]])

        first = {"full_name": "Nia Wanjiku", "school_code": "Nairobi School", "upi": "UPI-1001"}
        second = {**first, "upi": "UPI-1002"}
        model = FakeModel()
        result = predict_pairs([{"first": first, "second": second}], model)[0]

        self.assertEqual(model.columns, FEATURE_COLUMNS)
        self.assertEqual(result["score"], 0.8)
        self.assertEqual(result["features"], build_pair_features(first, second))


if __name__ == "__main__":
    unittest.main()
