# SBMS — O10 and O11 implementation report

**Prepared:** 2026-10-31
**Repository:** `C:\Users\user\Desktop\Projects\student-beneficiary-system`
**Branch / base commit:** `fix/sbms-completion-work` @ `621f23f`
**Working tree before this task:** one untracked document,
`SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` (the review that raised O10 and O11). Nothing else was dirty.
**Outcome in one line:** O11 was a genuine defect and is fixed. O10 was **not** a defect — the
`field_officer`-only gate is the designed access policy — so **no permission was changed**; the policy is
now pinned by an explicit regression test instead.

---

## 1. Original problem

Both observations were recorded in `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` §9
(lines 299-300) as code observations, not as confirmed defects:

| ID | Observation as recorded |
| --- | --- |
| O10 | "All `/api/students` routes are `field_officer`-only, so an `admin` receives HTTP 403 when listing or reading students, even though admins own duplicate review and the dashboard" |
| O11 | "`POST /api/verify` is declared twice in the app: once to attach the rate limiter before body parsing (`index.js:57`) and once to attach the handler (`index.js:82`). It works only because Express continues to the later matching route" |

The task therefore required deciding, per observation, whether a defect exists, and fixing only what is
genuinely defective ("If an observation is not a genuine defect, do not manufacture a fix").

## 2. Root cause

### 2.1 O10 — the 403 is the designed policy, not a fault

The gate is one line, `backend/src/routes/students.routes.js:8`:

```js
router.use(authenticateToken, requireRole('field_officer'));
```

`requireRole` (`backend/src/middleware/requireRole.js:9-13`) answers 403 for any other role. Nothing is
misconfigured or unreachable: the restriction matches every consumer of the API. The premise behind the
observation — that admin users own duplicate review and the dashboard, therefore need student records —
does not hold, because each admin surface already gets the beneficiary data it displays from an endpoint
built for it:

| Admin surface | Endpoint it calls | Role gate | Student data it receives |
| --- | --- | --- | --- |
| `pages/AdminDashboard.jsx:19` | `GET /api/admin/dashboard` | `admin` (`adminDashboard.routes.js:8`) | aggregate counts |
| `pages/DuplicateReview.jsx:49` | `GET /api/duplicate-flags` | `admin` (`duplicateFlags.routes.js:9`) | both records' name, date of birth and school, with `guardian_id`, `upi`, `birth_certificate_number` and `national_id_number` masked by `maskIdentifier` (`controllers/duplicateFlags.controller.js:37, 106-107`) |
| `pages/Disbursements.jsx:52` | `GET /api/awards`, `/api/disbursements`, `/api/disbursements/exceptions` | `admin` + `field_officer` (`bursaryAwards.routes.js:8`, `disbursements.routes.js:10`) | joined student identity per award/payment |
| `pages/Reports.jsx:29` | `GET /api/reports/export` | `admin` (`reports.routes.js:11`) | aggregate report |
| `pages/Settings.jsx:12`, `pages/AuditLogs.jsx:26`, `pages/UserManagement.jsx:11` | `/api/settings/threshold`, `/api/audit-logs`, `/api/users` | `admin` | none |

No admin page calls `/api/students`. The single shared screen that touches it, `pages/Disbursements.jsx`,
deliberately requests it only for the other role:

```js
// frontend/src/pages/Disbursements.jsx:52-53
const requests = [api.get("/awards"), api.get("/disbursements"), api.get("/disbursements/exceptions")];
if (!isAdmin) requests.push(api.get("/students"));
```

That conditional is not cosmetic: it exists because the student picker feeds `POST /api/awards`, and
`backend/src/routes/bursaryAwards.routes.js:9` allows only `field_officer` to create an award. Granting
`admin` a student *read* would therefore not unlock any award workflow either.

The split is documented as intended behaviour, not merely inferred:

- `docs/azure-deployment-plan-2026-10-30.md:1066` — "Admin on a field-officer route (`GET /api/students`) | **403** — role separation is enforced server-side".
- `docs/user-guide.md:16` — admins use the dashboard and duplicate review; field officers use the field dashboard for registration and field operations.
- `frontend/src/App.jsx:64-78` — `/students` and `/students/register` are `allowedRoles={["field_officer"]}`; no admin route renders them.
- `backend/tests/students.test.js:67-85` and `backend/test/api.smoke.test.js:43` already assert the admin 403, so the behaviour was a stated expectation before this task.

**Root cause of the observation:** an inference that "admin owns review" implies "admin must read the raw
student record". The implementation instead gives the reviewer a purpose-built, identifier-masked queue and
keeps the full record with the role that captured it. Under the task's own rule — "Do not grant
administrators unnecessary permissions" — the correct action was to leave the policy alone.

### 2.2 O11 — a genuine defect: one endpoint registered as two overlapping routes

Before the fix, `backend/src/index.js` registered the path twice:

```js
app.post('/api/verify', verificationRateLimit);            // line 57, before body parsing
app.use(express.json({ limit: '100kb' }));                 // line 58
...
app.post('/api/verify', verificationController.verify);    // line 82, after body parsing
```

The duplication was not accidental: two requirements pull in opposite directions. The limiter must execute
**before** the body is parsed (a documented invariant — `docs/qr-verification-2026-10-30.md:18`:
"`/api/verify` is public, rate limited before body parsing"), while the handler needs a **parsed** body.
Express satisfied both only because a request continues past a matching route whose middleware calls
`next()` and then reaches the later route with the same path.

Why that is a defect rather than a style preference:

1. **The security control depended on line order.** Deleting line 57 (which reads as redundant, since the
   "real" handler is at line 82) would silently remove the rate limit; moving line 82 above line 58 would
   silently remove the parsed body and turn every verification into `{found:false}`.
2. **The coupling was invisible.** No router, route or test expressed "this path is rate limited", so only
   a reader who knew Express fall-through could tell the endpoint was protected. A 2026-10-31 cleanup
   (`docs/repository-cleanup-2026-10-31.md:171-174`) had to reason about these exact two line numbers,
   which is evidence that the shape misleads readers.
3. **Ownership of the path was split.** No single layer owned `POST /api/verify`: a new path-level
   `app.use('/api/verify', ...)` registered above line 57 would bypass the limiter, while one registered
   below it would make the limiter's own registration redundant — so the endpoint's protection depended on
   where an author happened to add code.

The fix had to keep three facts true at once: exactly one registration, the limiter still ahead of body
parsing, and the handler still receiving a parsed body. Because the two middlewares must sit on opposite
sides of the JSON parser, a single `app.post(...)` placed after the app-wide parser was rejected — it would
have moved the limiter behind parsing, contradicting the documented invariant and making throttled clients
pay for a 100 kB parse. Instead the endpoint now owns its own parser and declares all three stages in one
chain (see §6).

---

## 3. Files changed

| File | Change | Reason |
| --- | --- | --- |
| `backend/src/index.js` | +8 / -3 lines (one route removed, one chain + shared parser instance added) | O11 fix |
| `backend/tests/verificationRoute.test.js` | new file, 4 tests | O11 regression coverage (single registration, limiter ordering, size limit, response shape) |
| `backend/tests/roleAuthorization.test.js` | +34 lines, 1 test (`student routes stay field-officer-only while admin data paths keep working`) | O10 policy pinned for all four student routes, both roles and anonymous callers |
| `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` | §7.1 line references corrected; O10/O11 status cells and a short note added | keeps the audit document consistent with the fixed file; no finding text was rewritten |
| `SBMS_O10_O11_IMPLEMENTATION_REPORT.md` | new (this document) | deliverable |

`git diff --numstat` and `git status --porcelain` after the work (nothing else, no deletions):

```
8       3       backend/src/index.js
34      0       backend/tests/roleAuthorization.test.js
 M backend/src/index.js
 M backend/tests/roleAuthorization.test.js
?? SBMS_O10_O11_IMPLEMENTATION_REPORT.md
?? SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md     (untracked before this task)
?? backend/tests/verificationRoute.test.js
```

Not touched: any frontend file, `ml-service/`, `db/schema.sql`, migrations, `backend/.env*`,
`Dockerfile`, workflows, deployment configuration.

## 4. Exact corrections implemented

The complete source change, `git diff -- backend/src/index.js`:

```diff
@@ -54,8 +54,14 @@ if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
 }
 
-app.post('/api/verify', verificationRateLimit);
-app.use(express.json({ limit: '100kb' }));
+// The public QR verification endpoint is registered once, as a single chain: the rate limiter
+// must run before the body is parsed, while the handler needs a parsed body. Registering the
+// limiter as a separate route made the endpoint depend on Express matching the same path twice,
+// so a later edit could silently detach the limiter from the handler. The parser instance is
+// shared with the app-wide mount below; body-parser skips a body that is already parsed.
+const jsonBodyParser = express.json({ limit: '100kb' });
+app.post('/api/verify', verificationRateLimit, jsonBodyParser, verificationController.verify);
+app.use(jsonBodyParser);
 
 app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
@@ -79,7 +85,6 @@ app.get('/api/ready', async (req, res) => {
 app.use('/api/beneficiaries', beneficiariesRouter);
 app.use('/api/auth', authRouter);
 app.use('/api/audit-logs', auditRouter);
-app.post('/api/verify', verificationController.verify);
 app.use('/api/students', studentsRouter);
 app.use('/api/duplicate-flags', duplicateFlagsRouter);
 app.use('/api/disbursements', disbursementsRouter);
```

Current state of the region (`backend/src/index.js:57-64`):

```js
const jsonBodyParser = express.json({ limit: '100kb' });
app.post('/api/verify', verificationRateLimit, jsonBodyParser, verificationController.verify);
app.use(jsonBodyParser);
```

No controller, middleware, token, URL, or response change accompanies it: `verification.controller.js`,
`middleware/verificationRateLimit.js` and `config/publicAppUrl.js` are byte-identical to `621f23f`.

---

## 5. Permission decisions for O10

**Decision: no permission change.** `/api/students` stays `field_officer`-only; `students.routes.js`,
`requireRole.js`, the students controller and every other router are unmodified.

Options weighed:

| Option | Verdict | Reasoning |
| --- | --- | --- |
| Grant `admin` all `/api/students` routes | Rejected | Admin never registers students in any UI (`App.jsx:72-78` is field-officer-only), so `POST /api/students` for admins would add an unused write path with duplicate-screening side effects and audit noise. |
| Grant `admin` read-only (`GET /`, `GET /schools`, `GET /:id`) | Rejected | No admin screen consumes them (§2.1). It would also hand a second role the *unmasked* record set — the very identifiers the admin review queue deliberately masks (`duplicateFlags.controller.js:106-107`) — for no workflow gain. That is an unnecessary permission, which the task forbids. |
| Leave the gate as declared and pin it with tests | **Chosen** | The policy is documented (`azure-deployment-plan-2026-10-30.md:1066`) and already asserted twice, but only for `GET /` and `POST /`. Extending the assertions closes the gap without changing behaviour. |
| Split reads and writes by role (`admin` reads, `field_officer` writes) | Rejected | Invents a policy the system does not have; `GET /api/students` returns the full record set for every school, which is exactly what the field role needs and the reviewer role does not. |

The deciding test is not the 403 itself but what each role must be able to do. Administrators must review
duplicates, approve awards, record decisions and export reports — all reachable today (`/api/duplicate-flags`,
`/api/awards`, `/api/disbursements`, `/api/reports/export`, `/api/admin/dashboard`, `/api/users`,
`/api/settings/threshold`, `/api/audit-logs`). Field officers must register and read students and compute
eligibility — reachable through `/api/students` and `/api/eligibility`. Neither role is blocked from a task
it owns, so there is no 403 to "fix"; only a policy to record.

The regression test added at `backend/tests/roleAuthorization.test.js` (placed before the existing
role-mutation test, which temporarily promotes the officer account) asserts, against the real app:

1. anonymous callers get **401** on `GET /api/students`, `GET /api/students/schools`, `GET /api/students/:id`, `POST /api/students`;
2. an admin token gets **403** on all four (the route group is refused as a group, not route by route);
3. a field-officer token gets **200** with an array from `GET /api/students`, **200** containing `"Nairobi School"` from `GET /students/schools`, and **404** (not 403) for an absent but well-formed id — proving the officer reaches the handler;
4. the administrator's own beneficiary path still works (`GET /api/duplicate-flags` → **200**) in the same run, so the refusals are not a symptom of a broken admin session.

Revisit only if a product decision gives administrators a student-record screen; that change should then be
`GET`-only, audited, and paired with a masking decision.

## 6. Route and middleware changes for O11

One route, three stages, declared once:

| Stage | Middleware | Position | Why there |
| --- | --- | --- | --- |
| 1 | `verificationRateLimit` | inside the route chain | Always runs before the handler can be reached, and before any body is read. |
| 2 | `jsonBodyParser` (`express.json({ limit: '100kb' })`) | inside the route chain, after the limiter | Gives the handler a parsed body while keeping parsing behind the limiter. |
| 3 | `verificationController.verify` | last | The endpoint's only handler. |

`app.use(jsonBodyParser)` immediately afterwards installs the same parser instance app-wide, so every other
route keeps the previous 100 kB JSON behaviour. Re-parsing is impossible: body-parser returns early when
`req._body` is already set (`backend/node_modules/body-parser/lib/types/json.js:106-107`, "body already
parsed"), which the suite also proves indirectly — the verification suite still receives the token.

Behaviour is unchanged in every case; the table records what was verified:

| Request | Before | After | Covered by |
| --- | --- | --- | --- |
| `POST /api/verify {token:<valid>}`, budget available | `200 {"found":true}` | same | `verification.test.js` |
| `POST /api/verify` unknown or malformed token | `200 {"found":false}` | same | `verification.test.js` |
| Extra body fields / empty body | `200 {"found":false}` | same | `verification.test.js` |
| `POST` after the 10-request budget | `429 {"message":"Too many requests. Try again later."}` | same | `verification.test.js`, `verificationRoute.test.js`, live run |
| `POST` with a >100 kB body, budget available | `413 {"message":"Request body is too large"}` | same | `securityMiddleware.test.js` (login path), `verificationRoute.test.js` (verify path) |
| `POST` with a >100 kB body, budget **exhausted** | `429` (limiter first) | same | `verificationRoute.test.js`, live run |
| `GET /api/verify` | `404` | same | `verificationRoute.test.js` |
| `POST /api/verify` with a non-JSON content type | `200 {"found":false}` | same | controller shape check, unchanged |
| QR image/URL and token format | `.../verify#token=<64 lowercase hex>` | same | `verification.test.js` (token pattern + QR payload) |

Security consequences: the limiter can no longer be detached from the handler by editing a second
registration, and it still runs before parsing, so a throttled client cannot force a 100 kB parse. No token
expiry, revocation or regeneration was added, per the task's exclusion; O6 in the review remains open.

---

## 7. Tests executed and their actual results

Every command below was executed in this session. Backend runs used the repository's documented recipe
(load `backend/.env.test` into the process, then run Jest, per `docs/SBMS_PROJECT_HANDOVER_2026-10.md:731-740`);
the values were read from that file and are not reproduced here.

| # | Check | Command | Actual result |
| --- | --- | --- | --- |
| 1 | Backend authorization + verification tests (focused) | `npx jest --runInBand tests/verificationRoute.test.js tests/verification.test.js tests/roleAuthorization.test.js` | **PASS** — 3/3 suites, 20/20 tests, exit 0 (20.53 s; re-run against the final test content: same 3/3 and 20/20, exit 0, 17.78 s) |
| 2 | Complete backend suite | `npx jest --runInBand tests` | **PASS** — 22/22 suites, 133/133 tests, exit 0, 87.14 s. Re-run after the last test edit (§7 note): again **22/22 suites, 133/133 tests, exit 0**, 101.53 s |
| 3 | Baseline for comparison | `npm test` recorded at `docs/FINAL_TEST_REPORT.md:22` | 21 suites / 128 tests. Delta after this work: **+1 suite, +5 tests** (4 in the new file, 1 added to `roleAuthorization.test.js`) — no test was removed, skipped or weakened |
| 4 | Live boot of the API | `node src/index.js` on port 5055 with `DATABASE_URL` = local `sbms_test`, `SBMS_EXPECTED_DATABASE_NAME=sbms_test` | stdout `Server running on port 5055` only, stderr empty, `GET /api/ready` → `{"status":"ready"}` |
| 5 | Live rate limit | 10 × `POST /api/verify {"token":"x"}` | `200,200,200,200,200,200,200,200,200,200`, then the 11th → **429** |
| 6 | Live limiter-before-parse | One 101 kB `POST /api/verify` after the budget was spent | **429** (not 413) — proves the limiter runs before the parser in a real process |
| 7 | Native API smoke test | `node --test test/api.smoke.test.js` with `API_URL=http://localhost:5055` | **PASS** — 3/3 tests, 0 failures, exit 0, 1.60 s. Test 2 asserts an admin reaches `/api/disbursements` and `/api/duplicate-flags` (200) while `/api/students` and `/api/eligibility` return 403 — O10's policy, confirmed at runtime |
| 8 | Frontend production build | `npm.cmd --prefix frontend run build` | **PASS** — exit 0, 2002 modules, `index-30W2wVt3.js` 335.96 kB (gzip 101.48 kB), `index-DxfCSphb.css` 39.86 kB, 9.47 s |

Notes on the output, so nothing is over-read:

- The Jest console block contains `Request failed` and `Admin login failed` lines. These are the expected
  logs from tests that deliberately provoke a 413, malformed JSON and failed sign-ins; the existing
  `securityMiddleware.test.js` produces the same output. No test logged an unexpected error.
- Jest prints "Jest did not exit one second after the test run has completed". This is the pooled database
  connection left open by `tests/verification.test.js`, whose `afterAll` deletes its rows but never calls
  `pool.end()`. The new suite is database-free (every request it makes is answered by the limiter, the
  parser or the token-shape check before any query), so it cannot contribute to that handle. The notice was
  not suppressed and no test was changed to hide it.
- No test fails, and no existing assertion was edited: the only change inside an existing suite is the
  added test in `roleAuthorization.test.js`.

## 8. Build and lint results

| Check | Result |
| --- | --- |
| Frontend production build | **PASS** — exit 0, 2002 modules, 9.47 s (`index.js` 335.96 kB / gzip 101.48 kB, `index.css` 39.86 kB / gzip 8.71 kB) |
| Backend build step | Not applicable — the API is plain CommonJS started with `node src/index.js`; the live boot in §7 rows 4-6 is the equivalent check, and it succeeded |
| Backend lint | Not applicable — no linter is configured. `backend/package.json` and `frontend/package.json` declare no `lint` script and no `eslint` dependency, and no `.eslintrc*`, `eslint.config.*` or `eslintConfig` exists anywhere in the repository. No lint tooling was added, because introducing a new dependency is outside "minimal, targeted changes" |
| ML service | Not run and not affected — no file under `ml-service/` was touched |

## 9. Remaining limitations

1. **O10 is a decision, not a capability change.** Administrators still cannot read the raw student record,
   by design. If a supervisor requires it, that is a new product decision (see §5) and should be shipped as a
   deliberate, audited, `GET`-only widening — not as a side effect of this report.
2. **Field-officer listing is unscoped.** `GET /api/students` returns every student regardless of school,
   district or assignment. That is the existing design (`student.model.getAll()`), it was not changed, and the
   review's D-questions about geographical scope remain open.
3. **QR tokens still never expire.** No expiry, revocation or regeneration was introduced, as instructed. The
   review's O6 therefore stays open, and possession of a valid token still only proves that a record exists.
4. **The verification limiter is per-process.** Counters live in memory (`middleware/verificationRateLimit.js`),
   so with more than one API instance the effective budget multiplies. Review O7 stays open; the fix is a
   shared store, which is infrastructure work outside this task.
5. **Rejected requests consume budget.** A throttled caller's oversized or malformed request is counted by the
   limiter (it is rejected before parsing). This is intentional and unchanged, but it means the budget measures
   requests, not successful verifications.
6. **The endpoint is still public and unauthenticated.** That is required by the QR flow; no authentication or
   CSRF mechanism was added, and CORS/origin checks are unchanged.
7. **Sibling working copies are untouched.** `student-beneficiary-system-dev` and
   `student-beneficiary-system-admin-login-fix` under the same `Projects` directory still contain the old
   two-line registration. They are separate trees outside this repository, so the fix was not propagated to
   them; doing so would be a separate, deliberate change.
8. **The audit document keeps its pre-fix citations.** `SBMS_PHASE_2_SUPERVISOR_FINDINGS_REVIEW.md` rows O10
   and O11 quote the old line numbers as the snapshot they were written from; status annotations and a note now
   point at the current wiring in this report. §7.1's references were corrected in place.
9. **Scope of the runtime evidence.** All live checks ran against the local `sbms_test` database and a local
   process on port 5055. The deployed instance was deliberately not exercised.

## 10. Confirmation that production was not modified

- **No deployment** was performed, and no request was sent to the Azure Container App or the static web app.
- **No commit and no push.** The work is in the working tree only; `git status` lists exactly the five files in
  §3, with no deletions and no changes to tracked files other than `backend/src/index.js` and
  `backend/tests/roleAuthorization.test.js`.
- **No database schema, migration, or data change.** No `.sql` file was edited, `npm run migrate` was not run,
  and no migration was authored. The only database used was the local, disposable `sbms_test`.
- **No production configuration change.** `backend/.env`, `backend/.env.test`, `.env.example`, environment
  variables in any deployment, `Dockerfile`, and the GitHub workflows are byte-identical to `621f23f`.
- **No ML change.** No model, threshold, feature code or artefact under `ml-service/` was touched.
- **No frontend change.** The production bundle rebuilt from the untouched sources and matched the sizes
  recorded in `docs/repository-cleanup-2026-10-31.md:238` (335.96 kB JavaScript, 39.81 → 39.86 kB CSS).
- **Phase 1 behaviour preserved.** The complete backend suite (22 suites / 133 tests) and the live smoke test
  (3/3) pass, including the admin/field-officer separation the deployment relies on.






