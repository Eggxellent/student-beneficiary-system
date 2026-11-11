# Beneficiary processing workflow (intended design, agreed 2026-11-05)

This note records the intended SBMS workflow and maps each step to the code that implements it, so
the interface cannot drift back into describing payments. It is the reference for the wording used
in the UI, the API messages and the audit trail.

## Scope decision

**Selection of beneficiaries is outside SBMS.** The list of students selected or recommended for
NG-CDF bursary consideration is received and held by the Field Officer; SBMS starts when that list is
registered as student records. There is no `beneficiary_selections` table, no award period table and
no import endpoint for the supplied list. This was a deliberate scope decision, not an omission.

The distinction that matters is still enforced: **registering a student, or proposing an amount for
that student, never means the bursary award has been approved.**

## Steps and where they live

| # | Step | Implementation |
|---|---|---|
| 1 | Receive selected beneficiaries | Outside SBMS (paper/office list held by the Field Officer) |
| 2 | Register the student | `POST /api/students` (`students.routes.js`, `students.controller.js`); `StudentRegistration.jsx` |
| 3 | Duplicate detection | ML service + `duplicate_flags` rows created on registration (`services/duplicateCheck.js`) |
| 4 | Review duplicate flags | `/api/duplicate-flags`; `DuplicateReview.jsx`; statuses `pending`, `needs_verification`, `confirmed_duplicate`, `not_duplicate` |
| 5 | Verify beneficiary | `POST /api/awards/:id/verification`; evidence reference mandatory for a `verified` outcome |
| 6 | Propose and approve award | Field Officer `POST /api/awards` (status `submitted` = *proposed*); administrator `PATCH /api/awards/:id/decision` (`approved`/`rejected`) |
| 7 | Student QR code | `students.qr_token`; `POST /api/verify` answers `{ found }` only — it proves the record exists, never that an award was made |
| 8 | Issue certificate | Administrator `POST /api/awards/:id/certificate`; row in `bursary_certificates`; PDF + certificate QR (`AwardCertificatePanel.jsx`) |
| 9 | Public verification | `POST /api/certificates/verify`; `CertificateVerification.jsx` |

## Award states and their wording

The database keeps the value `submitted`, because changing it would need a data migration for no
behavioural gain. Every user-facing surface now says what it means:

| Stored value | UI / API wording | Meaning |
|---|---|---|
| `submitted` | "Proposed (awaiting approval)" | The officer entered an amount. Nothing is awarded. |
| `approved` | "Approved" | An authorised officer approved the award; it is a decision record, not a payment. |
| `rejected` | "Rejected" | An authorised officer rejected the proposal. |

Surfaces updated: `Awards.jsx` (heading, form labels, table columns, status chips),
`AdminDashboard.jsx` (award card "Proposed, awaiting approval"), `Reports.jsx` (report contents
list), and the API messages in `bursaryAwards.controller.js`.

## Separation of duties

- `POST /api/awards` and the verification route are `requireRole('field_officer')`.
- `PATCH /api/awards/:id/decision`, certificate issuing and revocation are `requireRole('admin')`.
- Approval additionally refuses `award.submitted_by === req.user.id`, so an officer who proposed the
  amount cannot approve it even if their role was later raised to administrator. Rejection is not
  blocked: withdrawing one's own proposal needs no second officer.

## Two QR codes, two purposes

| Student QR (`students.qr_token`) | Certificate QR (`bursary_certificates.verification_token`) |
|---|---|
| Identifies a student record | Identifies a bursary certificate |
| `POST /api/verify` → `{ found }` | `POST /api/certificates/verify` → validity of the certificate |
| Cannot prove an award exists | Proves an approved award, until the award is superseded |
| Never changes with award status | Stops verifying as current if the approved amount changes |

The certificate row is a snapshot: `approved_amount` and `student_name` are frozen at issue time, and
`publicView()` compares that snapshot with the live award (`award_status`, `award_live_amount`). A
certificate whose award was changed or is no longer `approved` answers `not_current`; an unknown
token or reference answers `not_recognised`. There is no revocation state: an issued certificate
keeps verifying for the life of its award.

## What the public verification page does not show

The published response is limited to: `valid`, `status`, `certificate_reference`, `award_period`,
`issued_at`, `award_approved_at` and `issuing_authority`. It deliberately omits the student's name,
UPI, school, date of birth, guardian contacts, addresses, supporting documents and any duplicate
detection detail, because the holder of the link may be anyone who scanned a printed certificate.

If a demonstrator requires the student name and school on the public page (as in the illustrative
mock-up), that is a deliberate disclosure decision that must be made explicitly: it changes
`publicView()` in `certificates.controller.js` and the privacy statement, and it should be recorded in
the risk register before the change is made.
