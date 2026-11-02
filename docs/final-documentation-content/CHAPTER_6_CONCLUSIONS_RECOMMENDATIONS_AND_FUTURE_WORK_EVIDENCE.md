# CHAPTER 6 EVIDENCE PACKAGE: CONCLUSIONS, RECOMMENDATIONS AND FUTURE WORK

> **What this file is.** The Chapter 6 entry point of the nine-file handover set: what each conclusion may rest on,
> the recommendations the evidence supports, and the future work that is genuinely future rather than unfinished.
> Repository `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`.
>
> **Full detail:** `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` (§6.1–§6.5),
> `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` §1 and §5, `SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md`
> §20–§24.

---

## 1. The objectives, and where their evidence sits

The four specific objectives are reproduced as working statements below. **The exact Chapter 1 sentences are not
in this repository** — Chapters 1–3 exist only outside it — so the author must paste the originals from the report
and confirm they match these statements before submission. Chapter 6 must answer the originals, not this file.

| # | Working statement | Implemented functionality | Evidence | Extent | Limitation |
| --- | --- | --- | --- | --- | --- |
| (i) | Investigate the challenges of manual beneficiary registration and tracking | Requirement and workflow analysis, problem framing | `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.1–§4.2; proposal §1 | Achieved as analysis | No field study or interview record exists |
| (ii) | Design the architecture, database schema and ML pipeline, incorporating a Random Forest classifier | Three-tier architecture, 13 tables, 14 migrations, six-feature XGBoost pipeline | §4.4, §4.6, §4.7; `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` | Achieved with a stated deviation | Classifier is XGBoost, not Random Forest (G-21) |
| (iii) | Implement registration, unique identifiers, QR identification and role-based access control | Registration with validation, generated identifiers, existence-only QR verification, three-role RBAC | `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` §5.3.2–§5.3.8 | Achieved | Physical QR scan never exercised (G-11) |
| (iv) | Validate, test and evaluate the system's effectiveness | 151 backend tests, 46 native tests, 43 browser checks, 40 Python tests, ML evaluation, restore rehearsal | §5.4; `SBMS_TEST_EVIDENCE_CATALOGUE.md` | Partly achieved | No real data, no user acceptance, no load test |

## 2. What the conclusions may and may not say

| Conclusion | Supportable wording | Basis |
| --- | --- | --- |
| The system is built and behaves as specified | "Route-level and workflow-level behaviour matches the specification across 151 backend tests, 43 browser checks and 40 Python tests, each with its date in §5.4." | Test artefacts with dates |
| Duplicate detection is functional | "The pipeline scores each candidate pair against the whole registry and surfaces the result to an administrator, who decides." | Code and tests |
| Duplicate detection is accurate | **Not supportable.** No adjudicated labels; synthetic data only | `SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` §4 |
| The ML component adds value | "It reduces the reviewer's candidate set to a ranked top-1 per record and stores provenance per flag." Value against a manual baseline is unmeasured | Design evidence only |
| The system improves on manual processes | **Only as a design argument.** No before-and-after measurement and no users | Gap G-06 |
| The payment chain is controlled | "Payment state is gated in the database as well as the API, and every state change is audited." | Schema constraints, audit tests |
| The system is production-ready | **Not supportable.** Demonstration instance; no monitoring, backup schedule or penetration test | §5.6.6 |

## 3. Recommendations the evidence supports

| # | Problem or opportunity | Evidence | Action | Benefit | Implementation consideration |
| --- | --- | --- | --- | --- | --- |
| R-1 | Labels are synthetic, so accuracy is unknown | ML doc §4, §10 | Build an adjudicated ground-truth set from the decisions already stored in `duplicate_review_events` | Real precision, recall and a defensible cut-off | Needs data-sharing permission and a labelling protocol |
| R-2 | Whole-registry comparison is quadratic | Screening service; 22.67 ms at 50 pairs | Add blocking or candidate generation before scoring | Keeps review volume viable as records grow | Blocks on the ML service, not the database |
| R-3 | The score is uncalibrated and unexplained | ML doc §11 | Calibrate probabilities and expose the top contributing features per flag | A reviewer can judge a flag instead of trusting it | Feature names must stay stable across retraining |
| R-4 | Flag volume may exceed review capacity | Screening design | Set an explicit flag budget per cycle and measure reviewer throughput | Prevents an unusable queue | Needs an owner decision on the cost of a missed duplicate |
| R-5 | Operation and assurance are thin | `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` §9 | Add monitoring, a backup schedule and a scheduled restore drill | Reduces operational risk | Costs money; Azure monitoring already available |
| R-6 | Identity assurance rests on a printed token | QR design; G-11 | Define a re-issue and revocation policy and test one scan on a phone | Closes a known weak point | Policy decision belongs to the programme owner |

Each recommendation is tied to a stakeholder in Chapter 6 §6.3 and to the limitation that motivates it.

## 4. Future work: split by kind, not by convenience

| Category | Items | Why it is future work, not a gap |
| --- | --- | --- |
| Existing functionality | Blocking, calibration, score explanation, flag budget | The current scope delivers screening and adjudication; these improve it |
| Additional capability | Multi-registry operation, shared identity across programmes, confirmation of receipt | Never in the approved scope |
| ML | Real-data evaluation, retraining pipeline, drift monitoring, cost-sensitive threshold selection | Blocked by the absence of labelled data |
| Security | Penetration test, secret rotation, key management, rate-limit tuning | Assurance work, outside the project's testing scope |
| Scale and operations | Load testing, monitoring, backup schedule, high availability | Requires a production budget |
| Research | Comparing blocking strategies; reviewer efficiency against a manual baseline | Needs a field setting |

**Not to be listed here:** the functional gaps FR-34…FR-37 and the deviations FR-31…FR-33. Those were in scope and
are reported as missed or altered in §6.2.9.

## 5. Boundaries the conclusion must keep

| Boundary | What it excludes |
| --- | --- |
| Data | Every metric is synthetic; nothing is claimed about Kenyan bursary records |
| Users | No student, officer, guardian or school participated |
| Scale | Nothing above 50 candidate pairs was timed |
| Device | Chrome only; no phone camera; no physical printer |
| Operation | Demonstration instance; no monitoring, backup schedule or high availability |
| Security | Control inventory, not an assurance statement |
| Governance | Five owner decisions unanswered; no supervisor finding can be closed without its wording |

## 6. Open items affecting Chapter 6

| Item | Effect | Owner |
| --- | --- | --- |
| G-21 classifier deviation | Must be stated in §6.2.4, not omitted | Author |
| G-06 user acceptance | §6.4.9 argues future work from an absence, which must be admitted | Author |
| Exact Chapter 1 objective wording | §6.2.3–§6.2.6 must answer the originals | Author |

## 7. Related files

`CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` (the chapter),
`OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md` (objective → requirement → test → conclusion),
`SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md` (claim limits).

