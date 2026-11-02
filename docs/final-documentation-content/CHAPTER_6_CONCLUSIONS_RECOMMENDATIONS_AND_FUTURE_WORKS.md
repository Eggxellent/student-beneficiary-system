# CHAPTER 6: CONCLUSIONS, RECOMMENDATIONS AND FUTURE WORKS

> **Status of this file.** Report-ready content for Chapter 6. Every conclusion in §6.2 is derived from evidence
> presented in Chapters Four and Five and introduces no new results, measurements, citations or claims. Every
> recommendation in §6.3 is tied to a stakeholder, an action, a reason and the limitation that motivates it. Every
> item in §6.4 addresses a limitation that Chapter Five identified.
>
> **Revision described.** Branch `fix/sbms-completion-work` at commit `d6b5032`, the same revision as Chapters 4 and 5.
> Every fact in this chapter traces to the dossier in `SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md` §28 and
> to the chapter sections named in §6.2.

---

## 6.1 Introduction

This chapter closes the study. Section 6.2 states the conclusions in the same order as the specific objectives in
Chapter One, and answers what the project set out to do, what it achieved, what its testing established and where the
boundaries of the achieved solution lie. Section 6.3 sets out recommendations for the stakeholders who would operate or
maintain the system, each tied to the evidence that motivates it. Section 6.4 identifies future work arising from the
limitations recorded in Chapter Five, explaining for each item the limitation addressed, what would have to change, and
how the improvement could be evaluated.

The chapter deliberately does not claim that the system eliminates fraud, prevents all duplicate registrations or
guarantees correct allocation of bursary funds. The system provides a controlled registration record, a screening
signal that a human adjudicates, and an evidence-bearing payment chain; what it achieves is bounded by the quality of
the data entered into it, by the decisions its human reviewers make, and by the fact that it operates on one registry
at a time.

---

## 6.2 Conclusions

### 6.2.1 The problem the project addressed

The project addressed a specific and documented failure of public bursary administration in Kenya: beneficiary records
are kept on paper in independent constituency offices, so a learner can be registered more than once without any office
being able to detect it, and payments are frequently not traceable to a verified student. Chapter One grounded this in
published audit findings, and Chapter Two established that existing beneficiary-management systems either address a
different domain or rely on exact matching that cannot identify near-duplicates caused by spelling variation, name
reordering or partial identifiers. The problem was therefore not a general claim about inefficiency; it was a specific
claim about the absence of a shared, verifiable record and of any mechanism for identifying the same learner twice.

### 6.2.2 The purpose of the project

The purpose, as stated in the general objective, was to design and develop a web-based student beneficiary management
system with machine-learning-driven duplicate detection, to digitise and streamline registration, identification and
benefit-distribution tracking. That purpose was pursued through Design Science Research: an artefact was built,
deployed and evaluated, with the evaluation reported in Chapter Five as far as the available evidence allows.

### 6.2.3 Achievement of the first objective: investigating existing challenges

The first objective — to investigate the challenges associated with manual registration and tracking — was
**partially achieved**. The investigation was conducted by document analysis of Auditor-General, Controller of Budget
and NG-CDF material, and it produced a requirements set that is traceable into the implemented system (Chapter Four
§4.2.1). What it did not include is primary investigation: no bursary officer was interviewed, no constituency office
was observed, and no manual register was examined. The conclusions about practice therefore rest on published audit
evidence rather than on the researcher's own fieldwork, and this should be stated wherever those conclusions are relied
upon.

### 6.2.4 Achievement of the second objective: architecture, schema and ML pipeline design

The second objective — to design the architecture, database schema and machine-learning pipeline — was **achieved
with one documented design change**. Chapter Four presents a three-tier architecture in which the machine-learning
component is a supervised child process rather than a separate network service; a relational schema of twelve tables
with fifty-six constraints and twenty-one indexes; and a pipeline in which one feature-engineering module serves both
training and inference, which is what makes the served score the same quantity the evaluation measured.

The design change is that the classifier specified in the proposal as a Random Forest over four features was delivered
as an XGBoost classifier over six features. This is not a cosmetic substitution: the two additional features (UPI and
birth-certificate agreement) change what the model can see, and the algorithm change alters both performance and
interpretability. The honest conclusion is that the design objective was met in substance — an architecture, a schema
and an ML pipeline were designed, built and documented — while the specific classifier named in the approved proposal
was not the classifier delivered. That divergence must be reported as a deviation, not silently reconciled.

### 6.2.5 Achievement of the third objective: implementation of the web-based system

The third objective — to implement a system supporting digital registration, unique identifier generation, QR-based
identification and role-based access control — was **achieved**. The evidence is not merely that the code exists: the
registration path, the server-generated identifier and QR token, and the two-role access matrix are each covered by
executed tests, and the deployed instance was checked with real browser sessions for both roles and with a live
screening request that produced an exact identifier match (Chapter Five §5.3.12). The system additionally delivered
capabilities beyond the original scope — award verification, payment reconciliation and QR-verifiable award
certificates — which are relevant to the accountability problem even though they were not in the proposal.

Two boundaries must be stated with that conclusion. First, the system identifies a student by a random token whose
possession proves only that a record exists; it does not establish identity, eligibility, approval or payment, and it
says so on the page a verifier sees. Second, the system records payments; it does not make them, and it does not
receive independent confirmation from a school that money arrived.

### 6.2.6 Achievement of the fourth objective: validation and evaluation

The fourth objective — to validate and test the system, and to evaluate its effectiveness in detecting duplicate
records and improving beneficiary tracking — was **partially achieved**, and the split matters.

The system was validated as an artefact to a degree that is unusual for a project of this size: 151 automated backend
tests against a real PostgreSQL database, 43 native tests, 3 out-of-process smoke checks, 40 Python tests, 43
browser-driven checks and a series of live deployment checks, with nine defects found and fixed during testing
(Chapter Five §5.4). Those defects include a total functional failure — payment clearance returned an error for every
request — that no earlier test had covered, and a production-only routing fault that made every QR scan fail on the
deployed site while succeeding when the same endpoint was called directly. Finding such defects is evidence that the
validation was real rather than ceremonial.

Effectiveness in *detecting duplicate records* was **not** established in the sense the objective implies. The model
was measured on a synthetic holdout and achieved F1 0.9063, precision 0.9204 and recall 0.8927 at the live cut-off of
0.50, with false-positive rates that vary by negative family from 0.00% for unrelated candidates to 22.21% for
identifier collisions. Those figures demonstrate that the pipeline is correctly constructed and that the model
separates the simulated classes well. They do not demonstrate detection performance on real beneficiary records,
because no adjudicated real-world labels exist, and the project says so rather than presenting synthetic figures as an
accuracy claim.

Improvement in *beneficiary tracking* is better supported, because it does not depend on the model: the award,
payment, reconciliation and certificate chain is demonstrated end to end, including the rule that a student with an
open or confirmed duplicate cannot be approved or paid, and that a duplicate raised after approval still blocks
payment. That is a demonstrable improvement in traceability over a paper register, and it is the part of the objective
that can be concluded without qualification.

### 6.2.7 What the testing established about the system's quality

Beyond the objectives, the testing supports four conclusions about the system's engineering quality.

First, the system's integrity does not rest on application code alone. The rules that matter most — an approval
requires a verified beneficiary, a cleared payment requires evidence, a revoked certificate requires a reason, a
certificate token must be 64 hexadecimal characters, a school must be one of the five approved — are enforced by
database constraints as well as by controllers, and the tests exercise the constraints. That redundancy is why a
mistake in one controller does not become a financial irregularity.

Second, the access-control model is sound in a specific and testable way: the role used for authorisation is re-read
from the database on every request, so a forged token claim confers nothing and a deactivation takes effect
immediately. That property was verified rather than assumed.

Third, the public verification surfaces disclose what they claim and nothing more. The student endpoint returns a
boolean; the certificate endpoint returns authenticity facts without the student's identity or the amount; both return
the same answer for a malformed token as for an unknown one; and both are rate limited with separate budgets. These
properties are asserted by eleven tests between them.

Fourth, the system is honest about its own uncertainty where it matters most. The review queue declares
`thresholds_validated: false`; the model version is published with every case so a decision can be traced to an
artefact; the officer's screen states that an administrator must review the case; and both public pages state what
they do not prove. A system that over-claimed here would be worse than one that is incomplete.

### 6.2.8 What the project contributes

The contribution of the work is threefold. To practice, it contributes a working, deployable design for a
beneficiary-management system in which machine-learning-assisted duplicate screening is embedded in an accountability
chain rather than presented as an end in itself, and in which the model's output is explicitly a review signal rather
than a decision. To the specific problem in Chapter One, it contributes a concrete mechanism — an evidence-bearing
award and payment chain guarded by duplicate review — that addresses the traceability failures documented by the
Auditor-General within a single registry. To the research question about near-duplicate detection, it contributes a
reproducible pipeline, a measured operating-point analysis on synthetic data, and a documented, quantified finding
that the aggregation policy and candidate generation, not the classifier threshold, dominate the practical review load
— a result that is transferable to any registry-scale record-linkage deployment.

### 6.2.9 The boundaries of the achieved solution

The solution achieved is bounded in five ways that the report must carry explicitly.

1. **Single registry.** Deduplication operates within one deployment's students. Cross-constituency duplication — the
   core of the problem in Chapter One — is not addressed, because that requires shared infrastructure and a
   data-sharing agreement that are outside the project's scope.
2. **Synthetic evidence.** All model performance figures describe a simulator. No claim about real detection
   performance is made, and none can be made from this evidence.
3. **Human-dependent.** Every duplicate decision, approval, clearance and acknowledgement is a human act. The system's
   guarantees are of the form "this cannot happen without a named person and a recorded reason", not "this cannot
   happen".
4. **No financial execution or independent confirmation.** The system records that a payment was issued and,
   separately, that it was reported as cleared; it does not move money and does not obtain a school's independent
   confirmation of receipt.
5. **Operational** **scope.** The deployment is a demonstration instance with a stopped database outside demonstration
   windows, no automated backup schedule, no load testing and no acceptance study. It is a validated artefact, not a
   production service.

---

## 6.3 Recommendations

Each recommendation names the stakeholder it is for, the action, the reason, the evidence or limitation that motivates
it, and a priority. Priorities are **P1** (before any use with real beneficiary data), **P2** (before routine
operational use) and **P3** (improves the system but is not blocking).

### 6.3.1 Recommendations for the implementing organisation (programme owner)

**Table 6.1: Recommendations for the implementing organisation**

| ID | Action | Reason | Evidence / limitation | Priority |
| --- | --- | --- | --- | --- |
| R-01 | Answer decisions D1–D5 before the system is used with real records: flag budget per registration, weekly review capacity, acceptable miss rate, whether cross-school comparison is permitted, and who adjudicates | These choices determine the operating point, the review workload and the meaning of "duplicate"; until they are answered the cut-off is unvalidated and the queue cannot be sized | `docs/ml-evaluation-policy.md`; Chapter Five §5.5.5 | **P1** |
| R-02 | Commission an adjudication exercise of 200–300 stratified pairs and adopt it as the reference label set | Every real-world quality claim depends on it; without it the measured performance describes only a simulator | Chapter Five §5.5.5; `docs/ml-decision-sheet-2026-10-30.md` §7 (D5) | **P1** |
| R-03 | Approve a data-protection basis, retention period and access policy before real beneficiary data is entered | The system stores names, dates of birth, national identifiers, UPI, birth-certificate numbers and guardian contacts, and has no retention or deletion mechanism | Chapter Four §4.2.4; Chapter Five §5.6.4 | **P1** |
| R-04 | Supply an authoritative school-code list and a name-to-code mapping | The registry uses five school names as identifiers, so the model's school feature compares names | `docs/ml-integration-and-school-identifiers.md`; Chapter Five §5.6.5 | **P2** |
| R-05 | Define the acknowledgement service standard and set `ACKNOWLEDGEMENT_OVERDUE_DAYS` accordingly | Overdue-acknowledgement reporting is disabled while the setting is unset, so a central indicator is silently inactive | Chapter Five §5.3.7; `docs/business-workflow-verification-2026-10-30.md` §4 | **P2** |
| R-06 | Decide whether independent school confirmation of receipt is required, and if so fund the interface for it | Officer-assisted acknowledgement is not independent verification, and the audit problem in Chapter One is precisely about unconfirmed school receipts | NFR-24; Chapter Five §5.6.6 | **P2** |
| R-07 | Treat the current deployment as a demonstration instance and budget for a continuously available environment before any operational pilot | The database is stopped between demonstrations and there is no backup schedule, so availability is scheduled rather than assured | `docs/azure-deployment-log-2026-10-31.md` §1–§4; Chapter Five §5.6.6 | **P2** |

### 6.3.2 Recommendations for system administrators

**Table 6.2: Recommendations for administrators**

| ID | Action | Reason | Evidence | Priority |
| --- | --- | --- | --- | --- |
| R-08 | Work the review queue to closure before approving awards; never approve while a case is open | The gate is the system's central control | FR-15; `tests/workflow.test.js` | **P1** |
| R-09 | Record a substantive reason on every decision, and use `needs_verification` rather than `not_duplicate` when evidence is incomplete | `confirmed_duplicate` is terminal and cannot be reversed through the API, so a mistaken confirmation can only be corrected in the database | Chapter Four §4.4.5; Chapter Five §5.3.5 | **P1** |
| R-10 | Reveal identifiers only when comparing source documents, and expect the reveal to be audited | The reveal writes an audit row naming the fields disclosed and the purpose; routine use defeats the privacy design | NFR-05; `tests/duplicateFlags.test.js` | **P2** |
| R-11 | Do not change the thresholds expecting the change to persist | Threshold updates are held in process memory and are lost on restart | Chapter Five §5.3.11 | **P2** |
| R-12 | Close every record flagged as `discrepancy`, partial payment or awaiting acknowledgement, and review the exception list routinely | The exceptions are derived from data and are the system's principal accountability output | FR-19; Chapter Five §5.3.7 | **P2** |

### 6.3.3 Recommendations for field officers

**Table 6.3: Recommendations for field officers**

| ID | Action | Reason | Evidence | Priority |
| --- | --- | --- | --- | --- |
| R-13 | Record UPI and birth-certificate number whenever the guardian presents the documents | These are the identifiers whose exact agreement raises a case regardless of the model score; leaving them blank removes the strongest human-checkable signal | `docs/azure-deployment-log-2026-10-31.md` §9; FR-05 | **P1** |
| R-14 | Treat a "possible duplicate match" message as a normal outcome, not a rejection, and tell the guardian an administrator will review it | Registration is never blocked and the student is registered; the case concerns a later payment decision | FR-08; `docs/business-workflow-verification-2026-10-30.md` §4 | **P2** |
| R-15 | Record beneficiary verification with a real evidence reference rather than a placeholder | Approval is impossible without it, and a placeholder defeats the traceability the system exists to provide | FR-14; `bursary_awards_verification_fields_check` | **P2** |
| R-16 | Print or display the student QR at registration and confirm the student can present it later | The token is returned only in that response, and there is no re-issue path in the current API | Chapter Five §5.3.8; FR-35 | **P2** |

### 6.3.4 Recommendations for technical maintainers

**Table 6.4: Recommendations for technical maintainers**

| ID | Action | Reason | Evidence | Priority |
| --- | --- | --- | --- | --- |
| R-17 | Implement candidate generation (blocking) before the registry exceeds a few hundred students | Screening compares against the whole registry; review volume rises with registry size and no threshold setting repairs it | Chapter Five §5.5.5, §5.6.4; FR-34 | **P1** |
| R-18 | Remove or clearly quarantine the legacy rule engine, and reconcile or retire the `beneficiaries` table | Both are reachable-looking dead weight in a codebase whose central concept is duplicate scoring, and one is required by the readiness check | Chapter Four §4.4.2; Chapter Five §5.6.4 | **P2** |
| R-19 | Persist threshold configuration in the database and load it at start-up | In-memory settings are lost on restart, which makes an audited change appear to have been reverted | Chapter Five §5.3.11 | **P2** |
| R-20 | Replace the in-process rate-limit counters with a shared store, and configure `TRUST_PROXY_HOPS` per deployment | Counters are per process and, behind a proxy without the setting, all public users share one budget | NFR-07; defect D-09 | **P2** |
| R-21 | Add automated tests for the eligibility arithmetic, the dashboard counters and the report content | These are the implemented areas with the weakest automated coverage | Chapter Five §5.4.8 (O-07, O-08) | **P2** |
| R-22 | Add a scheduled backup, a restore verification step and a retention/deletion procedure | Recovery is a rehearsed manual procedure and no data is ever deleted | NFR-18; Chapter Five §5.6.4 | **P2** |
| R-23 | Add a QR re-issue path and a token-rotation policy for student records | A student whose token is missing or compromised has no remedy through the API, and possession of a token is permanent | FR-35, FR-36 | **P3** |
| R-24 | Run the outstanding tests: phone-camera scan, load and concurrency, print output, accessibility, cross-browser | These are the areas where behaviour is asserted by reasoning rather than by observation | Chapter Five §5.4.8 | **P2** |
| R-25 | Correct the superseded project documents (the claim in `docs/verification.md` that the predictor is uncalled, and the UAT plan's `PASS` summary) before submission | A report that cites documents contradicting its own code is weaker than one that cites fewer documents | Chapter Five §5.6.7 | **P1** |

### 6.3.5 A note on the limits of these recommendations

None of the recommendations above proposes a change to the system's scoring model, and that is deliberate. The
evidence in Chapter Five does not support a model change: the measured performance is adequate for the screening role,
the threshold analysis shows no defensible alternative in the band 0.30–0.60 on the available data, and the dominant
problem is the volume and attribution of review work rather than the ranking quality of the classifier. Recommending a
different algorithm without adjudicated labels would replace one unvalidated choice with another.

---

## 6.4 Future works

Each item states the limitation it addresses, why the improvement matters, what would have to change, what additional
data or infrastructure is required, and how the improvement could be evaluated.

### 6.4.1 Adjudicated ground truth and real evaluation

*Limitation addressed:* all model evidence is synthetic; no adjudicated pairs exist (Chapter Five §5.5.5).

*Why it matters:* without reviewed labels, precision, recall, miss rate and the false-positive rate of the applicant
population cannot be estimated, so the operating point cannot be defended and no claim about real detection performance
can be made.

*What would change:* a sample of 200–300 pairs stratified by score band, labelled independently by two reviewers blind
to the score with disagreements adjudicated; pseudonymous entity identifiers; a tuning/holdout split by entity so no
person appears in both; and the reviewer, date and data-protection basis recorded.

*Additional requirements:* named reviewers with authority to judge identity, a data-protection basis for processing
real beneficiary records, and a labelling instrument that preserves the score band.

*Evaluation:* re-run `evaluate_reviewed_pairs.py` against the adjudicated split and report precision, recall, F1,
PR-AUC and the confusion matrix with confidence intervals, comparing them with the synthetic figures.

### 6.4.2 Candidate generation (blocking)

*Limitation addressed:* every registration is compared against every existing student, and the rescan is quadratic
(Chapter Five §5.6.4, limit 1).

*Why it matters:* it is the only lever that changes the order of magnitude of review work; raising the cut-off reduces
the queue more slowly than it loses true duplicates.

*What would change:* replace "compare against every student" with name-token candidate generation; keep `school_match`
as a model feature; treat a missing school as a wildcard; cap the candidate list; and measure the duplicates lost by
the key. The surname-and-school key must not be used, because the project's own measurement shows it discards 83.5% of
duplicates.

*Additional requirements:* a name-tokenisation routine shared with the feature builder, an index to support the token
lookup, approval for a change in which pairs are compared, and a migration that leaves existing cases untouched.

*Evaluation:* replay a fixed synthetic registry through both strategies and compare duplicates retained, flags per
registration and screening latency at `N = 100`, `500`, `1 000` and `5 000`; then repeat on the adjudicated set from
§6.4.1 to confirm that retained duplicates are still detected.

### 6.4.3 A calibrated, explainable score

*Limitation addressed:* the score is uncalibrated and has no explanation surface (Chapter Five §5.3.4).

*Why it matters:* a reviewer told "0.63" cannot check it; a calibrated score with per-feature contributions would show
that the agreement is on name and school but on no identifier, which is the judgement the workflow asks the reviewer to
make.

*What would change:* calibration (for example isotonic or Platt scaling) fitted on a held-out set and persisted with the
artefact; a per-case explanation derived from the six stored features; and a reviewer-facing display of feature
agreement alongside the score, shown to administrators only, since the field-officer screen deliberately shows no
scores.

*Additional requirements:* a labelled subset reserved for calibration, and a display decision about how much model
detail a reviewer should see.

*Evaluation:* calibration curves and Brier score before and after; and a reviewer study measuring whether explanations
change agreement between the model's suggestion and the human decision.

### 6.4.4 Flag budget and review capacity

*Limitation addressed:* masking of true duplicates behind nuisance candidates reaches 52.6% at `N = 5 000` under
`top-1`, and decisions D1–D3 remain unanswered (Chapter Five §5.5.5).

*Why it matters:* the flag budget is a policy choice with a cost on both sides — queue volume against the risk of
showing the reviewer the wrong pair.

*What would change:* implement a bounded `top-k` policy (for example `top-3`) with the same audit counters and make the
budget configurable, keeping `top-1` as the default until the registry grows.

*Additional requirements:* owner decisions D1–D3 and a measured weekly review capacity.

*Evaluation:* re-run the registration-level simulation with `k = 1, 2, 3` and compare masking, queue volume and the
share of detections attributed to the correct candidate, then confirm on adjudicated data.

### 6.4.5 Multi-registry operation and shared identity

*Limitation addressed:* the system is single-tenant, so cross-constituency duplication — the core of the problem in
Chapter One — is not addressed (Chapter Five §5.6.2).

*Why it matters:* a learner can still be registered in two deployments without either detecting it.

*What would change:* a tenant identifier on students and dependent records, an authenticated inter-instance query for a
hashed identity probe, and a policy for what one constituency may learn about another's records. The first step, which
is technically modest, is to compute and store a keyed hash of the normalised identity tuple, so that a future shared
service can match without exchanging records.

*Additional requirements:* a data-sharing agreement, a governance body to authorise cross-tenant queries, and
infrastructure beyond a single student subscription.

*Evaluation:* a two-instance simulation in which the same learner is registered in both, measured by detection rate,
false-match rate and the number of records exchanged — which should be zero under a hashed-probe design.

### 6.4.6 Identity assurance and token lifecycle

*Limitation addressed:* a QR token proves only that a record exists, and there is no expiry, rotation, re-issue or
revocation for student tokens (Chapter Five §5.3.8; FR-35, FR-36).

*Why it matters:* a permanently valid token that can never be replaced is a weak identity artefact, and a lost or
misdirected printout cannot be invalidated.

*What would change:* an administrative re-issue endpoint that replaces `qr_token` and audits the change; optional expiry
with re-issue on renewal; and a statement on the printed material of what the token does and does not prove.

*Additional requirements:* an administrative UI action, a migration for token metadata, and a policy decision about
expiry, because expiring tokens would invalidate already-printed codes.

*Evaluation:* tests asserting that a re-issued token invalidates its predecessor, that the audit row records the
re-issue, and that verifying the superseded token returns `found:false`.

### 6.4.7 Independent confirmation of receipt

*Limitation addressed:* acknowledgement is officer-assisted, not independent school confirmation (Chapter Five §5.6.6).

*Why it matters:* the audit finding that motivated the project concerns payments schools did not acknowledge, so a
system that records only the officer's own acknowledgement cannot close that gap.

*What would change:* a limited school-facing confirmation route — for example a per-payment single-use link issued to a
named school contact — recording an independent confirmation or dispute without granting access to the register.

*Additional requirements:* a verified school contact register, a delivery channel (SMS or e-mail), and a decision about
what a school may see.

*Evaluation:* a two-party exercise in which an officer records a payment and a school confirms it independently, with the
exception list measured before and after to show that unconfirmed payments become detectable.

### 6.4.8 Operational hardening and scale

*Limitation addressed:* no backup schedule, in-process rate limiting, a single predictor process, no load test, and an
availability model based on a stopped database (Chapter Five §5.6.4, §5.6.6).

*Why it matters:* these are the conditions under which a working prototype becomes an unreliable service.

*What would change:* a scheduled managed backup with a tested restore; a shared counter store for rate limits; a
predictor pool or an HTTP inference service with health checks; and a deployment profile with the database always
available. Each is an infrastructure change rather than a redesign.

*Additional resources:* a hosting budget beyond the student credit, a monitoring destination (the current environment
intentionally has no log workspace), and an error-reporting channel.

*Evaluation:* a load test at 500 and 1 000 candidates with concurrent registrations measuring p95 latency and error
rate; a restore drill against the managed server; and a rate-limit test across two replicas proving that the budget is
shared.

### 6.4.9 Accessibility, usability and acceptance

*Limitation addressed:* no accessibility audit, no cross-browser testing and no user acceptance study (Chapter Five
§5.4.8, §5.5.6).

*Why it matters:* the system's users are officers working at a counter with documents in hand; a screen that is correct
but slow or confusing to them fails the requirement it was built for, and NFR-14 is currently unverified.

*What would change:* an accessibility audit against a stated standard with remediation; cross-browser and small-screen
testing; and a structured acceptance session with serving officers using synthetic data, followed by remediation of the
findings.

*Additional requirements:* ethics approval and consent for a user study, access to serving officers, and a facilitator.

*Evaluation:* task success rate, time on task and error rate per task across participants, plus the number and severity
of accessibility findings before and after remediation.

### 6.4.10 Documentation and evidence hygiene

*Limitation addressed:* superseded project records contradict the implementation
(`docs/verification.md`, `docs/uat-test-plan.md`), and `docs/FINAL_TEST_REPORT.md` contains two generations of results
(Chapter Five §5.6.7).

*Why it matters:* the report's credibility rests on its evidence being traceable and self-consistent; an examiner who
finds a document claiming the predictor is uncalled will discount the rest.

*What would change:* retire or clearly mark superseded documents, keep one current test report whose header names the
commit and command, and record the date and revision with every count.

*Evaluation:* a reference check that no current document contradicts the code, and that every test count in the chapters
is traceable to a dated record.

---

## 6.5 Chapter summary

This chapter concluded that the project met its general objective in the form of a working, deployed artefact, and met
three of its four specific objectives fully or with a documented deviation, while the fourth — evaluating effectiveness
in detecting duplicate records — is only partially met because no adjudicated real-world labels exist. The delivered
system registers beneficiaries, screens them for near-duplicates through a versioned XGBoost model, routes candidates
to an administrator who alone can adjudicate, blocks approval and payment while a case is open or confirmed, records
payments as issued and separately as cleared with evidence, derives an exception list, verifies students and
certificates by QR without disclosing beneficiary data, and audits every state-changing action.

It also concluded, explicitly, what the system does not do: it does not operate across registries, does not claim
real-world detection performance, does not move money, does not obtain independent school confirmation, and is not a
production service. Its recommendations are directed at the programme owner (four decisions before real data is used),
administrators (work the queue, record reasons), field officers (capture the identifiers that make a case checkable),
and technical maintainers (implement blocking, persist configuration, harden operations). Its future work is confined
to the limitations that Chapter Five established, with candidate generation and adjudicated ground truth first,
because every other improvement is less valuable without them.
