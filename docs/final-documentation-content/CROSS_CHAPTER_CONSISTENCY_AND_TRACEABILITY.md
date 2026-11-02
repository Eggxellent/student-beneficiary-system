# CROSS-CHAPTER CONSISTENCY AND TRACEABILITY

> **What this file is.** The required consistency matrix between the earlier chapters (One to Three) and the
> evidence, the traceability chains that connect them to Chapters Four to Six, and the contradictions that need the
> author's decision. Repository `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`.
>
> **Limitation on the left-hand column.** Chapters 1–3 are **not in this repository**. Their content is represented
> here by the approved proposal (`Project Proposal- 169613.pdf`) as transcribed in
> `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §2 and by the cross-chapter checks already recorded in
> `EVIDENCE_AND_VERIFICATION_REPORT.md` §9. Any row marked **NOT INDEPENDENTLY VERIFIABLE** means the original
> wording could not be re-read here, not that it is wrong.

---

## 1. Consistency matrix

| Element | Original documentation | Verified implementation / evidence | Consistency status |
| --- | --- | --- | --- |
| Problem statement | Manual registration and tracking of beneficiaries is slow, error-prone and permits duplicate beneficiaries | Registration, screening, adjudication and payment-tracking modules all exist and are tested; the duplicate problem is addressed within a single registry | **CONSISTENT** — with the scope limit that cross-registry duplicates are out of scope (§1 of the catalogue) |
| General objective | Digitise registration, identification, verification and bursary tracking, with ML-assisted duplicate detection under human review | Three-tier system, 45 endpoints, 13 tables, advisory ML score, mandatory administrator decision | **CONSISTENT** |
| Specific objectives (i)–(iv) | Investigate challenges; design architecture, schema and ML pipeline with a Random Forest; implement registration, identifiers, QR and RBAC; validate and evaluate | Objective (i) as analysis; (ii) delivered with **XGBoost over six features**; (iii) delivered; (iv) partly delivered | **DRIFT on (ii)** — classifier altered; **PARTIAL on (iv)** — no real data, no UAT, no load test |
| Project scope | One registry, three roles, QR identification, awards, payments, certificates, reports | All present; six in-scope items remain gaps (FR-34…FR-37) and three proposal items are carried as deviations (FR-31…FR-33) | **CONSISTENT with declared exceptions** — every exception is numbered, none is silent |
| Functional requirements | Proposal §1.3 feature list, expanded into 37 numbered requirements in this package | 30 delivered (24 verified, 6 partial), 3 deviations, 4 gaps | **CONSISTENT** — the numbering is this package's, and it maps back in `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §6 |
| Non-functional requirements | Performance, security, usability, maintainability, availability expectations | 21 numbered NFRs; 14 verified, 7 partial; no load test, no usability study | **CONSISTENT with 7 partials** — the partials are named, not averaged away |
| Methodology | Design Science Research with Agile delivery (proposal §3.2–§3.3) | Artefact-centred build with iterative test-driven increments, evidenced by commit history and test growth (21/128 → 24/151) | **CONSISTENT** — the methods chapter's claim is supported by the build record, not contradicted by it |
| Technology choices | React frontend, Node/Express API, PostgreSQL, Python ML, Azure deployment | Exactly these (`frontend/`, `backend/`, `ml-service/`, `docs/deployment.md`, Azure logs) | **CONSISTENT** |
| ML methodology | Random Forest over four features (`jaro_winkler`, `dob_match`, `school_match`, `guardian_match`) | XGBoost over six features: the four above **minus** guardian-only framing plus `upi_match` and `birth_certificate_match`; the Random Forest survives only as a research candidate | **DRIFT** — must be stated in Chapters 4, 5 and 6 (G-21) |

### 1.1 Where the ML row needs care

The delivered feature set is `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `upi_match`,
`birth_certificate_match` — six features, of which three are the proposal's, one is a reformulation
(`guardian_match` now covers two guardian fields), and two are new identity signals. The research artifact
`ml-service/model/research/rf_attachment_style_candidate.joblib` is a ten-feature Random Forest and is **not** the
production model. A writer who mixes the two produces a contradiction that a supervisor can find in one page.

---

## 2. Traceability chains

| Chain | Link 1 (Chapter 1–3) | Link 2 (Chapter 4) | Link 3 (Chapter 5) | Link 4 (Chapter 6) |
| --- | --- | --- | --- | --- |
| Objective (i) | Proposal §1.1–§1.2, problem and challenges | §4.1–§4.2 requirement analysis | §5.5.2 evaluation of the objective | §6.2.3 |
| Objective (ii) | Proposal §1.3.1 ii, §3.2.3 | §4.4, §4.6, §4.7, §4.3.11 | §5.3.1–§5.3.4 | §6.2.4 |
| Objective (iii) | Proposal §1.3.1 iii–iv | §4.2.2 (FR-01…FR-30), §4.4.2–§4.4.3 | §5.3.2–§5.3.8, §5.4.3 | §6.2.5 |
| Objective (iv) | Proposal §1.3.1 v | §4.2.3 (NFR-01…NFR-21) | §5.4, §5.5, §5.6 | §6.2.6–§6.2.7 |
| Requirements | Proposal feature list | 37 FRs and 21 NFRs, numbered in this package | Test coverage per requirement (`SBMS_TEST_EVIDENCE_CATALOGUE.md` §3–§6) | §6.2.7 and §6.2.9 |
| Contribution | Proposal §1.4 (expected contribution) | §4.4.4 human-in-the-loop design | §5.5.5 ML evaluation and its limits | §6.2.8 |

`OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` carries the same chains at requirement granularity, including the
NFR table and the per-suite coverage matrix; this section is the chapter-level view.

---

## 3. Contradictions and drift requiring the author's confirmation

| # | Item | What contradicts what | What the author must do |
| --- | --- | --- | --- |
| C-1 | Classifier | Proposal: Random Forest, four features. Delivered: XGBoost, six features | Confirm the wording of the deviation in Chapters 4, 5 and 6 (already drafted) and in Chapter 3 if that chapter names the classifier |
| C-2 | Deployment architecture | Proposal/Chapter 3 describe a containerised ML service; the delivered path also runs the model as a subprocess inside the API host | State both paths, and which one the Azure deployment uses (G-22) |
| C-3 | `docs/verification.md` | Claims no controller calls the predictor; `students.controller.js:75` calls `scorePairs` | Mark the file superseded, or exclude it from the evidence base (G-08) |
| C-4 | `docs/uat-test-plan.md` | Reports five `PASS` results with no participants, and one sentence that contradicts the implementation | Reclassify as an author walkthrough, or run a study (G-06, G-07) |
| C-5 | Test totals | `docs/FINAL_TEST_REPORT.md` contains both 21/128 (2026-10-31) and 24/151 (2026-11-01) | Quote counts with their dates only (G-25) |
| C-6 | Objectives wording | The exact Chapter 1 sentences could not be re-read here | Paste the originals into Chapter 6 and check §6.2.3–§6.2.6 answer them verbatim, not by paraphrase |

No contradiction was resolved silently: each of the six is either stated in the drafts as a deviation, excluded
from the evidence base, or listed here for decision.

---

## 4. Naming consistency used across the package

| Name used | Meaning | Do not substitute |
| --- | --- | --- |
| `admin`, `field_officer` | The two role values in the code and database | Administrator/Field Officer only in prose, never as identifiers |
| `students`, `duplicate_flags`, `duplicate_review_events` | Tables | Never `beneficiaries` for the primary table |
| `bursary_awards`, `bursary_award_verification_events` | Award lifecycle | Never `awards` alone in a schema reference |
| `disbursements`, `disbursement_reconciliation_events` | Payment lifecycle | Never `payments` for the table |
| `bursary_certificates` | Certificate snapshot | Never `certificates` for the table |
| `audit_logs`, `reports` | Audit and reporting | — |
| `beneficiaries` (legacy) | Five legacy endpoints, kept for compatibility | Not part of the current design narrative |

---

## 5. Related files

`OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` (requirement-level traceability),
`EVIDENCE_AND_VERIFICATION_REPORT.md` §9 (the checks behind the matrix),
`SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §2 and §6 (proposal transcription and the FR register),
`ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` §4 (the same contradictions in gap form).

