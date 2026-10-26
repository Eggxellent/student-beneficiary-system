"""Isolated tests for research feature and split-integrity helpers."""
import unittest
from pathlib import Path
import sys

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from experiment import (  # noqa: E402
    MODEL_FEATURES,
    _group_overlap,
    binary_part,
    pair_features,
    standalone_full_name_jw,
    threshold_for_f1,
)


class ExperimentFeatureTests(unittest.TestCase):
    def test_feature_schema_is_stable_and_excludes_private_fields(self):
        self.assertEqual(MODEL_FEATURES[:4], [
            "jaro_winkler", "dob_match", "school_match", "guardian_match",
        ])
        self.assertNotIn("identity_a", MODEL_FEATURES)
        self.assertNotIn("label", MODEL_FEATURES)
        self.assertNotIn("pair_id", MODEL_FEATURES)

    def test_pair_feature_builder_handles_missing_fields(self):
        row = pd.Series({
            **{f"{side}_{field}": "" for side in "ab" for field in (
                "first_name", "middle_name", "surname", "dob", "gender", "county", "ward",
                "school", "guardian_name", "guardian_phone", "guardian_id_no", "application_year",
            )},
        })
        result = pair_features(row)
        self.assertEqual(list(result), MODEL_FEATURES)
        self.assertTrue(all(value == 0 for value in result.values()))

    def test_pair_feature_builder_uses_existing_jaro_winkler_logic(self):
        row = pd.Series({
            **{f"{side}_{field}": "" for side in "ab" for field in (
                "first_name", "middle_name", "surname", "dob", "gender", "county", "ward",
                "school", "guardian_name", "guardian_phone", "guardian_id_no", "application_year",
            )},
            "a_first_name": "Mary", "a_surname": "Njeri", "b_first_name": "Mary",
            "b_surname": "Njeri", "a_dob": "2008-01-02", "b_dob": "2008-01-02",
            "a_school": "Fictional High School", "b_school": "Fictional High School",
            "a_guardian_id_no": "01234567", "b_guardian_id_no": "01234567",
        })
        result = pair_features(row)
        self.assertEqual(result["jaro_winkler"], 1.0)
        self.assertEqual(result["dob_match"], 1.0)
        self.assertEqual(result["school_match"], 1.0)
        self.assertEqual(result["guardian_match"], 1.0)

    def test_standalone_name_baseline_is_standard_order_jaro_winkler(self):
        row = pd.Series({"a_first_name": "Mary", "a_middle_name": "", "a_surname": "Njeri",
                         "b_first_name": "Mary", "b_middle_name": "", "b_surname": "Njeri"})
        self.assertEqual(standalone_full_name_jw(row), 1.0)

    def test_review_rows_are_excluded_from_binary_training_view(self):
        frame = pd.DataFrame({"label": ["match", "non_match", "review"], "y": ["1", "0", ""]})
        binary, labels = binary_part(frame)
        self.assertEqual(list(binary.label), ["match", "non_match"])
        self.assertEqual(labels.tolist(), [1, 0])

    def test_validation_threshold_selection_is_repeatable(self):
        y = [0, 0, 1, 1]
        scores = [0.1, 0.6, 0.7, 0.9]
        self.assertEqual(threshold_for_f1(y, scores), threshold_for_f1(y, scores))

    def test_group_overlap_helper_detects_reused_identity(self):
        metadata = pd.DataFrame([
            {"split": "train", "identity_a": "i1", "identity_b": "i2", "cluster_a": "c1", "cluster_b": "c2"},
            {"split": "val", "identity_a": "i3", "identity_b": "i1", "cluster_a": "c3", "cluster_b": "c1"},
            {"split": "test", "identity_a": "i4", "identity_b": "i5", "cluster_a": "c4", "cluster_b": "c5"},
        ])
        self.assertEqual(_group_overlap(metadata, "train", "val", "identity"), 1)
        self.assertEqual(_group_overlap(metadata, "train", "test", "cluster"), 0)


if __name__ == "__main__":
    unittest.main()
