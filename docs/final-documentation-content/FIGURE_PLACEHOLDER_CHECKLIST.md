# FIGURE PLACEHOLDER CHECKLIST

**Purpose.** Chapter 4 specifies twenty-four figures but contains no drawings: each position is marked
`[Insert Figure n: … here]` and followed by a written specification of what the figure must show. This
checklist is the working list for the drawing and screenshot pass, so that no figure is produced from
memory and none contradicts the implementation. It adds no new requirements to Chapter 4.

**Rules that apply to every figure**

1. Capture or draw against the revision documented in `EVIDENCE_AND_VERIFICATION_REPORT.md` §1
   (`fix/sbms-completion-work` @ `d6b5032`).
2. Screenshots use **synthetic data only** and must show no real beneficiary record (gap G-05). The
   production database currently holds two `E2E Probe` demonstration rows; remove them first (gap G-13).
3. Never show a password, JWT, `.env` value, connection string, database host or account
   administrator e-mail.
4. Use one viewport size for all screen captures and one export setting for all diagrams, so the figures
   look like one document (suggest 1440 × 900 for screens, PNG or SVG at print resolution for diagrams).
5. Keep the caption exactly as written in Chapter 4, beneath the figure, numbered as specified.
6. If a state cannot be captured (for example "rate limited" or "connection problem"), draw the state or
   omit the panel and say so in the caption rather than fabricating a screenshot.

---

## 1. Structure and behaviour diagrams (drawn from the specifications, not screenshots)

| Figure | Section | Title | Derived from | Must show | Status |
| --- | --- | --- | --- | --- | --- |
| 4.1 | §4.3.1 | System context diagram | Chapter 4 §4.3.1; five external interfaces in §4.2.5 | SBMS as one process; Field Officer and Administrator as human actors; phone scanner and public verifier outside; no NEMIS, bank or mobile-money actor | ☐ |
| 4.2 | §4.3.2 | Use case diagram | §4.2.2 requirement register | Three actors; the include/extend structure stated in §4.3.2; nothing the API cannot do | ☐ |
| 4.3 | §4.3.3 | Activity diagram — registration and screening | `students.controller.js`, `mlDuplicateReview.js`, `duplicateAggregation.js` | Two swimlanes; the decision that a flag never blocks registration | ☐ |
| 4.4 | §4.3.4 | Activity diagram — review, approval, payment gate | `duplicateFlags.controller.js`, `bursaryAwards.controller.js`, `disbursements.controller.js` | Both duplicate gates; the terminal confirmed-duplicate outcome | ☐ |
| 4.5 | §4.3.5 | Class diagram | `backend/src/models/*.js`, `schema.sql` | Classes, attributes, operations and multiplicities listed in §4.3.5 | ☐ |
| 4.6 | §4.3.6 | System sequence diagram — registration | `students.controller.js` | Message order: validate → compare → insert → flags → response | ☐ |
| 4.7 | §4.3.7 | Sequence diagram — review decision | `duplicateFlags.controller.js:452-503` | Append-only event; terminal states; no edit of the student record | ☐ |
| 4.8 | §4.3.8 | Sequence diagram — approval to certificate | Awards, disbursements and certificates controllers | Verification gate, duplicate gate, payment issue and clearance, certificate issue | ☐ |
| 4.9 | §4.3.9 | Sequence diagram — public verification | `verification.controller.js`, `certificates.controller.js` | Boolean- or attribute-only responses; rate limiting; no beneficiary data returned | ☐ |
| 4.10 | §4.3.10 | Entity-relationship diagram | `schema.sql` plus the 14 migrations | Chen notation with cardinalities; every attribute named in §4.6.2; the legacy `beneficiaries` table marked unreconciled | ☐ |
| 4.11 | §4.3.11 | ML duplicate-detection pipeline | `feature_engineering.py`, `predict.py`, `duplicateAggregation.js` | Two lanes (offline training, online serving); the six shared features; XGBoost as the deployed model | ☐ |
| 4.12 | §4.4.1 | Three-tier architecture | `index.js`, `routes/*`, `frontend/src/**`, `predict.py` | The predictor as a supervised child process; no direct database access from the browser | ☐ |

---

## 2. Screen figures (screenshots of the running application)

| Figure | Section | Title | Route to open | Must show | Status |
| --- | --- | --- | --- | --- | --- |
| 4.13 | §4.5.1 | Role-specific sign-in screen | `/login`, `/admin/login`, `/field-officer/login` | SBMS identity block; the role tabs; the wrong-role refusal message | ☐ |
| 4.14 | §4.5.2 | Field-officer student registry list | `/students` | Header with the signed-in role; search and filter; the columns listed in §4.5.2; no reveal control | ☐ |
| 4.15 | §4.5.2 | Eligibility assessment screen | `/eligibility` | The five inputs; the score, category and reasons the endpoint returns | ☐ |
| 4.16 | §4.5.3 | Student registration form | `/students/register` | Two-column name fields; every validated field; the school select limited to the five approved schools | ☐ |
| 4.17 | §4.5.3 | Screening confirmation panel | `/students/register` (after submit) | The recorded student, the screening outcome and the QR image; the statement that a flag does not reject the registration | ☐ |
| 4.18 | §4.5.4 | Administrator dashboard | `/dashboard` | Exactly the counters the endpoint returns; the six-month trend; recent activity | ☐ |
| 4.19 | §4.5.5 | Duplicate review queue with a case open | `/duplicate-review` | Paired records with identifiers **masked**; score; threshold and model version; decision form with mandatory reason | ☐ |
| 4.20 | §4.5.6 | Awards and disbursements with the certificate panel | `/disbursements` | Awards table; payment record; clearance, fail and cancel actions; acknowledgement; exceptions; certificate panel collapsed and expanded | ☐ |
| 4.21 | §4.5.7 | Administrative support screens | `/reports`, `/audit`, `/users`, `/settings` | The four panels and the controls listed in the table under the Figure 4.21 caption; never a password hash | ☐ |
| 4.22 | §4.5.8 | Public student-record verification page | `/verify` (the student QR target) | Minimal layout; the five states; the three explanatory bullets; **no** student data | ☐ |
| 4.23 | §4.5.8 | Public certificate verification page | `/verify-certificate` | The four outcome states; the certificate fields the endpoint returns; **no** name, UPI, school or amount | ☐ |

---

## 3. Deployment figure

| Figure | Section | Title | Derived from | Must show | Status |
| --- | --- | --- | --- | --- | --- |
| 4.24 | §4.7 | Physical deployment architecture on Azure | `docs/azure-deployment-log-2026-10-31.md`; `Dockerfile`; `.github/workflows/` | Static web app, container app, managed PostgreSQL, the ML artefact shipped inside the API image, the CI image gates, and the HTTPS-only public origins | ☐ |

---

## 4. Checks before the figures are considered complete

| Check | Why it matters |
| --- | --- |
| Caption text matches Chapter 4 word for word | The specification is the control; a reworded caption usually means a redrawn figure |
| Figure number and section agree | Cross-references elsewhere in the report resolve by number |
| No screenshot contradicts the code at `d6b5032` | Behaviour changed late (registration fields, certificate panel), so older captures are stale |
| Nothing appears that the specification says must not appear | Figures 4.19–4.23 are where a leak of personal data would be a real finding, not a cosmetic slip |
| Every figure is referenced in the text before it appears | Academic convention in the report format |

**Note on Figure 4.21.** Its specification is the table that follows the caption in §4.5.7, which states
the four panels and the controls each must show; the checklist row above summarises it rather than
replacing it.

---

## 5. Related files in this folder

| File | Relationship to the figures |
| --- | --- |
| `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` | Holds the twenty-four specifications that the figures must realise |
| `EVIDENCE_AND_VERIFICATION_REPORT.md` §1 | Fixes the revision and therefore the behaviour that may be photographed |
| `DOCUMENTATION_GAP_REGISTER.md` G-03, G-04, G-05, G-13 | Record the fact that the figures are outstanding and the data-safety conditions attached to them |
| `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §3 | Maps each figure to the requirements it explains, for the reader who checks coverage |
| `DIAGRAM_SPECIFICATIONS.md` | The consolidated register: all twenty-four figures with type, elements, flow, boundary, decision points, implementation reference and drawing rules — use it when drawing, this file when capturing |

