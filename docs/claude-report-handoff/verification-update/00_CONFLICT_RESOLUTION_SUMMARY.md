# SBMS conflict resolution summary

**Audit date:** 25 November 2026  
**Repository snapshot:** `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326` (`0080482`), commit dated 24 November 2026. The working tree was already dirty.  
**Scope:** Read-only inspection of repository evidence. No tests, model evaluation, training, database changes, deployment, or academic report edits were performed for this package.

## Decisions for the report

1. **Chapters 4–6 should describe the current local implementation snapshot, not d229c62.** Identify it precisely as branch `fix/restore-original-ui`, HEAD `0080482…`, plus the relevant uncommitted working-tree changes as inspected on 25 November. Since the tree is dirty, it is not a single reproducible commit. Do not imply the live service has this exact code. `d229c623e718b5fbbc723d4802d1b9ae756813f7` exists as an ancestor dated 11 November 2026; it is historical context. The Word report itself was not found in the repository, so the assertion that its chapters bind to d229c62 could not be independently checked.
2. **The active local artifact is HistGradientBoosting, not XGBoost.** The compatibility filename `ml-service/model/xgb_duplicate_model.joblib` is misleading. The current training source imports `HistGradientBoostingClassifier`; the joblib byte content contains its class marker, while the accompanying metadata calls the outer object only a `sklearn.pipeline.Pipeline`. Serving code loads this artifact through `joblib`. This verifies the current local artifact from source/metadata/serialized marker inspection, not the model deployed in Azure.
3. **The old award-beneficiary verification gate is removed.** Migration `20261111_remove_award_verification_gate.sql` drops `bursary_awards_approval_verification_check`; verification columns/history remain. Approval still requires an Admin decision and is blocked by unresolved duplicate cases and other award rules. Do not describe this as a duplicate-review gate being removed.
4. **Test results are run-specific and must not be merged.** Current evidence records a targeted 25 November backend run (duplicate check + eligibility, 2 suites/33 tests) and selected ML checks (18 tests); broader backend output records failures in duplicate flags. Full historical results belong to older snapshots. The phrase “154/175” was not found as a test result. “175/175” appears as a historical claim in a d229-era state note, not as a current run.
5. **The seven requested diagrams cannot be audited individually from the repository contents.** The seven diagram source/image files were not found. One Mermaid certificate data-flow file exists, but it is not a substitute for the seven requested diagrams. Ask the report author to supply the originals; then audit/update them against this snapshot.
6. **Treat existing screenshots as dated evidence, not current Guardian workflow proof.** The 18 November browser-smoke assets are gitignored and include explicitly stubbed screenshots. They predate the 21–24 November Guardian account/application pipeline changes. Do not recapture or edit screenshots as part of this package. The user will handle wireframes. The Word report and its screenshot placements were unavailable, so individual report-image references cannot be mapped. Keep the approved title/abstract unchanged pending the author's latest master document; make no unsupported claims about them.

## Verified repository version

- Branch: `fix/restore-original-ui`.
- HEAD: `0080482354b35d3d784cd34bd05879c63f2fd326`, dated 2026-11-24 13:56:02 +03:00.
- `d229c62` resolves to `d229c623e718b5fbbc723d4802d1b9ae756813f7`, is an ancestor, and is dated 11 November.
- The worktree contains pre-existing modifications across backend, frontend, ML, evaluation data, and documentation, plus untracked files. It was not changed by this audit except for this new verification package.
- Post-d229 changes include Guardian application/account and screening flows, duplicate-case decisions/resolution, awards/certificates, and subsequent frontend/backend corrections. See `01_CURRENT_IMPLEMENTATION_VERIFICATION.md` and `05_DEPLOYMENT_VS_LOCAL.md`.

## Source boundary

The actual source tree is authoritative for local implementation. Repository deployment logs are historical deployment evidence, not a live status query. No `.doc`/`.docx` copy of the Word report or the seven diagram files was located. A previous handoff may contain useful claims, but those claims are retained only where independently supported by code or dated evidence.
