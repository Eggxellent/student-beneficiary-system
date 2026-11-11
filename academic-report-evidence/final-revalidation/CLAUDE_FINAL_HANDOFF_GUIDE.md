# CLAUDE FINAL HANDOFF GUIDE

> Read this first if you are continuing this work. It records what was verified, how, what must **not** be changed,
> and the exact commands that reproduce every number in the package.

## 1. Non-negotiable facts

| Fact | Value | Where it is proven |
| --- | --- | --- |
| Repository | `Eggxellent/student-beneficiary-system`, branch `fix/sbms-completion-work` | `git rev-parse --abbrev-ref HEAD` |
| Audited commit | `cca0625` — everything in this package was measured here | `git rev-parse --short HEAD` |
| Deployed API commit | `a3714f8` — **nine commits behind** | `az containerapp show` (image tag) |
| Backend tests | 24 suites, 151 tests, all 151 passing (monolithic 150/151; the Python-sidecar failure passes alone) | `npx jest --runInBand` (T-01) + ledger §1.1 |
| ML tests | 33 tests, OK | `python -m unittest discover` inside `ml-service/.venv` (T-02) |
| Tables / endpoints | 12 tables, 45 endpoints | `databaseReadiness.js`; 41 + 4 route declarations |
| Model | XGBoost, six features, `xgboost:6ec9f2a3…`, cut-off 0.50 provisional | `PRODUCTION_ML_MODEL_VERIFICATION.md` |

If you are asked to produce a number that is not in this table, derive it again and add the command you used — do not
copy it from an older report.

## 2. Things you must not do

1. **Do not modify application code, migrations, tests or CI to make a claim true.** The value of this package is that
   it describes the system as it is. If something is wrong, record it as a gap.
2. **Do not upgrade any status in `SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md` without new evidence.** Statuses were
   re-derived from code, not inherited from the chapter drafts.
3. **Do not quote the balanced-holdout precision without the prevalence-adjusted figures.** 0.9204 at a 50/50 split
   becomes 0.105 at 1 % prevalence; both numbers belong in the same paragraph.
4. **Do not describe the certificates feature as deployed.** It is tested at HEAD and absent from `a3714f8` (live 404).
5. **Do not cite `docs/verification.md` or `docs/uat-test-plan.md` as evidence** (G-23, G-24).
6. **Do not call the model Random Forest.** The proposal said Random Forest; the delivered artefact is XGBoost (G-21).
7. **Do not delete `ml-service/model/*.joblib`** even though `.gitignore` lists it — the artefacts are tracked (G-27).

## 3. Reproducing the evidence

```powershell
# 1. commit under audit
cd student-beneficiary-system
git rev-parse --short HEAD           # expect cca0625
git status --porcelain               # academic-report-evidence/ shows as untracked

# 2. backend suite (integration-style; needs the guarded test database)
cd backend
#    npm test does NOT read backend/.env.test — export it first, or every suite aborts
#    in setupFiles with 0 tests run ("Jest blocked: ..."). DATABASE_URL must equal
#    SBMS_TEST_DATABASE_URL: the same local sbms_test URL for the sbms_test_runner role.
Get-Content .env.test | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $kv = $_ -split '=', 2; Set-Item -Path ("Env:" + $kv[0]) -Value $kv[1] }
npm test                             # jest --runInBand; expect 24 suites / 151 tests

# 3. ML suite — use the ML virtualenv, not the workspace one
cd ..\ml-service
.\.venv\Scripts\python -m unittest discover -s tests -t tests -v    # expect 33 tests OK

# 4. frontend build
cd ..\frontend
npm run build                        # expect 2 006 modules, ~9.3 s; the hash is local-only

# 5. live probes (read-only)
curl.exe -s -o N -w "%{http_code}" https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io/api/ready
curl.exe -s -w "`n%{http_code}`n" -X POST -H "Content-Type: application/json" --data-binary "@body.json" https://ca-sbms-api.ambitiousstone-f2de8f67.uaenorth.azurecontainerapps.io/api/certificates/verify
```

## 4. Environment quirks that cost time

| Quirk | Symptom | Fix |
| --- | --- | --- |
| Workspace `.venv` lacks `pandas` | 5 ML test collection errors | use `ml-service/.venv` |
| Jest parallelism | flaky DB contention | `npm test` already passes `--runInBand` |
| Guarded test database | tests refuse to run against the demo DB | `npm run db:provision-test` first |
| Guard env vars unset | every suite fails in `setupFiles`, `Tests: 0 total` — a config error, not a test result | export `backend/.env.test` as in §3 step 2 |
| Python sidecar fails under memory pressure | `Python predictor process exited` or `Production XGBoost model artifact could not be loaded` in `mlPredictor.integration.test.js` / `performance.test.js`, while every other suite passes | check free RAM (`Get-CimInstance Win32_OperatingSystem`); run the affected file alone, or the suite in two groups. Both tests pass alone at ~0.8 GB free (V-5, V-6). Record the ledger — do not claim "0 failures" or "the suite fails" |
| V8 out-of-memory on a full sweep | `Fatal process out of memory: Zone` when free RAM is very low (725 MB free of 7 531 MB on 2026-11-03) | run `npx jest --runInBand` in file groups and sum the totals; the same grouping reproduced 24 suites / 151 tests |
| `gh` CLI absent | PR/CI history unverifiable | do not fabricate; mark G-36 |
| PowerShell quoting | `curl` alias differs from `curl.exe` | call `curl.exe` explicitly |
| PowerShell 5.1 mangles inline JSON | `-d '{"token":"x"}'` arrives as `{token:x}` → the global parser throws → the API answers `400 {"message":"Invalid request"}` **before routing**, which looks like a route-level failure | send the body from a file (`--data-binary "@body.json"`) or omit the body; with a valid body `POST /api/certificates/verify` answers `404 Cannot POST` (re-verified 2026-11-03) |
| Windows line endings | diff noise in `.md` files | edit with the editor tool, not `>>` redirection |

## 5. Where each chapter's edits go

| Chapter | Read first | Then apply |
| --- | --- | --- |
| 4 (analysis and design) | `CHAPTER_4_FINAL_EVIDENCE_PACKAGE.md` §1 (section verdicts), §2 (figures) | correct table count to 12, endpoint count to 45; redraw Figures 4.11 and 4.24; add the deployment-lag caption |
| 5 (implementation, testing, evaluation) | `CHAPTER_5_FINAL_EVIDENCE_PACKAGE.md` §1–§2 | replace 149/152/160 with 151 at `cca0625`; reclassify UAT; label certificate screenshots; use the six-row limitations table |
| 6 (conclusions) | `CHAPTER_6_FINAL_EVIDENCE_PACKAGE.md` §1–§3 | copy the two mandatory sentences (XGBoost declaration, deployment lag); use the objective verdicts as written |

## 6. Open work and who owns it

| Item | Owner | Blocking? |
| --- | --- | --- |
| Redeploy HEAD or label the certificates as local-only (AD-1) | technical maintainer | blocks any live certificate claim |
| UAT decision (AD-2) | author | blocks objective (iv) being anything above "partially achieved" |
| Adjudicated labels (AD-3) | programme owner + maintainer | blocks field-accuracy claims |
| Stale document disposition (AD-4) | author | blocks a clean appendix |
| Commit or archive this package (AD-5) | author | blocks traceability to the audited commit |
| Figure drawing and screenshots | author | blocks Chapters 4–5 being submittable |
| Workstation specification, author names, AI disclosure | author | blocks front matter and §5.2.1 |

## 7. Definition of done for this package

- [ ] Every gap ID cited anywhere resolves to `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md`.
- [ ] The four numbers (151, 33, 2 006, 45) agree across all documents, and 12 for the tables.
- [ ] No document claims a capability the deployment does not have.
- [ ] Every metric in Chapter 5 is tied to a file in `EVIDENCE_SOURCE_INDEX.md`.
- [ ] The package states the audited commit (`cca0625`) and the deployed commit (`a3714f8`) on the first page.
- [ ] All author decisions (AD-1 … AD-6) are marked with the option actually taken.

