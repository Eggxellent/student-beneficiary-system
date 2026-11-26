"""Single source of truth for the six SBMS student-pair model inputs.

Production schema, in order:

    jaro_winkler, dob_match, school_match, guardian_match, admission_number_match,
    birth_certificate_match

`admission_number_match` replaces the earlier `upi_match` feature. The guardian
application form does not collect a UPI, so every record screened through the
guardian pipeline carried an empty UPI and the feature was constant zero. The
admission number is collected, but it is only meaningful inside one school: the
same number at two different schools is two different students. The comparison is
therefore gated on a matching school identity and never compares numbers across
schools.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from collections.abc import Mapping

import jellyfish

FEATURE_COLUMNS = [
    "jaro_winkler",
    "dob_match",
    "school_match",
    "guardian_match",
    "admission_number_match",
    "birth_certificate_match",
]


MISSING_VALUES = {"", "?", "NA", "N/A", "NONE", "NULL", "UNKNOWN", "NOT PROVIDED", "NOT AVAILABLE"}


def _text(value: object) -> str:
    text = str(value or "").strip()
    return "" if text.casefold() in {"nan", "none", "null"} else text


def _missing(value: object) -> bool:
    text = _text(value).upper()
    compact = re.sub(r"[^A-Z0-9]", "", text)
    return text in MISSING_VALUES or not compact or (len(compact) >= 4 and set(compact) == {"0"})


def clean_name(value: object) -> str:
    return re.sub(r"[^a-z]", "", _text(value).lower())


def _name_similarity(left: object, right: object) -> float:
    if _missing(left) or _missing(right):
        return 0.0
    left_tokens = re.findall(r"[a-z]+", _text(left).lower())
    right_tokens = re.findall(r"[a-z]+", _text(right).lower())
    if not left_tokens or not right_tokens:
        return 0.0
    direct = jellyfish.jaro_winkler_similarity("".join(left_tokens), "".join(right_tokens))
    reordered = jellyfish.jaro_winkler_similarity("".join(sorted(left_tokens)), "".join(sorted(right_tokens)))
    return float(max(direct, reordered))


def _dob_similarity(left: object, right: object) -> float:
    if _missing(left) or _missing(right):
        return 0.0
    # SBMS records use Kenyan day/month/year convention. Ambiguous US-style
    # dates are deliberately not treated as a confident match.
    patterns = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y")

    def parse(value: object) -> set[date]:
        text = _text(value)
        parsed: set[date] = set()
        for pattern in patterns:
            try:
                parsed.add(datetime.strptime(text, pattern).date())
            except ValueError:
                continue
        return parsed

    dates_left, dates_right = parse(left), parse(right)
    if not dates_left or not dates_right:
        return 0.0
    difference = min(abs((first - second).days) for first in dates_left for second in dates_right)
    if difference == 0:
        return 1.0
    if difference == 1:
        return 0.8
    if difference <= 7:
        return 0.5
    return 0.0


def exact_match(first: object, second: object) -> int:
    if _missing(first) or _missing(second):
        return 0
    left = re.sub(r"[^a-z0-9]", "", _text(first).casefold())
    right = re.sub(r"[^a-z0-9]", "", _text(second).casefold())
    return int(bool(left and right and left == right))


def _identifier_similarity(first: object, second: object) -> float:
    if _missing(first) or _missing(second):
        return 0.0
    left = re.sub(r"[^a-z0-9]", "", _text(first).casefold())
    right = re.sub(r"[^a-z0-9]", "", _text(second).casefold())
    # Ignore shared field prefixes (for example BC and G) so they don't inflate
    # similarity between unrelated identifiers.
    prefixes = ("guardian", "guard", "student", "bc", "g")
    for prefix in prefixes:
        if left.startswith(prefix):
            left = left[len(prefix):]
        if right.startswith(prefix):
            right = right[len(prefix):]
    # A value that was only a field prefix (for example "UPI-" or "BC-") carries no
    # identifier characters. Two of them must not become a perfect match.
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return float(jellyfish.jaro_winkler_similarity(left, right)) if left and right else 0.0


# Admission numbers are only comparable when both rows resolve to the same configured
# school code. Free-text school names are not a fallback because training and inference
# both use `school_code` for the school_match feature.
def school_identity(record: Mapping[str, object]) -> str:
    value = record.get("school_code")
    return "" if _missing(value) else re.sub(r"[^a-z0-9]", "", _text(value).casefold())


ADMISSION_PREFIXES = (
    "admissionnumber", "admissionno", "admission", "admno", "adm",
    "registrationnumber", "regno", "reg",
)


def admission_number_key(value: object) -> str:
    """Normalise an admission number without erasing its digits.

    Only presentation is removed: case, spaces, hyphens, slashes and a leading
    field prefix. Leading zeros are kept, because `0148` and `148` are different
    register entries and must not collapse into one value.
    """
    if _missing(value):
        return ""
    compact = re.sub(r"[^a-z0-9]", "", _text(value).casefold())
    for prefix in ADMISSION_PREFIXES:
        if compact.startswith(prefix) and len(compact) > len(prefix):
            compact = compact[len(prefix):]
            break
    return compact


def admission_number_similarity(first: Mapping[str, object], second: Mapping[str, object]) -> float:
    """School-aware admission-number comparison.

    Returns 0 unless both records belong to the same school, then 1.0 for an exact
    normalised match, 0.9 for a transposition of the same characters (the typo
    mode registers actually produce), and 0 for any other difference. A single
    changed digit is a different register entry, not a transcription slip, so it is
    never treated as a match.
    """
    # Keep this gate identical to the school-code semantics used during training.
    first_school = school_identity(first)
    second_school = school_identity(second)
    if not first_school or first_school != second_school:
        return 0.0
    left = admission_number_key(first.get("admission_number"))
    right = admission_number_key(second.get("admission_number"))
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if len(left) >= 3 and len(left) == len(right) and sorted(left) == sorted(right):
        return 0.9
    return 0.0


def build_pair_features(first: Mapping[str, object], second: Mapping[str, object]) -> dict[str, float | int]:
    return {
        "jaro_winkler": _name_similarity(first.get("full_name"), second.get("full_name")),
        "dob_match": _dob_similarity(first.get("date_of_birth"), second.get("date_of_birth")),
        "school_match": exact_match(first.get("school_code"), second.get("school_code")),
        "guardian_match": _identifier_similarity(first.get("guardian_id"), second.get("guardian_id")),
        "admission_number_match": admission_number_similarity(first, second),
        "birth_certificate_match": _identifier_similarity(
            first.get("birth_certificate_number"), second.get("birth_certificate_number")
        ),
    }
