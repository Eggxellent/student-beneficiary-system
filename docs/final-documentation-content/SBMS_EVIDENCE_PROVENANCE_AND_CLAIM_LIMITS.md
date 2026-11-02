# SBMS EVIDENCE PROVENANCE AND CLAIM LIMITS

**Prepared:** 2026-11-02
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Purpose:** to state, in one place, what each claim in the report rests on, what cannot be claimed, and why. This file exists so that no chapter has to invent a status and no reader has to guess how strong an assertion is.

---

## 1. Evidence tiers used throughout this documentation set

| Tier | Definition | Wording the report may use |
| --- | --- | --- |
| **T1 — executed test** | An automated test ran on the named date and passed | "verified", "proven by test" |
| **T2 — recorded run** | A harness or command was executed and its output recorded, but it is not part of the permanent suite | "recorded on <date>", "observed" |
| **T3 — code inspection** | The behaviour was read in source, not executed | "implemented", "exists in code" |
| **T4 — document statement** | A repository document asserts it, and that document is current | "the project records that" |
| **T5 — stale or conflicting document** | A document asserts it but contradicts the code or a later record | **May not be cited as evidence** |
| **T6 — absent** | No evidence exists | "not verified", "not measured", "not conducted" |

A claim inherits the **weakest** tier among its dependencies. A conclusion that combines a T1 test with a T6 gap is not a T1 conclusion.

## 2. Binding of every claim to a revision

| Fact | Value |
| --- | --- |
| Branch | `fix/sbms-completion-work` |
| Commit described | `d6b5032` |
| Working tree at time of inspection | Clean apart from documentation added by this pass |
| Other checkouts on the machine | Four (`student-beneficiary-system`, `-dev`, `-admin-login-fix`, `sbms-raw-pair-model-training`); their documents differ (G-26) |
| Test counts cited | Always with a date, because two generations exist (21/128 on 2026-10-31; 24/151 on 2026-11-01) |
| Untracked at this revision | `SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` (G-28) |
| Tracked but git-ignored | `ml-service/model/xgb_duplicate_model.joblib` is tracked while `.gitignore` still lists `ml-service/model/*.joblib` (G-27) |

Any statement in the chapters that cannot be tied to this commit must name a different one, or be removed.

## 3. Documents that must not be cited as evidence

| Document | Problem | What to do |
| --- | --- | --- |
| `docs/verification.md` | States that no controller calls the prediction function and that controllers use their own scoring. That is false at this revision: `students.controller.js:69` calls `scorePairs` through `duplicateCheck.js` | Mark superseded; do not cite (G-08, G-23) |
| `docs/uat-test-plan.md` | Reports five `PASS` results with no participants, and contains the same stale claim about the predictor | Reclassify as an author walkthrough or withdraw; do not present as user acceptance (G-07, G-24) |
| `render.yaml` | Describes an abandoned deployment target | Cite only as history |
| The 2026-10-27 `FINAL_TEST_REPORT` generation | Superseded by the 2026-10-31 and 2026-11-01 runs | Never cite; the file itself says so |
| `ML_RELIABILITY_REPORT.md` Random Forest figures | Describe a candidate the application never loads | Cite only as research comparison |
| `docs/azure-deployment-plan-2026-10-30.md` early sections | Some early architecture options were superseded by decision A2/D8 | Cite §12 (current) and the deployment log instead |

Where a chapter already cites one of these, the citation must be replaced with the record named in the right-hand column of the relevant row above.

## 4. Claims that cannot be supported

| # | Claim that must not appear | Why | Evidence tier |
| --- | --- | --- | --- |
| 1 | "The system detects duplicate beneficiaries accurately" | No adjudicated labels exist; every label is synthetic | T6 (D5) |
| 2 | Any real-world precision, recall, miss rate or false-positive rate | As above | T6 |
| 3 | "The 0.50 cut-off is optimal" | F1 is flat from 0.30 to 0.60; no owner cost policy | T6 (D2/D3) |
| 4 | "The model was validated on Kenyan bursary data" | The data is generated, not collected | T6 |
| 5 | "The QR code was scanned by a phone camera" | No phone session was recorded; the harness is headless Chrome | T6 (G-11) |
| 6 | "The system was tested by real users" / any usability result | No user acceptance study was conducted | T6 (G-06) |
| 7 | "The system was tested under production load" | No load test; the only timing is 22.67 ms for 50 pairs | T6 |
| 8 | "The deployment is production-ready" | No monitoring, no backup schedule, no penetration test, demonstration data | T6 |
| 9 | "Payments are made by the system" | SBMS records payments; it never transfers money | T3 (FR-37) |
| 10 | "QR verification confirms identity, eligibility or payment" | It confirms existence only, by design | T1 (10 tests) |
| 11 | "Certificates prove that funds were disbursed" | A certificate confirms an approval, and the PDF says so | T1 (17 tests) |
| 12 | "User acceptance criteria were met" | No acceptance criteria were recorded or measured | T6 |
| 13 | "The supervisor's findings SBMS-01…18 were addressed" | Their wording could not be recovered; no ID can be closed | T6 (`SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` §4, §11) |
| 14 | "The Docker image was built and run here" | The engine does not run in this environment; the image is evidenced from CI | T6 |
| 15 | "The audit log is immutable" | It is append-only by convention only | T3 |
| 16 | "All 151 tests are branch-complete" | Several requirements are covered only at route level | T1 partial |

## 5. Claims that can be made, with the wording that keeps them true

| Claim | Wording to use | Basis |
| --- | --- | --- |
| The register enforces a five-school constraint | "The API and the database both refuse a school outside the five approved names" | T1 (`students.test.js`; `students_school_supported_check`) |
| Screening cannot be bypassed by a failure | "Registration aborts with 503 rather than creating an unscreened record" | T1 plus T3 |
| A human decides every duplicate and every payment | "Scores create review cases only; approval, payment and certification are role-gated human actions, and the database refuses an approval without verification" | T1 (`workflow.test.js` #2-#6) plus schema constraints |
| The queue cannot explode with registry size | "At most one case is created per registration under the `top-1` policy, with suppressed candidates counted and audited" | T1 (`duplicateAggregation.test.js`) plus T2 |
| Public verification discloses nothing | "The student endpoint returns a boolean; the certificate endpoint returns authenticity facts without name, school, UPI or amount" | T1 (15 tests across two suites) |
| Session authorisation cannot be forged from the token | "The role is re-read from the database on every request and an inactive account is refused" | T1 (`roleAuthorization.test.js`) plus T3 |
| Model provenance is auditable per case | "Each case stores the model version (artifact SHA-256), the threshold in force and the six feature values" | T1 plus T3 |
| The synthetic model separates the designed classes | "On a synthetic holdout of 12 000 pairs the deployed artifact scores precision 0.9204, recall 0.8927 and F1 0.9063 at the 0.50 cut-off" | T2 (`docs/ml-decision-sheet-2026-10-30.md`) — always with the word *synthetic* |
| The model does not memorise | "The in-sample to holdout F1 gap is 1.33 points and grouped cross-validation reproduces the holdout within 0.0004" | T2 plus T1 (integrity tests) |
| A restore was demonstrated | "A dump was restored into an independent database and verified by table count, migration ledger and row digests, on a local disposable database" | T2 |
| The deployment works end to end | "On 2026-10-31 the deployed instance answered health, readiness, authentication, role, QR, ML, CORS and persistence checks; on 2026-11-01 the registration form and identifier capture were verified live" | T2, dated |
| The business chain is gated correctly | "An 11-test suite drives the real application against a real database and proves the verification gate, the duplicate gate, the amount ceiling, the clearance evidence rule, the acknowledgement discrepancy rule and the audit sequence" | T1 |

Every one of these remains true only while the date and the revision stay attached to it.

## 6. Open decisions that belong to someone else

| ID | Decision | Owner | Effect on the report |
| --- | --- | --- | --- |
| D1 | Adjudication protocol and reviewer roles for real pairs | Programme owner / supervisor | Until answered, no accuracy claim is possible |
| D2 | Acceptable miss rate | Programme owner | Determines whether 0.50 is defensible |
| D3 | Reviewer capacity per week | Programme owner | Determines whether the queue is affordable |
| D4 | Whether to introduce candidate blocking | Project owner (needs code change and tests) | FR-34 remains a stated gap |
| D5 | Adjudication ownership and data-protection basis | Institution / owner | Blocks every real-data metric |
| SBMS-01…SBMS-18 | The supervisor's eighteen findings | Supervisor | Their wording is unavailable, so none can be marked resolved (`SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` §4) |
| G-01 | Workstation and device specification | Author | Chapter Five §5.2.1 stays incomplete without it |
| G-03/G-04/G-05 | Figures and screenshots | Author | Chapters Four and Five cannot be illustrated without them |
| G-06 | A position on user acceptance | Author | NFR-14 stays unverified |

The report must present these as open, and must not fill any of them with a plausible-looking invention. That rule is the single most important one in this documentation set.

## 7. Synthetic data policy for every figure, table and screenshot

| Rule | Reason |
| --- | --- |
| Every number in a results table must name the file that produced it | A reader must be able to re-run or re-read the source |
| Synthetic figures must carry the word *synthetic* in the caption | Otherwise a reader will read them as field results |
| No screenshot may contain a live demonstration record created during testing | The deployment holds `E2E Probe` rows; those are not synthetic seeds and must not appear (G-05) |
| `students.is_synthetic` distinguishes seeded from registered rows | The only reliable marker in the data |
| No beneficiary name, UPI, national identifier or phone may appear in any figure | Privacy, even for synthetic rows, sets the habit correctly |
| Where a figure cannot be produced, the placeholder checklist governs | `FIGURE_PLACEHOLDER_CHECKLIST.md` §4 |

## 8. Defects found during the project, and what they prove

| Defect | Symptom | Root cause | Status | Why it belongs in the report |
| --- | --- | --- | --- | --- |
| Payment clearance never worked | `PATCH /api/disbursements/:id/payment-status` returned 500 for every change | PostgreSQL `42P08`: one parameter reused for `VARCHAR(20)`, `VARCHAR(50)` and a text comparison | Fixed with explicit casts | A defect found by testing, not by inspection; it proves the value of the workflow suite |
| Stale QR result on a second scan | A valid code followed by an invalid one still read "Record found" | Verification ran once on mount; a hash-only change does not remount | Fixed with a `hashchange` listener | Shows why a browser harness was necessary |
| StrictMode regression | The first fix reported "invalid" in development | The effect re-read an already-stripped URL | Fixed by capturing the token during render and keying the effect on it | Shows that a fix must be re-tested in the development configuration |
| `risk_level: critical` branch unreachable | The UI could never style a case red | The API only emitted `review` | Resolved by publishing `priority` and `exact_identifier_matches` | Shows a contract mismatch between tiers |
| High-priority cut-off dead configuration | Every model case was `high`; the screen rendered "high 0.00" | Queue prioritised on the review cut-off and published a null threshold | Fixed | Shows a configuration value that was never exercised |
| Registration form omitted UPI and birth certificate | The critical exact-identifier rule could only fire for seeded rows | The form posted five fields; the API accepted eight | Fixed 2026-11-01 and verified live with 11 checks | Shows a real functional gap closed by evidence |

Reporting these is not a weakness of the report; concealing them would be. Each one is dated, attributed to its evidence document and closed with the change that closed it.

## 9. How to keep this set accurate

| Trigger | What must be updated |
| --- | --- |
| A test suite is re-run | `SBMS_TEST_EVIDENCE_CATALOGUE.md` §8 and any count quoted in the chapters |
| A migration is added or applied | `SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md` §2-§4 and the readiness contract |
| A route is added or re-guarded | `SBMS_API_ENDPOINT_CATALOGUE.md` §3 and the security matrix §3 |
| The model is retrained | `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §4-§7 and every figure quoted from it |
| A screen is added | `SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md` §1 and the figure map §10 |
| The deployment changes | `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` §2-§13 |
| A gap closes | `DOCUMENTATION_GAP_REGISTER.md` and the requirement status in `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` §6-§7 |
| A new claim is wanted | This file §4 first: if it appears there, the claim cannot be made |

## 10. Integrity statement

This documentation set was produced by reading the repository at `d6b5032`, the recorded run documents, and the test suites; no test suite was re-executed during this pass, and no code, migration, configuration or existing record was modified. Where the repository and a document disagree, the disagreement is stated rather than resolved in favour of the more convenient version. Where evidence is absent, the absence is reported. No supervisor finding, user result, production metric or accuracy figure has been invented, and none will be found in the chapters that cite this file.


