# Eligibility Rules

The SBMS eligibility score is calculated using five factors.

| Factor | Maximum Points |
|---|---:|
| Fee balance | 30 |
| Household income | 25 |
| Vulnerability status | 25 |
| Siblings in school | 10 |
| Prior bursary history | 10 |
| **Total** | **100** |

## Eligibility Categories

Need level, not an approval decision:

| Score | Category |
|---|---|
| 70-100 | High |
| 40-69 | Moderate |
| 0-39 | Low |

## Recommended Bursary Amount Ranges

Each category maps to a cash range shown next to the result. Ranges are
configuration, not policy: the system ships no NG-CDF allocation limits of its own.

- Configure approved ranges with the server environment variables
  `ELIGIBILITY_RANGE_HIGH_MIN`/`_MAX`, `ELIGIBILITY_RANGE_MODERATE_MIN`/`_MAX`,
  `ELIGIBILITY_RANGE_LOW_MIN`/`_MAX`.
- When any of those six values is missing (or `max < min`), the built-in figures
  are used and every response is flagged `recommended_range.provisional = true`,
  so the UI labels them as a provisional proposal.
- Built-in provisional figures: High KSh 15,000-25,000, Moderate KSh 8,000-15,000,
  Low KSh 3,000-8,000.

## Student Requirement

An assessment cannot be calculated without a registered student. `student_id` is
mandatory in `POST /api/eligibility`; the result is written to that student's
`eligibility_score`, `eligibility_category` and `eligibility_assessed_at`, and an
`ELIGIBILITY_CALCULATED` entry is written to the audit log.

The result is a recommendation for the authorised officer. It never approves a
bursary: approval stays a separate, explicit awards action.

## Scoring Rules

### Fee Balance
- KSh 50,000 or more = 30 points
- KSh 30,000-49,999 = 25 points
- KSh 15,000-29,999 = 15 points
- Below KSh 15,000 = 5 points if a balance exists

### Household Income
- KSh 20,000 or below = 25 points
- KSh 20,001-40,000 = 20 points
- KSh 40,001-60,000 = 10 points
- Above KSh 60,000 = 0 points

### Vulnerability
- High = 25 points
- Medium = 15 points
- Low = 5 points

### Siblings in School
- 4 or more = 10 points
- 2-3 = 7 points
- 1 = 3 points
- 0 = 0 points

### Prior Bursary History
- None = 10 points
- Low = 7 points
- High = 2 points
