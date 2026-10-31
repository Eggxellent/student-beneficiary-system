# Azure deployment — state and decision log (31 October 2026)

One page of state only. **Detail, evidence and the full cost model live in
`docs/azure-deployment-plan-2026-10-30.md` §12 (current, minimum-cost) and §11 (audit behind it)** —
do not re-derive them, do not re-run the audit.
Nothing has been provisioned: 0 resource groups, 0 resources, 0 budgets (verified after the audit).

## 1. Status

| Phase | State |
| --- | --- |
| 1. Repository cleanup | **Done** — `d0aa56c`, verified (Jest 21/128, smoke 3/3, ML 33/33 + 7/7) |
| 2. Live subscription audit | **Done** — `04b7e47`, plan doc §11.1–§11.10 |
| 3. Choose architecture | **Done** — **A2 approved (D8, 31 Oct 2026)**: persistent PostgreSQL stopped between demos, `minReplicas 0`, F1 front, no logs, no registry |
| 4. Approval to spend | **Blocked on final approval** of the §12.11 checklist; the credit balance is still unread |
| 5. Provision | Not started (by instruction) — 0 resource groups, 0 resources, 0 budgets |
| 6. Deploy and verify live | Not started |
| 7. Handover/milestone update | Not started |
| 8. Revised cost model | **Done** — plan §12.0–§12.13: **$4.42/mo idle** (A2), $4.58 per 8 h demo, ≈$6.42 in a normal month |
| Image-size verification | **Blocked** — local build failed at the pip layer: `ReadTimeoutError` from files.pythonhosted.org (PyPI at ~35 kB/s), not a Dockerfile defect. Post-cleanup size still unmeasured |

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
  free **ghcr.io** packages (no ACR needed); default branch `dev`; no workflow on `dev` yet.
- API + ML are **one container** (`duplicateCheck.js` spawns `predict.py --server`); ML threshold 0.50 stays.
- Baseline image `sbms-api:latest` = **2.22 GB** (pre-cleanup). Post-cleanup size still unmeasured.
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

## 5. Next actions, in order

1. **Owner approves the final checklist** — exact resources, $4.42/mo idle estimate, and the weekly
   stop obligation (§12.11 + §12.13 of the plan). Credit balance/expiry still unread.
2. ~~Write the deploy tooling~~ — **written, not executed** (PowerShell, because the operator shell
   on this machine is PowerShell): `deploy/azure/provision.ps1` (idempotent, steps 2–9),
   `deploy/azure/teardown.ps1` (`-Stop` default, `-Dump`, `-Destroy` refused without `-Dump`),
   `deploy/azure/status.ps1` (state + days-since-stop + reminder), `deploy/azure/create-admin.mjs`
   (public registration returns 410), `frontend/public/web.config` (SPA rewrite).
   The Dockerfile now pins `PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10`; the image build and its size
   measurement are still open (the local build died on a PyPI read timeout, not on a Dockerfile
   defect).
3. Provision the **free half** first (RG → env `--logs-destination none` → Container App `min-replicas 0`
   → F1 Windows web app → $15 budget) — $0 and can stay.
4. Then the **one billing step**: create PG (B1MS / 32 GiB / PG 16), bootstrap schema + first admin,
   verify `/api/health`, `/api/ready`, admin login, QR `/verify`, duplicate-check score.
5. `teardown.ps1 -Stop` after the demo **and every 7 days after that**; log the stop date here.
6. Record the result here and update handover §15/§16 + milestones.

## 6. Open questions (consolidated — ask once)

- **Credit balance and expiry** — portal-only (`microsoftazuresponsorships.com/Usage`); no CLI/API
  exposes it for student offers. Changes the runway, not the architecture.
- **D8 is closed** (A2). No other architecture question is open.
