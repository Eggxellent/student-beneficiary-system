"""Single source of truth for the six SBMS student-pair model inputs."""

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
    "upi_match",
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
    # Ignore shared field prefixes (for example UPI, BC, and G) so they don't
    # inflate similarity between unrelated identifiers.
    prefixes = ("guardian", "guard", "upi", "student", "bc", "g")
    for prefix in prefixes:
        if left.startswith(prefix):
            left = left[len(prefix):]
        if right.startswith(prefix):
            right = right[len(prefix):]
    if left == right:
        return 1.0
    return float(jellyfish.jaro_winkler_similarity(left, right)) if left and right else 0.0


def build_pair_features(first: Mapping[str, object], second: Mapping[str, object]) -> dict[str, float | int]:
    return {
        "jaro_winkler": _name_similarity(first.get("full_name"), second.get("full_name")),
        "dob_match": _dob_similarity(first.get("date_of_birth"), second.get("date_of_birth")),
        "school_match": exact_match(first.get("school_code"), second.get("school_code")),
        "guardian_match": _identifier_similarity(first.get("guardian_id"), second.get("guardian_id")),
        "upi_match": _identifier_similarity(first.get("upi"), second.get("upi")),
        "birth_certificate_match": _identifier_similarity(
            first.get("birth_certificate_number"), second.get("birth_certificate_number")
        ),
    }
