# Azure deployment — state and decision log (31 October 2026)

One page of state only. **Detail, evidence and the full cost model live in
`docs/azure-deployment-plan-2026-10-30.md` §12 (current, minimum-cost) and §11 (audit behind it)** —
do not re-derive them, do not re-run the audit.
**Deployed and verified live on 31 October 2026** — 1 resource group, 6 resources, 1 budget.

- API: `https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io`
- Frontend: `https://sbms-web.azurewebsites.net`
- Database: `pg-sbms.postgres.database.azure.com` / `sbms` (admin + JWT secrets in
  `deploy/azure/.secrets.json`, git-ignored, never printed)

## 1. Status

| Phase | State |
| --- | --- |
| 1. Repository cleanup | **Done** — `d0aa56c`, verified (Jest 21/128, smoke 3/3, ML 33/33 + 7/7) |
| 2. Live subscription audit | **Done** — `04b7e47`, plan doc §11.1–§11.10 |
| 3. Choose architecture | **Done** — **A2 approved (D8, 31 Oct 2026)**: persistent PostgreSQL stopped between demos, `minReplicas 0`, F1 front, no logs, no registry |
| 4. Approval to spend | **Approved by the owner 31 Oct 2026** — the §12.11 checklist and D8/A2 |
| 5. Provision | **Done** — `rg-sbms`, `cae-sbms`, `ca-sbms-api`, `asp-sbms-web`, `sbms-web`, `pg-sbms`, database `sbms`, `budget-sbms` |
| 6. Deploy and verify live | **Done** — image `ghcr.io/eggxellent/sbms-api` built by CI; health, ready, auth, roles, QR verify, ML scoring, CORS and persistence all checked (plan §12.15) |
| 7. Handover/milestone update | **This document and plan §12.15** |
| 8. Revised cost model | **Done** — plan §12.0–§12.13: **$4.42/mo idle** (A2), $4.58 per 8 h demo, ≈$6.42 in a normal month |
| Image-size verification | **Done** — **1.37 GB** after cleanup (was 2.22 GB); `deploy/` and `.env*` excluded, ML gate runs inside the build |

## 2. Verified facts (carry forward — do not re-check)

- Offer **Azure for Students**, state `Enabled`, **spending limit ON** ⇒ no out-of-pocket spend possible.
- Policy `sys.regionrestriction` denies every region except **uaenorth, italynorth, austriaeast,
  switzerlandnorth, spaincentral** ⇒ ZA North (the original plan) is not deployable.
- **Static Web Apps (§W) cannot be created on this account** — `staticSites` exists only in
  Central US / East US 2 / West US 2 / West Europe / East Asia, none of them allowed.
- UAE North supports `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.Web`, `Microsoft.ContainerRegistry`.
- Prices (UAE North, 31 Oct 2026): PG **B1MS $0.02/h ($14.60/mo)**, PG storage **$0.138/GiB-mo**
  (32 GiB = $4.42), ACA vCPU $0.000024/s + memory $0.000003/GiB-s (idle meters also $0.000003),
  free grant 180k vCPU-s / 360k GiB-s / 2M req, ACR Basic $5.07/mo, Log Analytics $3.29/GB,
  **App Service F1 = $0** in UAE North (Windows and Linux).
- Repo `github.com/Eggxellent/student-beneficiary-system` is **public** ⇒ free Actions minutes and
  free **ghcr.io** packages (no ACR needed); default branch `dev`; the dispatchable
  `publish-api-image.yml` is registered on `dev` (dispatch only, nothing else merged there).
- API + ML are **one container** (`duplicateCheck.js` spawns `predict.py --server`); ML threshold 0.50 stays.
- Image `ghcr.io/eggxellent/sbms-api` = **1.37 GB** post-cleanup (was 2.22 GB); built by CI, publicly
  pullable, no registry credential on the container app.
- Local Docker engine works: Desktop 4.97.0 installed per-user at `%LOCALAPPDATA%\Programs\DockerDesktop`.
- CLI 2.91 has **everything the runbook needs in core** — `az containerapp`, `az webapp`,
  `az postgres flexible-server stop`, `az consumption budget create` — and **no extensions are
  installed or required**.

### Facts verified for the revision (31 Oct 2026 — do not re-check)

- **No free PostgreSQL exists on Azure**: `--tier` accepts only Burstable/GeneralPurpose/
  MemoryOptimized, `list-skus` has no Free entry, and the docs have no free-tier article. The
  `Compute - Free vCore` **$0.00/h** meter in the retail API is an entitlement meter for the
  free-account 12-month offer — **not selectable, not assumable**. Storage floor is 32 GiB = $4.42/mo.
- A **stopped** PG server bills storage only, but **auto-starts after 7 days** (official error text:
  `Server will be automatically started after 7 days…`) and may be restarted briefly by monthly
  maintenance. Billing rounds up to whole hours of server existence.
- `az containerapp env create --logs-destination none` is valid ⇒ **no Log Analytics workspace,
  $0 ingestion**.
- **App Service F1 exists in UAE North (Linux)** — `az appservice list-locations --sku F1
  --linux-workers-enabled` returned 49 regions including UAE North.
- ACA UAE North meters: vCPU active $0.000024/s, memory $0.000003/GiB-s, vCPU idle $0.000003/s,
  requests $0.40/M. Free grant ⇒ **100 h/mo** of 0.5 vCPU + 1 GiB.
- The app writes **no files** (no multer/diskStorage/writeFileSync) ⇒ no storage account, no volumes.
- `.dockerignore` excludes `**/.env` ⇒ a public ghcr.io image carries no secrets.
- Backend CORS is an **allowlist** ⇒ the F1 origin (and the ACA FQDN if used) must be passed as env
  vars at deploy time — configuration, not code change.


## 3. Decisions

| # | Decision | State |
| --- | --- | --- |
| D1 | Region = **UAE North** | Forced by policy |
| D2 | Frontend = **App Service F1 (free)**, `web.config` SPA rewrite | **Confirmed available in UAE North** (Linux, 49-region list) |
| D3 | Registry = **public ghcr.io** ($0) instead of ACR Basic ($5.07/mo) | Settled — build context carries no secrets |
| D4 | DB = **PostgreSQL Flexible B1MS, 32 GiB, PG 16**, public access + TLS | Settled (only managed Postgres option) |
| D5 | `minReplicas: 0`, `maxReplicas: 1` outside demos | Settled |
| D6 | **Demo-window provisioning**: create → demonstrate → delete | Settled as the cost model |
| D7 | Container Apps env created with **`--logs-destination none`** — no Log Analytics at all | New (§12.2.4) |
| D8 | **Database lifetime = A2** — PostgreSQL Flexible stays, **stopped** between demos | **Approved by the owner 31 Oct 2026.** A1 (delete/restore per demo) and B (Neon, PII off Azure) declined |
| D9 | Budget alert **$15** (not $25, and not $5) at 50/75/100 % | New — $5 cannot work against a $4.42 floor (plan §12.14) |

## 4. Cost guardrails (owner priority #1 is preserving credit)

| Mode | Burn | Note |
| --- | --- | --- |
| A1 — DB deleted outside demos | $0.00 idle; 8 h demo $0.21; ~100 h/month $2.61 | not chosen — needs a dump/restore cycle per demo |
| **A2 — DB stopped outside demos (CHOSEN, D8)** | **$4.42/mo** floor (storage only); 8 h demo **$4.58**; ~100 h/month **$6.42** | must re-stop **weekly** or it auto-starts and becomes A3 (plan §12.13) |
| A3 — DB always on | $19.02/mo | the old model — rejected |
| B — Neon free DB | $0.00 forever | declined — PII would leave Azure; 1 GB / 100 CU-h caps |
| Container App + F1 | $0 up to ~100 h of replica time per month (ACA free grant) | beyond that ≈$0.054/h |
| Budget alert | $15 at 50/75/100 % ($7.50 / $11.25 / $15) | free; $5 was below the floor |

## 5. Operating the deployment

- **Demo day**: `./deploy/azure/start.ps1` (starts PostgreSQL, warms the API until `/api/ready` is 200),
  then open the two URLs above.
- **After the demo**: `./deploy/azure/teardown.ps1 -Stop`. Repeat **at least every 7 days** — Azure
  auto-starts a stopped server after seven days, which silently turns $4.42/mo into $19.02/mo
  (plan §12.13). `status.ps1` prints the countdown and the reminder.
- **Demo data**: `npm --prefix backend run seed:synthetic`. It talks to PostgreSQL directly, so the
  machine running it must be allowed by the server firewall first, and the shell needs the
  `DATABASE_URL` from `deploy/azure/.secrets.json`.
- **Acceptance leftovers** (deliberate, they are the evidence): three students — including a genuine
  duplicate pair — created through the API, and one field officer
  `officer.1031205024@sbms.test` whose credentials are in `deploy/azure/.secrets.json`
  (`acceptanceOfficer`, `acceptanceOfficerPassword`, git-ignored). For a pristine database:
  `DELETE FROM duplicate_flags; DELETE FROM students; DELETE FROM users WHERE email LIKE 'officer.%@sbms.test';`
- **A revision that will not start**: check `az containerapp revision list -g rg-sbms -n ca-sbms-api`
  for `runningState`. There is **no log stream** (D7), so the failure reason is not readable; the
  startup guard's cause line is only visible if you run the image locally with the same env vars.

### Stop log

| When (UTC) | Action | Auto-start deadline |
| --- | --- | --- |
| 2026-10-31 21:11 | `teardown.ps1 -Stop` after the acceptance run | 2026-11-07 21:11 |

`status.ps1` afterwards: server `Stopped`, **$4.42/month**, 7 days left on the countdown.

## 6. Next actions

1. Phase 1 (deploy + end-to-end acceptance) is **complete** — do not re-run it; the evidence is in
   plan §12.15.
2. Phase 2: supervisor gap remediation **SBMS-01…18**.
3. Credit balance and expiry remain portal-only (`microsoftazuresponsorships.com/Usage`) — they change
   the runway, not the architecture.
