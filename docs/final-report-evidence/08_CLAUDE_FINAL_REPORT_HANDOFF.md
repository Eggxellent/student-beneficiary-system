# Handoff for assembling the final Word report

> **Deployment status:** Azure deployment was completed earlier. The current phase is local testing and verification. Read `09_DEPLOYMENT_STATUS_AND_LOCAL_VERIFICATION.md` before making deployment claims. Do not deploy, redeploy, publish, migrate, reconfigure, or alter production. Do not claim the live deployment includes the latest local changes unless revision-specific evidence proves it.

## Chapter order

1. Retain the approved title page, declaration, abstract, acknowledgements, contents and list of tables/figures required by Strathmore University.
2. Use the author-approved Chapters 1–3. Do not replace approved objectives or literature review with repository-derived paraphrases.
3. Insert Chapter 4 from `01_CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md`.
4. Insert Chapter 5 from `02_CHAPTER_5_IMPLEMENTATION_TESTING_EVALUATION.md`.
5. Insert Chapter 6 from `03_CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_FUTURE_WORKS.md`.
6. Append the student-confirmed AI declaration and consolidated APA 7 references from `04_AI_USE_DECLARATION_AND_REFERENCES.md`.
7. Add appendices based on `05_APPENDIX_EVIDENCE_INDEX.md` and the approved evidence set.

## Facts to preserve

- The current production feature order is `jaro_winkler`, `dob_match`, `school_match`, `guardian_match`, `admission_number_match`, `birth_certificate_match`; no UPI feature is used.
- Admission-number comparison requires a school match.
- The model artifact path retains the compatibility filename `xgb_duplicate_model.joblib`; `metadata.json` records `model_type: sklearn.pipeline.Pipeline` around an uncalibrated `HistGradientBoostingClassifier`, schema `student-pair-v2-admission-number`, six ordered features and no UPI feature.
- Every metric quoted in the report must match the `training_metrics`, `validation_metrics` and `holdout_metrics` blocks of `ml-service/model/xgb_duplicate_model.metadata.json` for the artifact actually submitted. If figures change after retraining, update the manuscript tables from that file; do not mix values from older evaluation JSON.
- The recorded review threshold is 0.63 (selected on validation only), while `ML_REVIEW_SCORE_THRESHOLD` defaults to 0.50 in the API. State both and keep them distinct.
- The old test artifacts were archived under `ml-service/backup_contaminated/`. Structural checks show zero group, identity, guardian, duplicate-row, directed-pair, or reversed-pair overlaps.
- The backend `duplicateCheck` and `eligibility` suites passed as one run of 33 tests against local `sbms_test`, and 18 ML tests (`tests.test_feature_engineering`, `tests.test_operating_point`) passed in the service virtual environment. `duplicateFlags` fails on stale test-database migration, and no other suite or frontend build was completed. None of this proves real-beneficiary accuracy; Administrator review remains mandatory.
- Duplicate findings remain advisory; an Administrator makes resolution/award decisions. Awards/certificates do not establish that money was paid.
- More Info field-limited Guardian corrections and live payment transfer are not implemented in the current source evidence.
- Deployment completion and later deployment activity are recorded in `docs/azure-deployment-log-2026-10-31.md`; the latest recorded frontend redeployment is 18 November 2026. Current local/live revision parity was not established in this local documentation pass, and only part of the automated test suite was executed (see the next section). Treat this as a version-parity and test-coverage evidence limit, not as an unfinished deployment.

## Formatting and evidence rules

- Follow the university's current template for typography, margins, spacing, headings, page numbering, captions and APA 7 formatting; the template itself was not supplied in the repository.
- Keep Chapter 4/5/6 numbering consistent with Chapter 1–3 and keep objective conclusions in the approved objective order.
- Include requirement and test IDs consistently, using `06_REQUIREMENTS_TRACEABILITY.csv` as the cross-reference source.
- Cite original academic/legal sources in the manuscript where claims depend on them. Technical docs in the draft bibliography do not replace sources for Kenyan policy, empirical context or research findings.
- Do not invent screenshots, participants, UAT, deployment state, test results or citations.
- Do not create or insert diagrams from this handoff. The user will prepare diagrams separately from the written specifications in Chapter 4.
- Mask all personal information, student identifiers, tokens, endpoints that reveal credentials, and cloud account details in any appendix evidence.
- Preserve the synthetic-only qualification wherever ML metrics are quoted; do not present the balanced synthetic precision as production precision.

## Final author review

Before submission, obtain supervisor confirmation of objective wording and deviations, close the items in `07_EVIDENCE_GAPS_AND_USER_ACTIONS.md` that the project can support, review the AI-use declaration, proofread the assembled document, and ensure every table/figure/reference is cited in the text.
