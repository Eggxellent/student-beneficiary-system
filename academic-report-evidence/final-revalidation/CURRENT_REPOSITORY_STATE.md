# CURRENT REPOSITORY STATE (revalidated)

> Generated 2026-11-03 01:20–01:30 +03:00 by direct inspection of the checkout, and **re-verified 2026-11-03
> 09:45–10:10 +03:00** by a second pass that re-executed the backend suite, the ML suite, the frontend build and the
> live probes (ledger in `SBMS_TEST_EVIDENCE_CATALOGUE.md` §1.1). This file supersedes every earlier statement of
> repository state in `docs/final-documentation-content/` (those were bound to `d6b5032`).

## 1. Identity

| Item | Value | How obtained |
| --- | --- | --- |
| Repository name | `student-beneficiary-system` | directory name |
| GitHub owner | `Eggxellent` | `git remote -v` → `https://github.com/Eggxellent/student-beneficiary-system.git` |
| Container registry path | `ghcr.io/eggxellent/sbms-api` | `az containerapp show` (image reference) |
| Current branch | `fix/sbms-completion-work` | `git status --branch` |
| Upstream state | `ahead 3` of `origin/fix/sbms-completion-work` | `git status --porcelain=v1 --branch` |
| HEAD commit | `cca06252062804b0026750b9bff87de3bd2caed5` (`cca0625`) | `git rev-parse HEAD` |
| HEAD commit date | `2026-11-03T00:02:26+03:00` | `git log -1 --date=iso-strict --pretty=format:%cd` |
| Unpushed commits | `a630a4f`, `6edb075`, `cca0625` | branch is ahead 3 |
| Working tree | clean except two untracked files (below) | `git status --porcelain` |
| Untracked files | `SBMS_O10_O11_IMPLEMENTATION_REPORT.md`, `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` | same |
| Uncommitted modifications | none | same |

Working directory contains sibling copies (`student-beneficiary-system-dev`, `sbms-raw-pair-model-training`, etc.).
**None of them is used as evidence.** Every claim in this package comes from `student-beneficiary-system` only.

## 2. Recent commits (newest first)

| Commit | Date | Subject |
| --- | --- | --- |
| `cca0625` | 2026-11-03 | docs(pdf): keep four PDFs instead of 28, prune duplicates on every run — **HEAD** |
| `6edb075` | 2026-11-02 | docs(final-documentation-content): render the documentation set to PDF |
| `a630a4f` | 2026-11-02 | docs(final-documentation-content): add nine-file handover set bound to d6b5032 |
| `d6b5032` | 2026-11-02 | chore(repo): drop generated logs, report PDFs and three superseded docs |
| `f3686ec` | 2026-11-01 | feat(certificates): issue QR-verifiable bursary certificates |
| `9fc14df` | 2026-11-01 | Record the registration identifier fields and their live evidence |
| `730a62e` | 2026-11-01 | Capture UPI and birth certificate number on the registration form |
| `b3f9c65` | 2026-11-01 | fix(duplicate-review): label the guardian contact row Guardian no: |
| `8c90aeb` | 2026-11-01 | fix(duplicate-review): keep the case dialog open and log the reveal verification |
| `a3714f8` | 2026-11-01 | fix(duplicate-review): reveal masked identifiers for admin verification — **this is the commit the live API runs** |

`f3686ec` is **not** an ancestor of `a3714f8` (`git merge-base --is-ancestor f3686ec a3714f8` → false), so the
certificate feature is absent from the running deployment. See `AZURE_DEPLOYMENT_VERIFICATION.md` §5.

## 3. Size of the implementation at HEAD

| Area | Count | Source |
| --- | --- | --- |
| Backend controllers | 14 | `backend/src/controllers/` (file count) |
| Route modules | 12 | `backend/src/routes/` |
| Services | 10 | `backend/src/services/` |
| Middleware | 8 | `backend/src/middleware/` |
| Forward migrations | 14 (+1 `.down.sql`) | `backend/src/db/migrations/` (15 files) |
| Tables required for readiness | 12 | `backend/src/services/databaseReadiness.js` |
| React pages | 14 | `frontend/src/pages/` |
| Shared components | 3 | `frontend/src/components/` |
| Backend test suites executed | 24 suites / **151 distinct tests, all 151 passing** (monolithic attempts: 150/151 in 111.5 s — the single failure was the Python bridge, see §1.1; grouped runs: 12 suites / 80 tests and 12 suites / 70 tests; the two tests that ever failed each pass when run alone) | `npx jest --runInBand tests`, 2026-11-03, pass 1 and pass 2 |
| Backend test files present | 34 | 24 `tests/*.test.js` + 8 `test/*.node*.js`/smoke + 2 setup helpers |
| ML tests executed | 5 files / 33 tests, OK | `ml-service/.venv` `python -m unittest discover -s tests -p "test_*.py"`, 2.4 s (pass 2) |
| Frontend build | exit 0, 2 006 modules, 13.02 s, `dist/assets/index-DMsnyNls.js` 707 195 B (gzip 171.40 kB), `dist/index.html` 423 B — the same byte length as the live SPA shell | `npm run build` in `frontend/`, pass 2 |
| Frontend automated tests | 0 | no `*.test.*` under `frontend/src` |
| ML Python modules / test files | 21 / 5 | `ml-service/*.py`, `ml-service/tests/` |

## 4. Documented-but-superseded state

`docs/final-documentation-content/` (27 markdown files, 4 rendered PDFs) is bound to commit `d6b5032` and, where it
describes deployment state, predates the Azure build. Those files remain valid as *content* evidence; their *state*
statements do not. Reconciliation is recorded in `FINAL_GAP_AND_AUTHOR_DECISION_REGISTER.md` §5.

## 5. What could not be inspected

| Item | Why | What would settle it |
| --- | --- | --- |
| GitHub pull requests | `gh` CLI is not installed on this host (`Get-Command gh` → not found); no PR metadata is in the clone | GitHub UI, or `gh` authenticated |
| CI run history | same; the only workflow is `workflow_dispatch` and leaves no artefact in the repo | Actions tab of the repository |
| Branch list beyond local/remote-tracking refs | only `fix/sbms-completion-work` is checked out locally; other branches were not enumerated in this pass | `git ls-remote --heads origin` |
