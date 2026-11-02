# ACADEMIC GUIDE REQUIREMENTS FOR CHAPTERS FOUR, FIVE AND SIX

> **Status of this file.** Records the academic structure the three chapters are written against, and separates what
> the School's documents actually prescribe from what this project inferred. Repository `student-beneficiary-system`,
> branch `fix/sbms-completion-work`, commit `d6b5032`.

---

## 1. Sources consulted, and their provenance

| Source | What it governs | Present in the repository at `d6b5032`? |
| --- | --- | --- |
| `ICS Project II Proposal Guide 2026_V1.docx` (School template) | Report structure, chapter list, formatting expectations | **No.** Consulted outside the repository; not version-controlled here |
| `Project Proposal- 169613.pdf` (approved SBMS proposal, 34 pages) | Objectives, scope, named technologies and the ML method the report must stay consistent with | **No**; the facts drawn from it are transcribed in `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §2 |
| `CHAPTER_4[1].docx` (Chapter 4 exemplar) | Section numbering and subsection pattern for Chapter 4 | **No** |

**Consequence, stated plainly.** Because none of the three source files is in the repository, no line of this
file can be presented as a verbatim quotation of the guide. What follows is the structure the chapters were
built to, with each requirement classified **PRESCRIBED** (the exemplar's own headings fix it), **INFERRED**
(the brief's chapter list implies it; the wording is not recoverable here) or **AMBIGUOUS** (the guide may
require it and this project could not read the requirement). An ambiguity is recorded, never resolved by
invention.

---

## 2. Chapter 4: prescribed structure

The exemplar fixes these headings; SBMS content is mapped to each.

| Guide heading | What the chapter must contain | Where it is written |
| --- | --- | --- |
| 4.1 Introduction | Purpose of the chapter, link to Chapters 1–3 | `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.1 |
| 4.2 Requirement Analysis | Functional, non-functional and data requirements; sources of requirements | §4.2.1–§4.2.5 |
| 4.3 System Analysis Diagrams | Context, use case, activity, class, sequence, ER, ML pipeline | §4.3.1–§4.3.11 |
| System Design | Architecture, modules, authentication, workflows, security, validation | §4.4.1–§4.4.7 |
| System Design Diagrams | Interface design, described so each screen can be reproduced without invention | §4.5.1–§4.5.8 |
| Database Schema | Tables, columns, types, keys, constraints, indexes, normalisation | §4.6.1–§4.6.3 |
| System Architecture | Physical deployment topology | §4.7 |
| Chapter summary | What the chapter established | §4.8 |

**PRESCRIBED** features the exemplar carries, and SBMS therefore includes: use-case description tables, at
least one activity diagram per principal workflow, and a class diagram with multiplicities.

**INFERRED** additions, kept because the brief asks for them and the exemplar's heading list does not forbid
them: ML-integration design (§4.4.4), security and privacy design (§4.4.6), validation and error handling
(§4.4.7), and the interface inventory (§4.5).

---

## 3. Chapter 5: structure applied

| Requirement | Status | Where |
| --- | --- | --- |
| Implementation environment, distinguishing development, test and production | **INFERRED**, satisfied | `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` §5.2.1–§5.2.4 |
| Implementation account per module with source references | **INFERRED**, satisfied | §5.3.1–§5.3.12 |
| Testing strategy by level (unit, integration, system, end-to-end, browser, security, performance, ML, acceptance) | **INFERRED**, satisfied with gaps | §5.4.1–§5.4.8 |
| Test-case tables with ID, requirement, scenario, preconditions, steps, expected, actual, status, evidence | **AMBIGUOUS** that the guide mandates this exact column set; adopted because it forces evidence per row | §5.4.3; `SBMS_TEST_EVIDENCE_CATALOGUE.md` §3–§6 |
| ML evaluation separate from system testing | **INFERRED**, satisfied | §5.5.5; `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` |
| Evaluation against objectives and NFRs, plus limitations | **PRESCRIBED** by the practice of evaluating against objectives | §5.5.2–§5.5.4, §5.6 |

---

## 4. Chapter 6: structure applied

| Requirement | Status | Where |
| --- | --- | --- |
| Conclusions answering each specific objective from Chapter 1 | **PRESCRIBED** | `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` §6.2.3–§6.2.6 |
| Contribution of the project | **INFERRED** | §6.2.8 |
| Recommendations tied to a stakeholder and an action | **PRESCRIBED** in outline | §6.3.1–§6.3.5 |
| Future work, not used to hide unfinished current scope | **PRESCRIBED** in outline | §6.4.1–§6.4.10 |

The rule applied throughout Chapter 6: a requirement that was in scope and is not delivered is reported as a
gap (FR-34 … FR-37, §6.2.9); future work is reserved for what was never in scope.


---

## 5. Compliance matrix for this documentation package

| Guide expectation | Package response | Status |
| --- | --- | --- |
| Chapters built from implementation evidence, not from drafts | Every claim traced through `MASTER_EVIDENCE_REGISTER.md` | Met |
| Diagrams required by the guide | 24 figures specified with nine attributes each (`DIAGRAM_SPECIFICATIONS.md`) | Specified, not drawn |
| Screenshots of the running system | 12 screen figures specified | **Not produced** (G-03/G-04/G-05) |
| Test results with dates | Every count carries a date and a command (`SBMS_TEST_EVIDENCE_CATALOGUE.md` §2) | Met |
| User acceptance evidence, where the guide expects it | None exists; stated as a gap with the position the author must adopt | **Gap** (G-06) |
| Consistency with Chapters 1–3 | Consistency matrix; contradictions flagged, not rewritten (`CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md`) | Met, 6 items flagged |
| No invented results | Forbidden claims enumerated (`SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §4) | Met |

---

## 6. Ambiguities recorded rather than resolved

| # | Ambiguity | Why it matters | What the author must decide |
| --- | --- | --- | --- |
| A-1 | The guide's exact Chapter 5 subsection list was not available | Section order in Chapter 5 is inferred, not quoted | Confirm against the guide before submission |
| A-2 | Whether a test-case table must enumerate all 151 tests or may group them | The catalogue gives suite-level detail and names individual tests only where a claim depends on one | Confirm the expected granularity |
| A-3 | Whether screenshots must show the Azure deployment or a local instance | Affects the provenance caption of G-03/G-04 figures | Confirm, then capture accordingly |
| A-4 | Whether a user-acceptance section is mandatory | If it is, NFR-14 cannot be claimed and §5.5.6 stays empty | Confirm; see G-06 |
| A-5 | Formatting requirements (font, spacing, page limits, appendix rules) | Not recorded anywhere in the repository | Apply the School template at assembly |
| A-6 | Whether the confusion matrix must appear in the chapter body | It exists in `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §7 | Include it; cost is one table |

Nothing here blocks drafting. Each is a question for the author, not for the repository.

---

## 7. Related files

`SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md` §1–§29 is the consolidated evidence base;
`ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` records coverage and gaps; `CLAUDE_HANDOFF_GUIDE.md` gives the reading
order and the writing rules.
