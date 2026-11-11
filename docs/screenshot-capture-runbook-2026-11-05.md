# Screenshot capture runbook — 2026-11-05

Self-service companion to `academic-report-evidence/final-revalidation/SBMS_SCREENSHOT_INSERTION_CHECKLIST.md`.
Every location below was verified to exist on this machine. Repo root:
`c:\Users\user\Desktop\Projects\student-beneficiary-system`
Branch: `fix/sbms-completion-work` (present locally and on `origin`).
Deployed image corresponds to `a3714f8`; local evidence is captured at `cca0625`.

Capture rules that apply to every figure (checklist §3):

- PNG, 1440×900 or taller; crop browser chrome only, never the data.
- Filename `fig-<chapter>-<n>-<slug>.png`; caption ends with `local build at commit cca0625, captured <YYYY-MM-DD>`.
- Certificate figures are **local only**: append "the deployed image `a3714f8` does not serve this route (HTTP 404)".
- Mask UPI, birth certificate number and national ID unless the figure's purpose is to prove the field exists.
- Synthetic data only. Never show the two `E2E Probe` students.

## 0. Start the local stack (prerequisite for items 1–10)

```powershell
cd c:\Users\user\Desktop\Projects\student-beneficiary-system
git switch fix/sbms-completion-work
git rev-parse --short HEAD          # must print cca0625 — include this line in terminal figures
npm start                            # concurrently: API on :5000, Vite frontend on its printed port
```

Browser origin for every route below is the Vite URL printed as `Local:`; examples assume `http://localhost:5173`.
Admin sign-in: `/admin/login`. Credentials live in `deploy/azure/.secrets.json` — **never screenshot that file**.

## 1. Certificate issued — award panel (S-21)

- UI: `http://localhost:5173/students` → open the approved award → certificate area → **Issue certificate**.
- Routes are defined in `frontend/src/App.jsx` (award panel under `/students`; public check at `/verify-certificate`, line 61).
- API behind the button: `POST /api/awards/:id/certificate` (behaviour pinned by `backend/tests/bursaryCertificates.test.js`). The button is admin-only; field officers read and download the PDF.

## 2. Generated certificate PDF (S-22)

- Trigger the download from the issued certificate (PDF button in the same panel); the file lands in your Downloads folder.
- Open it and screenshot the viewer, or print it and photograph the page.
- `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md` G-15 asks for printed output of **both** this and the report export.
- PDF reality is asserted at `backend/tests/bursaryCertificates.test.js:263-264` (`%PDF` magic, >5 000 bytes).

## 3. `/verify-certificate` showing a successfully verified certificate (S-23)

1. Approve an award (approval generates the certificate in the same transaction) as in §1 — the panel shows the verification link and the printed reference.
2. Open `http://localhost:5173/verify-certificate#token=<64-hex>` (or follow the QR code), **or** type the printed reference (`SBMS-2026-XXXX-XXXX-XXX`) into the manual field.
3. Expect the green **Certificate verified** result showing reference, student name, school, programme, academic year, approved amount and issue date.
4. Capture that state. A "not current" or "Certificate not found" result is **not** evidence for this figure, and a revoked-certificate screenshot is no longer required anywhere: revocation is not part of SBMS (`docs/bursary-certificates-2026-11-01.md` §10.13).

The token travels in the fragment (`#token=`), built by `backend/src/config/publicAppUrl.js:174` and stripped from the
visible URL by the page — so capture the QR link or paste the token by hand.

## 4. `/reports` + exported PDF (S-24)

- `http://localhost:5173/reports` (admin only) → pick a date range → **Export PDF**.
- Screenshot the screen with the range visible, plus the downloaded PDF. Controller: `backend/src/controllers/reports.controller.js`.

## 5. `/audit` (S-25)

- `http://localhost:5173/audit`.
- Capture **after** items 1–4 and after changing a threshold in `/settings`, otherwise the log lacks the entries the figure must show.

## 6. `/users` and `/settings` (S-26)

- `http://localhost:5173/users`
- `http://localhost:5173/settings`
- Both are `ProtectedPage allowedRoles={["admin"]}` (`frontend/src/App.jsx:114-129`).

## 7. Backend tests — 24 suites / 151 tests (S-27)

```powershell
cd c:\Users\user\Desktop\Projects\student-beneficiary-system
git rev-parse --short HEAD                 # keep this line in frame: cca0625
cd backend
Get-Content .env.test | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item -Path ('env:' + $k.Trim()) -Value $v.Trim() }
npm test                                    # jest --runInBand tests
```

- **The export line is mandatory.** `jest.config.js` loads `tests/testEnvironment.js` (which does not read `.env.test`) and
  then `tests/testDatabaseGuard.js`. `src/index.js` calls plain `dotenv.config()`, which loads `.env` and never overrides
  shell vars. Without the export, all 24 suites fail to start with "Jest blocked" and 0 tests run.
- `.env.test` must point at `localhost:5432`, database `sbms_test`, role `sbms_test_runner`, with `DATABASE_URL` and
  `SBMS_TEST_DATABASE_URL` identical — the guard enforces loopback + that DB + that role, so the suite cannot reach Neon.
- Verified 2026-11-05 at `cca0625`: `Test Suites: 24 passed`, `Tests: 151 passed`, 115.2 s.

- Frame the command line **and** the final summary (`Test Suites: 24 passed`, `Tests: 151 passed`); do not crop the commit or the date.
- Known caveat: the ML sidecar fails when free RAM is under ~1 GB, giving 149–150/151 (`SBMS_TEST_EVIDENCE_CATALOGUE.md` G-02). Close other apps and rerun rather than captioning a lower number.

## 8. ML unit tests — 33 tests (S-28)

```powershell
cd c:\Users\user\Desktop\Projects\student-beneficiary-system\ml-service
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

- Interpreter lives in `ml-service\.venv` (not the repo root — verified 2026-11-05).

- Frame the `Ran 33 tests` / `OK` tail plus the interpreter path (the checklist requires the interpreter used).
- Files: `ml-service/tests/test_feature_engineering.py`, `test_operating_point.py`, `test_predict_artifact_loading.py`, `test_reliability_analysis.py`, `test_training_integrity.py`.

## 9. Hosted readiness probe — 200 (S-29)

API base, per `academic-report-evidence/final-revalidation/AZURE_DEPLOYMENT_VERIFICATION.md`:
`https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io`

```powershell
curl.exe -i https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io/api/ready
```

Expected `200` + `{"status":"ready"}`. Use `curl.exe`; in PowerShell `curl` is an alias for `Invoke-WebRequest`.
If the app is stopped for cost control, start it first: `deploy\azure\start.ps1` (then `stop.ps1` afterwards).

## 10. Certificate verification 404 on the deployed API (S-30)

```powershell
curl.exe -i -X POST https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io/api/certificates/verify -H "Content-Type: application/json" -d "{\"token\":\"0000000000000000000000000000000000000000000000000000000000000000\"}"
```

Expected `404` `Cannot POST /api/certificates/verify`. This is the evidence of deployment lag — caption it as such, do not fix it.

## 11–14. GitHub — `Eggxellent/student-beneficiary-system`

| Item | URL |
| --- | --- |
| 11. Repository home on the branch | `https://github.com/Eggxellent/student-beneficiary-system/tree/fix/sbms-completion-work` |
| 12. Commit history | `https://github.com/Eggxellent/student-beneficiary-system/commits/fix/sbms-completion-work` |
| 12. Individual commits | append to `https://github.com/Eggxellent/student-beneficiary-system/commit/`: `f3686ec`, `9fc14df`, `730a62e`, `a3714f8` |
| 13. Branches page | `https://github.com/Eggxellent/student-beneficiary-system/branches` |
| 14. Publish workflow | `https://github.com/Eggxellent/student-beneficiary-system/actions/workflows/publish-api-image.yml` |

All four commits were confirmed present locally (`git cat-file -t`): `f3686ec` certificates, `9fc14df` identifier fields,
`730a62e` registration identifier capture, `a3714f8` masked-identifier reveal. Workflow file: `.github/workflows/publish-api-image.yml`.
If the Actions tab shows no run, click **Run workflow** once so the figure is not an empty page.

## 15. Azure portal — resource group `rg-sbms` (no secrets)

1. Open `https://portal.azure.com` → search `Resource groups` → `rg-sbms` → use the **Overview / Resources** list.
2. Or generate a clean list to screenshot from the CLI instead of the portal:

```powershell
az group show -n rg-sbms -o table
az resource list -g rg-sbms -o table
```

3. Do **not** open, screenshot or expand: Container App → *Secrets*, App Service → *Configuration* values,
   Storage → account keys, or the files `deploy/azure/.secrets.json` and `deploy/azure/.state.json`.
   If environment variables must be shown, print names only:

```powershell
az containerapp show -g rg-sbms -n ca-sbms-api --query "properties.template.containers[0].env[].name" -o table
```

Never add `--show-secrets`.

