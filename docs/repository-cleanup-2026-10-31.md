# SBMS repository cleanup — proposal and execution record, 2026-10-31

**Status: EXECUTED for items 1–4 and the Docker change; item 5 was rejected during execution
(see §7.2). Azure work remains deferred and untouched.**

Originally written as a proposal: every item below needed the owner's approval before removal,
because this phase runs under the rule *do not delete uncertain files*. The owner approved the
Phase 1 deletions only ("Approve cleanup deletions only; defer all Azure work"), and §7 records
what was actually removed, what was rejected, and the test evidence for each step.

Scope: checkout `fix/sbms-completion-work`, 224 tracked files.

## 1. How each candidate was judged

A file was only put on the deletion list after **all** of the following came back negative:

1. `git grep -F <module/file name>` across the whole tree (including `docs/`, `*.md`, `*.json`,
   `*.yml`, shell scripts) returned no reference other than the file itself.
2. For backend files: the JS modules in `backend/src` were opened and their import lists compared
   against the file's path (so "imported nowhere" is a checked fact, not an assumption).
3. For scripts: `backend/package.json` and root `package.json` `scripts` were read; neither names it.
4. For frontend assets/config: `index.html`, `vite.config.js` and every `src/**` import were checked.
5. For Python: every `.py` in `ml-service` was grepped for the module name; test paths were read;
   `Dockerfile` and `.dockerignore` were checked for runtime use.
6. There is **no CI** in the repository (`.github` does not exist), so no workflow can reference any
   of these files. That is itself a Phase 1 finding, closed in Phase 3.
7. Deployment surface (`Dockerfile`, `.dockerignore`, `render.yaml`, `docs/deployment.md`) checked.

Sizes are on-disk numbers from this checkout, not guesses.

## 2. Proposed deletions

### 2.1 Files

| # | Path | Size | What it is | Evidence it is dead |
| --- | --- | --- | --- | --- |
| 1 | `neon.ts` | 82 B | Root-level TypeScript stub for `@neon/config` + `@neon/env` | No TypeScript toolchain exists (no `tsconfig.json`, no `tsc`, no build step anywhere). `git grep -F neon` finds it only in `.gitignore` (`.neon` dir) and in planning docs that mention the *packages*, not this file. Not imported by backend, frontend or any script. |
| 2 | `backend/src/routes/verification.routes.js` | ~1.5 KB | Express router for `/api/verification/:token` | `git grep -F "verification.routes"` → **0 hits**. `backend/src/index.js` mounts `verificationController.verifyToken` directly behind the same public rate limiter and the same path, so deleting this file removes an unreachable duplicate and changes no behaviour. |
| 3 | `backend/scripts/standardize-student-records.js` | ~7 KB | One-off manual applier for the `20261019_standardize_student_records` migration | Not referenced by any `package.json` script, test, doc command or workflow. The migration runner (`npm run db:migrate`) already applies the same `.sql`, and `db:bootstrap-empty` applies schema + all migrations. A second, hand-run writer of the same DDL is the risk. |
| 4 | `ml-service/preprocess.py` | ~2 KB | Writes `ml-service/data/features.csv` from raw exports | `git grep -F preprocess` → **0 hits** (no import, no test, no doc command). Nothing reads `data/features.csv`: the training and evaluation scripts build features in memory via `feature_engineering.build_pair_features`. Leftover of the abandoned CSV pipeline. |
| 5 | *(rejected — §7.2)* `frontend` devDependencies `autoprefixer`, `postcss` | dev-only | PostCSS/autoprefixer entries in `frontend/package.json` | Neither name appears in `frontend/src/**`, `vite.config.js`, `index.html` or any CSS file, and there is **no** `postcss.config.*` or `tailwind.config.*` anywhere (checked). Styling is Tailwind v4 through `@tailwindcss/vite`. Removing them trims `node_modules` only; the bundle is unaffected. |

Total source bytes removed by 2.1: **≈ 11 KB**. The value is not size — it is the removal of two
duplicate implementations (routes, migration applier) and two dead entry points.

### 2.2 Dependencies

| # | Change | Where | Evidence |
| --- | --- | --- | --- |
| 6 | Remove `@neon/config` and `@neon/env` from the **root** `package.json` dependencies and refresh `package-lock.json` | root `package.json`, root `node_modules` (18.0 MB incl. `@neon/config`, `@neon/env`, `@neon/sdk`) | These are the only two root dependencies and nothing imports them. The root install exists solely to resolve them and is part of no documented run step. **Dev-only saving: 18.0 MB.** Not in the Docker image. |
| 7 | Keep every backend/frontend/ML runtime dependency unless §4.1 proves otherwise | — | `bcrypt`, `cors`, `jsonwebtoken`, `pdfkit`, `qrcode`, `zod`, `express-rate-limit`, `helmet`, `pg`, `supertest`, `jest`, `nodemon` are all imported by `backend/src`, tests or scripts. |

### 2.3 Docker image — the CUDA dependency (the only large win)

| # | Change | Evidence |
| --- | --- | --- |
| 8 | Install **xgboost without its transitive CUDA dependency**: keep `pandas==3.0.5`, `scikit-learn==1.9.0`, `jellyfish==1.2.1` in `ml-service/requirements.txt`, and make the Dockerfile run `pip install --no-cache-dir -r requirements.txt` followed by `pip install --no-cache-dir --no-deps xgboost==3.2.0`, so `nvidia-nccl-cu12` is never pulled on Linux | see §3 |

## 3. Why the CUDA removal is safe (four independent checks)

The production inference path must not need NCCL. It does not:

1. **Where the dependency comes from.** `xgboost` 3.2.0 declares
   `nvidia-nccl-cu12; platform_system == "Linux" and platform_machine == "x86_64"`. It is a
   *Linux-only transitive* dependency of xgboost, not something this project asked for. On this
   Windows workstation the venv has **no** `nvidia-*` package installed at all.
2. **How xgboost uses it.** In `xgboost/collective.py` (v3.2.0) the only reference is
   `def _find_nccl(): from nvidia.nccl import lib ...`, called from
   `CommunicatorContext.__init__` **only** when `build_info()["USE_DLOPEN_NCCL"]` is set and no
   `dmlc_nccl_path` was supplied — i.e. during distributed GPU communicator setup — and it is
   wrapped in `try: ... except ImportError: pass`. `import xgboost`, `load_model()` and
   `predict_proba()` never reach it.
3. **What the code does.** `ml-service/predict.py` loads one `joblib` artifact
   (`model/xgb_duplicate_model.joblib`, 0.40 MB) and calls `predict_proba` on a single-process
   `pandas` frame. No Dask, no distributed tracker, no GPU, no `tree_method=gpu_*`.
4. **The whole ML suite already runs without any CUDA package** (this workstation, no `nvidia-*`
   installed): 33/33 ML tests and the research helpers pass and the model loads and predicts.
   Nothing in the suite imports NCCL.

Belt and braces: the Dockerfile already ends with a build-time gate
(`python -c "from predict import load_model; ..."`). That gate fails the build if a future change
makes the model un-loadable without NCCL, so the removal cannot silently break deployment. In
Phase 3 it is strengthened to also run one real `predict_pairs` call against a fixed fixture.

### 3.1 Measured and estimated effect

| Item | Value | Status |
| --- | --- | --- |
| Previous image (measured in an earlier session, recorded in handover §20.5 and Azure plan §3) | **2,222,712,090 bytes ≈ 2.07 GiB** | measured earlier, **not** re-measured today |
| `nvidia-nccl-cu12` wheel inside it | **351.5 MB** | measured in that same build |
| `nvidia-nccl-cu12` on PyPI today (manylinux x86_64, 2.28/2.32 class) | 290–297 MB compressed, unpacks larger inside the layer | PyPI metadata |
| Expected image after the change | **≈ 1.74 GiB (≈ −17 %)** | estimate — must be re-measured after the rebuild |

**Measurement blocker, stated plainly:** this workstation has no Docker engine (`docker` is not on
`PATH`, Docker Desktop is not installed), so the image cannot be rebuilt or measured here. The
command that produces the number is in §5 step 4. This document does **not** claim a new image size.

## 4. Examined and deliberately KEPT

These look removable and are not. Each reason was checked, not assumed.

| Path | Why it stays |
| --- | --- |
| `ml-service/model/xgb_duplicate_model.joblib` | **Production model.** Rules: do not touch the model or its threshold. |
| `ml-service/model/rf_duplicate_model.joblib` (6.64 MB) | Historical Random-Forest artifact, not loaded by `predict.py` (which loads only the XGBoost file). It is ML evidence in the model comparison and is excluded from the image by `.dockerignore`. Uncertain → keep. |
| `ml-service/model/research/rf_attachment_style_candidate.joblib` | Research artifact named in the model evidence. Keep. |
| `ml-service/experiments/febrl_record_linkage/**` (15 files) | Abandoned *branch experiment*, but it is cited as evidence and is the independent-evaluation basis. Deleting it would delete evidence, which the rules forbid. Keep, and keep it out of the image (`.dockerignore` already does). |
| `ml-service/{compare_models_on_holdout, evaluate_adversarial_format_scenarios, evaluate_independent_dataset, generate_variable_pairs, test_predictions}.py` | Evidence generators: not imported by the service, but they reproduce the numbers the capstone reports. Keep. |
| `backend/scripts/inspect-render-db.js` | Render-era read-only diagnostic (`SELECT` only), unreferenced. Kept on purpose: it is a working read-only DB inspector and will be used to verify the Azure database in Phase 4. |
| `backend/scripts/cleanup-legacy-school-data.js` | Destructive but documented operator for legacy school-data cleanup, cited in `PRODUCTION_DATABASE_RECOVERY_AUDIT`, dry-run-guarded. Deleting an audited operator is worse than keeping it. |
| `backend/migrations/**` (12), `backend/schema.sql`, `backend/scripts/bootstrap-production-schema.js` | **Migrations and schema are explicitly protected**, and bootstrap is the only script that creates a usable production database (schema + every migration + first admin). |
| `.env.example`, `backend/.env.example`, `frontend/.env.example` | Environment templates — protected. |
| `Dockerfile`, `.dockerignore` | Required for the Azure container deployment. |
| `render.yaml`, `docs/deployment.md`, Render notes | Superseded but still valid configuration and part of the deployment record; deployment configuration is protected. Azure equivalents are **added** in Phase 3, not substituted. |
| `docs/*.md` (≈ 30 files) | Capstone documentation is protected; overlaps are mapped in §4.1 instead of deleted. |
| `frontend/public/images/**` | Referenced by `index.html` / `src` (favicon, logo). Checked. |
| `backend/test/**`, `backend/tests/**`, `ml-service/test_*.py` | Tests — protected. |

### 4.1 Documentation overlap map (no deletion proposed)

| Overlapping subject | Documents | Resolution |
| --- | --- | --- |
| Handover | `SBMS_PROJECT_HANDOVER_2026-10.md` (current), `SYSTEM_HANDOVER.md` (earlier) | Keep both; the newer one supersedes the older and says so. |
| Test results | `FINAL_TEST_REPORT.md` (current), `tests-report-2026-10-31.md`, `TEST_REPORT.md`, `PHASE6_TEST_REPORT.md` | Keep; each is a dated measurement record. Phase 6 appends, never replaces. |
| Deployment | `deployment.md` (Render), `azure-deployment-plan-2026-10-30.md`, `DEPLOYMENT.md` | Keep; the Azure plan is additive. |
| Database | `database-recovery-rehearsal-2026-10-31.md`, `PRODUCTION_DATABASE_RECOVERY_AUDIT.md` | Keep; rehearsal and audit are distinct evidence. |

## 5. Verification plan for the cleanup (runs on approval)

1. `npm --prefix backend ci`, then `npm --prefix backend test` — expect 21 suites / 128 tests.
2. `npm --prefix backend run test:native` — expect 43/43; `npm --prefix frontend run build` — exit 0.
3. `ml-service\.venv\Scripts\python.exe -m unittest discover -s ml-service -p "test_*.py"` — expect
   33/33, plus one explicit `predict_pairs` call proving the model still loads and scores.
4. Rebuild and measure: `docker build -t sbms-api .` and
   `docker image inspect sbms-api --format "{{.Size}}"`; inside the image
   `pip list | findstr nvidia` must print nothing. **Requires a Docker engine, which this
   workstation does not have.**
5. `git status` clean, then one commit: *"chore: remove unused files and dependencies"*. No
   force-push, no history rewrite.

## 6. What this document does not claim

- The §1–§5 text is the pre-execution proposal, kept as written; §7 is the record of what actually
  happened, including the two proposal items that changed.
- No image size here is a fresh measurement. The only measured figure (2.07 GiB, 351.5 MB NCCL) is
  quoted from an earlier build and labelled as such.
- Removing the root `@neon/*` dependencies does not by itself make an external Postgres possible;
  that is an architecture decision (Phase 2, approval #5).

## 7. Execution record (2026-10-31)

Owner approval: *"Approve cleanup deletions only; defer all Azure work."* Branch
`fix/sbms-completion-work`, base commit `a866afa` (247 tracked files before the cleanup).

### 7.1 Removed

| # | Path | Bytes removed | Command |
| --- | --- | --- | --- |
| 1 | `neon.ts` | 82 | `git rm neon.ts` |
| 2 | `backend/src/routes/verification.routes.js` | 305 | `git rm` |
| 3 | `backend/scripts/standardize-student-records.js` | 1,280 | `git rm` |
| 4 | `ml-service/preprocess.py` | 868 | `git rm` |

**Total source removed: 2,535 bytes (≈ 2.5 KB), 4 files → 247 − 4 = 243 tracked files.**

Three claims in §2.1 need correction, because this document stated the sizes were measured:

- The byte sizes in §2.1 (~1.5 KB, ~7 KB, ~2 KB) were wrong; the real blob sizes are in the table
  above (`git cat-file -s HEAD:<path>`).
- The scope line said 224 tracked files; `git ls-tree -r HEAD --name-only` reports **247**.
- §2.1 item 2 said `index.js` calls `verificationController.verifyToken` on the same path. In fact
  `index.js:57` and `index.js:82` mount the limiter and `verificationController.verify` directly on
  `POST /api/verify`; the deleted router (`POST /` → `controller.verify`) was never mounted by any
  `app.use`, so it was unreachable. The conclusion (dead code) is unchanged.

Root dependencies: `@neon/config` + `@neon/env` removed from `package.json`; `npm install` pruned
19 packages. `node_modules/@neon` is gone (`git grep @neon` now matches only two prose sentences in
`docs/`, which were corrected). Root `node_modules` is 5.5 MB; `frontend/node_modules` 100.0 MB;
`backend/node_modules` 68.7 MB.

### 7.2 Rejected during execution: removing `autoprefixer` + `postcss`

Not applied — `frontend/package.json` is unchanged. Two findings, either one of which is decisive:

1. **`postcss` is not unused.** The lockfile shows `node_modules/vite` depends on `postcss`, so the
   package stays installed as a transitive dependency of the build tool even after the devDependency
   is deleted. The saving is one package (`autoprefixer`, dev-only), not two.
2. **The edit breaks npm in this environment.** With the two devDependencies removed,
   `npm install`, `npm ci --dry-run` and `npm install --package-lock-only` in `frontend/` all fail
   with `TypeError: Cannot read properties of undefined (reading 'spec')` inside
   `@npmcli/arborist/lib/arborist/reify.js:1302`. Restoring the two lines makes the same command
   succeed. That is npm 10.9.0 (Node 22.11.0) choking on a lockfile whose root edges no longer match
   `package.json`. Deleting `frontend/node_modules` and reinstalling did not change it; the lockfile
   was never deleted, because regenerating it would re-resolve ~112 packages to buy a ~1.5 MB
   dev-only saving. `frontend/package-lock.json` is therefore untouched.

`postcss` is also inert today (no `postcss.config.*` exists), so the §2.1 evidence about *use* was
right; the cost/benefit was not.

### 7.3 Docker change (applied, not measured)

`Dockerfile` now installs every requirement except xgboost from a filtered copy of
`requirements.txt`, then installs xgboost itself with `--no-deps`, reading the pin back out of
`requirements.txt` with `sed` so the version cannot drift. A final gate fails the build if
`pip list` shows any `nvidia-*` package. The model-loading gate also grew a real inference call:
`predict_pairs` on two synthetic records, asserting `0.0 <= score <= 1.0`.

The `grep`/`sed` pipeline was executed natively under WSL `bash` against the real
`ml-service/requirements.txt`: it drops exactly the xgboost line (3 of 4 lines kept) and extracts
`3.2.0`.

**Not verified: image size and in-image `pip list`.** The Docker CLI is installed
(`Docker Desktop\resources\bin\docker.exe`), but the engine is not running: `docker version` fails
with "failed to connect to the docker API at npipe://./pipe/dockerDesktopLinuxEngine", and no
`Docker Desktop` process exists. `docker build` / `docker image inspect` therefore could not run
without starting Docker Desktop first. The estimate in §3.1 (~2.07 GiB → ~1.74 GiB) remains an
estimate and is not a measurement.

To close it, with the engine started:

```powershell
docker build -t sbms-api .
docker image inspect sbms-api --format '{{.Size}}'
docker run --rm sbms-api /app/ml-service/.venv/bin/python -m pip list | Select-String '^nvidia-'
```

The last command must print nothing; the middle one should be compared against 2.07 GiB.

### 7.4 Test evidence after the deletions

| Check | Command | Result |
| --- | --- | --- |
| Backend Jest (whole suite) | `npm --prefix backend test` with `.env.test` loaded (recipe: handover §15.3) | **PASS — 21 suites / 128 tests**, exit 0 |
| Backend API smoke | `node src/index.js` on port 5055 against `sbms_test`, then `npm run test:smoke` | **PASS — `/api/health` `{"status":"ok"}`, 3/3 tests**, exit 0, empty stderr (proves the API boots without `verification.routes.js`) |
| ML service | `python -m unittest discover -s ml-service/tests -t ml-service/tests` | **PASS — 33/33**, 2.4 s |
| ML research helpers | `python -m unittest discover -s ml-service/experiments/sbms_dataset -t ...` | **PASS — 7/7**, 0.2 s |
| Inference gate (same call the Dockerfile makes) | `predict_pairs` on two synthetic records | **PASS — score 0.6071** |
| Frontend build | `npm --prefix frontend run build` | **PASS — 10.11 s**, `index.js` 335.96 kB (gzip 101.48 kB), `index.css` 39.81 kB (gzip 8.69 kB) |

Corrections to §5's verification plan:

- There is **no `test:native` script** in `backend/package.json`; the scripts are `test`
  (`jest --runInBand tests`) and `test:smoke` (`node --test test/api.smoke.test.js`).
- `-m unittest discover -s ml-service -p "test_*.py"` finds **0 tests** — `ml-service` needs
  `-t`/roots per suite as shown above, and `PYTHONPATH` must include `ml-service`.
- Jest needs the guard env vars from `.env.test`; it is not auto-loaded, and `NODE_ENV=test` alone
  still fails closed.

### 7.5 What remains unverified

- Docker image size effect of the xgboost change (engine not running — §7.3).
- `nvidia-nccl-cu12` absence inside a built image (same reason). The reasoning stands on code:
  `xgboost/collective.py` imports NCCL lazily inside `try/except ImportError`, `predict.py` is
  single-process CPU, and this venv has no `nvidia-*` package while all 33 tests pass.
- Azure anything — no subscription, resource, or workflow was touched.

