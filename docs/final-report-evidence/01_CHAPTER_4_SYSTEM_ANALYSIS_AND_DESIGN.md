# Chapter 4: System Analysis and Design

> **Evidence binding.** This chapter describes the current checkout inspected on 25 November 2026: branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, plus a dirty working tree. The current working tree includes uncommitted implementation and model changes. Source files are cited by repository path. Exact proposal wording, approved objectives, and the original academic guide are not in this checkout; proposal alignment must be checked by the author before submission. Diagrams are specified in words only and have not been drawn.

## 4.1 Introduction

This chapter analyses the implemented Student Beneficiary Management System (SBMS) and records the requirements and design decisions that can be verified from the present source. The system provides a browser-based workflow for Guardian applications, staff review, beneficiary records, advisory duplicate screening, eligibility assessment, award decisions, audit records, notifications, and verification of student and award-certificate records. This description is limited to implementation evidence; it does not assume that every feature in the project brief or an earlier design document is present.

The approved proposal and Chapters 1–3 were not found in the repository. Accordingly, the development methodology and exact approved objectives cannot be quoted here. The report author should insert the approved wording and state the actual methodology used, with supporting author records. Older chapter drafts are useful historical material but are not current implementation evidence.

The ML implementation has changed during this work. The current estimator is a `HistGradientBoostingClassifier` stored at the retained legacy path `ml-service/model/xgb_duplicate_model.joblib`, with schema `student-pair-v2-admission-number` (see `xgb_duplicate_model.metadata.json`). XGBoost, Random Forest and other candidates were compared using validation data; uncalibrated HistGradientBoosting was selected for this synthetic run. The project brief also says the approved proposal specified Random Forest, but the proposal itself is absent. Report both deviations and ask the author/supervisor for the approved rationale; do not invent one.

## 4.2 System scope and actors

| Actor | Verified responsibilities | Restrictions / qualifications |
|---|---|---|
| Guardian | Registers an account at `/guardian/register`, signs in, submits student and household information, views their own applications and profile. | Guardian application endpoints are scoped to the signed-in user. Submitted application fields are read-only; the code has no Guardian application-edit endpoint. |
| Field Officer | Signs in, views registered students that satisfy the duplicate/assessment filters, runs/records manual eligibility assessment where supported, proposes a bursary award, accesses permitted award/certificate functions. | Cannot read the Administrator duplicate queue or decide an award. The registered-student read model filters unresolved duplicate cases. |
| Administrator | Manages user accounts, reviews duplicate cases, reveals protected identifiers through an audited action, manages Guardian application statuses, decides awards, reviews reports and audit records. | Duplicate score is evidence for human review, not a finding of fraud. |
| Public verifier | Submits a student-record token or award-certificate token/reference to a public verification endpoint. | Student verification returns existence only. Certificate verification returns certificate facts, not identity authentication or proof of payment. |
| System services | Validate and persist records, call the Python model, calculate eligibility, write audit/notification records, issue certificates and expose health/readiness. | Automatic operations do not replace the human review/award decision. |

The current UI has three account roles (`guardian`, `field_officer`, `admin`). Staff use a shared login; the generic `/api/auth/register` endpoint is disabled, while Guardian self-registration is separately mounted at `/api/guardian/register`. See `frontend/src/App.jsx`, `backend/src/routes/auth.routes.js`, `backend/src/routes/guardian.routes.js`, `backend/src/middleware/requireRole.js`.

## 4.3 Implemented workflow analysis

### 4.3.1 Guardian submission and screening

1. A Guardian creates an account, signs in, and submits an application through the Guardian Portal.
2. The API validates the application, starts a database transaction, serialises repeated submissions for that Guardian, and creates or locates the Guardian application record.
3. The submission is linked to a student record. The shared registration service compares it to existing student records using the Python model predictor (current artifact: `HistGradientBoostingClassifier`), applies the configured threshold and aggregation policy, records selected duplicate cases, and writes audit evidence.
4. If no blocking duplicate case remains, an automatic eligibility assessment is recorded from the submitted scoring inputs. If the student has an unresolved/confirmed duplicate state, automatic/manual eligibility and award progression are blocked.
5. The Guardian can view their application status and details. Current application states are `submitted`, `under_review`, `approved`, and `rejected`; new submissions are recorded as `under_review`.

Evidence: `backend/src/controllers/guardian.controller.js`, `backend/src/services/guardianApplicationLink.js`, `backend/src/services/studentRegistration.js`, `backend/src/services/automaticAssessment.js`, `backend/src/models/student.model.js`, `frontend/src/pages/NewApplication.jsx`, `frontend/src/pages/ApplicationDetails.jsx`.

**Correction-workflow gap:** the current API has no application-field patch route or `more_info_required` status. `PATCH /api/guardian/me` changes profile fields only. The application UI states submitted applications are read-only. The implementation therefore does not meet the brief's proposed field-limited More Info Required correction behavior.

### 4.3.2 Duplicate review and resolution

The Python service returns a score and six feature values for each candidate pair. The Node service validates the response, batches comparisons, captures the model hash/version, and records the threshold and features with cases. The default aggregation policy is `top-1-corroborated`: a candidate is selected for review if it meets the configured score threshold or exact identifier evidence, but the default policy suppresses a non-exact candidate if it lacks the minimum corroborating-field count. Guardian-only similarity is explicitly not enough because siblings may share a guardian. Admission number is compared only in school context.

The current routes expose listing, identifier reveal, ad-hoc pair scoring, rescanning, case update, and resolution through the Administrator-only duplicate-flags API. Reviewer decisions and reasons are stored in duplicate review events and audit logs. The model does not automatically merge, reject, or label a student fraudulent. Evidence: `backend/src/routes/duplicateFlags.routes.js`, `backend/src/controllers/duplicateFlags.controller.js`, `backend/src/services/duplicateAggregation.js`, `backend/src/services/mlDuplicateReview.js`.

### 4.3.3 Eligibility and award lifecycle

Eligibility is a separate rule-based calculation, not the duplicate model. Five factors are scored: outstanding fee balance (30 points), household income (25), vulnerability (25), siblings in school (10), and prior bursary history (10). Bands are high (70–100), moderate (40–69), and low (0–39). Amount ranges are explicitly provisional unless all configured ranges are supplied. A score/category is a recommendation and does not approve an award.

The Field Officer proposes an award for an eligible, duplicate-cleared student. The Administrator approves or rejects it. The application also implements audited correction/void functions for award records. Approval automatically issues a QR-verifiable certificate; award approval remains distinct from payment. There is no disbursement route or payment-operation screen in the current API/UI. A legacy `disbursements` table remains in the schema and public certificate verification reads any stored rows to show payment-tracking totals; this is not a payment processing capability.

Evidence: `backend/src/services/eligibility.js`, `backend/src/controllers/eligibility.controller.js`, `backend/src/routes/bursaryAwards.routes.js`, `backend/src/controllers/bursaryAwards.controller.js`, `backend/src/services/certificateIssue.js`, `backend/src/controllers/certificates.controller.js`, `backend/src/services/invoiceDocument.js`, `frontend/src/pages/Awards.jsx`, `frontend/src/pages/CertificateVerification.jsx`.

### 4.3.4 Student and certificate verification

`POST /api/verify` accepts a student QR token and returns a found/not-found result without student details. Certificate verification is a separate endpoint and page; it accepts a certificate token or normalized typed reference and checks the stored certificate against the current award record. The certificate shows approval facts and any payment information read from legacy records. It does not prove the beneficiary's identity or that money was transferred. Public endpoints are rate-limited and responses are deliberately narrower than staff views.

## 4.4 Requirements catalogue

Priorities below are documentation priorities for describing the implemented scope, not a claim that the original proposal assigned these priorities. Requirements and evidence are expanded in `06_REQUIREMENTS_TRACEABILITY.csv`.

| ID | Requirement statement and exception | Priority | Rationale/source | Verification method | Status and evidence |
|---|---|---:|---|---|---|
| FR-01 | Guardian can create an account with validated contact/identity fields and privacy consent; duplicate email/ID is refused. | High | Guardian intake is the current submission path. | API registration test and source inspection. | Implemented; `guardian.controller.js`, `guardian.test.js` (suite exists; not re-executed in the 25 November pass). |
| FR-02 | User can sign in; stored role controls landing/access; inactive or wrong-role access is refused. | High | Protects role-specific records. | Auth/role tests. | Implemented; `auth.test.js`, `roleAuthorization.test.js`, `securityMiddleware.test.js` present and executable locally once `backend/.env.test` is loaded; not re-executed in the 25 November pass. |
| FR-03 | Guardian can create a student bursary application with required student, guardian and eligibility fields; invalid input is rejected with field errors. | High | Current principal intake path. | Guardian API tests and Zod schemas. | Implemented; `guardian.controller.js`, `NewApplication.jsx`. |
| FR-04 | Guardian can list and view only their own applications. | High | Privacy and ownership. | Cross-account API test. | Implemented in code/tests; not run here. |
| FR-05 | Submitted application details remain read-only to the Guardian; profile edits do not alter the application. | High | Current product behavior. | Route/UI inspection and ownership tests. | Read-only application path implemented; no application edit route. |
| FR-06 | Guardian can correct only requested fields/documents after an Administrator requests more information. | High | Explicit in project brief. | Status/edit workflow test. | **Not implemented**: no such status/patch route found. |
| FR-07 | Submission is linked to a student and screened against existing registry records using shared model features. | High | Duplicate detection objective. | Screening integration test and model version/feature audit. | Implemented; screening failure aborts submission with 503. |
| FR-08 | Potential duplicates are recorded for human review, with score/version/threshold/features and audit trail. | High | Advisory human-in-the-loop rule. | Duplicate workflow and audit tests. | Implemented; no automatic fraud decision. |
| FR-09 | Administrator can reveal protected identifiers only through the audited reveal endpoint. | High | Review requires source-document comparison. | Route test and audit assertion. | Implemented in current code; current suite not run. |
| FR-10 | Administrator can resolve a duplicate case with a reason; unresolved cases block eligibility/award progression. | High | Prevents a duplicate flag being bypassed. | Workflow integration test. | Implemented in source; tests exist but not run here. |
| FR-11 | Field Officer can view registered records only when duplicate/assessment filters are satisfied. | High | Least privilege and workflow gate. | Query/API role test. | Implemented in model query and route guards. |
| FR-12 | Field Officer can assess eligibility; unresolved duplicate records are refused; result and inputs are saved. | High | Financial-need review. | Eligibility and workflow tests. | Implemented; recommendation not approval. |
| FR-13 | Field Officer can propose an award only for eligible, duplicate-cleared student records. | High | Separate recommendation from decision. | Award tests and controller gate. | Implemented. |
| FR-14 | Administrator can approve/reject an award and record the decision; self-approval is not allowed. | High | Separation of duties. | Award controller tests. | Implemented in source/tests. |
| FR-15 | Approved awards produce an approval certificate; public QR/reference verification checks record currency. | Medium | Demonstrable award record. | Certificate route tests and QR evidence. | Implemented; does not indicate payment. |
| FR-16 | System provides admin reports, dashboards, audit logs, and role-appropriate notifications where implemented. | Medium | Operational oversight. | API/UI source inspection. | Implemented in current routes/services; exact live operation unverified. |
| FR-17 | System transfers bursary funds or records live disbursement/payment through an operational workflow. | Low | Distinguishes scope from payment execution. | Route and UI inventory. | **Not implemented** as current transaction workflow; legacy table/read-only certificate summary remains. |
| NFR-01 | Enforce role checks server-side, not solely in React routes. | High | Security requirement. | Middleware and route test. | Implemented in source; security certification not performed. |
| NFR-02 | Hash passwords and avoid returning password hashes. | High | Credential protection. | Auth controller and tests. | bcrypt code present; not a security certification. |
| NFR-03 | Preserve relational referential/integrity constraints and prevent conflicting duplicate pair rows. | High | Data integrity. | SQL migrations and DB tests. | Constraints/indexes present; current database migrations not executed here. |
| NFR-04 | If model inference fails or returns invalid/schema-incompatible output, fail closed rather than silently clearing a record. | High | Avoid unscreened records appearing clean. | Predictor/integration tests. | Implemented in source (`mlDuplicateReview.js` rejects invalid payloads, version drift and non-numeric scores); `mlPredictor.integration.test.js`, `predictorDateNormalization.test.js` exist; not re-executed in the 25 November pass. |
| NFR-05 | Keep prediction advisory and require human review for duplicate resolution and award decisions. | High | Harm prevention/business rule. | Workflow/controller inspection. | Implemented by separate case/decision routes. |
| NFR-06 | Provide safe public verification without exposing student identifiers. | High | Privacy. | Public endpoint tests and response shape. | Implemented; certificate endpoint intentionally reveals printed approval facts. |
| NFR-07 | Maintain responsiveness, scale to large registries, and meet a response-time target. | Medium | Usability/operations. | Load test at defined registry sizes. | **Not demonstrated**; no current load-test result. |
| DR-01 | Store Guardian identity/account, student application, status and submitted inputs with ownership linkage. | High | Current intake. | Schema/migration inspection. | Implemented by `users`, `guardian_applications`. |
| DR-02 | Store student and school/admission information, duplicate cases/resolutions/events, and model provenance. | High | Screening and staff decision trail. | Schema and service inspection. | Implemented; no real-beneficiary sample included in evidence package. |
| DR-03 | Store eligibility inputs/results, awards, certificates, audit, notifications and report records. | High | Workflow records. | Schema/migration inspection. | Implemented; provisional configuration/data retention need owner confirmation. |
| IR-01 | React/Vite frontend calls Express REST API and Python predictor; PostgreSQL persists records. | High | Actual architecture. | Source and config inspection. | Implemented; the predictor runs as a Python child process in the API container design. |
| IR-02 | Publish/build API container and deploy frontend/database through Azure. | Medium | Azure is stated deployment target. | `docs/azure-deployment-log-2026-10-31.md` records completed deployment and later live checks. | Deployment completed earlier; current local/live revision parity is not established by this local pass. |

## 4.5 Data design

The schema source and migrations declare 18 distinct tables: `users`, `password_reset_tokens`, `students`, `duplicate_flags`, `duplicate_review_events`, `disbursements`, `audit_logs`, `reports`, `beneficiaries`, `guardian_applications`, `bursary_awards`, `bursary_award_verification_events`, `disbursement_reconciliation_events`, `bursary_certificates`, `notifications`, `bursary_award_correction_events`, `eligibility_assessments`, and `duplicate_resolutions`. The `/api/ready` check requires 11 core tables; it does not prove that an external database has every optional/legacy table or every current migration.

Important relationships include: Guardian user → Guardian applications; application → linked student; student → eligibility assessments and awards; duplicate flag → student pair and review events/resolution; award → proposal/decision/certificate and any legacy disbursement rows; all consequential actions → audit entries; notifications → recipient user. SQL migrations define foreign keys, state checks, indexes, unique award-per-year and unordered-pair protections. Verify the exact deployed schema against the migration ledger before claiming live parity.

Data includes contact and identity information, student DOB/school/admission number, birth-certificate number, household and financial-need inputs, duplicate review metadata, award decisions, and audit records. Access is role-gated; identifier reveal has a dedicated audited path. Public student verification returns a boolean. Public certificate verification returns printed approval facts and payment summaries from stored rows; this is a deliberate privacy and transparency decision that should be reviewed by the data controller. The repository does not establish retention periods, formal lawful-basis decisions, or a completed privacy-impact assessment.

## 4.6 Interface and integration design

| Interface | Purpose | Evidence |
|---|---|---|
| Guardian Portal | Guardian registration, login, dashboard, new application, application list/details and profile. | `frontend/src/pages/GuardianRegistration.jsx`, `NewApplication.jsx`, `MyApplications.jsx`, `ApplicationDetails.jsx`; `backend/src/routes/guardian.routes.js`. |
| Administrator interface | Application status queue, duplicate review, awards, reports, audit logs, users, settings. | `frontend/src/pages/Applications.jsx`, `DuplicateReview.jsx`, `Awards.jsx`, `Reports.jsx`, `AuditLogs.jsx`, `UserManagement.jsx`, `Settings.jsx`. |
| Field Officer interface | Registered student list, eligibility, award proposal, award/certificate access. | `frontend/src/pages/Students.jsx`, `Eligibility.jsx`, `Awards.jsx`; `backend/src/routes/students.routes.js`. |
| REST API | Authenticated and public HTTP endpoints; JSON request/response; middleware enforces roles, validation and rate limits. | `backend/src/index.js`, `backend/src/routes/`. |
| ML inference | Node calls `ml-service/predict.py` as a managed Python child process, scores batches (up to 200 pairs), checks model version/response, and records score/features. | `backend/src/services/duplicateCheck.js`, `mlDuplicateReview.js`; `ml-service/predict.py`. |
| PostgreSQL | Persisted users, applications, students, review, eligibility, award, notification and audit records. | `backend/src/config/db.js`, `backend/src/db/schema.sql`, migrations. |
| Public verification | Separate endpoints/pages for student record token and certificate token/reference. | `backend/src/index.js`, `backend/src/controllers/verification.controller.js`, `certificates.controller.js`, frontend verification pages. |
| Deployment | Repository Dockerfile builds API with Python model environment; workflow publishes image; Azure scripts describe resource operations. | `Dockerfile`, `.github/workflows/publish-api-image.yml`, `deploy/azure/`. Current live binding unverified. |

## 4.7 Written diagram specifications (no diagrams created)

1. **System context:** Guardian, Administrator, Field Officer, public verifier around the SBMS web app/API, PostgreSQL, local Python predictor and Azure hosting. Show only implemented data flows; label the prediction advisory and exclude payment transfer.
2. **Role/use-case view:** Guardian account/application and own records; Field Officer registered student/eligibility/award proposal; Administrator duplicate/application/award decisions and audit; public token/reference verification. Apply route-level authorization from `backend/src/routes/`.
3. **Guardian workflow activity:** Guardian registration/login → application submit → transaction links student → duplicate screening → eligible assessment or duplicate hold → staff review → Administrator application/duplicate decision → Field Officer roster/award proposal → Administrator award decision → certificate. Explicitly show that no More Info Required edit state exists.
4. **Duplicate-screening sequence:** React submits application; Express validates and begins DB transaction; Node builds candidate records and batches pair requests to Python; Python uses the feature helper and checked model; Node applies score/exact-ID/aggregation policy; DB stores flags/provenance/audit; human Administrator resolves. Include failure path: predictor failure returns an error and does not claim a clear screen.
5. **Logical data model:** Use the 18 declared tables above; show key foreign-key relationships and identify `beneficiaries`, `disbursements`, and award-verification tables as legacy/compatibility records where applicable. Derive keys and cardinalities from `schema.sql` and migrations, not from the old draft.
6. **Award/certificate lifecycle:** Field Officer proposal → Administrator approve/reject → approval transaction issues certificate → staff prints → public token/reference verification. Label payment as outside operational workflow; existing payment rows may be reported only as recorded history.
7. **Deployment architecture:** React frontend, Express API container, PostgreSQL service, Python child process packaged in API image, GHCR image publishing workflow, and completed Azure deployment. Separate the dated deployment records from local verification; do not imply the latest local working-tree changes are deployed.
8. **Role and data access view:** Map Guardian ownership scoping, Field Officer filtered roster, Administrator-only duplicate and application decisions, and public limited verification responses. Highlight audited identifier reveal.

## 4.8 Chapter summary

The current design has authenticated Guardian intake, linked student/duplicate/eligibility processing, Administrator review and award decision, Field Officer operational access, and certificate verification. The key design constraints are role separation, human decisions, duplicate gating, model provenance, and a distinction between approval and payment. Deployment was completed earlier; use its dated records and keep it distinct from current local verification. The proposal, exact objectives, More Info Required editing flow, local/live version parity, and data-governance commitments require author evidence before this chapter can be considered fully reconciled with the approved project.
## 4.9 Objective-to-requirement traceability (written matrix)

The four approved objectives are quoted in the report as supplied by the author; the mapping below is the evidence-side view, and the machine-readable version is `06_REQUIREMENTS_TRACEABILITY.csv`.

| Objective (topic) | Requirements | Design elements | Implemented feature | Test / evidence |
|---|---|---|---|---|
| O1 — challenges of manual beneficiary registration and tracking | FR-03, FR-05, FR-07, FR-08, DR-01, DR-02 | Guardian Portal, `guardian_applications` + `students`, application locking, audit trail | Authenticated application intake with one-record linking and duplicate screening | `guardianPipeline.test.js`, `workflow.test.js`, `docs/beneficiary-processing-workflow-2026-11-05.md` |
| O2 — architecture, database schema and ML pipeline | IR-01, IR-02, DR-02, DR-03, NFR-04 | React SPA → Express API → PostgreSQL; Python child-process predictor inside the API image; 18-table schema | Six-feature XGBoost pipeline, school-gated admission comparison, top-1 corroborated aggregation, provenance stored with each case | `backend/src/db/schema.sql` + 24 forward migrations, `ml-service/*.metadata.json`, `ml-service/tests/`, `Dockerfile` |
| O3 — implementation of the web-based management system | FR-01…FR-17, NFR-01…NFR-06 | Role guards, Zod validation, rate limits, certificate issuance, notifications, reporting | Working Guardian/Administrator/Field Officer flows and public verification | `backend/tests/`, `frontend/src/App.jsx`, route inventory in `02_CHAPTER_5…md` §5.3 |
| O4 — validation and testing of duplicate detection and beneficiary tracking | FR-07…FR-11, NFR-04, NFR-05 | Synthetic pair generator, training/validation/holdout separation, integrity checks, Jest + unittest suites | Model evaluation harness, duplicate-review regression tests, workflow gating tests | `ml-service/evaluation/`, `ml-service/tests/`, `backend/tests/duplicate*.test.js`, executed results in `02_CHAPTER_5…md` §5.4 |

## 4.10 Claims Chapter 4 must not make

1. Do not state that a Guardian can edit flagged application fields after an Administrator request; no such state or route exists in this checkout.
2. Do not present disbursement or payment as a current operational feature; only legacy read-only data remains.
3. Do not describe Field Officers as the officers who register all students, or as having administrative access to raw Guardian applications.
4. Do not state that the duplicate score establishes fraud, eligibility or identity; it is advisory and the Administrator decides.
5. Do not state that the model predicts on UPI, or that admission numbers are compared across schools.
6. Do not claim real-world accuracy, fairness or prevalence-based precision from the synthetic artifacts.

