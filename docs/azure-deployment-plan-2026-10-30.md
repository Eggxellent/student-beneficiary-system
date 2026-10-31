# Azure deployment plan and cost estimate — 30 October 2026

**Status: RESEARCH ONLY. Nothing was provisioned, no Azure resource was created, and no paid
service was enabled.** Every price below was read from the public Azure Retail Prices API or
Microsoft's pricing pages on 30 October 2026, in USD, for **South Africa North (ZA North)** —
the closest region to Kenya. Prices change; re-check the Azure Pricing Calculator before
committing money.

> **Superseded on region and frontend hosting — read §11.** The live subscription was inspected on
> 31 October 2026 and carries a policy that **forbids ZA North** (allowed: `uaenorth`, `italynorth`,
> `austriaeast`, `switzerlandnorth`, `spaincentral`) and **forbids Static Web Apps entirely**
> (that provider only offers Central US / East US 2 / West US 2 / West Europe / East Asia).
> §§1–10 remain accurate as *price research*; §11 is the only architecture that can actually be
> deployed on this account.

## 1. What the application needs

| Component | Requirement | Where it comes from |
| --- | --- | --- |
| Frontend | Static SPA build (`vite build` → `dist`), needs `VITE_API_ORIGIN` **at build time** | `frontend/` |
| API | One HTTP service on port 5000, `GET /api/health` (liveness) and `GET /api/ready` (DB readiness) | `backend/src/index.js` |
| ML | Python 3 + xgboost/pandas/scikit-learn/jellyfish, model artifact, **spawned as a child process by the API** | `ml-service/`, `backend/src/services/duplicateCheck.js` |
| Database | PostgreSQL with all migrations applied | `backend/src/db/schema.sql` + `migrations/` |
| Secrets | `DATABASE_URL`, `JWT_SECRET`, bootstrap admin password | env vars |

Good news: the repository already has a **single-image Dockerfile** that installs Node, Python,
creates the venv, copies `predict.py`/`feature_engineering.py` and the model, verifies the model
loads, and runs `node backend/src/index.js`. The model artifact `xgb_duplicate_model.joblib` is
**tracked in git**, so the image is reproducible from a clean clone. (Some older notes claim it is
git-ignored — that is stale: `.gitignore` lists `ml-service/model/*.joblib`, but the file was
force-added and is in the index.)

Because the API spawns Python itself, the API and the model **must be deployed as one container**.
Splitting them into two services would require changing `duplicateCheck.js` to call HTTP instead
of spawning a process.

## 2. Verified prices (30 Oct 2026, ZA North)

### Azure Container Apps — consumption plan

| Meter | Price | Source |
| --- | --- | --- |
| Standard vCPU active usage | **$0.000024 / vCPU-second** (= $0.0864/vCPU-hour) | Retail Prices API |
| Standard memory active usage | **$0.000003 / GiB-second** (= $0.0108/GiB-hour) | Retail Prices API |
| Standard requests | **$0.40 per 1 million** | Retail Prices API |
| Monthly free grant | **180 000 vCPU-s · 360 000 GiB-s · 2 000 000 requests** | Container Apps pricing FAQ |
| Scale to zero | Yes; idle capacity billed at a reduced rate | Container Apps pricing FAQ |
| Dedicated plan | $0.057077 / vCPU-hour (+ $6.435096 / GPU-hour) | Retail Prices API |

### Azure Database for PostgreSQL — Flexible Server

| SKU | Price/hour | ≈ per month (730 h) |
| --- | --- | --- |
| **B1MS (burstable, 1 vCore / 2 GiB)** | **$0.0215** | **$15.70** |
| B2S (burstable, 2 vCore / 4 GiB) | $0.086 | $62.78 |
| B2ms | $0.172 | $125.56 |
| Basic meter | $0.021 | $15.33 |

**There is no free tier for Azure Database for PostgreSQL.** Storage is billed separately per
GiB-month (I could not resolve the exact storage meter for this region through the API; read it
off the pricing calculator before ordering). Backup storage is free up to 100% of provisioned
storage. While a server is **stopped**, compute is not billed — only storage.

### Azure Static Web Apps

| Plan | Price | Note |
| --- | --- | --- |
| Free | **$0** | No SLA; custom domains supported |
| Standard | **$9 / month per app** | "Standard App" meter; bandwidth beyond the included allowance is metered |

### What I could not verify

1. **App Service (Linux) B1/F1 price in ZA North** — the Retail Prices API returned no rows for
   the meters I filtered on, so I will not quote a number for it. If App Service is preferred, read
   it from the calculator first.
2. **Container Apps idle billing rate** — the pricing page says idle usage is "charged at a reduced
   rate" without publishing the figure in the text I retrieved.
3. **PostgreSQL storage price per GiB** in ZA North.
4. **Azure for Students / free-account eligibility** for your institution — that is the funding

## 3. Service comparison for this application

| Need | Option 1 | Option 2 | Option 3 | Recommended |
| --- | --- | --- | --- | --- |
| Frontend | Static Web Apps **Free ($0)** | Static Web Apps Standard ($9/mo, SLA + staging) | Container Apps static container (costs compute) | **Free** — the SPA is static, has no server logic, and Free supports custom domains and SPA routing via `staticwebapp.config.json` |
| API + ML | **Container Apps consumption** (per-second, scale to zero, verified prices) | App Service Linux custom container (fixed plan price — **unverified here**) | Container Instances (always-on, no scale-to-zero) | **Container Apps** — the Dockerfile is already a single image, and scale-to-zero is what keeps a capstone cheap |
| Database | **PostgreSQL Flexible B1MS ($15.70/mo)** | Flexible B2S ($62.78/mo) | Non-Azure free Postgres (Neon/Supabase) — breaks "all on Azure" | **B1MS**, stop it when not demonstrating |

Two facts decide the API choice: the API spawns Python in-process (so one container), and the
predictor request timeout is **30 s** (`MODEL_REQUEST_TIMEOUT_MS`), which comfortably covers a
Python + xgboost model load but not a cold container start *plus* that load on the first request
after scale-to-zero. Hence: scale to zero by default, `minReplicas: 1` during the demo/marking
window.

**Image size is the real cold-start cost.** An earlier measured build of this image was **2,222,712,090
bytes (~2.07 GiB)**, of which the `nvidia-nccl-cu12` wheel alone was 351.5 MB — pulled on the CPU
container, which cannot use it. That size is what a cold start has to fetch, so before deploying:
rebuild and re-measure the image, and consider installing the CPU-only torch/scikit stack (or
pinning requirements that exclude the CUDA wheels) to cut both pull time and storage. This is a
performance item, not a correctness one — the model loads and predicts either way.


## 4. Recommended architecture

```
                    ┌──────────────────────────────────────────┐
  phone / browser ──┤  Static Web App (Free)                   │
                    │  React + Vite build, SPA fallback        │
                    │  https://sbms-<x>.azurestaticapps.net    │
                    └───────────────┬──────────────────────────┘
                                    │ VITE_API_ORIGIN (build-time)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  Container App (consumption, 1 container)│
                    │  node backend/src/index.js  :5000        │
                    │   └─ spawns.venv/bin/python predict.py   │
                    │  /api/health (liveness)  /api/ready (DB) │
                    └───────────────┬──────────────────────────┘
                                    │ DATABASE_URL (TLS)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  PostgreSQL Flexible Server (B1MS)       │
                    │  ZA North, empty DB bootstrapped once    │
                    └──────────────────────────────────────────┘
```

Frontend and API are separate origins, so `CORS_ORIGINS` must list the Static Web App URL and
`PUBLIC_APP_URL` must be the same URL (it is embedded in student QR codes).

## 5. Cost scenarios (computed from the verified prices)

Assumptions: 730 hours in a month unless stated; one API replica; Static Web App Free; the
Container Apps free grant applied monthly.

| Scenario | API configuration | API cost | DB (B1MS) | Total / month |
| --- | --- | --- | --- | --- |
| **A. Development / demo, scale to zero** | 0.5 vCPU, 1 GiB, ~40 active hours | **$0** (inside the free grant: 72 000 of 180 000 vCPU-s, 144 000 of 360 000 GiB-s) | $15.70 + storage | **≈ $16–20** |
| **B. Marking week, always warm** | 0.5 vCPU, 1 GiB, `minReplicas: 1` | **≈ $34.02** (1 134 000 chargeable vCPU-s × $0.000024 + 2 268 000 GiB-s × $0.000003) | $15.70 + storage | **≈ $50** |
| **C. Comfortable, always warm** | 1 vCPU, 2 GiB, `minReplicas: 1` | ≈ $73.44 | $15.70 + storage | **≈ $89** |
| **D. Comfortable + a larger database** | 1 vCPU, 2 GiB | ≈ $73.44 | B2S $62.78 | **≈ $136** |

Cost levers, in order of effect:

1. **Scale to zero** (`minReplicas: 0`) — the whole API falls inside the free grant for demo-scale
   traffic. Cost: a cold start of ~10–20 s on the first request.
2. **Stop the database when not demonstrating** — compute is not billed while stopped, only
   storage. Cost: the app is unusable until it restarts (2–5 min).
3. **Stay on B1MS** — the database is the floor cost, and it is 4× cheaper than B2S.
4. **Do not enable a private endpoint** — the Container Apps "Environment Private Endpoint" meter
   is $0.146/hour ≈ **$106/month**, which would dominate the bill.

Funding routes to confirm with the institution: the free Azure account credit and Azure for
Students. Neither changes the technical plan; both need the owner's account, not mine.


## 6. Pre-deployment changes the code still needs (none of these is done yet)

| # | Change | Why it is required | Risk if skipped |
| --- | --- | --- | --- |
| 1 | Add `frontend/public/staticwebapp.config.json` with `navigationFallback` → `/index.html` | Static Web Apps serves files, not SPA routes; `public/` is the only place Vite copies verbatim into `dist/` | `/verify`, `/login`, `/students/register` return 404 on refresh or when a QR is scanned |
| 2 | Add a GitHub Actions workflow (build + deploy) | There is **no workflow on `dev`** — the only one lives on `codex/render-deployment` | No CI, no repeatable deploy; this also fixes the Phase 1 finding |
| 3 | Set `TRUST_PROXY_HOPS=1` on the container app | The verification rate limiter keys on `req.ip` | All public users share one bucket of 10 scans / 15 min |
| 4 | Bootstrap the database with `bootstrap-production-schema.js` | `migrate.js` **refuses anything but loopback `sbms_test`**, and `schema.sql` alone creates only 8 tables with **none** of the reconciliation columns | A database built from `schema.sql` alone breaks payment clearing and award verification |
| 5 | Build the frontend with `VITE_API_ORIGIN` | The SPA calls `/api` on its own origin by default | Every API call 404s against the Static Web App host |

### The database bootstrap, precisely

`bootstrap-production-schema.js` is the only supported path for a non-local database: it applies
`schema.sql`, then **every migration in the fixed order**, records them in
`sbms_schema_migrations`, and creates the first administrator. It refuses a non-empty public
schema and requires all of:

```
SBMS_INITIALIZE_EMPTY_DATABASE=true
SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED=<database name>
SBMS_EXPECTED_DATABASE_NAME=<database name>
SBMS_BOOTSTRAP_ADMIN_NAME=…
SBMS_BOOTSTRAP_ADMIN_EMAIL=…
SBMS_BOOTSTRAP_ADMIN_PASSWORD=…
DATABASE_URL=postgresql://…@<server>.postgres.database.azure.com:5432/<db>?sslmode=require
```

It prints a reminder to remove the approval and password values afterwards; do that.

## 7. Deployment runbook (for when the owner approves spend)

```powershell
# 0. Prerequisites
az login; az account set --subscription <subscription-id>

# 1. Resource group (ZA North is the closest region to Kenya)
az group create --name sbms-rg --location southafricanorth

# 2. Empty PostgreSQL server + database
az postgres flexible-server create --resource-group sbms-rg --name sbms-pg `
  --location southafricanorth --tier Burstable --sku-name Standard_B1ms `
  --storage-size 32 --version 16 --admin-user sbmsadmin --admin-password '<generated>'
az postgres flexible-server db create --resource-group sbms-rg --server-name sbms-pg --database-name sbms
# Allow Azure services + your own IP while bootstrapping (tighten afterwards)
az postgres flexible-server firewall-rule create --resource-group sbms-rg --server-name sbms-pg `
  --rule-name AllowAzure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# 3. One-time schema bootstrap (run from backend/, env values as in section 6)
npm run db:bootstrap-empty
#   prints: SBMS schema bootstrap completed: initialized; migrations=<n>; admin=admin_created.
#   It rolls back and commits nothing if the readiness contract fails.

# 4. API + ML container (builds the repo Dockerfile in the cloud)
az containerapp up --name sbms-api --resource-group sbms-rg --location southafricanorth `
  --source . --ingress external --target-port 5000 --env-vars NODE_ENV=production

# 5. Configuration and secrets
az containerapp secret set --name sbms-api --resource-group sbms-rg `
  --secrets database-url='<DATABASE_URL>' jwt-secret='<64 hex>'
az containerapp update --name sbms-api --resource-group sbms-rg --set-env-vars `
  DATABASE_URL=secretref:database-url JWT_SECRET=secretref:jwt-secret `
  SBMS_EXPECTED_DATABASE_NAME=sbms TRUST_PROXY_HOPS=1 `
  PUBLIC_APP_URL=https://<static-web-app-url> CORS_ORIGINS=https://<static-web-app-url> `
  ML_REVIEW_SCORE_THRESHOLD=0.50 DUPLICATE_AGGREGATION_POLICY=top-1

# 6. Static Web App (Free), then build the frontend with the API origin baked in
az staticwebapp create --name sbms-web --resource-group sbms-rg --location <available-region> --sku Free

# 7. Verify before claiming success
curl https://<api-fqdn>/api/health    # {"status":"ok"}
curl https://<api-fqdn>/api/ready     # {"status":"ready"}
```

Then re-run the smoke checks: officer login, registration, duplicate re-registration, admin queue,
`npm run smoke:browser`, `node scripts/qr-smoke.mjs`, and finally the **phone-camera QR scan** from
`docs/qr-verification-2026-10-30.md` — Azure is what makes that test possible.

Guardrails to add at the same time: a **budget alert** at the agreed ceiling, a log destination
(ingestion is billed), and a scheduled `az postgres flexible-server stop` between demonstrations if
scenario A is chosen.


## 8. Decisions and approvals required before anything is created

| # | Decision | Why it needs the owner |
| --- | --- | --- |
| 1 | Azure subscription and region (recommend **ZA North**) | Spend, and there is no Kenya region; latency to ZA North should be measured from the site used for the defence |
| 2 | Funding route: free-account credit, Azure for Students, or a card | Eligibility and payment method are the owner's |
| 3 | Monthly ceiling: **≈$16–20** (scale to zero) vs **≈$50** (warm) vs **≈$89–136** | The cost/performance choice for the demonstration |
| 4 | Approve the one-time database bootstrap, and whether to seed synthetic demo data | It writes the schema and an administrator into the production database |
| 5 | The bootstrap administrator's name, email and password | Must come from the owner; never committed |
| 6 | Whether "all on Azure" is strict — a free non-Azure Postgres (Neon/Supabase) would make the total **$0**; the repo's `@neon/config` + `@neon/env` devDependencies were removed on 2026-10-31 as unused (`docs/repository-cleanup-2026-10-31.md`), so nothing is pre-wired | Changes the architecture and the wording of the report |
| 7 | Approve adding the Static Web App routes file and a GitHub Actions workflow | Touches the frontend and CI, not just cloud configuration |

## 9. What this document does not claim

- **Nothing is deployed.** No resource group, database, container or static app exists, and no
  Azure subscription was touched.
- No price here is a quote. They are published list prices read on 30 October 2026, before tax,
  excluding any free-account credit, and they drift.
- **App Service cost was not verified**, so this plan does not compare it numerically.
- The Static Web Apps location in step 6 is left as a placeholder: the service is hosted from a
  fixed set of regions, and the closest available host region must be confirmed before creating it.
- Capacity: a single B1MS database and one 0.5 vCPU container are sized for a capstone demonstration
  (hundreds of students), not for a county-wide production rollout.

   decision, not a technical one.

## 10. Revision, 31 October 2026 — gaps closed, prices verified, totals corrected

### 10.1 Prices closed out (31 Oct 2026, ZA North, Retail Prices API)

| Item that §2 could not verify | Verified value | Note |
| --- | --- | --- |
| Container Apps availability and meters in ZA North | **16 meters present**, incl. Standard vCPU active $0.000024/vCPU-s, memory active $0.000003/GiB-s, requests $0.40/1M | §2's earlier "no rows" was a wrong `serviceName` filter (`Container Apps` instead of `Azure Container Apps`). The service is offered in ZA North. |
| PostgreSQL storage per GiB | **$0.151/GiB-month** (`Azure Database for PostgreSQL Flex Server Storage`, meter `Storage Data Stored`); backup LRS $0.113/GiB-month | 32 GiB (the minimum practical size) = **$4.83/month** |
| App Service Linux, ZA North | **B1 $0.0243/hour = $17.74/month**; B2 $0.0487 = $35.55; B3 $0.0973 = $71.03 | Custom containers on Linux need a paid plan; Free (F1) does not support them. B1 = 1 vCore / 1.75 GiB. |
| Azure Container Registry, ZA North | **Basic $0.1666/day = $5.00 per 30 days** (10 GiB included); Standard $0.6666/day = $20.00/month | Was missing from §5 entirely — it is a real monthly line for any container deployment. |
| Static Web Apps | Retail Prices API returns **no meters in any region** (billing is not exposed there). Free = $0 confirmed on the plan comparison page; **Standard remains $9/app/month** as recorded in §2 and must be confirmed in the portal | SWA has no ZA North presence; it is hosted from a fixed set of regions, so the host region is chosen at creation. The site is static, so this is a latency detail, not a blocker. |
| USD→KES | **1 USD = 129.90 KES** on 31 Oct 2026 (exchangerate-api.com) | Used for every KES figure below |

### 10.2 Corrected monthly cost table (USD and KES)

§5 omitted database storage and the container registry, so its totals understated the real bill.
Assumptions: 730 h/month; Static Web Apps Free ($0); one API replica at 0.5 vCPU / 1 GiB; the
Container Apps free grant (180 000 vCPU-s, 360 000 GiB-s, 2 M requests) applied; PostgreSQL B1MS
plus **32 GiB storage**; ACR Basic $5.00. Excludes tax, Log Analytics ingestion and any credit.

| Scenario | API | DB (B1MS + 32 GiB) | ACR Basic | **USD / month** | **KES / month** |
| --- | --- | --- | --- | --- | --- |
| **A. Demo traffic, scale to zero** (`minReplicas: 0`) | $0–2.00 (inside the free grant) | $20.53 | $5.00 | **$25.50–27.50** | **3 310–3 570** |
| **A′. Idle weeks: scale to zero + database stopped** | $0–2.00 | $4.83 (storage only) | $5.00 | **$9.80–11.80** | **1 270–1 530** |
| **B. Demonstration fortnight, warm** (`minReplicas: 1`, ≈330 h) | $12.42 | $20.53 | $5.00 | **$37.95** | **4 930** |
| **C. Warm for a whole month** (730 h, `minReplicas: 1`) | $34.02 | $20.53 | $5.00 | **$59.55** | **7 736** |
| **D. Warm month, 1 vCPU / 2 GiB** | $73.44 | $20.53 | $5.00 | **$98.97** | **12 856** |
| **E. C + Static Web Apps Standard (SLA)** | $34.02 | $20.53 | $5.00 + $9.00 SWA | **$68.55** | **8 905** |

Arithmetic for the API line: 330 h × 3600 s × 0.5 vCPU = 594 000 vCPU-s − 180 000 free = 414 000 ×
$0.000024 = $9.94; memory 330 h × 3600 × 1 GiB = 1 188 000 GiB-s − 360 000 free = 828 000 ×
$0.000003 = $2.48; total **$12.42**. Scenario C is the same computation at 730 h (**$34.02**, matching
§5). Scenario A charges nothing while zero replicas exist; the $0–2 band is for the demo requests.

Two levers not yet counted, both real:

- **Skip ACR** and pull the image from a free public GitHub Container Registry package: −$5.00/month.
  Only acceptable if the owner is happy for the image (backend code + model) to be publicly
  downloadable.
- **Log Analytics**: a Container Apps environment writes to a Log Analytics workspace by default and
  ingestion is billable (standard pay-as-you-go rate, not verified today). Set a daily cap.

### 10.3 Architecture decision (recommendation, unchanged in shape, now costed)

| Layer | Choice | Why this and not the alternative |
| --- | --- | --- |
| Frontend | **Static Web Apps Free**, `staticwebapp.config.json` for SPA fallback | $0, HTTPS + custom domain, no server logic in the SPA. Standard only if an SLA or >3 staging slots is required. |
| API + ML | **Container Apps, consumption, one container**, `minReplicas: 0` normally and `1` during the demonstration window | The API spawns `predict.py` as a child process, so API and ML must share one container — a separate Python host would break the inference path. App Service B1 ($17.74) is always-on and only 1.75 GiB; Container Apps is inside the free grant at demo volume and scales to zero. |
| Database | **PostgreSQL Flexible Server B1MS, 32 GiB, ZA North** | Only Azure-hosted option; no free tier exists. Stop it during idle weeks (A′). |
| Registry | **ACR Basic $5.00** | Needed to host the image; GHCR public package is the −$5 alternative. |
| Networking | No VNet, no private endpoint: public HTTPS ingress, PostgreSQL reachable only from Azure services and the operator's IP | The Container Apps *Environment Private Endpoint* meter is $0.146/h ≈ **$106/month** and would dominate the bill. Private endpoints are the correct production answer and the wrong capstone answer. |
| Secrets | Container Apps secrets + GitHub Actions secrets; nothing in git | `.env` files stay templates only. |

Cold start, restated with the cleanup applied: the container image goes from a measured ~2.07 GiB to
an estimated ~1.74 GiB once the unused `nvidia-nccl-cu12` wheel is dropped
(`docs/repository-cleanup-2026-10-31.md` §3). That is the payload a scale-to-zero start must pull
before Python imports and the model loads, so it remains the main reason to keep `minReplicas: 1`
during marking and `0` at all other times.

### 10.4 The six approvals, reconciled

Handover §20.4 lists **seven** decision items while §21.3 says "six approvals outstanding". The
reconciliation, so nothing is lost: item 5 there is the bootstrap administrator's *name/email/password*,
which is an **input** the owner supplies, not an approval. The six approvals are:

| # | Approval | Status |
| --- | --- | --- |
| 1 | Azure subscription + region (**recommended: ZA North**) | **Outstanding** |
| 2 | Funding route (free-account credit / Azure for Students / card) | **Outstanding** |
| 3 | Monthly ceiling — A ≈$25.50–27.50, A′ ≈$9.80–11.80, B ≈$37.95, C ≈$59.55, D ≈$98.97, E ≈$68.55 | **Outstanding** |
| 4 | One-time database bootstrap **and** whether synthetic demo data may be seeded | **Outstanding** |
| 5 | Is "all on Azure" strict, or is a free external Postgres acceptable (total would drop to ≈$0)? | **Outstanding** |
| 6 | Permission to add `frontend/public/staticwebapp.config.json`, a GitHub Actions workflow, and to apply the Phase 1 deletions listed in `docs/repository-cleanup-2026-10-31.md` | **Outstanding** |

Inputs still needed besides those six (they block Phase 4, not Phase 3):

- Subscription ID and tenant (or confirmation that the owner will run the provisioning commands).
- The bootstrap administrator's name, email and password.
- Demonstration dates, so the `minReplicas: 1` window and the database "stop between demos" schedule
  can be set.
- Whether the image may live in a **public** registry (saves $5.00/month) or must stay private in ACR.

### 10.5 What this revision still does not claim

- **Nothing is provisioned and nothing is deployed.** No subscription, resource group, server,
  container app, registry or static app exists.
- The image size after the CUDA removal is an **estimate**, not a measurement: no Docker engine is
  installed on this workstation.
- Prices are Microsoft list prices read on 31 October 2026, before tax and before any credit; they
  drift and are not a quote.
- Static Web Apps Standard ($9/app/month) could not be re-verified through the Retail Prices API.
- Kubernetes/KEDA autoscaling behaviour, cold-start seconds and Log Analytics cost are **not**
  measured here; they will be measured on the deployed system, not asserted.

---

## 11. Live subscription audit — 31 October 2026 (Phase 2)

Written after inspecting the **real** Azure for Students subscription this project will be deployed
into. Nothing here is estimated: each fact is a CLI/metadata read, quoted with the command that
produced it. **No resource was created, no provider was registered by hand, and no money was
spent** — the audit is read-only (`az … show/list`, `az provider show`, HTTPS `GET` to the Retail
Prices API, plus one ARM `validate` that failed harmlessly on scope).

### 11.1 Subscription facts

| Fact | Value | How it was read |
| --- | --- | --- |
| Offer | **Azure for Students** | `az account show` |
| Subscription id | `31c8bf09-10d7-4455-9f8a-f60bafc51ca4` | `az account show` |
| Tenant | Strathmore University | `az account show` |
| State | `Enabled` | `az account show` |
| Spending limit | **On** (hard cap — cannot produce an out-of-pocket bill) | `az account show` |
| My role | Owner (root scope) | `az role assignment list` |
| Existing resource groups / resources | **0 / 0** — clean slate, nothing can be overwritten | `az group list`, `az resource list` |
| Budgets | none defined | `az consumption budget list` |

Because the offer enforces the spending limit itself, **$0.00 of real money is reachable**. The only
consequence of exhausting the credit is that the subscription is disabled until the next grant — a
service-interruption risk, not a financial one.

### 11.2 Blocker 1 — a policy forbids most regions, including ZA North

`az policy assignment list` returns exactly one assignment, `sys.regionrestriction` ("Allowed resource
deployment regions"), inherited at subscription scope with `notScopes: null`. Its effective parameter
value is:

```
uaenorth · italynorth · austriaeast · switzerlandnorth · spaincentral
```

and its rule (`az policy definition show -n b86dabb9-b578-4d7b-b842-3b45e95769a1`) is `deny` when
`location notIn <list>` **and** `location != 'global'`.

**Consequence:** everything priced for `southafricanorth` in §§2–5 cannot be created — ARM refuses
with `RequestDisallowedByPolicy`. **South Africa North is out.** The closest allowed region to
Nairobi is **UAE North (Dubai)**, then Italy North / Austria East / Switzerland North / Spain
Central. UAE North supports every service this application needs (provider metadata):

| Provider | Resource type | UAE North |
| --- | --- | --- |
| `Microsoft.App` | `managedEnvironments` | yes |
| `Microsoft.DBforPostgreSQL` | `flexibleServers` | yes |
| `Microsoft.Web` | `sites` / `serverFarms` | yes |
| `Microsoft.ContainerRegistry` | `registries` | yes |

This policy comes with the student offer and cannot be widened by the owner, so the region is **not
negotiable** — only those five regions are on the table.

### 11.3 Blocker 2 — Static Web Apps cannot be deployed on this account

`az provider show -n Microsoft.Web --query "resourceTypes[?resourceType=='staticSites'].locations"`
returns only:

```
Central US · East US 2 · West US 2 · West Europe · East Asia
```

None of those is in the allowed-region list, and SWA's ARM `location` is a real region (not
`global`), so the `deny` rule bites. **The Static Web Apps frontend recommended in §3, §4 and §10 is
impossible here.** This is the biggest correction to the October plan: it changes the topology, not
just the price.

The frontend must therefore live in an allowed region. Verified options:

| Option | Where | Cost | SPA deep-link fallback | Verdict |
| --- | --- | --- | --- | --- |
| **App Service F1 (free tier)** | `serverFarms`/`sites` in UAE North — F1 confirmed available for Windows **and** Linux workers (`az appservice list-locations --sku F1`) | **$0.00** (60 CPU-min/day, 1 GiB, TLS on `*.azurewebsites.net`) | real rewrite via `web.config` (Windows) | **Recommended** — free, correct fallback, no application code change |
| Storage static website | `StorageV2` in UAE North | ≈$0.02/GB-month | only via "error document = index.html", which renders the app but with an HTTP **404** status | fallback only; wrong for QR scans |
| Same Container App as the API | `Microsoft.App` in UAE North | $0 extra at demo volume | needs `express.static` + SPA fallback in `backend/src/index.js` and a frontend build stage in the Dockerfile | attractive later (one origin, no CORS); a code change, so not the first deploy |

### 11.4 Re-priced in UAE North (Retail Prices API, 31 Oct 2026)

| Meter | ZA North (October doc) | **UAE North (deployable)** |
| --- | --- | --- |
| PostgreSQL Flexible **B1MS** | $0.0215/h → $15.70/mo | **$0.02/h → $14.60/mo** |
| PostgreSQL **storage** per GiB-month | unresolved in §2 | **$0.138** → 32 GiB = **$4.42/mo** |
| PostgreSQL backup LRS beyond provisioned | — | $0.12/GiB-mo (first 32 GiB free) |
| Container Apps vCPU active | $0.000024/vCPU-s | **identical** |
| Container Apps memory active | $0.000003/GiB-s | **identical** |
| Container Apps vCPU / memory **idle** | "reduced rate", unpublished | **$0.000003** per vCPU-s **and** per GiB-s |
| Container Apps requests | $0.40 / 1M | **identical** |
| Container Apps free grant | 180 000 vCPU-s · 360 000 GiB-s · 2M req/month | **identical** (confirmed on the pricing FAQ) |
| Container Apps *Environment Management Hour* | — | $0.143/h (**$103/mo**) — applies to the **Dedicated** plan, private endpoints and planned maintenance, **not** a Consumption-only environment |
| ACR **Basic** | — | $0.1666/day → **$5.07/mo** |
| Log Analytics ingestion | — | **$3.29/GB** (UAE North); retention $0.132/GB-mo |
| App Service **F1** (Windows & Linux) | unverified in §2 | **$0.00**, available in UAE North |

One number reverses a §5 assumption: with `minReplicas: 1`, the **idle meters alone** cost
**$23.65/month** at 1 vCPU / 2 GiB (730 h × 3600 s × ($0.000003 + 2 × $0.000003)). "Keep one replica
warm during marking" is a ~$24–34/month decision, not a rounding error; `minReplicas: 0` keeps the
API inside the free grant.

### 11.5 Revised architecture (deployable on this subscription)

```
  phone / browser (QR scan, /verify)
        │
        ├──► App Service  F1 (Windows, UAE North)          $0.00
        │      https://sbms-web.azurewebsites.net
        │      frontend/dist + web.config rewrite → /index.html
        │      VITE_API_ORIGIN baked in at build time
        │
        └──► Container App (Consumption, minReplicas 0)     $0.00–1.10
               https://sbms-api.<env>.<region>.azurecontainerapps.io
               node backend/src/index.js :5000
                 └─ spawns .venv/bin/python predict.py --server  (ML in the same image)
               image: ghcr.io/eggxellent/student-beneficiary-system:<sha>  (public)
                     │  DATABASE_URL (sslmode=require)
                     ▼
               PostgreSQL Flexible Server  sbms-pg   B1MS / 32 GiB / PG 16 / UAE North
                                                         $19.02
               + Log Analytics workspace (CAE target, 30-day retention)
```

| Resource | Name (proposed) | Configuration | Why this shape |
| --- | --- | --- | --- |
| Resource group | `rg-sbms-prod` | `uaenorth` | allowed region, closest to Nairobi |
| Container Apps env | `cae-sbms` | Consumption only, **no** workload profile, **no** private endpoint | the workload-profile/private-endpoint meters are ~$0.143/h ≈ $103/mo |
| Container App | `ca-sbms-api` | 0.5 vCPU / 1 GiB, `minReplicas 0`, `maxReplicas 3`, external ingress :5000, `TRUST_PROXY_HOPS=1` | inside the free grant at demo volume |
| PostgreSQL | `pg-sbms` | Flexible B1MS, PG 16, 32 GiB, zone-redundancy off, no HA, 7-day backup | cheapest production-grade option; HA doubles the price |
| App Service plan | `asp-sbms-web` | **F1 free**, Windows | SWA is policy-blocked; F1 is $0 and gives a real SPA rewrite |
| Log Analytics | `log-sbms` | PerGB2018, 30-day retention | required target for CAE logs; keep ingestion tiny |
| Registry | `ghcr.io` (GitHub) | public package | $0 vs ACR Basic $5.07/mo; repo is already public |
| Secrets | Container App secrets (owner's `JWT_SECRET`, DB password) | never in git | Key Vault adds ~$0 and complexity; not needed at this scale |
> **Superseded:** the always-on shape and the $19.02 figure above are the Phase-2 audit result,
> kept for the evidence trail. §12 reduces the idle cost to **$0.00** — read §12 for the current
> plan; the numbers in §11.5–§11.9 are historical.

### 11.6 Cost and credit runway

| Line item | Monthly |
| --- | --- |
| Container Apps — API + ML, 0.5 vCPU / 1 GiB, ≤40 active h, `minReplicas 0` | **$0.00** (72 000/180 000 vCPU-s, 144 000/360 000 GiB-s used) |
| Container Apps — heavier demo month (60 h, 1 vCPU / 2 GiB) | $1.08 |
| PostgreSQL Flexible — B1MS compute (730 h × $0.02) | **$14.60** |
| PostgreSQL — 32 GiB storage | **$4.42** |
| Azure App Service F1 (frontend) | **$0.00** |
| Log Analytics (<1 GB/month; $3.29/GB beyond) | **$0.00–3.30** |
| Registry (ghcr.io public) | **$0.00** |
| **Total** | **≈ $19–22 / month** |

Runway on the student credit (nominal grant **US$100 / 12 months**, hard-capped):

| Mode | Monthly burn | Months of runway |
| --- | --- | --- |
| Always-on DB, `minReplicas 0` (**recommended**) | ≈$19–22 | **≈4.5–5.2** |
| DB stopped between demos (~12 h/day off, saves $0.02/h) | ≈$12–15 | **≈6.7–8.3** |
| Always-on DB + `minReplicas 1` during marking only (2 weeks) | ≈$21 + $12 | ≈3.2 (with marking month) |

Cheapest possible variant, if the credit turns out to be partly spent: keep the same topology but
**stop the server** (`az postgres flexible-server stop`) outside demonstration windows — storage keeps
billing, compute does not, and the app simply reports `503` from `GET /api/ready` until it is started.

### 11.7 The credit balance — the one thing the CLI cannot answer

No Cost Management / Consumption call exposed the student balance; `az consumption usage list` and
`az costmanagement` return nothing usable for this offer. The balance and expiry live in the
sponsorship portal and must be read by the account owner:

| Where | Path | What to read |
| --- | --- | --- |
| Azure sponsorships (authoritative) | <https://www.microsoftazuresponsorships.com/Usage> — sign in with the same Microsoft account | **Remaining balance** and **End date** |
| Azure portal | <https://portal.azure.com> → **Cost Management + Billing** → *Cost analysis* (scope: the student subscription) → or **Subscriptions → Azure for Students → Overview** | credit remaining / spend to date |

Runway is then simply `balance ÷ monthly burn`:
`$100 → ≈4.5–5.2 months · $60 → ≈2.7–3.2 months · $30 → ≈1.4–1.6 months` at the recommended
≈$19–22/month. Paste the real figure here when it is known:

```
Credit remaining: ________ USD          Expiry: __________
```

Guardrail to add at provisioning time (free): a **Consumption budget** on `rg-sbms-prod` of
$25/month with alerts at 50 / 80 / 100 % so the credit cannot be spent silently.

### 11.8 GitHub facts that shape the deploy pipeline

| Fact | Value | Consequence |
| --- | --- | --- |
| `origin` | `https://github.com/Eggxellent/student-beneficiary-system.git` | CI/CD target exists |
| Visibility | **public** (`private: false`) | GitHub Actions minutes are free for public repos; **GHCR packages are free** → ACR's $5.07/mo is avoidable |
| Default branch | `dev` | the workflow must live on `dev` (§6 item 2) |
| Current branch | `fix/sbms-completion-work`, **1 commit ahead** of origin (`d0aa56c`) | the cleanup commit must be pushed before CI can build it |
| Existing workflow on `dev` | none | image build must be created, not repaired |

### 11.9 What this revision still does not claim

- **Nothing is provisioned**: 0 resource groups, 0 resources, 0 budgets — re-verified after the audit.
- **Image size after the NCCL removal is still unmeasured.** The Docker daemon is not running on this
  workstation (`docker version` → `cannot find the file … dockerDesktopLinuxEngine`), so §10.3's
  ~1.74 GiB stays an estimate until the first CI build reports the real size.
- **Cold-start seconds** on Container Apps after scale-to-zero are unmeasured; the 30 s
  `MODEL_REQUEST_TIMEOUT_MS` budget makes this the first thing to observe in production.
- **Log Analytics free allowance** for student offers is not verified; the $0 line assumes <1 GB/month.
- **Anonymous pull from a public GHCR package** by Container Apps is expected to work but will be
  confirmed on the first deployment (fallback: a GHCR PAT stored as a Container App secret).
- App Service **F1's 60 CPU-min/day** cap is fine for static file serving but is not measured here.

### 11.10 Revised approval list (supersedes §10.4)

| # | Decision | Recommendation | Why it changed |
| --- | --- | --- | --- |
| 1 | **Region** | **UAE North** (`uaenorth`) | ZA North is denied by policy; only 5 regions are legal |
| 2 | **Frontend host** | **App Service F1, free** (+ `web.config` rewrite) | Static Web Apps is denied by the same policy |
| 3 | **Monthly ceiling** | **≈$19–22**, hard budget alert at $25 | re-priced for UAE North; the database is ~93 % of it |
| 4 | **Registry** | **ghcr.io public** ($0) — ACR Basic ($5.07/mo) only if a private registry is required | repo is already public, so free |
| 5 | **Database bootstrap + synthetic seed** | run `bootstrap-production-schema.js` once; seed synthetic demo data only if explicitly wanted | unchanged from §6, still required |
| 6 | **Repository changes to enable CI** | push `fix/sbms-completion-work`, add a GitHub Actions workflow (image → ghcr.io, frontend → App Service), add `frontend/public/web.config` | §6 item 1 swaps `staticwebapp.config.json` for `web.config` now that SWA is out |

The exact sequence that would run **only after approval** (nothing below has been executed):

```
1  az group create -n rg-sbms-prod -l uaenorth
2  az postgres flexible-server create -g rg-sbms-prod -n pg-sbms -l uaenorth \
       --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
       --public-access 0.0.0.0   # "Azure services" firewall rule only  ≈$19.02/mo from here
3  az monitor log-analytics workspace create … -l uaenorth
4  az containerapp env create -g rg-sbms-prod -n cae-sbms -l uaenorth \
       --logs-workspace-id …                                     # consumption, no profile
5  az containerapp create -g rg-sbms-prod -n ca-sbms-api --image ghcr.io/…:<sha> \
       --min-replicas 0 --max-replicas 3 --cpu 0.5 --memory 1Gi --ingress external \
       --target-port 5000 --env-vars TRUST_PROXY_HOPS=1 …
6  az appservice plan create -g rg-sbms-prod -n asp-sbms-web --sku F1 -l uaenorth
7  az webapp create -g rg-sbms-prod -n sbms-web -p asp-sbms-web
8  bootstrap the database (schema + migrations + first admin) and verify
9  az consumption budget create … --amount 25     # guardrail
10 verify: GET /api/health, GET /api/ready, login, QR /verify, duplicate-check inference
```

Order matters: **the database is created first** because it is the only line that bills by the hour,
and it is the one item that can be stopped again (`az postgres flexible-server stop`) if the credit
turns out to be smaller than assumed.

## 12. Revised plan — absolute minimum cost (31 October 2026)

**This section supersedes the cost model in §10, the always-on shape in §11.5 and the cost table in
§11.7–§11.9. §11.1–§11.4 and §11.6 (region policy, provider registration, price probes, Static Web
Apps ban) remain valid.** Nothing in this section has been provisioned; no resource group, resource
or budget exists.

### 12.0 Headline

| Measure | Previous proposal (§10–§11) | Approved (§12, D8 = A2) |
| --- | --- | --- |
| Idle — no usage at all | $19–22 / mo | **$4.42 / mo** (32 GiB storage only) |
| One demonstration day | ≈$0.63 *plus* everything left running | **$0.10–$0.21** of compute on top |
| A month of normal use (≈100 h of DB up) | $19–22 | **≈$6.42** |
| Free PostgreSQL on Azure | assumed the $4.42 floor was the minimum | **no free tier exists** (§12.2.2) |
| Always-present paid resources | ACA env + Log Analytics + ACR + PG | **one managed disk** — env, F1, registry and logs are all $0 |

**Decision (D8, 31 October 2026): Architecture A2** — PostgreSQL Flexible B1MS **stays**, stopped
between demonstrations, so beneficiary records and the ML duplicate history survive without a
dump/restore cycle. Idle cost falls from $19.02 to **$4.42 / mo**; nothing is deleted. A1 ($0.00
idle) and B (Neon, $0) remain documented for the record only. §12.13 is the weekly stop protocol
that stops A2 from silently drifting into A3.

### 12.1 What changed, and why

| Item | Before | Now | Reason |
| --- | --- | --- | --- |
| API + ML containers | two containers contemplated | **one image, already built that way** | §12.2.1 |
| Frontend | App Service F1 | **unchanged — F1** | free in UAE North, verified live |
| Registry | ACR Basic $5.07/mo | **public ghcr.io, $0** | repository is public |
| Logs | Log Analytics, $3.29/GB | **`--logs-destination none`, $0** | §12.2.4 |
| Database | always-on B1MS, $19.02/mo | **A2: permanent, stopped between demos — $4.42/mo** | §12.2.3 traps, §12.13 |
| Budget alert | $25 | **$15**, at 50/75/100 % ($7.50 / $11.25 / $15) | $25 was an alert proposal; $5 was arithmetically useless (§12.14) |

### 12.2 Investigation results

#### 12.2.1 Can the backend and the ML service share one Container App or one image? — Yes; they already do

Evidence — `Dockerfile` lines 1–41 (no `ml-service/Dockerfile` exists):

- one `node:22-bookworm-slim` base, `python3` + venv installed in the same image;
- `CMD ["node", "backend/src/index.js"]`, with `PYTHON_EXECUTABLE` pointing at
  `/app/ml-service/.venv/bin/python`, so `backend/src/services/duplicateCheck.js` spawns
  `predict.py --server` **as a child process of the same container**;
- xgboost installed `--no-deps` so the ~350 MB CUDA/NCCL wheel never enters the image, guarded by
  a build-time assertion that `pip list` contains no `nvidia-*`;
- a build-time gate runs `predict_pairs(...)` and asserts the score is in [0, 1].

Consequences: **one Container App, one replica, one image, one port (5000)**. No inter-service
network hop, no second container to size or pay for, no version skew between API and model, and the
ML process costs nothing beyond the replica that hosts it. **No change is required** for
requirement 1. (Container Apps would also allow both processes as two containers in one revision —
unnecessary here.)

#### 12.2.2 Is there a free PostgreSQL on Azure? — No. Verified three ways

- `az postgres flexible-server create --tier` accepts **only** `Burstable, GeneralPurpose,
  MemoryOptimized` (CLI 2.91) — there is no `Free` tier to select.
- `az postgres flexible-server list-skus -l uaenorth` lists no `Free` SKU.
- The product's own docs name exactly three pricing tiers, and the flexible-server documentation
  table of contents contains **no** free-tier article.

One genuine curiosity, recorded so it is not re-investigated: the retail catalogue does publish
`Compute - Free vCore` at **$0.00/h** in UAE North. That is an *entitlement* meter behind the
free-account 12-month offer, not a selectable tier, and the Azure for Students FAQ states that free
monthly amounts continue only if the account converts to pay-as-you-go. **It is not assumable for
this subscription** and the plan does not depend on it. (Worth one glance in the portal at
provisioning time; if it ever applies it would save exactly $4.42/mo.)

Hard floor if a server exists at all: minimum storage **32 GiB** × $0.138/GiB-mo = **$4.42/mo**,
billed whether or not the server is running.

#### 12.2.3 Can PostgreSQL be stopped when unused? — Yes, with two traps

Confirmed from the pricing FAQ: *"While your server is stopped, you will only be billed for the
storage you have provisioned and any backup storage you consume that exceed 100% of your primary
provisioned storage volume. While your server is stopped, you will not be billed for compute."*

- **Trap 1 — a stopped server restarts itself after 7 days.** The official stop-compute article
  quotes the service error verbatim: `Server will be automatically started after 7 days if you do
  not perform a manual start operation`. Compute ($0.02/h, $14.60/mo) silently resumes, so
  "stop it and forget it" is **not** a safe idle strategy.
- **Trap 2 — scheduled monthly maintenance** may briefly restart a stopped server, then re-stop it.

Billing granularity is **per whole hour of existence**: create a server and delete it after five
minutes and you pay one full hour of compute *and* storage.

#### 12.2.4 Log Analytics can be removed entirely

`az containerapp env create --logs-destination` accepts `azure-monitor | log-analytics | none`
(default `log-analytics`). Using **`none`** means no workspace resource and **$0 ingestion** — it
removes the entire $3.29/GB line from §11. The price of the choice: no console or system logs in
Azure. `/api/health`, `/api/ready`, revision provisioning state and `az containerapp revision list`
all remain available; for a debugging session the environment can be recreated with
`log-analytics` (the stack is ephemeral anyway).

#### 12.2.5 A genuinely free frontend in a permitted region — F1 confirmed live

`az appservice list-locations --sku F1 --linux-workers-enabled` returns 49 regions including
**UAE North**, Italy North and North Europe. App Service **F1 = $0**, no fixed charge, HTTPS on
`*.azurewebsites.net`, SPA deep links handled by `frontend/public/web.config` rewrites. Static Web
Apps remain impossible on this subscription (§11.4), so F1 is the free option.

#### 12.2.6 No storage account and no volumes are needed

No `multer`, `diskStorage`, `writeFileSync` or `uploads/` usage in `backend/` or `ml-service/` — the
application is stateless. No Azure Files share, no Blob container, no Container Apps volume, and
therefore no additional storage meters.

#### 12.2.7 A public GHCR image is safe to publish

`.dockerignore` excludes `**/.env`, `.env.*`, `.git`, `node_modules`, `.venv`, `ml-service/data`,
`evaluation`, `experiments`, `reports`, `training`, and every model artifact except the production
`xgb_duplicate_model.joblib`. The only secret file on disk (`backend/.env`) cannot enter the build
context. Runtime secrets (DB URL, JWT secret) arrive as Container App secrets.

### 12.3 Verified unit prices — UAE North, 31 October 2026

All from the Azure Retail Prices API (`prices.azure.com`) or the CLI, not from memory:

| Meter | Unit | Price | Note |
| --- | --- | --- | --- |
| PostgreSQL Flexible — `B1MS` compute | 1 hour | **$0.0200** | $14.60 / 730 h |
| PostgreSQL Flexible — `Storage Data Stored` | 1 GiB-month | **$0.1380** | 32 GiB minimum = **$4.42/mo** |
| PostgreSQL Flexible — `Backup Storage LRS` | 1 GiB-month | $0.1050 | first 100 % of provisioned storage free |
| Container Apps — vCPU active | 1 vCPU-second | $0.000024 | = $0.0864 / vCPU-hour |
| Container Apps — memory active | 1 GiB-second | $0.000003 | = $0.0108 / GiB-hour |
| Container Apps — vCPU idle | 1 vCPU-second | $0.000003 | only while a replica exists |
| Container Apps — memory idle | 1 GiB-second | $0.000003 | only while a replica exists |
| Container Apps — requests | 1 M | $0.4000 | 2 M free / month |
| Container Apps — free grant | — | $0.00 | 180 000 vCPU-s + 360 000 GiB-s + 2 M requests per month |
| App Service — `F1` | — | **$0.00** | free plan, no meter |
| Log Analytics | 1 GB ingested | — | **not used** (`--logs-destination none`) |
| Container Registry Basic | month | — | **not used** (public ghcr.io) |

Free grant translated into a shape that matters: **180 000 vCPU-s ÷ (0.5 vCPU × 3600) = 100 hours**
of a 0.5 vCPU / 1 GiB replica per month at zero cost. A demonstration never comes close.

### 12.4 Architecture A — everything on Azure, at the floor

**Resources actually created (A2 — the approved variant):**

| # | Resource | SKU / setting | Cost |
| --- | --- | --- | --- |
| 1 | Resource group `rg-sbms` | — | $0 |
| 2 | Container Apps environment `cae-sbms` | Consumption, **`--logs-destination none`** | $0 fixed |
| 3 | Container App `ca-sbms-api` | **`--min-replicas 0`**, max 1–2, 0.5 vCPU / 1 GiB, external ingress :5000 | $0 idle |
| 4 | App Service plan `asp-sbms-web` + web app `sbms-web` | **F1 (free), Linux, UAE North** | $0 |
| 5 | PostgreSQL flexible `pg-sbms` | **B1MS, 32 GiB, PG 16** — **permanent**, stopped between demos | **$4.42/mo** + $0.02 per running hour |
| 6 | Budget `budget-sbms` | **$15**, alerts at 50/75/100 % | $0 |

Explicitly **not** created: Log Analytics workspace, Container Registry, virtual network, NAT
gateway, public IP, private endpoint, workload profile, storage account, Azure Files share, DNS zone,
Application Insights, Front Door, CDN.

**Three database lifetimes — the only meaningful cost variable:**

| Variant | What happens between demos | Idle cost | 8-hour demo | ~100 h usage month | Notes |
| --- | --- | --- | --- | --- | --- |
| A1 — ephemeral | server **deleted**; schema rebuilt by script | **$0.00** | **$0.21** | **$2.61** | not chosen (D8): every demo would need a dump-and-restore cycle |
| **A2 — persistent, stopped** (approved) | server stopped, data intact | **$4.42** (storage) | $4.42 + $0.16 = **$4.58** | **$6.42** | must be re-stopped **weekly** (7-day auto-start) — §12.13 |
| A3 — persistent, running | nothing | **$19.02** | **$19.02** | $19.02 | the old §10.4 model — rejected |

Arithmetic for A1, 8-hour demo: compute 8 × $0.02 = $0.16, storage 8 × $0.00605 = $0.048 →
**$0.208**; the Container App and F1 contribute **$0** because the demo sits inside the free grant
(8 h ≪ 100 h). A 24-hour demo is **$0.625**; a 72-hour demo is **$1.88**; A1 with one 24-hour demo
per month and nothing else for 29 days costs **$0.63/month**.

The application must therefore tolerate a database that appears and disappears. It already does:
`/api/ready` is the readiness gate (it reports `503` when the DB is unreachable), the schema and seed
data are scripted, and the Container App scales to zero independently of the database.

### 12.5 Architecture B — Azure app, external free PostgreSQL

Same as A minus resource 5, with the database moved to an external managed PostgreSQL. Verified
candidate (pricing page read directly, not assumed):

| | Neon **Free** plan | Neon Launch (paid) |
| --- | --- | --- |
| Price | **$0**, no card, "no time limits" | $0.106 / CU-hour + $0.35 / GB-month |
| Compute | **100 CU-hours per project per month**, up to 2 CU (8 GB RAM) | metered |
| Storage | **1 GB per project** | metered |
| Idle behaviour | **scale to zero after 5 minutes inactive** | same, configurable |
| Projects | 100 | 1 000+ |
| Region | no UAE / Middle East region — nearest EU or US | same |
| Compatibility | PostgreSQL 14–17, standard wire protocol, TLS required | same |

Azure side is unchanged and still **$0** (Container App inside the free grant, F1 free). So
**Architecture B totals $0.00/month at idle and $0.00 for a demonstration month**, with the database
as someone else's bill.

What it costs you, stated plainly:

- **Data leaves Azure and the permitted regions.** Every query crosses the public internet to the EU
  or US: roughly 100–200 ms round trip from the UAE, and the demo's database is a third-party
  dependency that can change terms.
- **Cold resume**: after 5 idle minutes the first query pays a resume penalty (sub-second to a couple
  of seconds) — visible on the first screen a marker opens.
- **Hard caps**: 1 GB storage (our schema and seed data are megabytes, so fine) and 100 CU-hours per
  month.
- **Narrative risk**: the deliverable is an *Azure* deployment. A database on Neon weakens that
  claim in a defence, even though the credentials, network path and TLS are legitimate.
- **Security posture is comparable, not better**: TLS required, strong password, allowlist optional;
  no private connectivity on the free plan.

### 12.6 Side-by-side

| | **A1** ephemeral Azure PG | **A2** persistent, stopped | **A3** persistent, running | **B** Neon free |
| --- | --- | --- | --- | --- |
| Minimum monthly (idle) | **$0.00** | $4.42 | $19.02 | **$0.00** |
| Demonstration day (8 h) | **$0.21** | $4.58 | $19.02 | **$0.00** |
| Typical month (~100 h up) | **$2.61** | $6.42 | $19.02 | **$0.00** |
| Charged while "off" | nothing | storage $4.42 | everything | nothing |
| Data survives teardown | no (dump/seed required) | yes | yes | yes |
| Postgres compatibility | native | native | native | native (PG 14–17) |
| Where data lives | UAE North | UAE North | UAE North | EU/US |
| Cold start on wake | ACA replica + DB create | ACA replica only | none | DB resume ~1 s |
| Free-tier ceilings that bite | ACA 100 h/mo, F1 60 CPU-min/day | same + PG 32 GiB | PG 32 GiB | 1 GB, 100 CU-h/mo |
| Operational effort | highest (create/destroy cycle) | medium (weekly re-stop) | lowest | low, but external account |
| Fits "Azure deployment" story | **yes** | yes | yes | partially |

Bold marks the cheapest figure in each row, **not the chosen variant**: the approved row is **A2**
(D8), which buys data continuity for $4.42/mo and needs one weekly stop.

### 12.7 Options considered and rejected

| Option | Why rejected |
| --- | --- |
| PostgreSQL as a second container in the same Container App | Azure Files over SMB (the only volume type on Consumption) is not POSIX-file-locking safe for a PostgreSQL data directory — **data integrity risk**, exactly what must not be traded away. Scale-in also risks an ungraceful shutdown. |
| PostgreSQL on Azure Container Instances | ≈$0.045/h compute + memory ≈ **$33/mo**, no managed backups, no patching. Worse on every axis. |
| Azure SQL Database (free serverless offer) | Not PostgreSQL — would break compatibility. |
| Cosmos DB free tier | No PostgreSQL wire protocol. |
| "Free vCore" PostgreSQL meter in the retail API | Entitlement meter for the free-account 12-month offer; no `Free` tier selectable, not assumable for a student offer (§12.2.2). |
| Private endpoint for PostgreSQL | +$7.30/mo for the endpoint, for a demo database. |
| NAT gateway / static egress IP | Hourly gateway charge + data processing; not needed with a public PostgreSQL firewall rule. |
| Azure Container Registry (Basic) | $5.07/mo for something ghcr.io does free on a public repo. |
| Log Analytics workspace | $3.29/GB to store logs nobody reads; `--logs-destination none` removes $0. |
| Workload profiles / Dedicated plan | Environment Management Hour ≈$103/mo (§11.9 trap). |
| Static Web Apps | Not available in any permitted region (§11.4). |
| Azure CDN / Front Door | Fixed monthly minimums for a single-region demo. |
| Keeping `minReplicas: 1` | $23.65/mo idle on its own (§11.9); the free grant covers only ~100 h/mo. |

### 12.8 What keeps charging when the system is "off"

| State | Still billed | Amount |
| --- | --- | --- |
| PostgreSQL **stopped** | provisioned storage (32 GiB) + backup beyond 100 % of it | **$4.42/mo**, $0.00605/h |
| PostgreSQL **deleted** | nothing — backups are deleted with the server | $0.00 |
| Container App at **0 replicas** | nothing; the Consumption environment has no fixed fee | $0.00 |
| Container App replica **alive but idle** | vCPU idle + memory idle meters | $0.000003/vCPU-s, $0.0108/GiB-h |
| App Service **F1** | nothing, ever (quota-limited, not metered) | $0.00 |
| Budget / alerts | nothing | $0.00 |
| Anything **deleted** | nothing | $0.00 |

The only silent-resume risk in the whole design is the **7-day PostgreSQL auto-start** (§12.2.3).
A2 accepts that risk deliberately and manages it: a stopped server returns to `Ready` on its own
after seven days and resumes billing $0.02/h, so **re-stopping is a standing weekly action**, not a
one-off. §12.13 gives the 40-second procedure, the reminder wording and an optional $0 guard.
`provision.ps1` / `teardown.ps1` are idempotent, so the weekly cycle is one command each.

### 12.9 Free-tier limits that actually bind

- **Container Apps free grant**: 180 000 vCPU-s + 360 000 GiB-s + 2 M requests per month ⇒ **100 h**
  of a 0.5 vCPU / 1 GiB replica. Beyond that, ≈$0.054/h. `maxReplicas` stays at 1–2 so a traffic
  spike cannot multiply this.
- **Container Apps minimum per container**: 0.25 vCPU / 0.5 GiB. We use 0.5 vCPU / 1 GiB — the
  6.6 MB XGBoost model plus Node plus CPython is uncomfortable in 512 MiB.
- **App Service F1**: 1 GiB RAM, **60 CPU-minutes/day**, 1 GB disk, no custom-domain TLS, app idles
  out and cold-starts. Serving a built SPA (a few MB) never approaches the CPU quota.
- **PostgreSQL**: 32 GiB minimum storage; burstable B1MS uses a **CPU-credit model** — sustained load
  drains credits and the server degrades to baseline, so it is not for load tests.
- **Backups**: 7–35 day retention included; backup storage is free up to 100 % of provisioned
  storage.

### 12.10 Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Cold start 10–40 s (≈1.9 GB image + model load) on the first request after scale-to-zero | Warm the app 2 minutes before a demo (`curl /api/health`), or raise `--min-replicas 1` for the demo hour only (≈$0.05/h, still inside the free grant) and drop it back |
| **Forgetting to re-stop the database** (it auto-starts at day 7) | `deploy/azure/teardown.ps1 -Stop` (one command, ~40 s), a recurring calendar reminder on day 5, and `status.ps1` which prints *days since the last stop*; the $15 budget alert at 50 % ($7.50) fires after roughly six days of unplanned running |
| Losing data at final teardown | routine teardown only **stops**; the irreversible `-Destroy` refuses to run unless `-Dump` is also passed, and `-Dump` writes `pg_dump` output locally first |
| First admin cannot be created — public registration returns **410** | `deploy/azure/create-admin.mjs` inserts the bcrypt admin directly using the backend's own `pg` + `bcrypt` dependencies |
| No Log Analytics ⇒ no cloud logs | `/api/health`, `/api/ready`, `az containerapp revision list`, and `az containerapp logs show` only if the env is recreated with logs; the app's own structured logs are visible in local/Docker runs |
| PostgreSQL reachable from the internet (public access) | TLS mandatory (`sslmode=require`), 32-character generated password stored as a Container App secret, firewall restricted to the Container Apps egress addresses; private endpoint rejected only because it costs $7.30/mo |
| B1MS credit exhaustion under load | not used for load tests; monitor CPU credits if a demo is heavy |
| Public image on ghcr.io | verified no secrets in the build context (§12.2.7) |
| F1 60 CPU-min/day exceeded by a busy demo | static SPA serving is ~0 CPU; if it ever happened the site returns 403 until midnight UTC, the API is unaffected |

### 12.11 Recommendation and the exact sequence on approval

**Adopt A2 (D8).** PostgreSQL stays in UAE North and survives between demonstrations; the
demo-window discipline moves from *delete the server* to *stop the server weekly*.

Order of operations — nothing below has been executed. Steps 1–7 are free and can exist permanently;
step 8 is the only resource with a recurring charge; step 10 is the weekly habit that holds it at
$4.42.

| # | Action | Billing |
| --- | --- | --- |
| 1 | build + push `ghcr.io/<owner>/sbms-api:<sha>` from the repo root | $0 |
| 2 | `az group create -n rg-sbms -l uaenorth` | $0 |
| 3 | `az containerapp env create -n cae-sbms --logs-destination none` | $0 fixed |
| 4 | `az containerapp create` with `--min-replicas 0 --max-replicas 1 --cpu 0.5 --memory 1Gi --ingress external --target-port 5000` | $0 while idle |
| 5 | `az appservice plan create --sku F1` (**Windows** — IIS serves the SPA) + `az webapp create` + zip of `frontend/dist` built with `VITE_API_ORIGIN` | $0 |
| 6 | `az consumption budget create --amount 15`, alerts 50/75/100 % | $0 |
| 7 | `az postgres flexible-server create --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 --public-access 0.0.0.0` | **starts billing: $4.42/mo storage + $0.02/h** |
| 8 | one-time bootstrap: `db:bootstrap-empty` → `migrate` → first admin (`create-admin.mjs`) | $0 |
| 9 | verify `/api/health`, `/api/ready`, admin login, QR `/verify`, duplicate-check score | $0 |
| 10 | `az postgres flexible-server stop` after every demo, and at least **every 7 days** | back to **$4.42/mo** |

Steps 1-9 are automated by `deploy/azure/provision.ps1`. Day-to-day operation is
`deploy/azure/start.ps1` (start the database, wait for `Ready`, verify `/api/health`, `/api/ready` and
the frontend, print both URLs) and `deploy/azure/stop.ps1` (a thin wrapper over `teardown.ps1 -Stop`
that adds nothing but the closing confirmation). `deploy/azure/status.ps1` reports the state and the
day count. Steps 1-6 were executed on 31 Oct 2026 - see the deployment log; step 7 remains the single
billing action.

Correction to the earlier sketch: the web app is **Windows F1**, not `--is-linux`. A Linux App
Service plan has no web server to serve static files, so the SPA would need its own container; IIS
plus `docker`-free zip deploy plus `web.config` rewrite is the $0 path.

### 12.12 Approval checklist

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Region | **UAE North** — forced by policy, not a choice |
| D2 | Frontend | **App Service F1**, UAE North — free, verified live |
| D3 | Registry | **public ghcr.io** — $0 |
| D4 | Database SKU | **PostgreSQL Flexible B1MS, 32 GiB, PG 16** |
| D6 | Demo-window provisioning | **yes**, scripts re-runnable |
| D7 | Logs | **`--logs-destination none`** — $0 |
| D8 | **Database lifetime** | **A2 — persistent, stopped.** Closed by the owner 31 Oct 2026: data continuity over $4.42/mo; A1 (dump/restore risk) and B (PII outside Azure) declined |
| D9 | Budget alert | **$15**, alerts at 50/75/100 % — **revised from $5**, see §12.14 |

D8 is closed. Every remaining item is unchanged from §12.4 and is what §12.11 provisions; §12.13 is
the stop protocol that the approval also accepts.

### 12.13 A2 stop protocol — the weekly habit that holds the cost at $4.42

**Why it exists.** A stopped flexible server is only guaranteed stopped for **seven days**. The
service's own error text is explicit: `Server will be automatically started after 7 days if you do
not perform a manual start operation`. A server that has restarted on its own bills $0.02/h ≈
$14.60/mo *on top of* the $4.42 storage — that is A3, the model this revision removed.

**Demo day, start to finish.**

```
.\deploy\azure\start.ps1                       # PG -> Ready (~3 min), then health + frontend checks
   ... demonstrate ...
.\deploy\azure\stop.ps1                        # $4.42/mo from here (stop.ps1 -Dump backs up first)
```

`start.ps1` replaces guessing: it polls the server state until it is `Ready`, retries the two health
endpoints through the scale-from-zero cold start, and fails loudly if the frontend is not the built
SPA. `stop.ps1` forwards to `teardown.ps1 -Stop`, which is where the stop logic and the `.state.json`
timestamp live.

**The weekly rule.** Run `teardown.ps1 -Stop` at least every 7 days whether or not anything was
demonstrated. Three free reminders, in order of strength:

1. a **recurring calendar entry every 5 days** — *"SBMS: stop pg-sbms"* (day 5 leaves two days of
   slack for a missed reminder);
2. `.\deploy\azure\status.ps1` — prints `state`, **days since the last stop**, and a warning at
   day 5 that escalates at day 6;
3. the **$15 budget alert** at 50 % ($7.50) - it cannot fire while the server is stopped, so a
   notification means compute has been running unattended for about six days.

**Verification in five seconds.**

```
az postgres flexible-server show -g rg-sbms -n pg-sbms --query "{state:state,sku:sku.tier,gb:storage.storageSizeGb}" -o table
```

`state` must read `Stopped`. `Starting`/`Ready` means the weekly action was missed.

**Optional $0 guard (not adopted).** A GitHub Actions `schedule:` workflow in this public repo can
run `az postgres flexible-server stop` daily at no cost, but it needs an Entra app registration with
a federated credential — a $0 yet extra identity object, and a second place where credentials live.
The instruction was "clear reminder and procedure", so the manual weekly stop is the plan of record;
the cron is documented here only so it is not re-investigated later.

**Cost of a slip.** One missed stop (server runs ≈168 h) ≈ **$3.36** of extra compute; permanently
forgotten = A3 = **$19.02/mo**. Worst realistic case with the reminders above is one missed week.

**What A2 deliberately does *not* do.** It never deletes the server, never loses a record, and never
needs re-seeding. `teardown.ps1 -Destroy` exists for the end of the project and refuses to run
without `-Dump`, so the last action before deletion is always a local `pg_dump`.

### 12.14 D9 revised — the budget is $15, not $5

A consumption budget is a **notification threshold, not a cap**: nothing stops when it is reached.
With the A2 floor at $4.42/mo, a $5 ceiling produces nonsense in both directions:

| Fact | Consequence with a $5 budget |
| --- | --- |
| $4.42 of unavoidable spend = **88 % of $5** | the 80 % and 100 % alerts fire **every single month**, so they stop meaning "something is wrong" |
| The 50 % alert = **$2.50** | it sits **below the floor** and can therefore never fire — the early warning is dead |

**$15** puts the bands above the unavoidable floor and inside the failure modes that matter:

| Alert | Amount | What it actually means |
| --- | --- | --- |
| 50 % | $7.50 | the database has been up for roughly six unplanned days |
| 75 % | $11.25 | about two weeks of unplanned uptime |
| 100 % | $15.00 | approaching A3 ($19.02/mo) — investigate immediately |

The budget itself is free and subscription-wide. This revision changes D9 from the $5 chosen in
§12.0–§12.12; everything else in §12 is unaffected.
