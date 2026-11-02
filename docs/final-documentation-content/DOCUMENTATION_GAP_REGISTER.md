# DOCUMENTATION GAP REGISTER

**Purpose.** This register lists every item that the chapter content could not establish from the repository, every item
that requires the author's input, every additional test that would need to be run for a claim to stand, and every
documentation inconsistency that must be resolved before submission.

**Prepared from:** `student-beneficiary-system`, branch `fix/sbms-completion-work`, commit `d6b5032`, read-only
inspection of source, migrations, tests, evaluation artefacts and project records.

**How to use it.** Each row names what is missing, why it matters, which chapter section depends on it, and what the
author must supply. Rows marked **BLOCKING** must be closed before submission; **IMPORTANT** rows affect the strength of
a claim but do not invalidate the chapter; **OPTIONAL** rows improve the report if closed.

---

## 1. Items requiring author input (not obtainable from the repository)

| ID | Item | Why it matters | Where used | What the author must supply | Priority |
| --- | --- | --- | --- | --- | --- |
| G-01 | Workstation and device specification used for development and testing (processor, RAM, storage, OS build, browser and version, phone model if used) | Chapter 5 §5.2.1 states that hardware was not recorded. The run records show 7.4 GB RAM with ~0.5 GB free, but not the full specification | Ch.5 §5.2.1, §5.4.2 | A specification sheet for the machines and devices actually used | **BLOCKING** |
| G-02 | Confirmation of free memory during the sweeps that reached 149–150/151 | Chapter 5 §5.4.3 reports the instability and identifies memory pressure as the mechanism, but the hardware cause is inferred rather than measured | Ch.5 §5.4.3 | Free-memory observation at the time, or a clean re-run on a suitably provisioned machine | IMPORTANT |
| G-03 | Statement of whether Figures 4.1–4.24 were produced, and their file names | The chapters specify each figure precisely but contain no drawings; the Word document needs rendered figures, not placeholders | Ch.4 §4.3, §4.5, §4.7 | The drawn figures, or a decision to draw them from the specifications | **BLOCKING** |
| G-04 | Screenshots for Figures 4.13–4.23 (sign-in, registry list, eligibility, registration form, screening confirmation, dashboard, duplicate review, awards and certificates, administrative support screens, both public verification pages) | The specifications state what each image must show; no screenshot was captured in this pass and none is claimed | Ch.4 §4.5; Ch.5 §5.2 | Redacted screenshots taken against synthetic data only | **BLOCKING** |
| G-05 | Confirmation that screenshots and quoted identifiers contain no real beneficiary data | The repository holds only synthetic data, but the live deployment holds demonstration records created during testing | Ch.5 §5.6; G-13 | Visual check of every image before insertion | **BLOCKING** |
| G-06 | User acceptance study: participants, roles, tasks, findings, consent and ethics approval — or an explicit statement that none was conducted | Chapter 5 §5.5.6 reports that UAT was not conducted with users; NFR-14 is unverified without it | Ch.5 §5.5.6; Ch.6 §6.4.9 | Either the study record or an explicit statement of its absence | **BLOCKING** |
| G-07 | Decision on how `docs/uat-test-plan.md` is treated: author walkthrough, marked superseded, or withdrawn | Its five `PASS` results and one stale sentence ("current backend controller code does not call it") conflict with the implementation and the test report | Ch.5 §5.5.6, §5.6.7 | An instruction, since changing it is a documentation edit the author controls | IMPORTANT |
| G-08 | Decision on how `docs/verification.md` is treated, given its claim that no controller calls the predictor | That claim is false for the current revision and would contradict Chapters 4 and 5 if quoted | Ch.5 §5.6.7 | Annotation, retirement, or acceptance of the correction recorded here | IMPORTANT |
| G-09 | AI-assistance disclosure required by the School (tools used, how outputs were verified) | Many institutions require such a statement; none exists in the repository | Front matter / declaration | The wording the School requires | **BLOCKING** |
| G-10 | Student name, admission number and supervisor name exactly as they must appear | Chapters 4–6 do not name the author and must agree with the title page and Chapters 1–3 | Title page | Confirmation of the exact form (the proposal reads "Ngigi Peter", 169613, supervisor Salome Monthe Chemiat) | IMPORTANT |

---

## 2. Items requiring additional testing or evidence

| ID | Item | Why it matters | Where used | What would close it | Priority |
| --- | --- | --- | --- | --- | --- |
| G-11 | Phone-camera scan of a printed student QR code and of a printed award certificate | The identification mechanism is a printed code read by a phone; only headless-Chrome checks exist | Ch.5 §5.4.8, §5.6.3; Ch.6 §6.4.6 | A camera test against the deployed HTTPS origin, with observed results recorded | **BLOCKING** for any claim that the mechanism works in practice |
| G-12 | Load and concurrency evidence at 500 and 1 000 candidates, and two simultaneous registrations | NFR-01 is verified only at 50 candidates and NFR-13 has no concurrency test | Ch.5 §5.4.5, §5.5.4; Ch.6 §6.4.8 | A scripted load test plus a concurrency test, with results recorded | IMPORTANT |
| G-13 | Removal of the two `E2E Probe` students and their duplicate case from the production database | They are demonstration artefacts in a live database and would appear in any live screenshot | Ch.5 §5.3.12 | Execute the documented `DELETE` for `full_name LIKE 'E2E Probe%'` (author's decision; not performed here) | IMPORTANT |
| G-14 | Administrator password re-alignment and re-run of `scripts/admin-reveal-smoke.mjs` | The stored password returned 401, so the reveal screen was not re-checked after the registration-field change | Ch.5 §5.3.12 | Reset the password, re-run the harness, record the result | IMPORTANT |
| G-15 | Print-output verification of the certificate PDF and the exported report | Only the generated bytes are covered; no physical print or visual check exists | Ch.5 §5.4.8 | Print both documents and record legibility and layout | OPTIONAL |
| G-16 | Accessibility audit and cross-browser testing (Firefox, Safari, mobile) | NFR-14 and NFR-19 are unverified beyond Chrome | Ch.5 §5.4.8, §5.5.4 | An accessibility tool report plus manual checks, and a cross-browser pass | OPTIONAL |
| G-17 | Tests for the eligibility arithmetic, dashboard counter arithmetic and report content | Three implemented areas have weak automated coverage | Ch.5 §5.4.8 (O-07, O-08) | Table-driven tests added to the Jest suite | IMPORTANT |
| G-18 | Adjudicated pair labels and a re-run of the reviewed-pairs evaluation | Every real-world quality claim depends on it; decisions D1–D5 are unanswered | Ch.5 §5.5.5; Ch.6 §6.4.1 | 200–300 adjudicated pairs plus the evaluation output | **BLOCKING** for a real-world accuracy claim only (not required while the report confines itself to synthetic findings, as these chapters do) |
| G-19 | Hosted disaster-recovery drill | The rehearsal used a local disposable database, not the managed server | Ch.5 §5.4.5; Ch.6 §6.4.8 | A restore exercise against a separate managed instance, with results recorded | OPTIONAL |
| G-20 | One clean 151/151 suite run on a machine with adequate memory | The documentation-session sweeps reached 149–150/151 for an environmental reason; the report should show a clean reproduction | Ch.5 §5.4.3 | One green sweep with the memory note recorded | IMPORTANT |

---

## 3. Documentation inconsistencies to reconcile

| ID | Inconsistency | Evidence | Affects | Suggested resolution |
| --- | --- | --- | --- | --- |
| G-21 | The proposal specifies a **Random Forest** classifier over **four** features; the production system runs **XGBoost** over **six** | Proposal §1.3.1(ii), §3.2.2, §3.2.3 versus `predict.py`, `feature_engineering.py` | Ch.4 §4.1, §4.4.4; Ch.5 §5.3.4; Ch.6 §6.2.4 | Report the deviation explicitly (as these chapters do), and state a reason if one exists; otherwise report it as an unexplained deviation |
| G-22 | The proposal describes deployment on "a single Linux virtual machine" with Nginx and PM2; the system runs on Azure Container Apps plus App Service | Proposal §3.3.7, §3.4.5 versus `docs/azure-deployment-log-2026-10-31.md` | Ch.4 §4.7; Ch.5 §5.3.12 | Report the deployed architecture and note the change, with the hosting constraints that forced it |
| G-23 | `docs/verification.md` states there are no callers of the prediction function and that controllers use their own scoring | `students.controller.js:69` calls `scorePairs` | Ch.5 §5.6.7 | Mark the document superseded (see G-08) |
| G-24 | `docs/uat-test-plan.md` reports five `PASS` results without participants and contains a stale sentence about the predictor | `docs/uat-test-plan.md`, Test Scenario 2 | Ch.5 §5.5.6 | Reclassify as an author walkthrough, or run a real study (G-06, G-07) |
| G-25 | `docs/FINAL_TEST_REPORT.md` contains two result generations (21 suites/128 tests on 2026-10-31; 24 suites/151 tests on 2026-11-01) | §1–§3 versus §10 | Ch.5 §5.4.3 | Always cite the date with a count (as these chapters do); optionally add a "current totals" banner to the file |
| G-26 | Four working checkouts of the same project exist on different branches, and their documents differ | `student-beneficiary-system`, `-dev`, `-admin-login-fix`, `sbms-raw-pair-model-training` | Evidence report | State which checkout and commit every claim refers to (these chapters use `fix/sbms-completion-work` @ `d6b5032`) |
| G-27 | The production model artefact is tracked, but `.gitignore` still lists `ml-service/model/*.joblib` | `.gitignore` versus `git ls-files ml-service/model` | Ch.5 §5.3.4 | Note that the artefact is committed; if it is meant to be excluded, explain how the deployment obtains it |
| G-28 | Two root reports cited by these chapters are untracked (`SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md`) | `git status` shows both as untracked | Ch.4 §4.4.3; Ch.5 §5.4.7 (D-08) | Commit them, or cite the committed equivalent |

---

## 4. Items deliberately not supplied, and why

| Item | Reason |
| --- | --- |
| Invented supervisor feedback or approval | The SBMS-01…SBMS-18 findings are unrecoverable from the workspace; `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` §4 records that their wording is unavailable. No finding was paraphrased into a requirement |
| Production metrics, latency under load, uptime figures | No such measurements exist |
| Real-world ML precision, recall or F1 | No adjudicated labels exist; synthetic figures are reported as synthetic |
| User-acceptance results | No study was conducted |
| New academic citations | Chapters 4–6 introduce no new literature claims; where a concept needs a source, the citation belongs in Chapters 1–3. Any citation added during editing must be verified by the author |
| Authentication of the deployment as "production" | The deployment is a demonstration instance, and the chapters say so |

---

## 5. Cross-reference: gaps to chapter sections

| Chapter section | Gaps that touch it |
| --- | --- |
| Ch.4 §4.1 | G-21 |
| Ch.4 §4.2.3 | G-12, G-16 |
| Ch.4 §4.3 | G-03 |
| Ch.4 §4.5 | G-03, G-04, G-05 |
| Ch.4 §4.7 | G-22 |
| Ch.5 §5.2.1 | G-01, G-02 |
| Ch.5 §5.3.4 | G-21, G-27 |
| Ch.5 §5.3.12 | G-13, G-14, G-22 |
| Ch.5 §5.4.3 | G-02, G-20, G-25 |
| Ch.5 §5.4.5 | G-12, G-19 |
| Ch.5 §5.4.8 | G-11, G-15, G-16, G-17 |
| Ch.5 §5.5.5 | G-18 |
| Ch.5 §5.5.6 | G-06, G-07 |
| Ch.5 §5.6.7 | G-08, G-23, G-24, G-25 |
| Ch.6 §6.2.4 | G-21 |
| Ch.6 §6.4.1–§6.4.9 | G-11, G-12, G-17, G-18, G-19 |

---

## 6. Minimum set to close before submission

If time is short, five items carry the most risk: **G-01** (environment specification), **G-03/G-04/G-05** (figures and
screenshots, with the synthetic-data check), **G-06/G-07** (a clear position on user acceptance), **G-21** (the Random
Forest to XGBoost deviation) and **G-11** (a phone-camera scan of at least one printed QR code, since the identification
mechanism otherwise rests entirely on a headless-browser check).

---

## 7. Closed since this register was drafted

| Item | How it was closed | Where the closure is visible |
| --- | --- | --- |
| G-21 Random Forest to XGBoost deviation | Stated explicitly, not reconciled silently: the proposal's four-feature Random Forest and the delivered six-feature XGBoost are both named, with the research-only artifact identified | `CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md` §4.1, §4.2.2 (FR-31), §4.4.4; `CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md` §6.2.4; restated in `CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md` §1 |

**Still open, and unchanged by the above:** G-21 remains an item the author must keep visible through final assembly,
because a supervisor comparing Chapter Three to Chapter Four will meet the change there. The register keeps it listed
for that reason rather than marking it "done".

---

## 8. Document set this register belongs to

The evidence package is two-tiered. Entry set: `ACADEMIC_GUIDE_REQUIREMENTS.md`,
`CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN_EVIDENCE.md`, `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION_EVIDENCE.md`,
`CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORK_EVIDENCE.md`,
`CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md`, `DIAGRAM_SPECIFICATIONS.md`, `MASTER_EVIDENCE_REGISTER.md`,
`ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md`, `CLAUDE_HANDOFF_GUIDE.md`. Evidence tier: the three chapter drafts, the
`SBMS_*` catalogues, `OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md`, `EVIDENCE_AND_VERIFICATION_REPORT.md`, this register
and `FIGURE_PLACEHOLDER_CHECKLIST.md`. `CLAUDE_HANDOFF_GUIDE.md` §2 carries the full crosswalk.

