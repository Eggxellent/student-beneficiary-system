# AZURE DEPLOYMENT VERIFICATION

> Inspected 2026-11-03 01:19–01:27 +03:00 with an authenticated Azure CLI (`az account show` succeeded).
> **Re-confirmed 2026-11-03 10:44 +03:00** in pass 2: `az account show` → subscription `31c8bf09-…`,
> `az resource list -g rg-sbms` → still exactly 5 resources (`cae-sbms`, `asp-sbms-web`, `sbms-web`, `pg-sbms`,
> `ca-sbms-api`, all `uaenorth`), Container App image still `…:a3714f8…`, `min 0 / max 1`, `Succeeded`/`Running`,
> PostgreSQL still v16 `Standard_B1ms` 32 GB 7-day retention `Ready`, App Service still Free/`Running`/`httpsOnly`.
> **No secret value is reproduced here.** Environment variables are listed by *name* only; connection strings,
> JWT secrets and passwords were never printed. No Azure resource was created, changed or restarted.

## 1. Resource inventory (subscription-scoped queries, resource group `rg-sbms`)

| Service | Resource | Key facts | Evidence |
| --- | --- | --- | --- |
| Backend API | Container App `ca-sbms-api` | external ingress, target port 5000, `provisioningState: Succeeded`, `runningStatus: Running`, `minReplicas 0`, `maxReplicas 1`, one revision at 100 % traffic | `az containerapp show`, `az containerapp revision list` |
| API image | `ghcr.io/eggxellent/sbms-api:a3714f8ceced1bfed27d9007b795d35902ef1310` | tag = git commit `a3714f8` | same |
| API revision | `ca-sbms-api--latest` | created `2026-11-01T12:03:29Z`, `active: true`, traffic 100 | same |
| Frontend | App Service `sbms-web` | Windows plan `asp-sbms-web`, **F1 / Free**, `alwaysOn: false`, `minTlsVersion: 1.2`, state `Running` | `az webapp list`, `az appservice plan list`, `az webapp config show` |
| Frontend deployments | 7 `OneDeploy` (zip) records | all `Succeeded`; latest active: `2026-11-01T18:38:41Z` | `az webapp log deployment list` |
| Database | PostgreSQL Flexible Server `pg-sbms` | version **16**, `Burstable` / `Standard_B1ms`, 32 GB, `backupRetentionDays 7`, `geoRedundantBackup Disabled`, state `Ready` | `az postgres flexible-server list` |

No Azure Container Registry, Key Vault, Application Insights, Redis or load balancer was observed in the resource
group. The container image is pulled from **GitHub Container Registry**, not from an Azure registry.

## 2. Endpoints

| Purpose | URL | Live result (2026-11-03) |
| --- | --- | --- |
| Frontend | `https://sbms-web.azurewebsites.net/` | `200`, 423-byte SPA shell referencing `/assets/index-KTiUJ9pN.js` + `/assets/index-DxfCSphb.css` |
| API | `https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io` | reachable |
| Liveness | `/api/health` | `200` |
| Readiness | `/api/ready` | `200`, body `{"status":"ready"}` → all 12 required tables present in the live database |
| Public QR verification | `POST /api/verify` (unknown 64-hex token) | `200 {"found":false}` — endpoint live and non-disclosing |
| Certificate verification | `POST /api/certificates/verify` | **`404` "Cannot POST /api/certificates/verify"** — see §5 |
| Auth guard | `GET /api/students` (no token) | `401` — protected routes refuse anonymous callers in the deployed build |
| CORS preflight | `OPTIONS /api/health` | foreign `Origin` → **403**; `Origin: https://sbms-web.azurewebsites.net` → **204** with `Access-Control-Allow-Origin` echoing the allowed origin — the deployed allowlist is live and narrow |
| SPA shell parity | local `frontend/dist/index.html` vs the live shell | both **423 bytes**; this is the only environment-independent build comparison available (the JS/CSS hashes are not — §5) |

Readiness returning `200` is meaningful: `databaseReadiness.js` fails closed unless every one of
`users, students, beneficiaries, duplicate_flags, duplicate_review_events, disbursements, audit_logs, reports,
bursary_awards, bursary_award_verification_events, bursary_certificates, disbursement_reconciliation_events`
exists as a table in the expected database. The live database therefore already carries the
`bursary_certificates` schema (migration `20261031_bursary_certificates.sql`), even though the running API image
predates the code that uses it.

## 3. Configuration (names only)

Container App environment variables: `NODE_ENV`, `PYTHON_EXECUTABLE`, `CORS_ORIGINS`, `PUBLIC_APP_URL`,
`DATABASE_URL`, `JWT_SECRET`, `SBMS_EXPECTED_DATABASE_NAME`, `TRUST_PROXY_HOPS`.

Consequences that can be stated without seeing values:

1. **The ML service runs inside the API container.** `PYTHON_EXECUTABLE` is set and the `Dockerfile` installs a
   Python virtualenv and copies `ml-service/`. Inference therefore follows the same path as local:
   `duplicateCheck.js` spawns `predict.py --server` as a child process. The earlier "UNKNOWN (G-22)" is **resolved**.
2. **The duplicate cut-off is the code default.** `ML_REVIEW_SCORE_THRESHOLD` is *not* in the list, so
   `settings.js` falls back to `0.50`. `DUPLICATE_HIGH_PRIORITY_THRESHOLD` is also unset → `0.70`.
   `DUPLICATE_AGGREGATION_POLICY` is unset → `top-1`.
3. Secrets (`DATABASE_URL`, `JWT_SECRET`) exist as Container App secrets/env vars; their values were not read.

## 4. Deployment workflow

`.github/workflows/publish-api-image.yml` is the only workflow. It is **`workflow_dispatch` only** (no `push` or
`pull_request` trigger), authenticates to GHCR with the repository token, builds the repo-root `Dockerfile` and
pushes `ghcr.io/<owner>/sbms-api:<sha>`. It does **not** deploy to Azure and does **not** run the test suite. The
Container App was pointed at the resulting tag out-of-band; the frontend was published by zip (`OneDeploy`) to
`sbms-web`.

Consequences for the report:

- The pipeline is **build-and-publish**, not CI-with-tests and not CD.
- No run history is verifiable from this host (`gh` is not installed); the Actions tab is the only source.
- `render.yaml` still exists at HEAD. Render is abandoned; the file is dead configuration and should be described
  as such rather than as the deployment mechanism.

## 5. Deployment is behind HEAD — the most important new finding

| Artefact | Built from | HEAD |
| --- | --- | --- |
| API image tag | `a3714f8` (2026-11-01 12:03 UTC) | `cca0625` (2026-11-03) |
| API commit distance | 9 commits behind; `f3686ec` (certificates) is not an ancestor | — |
| Frontend bundle | `/assets/index-KTiUJ9pN.js` (640 631 B) | a fresh `npm run build` of HEAD emits `/assets/index-DMsnyNls.js` (707 195 B) — **do not use this as evidence** (see below) |

Two independent checks establish the lag: `git merge-base --is-ancestor f3686ec a3714f8` → **false**, and
`POST /api/certificates/verify` → **404** on the live API.

A third *supporting* check (frontend side, added in pass 2): the deployed SPA is a **single JavaScript chunk**
(`/assets/index-KTiUJ9pN.js`, 640 631 B — the local build likewise emits one JS file). That chunk contains the strings
`Birth certificate number`, `Unique personal identifier`, `Duplicate review` and `Eligibility`, but it does **not**
contain `api/certificates/verify` or `verify-certificate`. The registration-identifier capture arrived in `730a62e` and
the certificate feature in `f3686ec`, so the deployed bundle can be bracketed to **after `730a62e`, before `f3686ec`** —
consistent with the 404. This is corroboration, not proof of a commit: a zip deploy carries no commit label.

A third check used earlier — comparing the live JavaScript content hash with a local build — **does not hold up** and
must not be cited. `frontend/src/services/api.js:3` inlines `import.meta.env.VITE_API_ORIGIN` at build time, so the
content hash of `index-*.js` changes with the API origin that was baked in, independently of the source commit. The
pass-2 build (variable unset) emitted `/assets/index-DMsnyNls.js`, 2 006 modules, 13.02 s, 707 195 B / gzip 171 403 B,
while the live shell requests `/assets/index-KTiUJ9pN.js` at 640 631 B; an earlier local build emitted
`index-CYGGqNQr.js` at 368.01 kB. The bundle hash is therefore not comparable across environments. What *is*
comparable is `dist/index.html`: 423 bytes locally and 423 bytes live, because the HTML contains only the asset
references it was generated with. Readiness, the image tag and the 404 remain the evidence; the bundle hash is not.

**Therefore:** the deployed system demonstrates authentication, registration, ML screening, duplicate review,
awards, disbursements, reporting and student-record QR verification — but **not** the bursary-certificate feature,
which exists only at HEAD. Any certificate screenshot or claim must be captured from a local run and labelled, or
the deployment must be refreshed first (an author decision; not taken in this pass).

## 6. What remains unverifiable without dashboard access

| Item | Why | Evidence needed |
| --- | --- | --- |
| App Service quota use (F1 daily CPU minutes) | free-tier quota is not exposed by the queries used | Portal → App Service → Quotas |
| Scale-to-zero cold start | `minReplicas 0` means the first request after idle pays interpreter + model load | Timed curl sequence, or portal metrics |
| Alerts, restore points, PITR drills | no alerts configured; `backupRetentionDays 7` is the only retention fact observed | Portal → PostgreSQL → Backup |
| Which commit the frontend bundle came from | zip deploy carries no commit label | Author's deploy note, or redeploy from a known SHA |
| TLS details beyond `minTlsVersion 1.2` | default `*.azurewebsites.net` certificate | Portal → TLS/SSL settings |

## 7. Gap references

Findings in this document define or resolve these IDs of `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md`:

| ID | Meaning here |
| --- | --- |
| G-22 | **Closed** — `PYTHON_EXECUTABLE` proves the predictor runs inside the API container, not as a separate service |
| G-29 | **New** — the deployed API image is `a3714f8`, nine commits behind HEAD `cca0625`; certificates are absent live |
| G-31 | **New** — the only workflow is `workflow_dispatch` build-and-publish: no tests, no deploy step, no post-deploy probe |
| G-32 | **New** — `render.yaml` is dead configuration; no Render service exists |
| G-33 | **New** — hand-rolled security headers only; no CSP, no `helmet` |
| G-34 | **New** — no threshold env vars, so code defaults apply; runtime changes are audited but not durable |
| G-36 | **New** — `gh` unavailable, so PR/CI history cannot be evidenced |

