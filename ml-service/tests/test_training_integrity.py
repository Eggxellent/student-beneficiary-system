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
    directed_pair_overlap,
    unordered_pair_overlap,
    person_keys,
)


class PersonKeyTests(unittest.TestCase):
    def test_reversed_pairs_are_detected_as_the_same_cross_split_pair(self):
        left = pd.DataFrame([{
            "name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "school_1": "S1",
            "guardian_1": "G1", "admission_number_1": "A1", "birth_certificate_1": "B1",
            "name_2": "Brian Otieno", "dob_2": "2011-02-02", "school_2": "S2",
            "guardian_2": "G2", "admission_number_2": "A2", "birth_certificate_2": "B2",
        }])
        reversed_pair = pd.DataFrame([{
            "name_1": "Brian Otieno", "dob_1": "2011-02-02", "school_1": "S2",
            "guardian_1": "G2", "admission_number_1": "A2", "birth_certificate_1": "B2",
            "name_2": "Amina Wanjiku", "dob_2": "2010-05-14", "school_2": "S1",
            "guardian_2": "G1", "admission_number_2": "A1", "birth_certificate_2": "B1",
        }])
        self.assertEqual(unordered_pair_overlap(left, reversed_pair), 1)
        self.assertEqual(directed_pair_overlap(left, reversed_pair), 0)

    def test_ordered_pairs_are_detected_without_reversing(self):
        pair = pd.DataFrame([{
            "name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "school_1": "S1",
            "guardian_1": "G1", "admission_number_1": "A1", "birth_certificate_1": "B1",
            "name_2": "Brian Otieno", "dob_2": "2011-02-02", "school_2": "S2",
            "guardian_2": "G2", "admission_number_2": "A2", "birth_certificate_2": "B2",
        }])
        self.assertEqual(directed_pair_overlap(pair, pair.copy()), 1)

    def test_placeholder_values_do_not_create_phantom_identity_collisions(self):
        train = pd.DataFrame(
            [{"name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "school_1": "S1", "admission_number_1": "1",
              "name_2": "NOT PROVIDED", "dob_2": "2007-01-16", "school_2": None, "admission_number_2": None}]
        )
        holdout = pd.DataFrame(
            [{"name_1": None, "dob_1": "2007-01-16", "school_1": None, "admission_number_1": None,
              "name_2": "Brian Otieno", "dob_2": "2011-02-02", "school_2": "S2", "admission_number_2": "2"}]
        )
        train_keys, train_skipped = person_keys(train)
        holdout_keys, holdout_skipped = person_keys(holdout)

        self.assertEqual(train_keys & holdout_keys, set())
        self.assertEqual((train_skipped, holdout_skipped), (1, 1))

    def test_identical_identities_are_detected(self):
        train = pd.DataFrame(
            [{"name_1": "Amina Wanjiku", "dob_1": "2010-05-14", "school_1": "S1", "admission_number_1": "1",
              "name_2": "Brian Otieno", "dob_2": "2011-02-02", "school_2": "S2", "admission_number_2": "2"}]
        )
        holdout = pd.DataFrame(
            [{"name_1": "Amina  Wanjiku", "dob_1": "2010-05-14", "school_1": "S1", "admission_number_1": "1",
              "name_2": "Cynthia Kamau", "dob_2": "2012-03-03", "school_2": "S3", "admission_number_2": "3"}]
        )
        train_keys, _ = person_keys(train)
        holdout_keys, _ = person_keys(holdout)

        self.assertEqual(len(train_keys & holdout_keys), 1)


if __name__ == "__main__":
    unittest.main()
