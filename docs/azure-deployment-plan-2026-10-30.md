# Azure deployment plan and cost estimate — 30 October 2026

**Status: RESEARCH ONLY. Nothing was provisioned, no Azure resource was created, and no paid
service was enabled.** Every price below was read from the public Azure Retail Prices API or
Microsoft's pricing pages on 30 October 2026, in USD, for **South Africa North (ZA North)** —
the closest region to Kenya. Prices change; re-check the Azure Pricing Calculator before
committing money.

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
