# Deployment evidence versus local development

Deployment was completed earlier. The present project phase is local testing, manual verification, bug identification, and preparation of report evidence. This audit made no deployment/hosting/live-data changes and did not query Azure.

## What the repository establishes

- `docs/azure-deployment-log-2026-10-31.md` records deployment operations and later entries. It describes API image deployment on 12 November using commit `a5c4ef4746144d83db15ee75731a83655b4a2c0e`, CI success, and `/api/health` plus `/api/ready` returning HTTP 200 at that time.
- The same log records frontend deployments through 18 November and a browser smoke run on the live app with 36 passed and 3 failed. The corresponding screenshots/results are in gitignored `verification-evidence/2026-11-18/`.
- `docs/academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md` is an earlier 3 November snapshot at `a3714f8`; its certificate endpoint finding predates subsequent deployment records and is not the latest evidence.
- The migration history and log document deployment of the award-verification-gate removal in November. This is historical deployment evidence, not a live database read in this audit.

## Local state on audit date

- Branch `fix/restore-original-ui`, HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`, commit dated 24 November.
- The worktree is dirty across application code, frontend, ML, data, tests, and docs; there are also untracked migration and artifact files. This local state cannot be represented as HEAD alone.
- Local files include newer Guardian application pipeline code and an updated HistGradientBoosting artifact. Their presence does not establish that Azure runs them.

## What cannot be claimed

- No live Azure revision/image query or live endpoint check was made now. Current live version, current health, current database schema, and whether the live app reflects HEAD or working-tree changes are **unverified**.
- No exact frontend/backend parity between local and live is established. The last dated deployment evidence is older than HEAD and uncommitted work.
- Do not describe deployment as pending. State that deployment is complete and that current verification is local; identify dated deployment evidence separately from current local code.
