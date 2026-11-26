import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feature_engineering import FEATURE_COLUMNS, build_pair_features
from predict import load_model, predict_pairs
from review_evidence import build_review_evidence, dob_similarity, identifier_similarity, name_similarity


class ReviewEvidenceTests(unittest.TestCase):
    def test_reordered_abbreviated_and_typoed_names_are_compared_by_tokens(self):
        self.assertGreaterEqual(name_similarity("Michael Omollo Achieng", "Achieng O. Michael"), 0.88)
        self.assertGreaterEqual(name_similarity("Faith Wanjiru Mwangi", "Faith W. Mwangi"), 0.88)
        self.assertLess(name_similarity("Amina Wanjiku", "Brian Otieno"), 0.82)

    def test_dob_supports_text_formats_day_errors_transposition_and_year_errors(self):
        self.assertEqual(dob_similarity("2010-09-22", "22 September 2010"), 1.0)
        self.assertEqual(dob_similarity("2010-09-22", "2010-09-23"), 0.9)
        self.assertEqual(dob_similarity("2010-09-12", "2010-09-21"), 0.76)
        self.assertEqual(dob_similarity("2010-09-22", "2011-09-22"), 0.68)
        self.assertEqual(dob_similarity("2010-09-22", "2007-01-04"), 0.0)

    def test_dob_uses_strict_mm_dd_and_marks_month_day_swap_as_weak(self):
        self.assertEqual(dob_similarity("06/07/2011", "07/06/2011"), 0.76)
        self.assertEqual(dob_similarity("31/12/2011", "12/31/2011"), 0.0)
        self.assertEqual(dob_similarity("02/30/2011", "2011-02-30"), 0.0)

    def test_identifiers_preserve_zeroes_and_reject_unbounded_rearrangements(self):
        self.assertEqual(identifier_similarity("28416", "28146"), 0.88)
        self.assertEqual(identifier_similarity("0361358260", "0361358620"), 0.88)
        self.assertEqual(identifier_similarity("00123456", "0123456"), 0.72)
        self.assertEqual(identifier_similarity("123456", "654321"), 0.0)

    def test_faith_wanjiru_case_routes_to_review_on_nonexact_identifier_evidence(self):
        original = {
            "full_name": "Faith Wanjiru Mwangi", "date_of_birth": "2010-09-23",
            "school_code": None, "school_name": "St. Anne's Girls Secondary",
            "guardian_id": "guardian-1", "guardian_name": "Mary Wanjiku",
            "admission_number": "57381", "birth_certificate_number": "0368246159",
        }
        submitted = {
            **original, "full_name": "Faith W. Mwangi", "date_of_birth": "2010-09-22",
            "admission_number": "57318", "birth_certificate_number": "0368246195",
        }
        evidence = build_review_evidence(submitted, original)
        self.assertTrue(evidence["near_match_review"])
        self.assertGreaterEqual(evidence["name"], 0.88)
        self.assertEqual(evidence["dob"], 0.9)
        self.assertEqual(evidence["birth_certificate"], 0.88)

    def test_ann_mwende_mutua_admission_transposition_is_review_evidence(self):
        original = {
            "full_name": "Ann Mwende Mutua", "date_of_birth": "2011-04-12",
            "school_code": "Nairobi School", "guardian_id": "guardian-a",
            "guardian_name": "Mary Wanjiku", "admission_number": "169613",
            "birth_certificate_number": "BC-12345678",
        }
        submitted = {
            **original, "full_name": "Ann M. Mutua", "admission_number": "169163",
        }
        evidence = build_review_evidence(submitted, original)
        self.assertTrue(evidence["near_match_review"])
        self.assertEqual(evidence["admission_number"], 0.88)

    def test_grace_wanjiku_mwangi_regression_uses_entered_code_and_two_ids(self):
        original = {
            "full_name": "Grace Wanjiku Mwangi", "date_of_birth": "2012-06-08",
            "school_name": "SCH-002", "guardian_id": "guardian-g",
            "guardian_name": "Jane Wanjiku", "admission_number": "28416",
            "birth_certificate_number": "0361358260",
        }
        submitted = {
            **original, "full_name": "Wanjiku M. Grace", "date_of_birth": "2012-07-06",
            "school_name": "SCH-020", "guardian_name": "Jane Wanjikuu",
            "admission_number": "28146", "birth_certificate_number": "0361358620",
        }
        evidence = build_review_evidence(submitted, original)
        self.assertTrue(evidence["near_match_review"])
        self.assertEqual(evidence["dob"], 0.0)  # actual stored dates are not a month/day reversal
        self.assertEqual(evidence["school_status"], "uncertain_possible_code_typo")
        self.assertEqual(evidence["school"], 0.72)
        self.assertEqual(evidence["admission_number"], 0.78)  # provisional under uncertain school identity
        self.assertEqual(evidence["birth_certificate"], 0.88)
        self.assertEqual(evidence["qualification_rule"], "strong_name_plus_two_identifiers")
        self.assertGreater(evidence["guardian"], 0.8)

    def test_registered_different_schools_block_admission_number_similarity(self):
        first = {"full_name": "Faith Wanjiru Mwangi", "date_of_birth": "2010-09-22", "school_code": "Nairobi School", "admission_number": "00123", "birth_certificate_number": "0368246159"}
        second = {**first, "school_code": "Alliance High", "admission_number": "00132", "birth_certificate_number": "9368240000"}
        evidence = build_review_evidence(first, second)
        self.assertEqual(evidence["school_status"], "different")
        self.assertEqual(evidence["admission_number"], 0.0)
        self.assertFalse(evidence["near_match_review"])

    def test_sibling_classmate_and_unrelated_school_negatives_do_not_route(self):
        sibling = {
            "full_name": "Brian Kiptoo Cheruiyot", "date_of_birth": "2010-06-12",
            "school_code": "SCH-009", "guardian_id": "shared-guardian",
            "guardian_name": "Mary Wanjiku", "admission_number": "A-1904",
            "birth_certificate_number": "0368246159",
        }
        sibling_pair = {
            **sibling, "full_name": "Brenda Kiptoo Cheruiyot", "admission_number": "A-1905",
            "birth_certificate_number": "1368246259",
        }
        self.assertFalse(build_review_evidence(sibling, sibling_pair)["near_match_review"])

        classmate = {
            **sibling, "guardian_id": "different-guardian", "full_name": "Brian Kiptoo",
            "admission_number": "A-9910", "birth_certificate_number": "9368247991",
        }
        classmate_pair = {
            **classmate, "guardian_id": "another-guardian", "admission_number": "A-9911",
            "birth_certificate_number": "9368247112",
        }
        self.assertFalse(build_review_evidence(classmate, classmate_pair)["near_match_review"])

        other_school = {
            **sibling, "school_code": "Alliance High", "guardian_id": "other-guardian",
            "admission_number": "X-4401", "birth_certificate_number": "0368246158",
        }
        self.assertFalse(build_review_evidence(sibling, other_school)["near_match_review"])

    def test_guardian_national_id_is_context_only_and_never_student_evidence(self):
        first = {
            "full_name": "Amina Hassan", "date_of_birth": "2011-05-14",
            "school_code": "SCH-009", "guardian_id": "shared-guardian",
            "guardian_name": "Mary Wanjiku", "guardian_national_id": "00123456",
            "admission_number": "ADM-1001", "birth_certificate_number": "0361001001",
        }
        unrelated_sibling = {
            **first, "full_name": "Brian Hassan", "date_of_birth": "2009-09-02",
            "admission_number": "ADM-1002", "birth_certificate_number": "0361001002",
        }
        evidence = build_review_evidence(first, unrelated_sibling)
        context = evidence["comparisons"]["guardian_context"]
        self.assertTrue(context["national_id_match"])
        self.assertEqual(context["evidence_role"], "guardian_context_only")
        self.assertFalse(evidence["near_match_review"])
        self.assertNotIn("00123456", repr(evidence))

    def test_guardian_national_id_mismatch_is_not_contradictory_student_evidence(self):
        first = {"full_name": "Amina Hassan", "guardian_national_id": "00123456"}
        second = {"full_name": "Amina Hassan", "guardian_national_id": "99123456"}
        evidence = build_review_evidence(first, second)
        context = evidence["comparisons"]["guardian_context"]
        self.assertFalse(context["national_id_match"])
        self.assertEqual(context["match_type"], "different_guardian_national_ids_context")
        self.assertFalse(evidence["near_match_review"])
        self.assertEqual(evidence["conflicts"], ["date_of_birth_not_corrobating"])

    def test_invalid_legacy_guardian_national_ids_are_unavailable(self):
        evidence = build_review_evidence(
            {"guardian_national_id": "N1234567"},
            {"guardian_national_id": "N1234567"},
        )
        self.assertFalse(evidence["comparisons"]["guardian_context"]["national_id_match"])
        self.assertEqual(evidence["comparisons"]["guardian_context"]["match_type"], "unavailable_or_invalid")

    def test_review_evidence_never_changes_model_inputs_or_feature_schema(self):
        first = {
            "full_name": "Faith Wanjiru Mwangi", "date_of_birth": "2010-09-23",
            "school_name": "St. Anne's Girls Secondary", "guardian_id": "guardian-1",
            "guardian_national_id": "00123456",
            "admission_number": "57381", "birth_certificate_number": "0368246159",
        }
        second = {
            **first, "full_name": "Faith W. Mwangi", "date_of_birth": "2010-09-22",
            "admission_number": "57318", "birth_certificate_number": "0368246195",
        }

        class RecordingModel:
            def predict_proba(self, frame):
                self.columns = list(frame.columns)
                self.values = frame.iloc[0].tolist()
                return np.array([[0.25, 0.75]])

        model = RecordingModel()
        result = predict_pairs([{"first": first, "second": second}], model)[0]
        expected = build_pair_features(first, second)
        self.assertEqual(model.columns, FEATURE_COLUMNS)
        self.assertEqual(list(result["features"]), FEATURE_COLUMNS)
        self.assertEqual(model.values, [expected[column] for column in FEATURE_COLUMNS])
        self.assertEqual(expected["dob_match"], 0.8)  # existing artifact semantics preserved
        self.assertTrue(result["review_evidence"]["near_match_review"])

    def test_production_artifact_receives_unchanged_six_feature_values(self):
        first = {
            "full_name": "Faith Wanjiru Mwangi", "date_of_birth": "2010-09-23",
            "school_name": "St. Anne's Girls Secondary", "guardian_id": "guardian-1",
            "admission_number": "57381", "birth_certificate_number": "0368246159",
        }
        second = {
            **first, "full_name": "Faith W. Mwangi", "date_of_birth": "2010-09-22",
            "admission_number": "57318", "birth_certificate_number": "0368246195",
        }
        prediction = predict_pairs([{"first": first, "second": second}], load_model())[0]
        expected = build_pair_features(first, second)
        self.assertEqual(list(prediction["features"]), FEATURE_COLUMNS)
        self.assertEqual(prediction["features"], expected)
        self.assertTrue(prediction["review_evidence"]["near_match_review"])


if __name__ == "__main__":
    unittest.main()
