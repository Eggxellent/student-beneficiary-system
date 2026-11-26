# Deployment status and current local verification phase

## Status

**Deployment was completed earlier.** Azure provisioning, API/frontend deployment, and live checks are recorded in `docs/azure-deployment-log-2026-10-31.md`. Deployment is not a pending implementation task for this handoff. The current project phase is local testing, manual verification, bug identification, and preparation of technical evidence for the final report.

Do not deploy, redeploy, publish, migrate, reconfigure, or write to the live application or production database as part of this phase. Do not add deployment work as an outstanding requirement. This note records existing configuration and evidence only.

## What the available deployment records establish

- The deployment log marks Azure provisioning and live deployment/verification as **Done**. Its November 2026 entries record API and frontend live checks, API image references, database migration activity, and successful frontend zip deployments.
- The most recent deployment activity identified in the checked-in log is dated **18 November 2026**. It records a frontend rebuild/redeployment and follow-up redeploy after correcting a stale cached shell. The same log records successful deployment commands and live HTTP checks.
- The log's November 12 section records API image `ghcr.io/eggxellent/sbms-api:a5c4ef4746144d83db15ee75731a83655b4a2c0e` and live health/readiness checks. Later entries in the log focus on frontend redeployments; they do not establish that the current local working tree was deployed.
- `docs/azure-deployment-plan-2026-10-30.md` is a historical planning and cost document. Its original “research only” wording describes the planning stage and is superseded by the completed deployment records in the deployment log.
- `academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md` is a dated **3 November 2026** snapshot. Its `a3714f8` image and nine-commit lag statement describe that earlier snapshot, not the latest deployment activity recorded later in November.

These are repository records, not a new live Azure query performed during this documentation update. They substantiate that deployment was completed and provide dated deployment evidence. They do not prove the live system currently matches the local branch or uncommitted changes.

## Local environment and evidence boundary

The current checkout is on `fix/restore-original-ui` at `0080482354b35d3d784cd34bd05879c63f2fd326`, and the worktree contains uncommitted and untracked implementation and evidence files. The local checkout must be described independently from the deployed release. Do not claim that the deployed application includes changes from this local checkout unless a dated release record directly ties the live API image and frontend bundle to that revision.

Current local verification evidence and its limits are catalogued in `02_CHAPTER_5_IMPLEMENTATION_TESTING_EVALUATION.md` and `05_APPENDIX_EVIDENCE_INDEX.md`. Those records distinguish ML unit/smoke results from backend integration tests, frontend build checks, and manual workflow verification. A passing ML suite does not demonstrate that the complete locally running frontend, backend, PostgreSQL database, and ML service were all exercised together.

## Required wording for the report and handoff

Use wording along these lines:

> Deployment to Azure was completed earlier, and dated deployment records document the configured services and successful live checks. The present project phase is local testing and verification. The local working tree has changed since the recorded deployments, so the available evidence does not establish that the live deployment contains the latest local changes. No deployment or production database changes were made during this documentation work.

Report local test outcomes as local evidence and live probes as deployment evidence, with their dates and revisions. Do not present the old November 3 deployment snapshot as the current cloud state. Do not describe deployment as unfinished, and do not claim current local/live parity without revision-specific evidence.

## Evidence references

- `docs/azure-deployment-log-2026-10-31.md` — completed provisioning/deployment status, November API image and live checks, and November 18 frontend redeployment records.
- `docs/azure-deployment-plan-2026-10-30.md` — initial planning record; historical, not current deployment status.
- `academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md` — November 3 point-in-time Azure snapshot; superseded for later deployment activity.
- `docs/final-report-evidence/02_CHAPTER_5_IMPLEMENTATION_TESTING_EVALUATION.md` — current local verification scope and test limitations.
- `docs/final-report-evidence/05_APPENDIX_EVIDENCE_INDEX.md` — evidence locations and provenance boundaries.
