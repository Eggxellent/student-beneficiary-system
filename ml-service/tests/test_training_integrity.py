"""Guard the training/holdout separation and overfitting claims in the metrics files.

These tests answer one question the project keeps being asked: was the deployed model
trained on the data it was scored on? The checks are cheap and read-only, so they can run
on every commit. They fail if anyone regenerates the split with overlapping identities,
retrains on the holdout, replaces the artifact without updating its recorded hash, or
starts fitting inside the serving path.
"""

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from check_training_integrity import (
    MAX_INSAMPLE_F1_ADVANTAGE,
    SHORTCUT_AUC,
    person_keys,
    run,
)


class TrainingIntegrityReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # fast mode: no grouped CV, no learning curve, so the suite stays quick.
        cls.report = run(fast=True)

    def test_no_violations(self):
        self.assertEqual(self.report["violations"], [])
        self.assertEqual(self.report["verdict"], "pass")

    def test_training_and_holdout_share_no_groups_or_people(self):
        separation = self.report["separation"]
        self.assertEqual(separation["shared_groups"], 0)
        self.assertEqual(separation["shared_person_identities"], 0)
        self.assertEqual(separation["identical_rows_across_splits"], 0)
        self.assertGreater(separation["training_groups"], 0)
        self.assertGreater(separation["holdout_groups"], 0)

    def test_artifact_matches_the_recorded_metrics(self):
        provenance = self.report["provenance"]
        self.assertTrue(provenance["artifact_matches_metrics_report"])
        self.assertTrue(provenance["training_sha256_matches_report"])
        self.assertTrue(provenance["holdout_sha256_matches_report"])

    def test_holdout_is_declared_excluded_from_training(self):
        reported = self.report["reported_by_metrics_file"]
        self.assertIs(reported["holdout_used_for_training_or_tuning"], False)
        self.assertEqual(reported["threshold"], 0.5)

    def test_model_does_not_merely_memorise_training_rows(self):
        overfitting = self.report["overfitting"]
        advantage = overfitting["in_sample_f1_advantage"]
        self.assertLessEqual(advantage, MAX_INSAMPLE_F1_ADVANTAGE)
        # the holdout must still be a useful measurement, not a collapsed score
        self.assertGreater(overfitting["holdout_metrics"]["f1"], 0.5)

    def test_no_single_feature_determines_the_label(self):
        for column, entry in self.report["label_shortcuts"].items():
            if entry["holdout_auc"] is None:
                continue
            self.assertLess(entry["holdout_auc"], SHORTCUT_AUC, f"{column} is a label shortcut")

    def test_serving_path_never_trains(self):
        for entry in self.report["serving_path"]:
            self.assertTrue(entry["clean"], f"{entry['file']} contains {entry['banned_tokens_found']}")


class PersonKeyTests(unittest.TestCase):
    def test_placeholder_values_do_not_create_phantom_identity_collisions(self):
        train = pd.DataFrame(
            [{"name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "upi_1": "UPI-1",
              "name_2": "NOT PROVIDED", "dob_2": "2007-01-16", "upi_2": None}]
        )
        holdout = pd.DataFrame(
            [{"name_1": None, "dob_1": "2007-01-16", "upi_1": None,
              "name_2": "Brian Otieno", "dob_2": "2011-02-02", "upi_2": "UPI-2"}]
        )
        train_keys, train_skipped = person_keys(train)
        holdout_keys, holdout_skipped = person_keys(holdout)

        self.assertEqual(train_keys & holdout_keys, set())
        self.assertEqual((train_skipped, holdout_skipped), (1, 1))

    def test_identical_identities_are_detected(self):
        train = pd.DataFrame(
            [{"name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "upi_1": "UPI-1",
              "name_2": "Brian Otieno", "dob_2": "2011-02-02", "upi_2": "UPI-2"}]
        )
        holdout = pd.DataFrame(
            [{"name_1": "Amina  Wanjiku", "dob_1": "2010-05-14", "upi_1": "upi-1",
              "name_2": "Cynthia Kamau", "dob_2": "2012-03-03", "upi_2": "UPI-3"}]
        )
        train_keys, _ = person_keys(train)
        holdout_keys, _ = person_keys(holdout)

        self.assertEqual(len(train_keys & holdout_keys), 1)


if __name__ == "__main__":
    unittest.main()
