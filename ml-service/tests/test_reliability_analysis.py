import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feature_engineering import FEATURE_COLUMNS
from reliability_analysis import metric_row, split_by_group, threshold_table


class ReliabilityAnalysisTest(unittest.TestCase):
    def setUp(self):
        rows = []
        for group in range(100):
            label = group % 2
            for pair in range(2):
                rows.append({"group_id": group, "label": label, **{column: float(label) for column in FEATURE_COLUMNS}})
        self.dataset = pd.DataFrame(rows)

    def test_group_holdout_keeps_pair_families_in_one_partition(self):
        train, validation, test = split_by_group(self.dataset)
        groups = [set(part.group_id) for part in (train, validation, test)]
        self.assertFalse(groups[0] & groups[1])
        self.assertFalse(groups[0] & groups[2])
        self.assertFalse(groups[1] & groups[2])
        self.assertEqual(sum(len(part) for part in (train, validation, test)), len(self.dataset))

    def test_threshold_table_reports_cases_entering_review(self):
        rows = threshold_table([0, 0, 1, 1], __import__("numpy").array([0.1, 0.45, 0.55, 0.95]))
        self.assertTrue(all("review_queue_cases" in row for row in rows))
        self.assertEqual([row["review_queue_cases"] for row in rows], [3, 3, 2, 1, 1])
        self.assertEqual(metric_row([0, 1], __import__("numpy").array([0.2, 0.8]), 0.5)["false_negatives"], 0)


if __name__ == "__main__":
    unittest.main()
