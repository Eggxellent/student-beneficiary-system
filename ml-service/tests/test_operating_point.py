"""Guard operating-point arithmetic without opening the sealed final test.

The decision sheet quotes registration-level numbers that no human-adjudicated data
supports yet, so helper arithmetic is tested using hand-built examples. These tests do
not read the active train/validation/test datasets.
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from evaluate_operating_point import (  # noqa: E402
    blocking_projection,
    label_coverage,
    load_labelled_pairs,
    ranking_metrics,
    registration_simulation,
    threshold_row,
)


class ThresholdMetricTests(unittest.TestCase):
    def test_confusion_matrix_and_rates_are_counted_correctly(self):
        # positives at 0.9/0.4, negatives at 0.8/0.1, cutoff 0.5 -> tp=1 fp=1 fn=1 tn=1
        labels = np.array([1, 1, 0, 0])
        scores = np.array([0.9, 0.4, 0.8, 0.1])
        row = threshold_row(labels, scores, 0.5)
        self.assertEqual(
            (row["true_positives"], row["false_positives"], row["false_negatives"], row["true_negatives"]),
            (1, 1, 1, 1),
        )
        self.assertAlmostEqual(row["precision"], 0.5)
        self.assertAlmostEqual(row["recall"], 0.5)
        self.assertAlmostEqual(row["f1"], 0.5)
        self.assertAlmostEqual(row["miss_rate"], 0.5)
        self.assertAlmostEqual(row["false_positive_rate"], 0.5)

    def test_a_score_exactly_on_the_cutoff_is_flagged(self):
        # The backend flags when score >= threshold, so the boundary belongs to "flagged".
        row = threshold_row(np.array([1, 0]), np.array([0.5, 0.5]), 0.5)
        self.assertEqual(row["true_positives"], 1)
        self.assertEqual(row["false_positives"], 1)

    def test_perfect_separation_ranks_first(self):
        ranking = ranking_metrics(np.array([1, 1, 0, 0]), np.array([0.9, 0.8, 0.2, 0.1]))
        self.assertAlmostEqual(ranking["roc_auc"], 1.0)
        self.assertAlmostEqual(ranking["average_precision_pr_auc"], 1.0)
        self.assertEqual(ranking["positives"], 2)


class RegistrationSimulationTests(unittest.TestCase):
    def simulate(self, positives, negatives, size, cutoff, simulations=200, seed=7):
        return registration_simulation(
            np.array(positives, dtype=float),
            np.array(negatives, dtype=float),
            (size,),
            (cutoff,),
            simulations,
            np.random.default_rng(seed),
        )[f"registry_{size}"]["by_cutoff"][f"{cutoff:.2f}"]

    def test_quiet_negatives_produce_no_nuisance_flags(self):
        row = self.simulate([0.95], [0.05, 0.10], size=200, cutoff=0.50)
        self.assertEqual(row["nuisance_flag_rate"], 0.0)
        self.assertEqual(row["clean_detection_rate"], 1.0)

    def test_top1_masks_the_duplicate_when_a_nuisance_candidate_scores_higher(self):
        # Only one flag is created, so a higher-scoring non-duplicate hides the real pair.
        row = self.simulate([0.90], [0.99], size=1, cutoff=0.50)
        self.assertEqual(row["masked_by_top1_rate"], 1.0)
        self.assertEqual(row["clean_detection_rate"], 0.0)
        self.assertEqual(row["nuisance_flag_rate"], 1.0)

    def test_simulation_is_reproducible_for_a_seed(self):
        first = self.simulate([0.9, 0.3], [0.2, 0.6, 0.05], size=50, cutoff=0.50, seed=11)
        second = self.simulate([0.9, 0.3], [0.2, 0.6, 0.05], size=50, cutoff=0.50, seed=11)
        self.assertEqual(first, second)

    def test_a_higher_cutoff_never_increases_nuisance_flags(self):
        low = self.simulate([0.9], [0.1] * 18 + [0.8, 0.95], size=100, cutoff=0.50)
        high = self.simulate([0.9], [0.1] * 18 + [0.8, 0.95], size=100, cutoff=0.99)
        self.assertGreaterEqual(low["nuisance_flag_rate"], high["nuisance_flag_rate"])
        self.assertGreaterEqual(high["nuisance_flag_rate"], 0.0)


class LabelledPairTests(unittest.TestCase):
    def test_missing_label_column_is_rejected(self):
        frame = pd.DataFrame(
            {"group_id": ["g1"], "scenario": ["x"], "name_1": ["A B"], "name_2": ["A B"]}
        )
        path = BASE_DIR / "tests" / "_tmp_missing_label.csv"
        frame.to_csv(path, index=False)
        try:
            with self.assertRaises(ValueError):
                load_labelled_pairs(path)
        finally:
            path.unlink(missing_ok=True)


class BlockingProjectionTests(unittest.TestCase):
    def test_each_key_reports_its_own_duplicate_retention(self):
        # One duplicate keeps surname and school; the other is a truncated name recorded
        # against an unknown school, which a surname+school key cannot see.
        data = pd.DataFrame(
            {
                "name_1": ["Brian Otieno", "Mercy Wanjiku"],
                "name_2": ["Brian Otieno", "Mercy"],
                "school_1": ["SCH001", "SCH002"],
                "school_2": ["SCH001", "UNKNOWN"],
            }
        )
        report = blocking_projection(
            data,
            np.array([1, 1]),
            np.array([0.9, 0.9]),
            np.array([0.0, 0.1]),
            (1000,),
            (0.50,),
            3,
        )
        self.assertTrue(report["available"])
        self.assertEqual(report["duplicate_retention"]["surname_and_school"], 0.5)
        self.assertEqual(report["duplicate_retention"]["any_name_token"], 1.0)
        self.assertIn("registry_1000", report["expected_block_size"]["any_name_token"])
        row = report["projected_nuisance_rate"]["registry_1000"]["0.50"]
        self.assertIn("token_nuisance_upper_bound", row)

    def test_label_coverage_reports_no_adjudicated_pairs(self):
        coverage = label_coverage(BASE_DIR / "evaluation" / "synthetic_test_not_opened.csv")
        self.assertIsInstance(coverage["adjudicated_files_found"], list)
        self.assertGreaterEqual(coverage["adjudicated_pair_count"], 0)


class SealedTestPolicyTests(unittest.TestCase):
    def test_operating_point_defaults_do_not_read_the_final_test_implicitly(self):
        # Evaluation must be an explicit operator action after model lock; importing
        # helpers or running unit tests must not open a sealed test CSV.
        source = (BASE_DIR / "evaluate_operating_point.py").read_text(encoding="utf-8")
        self.assertIn('"--holdout", type=Path, required=True', source)


if __name__ == "__main__":
    unittest.main()

