"""Checks for the deployed duplicate-detection model.

Run with the ml-service virtual environment:

    .venv\\Scripts\\python.exe test_predictions.py

The script drives the same inference path the API uses: `predict.predict_duplicate`
scores raw record pairs with the artifact in `model/xgb_duplicate_model.joblib`, which
`backend/src/services/duplicateCheck.js` runs through `predict.py --server`.

Expectations are semantic, not fitted to the current output:

* DUPLICATE      the same child recorded with formatting, spelling or identifier-entry
                 variants. Must score at or above DUPLICATE_THRESHOLD (0.50).
* NON_DUPLICATE  clearly different children. Must stay below REVIEW_THRESHOLD (0.30,
                 matching the backend's DUPLICATE_REVIEW_THRESHOLD default) so no review
                 case is opened for them.
* REVIEW         demographic overlap that only a human can resolve. Must reach
                 REVIEW_THRESHOLD; silently clearing such a pair would hide a possible
                 duplicate.

Identifier realism matters. `feature_engineering._identifier_similarity` compares the
characters of an identifier after stripping a shared field prefix, so consecutive
counters such as UPI-10000011 and UPI-10000012 are 0.90 similar. That describes a typo of
one UPI, not two different children, so NON_DUPLICATE and REVIEW cases use distinct,
non-sequential identifiers.

Rare prefixes are not evidence: see `known_limitations()` for behaviour this script
reports without asserting, so a future model change cannot silently hide it either.
"""

from __future__ import annotations

import sys

from predict import predict_duplicate

DUPLICATE_THRESHOLD = 0.50
REVIEW_THRESHOLD = 0.30


def student(name, dob, school, guardian, upi, birth_certificate_number=None):
    return {
        "full_name": name,
        "date_of_birth": dob,
        "school_code": school,
        "guardian_id": guardian,
        "upi": upi,
        "birth_certificate_number": birth_certificate_number or f"BC-{upi}",
    }


cases = [
    # ------------------------------------------------------------------
    # Same child, recorded twice.
    # ------------------------------------------------------------------
    (
        "duplicate: identical record",
        student("Brian Otieno", "2005-04-12", "SCH001", "G-4821937", "UPI-482915731", "BC-209384"),
        student("Brian Otieno", "2005-04-12", "SCH001", "G-4821937", "UPI-482915731", "BC-209384"),
        "DUPLICATE",
    ),
    (
        "duplicate: whitespace, case and separator variants",
        student("Brian  OTIENO", "2005-04-12", "sch001", "g-4821937", "UPI 482915731", "BC/209384"),
        student("Brian Otieno", "12/04/2005", "SCH001", "G-4821937", "UPI-482915731", "BC-209384"),
        "DUPLICATE",
    ),
    (
        "duplicate: surname typo and school transfer",
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G-7319042", "UPI-731904825", "BC-582019"),
        student("Mary Wanjikuu", "2006-06-18", "SCH013", "G-7319042", "UPI-731904825", "BC-582019"),
        "DUPLICATE",
    ),
    (
        "duplicate: date-of-birth typo on one record",
        student("Samuel Mwangi", "2005-11-08", "SCH008", "G-2084713", "UPI-208471396", "BC-903184"),
        student("Samuel Mwangi", "2005-11-09", "SCH008", "G-2084713", "UPI-208471396", "BC-903184"),
        "DUPLICATE",
    ),
    (
        "duplicate: identifiers reissued, demographics identical",
        student("Faith Njeri", "2007-09-10", "SCH004", "G-9031845", "UPI-903184527", "BC-472918"),
        student("Faith Njeri", "2007-09-10", "SCH004", "G-9031845", "UPI-583920174", "BC-619305"),
        "DUPLICATE",
    ),
    (
        "duplicate: one record missing identifiers",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "UPI-300582147", "BC-901238"),
        student("Kevin Kiptoo", "15/01/2005", "SCH005", "G-3005821", "", ""),
        "DUPLICATE",
    ),

    # ------------------------------------------------------------------
    # Clearly different children, realistic distinct identifiers.
    # ------------------------------------------------------------------
    (
        "non-duplicate: unrelated records",
        student("Patrick Karanja", "2003-03-18", "SCH041", "G-4821937", "UPI-482915731", "BC-209384"),
        student("Zainab Abdullahi", "2008-10-29", "SCH042", "G-1573094", "UPI-157309462", "BC-731905"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: same school only",
        student("Ann Wambui", "2005-07-19", "SCH032", "G-9042173", "UPI-904217365", "BC-318407"),
        student("Robert Otieno", "2007-11-03", "SCH032", "G-6208471", "UPI-620847193", "BC-845216"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: siblings sharing guardian and school",
        student("Ann Wambui", "2005-07-19", "SCH032", "G-9042173", "UPI-904217365", "BC-318407"),
        student("Robert Wambui", "2007-11-03", "SCH032", "G-9042173", "UPI-271849305", "BC-472918"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: same guardian only",
        student("Victor Omondi", "2004-04-09", "SCH033", "G-5319028", "UPI-531902847", "BC-619305"),
        student("Cynthia Achieng", "2006-10-25", "SCH034", "G-5319028", "UPI-764201893", "BC-953187"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: common name, different date of birth",
        student("John Kamau", "2005-05-10", "SCH019", "G-4829157", "UPI-482915731", "BC-209384"),
        student("John Kamau", "2007-11-14", "SCH020", "G-7319048", "UPI-731904825", "BC-582019"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: misspelt name, different identity",
        student("Grace Njeri", "2005-05-16", "SCH035", "G-2093847", "UPI-209384716", "BC-903184"),
        student("Grace Njery", "2007-08-11", "SCH036", "G-8471930", "UPI-847193052", "BC-472918"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: shared surname, different identity",
        student("Susan Otieno", "2005-01-12", "SCH039", "G-3184072", "UPI-318407295", "BC-619305"),
        student("Brian Otieno", "2006-05-22", "SCH040", "G-9531874", "UPI-953187420", "BC-731905"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: identifiers absent, demographics differ",
        student("Victor Omondi", "2004-04-09", "SCH033", "G-5319028", "", ""),
        student("Cynthia Achieng", "2006-10-25", "SCH034", "G-7642018", "", ""),
        "NON_DUPLICATE",
    ),

    # ------------------------------------------------------------------
    # Overlapping demographics: a human must decide, so the only safe
    # machine outcome is a review flag.
    # ------------------------------------------------------------------
    (
        "review: similar name, same date of birth and school",
        student("Brian Otieno", "2005-04-12", "SCH001", "G-4829157", "UPI-482915731", "BC-209384"),
        student("Brian Ochieng", "2005-04-12", "SCH001", "G-7319048", "UPI-731904825", "BC-582019"),
        "REVIEW",
    ),
    (
        "review: similar name, same date of birth, school and guardian",
        student("Peter Ochieng", "2004-02-20", "SCH003", "G-9031845", "UPI-903184527", "BC-472918"),
        student("Peter Odhiambo", "2004-02-20", "SCH003", "G-9031845", "UPI-583920174", "BC-619305"),
        "REVIEW",
    ),
    (
        "review: identical name and date of birth, different school",
        student("Amina Hassan", "2006-03-22", "SCH007", "G-2084713", "UPI-208471396", "BC-903184"),
        student("Amina Hassan", "2006-03-22", "SCH018", "G-6208471", "UPI-620847193", "BC-845216"),
        "REVIEW",
    ),
    (
        "review: same name and school, date of birth one day apart",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "UPI-300582147", "BC-901238"),
        student("Kevin Kiptoo", "2005-01-16", "SCH005", "G-9042173", "UPI-904217365", "BC-318407"),
        "REVIEW",
    ),
    (
        "review: same UPI reused by a differently named child",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "UPI-300582147", "BC-901238"),
        student("Lucy Chebet", "2006-05-14", "SCH012", "G-9531874", "UPI-300582147", "BC-845216"),
        "REVIEW",
    ),
    (
        "review: same birth certificate reused by a differently named child",
        student("Collins Omondi", "2004-12-01", "SCH010", "G-3184072", "UPI-318407295", "BC-619305"),
        student("Mercy Wanjiru", "2006-02-14", "SCH031", "G-5319028", "UPI-531902847", "BC-619305"),
        "REVIEW",
    ),
]


def classify(score: float) -> str:
    if score >= DUPLICATE_THRESHOLD:
        return "DUPLICATE"
    if score >= REVIEW_THRESHOLD:
        return "REVIEW"
    return "NON_DUPLICATE"


def check(expected: str, score: float) -> bool:
    if expected == "DUPLICATE":
        return score >= DUPLICATE_THRESHOLD
    if expected == "REVIEW":
        return score >= REVIEW_THRESHOLD
    return score < REVIEW_THRESHOLD


def run_cases() -> int:
    print("=" * 78)
    print("SBMS XGBOOST DUPLICATE MODEL - OPERATIONAL CHECKS")
    print("=" * 78)

    failures = []
    for name, first, second, expected in cases:
        if expected not in {"DUPLICATE", "REVIEW", "NON_DUPLICATE"}:
            raise ValueError(f"unknown expectation {expected!r} in case {name!r}")
        result = predict_duplicate(first, second)
        score = float(result["duplicate_probability"])
        passed = check(expected, score)
        if not passed:
            failures.append((name, expected, score, result["features"]))
        print(f"\n{name}")
        print(f"  score      : {score:.4f}")
        print(f"  observed   : {classify(score)}")
        print(f"  expected   : {expected} {'PASS' if passed else 'FAIL'}")
        print(f"  features   : {result['features']}")

    counts = {"DUPLICATE": 0, "REVIEW": 0, "NON_DUPLICATE": 0}
    for _, _, _, expected in cases:
        counts[expected] += 1

    print("\n" + "=" * 78)
    print(f"cases {len(cases)} | duplicate {counts['DUPLICATE']} | "
          f"review {counts['REVIEW']} | non-duplicate {counts['NON_DUPLICATE']} | "
          f"failures {len(failures)}")
    print(f"thresholds: duplicate >= {DUPLICATE_THRESHOLD}, "
          f"review >= {REVIEW_THRESHOLD}, non-duplicate < {REVIEW_THRESHOLD}")
    for name, expected, score, features in failures:
        print(f"  FAIL {name}: expected {expected}, score {score:.4f}, features {features}")
    print("=" * 78)
    return 1 if failures else 0


def known_limitations() -> None:
    """Behaviour reported for reviewers; not part of the pass/fail set.

    Distinct children whose identifiers are near-sequential share most of their
    identifier characters, so the model reads them as a re-typed identifier even when
    name, date of birth and guardian disagree. Real Kenyan UPI and birth-certificate
    numbers are issued in batches, so this pattern occurs in production data. The
    backend's `top-1-corroborated` aggregation only opens a case when an identifier
    matches exactly or two independent fields agree, which contains most of these
    pairs, but the scores themselves are not trustworthy evidence.
    """
    pairs = [
        (
            "limitation: distinct children, UPIs and birth certificates one digit apart",
            student("Patrick Karanja", "2003-03-18", "SCH041", "G-4821937", "UPI-10000069", "BC-10000069"),
            student("Zainab Abdullahi", "2008-10-29", "SCH041", "G-1573094", "UPI-10000070", "BC-10000070"),
        ),
        (
            "limitation: twins, identical date of birth, school and guardian",
            student("Mirembe Kalumbwe", "2008-02-11", "SCH041", "G-4821937", "UPI-482915731", "BC-209384"),
            student("Mirembe Kalumbwea", "2008-02-11", "SCH041", "G-4821937", "UPI-583920174", "BC-619305"),
        ),
    ]
    print("\nKNOWN LIMITATIONS (reported, not asserted)")
    for name, first, second in pairs:
        result = predict_duplicate(first, second)
        print(f"  {name}: score {result['duplicate_probability']:.4f} "
              f"(observed {classify(result['duplicate_probability'])})")


def main() -> int:
    status = run_cases()
    known_limitations()
    return status


if __name__ == "__main__":
    sys.exit(main())
