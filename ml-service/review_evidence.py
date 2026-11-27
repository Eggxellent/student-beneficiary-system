"""Separate, explainable near-match evidence for Admin review.

This module is intentionally outside the production model feature and probability
path. It emits comparison explanations and a review-only qualification decision.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime
from typing import Any

import jellyfish


def _compact(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())


def _tokens(value: Any) -> list[str]:
    return re.findall(r"[a-z]+", str(value or "").casefold())


def _token_score(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if min(len(left), len(right)) == 1 and left[0] == right[0]:
        return 0.88
    return float(jellyfish.jaro_winkler_similarity(left, right))


def _name_normalized(value: Any) -> str:
    return " ".join(_tokens(value))


def _name_match_type(left: Any, right: Any, similarity: float) -> str:
    first, second = _tokens(left), _tokens(right)
    if not first or not second:
        return "unavailable"
    if first == second:
        return "exact_tokens"
    if sorted(first) == sorted(second):
        return "reordered_tokens"
    initial_match = any(
        len(short) == 1 and any(long.startswith(short) for long in longer if len(long) > 1)
        for short in first + second
        for longer in (first, second)
    )
    exact_shared = set(first) & set(second)
    labels = []
    if initial_match:
        labels.append("middle_initial")
    if exact_shared and (len(first) != len(second) or initial_match):
        labels.append("omitted_or_reordered_tokens")
    if similarity >= 0.88 and not labels:
        labels.append("minor_spelling_variation")
    return "+".join(labels) if labels else "weak_or_different"


def name_similarity(left: Any, right: Any) -> float:
    """Order-independent, one-to-one token similarity with initials and small typos."""
    first, second = _tokens(left), _tokens(right)
    if not first or not second:
        return 0.0
    remaining = set(range(len(second)))
    scores = []
    for token in sorted(first, key=len, reverse=True):
        if not remaining:
            scores.append(0.0)
            continue
        index = max(remaining, key=lambda candidate: _token_score(token, second[candidate]))
        scores.append(_token_score(token, second[index]))
        remaining.remove(index)
    scores.extend([0.0] * len(remaining))
    return round(sum(scores) / max(len(first), len(second)), 4)


def _parse_dob(value: Any) -> date | None:
    """Parse known formats without guessing a locale for slash dates.

    SBMS form dates are MM/DD/YYYY. Database dates arrive as ISO YYYY-MM-DD.
    DD/MM/YYYY is deliberately not accepted because it silently changes meaning.
    """
    text = str(value or "").strip()
    patterns = (
        "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y",
        "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y",
    )
    for pattern in patterns:
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    # Accept an ISO timestamp emitted by a database driver; never reinterpret it.
    try:
        return date.fromisoformat(text[:10]) if re.match(r"^\d{4}-\d{2}-\d{2}(?:T|$)", text) else None
    except ValueError:
        return None


def _month_day_reversed(first: date, second: date) -> bool:
    try:
        return date(first.year, first.day, first.month) == second
    except ValueError:
        return False


def _adjacent_transposition(left: str, right: str) -> bool:
    if len(left) != len(right) or len(left) < 3:
        return False
    differences = [index for index, (a, b) in enumerate(zip(left, right)) if a != b]
    return (
        len(differences) == 2
        and differences[1] == differences[0] + 1
        and left[differences[0]] == right[differences[1]]
        and left[differences[1]] == right[differences[0]]
    )


def _dob_comparison(left: Any, right: Any) -> dict[str, Any]:
    first, second = _parse_dob(left), _parse_dob(right)
    result = {"similarity": 0.0, "match_type": "unavailable_or_invalid", "ambiguous": False}
    if not first or not second:
        return result
    if first == second:
        return {"similarity": 1.0, "match_type": "exact_calendar_date", "ambiguous": False}
    if _month_day_reversed(first, second) or _month_day_reversed(second, first):
        return {"similarity": 0.76, "match_type": "possible_month_day_transposition", "ambiguous": False}
    days = abs((first - second).days)
    if days == 1:
        return {"similarity": 0.9, "match_type": "one_day_difference", "ambiguous": False}
    if _adjacent_transposition(first.strftime("%Y%m%d"), second.strftime("%Y%m%d")):
        return {"similarity": 0.76, "match_type": "single_digit_transposition", "ambiguous": False}
    if first.month == second.month and first.day == second.day and abs(first.year - second.year) == 1:
        return {"similarity": 0.68, "match_type": "one_year_difference", "ambiguous": False}
    return result | {"match_type": "different_calendar_dates"}


def dob_similarity(left: Any, right: Any) -> float:
    """Compatibility wrapper returning only the review-evidence strength."""
    return float(_dob_comparison(left, right)["similarity"])


def _identifier_comparison(left: Any, right: Any, prefixes: tuple[str, ...] = (), minimum_length: int = 4) -> dict[str, Any]:
    first, second = _compact(left), _compact(right)
    for prefix in prefixes:
        if first.startswith(prefix) and len(first) > len(prefix):
            first = first[len(prefix):]
        if second.startswith(prefix) and len(second) > len(prefix):
            second = second[len(prefix):]
    result = {"similarity": 0.0, "match_type": "unavailable_or_different", "normalized": [first or None, second or None]}
    if not first or not second:
        return result
    if first == second:
        return result | {"similarity": 1.0, "match_type": "exact"}
    if len(first) == len(second) and len(first) >= minimum_length:
        if _adjacent_transposition(first, second):
            return result | {"similarity": 0.88, "match_type": "adjacent_transposition"}
        # Some transcriptions move more than one digit (e.g. 36897 -> 36798).
        # Treat equal-length numeric permutations as weak evidence only; the
        # caller still requires a strong name/DOB match and independent identifiers.
        changed_positions = sum(a != b for a, b in zip(first, second))
        if (
            first.isdigit() and second.isdigit()
            and len(first) >= max(5, minimum_length)
            and changed_positions in {2, 4}
            and Counter(first) == Counter(second)
        ):
            return result | {"similarity": 0.84, "match_type": "digit_rearrangement"}
        if sum(a != b for a, b in zip(first, second)) == 1:
            return result | {"similarity": 0.78, "match_type": "single_character_substitution"}
    # One insertion/deletion is weak evidence and only accepted for longer identifiers.
    if min(len(first), len(second)) >= minimum_length + 2 and abs(len(first) - len(second)) == 1:
        short, long = (first, second) if len(first) < len(second) else (second, first)
        if any(long[:i] + long[i + 1:] == short for i in range(len(long))):
            return result | {"similarity": 0.72, "match_type": "single_character_insertion_or_deletion"}
    return result


def _guardian_national_id_comparison(first: Any, second: Any) -> dict[str, Any]:
    """Compare only valid guardian account IDs and return match status, never the values.

    This is household context shared by siblings. It is deliberately not part of the
    student-specific signals or any near-match qualification rule.
    """
    valid_first = isinstance(first, str) and re.fullmatch(r"[0-9]{8}", first) is not None
    valid_second = isinstance(second, str) and re.fullmatch(r"[0-9]{8}", second) is not None
    if not valid_first or not valid_second:
        match_type = "unavailable_or_invalid"
    elif first == second:
        match_type = "same_guardian_national_id_context"
    else:
        match_type = "different_guardian_national_ids_context"
    return {
        "national_id_match": bool(valid_first and valid_second and first == second),
        "match_type": match_type,
        "evidence_role": "guardian_context_only",
    }


def identifier_similarity(left: Any, right: Any, prefixes: tuple[str, ...] = ()) -> float:
    return float(_identifier_comparison(left, right, prefixes)["similarity"])


_KNOWN_SCHOOLS = {
    "nairobischool", "alliancehigh", "bishopgatimu", "loretolimuru", "maranda",
}


def _school_value(record: dict[str, Any]) -> tuple[str, str]:
    resolved = _compact(record.get("school_code"))
    if resolved:
        return resolved, "resolved_school_code"
    # Guardian applications can contain an entered school code in school_name when
    # there is no resolved code column. Retain that value as uncertain context.
    entered = _compact(record.get("entered_school_code") or record.get("school_name"))
    return entered, "entered_school_code" if entered else "unavailable"


def _school_comparison(first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any]:
    left, source_left = _school_value(first)
    right, source_right = _school_value(second)
    info = {"similarity": 0.0, "status": "unavailable", "match_type": "unavailable", "sources": [source_left, source_right], "normalized": [left or None, right or None]}
    if not left or not right:
        return info
    if left == right:
        return info | {"similarity": 1.0, "status": "same", "match_type": "exact"}
    if left in _KNOWN_SCHOOLS and right in _KNOWN_SCHOOLS:
        return info | {"status": "different", "match_type": "distinct_registered_schools"}
    # A code-like value can be a typo, but edit similarity does not establish that
    # two institutions are equal. Keep it explicitly uncertain for Admin review.
    code_like = bool(re.fullmatch(r"[a-z]{2,}\d{2,}", left) and re.fullmatch(r"[a-z]{2,}\d{2,}", right))
    same_prefix = code_like and left[:re.search(r"\d", left).start()] == right[:re.search(r"\d", right).start()]
    left_digits = re.sub(r"\D", "", left)
    right_digits = re.sub(r"\D", "", right)
    if same_prefix and _adjacent_transposition(left, right):
        return info | {"similarity": 0.72, "status": "uncertain_possible_code_typo", "match_type": "adjacent_code_transposition"}
    # Some entry errors move a digit more than one place (for example SCH-900
    # entered as SCH-009). Keep this as uncertain context, never school equality.
    # Restrict to short numeric codes with identical digits to avoid fuzzy name matching.
    if same_prefix and 2 <= len(left_digits) <= 4 and left_digits != right_digits and sorted(left_digits) == sorted(right_digits):
        return info | {"similarity": 0.68, "status": "uncertain_possible_code_typo", "match_type": "digit_rearrangement"}
    return info | {"status": "different", "match_type": "different_school_values"}


def school_similarity(first: dict[str, Any], second: dict[str, Any]) -> float:
    return float(_school_comparison(first, second)["similarity"])


def build_review_evidence(first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any]:
    name = name_similarity(first.get("full_name"), second.get("full_name"))
    dob_detail = _dob_comparison(first.get("date_of_birth"), second.get("date_of_birth"))
    school_detail = _school_comparison(first, second)
    guardian_name = name_similarity(
        first.get("guardian_name") or first.get("guardian_full_name"),
        second.get("guardian_name") or second.get("guardian_full_name"),
    )
    guardian_id_a, guardian_id_b = _compact(first.get("guardian_id")), _compact(second.get("guardian_id"))
    guardian = 1.0 if guardian_id_a and guardian_id_a == guardian_id_b else guardian_name

    admission_detail = _identifier_comparison(
        first.get("admission_number"), second.get("admission_number"),
        ("admissionnumber", "admissionno", "admission", "admno", "adm", "registrationnumber", "regno", "reg"),
        minimum_length=4,
    )
    if school_detail["status"] in {"different", "unavailable"}:
        reason = "not_compared_different_school" if school_detail["status"] == "different" else "not_compared_school_unavailable"
        admission_detail |= {"similarity": 0.0, "match_type": reason}
    elif school_detail["status"] == "uncertain_possible_code_typo" and admission_detail["similarity"] > 0:
        # Preserve a limited provisional signal; never call the schools equivalent.
        admission_detail |= {"similarity": min(float(admission_detail["similarity"]), 0.78), "school_context": "uncertain"}
    else:
        admission_detail |= {"school_context": school_detail["status"]}
    certificate_detail = _identifier_comparison(
        first.get("birth_certificate_number"), second.get("birth_certificate_number"),
        ("birthcertificatenumber", "birthcertificate", "certificate", "bc"),
        minimum_length=7,
    )
    guardian_context = _guardian_national_id_comparison(
        first.get("guardian_national_id"), second.get("guardian_national_id")
    )

    admission = float(admission_detail["similarity"])
    certificate = float(certificate_detail["similarity"])
    dob = float(dob_detail["similarity"])
    independent_ids = [
        key for key, value in (("admission_number", admission), ("birth_certificate", certificate))
        if value >= 0.78
    ]
    strong_name = name >= 0.88
    name_and_dob_and_id = strong_name and dob >= 0.68 and bool(independent_ids)
    dual_identifier_route = name >= 0.90 and len(independent_ids) == 2
    shared_guardian = bool(guardian_id_a and guardian_id_a == guardian_id_b)
    # Same-household siblings often share school and may have close DOBs/common names.
    # For a shared guardian, one approximate identifier is insufficient unless the
    # names and DOB are effectively exact; two distinct student identifiers can still
    # raise a review case without letting guardian identity count as corroboration.
    guardian_safeguard_pass = (
        not shared_guardian
        or dual_identifier_route
        or (name >= 0.97 and dob >= 0.9 and bool(independent_ids))
    )
    common_name_collision = name >= 0.98 and dob >= 0.9 and school_detail["status"] == "same"
    collision_safeguard_pass = not (common_name_collision and len(independent_ids) < 2)
    different_school_safeguard_pass = not (
        school_detail["status"] == "different" and certificate < 1.0 and len(independent_ids) < 2
    )
    near_match = (
        (name_and_dob_and_id or dual_identifier_route)
        and guardian_safeguard_pass
        and collision_safeguard_pass
        and different_school_safeguard_pass
    )

    conflicts = []
    if dob_detail["match_type"] in {"different_calendar_dates", "unavailable_or_invalid"}:
        conflicts.append("date_of_birth_not_corrobating")
    if school_detail["status"] == "different":
        conflicts.append("schools_resolve_differently")
    if school_detail["status"] == "uncertain_possible_code_typo":
        conflicts.append("school_code_may_be_transposed")

    comparisons = {
        "name": {"similarity": name, "match_type": _name_match_type(first.get("full_name"), second.get("full_name"), name), "normalized": [_name_normalized(first.get("full_name")) or None, _name_normalized(second.get("full_name")) or None]},
        "date_of_birth": dob_detail | {"normalized": [_parse_dob(first.get("date_of_birth")).isoformat() if _parse_dob(first.get("date_of_birth")) else None, _parse_dob(second.get("date_of_birth")).isoformat() if _parse_dob(second.get("date_of_birth")) else None]},
        "school": school_detail,
        "guardian": {"similarity": guardian, "match_type": "context_only"},
        "admission_number": admission_detail,
        "birth_certificate": certificate_detail,
        "guardian_context": guardian_context,
    }
    signals = [key for key, detail in comparisons.items() if float(detail.get("similarity", 0)) > 0]
    return {
        "name": name,
        "dob": dob,
        "school": float(school_detail["similarity"]),
        "school_status": school_detail["status"],
        "guardian": guardian,
        "admission_number": admission,
        "birth_certificate": certificate,
        "near_match_review": bool(near_match),
        "qualification_rule": "strong_name_plus_dob_and_identifier" if name_and_dob_and_id else "strong_name_plus_two_identifiers" if dual_identifier_route else None,
        "suppression_reasons": [reason for applies, reason in (
            (shared_guardian and not guardian_safeguard_pass, "shared_guardian_requires_two_near_identifiers_or_very_strong_name_and_dob"),
            (common_name_collision and not collision_safeguard_pass, "common_name_same_dob_same_school_requires_two_near_identifiers"),
            (school_detail["status"] == "different" and not different_school_safeguard_pass, "different_schools_require_exact_certificate_or_two_independent_identifiers"),
        ) if applies],
        "signals": signals,
        "conflicts": conflicts,
        "comparisons": comparisons,
        "review_only": True,
    }
