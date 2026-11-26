# Instructions for Claude after verification

Use this verification package as a factual correction sheet. The repository's local source is authoritative for implementation claims; keep dated records and live deployment evidence separate. Do not ask the author to resolve items that this package already verifies.

## Report version and scope

1. Describe the inspected **local snapshot**: branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, plus explicitly identified uncommitted changes, reviewed 25 November 2026. Do not call this a clean, reproducible commit.
2. Treat `d229c62` as historical context only. It is an ancestor from 11 November, and its Guardian/workflow description predates later implementation. The alleged Word draft was not available for direct comparison; do not claim its exact contents were verified.
3. State that deployment completed earlier. Present dated Azure evidence as historical. Do not imply live parity with the local snapshot or describe deployment as outstanding.

## Required factual corrections

- Guardian registration, authenticated submission, and own-application viewing exist. Submitted applications are read-only. There is no Admin “More Info Required” status, selective field reopening, Guardian correction/resubmission route, or separate downloadable receipt in the inspected source. The application reference is shown as the submission acknowledgement.
- Current local serving artifact is HistGradientBoosting in a Pipeline under the legacy `xgb_duplicate_model.joblib` name. Do not describe it as XGBoost based on filename. Its score is an advisory review signal, not a final identity decision. Deployed model type/hash is unknown.
- Award beneficiary-verification constraint was dropped by migration. Preserve the distinction from unresolved duplicate-case gates, which still block eligibility/award progression. Describe both approval roles and separation of duties accurately.
- Use only the exact test run, date/snapshot, scope, and result supported by the evidence inventory. Do not repeat “154/175”; do not present historic “175/175” as current. Broad duplicate-flags evidence is failing/incomplete. State that this audit reran nothing.
- The seven requested diagrams were unavailable. Mark them “awaiting original diagram files”; do not infer corrections or fabricate replacements.
- November 18 screenshots are dated, some are stubs, and they predate later Guardian changes. Do not use them as evidence of the current authenticated Guardian pipeline. The author will handle wireframes. Do not change the approved title/abstract based on inference; retain pending the latest master/author-approved text.

## Evidence style

Name source paths, routes, functions, migration names, commit IDs, and dates. Use “implemented,” “partially implemented,” “not implemented,” or “unverified” precisely. Distinguish source inspection from runtime proof, synthetic metrics from real-beneficiary performance, historical deployment from local testing, and recorded test summaries from raw commit-bound logs.

This package resolves the implementation conflicts available from repository evidence. It does not authorize editing the academic report, application, model, database, live environment, screenshots, or diagrams.
