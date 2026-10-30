# SBMS final test report

**Date:** 2026-10-27
**Checkout:** `experiment/febrl-record-linkage` at `22435ecf11080a18003211a3d1bcb979d6c0e00b`
Only local tests/builds were run. No production DB connection or application process was started.

| Check | Result | Command / evidence |
|---|---|---|
| Readiness helper tests | **PASS — 6/6** | `node --test backend/test/databaseReadiness.node.js`; fake query only, no DB connection. |
| Native backend test group | **PASS — 15/15** | `node --test backend/test/databaseReadiness.node.js backend/test/jwtSecret.validation.node.cjs backend/test/migrate.unit.test.js`; these exercise helper logic and migration target/inventory guards, not a database. |
| QR verification native tests | **BLOCKED** | `node --test backend/test/verification.unit.test.js`; test loader failed with `Cannot find module 'qrcode'`. No dependency was installed. |
| Production ML Python suite | **PASS — 10/10** | `& '.\ml-service\.venv\Scripts\python.exe' -m unittest discover -s ml-service/tests -v` |
| Research-helper tests | **PASS — 7/7** | `& '.\ml-service\.venv\Scripts\python.exe' -m unittest discover -s ml-service/experiments/sbms_dataset -p test_experiment.py -q` |
| Frontend production build | **PASS** | `npm.cmd --prefix frontend run build`; Vite completed (2,002 modules). |
| Readiness helper syntax | **PASS** | `node --check backend/src/services/databaseReadiness.js` (exit 0). |
| API entrypoint syntax | **PASS** | `node --check backend/src/index.js` (exit 0). |
| Frontend output scan | **PASS, narrow scope** | Scanned `frontend/dist` for `DATABASE_URL`, `JWT_SECRET`, `xgb_duplicate_model`, `sbms_dataset_xgb_research_only`, and `joblib`; all four file-level search results were `False` (no matches). |
| Backend Jest suites | **BLOCKED** | `npm.cmd --prefix backend test -- --runInBand` previously exited 1, `'jest' is not recognized`. `backend/node_modules` exists but its Jest executable is absent. No dependencies installed. |
| Installed backend native unit suites | **PASS — 15/15** | Re-run on this continuation: `node --test backend/test/databaseReadiness.node.js backend/test/jwtSecret.validation.node.cjs backend/test/migrate.unit.test.js` (exit 0). |
| QR native unit suite | **BLOCKED** | Re-run on this continuation: `node --test backend/test/verification.unit.test.js` (exit 1), missing module `qrcode`; not installed. |
| Backend DB integration/smoke suite | **NOT RUN** | Jest unavailable; repository Jest setup also preserves `tests/testDatabaseGuard.js`. No database credentials or target changes attempted. |
| Pytest command | **BLOCKED** | `python -m pytest ml-service/tests -q`; exit 1 because pytest is not installed. Equivalent unittest suite passed above. No package installed. |
| Local isolated backup restore | **BLOCKED** | Read-only `psql` connection to local `127.0.0.1`/`postgres` failed: `fe_sendauth: no password supplied`; no temporary database created. No credential was printed or requested in chat. |
| Backup catalog / temp-name safety check | **PASS / BLOCKED** | `pg_restore --list C:\Users\user\Desktop\sbms_local_backup.dump` exited 0; 44 TOC entries, not displayed. A read-only `psql` lookup for candidate `sbms_restore_verify_20261027_03` failed with `fe_sendauth: no password supplied`, so whether the name exists is unknown; it was not created. |
| Backup data payload readability | **PASS** | `pg_restore --data-only --file=NUL C:\Users\user\Desktop\sbms_local_backup.dump` exited 0; payload was decompressed and discarded, without creating an extracted file. This is not a database restore. |
| Docker image build/runtime | **BLOCKED** | `docker info --format '{{.ServerVersion}}'`; exit 1, Docker engine named pipe unavailable and CLI config access denied. No build or image run occurred. |
| Render Blueprint syntax/spec validation | **BLOCKED / static review only** | `python -c "import yaml; yaml.safe_load(open('render.yaml', encoding='utf-8'))"` exited 1 because PyYAML is unavailable; Render CLI is not installed. The file was compared with Render's published Blueprint reference, but there was no parser/Blueprint validation or Render sync. |
| Hosted API/Render smoke tests | **NOT RUN** | No Render management access/action authorized or used; no production login attempt. |
| Full frontend tests, lint, all Jest suites, full end-to-end workflows | **NOT RUN** | Not established as configured/runnable in this environment. |

The frontend build and Python tests do not verify production readiness, API/database compatibility, model performance, hosted behavior, or admin login. No test was claimed passed if it did not run.

The first sandboxed repeat of the Node test command was blocked before tests loaded by Windows `EPERM` while Node tried to resolve `C:\Users\user`. The exact same test and syntax commands were then rerun in the authorized local execution context and passed as listed above. This was an execution-environment restriction, not a test failure.
