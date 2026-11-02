# CLAUDE HANDOFF GUIDE: HOW TO WRITE CHAPTERS 4, 5 AND 6 FROM THIS PACKAGE

> **Audience.** An AI assistant or the author, writing the three chapters from this evidence set. Repository
> `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`. Nothing in this package refers
> to any other commit unless it says so.

---

## 1. Read in this order

| Order | File | Why |
| --- | --- | --- |
| 1 | `ACADEMIC_GUIDE_REQUIREMENTS.md` | The structure to write into, and the six ambiguities you must not resolve by invention |
| 2 | `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` | What may not be claimed. Read this before drafting a single sentence |
| 3 | `CHAPTER_4_…_EVIDENCE.md`, `CHAPTER_5_…_EVIDENCE.md`, `CHAPTER_6_…_EVIDENCE.md` | The evidence for each chapter, with the section pointers |
| 4 | The drafted chapter you are editing (`CHAPTER_4_…`, `CHAPTER_5_…`, `CHAPTER_6_…`) | The prose already exists; improve it rather than rewriting from scratch |
| 5 | `MASTER_EVIDENCE_REGISTER.md` | Evidence IDs and statuses for any claim you add |
| 6 | `CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md` | Keeps Chapters 4–6 consistent with 1–3 and with each other |
| 7 | `DIAGRAM_SPECIFICATIONS.md`, `FIGURE_PLACEHOLDER_CHECKLIST.md` | Figures: what must be drawn or captured |
| 8 | `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md`, `DOCUMENTATION_GAP_REGISTER.md` | What is still missing, ranked by risk |

The twelve deep catalogues (the `SBMS_…` files with suffixes `CATALOGUE`, `DOCUMENTATION`, `GUIDE` and `INVENTORY`)
are reference material: consult them per section, do not summarise them wholesale into the chapters.

---

## 2. The file set and what each file is for

| File | Role |
| --- | --- |
| `ACADEMIC_GUIDE_REQUIREMENTS.md` | Guide structure, compliance matrix, ambiguities |
| `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN_EVIDENCE.md` | Chapter 4 evidence entry point |
| `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION_EVIDENCE.md` | Chapter 5 evidence entry point |
| `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORK_EVIDENCE.md` | Chapter 6 evidence entry point |
| `CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md` | Consistency matrix, traceability chains, contradictions |
| `DIAGRAM_SPECIFICATIONS.md` | All 24 figures, attributes and drawing rules |
| `MASTER_EVIDENCE_REGISTER.md` | 51 evidence IDs with locations and statuses |
| `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` | Coverage, missing evidence, secret check |
| `CLAUDE_HANDOFF_GUIDE.md` | This file |
| `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` | The drafted chapter (1 176 lines) |
| `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` | The drafted chapter (838 lines) |
| `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` | The drafted chapter (322 lines) |
| `SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md` | The consolidated evidence report, §1–§29 |
| `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` | 37 FRs, 21 NFRs, business rules |
| `SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md` | Modules, flows, decisions |
| `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` | 13 tables, columns, state machines |
| `SBMS_API_ENDPOINT_CATALOGUE.md` | 45 endpoints |
| `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` | Features, artifact, metrics, limits |
| `SBMS_TEST_EVIDENCE_CATALOGUE.md` | Every test artefact with date and command |
| `SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md` | Controls and residual risk |
| `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` | Azure resources, pipeline, runbook |
| `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md` | Screens and workflows |
| `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` | Evidence tiers and forbidden claims |
| `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` | Objective → requirement → test → conclusion |
| `DOCUMENTATION_GAP_REGISTER.md` | Item-level gaps G-01…G-28 |
| `EVIDENCE_AND_VERIFICATION_REPORT.md` | Claim-level inspection record |
| `FIGURE_PLACEHOLDER_CHECKLIST.md` | Capture and insertion checklist |

Two tiers, deliberately: the first nine files are the entry set a writer reads; the rest is the evidence they point
into. Do not duplicate content between tiers — cite it.

## 3. Non-negotiable writing rules

1. **No claim without a location.** Every factual sentence must trace to a file, route, migration, test or log, or to
   an evidence ID. If it cannot, it is deleted, not softened.
2. **Use the six statuses exactly.** VERIFIED AND IMPLEMENTED, VERIFIED BUT NOT IMPLEMENTED, TESTED AND PASSED,
   TESTED AND FAILED, NOT TESTED, UNKNOWN / REQUIRES CONFIRMATION. No seventh status, no "mostly".
3. **Counts carry dates and commands.** "151 tests" is wrong; "151 tests, `npx jest --runInBand tests`, 2026-11-01"
   is right. Never add counts across levels.
4. **Synthetic means synthetic.** Every ML metric is pair-level on generated data. Never write "the model is
   accurate", "the system detects duplicates correctly in practice", or any real-world accuracy claim.
5. **The human gate is the control.** Never describe the model as deciding a duplicate.
6. **Gaps stay visible.** FR-34…FR-37 and the partial requirements are reported, never absorbed into a success
   narrative or moved to future work to look complete.
7. **Deviations are stated once and kept.** The Random Forest → XGBoost change (G-21) appears in Chapters 4, 5 and 6
   in the same words.
8. **Do not renumber figures or tables.** Figures 4.1–4.24, tables as numbered in the drafts.
9. **Do not invent citations.** Chapters 4–6 add no literature claims; a needed citation belongs in Chapters 1–3 and
   must be verified by the author.
10. **Do not print secrets.** No key, token, password, connection string or real personal data, ever.

---

## 4. Drafting workflow per chapter

| Step | Action |
| --- | --- |
| 1 | Open the chapter draft and the matching `…_EVIDENCE.md` side by side |
| 2 | For each section, copy the evidence row, not the prose: the fact, the location, the limitation |
| 3 | Write the sentence so that the limitation survives editing. If the limitation would have to be cut for the sentence to read well, the sentence is too strong |
| 4 | Check the figure callouts against `DIAGRAM_SPECIFICATIONS.md`; every figure number used must exist there |
| 5 | Check requirement numbers against `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §6–§8; never invent an FR or NFR number |
| 6 | Re-read `ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md` §4 to confirm you have not silently closed a gap |
| 7 | Run the five-minute self-check in §6 below |

## 5. Phrases to use, and phrases to avoid

| Avoid | Write instead |
| --- | --- |
| "The model accurately detects duplicates" | "The model ranks candidate pairs; an administrator decides" |
| "95% accuracy" | "Precision 0.9204, recall 0.8927 on a synthetic test partition at a 0.50 cut-off" |
| "The system was validated with users" | "No user acceptance study was conducted (G-06)" |
| "The system is deployed in production" | "A demonstration instance is deployed on Azure App Service" |
| "All tests pass" | "24 suites / 151 tests passed on 2026-11-01 under the command shown" |
| "The QR code was tested on a phone" | "QR verification was exercised in a headless browser; no phone capture exists (G-11)" |
| "Random Forest-based duplicate detection" | "An XGBoost classifier over six features; the proposal's Random Forest survives as a research candidate" |
| "Requirements fully met" | "24 of 30 delivered requirements verified, 6 partial, 4 in-scope gaps" |

## 6. Five-minute self-check before handing a chapter back

1. Every figure and table referenced exists and is numbered consistently.
2. Every number in the chapter appears in `MASTER_EVIDENCE_REGISTER.md`, `SBMS_TEST_EVIDENCE_CATALOGUE.md` or
   `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` with the same value.
3. No sentence claims real-world ML accuracy, user acceptance, production assurance or phone-based scanning.
4. Every gap named in the chapter matches its ID in `DOCUMENTATION_GAP_REGISTER.md`.
5. The chapter's conclusions are no stronger than Chapter 5's evidence.

## 7. When evidence is missing

Do not infer, and do not write around the hole. Do one of three things, in this order:

1. **Cite the gap** if it already has an ID (`DOCUMENTATION_GAP_REGISTER.md`).
2. **Add a gap row** if it is new: what is missing, why it matters, which section depends on it, who can close it.
3. **State the limitation in the sentence itself** if the section cannot be written without touching the gap —
   for example "the workstation specification was not recorded (G-01)".

An openly stated gap is academically acceptable. An invented number is not, and it is the one error that cannot be
repaired after submission.

## 8. What this package does not do

- It does not draw the figures, capture the screenshots or run a user study.
- It does not edit application code, schema, migrations, configuration, model artifacts or deployment infrastructure.
- It does not resolve contradictions in favour of the more convenient version; it records them.
- It does not replace the author's judgement on the six ambiguities in `ACADEMIC_GUIDE_REQUIREMENTS.md` §6.

---

## 9. PDF rendering

`docs/final-documentation-content/pdf/` holds four files:

- `SBMS_CHAPTERS_4_5_6_DOCUMENTATION_PACKAGE.pdf` — cover page, contents list and all 27 files in the §1 reading
  order. This is the set; nothing in the folder is missing from it.
- `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.pdf`, `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.pdf`,
  `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.pdf` — the three chapters kept apart because they are
  printed, annotated and submitted on their own.

Per-file PDFs for the other 24 documents are deliberately not kept: each would be a second copy of a document that
is already in the package. The PDFs add no content in any case — they are this markdown, paginated, so a claim is no
stronger in PDF than in the `.md` source.

Regenerate after any edit:

```
node scripts/docs-to-pdf.mjs            # combined package + the three chapters
node scripts/docs-to-pdf.mjs --combined # combined package only
node scripts/docs-to-pdf.mjs --all      # one PDF per file, all 27, if you really want them
```

A run that writes the per-file PDFs also deletes any PDF it did not produce, so the folder cannot drift back into
duplicates. The renderer uses headless Chrome and no third-party packages, so a PDF can be no more than one command
out of date with its source.



