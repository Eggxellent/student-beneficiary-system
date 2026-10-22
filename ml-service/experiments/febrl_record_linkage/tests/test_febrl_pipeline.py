from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from febrl_pipeline import (  # noqa: E402
    ATTRIBUTES,
    FEATURE_COLUMNS,
    blocked_pairs,
    entity_id,
    pair_features,
    split_entities,
)


class FebrlPipelineTests(unittest.TestCase):
    def test_documented_record_ids_resolve_entity_ids_not_row_positions(self):
        self.assertEqual(entity_id("rec-1070-org", "4a"), 1070)
        self.assertEqual(entity_id("rec-1070-dup-0", "4b"), 1070)
        with self.assertRaises(ValueError):
            entity_id("rec-1070-dup-0", "4a")

    def test_entity_split_is_reproducible_disjoint_and_70_15_15(self):
        first = split_entities(range(100), seed=91)
        second = split_entities(range(100), seed=91)
        self.assertEqual(first, second)
        self.assertEqual({key: len(value) for key, value in first.items()}, {"train": 70, "validation": 15, "test": 15})
        self.assertEqual(set.union(*first.values()), set(range(100)))
        self.assertTrue(all(not (first[left] & first[right]) for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))))

    def test_blocking_uses_only_record_attributes_and_unions_rules(self):
        a = pd.DataFrame(
            {
                "given_name": ["Amina", "Brian"],
                "surname": ["Wanjiku", "Otieno"],
                "date_of_birth": ["20010101", "20020202"],
                "postcode": ["1000", "2000"],
                "soc_sec_id": ["1", "2"],
            },
            index=["rec-1-org", "rec-2-org"],
        )
        b = pd.DataFrame(
            {
                "given_name": ["Different", "Other"],
                "surname": ["Wanjiku", "Different"],
                "date_of_birth": ["20010101", "20030303"],
                "postcode": ["9999", "9998"],
                "soc_sec_id": ["9", "8"],
            },
            index=["rec-1-dup-0", "rec-3-dup-0"],
        )
        candidates = blocked_pairs(a, b)
        self.assertIn(("rec-1-org", "rec-1-dup-0"), candidates)
        self.assertNotIn(("rec-2-org", "rec-3-dup-0"), candidates)

    def test_features_handle_missingness_without_using_ids_or_labels(self):
        left = pd.Series({name: None for name in ATTRIBUTES})
        right = pd.Series({name: None for name in ATTRIBUTES})
        left["given_name"] = "Michaela"
        right["given_name"] = "Mikaela"
        left["soc_sec_id"] = "5304218"
        right["soc_sec_id"] = "5304218"
        features = pair_features(left, right)
        self.assertEqual(set(features), set(FEATURE_COLUMNS))
        self.assertGreater(features["given_name_jaro_winkler"], 0.8)
        self.assertEqual(features["soc_sec_id_exact"], 1)
        self.assertEqual(features["surname_both_missing"], 1)
        self.assertEqual(features["surname_one_missing"], 0)
        self.assertNotIn("rec_id", features)
        self.assertNotIn("entity_id", features)
        self.assertNotIn("label", features)


if __name__ == "__main__":
    unittest.main()
