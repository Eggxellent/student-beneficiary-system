"""Single source of truth for the six synthetic-pair model inputs."""

from __future__ import annotations

import re
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


def clean_name(value: object) -> str:
    return re.sub(r"[^a-z]", "", str(value or "").lower())


def exact_match(first: object, second: object) -> int:
    left = str(first or "").strip()
    right = str(second or "").strip()
    return int(bool(left and right and left == right))


def build_pair_features(first: Mapping[str, object], second: Mapping[str, object]) -> dict[str, float | int]:
    return {
        "jaro_winkler": jellyfish.jaro_winkler_similarity(
            clean_name(first.get("full_name")), clean_name(second.get("full_name"))
        ),
        "dob_match": exact_match(first.get("date_of_birth"), second.get("date_of_birth")),
        "school_match": exact_match(first.get("school_code"), second.get("school_code")),
        "guardian_match": exact_match(first.get("guardian_id"), second.get("guardian_id")),
        "upi_match": exact_match(first.get("upi"), second.get("upi")),
        "birth_certificate_match": exact_match(
            first.get("birth_certificate_number"), second.get("birth_certificate_number")
        ),
    }
