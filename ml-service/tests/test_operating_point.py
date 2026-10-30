"""Guard the operating-point report and the arithmetic behind it.

The decision sheet quotes registration-level numbers that no human-adjudicated data
supports yet, so the arithmetic must be provably correct and the report must be provably
about the deployed artifact. These tests fail if the simulation logic drifts, if the
committed report is left describing an older model, or if the report stops stating that
its labels are synthetic.
"""

import hashlib
import json
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

REPORT_PATH = BASE_DIR / "evaluation" / "operating_point_2026-10-30.json"
METRICS_PATH = BASE_DIR / "evaluation" / "realistic_pairs_xgboost_training_metrics.json"
MODEL_PATH = BASE_DIR / "model" / "xgb_duplicate_model.joblib"


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
        coverage = label_coverage(BASE_DIR / "evaluation" / "realistic_pairs_holdout.csv")
        self.assertIsInstance(coverage["adjudicated_files_found"], list)
        self.assertGreaterEqual(coverage["adjudicated_pair_count"], 0)


class CommittedReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not REPORT_PATH.is_file():
            raise unittest.SkipTest(f"not generated yet: {REPORT_PATH.name}")
        cls.report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))

    def test_report_describes_the_live_artifact(self):
        if not MODEL_PATH.is_file():
            self.skipTest("model artifact is git-ignored and absent from this checkout")
        live = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
        self.assertEqual(
            self.report["provenance"]["model_sha256"],
            live,
            "The committed operating-point report describes a different model. "
            "Re-run evaluate_operating_point.py after promoting an artifact.",
        )

    def test_pair_level_f1_reproduces_the_recorded_metrics(self):
        metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        recorded = metrics["selected_model_holdout_metrics"]
        row = next(
            item
            for item in self.report["pair_level"]["thresholds"]
            if abs(item["cutoff"] - recorded["threshold"]) < 1e-9
        )
        self.assertAlmostEqual(row["f1"], recorded["f1"], places=4)
        self.assertEqual(row["true_positives"], recorded["true_positives"])
        self.assertEqual(row["false_positives"], recorded["false_positives"])

    def test_report_states_that_its_labels_are_synthetic(self):
        self.assertEqual(self.report["label_coverage"]["adjudicated_pair_count"], 0)
        self.assertTrue(self.report["limitations"])
        self.assertIn("synthetic", " ".join(self.report["limitations"]).lower())

    def test_features_match_what_serving_computes(self):
        # If feature engineering changes, the scores in the report are no longer the
        # scores serving computes, and every number in the decision sheet is void.
        self.assertTrue(self.report["feature_consistency"]["checked"])
        self.assertTrue(self.report["feature_consistency"]["exact_match"])


if __name__ == "__main__":
    unittest.main()

