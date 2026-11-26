import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feature_engineering import FEATURE_COLUMNS
from generate_realistic_pairs import _component_splits, generate


class GeneratorDifficultyTests(unittest.TestCase):
    def test_challenge_scenarios_are_balanced_and_truth_stays_identity_based(self):
        frame = generate(20_000, seed=731_224)
        groups = frame.drop_duplicates("group_id")
        positive = groups[groups.label == 1]
        negative = groups[groups.label == 0]
        hard_positive = positive.mutations.str.contains("hard_positive_identifier_case", regex=False)
        blocked_negative = negative.mutations.str.contains("blocked_collision_scenario", regex=False)
        self.assertAlmostEqual(float(hard_positive.mean()), 0.45, delta=0.001)
        self.assertAlmostEqual(float(blocked_negative.mean()), 0.45, delta=0.001)
        self.assertTrue((positive.identity_1 == positive.identity_2).all())
        self.assertTrue((negative.identity_1 != negative.identity_2).all())

        hard_rows = frame[frame.mutations.str.contains("hard_positive_identifier_case", regex=False)]
        self.assertTrue((hard_rows.birth_certificate_match == 0).all())
        self.assertGreater(
            float(hard_rows.mutations.str.contains(r"name_|middle_initial|missing_middle_name", regex=True).mean()),
            0.50,
        )

        blocked_rows = frame[frame.mutations.str.contains("blocked_collision_scenario", regex=False)]
        self.assertTrue((blocked_rows.admission_number_match == 0).all())
        self.assertTrue((blocked_rows.birth_certificate_match == 0).all())
        self.assertGreater(float((blocked_rows.school_match == 1).mean()), 0.85)
        self.assertGreater(float((blocked_rows.guardian_match == 1).mean()), 0.85)
        signatures = lambda rows: {
            tuple(round(float(row[column]), 6) for column in FEATURE_COLUMNS)
            for _, row in rows.iterrows()
        }
        self.assertTrue(signatures(hard_rows) & signatures(blocked_rows))

    def test_difficulty_is_label_independent_metadata(self):
        frame = generate(4_000, seed=184_203)

        self.assertNotIn("difficulty", FEATURE_COLUMNS)
        self.assertNotIn("difficulty_band", FEATURE_COLUMNS)
        means = frame.groupby("label")["difficulty"].mean()
        self.assertLess(abs(float(means.loc[1] - means.loc[0])), 0.06)
        self.assertGreater(frame.loc[frame.label == 0, "difficulty"].nunique(), 100)
        self.assertGreater(frame.loc[frame.label == 1, "difficulty"].nunique(), 100)

        group_labels = frame.groupby("group_id")["label"].nunique()
        group_difficulty = frame.groupby("group_id")["difficulty"].nunique()
        self.assertTrue((group_labels == 1).all())
        self.assertTrue((group_difficulty == 1).all())
        for label in (0, 1):
            self.assertEqual(
                set(frame.loc[frame.label == label, "difficulty_band"]),
                {"easy", "moderate", "hard"},
            )

    def test_no_exact_or_reversed_pair_reappears_across_generated_splits(self):
        train = generate(2_000, seed=18_420)
        holdout = generate(2_000, seed=97_531)
        record_fields = (
            "name", "dob", "school", "guardian", "admission_number", "birth_certificate"
        )

        def pair_signatures(frame):
            signatures = set()
            for row in frame.itertuples(index=False):
                left = tuple(getattr(row, f"{field}_1") for field in record_fields)
                right = tuple(getattr(row, f"{field}_2") for field in record_fields)
                signatures.add(tuple(sorted((left, right))))
            return signatures

        self.assertFalse(pair_signatures(train) & pair_signatures(holdout))

    def test_component_splits_keep_identities_and_guardians_together(self):
        population = generate(2_000, seed=19_421)
        splits = _component_splits(population, seed=73)
        missing = {"", "unknown", "n/a", "not provided", "none", "nan"}
        for index, left in enumerate(splits):
            for right in splits[index + 1:]:
                self.assertFalse(set(left.group_id) & set(right.group_id))
                left_people = set(left.identity_1) | set(left.identity_2)
                right_people = set(right.identity_1) | set(right.identity_2)
                self.assertFalse(left_people & right_people)
                left_guardians = {
                    str(value).strip().casefold()
                    for column in ("guardian_1", "guardian_2") for value in left[column]
                    if str(value).strip().casefold() not in missing
                }
                right_guardians = {
                    str(value).strip().casefold()
                    for column in ("guardian_1", "guardian_2") for value in right[column]
                    if str(value).strip().casefold() not in missing
                }
                self.assertFalse(left_guardians & right_guardians)

    def test_missingness_is_not_applied_only_to_one_label(self):
        frame = generate(10_000, seed=82_712)
        for column in ("guardian_1", "guardian_2", "admission_number_1", "birth_certificate_1"):
            rate = frame[column].isin({"", "UNKNOWN", "N/A", "NOT PROVIDED"}).groupby(frame.label).mean()
            self.assertLess(abs(float(rate.loc[1] - rate.loc[0])), 0.025, column)


if __name__ == "__main__":
    unittest.main()
