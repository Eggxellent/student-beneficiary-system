# Azure deployment — state and decision log (31 October 2026)

One page of state only. **Detail, evidence and the full cost model live in
`docs/azure-deployment-plan-2026-10-30.md` §11** — do not re-derive them, do not re-run the audit.
Nothing has been provisioned: 0 resource groups, 0 resources, 0 budgets (verified after the audit).

## 1. Status

| Phase | State |
| --- | --- |
| 1. Repository cleanup | **Done** — `d0aa56c`, verified (Jest 21/128, smoke 3/3, ML 33/33 + 7/7) |
| 2. Live subscription audit | **Done** — `04b7e47`, plan doc §11.1–§11.10 |
| 3. Choose architecture | **Done** (region + frontend forced by policy); frontend/registry choice still the owner's |
| 4. Approval to spend | **Blocked** — owner is reading the credit balance |
| 5. Provision | Not started (by instruction) |
| 6. Deploy and verify live | Not started |
| 7. Handover/milestone update | Not started |
| Image-size verification | **In progress** — local `docker build` running, PyPI at ~35 kB/s |

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

## 3. Decisions

| # | Decision | State |
| --- | --- | --- |
| D1 | Region = **UAE North** | Forced by policy |
| D2 | Frontend = **App Service F1 (free)**, `web.config` SPA rewrite | Recommended, awaiting owner |
| D3 | Registry = **public ghcr.io** ($0) instead of ACR Basic ($5.07/mo) | Recommended, awaiting owner |
| D4 | DB = **PostgreSQL Flexible B1MS, 32 GiB, PG 16**, public access limited to Azure services | Recommended, awaiting owner |
| D5 | `minReplicas: 0` outside demonstration windows | Recommended (idle `minReplicas: 1` = $23.65/mo) |
| D6 | **Demo-window provisioning**: create → demonstrate → delete, scripts must be re-runnable | Proposed under "preserve credits" priority |

## 4. Cost guardrails (owner priority #1 is preserving credit)

| Mode | Burn | Note |
| --- | --- | --- |
| Full stack, always on | ≈$19–22 / mo | DB is ~93 % of it |
| DB stopped outside demos | ≈$4.42 / mo floor (storage only) | app returns `503` from `/api/ready` until started |
| **Create for the demo, delete after** | **≈$0.63 / day of DB + $0 idle** | requires the provisioning to be scripted and repeatable |
| Budget alert | $25/mo at 50/80/100 % | free, create at provisioning time |

## 5. Next actions, in order

1. Owner reads credit balance/expiry (sponsorship portal) → decides demo-window vs always-on.
2. Owner answers D2/D3 (frontend host, registry) — the rest is forced.
3. Write `deploy/azure/provision.sh`, `deploy/azure/teardown.sh`, `frontend/public/web.config`,
   `.github/workflows/azure-deploy.yml` (**manual `workflow_dispatch` only**, no auto-deploy on push).
4. Provision DB first (only hourly meter) → bootstrap schema → Container App → App Service → budget.
5. Verify: `/api/health`, `/api/ready`, login, QR `/verify`, duplicate-check score.
6. Record the result here and update handover §15/§16 + milestones.

## 6. Open questions (consolidated — ask once)

- Credit balance and expiry (portal-only; no CLI/API exposes it for student offers).
- Frontend host: App Service F1 (recommended) / Storage static site / same container as the API.
- Registry: public ghcr.io (recommended, $0) / ACR Basic (+$5.07/mo).
- Lifetime: delete after the demo, or keep running until the credit runs out?
