# Chapter 6: Conclusions, Recommendations and Future Works

> **Evidence note.** The approved proposal and exact four specific objectives were not present in the checkout. This chapter follows the four objective summaries supplied in the project brief; replace them with the approved wording before submission. Conclusions refer to the current repository and the evidence in Chapters 4 and 5.

## 6.1 Introduction

This chapter summarizes what the current SBMS implementation demonstrates, what remains unverified, and the actions needed before operational or academic claims are made. It does not treat synthetic model performance as evidence of accuracy on real applicants.

## 6.2 Conclusions

### Objective 1: Investigate the challenges in beneficiary registration and tracking

The system provides a structured digital application, linked student record, status tracking, screening, review and award records. The repository demonstrates that these workflows were implemented. It does not contain verified field interviews, observations, or an approved research dataset establishing how frequently manual records are duplicated or lost. The objective is therefore **partially demonstrated** by the software; primary research evidence must be supplied from the project study.

### Objective 2: Design the system architecture, database schema and ML pipeline

The current design joins a React interface, Express API, PostgreSQL schema/migrations, and Python model inference. The model uses six ordered features and school-gates admission-number comparison. `metadata.json` records a `sklearn.pipeline.Pipeline` wrapping an uncalibrated `HistGradientBoostingClassifier` (validated review cutoff 0.63) stored under the compatibility filename `xgb_duplicate_model.joblib`; the filename must not be read as evidence of the algorithm, and the approved proposal wording (Random Forest) still has to be reconciled with this implementation. This objective is **partially achieved** because the design and implementation exist, while the approved proposal wording and current deployed architecture could not be verified.

### Objective 3: Implement the web-based beneficiary management system

Guardian registration and submission, administrative duplicate review, eligibility assessment, Field Officer access, award decision, and certificate verification are present in the current source. Human reviewers retain decision authority. The requested Guardian “More Info Required” field-limited correction flow is absent, and payment transfer is not implemented as an operational transaction. The objective is **partially achieved** against the requirements supplied in the brief; Chapter 4 and the traceability matrix identify these deviations.

### Objective 4: Validate the system and evaluate duplicate detection

On 25 November 2026 the backend duplicate-check and eligibility suites were executed against the local `sbms_test` database and passed as a single run of 33 tests, and 18 ML unit tests covering the feature contract and operating-point diagnostics passed in the service virtual environment. A wider backend run left `duplicateFlags.test.js` at 6 failed / 9 passed; the first failure is a missing `students.admission_number` column because `20261124_guardian_admission_number.sql` is not registered in `MIGRATION_ORDER`, so the duplicate-review suite cannot be described as green until that is fixed. The structural split audit recorded zero overlapping groups, identities, guardian clusters, identical rows, directed pairs and reversed pairs. The shipped artifact's synthetic metrics (holdout F1 87.48% at the validation-selected 0.63 cutoff) reproduce its `model/xgb_duplicate_model.metadata.json` block, and the depth-2 validation baseline of 84.90% shows the generator remains more separable than the intended challenge benchmark. No adjudicated real-beneficiary set or user acceptance evidence was available. Dated deployment records exist, but the current local/live revision parity was not checked in this pass. The objective is **partially achieved** for software and synthetic validation, but real-world detection effectiveness is **not demonstrated**.

## 6.3 Recommendations

1. **Project author and supervisor:** reconcile the exact approved objectives and algorithm wording with the implemented system before final submission; retain original proposal wording and describe deviations.
2. **SBMS data owner:** create an authorized, privacy-reviewed, pseudonymized sample of human-adjudicated positive and negative candidate pairs. Include records the live system did not flag and keep all appearances of each person in a single partition.
3. **ML maintainer:** review the generator using domain-reviewed examples and rerun the depth-2 hardness diagnostic. Do not alter labels or select a threshold to force a percentage. Keep the model in advisory use until real evaluation supports a decision.
4. **Application maintainer:** implement or formally remove the More Info correction requirement, with field-level authorization and audit evidence; keep duplicate resolution and award decisions human-controlled.
5. **Technical handoff:** keep completed deployment records separate from local test evidence. Do not redeploy as part of this phase, and do not claim that the live system contains the current local changes without revision-specific evidence.
6. **Project author:** complete a controlled usability/UAT study and provide its approved protocol, anonymized results and limitations; do not infer acceptance from automated tests.

## 6.4 Future works

- Evaluate the model on independently adjudicated, person-separated cases; report prevalence, precision/recall, FPR/FNR, calibration and errors by candidate scenario.
- Build a representative candidate-blocking set from actual screening logic and measure candidate recall separately from pair classifier metrics.
- Review model and policy thresholds with administrators using a documented cost of false review versus missed duplicate; validation-only model thresholds do not automatically set the live API policy.
- Add monitoring for score distributions, missingness, review outcomes, drift and appeals, subject to privacy and governance approval.
- Complete the More Info workflow and test end-to-end Guardian, Administrator and Field Officer permissions.
- As future resilience work, document recovery procedures for the already deployed service; this is not a pending deployment task.

## 6.5 Chapter summary

SBMS demonstrates an integrated beneficiary-management design and a human-reviewed duplicate-screening workflow. The current synthetic training is reproducible and passes its structural split-integrity checks; the shallow-tree hardness baseline is narrowly below the proposed gate, but synthetic metrics do not establish real-world effectiveness. Proposal evidence, authorized adjudicated cases, local/live revision-parity evidence where relevant, and user-study evidence remain necessary to close the main gaps. Deployment itself was completed earlier.
