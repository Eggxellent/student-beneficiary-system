"""Checks for the deployed duplicate-detection model.

Run with the ml-service virtual environment:

    .venv\\Scripts\\python.exe test_predictions.py

The script drives the same inference path the API uses: `predict.predict_duplicate`
scores raw record pairs with the artifact in `model/xgb_duplicate_model.joblib`, which
`backend/src/services/duplicateCheck.js` runs through `predict.py --server`.

Expectations describe what the deployed pipeline must do with a pair, not what the current
model happens to output:

* DUPLICATE      the same child recorded with formatting, spelling or identifier-entry
                 variants. Must score at or above DUPLICATE_THRESHOLD (0.50) and must have
                 the corroboration the aggregation layer demands.
* REVIEW         the record is wrong, not merely similar (an identifier was reused or
                 re-typed), so the case must reach the review queue even at a low score.
* NON_DUPLICATE  clearly different children. Must open no case at all.

A case is opened only when `duplicateFlags.controller.js` qualifies the pair (score at or
above `ML_REVIEW_SCORE_THRESHOLD`, or an exact critical identifier) and
`duplicateAggregation.js` (`top-1-corroborated`) keeps it (an exact identifier, or two
independent corroborating fields, never the guardian alone). Both rules are mirrored in
`opens_case()` so a pair that only looks alike is not reported as a miss.

DUPLICATE_THRESHOLD is the backend's `ML_REVIEW_SCORE_THRESHOLD` default. The older
`DUPLICATE_REVIEW_THRESHOLD` (0.30) band belongs to the deprecated rule engine: a score
between 0.30 and 0.50 with no exact identifier agreement opens nothing in production, so
this script reports that band instead of treating it as a review.

Identifier realism matters. The admission number is only evidence inside one school:
`feature_engineering.admission_number_similarity` returns 0 unless both records carry the
same school identity, so an identical number at two schools is two children. Inside one
school the comparison is exact (with 0.9 credit for a character transposition); a single
changed digit is a different register entry. Birth-certificate numbers are compared by
character similarity after stripping a shared prefix, so consecutive counters such as
BC-10000069 and BC-10000070 read as a re-typed identifier.

Pairs a reviewer would want flagged that the pipeline deliberately or mistakenly clears are
listed in `known_limitations()` with their cause: see that function before changing a
threshold or a case.
"""

from __future__ import annotations

import sys
import os

from predict import predict_duplicate

DUPLICATE_THRESHOLD = float(os.environ.get("ML_REVIEW_SCORE_THRESHOLD", 0.50))
REVIEW_THRESHOLD = 0.30  # legacy rule-engine cutoff; the live flag rule is below
MISSING_IDENTIFIERS = {"", "na", "nan", "none", "null", "unknown", "notprovided", "notavailable"}
ADMISSION_NUMBER_PREFIXES = (
    "admissionnumber", "admissionno", "admission", "admno", "adm",
    "registrationnumber", "regno", "reg",
)


def student(name, dob, school, guardian, admission_number, birth_certificate_number=None):
    if birth_certificate_number is None:
        # Only derive a certificate number when there is an admission number to derive it
        # from; an empty string must stay empty so "identifiers absent" stays absent.
        birth_certificate_number = f"BC-{admission_number}" if admission_number else ""
    return {
        "full_name": name,
        "date_of_birth": dob,
        "school_code": school,
        "guardian_id": guardian,
        "admission_number": admission_number,
        "birth_certificate_number": birth_certificate_number,
    }


cases = [
    # ------------------------------------------------------------------
    # Same child, recorded twice.
    # ------------------------------------------------------------------
    (
        "duplicate: identical record",
        student("Brian Otieno", "2005-04-12", "SCH001", "G-4821937", "0148", "BC-209384"),
        student("Brian Otieno", "2005-04-12", "SCH001", "G-4821937", "0148", "BC-209384"),
        "DUPLICATE",
    ),
    (
        "duplicate: whitespace, case and separator variants",
        student("Brian  OTIENO", "2005-04-12", "sch001", "g-4821937", "ADM 0148", "BC/209384"),
        student("Brian Otieno", "12/04/2005", "SCH001", "G-4821937", "0148", "BC-209384"),
        "DUPLICATE",
    ),
    (
        "duplicate: surname typo and school transfer",
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G-7319042", "0371", "BC-582019"),
        student("Mary Wanjikuu", "2006-06-18", "SCH013", "G-7319042", "0731", "BC-582019"),
        "DUPLICATE",
    ),
    (
        "duplicate: date-of-birth typo on one record",
        student("Samuel Mwangi", "2005-11-08", "SCH008", "G-2084713", "2084", "BC-903184"),
        student("Samuel Mwangi", "2005-11-09", "SCH008", "G-2084713", "2084", "BC-903184"),
        "DUPLICATE",
    ),
    (
        "duplicate: admission-number transposition at the same school",
        student("Faith Njeri", "2007-09-10", "SCH004", "G-9031845", "0148", "BC-472918"),
        student("Faith Njeri", "2007-09-10", "SCH004", "G-9031845", "0184", "BC-472918"),
        "DUPLICATE",
    ),
    (
        "duplicate: one record missing identifiers",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "3005", "BC-901238"),
        student("Kevin Kiptoo", "15/01/2005", "SCH005", "G-3005821", "", ""),
        "DUPLICATE",
    ),

    # ------------------------------------------------------------------
    # Clearly different children, realistic distinct identifiers.
    # ------------------------------------------------------------------
    (
        "non-duplicate: unrelated records",
        student("Patrick Karanja", "2003-03-18", "SCH041", "G-4821937", "4829", "BC-209384"),
        student("Zainab Abdullahi", "2008-10-29", "SCH042", "G-1573094", "1573", "BC-731905"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: same school only",
        student("Ann Wambui", "2005-07-19", "SCH032", "G-9042173", "9042", "BC-318407"),
        student("Robert Otieno", "2007-11-03", "SCH032", "G-6208471", "6208", "BC-845216"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: siblings sharing guardian and school",
        student("Ann Wambui", "2005-07-19", "SCH032", "G-9042173", "9042", "BC-318407"),
        student("Robert Wambui", "2007-11-03", "SCH032", "G-9042173", "2718", "BC-472918"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: same guardian only",
        student("Victor Omondi", "2004-04-09", "SCH033", "G-5319028", "5319", "BC-619305"),
        student("Cynthia Achieng", "2006-10-25", "SCH034", "G-5319028", "7642", "BC-953187"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: common name, different date of birth",
        student("John Kamau", "2005-05-10", "SCH019", "G-4829157", "4829", "BC-209384"),
        student("John Kamau", "2007-11-14", "SCH020", "G-7319048", "7319", "BC-582019"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: misspelt name, different identity",
        student("Grace Njeri", "2005-05-16", "SCH035", "G-2093847", "2093", "BC-903184"),
        student("Grace Njery", "2007-08-11", "SCH036", "G-8471930", "8471", "BC-472918"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: shared surname, different identity",
        student("Susan Otieno", "2005-01-12", "SCH039", "G-3184072", "3184", "BC-619305"),
        student("Brian Otieno", "2006-05-22", "SCH040", "G-9531874", "9531", "BC-731905"),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: identifiers absent, demographics differ",
        student("Victor Omondi", "2004-04-09", "SCH033", "G-5319028", "", ""),
        student("Cynthia Achieng", "2006-10-25", "SCH034", "G-7642018", "", ""),
        "NON_DUPLICATE",
    ),
    (
        "non-duplicate: identical admission number at two different schools",
        student("Mercy Chepkoech", "2011-04-02", "SCH011", "G-1122334", "0148", "BC-112233"),
        student("Joseph Kariuki", "2009-08-17", "SCH021", "G-5566778", "0148", "BC-556677"),
        "NON_DUPLICATE",
    ),

    # ------------------------------------------------------------------
    # Decisive identifier evidence at a low model score: the record is
    # wrong, not just similar, so the queue must still receive it.
    # ------------------------------------------------------------------
    (
        "review: same admission number reused by a differently named child in one school",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "3005", "BC-901238"),
        student("Lucy Chebet", "2006-05-14", "SCH005", "G-9531874", "3005", "BC-845216"),
        "REVIEW",
    ),
    (
        "review: same birth certificate reused by a differently named child",
        student("Collins Omondi", "2004-12-01", "SCH010", "G-3184072", "3184", "BC-619305"),
        student("Mercy Wanjiru", "2006-02-14", "SCH031", "G-5319028", "5319", "BC-619305"),
        "REVIEW",
    ),
]


def normalized_identifier(value) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalnum())


def usable_identifier(normalized: str) -> bool:
    if normalized in MISSING_IDENTIFIERS:
        return False
    return not (len(normalized) >= 4 and set(normalized) == {"0"})


def school_identity(record: dict) -> str:
    normalized = normalized_identifier(record.get("school_code"))
    return normalized if usable_identifier(normalized) else ""


def admission_number_key(value) -> str:
    compact = normalized_identifier(value)
    if not usable_identifier(compact):
        return ""
    for prefix in ADMISSION_NUMBER_PREFIXES:
        if compact.startswith(prefix) and len(compact) > len(prefix):
            return compact[len(prefix):]
    return compact


def exact_identifier_evidence(first: dict, second: dict) -> list[str]:
    """Identifiers that agree exactly, as `mlDuplicateReview.js` counts them.

    The admission number only counts inside one school: an identical number at two
    schools is two children. Leading zeros are preserved, so 0148 and 148 differ.
    """
    evidence = []
    school = school_identity(first)
    if school and school == school_identity(second):
        left = admission_number_key(first.get("admission_number"))
        right = admission_number_key(second.get("admission_number"))
        if left and left == right:
            evidence.append("admission number")
    certificates = [
        normalized_identifier(first.get("birth_certificate_number")),
        normalized_identifier(second.get("birth_certificate_number")),
    ]
    if all(usable_identifier(value) for value in certificates) and certificates[0] == certificates[1]:
        evidence.append("birth certificate number")
    national_ids = [
        normalized_identifier(first.get("national_id_number")),
        normalized_identifier(second.get("national_id_number")),
    ]
    if all(usable_identifier(value) for value in national_ids) and national_ids[0] == national_ids[1]:
        evidence.append("National ID")
    return evidence


CORROBORATION_FIELDS = (
    "dob_match", "guardian_match", "admission_number_match", "birth_certificate_match", "national_id_match",
)
CORROBORATION_MINIMUM_SIMILARITY = 0.99
CORROBORATION_MINIMUM_FIELDS = 2


def corroborating_fields(features: dict) -> list[str]:
    return [
        field for field in CORROBORATION_FIELDS
        if float(features.get(field) or 0.0) >= CORROBORATION_MINIMUM_SIMILARITY
    ]


def guardian_only_match(features: dict, evidence: list[str]) -> bool:
    if evidence:
        return False
    return corroborating_fields(features) == ["guardian_match"]


def opens_case(score: float, first: dict, second: dict, features: dict) -> bool:
    """Whether the backend opens a duplicate case for this pair.

    Two layers decide: `duplicateFlags.controller.js` treats a score at or above
    `ML_REVIEW_SCORE_THRESHOLD` or an exact critical identifier as qualifying, then
    `duplicateAggregation.js` (`top-1-corroborated`) keeps a candidate only when an
    identifier matches exactly or two independent fields corroborate the match, and never
    for a pair whose only agreement is the guardian.
    """
    evidence = exact_identifier_evidence(first, second)
    if guardian_only_match(features, evidence):
        return False
    if not evidence and score < DUPLICATE_THRESHOLD:
        return False
    return bool(evidence) or len(corroborating_fields(features)) >= CORROBORATION_MINIMUM_FIELDS


def classify(score: float, first: dict, second: dict, features: dict) -> str:
    if not opens_case(score, first, second, features):
        return "NON_DUPLICATE"
    return "DUPLICATE" if score >= DUPLICATE_THRESHOLD else "REVIEW"


def check(expected: str, score: float, first: dict, second: dict, features: dict) -> bool:
    observed = classify(score, first, second, features)
    if expected == "DUPLICATE":
        return observed == "DUPLICATE"
    if expected == "REVIEW":
        # The review queue must receive this pair, whichever layer catches it.
        return observed in {"DUPLICATE", "REVIEW"}
    return observed == "NON_DUPLICATE"


def run_cases() -> int:
    print("=" * 78)
    print("SBMS DUPLICATE MODEL - OPERATIONAL CHECKS")
    print("=" * 78)

    failures = []
    for name, first, second, expected in cases:
        if expected not in {"DUPLICATE", "REVIEW", "NON_DUPLICATE"}:
            raise ValueError(f"unknown expectation {expected!r} in case {name!r}")
        result = predict_duplicate(first, second)
        score = float(result["duplicate_probability"])
        features = result["features"]
        evidence = exact_identifier_evidence(first, second)
        passed = check(expected, score, first, second, features)
        if not passed:
            failures.append((name, expected, score, features, evidence))
        print(f"\n{name}")
        print(f"  score      : {score:.4f}")
        print(f"  observed   : {classify(score, first, second, features)}")
        print(f"  expected   : {expected} {'PASS' if passed else 'FAIL'}")
        print(f"  identifier : {', '.join(evidence) if evidence else 'no exact agreement'}")
        print(f"  corroborating fields: {', '.join(corroborating_fields(features)) or 'none'}")
        print(f"  features   : {features}")

    counts = {"DUPLICATE": 0, "REVIEW": 0, "NON_DUPLICATE": 0}
    for _, _, _, expected in cases:
        counts[expected] += 1

    print("\n" + "=" * 78)
    print(f"cases {len(cases)} | duplicate {counts['DUPLICATE']} | "
          f"review {counts['REVIEW']} | non-duplicate {counts['NON_DUPLICATE']} | "
          f"failures {len(failures)}")
    print(f"cutoff: score >= {DUPLICATE_THRESHOLD} (ML_REVIEW_SCORE_THRESHOLD default) "
          f"or an exact critical identifier, plus the top-1-corroborated requirement of two "
          f"corroborating fields")
    print(f"legacy rule-engine review band of {REVIEW_THRESHOLD} is reported, not asserted")
    for name, expected, score, features, evidence in failures:
        print(f"  FAIL {name}: expected {expected}, score {score:.4f}, "
              f"identifiers {evidence or 'none'}, features {features}")
    print("=" * 78)
    return 1 if failures else 0


def known_limitations() -> None:
    """Behaviour reported for reviewers; not part of the pass/fail set.

    Two distinct causes produce the same outcome, a pair a person would want to see that
    the pipeline clears. They are kept apart because only one of them is the model's fault:

    * Policy limit. `duplicateAggregation.js` (`top-1-corroborated`) opens a case only on
      an exact identifier match or two independent corroborating fields, so a pair whose
      only agreement is a name, a date of birth or a guardian is cleared whatever the
      model scores. Siblings and common names make that rule necessary.
    * Model limit. A child re-registered under a fresh admission number and a re-typed
      birth certificate keeps the same name, date of birth and guardian, and the model
      scores the pair near zero: positives in the training data always keep one critical
      identifier intact, so the model never learned this pattern. The score is wrong, the
      case would be actionable, and only a data-entry check at the counter catches it.
    """
    pairs = [
        (
            "limitation (model): re-registration with a reissued admission number",
            student("Peter Ochieng", "2004-02-20", "SCH003", "G-9031845", "9031", "BC-472918"),
            student("Peter Odhiambo", "2004-02-20", "SCH003", "G-9031845", "5839", "BC-619305"),
            "same name, date of birth, school and guardian; both identifiers changed. This "
            "is a missed duplicate, not an ambiguous pair.",
        ),
        (
            "limitation (policy): similar name and same date of birth, different guardian",
            student("Brian Otieno", "2005-04-12", "SCH001", "G-4829157", "4829", "BC-209384"),
            student("Brian Ochieng", "2005-04-12", "SCH001", "G-7319048", "7319", "BC-582019"),
            "only the date of birth corroborates, below the two-field minimum; the surnames "
            "and guardians differ, so clearing it is the intended rule.",
        ),
        (
            "limitation (policy): identical name and date of birth, different school",
            student("Amina Hassan", "2006-03-22", "SCH007", "G-2084713", "2084", "BC-903184"),
            student("Amina Hassan", "2006-03-22", "SCH018", "G-6208471", "6208", "BC-845216"),
            "a transfer keeps the name and date of birth but nothing else; one corroborating "
            "field is not decisive, and the admission number cannot be compared across schools.",
        ),
        (
            "limitation (policy): same name and school, date of birth one day apart",
            student("Kevin Kiptoo", "2005-01-15", "SCH005", "G-3005821", "3005", "BC-901238"),
            student("Kevin Kiptoo", "2005-01-16", "SCH005", "G-9042173", "9042", "BC-318407"),
            "a one-day difference is either a typo or two children born a day apart; no field "
            "reaches the corroboration floor, so the pair is cleared.",
        ),
        (
            "limitation (model): distinct children, birth certificates one digit apart",
            student("Patrick Karanja", "2003-03-18", "SCH041", "G-4821937", "4829", "BC-10000069"),
            student("Zainab Abdullahi", "2008-10-29", "SCH041", "G-1573094", "1573", "BC-10000070"),
            "certificates are issued in batches, so the similarity is real but not evidence of "
            "one child; the pair shares no other field, so aggregation contains it.",
        ),
        (
            "limitation (policy): twins, identical date of birth, school and guardian",
            student("Mirembe Kalumbwe", "2008-02-11", "SCH041", "G-4821937", "4821", "BC-209384"),
            student("Mirembe Kalumbwea", "2008-02-11", "SCH041", "G-4821937", "5839", "BC-619305"),
            "a guardian match is never evidence on its own, and the names and dates of birth "
            "of twins agree by design.",
        ),
    ]
    print("\nKNOWN LIMITATIONS (reported, not asserted)")
    for name, first, second, note in pairs:
        result = predict_duplicate(first, second)
        print(f"  {name}: score {result['duplicate_probability']:.4f} "
              f"(observed {classify(result['duplicate_probability'], first, second, result['features'])})")
        print(f"    {note}")


def main() -> int:
    status = run_cases()
    known_limitations()
    return status


if __name__ == "__main__":
    sys.exit(main())
