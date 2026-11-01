# Azure deployment — state and decision log (31 October 2026)

One page of state only. **Detail, evidence and the full cost model live in
`docs/azure-deployment-plan-2026-10-30.md` §12 (current, minimum-cost) and §11 (audit behind it)** —
do not re-derive them, do not re-run the audit.
**Deployed and verified live on 31 October 2026** — 1 resource group, 6 resources, 1 budget.
**Brought back up on 1 November 2026** and a real QR-scanning defect found and fixed — see §7.

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
- **Sign-in**: `https://sbms-web.azurewebsites.net/admin/login` for the administrator and
  `https://sbms-web.azurewebsites.net/field-officer/login` for a field officer — both roles exist
  in the live database; passwords are only in `deploy/azure/.secrets.json`.
- **QR scanning**: a student QR image encodes `https://sbms-web.azurewebsites.net/verify#token=…`.
  The SPA host does **not** proxy `/api/`, so the page must call the API through the shared client
  (`VITE_API_ORIGIN`) and never with a relative `fetch("/api/verify")` — see §7.
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
| 2026-10-31 21:22 | `start.ps1` (ready/health/frontend all 200) → `stop.ps1` — the demo-day round trip | 2026-11-07 21:22 |
| 2026-11-01 11:03 | `start.ps1` — PostgreSQL `Ready` 11:05:52Z; `/api/health`, `/api/ready`, frontend all 200 | **2026-11-08 11:03** |

`status.ps1` when the server is stopped: server `Stopped`, **$4.42/month**, 7 days left on the
countdown. Since 2026-11-01 11:03Z it is **Ready** and billing $0.02/h.

## 6. Next actions

1. Phase 1 (deploy + end-to-end acceptance) is **complete** — do not re-run it; the evidence is in
   plan §12.15.
2. Phase 2: supervisor gap remediation **SBMS-01…18**.
3. Credit balance and expiry remain portal-only (`microsoftazuresponsorships.com/Usage`) — they change
   the runway, not the architecture.

## 7. 1 November 2026 — bring-up and the QR defect

The stack was started again for use (§5 stop log). Two paths that the 31 October acceptance had only
covered at the API level were re-checked end to end, and one of them was broken.

| Check | Result |
| --- | --- |
| `start.ps1` | PostgreSQL `Ready`; `/api/health` 200, `/api/ready` 200, frontend 200 with `#root` |
| Field-officer sign-in (live API and the deployed form) | 200; `/field-officer` renders the officer dashboard |
| Administrator sign-in (`peter.ngigi@o365.strathmore.edu`) | 200; `/dashboard` renders the admin dashboard |
| Admin surfaces | `/api/admin/dashboard`, `/api/duplicate-flags`, `/api/awards`, `/api/disbursements`, `/api/users`, `/api/audit-logs` → 200; `/api/students` → 403 (intended, O10) |
| **QR scan through the SPA** | **was broken** — `POST https://sbms-web.azurewebsites.net/api/verify` → 404 |

### The defect

`frontend/src/pages/Verification.jsx` called `fetch("/api/verify", …)`. The SPA runs on App Service
(IIS) and `frontend/public/web.config` deliberately leaves `/api/` alone, so the request never left
the SPA host: every scan rendered "Unable to verify this code", valid codes included. The 31 October
acceptance (plan §12.15) checked `POST /api/verify` **directly against the container app**, so this
path had never been exercised.

The fix routes the call through the shared axios client, which already honours `VITE_API_ORIGIN`
(`frontend/src/services/api.js`); `429`/`5xx` still map to "Verification is temporarily unavailable"
and every other refusal to "Unable to verify this code". This is the only frontend change.

### Evidence after the fix

| Check | Result |
| --- | --- |
| `npm --prefix frontend run build` with `VITE_API_ORIGIN` | exit 0, 2002 modules, 12.37 s, bundle `assets/index-DZGqI0VB.js` |
| `az webapp deploy` (zip) | succeeded; the live `index.html` serves that bundle hash |
| `node scripts/qr-smoke.mjs` in headless Chrome, `SBMS_BROWSER_APP=https://sbms-web.azurewebsites.net` | **9/9** — valid code → "Record found", token stripped from the URL, no student data, unknown/absent/query-string tokens refused, a second scan in the same tab re-verifies, no page errors |
| Real-browser sign-in for both roles | **9/9** — form renders, protected route reached, session token stored, dashboard content rendered, no page errors |
| Field-officer screens | `/students` renders the three live records (3.2 s warm, measured from `performance.getEntriesByType('resource')`); `/students/register` renders its 6 inputs; both make CORS requests from the App Service origin that return 200 |
| QR images for the three live students | written to `%USERPROFILE%\Desktop\SBMS_QR\` — scannable with a phone camera |

### Carry-forward

- The frontend fix is **local and uncommitted** (`frontend/src/pages/Verification.jsx`). A later
  `provision.ps1 -DeployFrontend` from a clean checkout would silently restore the defect until the
  change is committed.
- The container app still runs image `ghcr.io/eggxellent/sbms-api:f3ad3be…`. The uncommitted backend
  work (single `/api/verify` registration, tests) is **not** deployed and is not needed for the app
  to work.
- Reading the `users` table needed a temporary single-IP firewall rule for the operator machine; it
  was created at 11:10:20Z and deleted at 11:11:33Z (activity log), so the firewall is back to
  "Azure services only".
- The database is **running** ($0.02/h). Re-stop by **2026-11-08 11:03** with `stop.ps1` or
  `teardown.ps1 -Stop`.
- Sign-in is rate limited to **10 attempts / 15 minutes per IP** (`backend/src/middleware/loginRateLimit.js`,
  in-memory, per process). The scripted runs in this session tripped it and produced a 429 and two
  misleading "page did not render" results; a person is unaffected unless they submit ten times.


## 8. Admin verification of masked identifiers (1 November 2026)

### The defect the owner hit

An administrator could not check a flagged pair against the documents a guardian presents:

1. `GET /api/duplicate-flags` masked `guardian_id`, `upi`, `birth_certificate_number` and
   `national_id_number` via `maskIdentifier()` (`backend/src/controllers/duplicateFlags.controller.js`),
   and **no endpoint revealed them**. The mask was pinned by `backend/tests/duplicateFlags.test.js:117`,
   so it was deliberate — but nothing replaced it with a way to verify.
2. The guardian's phone (`students.primary_phone`, collected by the registration form) was **never
   selected**, so the queue could not show a guardian contact at all.
3. Opening a case closed it again: `fetchCases` depended on `selectedId`, so opening a row fired a
   fresh queue request, and the earlier in-flight response ran
   `if (!cases.some(id === selectedId)) setSelectedId(null)` with a stale `selectedId`. Reproduced in
   production **with no reveal involved** (`dialog_after_open_no_reveal=false`).

### The patch

| File | Change |
| --- | --- |
| `backend/src/controllers/duplicateFlags.controller.js` | selects `primary_phone` for both students, returns it masked as `guardian_contact`, and adds `revealIdentifiers`: the full identifier set for one case, written to `audit_logs` as `REVEAL_DUPLICATE_IDENTIFIERS` |
| `backend/src/routes/duplicateFlags.routes.js` | `GET /api/duplicate-flags/:id/identifiers`, `admin` only |
| `backend/tests/duplicateFlags.test.js` | the queue still masks; the reveal returns the stored UPI, birth certificate, National ID and guardian contact; a field officer gets 403; an unknown case gets 404; the audit row names the reviewer |
| `frontend/src/pages/DuplicateReview.jsx` | `Guardian no:` row, a `Reveal identifiers` control with its audit confirmation, and the stale-closure fix (`setSelectedId` resolved inside the updater; `fetchCases` no longer depends on `selectedId`) |
| `scripts/admin-reveal-smoke.mjs` | headless-Chrome check of the whole admin path |

The queue payload stays masked, and the reveal is per case, admin-only and audited, so O10 (admins
do not read `/api/students`) is unchanged: a live admin token still gets 403 there.

### Evidence

| Check | Result |
| --- | --- |
| `npx jest tests/duplicateFlags.test.js -t "identifiers"` | pass (new test) |
| `npx jest tests/duplicateFlags.test.js -t "should return pending duplicate flags"` | pass (queue still masks) |
| `npx jest tests/roleAuthorization.test.js` | 6/6 pass |
| GitHub Actions `publish-api-image.yml` for `a3714f8` | success |
| `az containerapp update --image ghcr.io/eggxellent/sbms-api:a3714f8c…` | revision `ca-sbms-api--latest` Provisioned at 12:03Z |
| Live `GET /api/duplicate-flags/:id/identifiers` as `admin@sbms.test` | 200; `revealed_fields=guardian_id,guardian_contact,upi,birth_certificate_number,national_id_number`; values differ from the masked queue; `audit_logs` row `REVEAL_DUPLICATE_IDENTIFIERS` for `admin@sbms.test` on the same case |
| Live admin `GET /api/students` | 403 (O10 intact) |
| `npm --prefix frontend run build` + `az webapp deploy` | redeployed; the live `index.html` serves the new bundle hash |
| `node scripts/admin-reveal-smoke.mjs` against production | **9/9** — sign-in, queue, the case dialog stays open, 60 masked characters, the `Guardian no:` row present, reveal confirmation, 0 masked characters after the reveal, no page errors |

### Carry-forward

- The live student records hold **no `primary_phone` and no `national_id_number`**, so those two rows
  read "Unavailable" for the existing cases. The registration form now also captures **UPI and birth
  certificate number** (optional), so newly registered students populate those rows and the critical
  exact-match rule can fire; the three existing demo rows still have neither. Backfilling them needs a
  temporary single-IP firewall rule and a direct `UPDATE`, and was not done because it changes
  beneficiary data.
- `frontend/src/pages/Verification.jsx` and `backend/src/index.js` are still uncommitted from the
  previous session; only the files above were committed.
- The database is still **running** ($0.02/h): re-stop by **2026-11-08 11:03Z**.


## 9. Registration form captures UPI and birth certificate number

**Date:** 2026-11-01

**Problem.** The duplicate rules give an exact UPI or birth-certificate agreement critical status, and
the review queue already had rows for both, but the registration form posted only `full_name`,
`date_of_birth`, `school_code`, `national_id_number` and `primary_phone`. The API accepts `upi` and
`birth_certificate_number`, so the columns existed and stayed NULL for every real registration: the
critical rule could only ever fire for the seeded synthetic records.

**Change.** `frontend/src/pages/StudentRegistration.jsx` adds **Birth certificate number** and **UPI**
inputs. Both are optional, because a guardian may not have the document at the counter, and a blank box
is dropped from the payload rather than sent as an empty string (`normalizeIdentifier` would turn `""`
into `undefined` anyway, but the request now matches what the officer actually recorded). The server
uppercases both, like the other identifiers.

### Evidence

| Check | Result |
| --- | --- |
| `npm --prefix frontend run build` with `VITE_API_ORIGIN` + `az webapp deploy` (zip) | exit 0; the live `index.html` serves `assets/index-KTiUJ9pN.js` and the live bundle contains `Birth certificate number` and `Unique personal identifier` |
| `node scripts/registration-fields-smoke.mjs` against production | **11/11** — officer sign-in, both inputs present and not `required`, the six original fields still posted, the payload carries both markers, a blank identifier is omitted, the blocked request surfaces the error panel instead of a success panel |
| Live `POST /api/students` as `officer.1031205024@sbms.test`, lowercase `e2e-bc-…`/`e2e-upi-…` | 201; a second student sharing those identifiers produced `exact_identifier_matches: ["UPI","birth certificate number"]`, `birth_certificate_match: 1`, `upi_match: 1`, `model_score: 0.9382`, `priority: high` |
| Live `GET /api/students/:id` for that student | `upi: E2E-UPI-20261101-X1`, `birth_certificate_number: E2E-BC-20261101-X1` — stored non-null and uppercased |

### Carry-forward

- The two probe students (**E2E Probe Alpha**, **E2E Probe Beta**) and the one case they raised are
  still in production. Clear them with `DELETE FROM duplicate_flags WHERE student_id IN (SELECT id FROM
  students WHERE full_name LIKE 'E2E Probe%'); DELETE FROM students WHERE full_name LIKE 'E2E Probe%';`
- The queue/reveal screens were **not** re-checked for these values: the stored admin password in
  `deploy/azure/.secrets.json` returns 401 for both `admin@sbms.com` and `admin@sbms.test`, so the admin
  password has drifted from the store. Reset it, then re-run `scripts/admin-reveal-smoke.mjs`.
- `scripts/browser-smoke.mjs` reads `SBMS_VERIFY_OFFICER_EMAIL`, `SBMS_VERIFY_ADMIN_EMAIL` and a single
  `SBMS_VERIFY_PASSWORD` (not `SBMS_OFFICER_*`), so it cannot be pointed at two accounts with different
  passwords. It was not re-run for the same admin-password reason; the officer flow is covered by the
  new smoke.

