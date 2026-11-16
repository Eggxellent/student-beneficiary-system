# Phase 3 review — application duplicate cases

Review before any further migration is applied. It records the three decisions taken for Phase 3,
the evidence each decision rests on, the queries it touches, and the rollback for every statement.

| Item | State |
| --- | --- |
| `20261116_student_applications.sql` | applied to local guarded `sbms_test` only |
| `20261116_application_duplicate_cases.sql` | applied to local guarded `sbms_test` only |
| `20261116_application_submission_guard.sql` (§2.5, §4.2) | **written and applied to local guarded `sbms_test` only** (`down` script committed); code changes in the same commit |
| Azure / production database | not touched |
| Production model, thresholds, `ml-service` | not touched |

Evidence in this document is from the canonical repository `student-beneficiary-system/`.

## 1. Decision 1 — model scores stay advisory (accepted, no code change)

The screening pipeline is the registration pipeline, unchanged. Nothing in the guardian-led work
promotes a score into a decision, and no threshold or model artefact was modified.

| Invariant | Where it holds |
| --- | --- |
| Case selection is policy, not score | `services/duplicateAggregation.js:52` default `top-1-corroborated`; `:142-155` returns one best candidate or none; `top-1-corroborated` also requires an exact identifier or two corroborating fields (`:147-153`) |
| `selectFlaggedCandidates` and `summarizeAggregation` are the same functions registration uses | `services/applicationScreening.js:83-84`; `controllers/students.controller.js:93-100` |
| Screening writes only `screening_*` columns and `status = 'screened'` | `services/applicationScreening.js:111-136`; never a terminal status (`db/migrations/20261116_student_applications.sql:55-58`) |
| A score never closes, merges or rejects anything | `controllers/applications.controller.js:546-596` gates on role and an explicit `override_reason`; `duplicate_of_student_id` is written only by the administrator's resolve (`:499-502`) |
| The priority band is a label | `services/applicationScreening.js:169-177` wraps `reviewPriority`; thresholds stay `DUPLICATE_HIGH_PRIORITY_THRESHOLD` 0.70 / `ML_REVIEW_SCORE_THRESHOLD` 0.50 (`config/settings.js:6-8`), unchanged |
| "Not screened" is never shown as "screened clean" | `services/applicationScreening.js:64-73` sets `DUPLICATE_SCREENING_UNAVAILABLE`; `controllers/applications.controller.js:159-177` commits the submission and reports the gap |
| No automatic retraining or threshold tuning | `top-1` and `all` remain selectable for comparison; no code path writes `review_threshold` from observed outcomes |

Consequence to keep: the queue accumulates only *decisive* cases, so a near-miss pair is **not**
reviewed. That is the documented trade-off (`services/duplicateAggregation.js:3-48`) and is why
§2.7 exists — the model is not the last line of defence against a duplicate student.

## 2. Decision 2 — concurrent submission race (narrow safeguard proposed)

### 2.1 The window

`controllers/applications.controller.js`:

1. `:99-111` reads for a same-child submission in the last 24 hours with `pool.query` — a bare pool
   query, so this statement commits immediately and holds no lock.
2. `:116-150` opens a **separate** transaction and inserts the application.

Between the read and the `COMMIT` there is no lock on anything. Two requests with the same
`(guardian_phone, lower(full_name), date_of_birth)` both read zero rows and both insert. The only
uniqueness on the table is `tracking_code_hash` (`20261116_student_applications.sql:18`), which is
freshly generated per request, so both inserts succeed.

### 2.2 Why the existing indexes do not close it

| Index | Why it does not apply |
| --- | --- |
| `duplicate_flags_application_pair_unique (application_id, matched_student_id) WHERE application_id IS NOT NULL` | keyed *per application*; two different applications never share a key |
| `duplicate_flags_unordered_pair_unique … WHERE application_id IS NULL` | registration cases only |
| `student_applications_verified_student_idx` | non-unique, and written only at verification |

The two unique indexes do what they claim — they make **re-screening** idempotent. They were never
meant to make **submission** idempotent, and they cannot.

### 2.3 What actually goes wrong

| Step | Result |
| --- | --- |
| Both submissions persist, both screened | if the child is not yet in `students`, `services/applicationScreening.js:104-106` finds an empty register, so neither application opens a case and both sit at `screened` |
| Two officers verify both applications | `controllers/applications.controller.js:599-608` calls `studentModel.create` for each |
| The verify gate sees nothing | `:574-580` looks only at cases with `f.application_id = <this application>`; `:566` looks only at `duplicate_of_student_id`. Neither can see the *other* application |
| Outcome | two `students` rows for one child — the exact outcome the workflow exists to prevent |

This is not only a race. A second application submitted **after** 24 hours hits the same path: its
screening ran against a register that predates the first verification, so it opens no case either.
The race makes the window trivial to hit; the missing namespace check at verification (§2.7) is what
turns it into a duplicate student.

### 2.4 Options considered

| Option | Verdict |
| --- | --- |
| Per-key advisory transaction lock, pre-check moved inside the submitting transaction | **chosen** (§2.5): serialises only the same guardian/child key; no permanent block; no new failure mode for other guardians |
| Table-wide `FOR UPDATE` / `LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` | rejected: `POST /api/applications` is public, so one lock held across every insert queues all submissions behind it — a denial-of-service amplifier. A `FOR UPDATE` with no matching row also locks nothing, so the table-wide variant only "works" by serialising everything |
| Unique index on the submission key | rejected: a unique index cannot express a rolling 24-hour window. A permanent key would refuse a legitimate resubmission after a rejection; a calendar-day variant needs a generated column, changes the documented rule (`docs/guardian-led-workflow.md` §7), and still needs a `23505` → `409` mapping |
| `SERIALIZABLE` for the submit transaction | rejected: no constraint to detect, so it only yields serialisation failures under load; the pre-check would still have to move inside the transaction |

### 2.5 Chosen safeguard (code + one additive index)

Inside the existing submit transaction, before the 24-hour pre-check:

```sql
SELECT pg_advisory_xact_lock(hashtext('sbms.application.submission:' ||
  $1 || '|' || lower(btrim($2)) || '|' || $3))
```

`$1 = guardian_phone`, `$2 = full_name`, `$3 = date_of_birth` — the same triple the pre-check uses
(`controllers/applications.controller.js:99-105`). Properties:

- The lock is transaction-scoped, so `COMMIT`/`ROLLBACK` always releases it — no leak on the error
  paths at `:151-157`.
- The pre-check must execute **after** the lock and **inside** the same transaction; that is the
  whole fix. Under `READ COMMITTED` (the pool default) the second request's read starts after it
  acquires the lock, so it observes the first request's committed row and answers `409
  APPLICATION_ALREADY_SUBMITTED`.
- Scope is one key, not the table: unrelated guardians hash to different keys and never queue.
  `hashtext` is a 32-bit hash, so a collision merely serialises two unrelated submissions for the
  duration of a small insert — the same call pattern already used at `applications.controller.js:553`
  and `scripts/migrate.js:196`.
- The screening call stays in its own transaction (`:159-177`), so no lock is held while the Python
  bridge runs.
- Cost: one additional round trip per submission; queueing happens only when two submissions share a
  key, and the lock is held for a single insert plus its audit row, never across the predictor call.

Supporting index, because this pre-check now runs on the public path:

```sql
CREATE INDEX IF NOT EXISTS student_applications_guardian_child_idx
  ON student_applications (guardian_phone, date_of_birth, lower(full_name));
```

### 2.6 Residual risk (accepted, documented)

| Residual | Why it stays |
| --- | --- |
| The same child keyed differently (`0712…` vs `+254712…`, a transliterated name) still inserts twice | phone normalisation is a data-quality task, not a lock; tightening it changes accepted input |
| A second application on day 2 is still allowed | the 24-hour rule is a product rule (`docs/guardian-led-workflow.md` §7); blocking it needs a business decision |
| Two applications already in the table before the fix | the lock prevents new collisions; existing rows are not merged by a migration |

### 2.7 Separate finding — verification has no namespace check (Gap P3-2)

`verify` creates a student without asking whether an equivalent student already exists:
`controllers/applications.controller.js:599-608` calls `studentModel.create` directly, and
`controllers/students.controller.js:93-109` (where screening inserts registration flags) is **not**
on this path. So §2.6's residuals still end in a duplicate `students` row.

Proposed narrow fix, not implemented (needs approval, no migration):

1. Inside the `verify` transaction, after `lockApplication`, look for an existing student with the
   same `birth_certificate_number` or `upi` (exact), or the same `(lower(full_name), date_of_birth,
   school_code)`.
2. If one exists and is not already the `verified_student_id` of another application, return `409
   DUPLICATE_STUDENT_EXISTS` with that record's reference; allow an administrator override with a
   written reason, reusing the existing override shape at `:582-595`.

This is a check, not a model change, and it is the only place where the "one child, one record"
invariant can be enforced deterministically.

## 3. Decision 3 — `duplicate_flags.student_id` stays NULLable, cases link via `application_id`

The requirement was to prefer linking application cases to `student_applications` "unless a real
technical reason exists" for a nullable `student_id`. Both hold, and they are the same fact from two
sides: the case **is** linked by `application_id`
(`20261116_application_duplicate_cases.sql:8-9`), and `student_id` is NULL **because** that link
exists. It is not an alternative to the link.

### 3.1 Why NOT NULL cannot be kept

| Workaround for NOT NULL | Consequence |
| --- | --- |
| Create the student at submission so the case has a subject | inverts the workflow's central rule: a `students` row is the *verified* record (`20261116_student_applications.sql:3-5`), and `student_applications_verified_consistent_check` (`:71-75`) requires verification state before that row can be legitimate. A rejected application would leave a student behind |
| Store the **matched** student in `student_id` as well | silently redefines the column. Every reader treats `student_id` as *the subject of the case*, so an application case would look like a student-pair case in which the subject duplicates itself: `bursaryAwards.controller.js:89,134,355` would block the matched student's awards with the matched student on both sides, and `duplicate_flags_unordered_pair_unique` would key it as `(matched, matched)` — the exact collision the partial index at `:20-22` was introduced to avoid |
| Keep `student_id` and add `application_id` as an optional annotation | makes the same row ambiguous, and `duplicate_review_events`/`duplicate_resolutions` would attach student-pair decisions to application cases, which `duplicate_resolutions.canonical_student_id` / `duplicate_student_id` cannot represent |

So NULLable is the minimal change that keeps every existing meaning intact. The stated preference is
satisfied: the new rows are linked to `student_applications`, and `student_id` is NULL rather than
repurposed.

### 3.2 Compensation so NULL is not a hole

| Rule | Effect |
| --- | --- |
| `duplicate_flags_case_subject_check (student_id IS NOT NULL OR application_id IS NOT NULL)` (`:31-33`) | no orphan case: a row must describe either a student or an application |
| `duplicate_flags_application_pair_unique (application_id, matched_student_id) WHERE application_id IS NOT NULL` (`:38-40`) | one case per application/student pair; re-screening cannot double it |
| `duplicate_flags_application_idx` (`:42-44`) | per-application lookups in `applications.controller.js:227,252,364,417,482,575` stay index-backed |
| `application_id … ON DELETE CASCADE` (`:8-9`) | deleting an application removes its cases, exactly as registration cases follow `students` |
| `duplicate_flags_unordered_pair_unique … WHERE application_id IS NULL` (`:20-22`) | registration keeps its original guarantee |

### 3.3 Proposed tightening (needs approval)

`duplicate_flags_case_subject_check` allows a row to carry **both** `student_id` and
`application_id`. Nothing writes that today, but a future writer could, and such a row would re-enter
the registration pair index as `(student, matched)`, mixing the two case kinds.

```sql
ALTER TABLE duplicate_flags
  ADD CONSTRAINT duplicate_flags_case_kind_check
  CHECK (application_id IS NULL OR student_id IS NULL);
```

Additive, satisfied by every row currently in `sbms_test`, and it encodes "a case is about a student
or about an application, never both". It belongs in the same new migration as §2.5.

### 3.4 Every reader of `duplicate_flags`, and what NULL means for it

| Location | Predicate | Impact of `student_id = NULL` |
| --- | --- | --- |
| `applications.controller.js:227,252,364,417,482,511,575` | `f.application_id = …` | unaffected — these are the application's own views |
| `bursaryAwards.controller.js:86-95` | `f.student_id = X OR f.matched_student_id = X OR the application that produced X` | **behaviour change**: an open application case counts against the verified student's award. Implemented with `EXISTS (student_applications sa WHERE sa.id = f.application_id AND sa.verified_student_id = X)`, so a case whose subject is an application is not invisible to the award list |
| `bursaryAwards.controller.js:135-143` | latest case for the student, same three-way predicate | an application case can now be the case shown on that award; `resolution_*` stays empty because `duplicate_resolutions` is student-pair only |
| `bursaryAwards.controller.js:352-379` | approval gate + application-case override with written reason | unaffected by NULL; the explicit override is the documented escape hatch |
| `adminDashboard.controller.js:32` | count by status, no join | counts application cases too; the label stays true, but see P3-3 |
| `reports.controller.js:32-38` | count by status and date | same as above |
| `duplicateFlags.controller.js:335-337` | staff queue, **INNER JOIN** `students s1 ON df.student_id = s1.id` | application cases are invisible in the staff queue — see P3-3 |
| `duplicateFlags.controller.js:431-434` | case detail, same INNER JOIN | `GET /api/duplicate-flags/:id` answers `404` for an application case — see P3-4 |
| `duplicateFlags.controller.js:553-579` | legacy resolve | fails safe, never a write: `pair = [NULL, matched]`, so any canonical id other than the matched student is refused `400` at `:564`; naming the matched student passes `:564` but the `students` lookup returns one row and `:576-579` refuses with `409`. No `duplicate_resolutions` row is inserted in either case |
| `duplicateFlags.controller.js:205` | `SELECT student_id, matched_student_id` for pair dedupe | yields a `null:<uuid>` key that can never match a real pair; harmless, but the intent should be explicit |
| `duplicateFlags.controller.js:241`, `students.controller.js:104` | inserts that supply `student_id` | unaffected — both pass a real student id |
| `services/applicationScreening.js:141-147` | insert with `application_id` | unaffected; `ON CONFLICT DO NOTHING` still resolves on the application pair index |

### 3.5 Consequences found while doing the inventory

| Id | Finding | Recommended fix (not implemented) |
| --- | --- | --- |
| P3-3 | The staff queue uses an INNER JOIN on `df.student_id`, so application cases are absent from the list while the dashboard count (`adminDashboard.controller.js:32`) and the report (`reports.controller.js:34`) include them: count and list disagree | add `WHERE df.application_id IS NULL` to the queue query so the split is stated in code, or `LEFT JOIN` and render the application as the first party. Prefer the explicit filter plus a link to `/api/applications` |
| P3-4 | `GET /api/duplicate-flags/:id` returns `404` for an application case, which reads as "case gone" rather than "wrong queue" | return `409 APPLICATION_CASE` with the `/api/applications/:id` reference, or widen the join |
| P3-5 | Legacy resolve can be pointed at an application case and answers `400` or `409` depending on which student is named | acceptable (fails safe, no write); a guard on `flag.application_id` would give a clearer message |

## 4. Migration impact

### 4.1 How this runner behaves (constraints on anything new)

| Property | Consequence |
| --- | --- |
| Explicit `MIGRATION_ORDER`, and the inventory must match exactly (`scripts/migrate.js:9-31,54-67`) | a new file must be added to `MIGRATION_ORDER` in the same commit, or `migrate apply` refuses to run |
| One transaction per file, runner-owned (`:176-191`) | `BEGIN`/`COMMIT` inside a migration file is rejected (`:178-180`), and `CREATE INDEX CONCURRENTLY` cannot be used — plain `CREATE INDEX` + `IF NOT EXISTS` is the house style |
| Ledger `sbms_schema_migrations`, applied by name (`:184`) | re-running is a no-op; partial failure rolls the file back entirely |
| Target guard: loopback `sbms_test` as `sbms_test_runner`, nothing else (`:37-52`) | the migrations in this review cannot reach Azure even if the command is run by mistake |
| Advisory lock on `hashtext('sbms.schema.migrations')` (`:196`) | two concurrent migration runs cannot interleave |

### 4.2 `20261116_application_submission_guard.sql` (written and applied to `sbms_test`)

```sql
-- Submission race guard: index for the 24-hour same-child pre-check.
CREATE INDEX IF NOT EXISTS student_applications_guardian_child_idx
  ON student_applications (guardian_phone, date_of_birth, lower(full_name));

-- A case describes a student or an application, never both.
ALTER TABLE duplicate_flags
  ADD CONSTRAINT duplicate_flags_case_kind_check
  CHECK (application_id IS NULL OR student_id IS NULL);
```

Nothing else is needed: the advisory lock is runtime, not schema. The same commit
(a) adds the file to `MIGRATION_ORDER` after `20261116_application_duplicate_cases.sql`,
(b) moves the pre-check inside the submit transaction behind the lock, and
(c) adds the concurrency tests described in §5. All three landed together, so the tree never ships a
lock without the pre-check it protects, or the pre-check without the index that serves it.

Compatibility in both directions: the index is invisible to readers; the CHECK rejects only rows that
do not exist. Code that still reads before the lock keeps working — it is simply still racy — so the
migration can be applied before or after the code change without a broken window.

### 4.3 Rollback

Neither `20261116_*` migration has a `.down.sql` (only `20261022_ml_duplicate_provenance.down.sql`
exists), and the runner ignores `*.down.sql` files when computing the inventory
(`scripts/migrate.js:56`), so a down script can be committed safely. Order matters.

`20261116_application_duplicate_cases.down.sql` — run only with the application endpoints disabled:

```sql
DELETE FROM duplicate_flags WHERE application_id IS NOT NULL;   -- cascades duplicate_review_events
DROP INDEX IF EXISTS duplicate_flags_application_idx;
DROP INDEX IF EXISTS duplicate_flags_application_pair_unique;
DROP INDEX IF EXISTS duplicate_flags_unordered_pair_unique;
CREATE UNIQUE INDEX duplicate_flags_unordered_pair_unique
  ON duplicate_flags (LEAST(student_id, matched_student_id), GREATEST(student_id, matched_student_id));
ALTER TABLE duplicate_flags DROP CONSTRAINT IF EXISTS duplicate_flags_case_subject_check;
ALTER TABLE duplicate_flags ALTER COLUMN student_id SET NOT NULL;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS application_id;
DROP INDEX IF EXISTS duplicate_review_events_flag_stage_created_idx;
ALTER TABLE duplicate_review_events DROP CONSTRAINT IF EXISTS duplicate_review_events_stage_check;
ALTER TABLE duplicate_review_events DROP COLUMN IF EXISTS stage;
```

| Loss | Mitigation |
| --- | --- |
| Application cases and their `duplicate_review_events` rows | unavoidable: the column that identifies them is the column being dropped. `student_applications.decision_reason` and `audit_logs` (`APPLICATION_SCREENED`, `APPLICATION_RESOLVED`) keep the human trail |
| Applications left in `needs_investigation`/`resolved` with no case rows behind them | reset them (`status = 'screened'`) or keep the routes disabled, otherwise `verify` would run with no open-case gate at all |
| `students` rows created by verification | kept on purpose — those are real, verified records; the down script does not touch `students` |

`20261116_student_applications.down.sql` — only after the migration above is rolled back:

```sql
DROP TRIGGER IF EXISTS student_applications_payload_immutable ON student_applications;
DROP FUNCTION IF EXISTS sbms_reject_application_payload_change();
DROP TABLE IF EXISTS student_applications;
```

`20261116_application_submission_guard.down.sql` (if approved):

```sql
DROP INDEX IF EXISTS student_applications_guardian_child_idx;
ALTER TABLE duplicate_flags DROP CONSTRAINT IF EXISTS duplicate_flags_case_kind_check;
```

Its code half is two lines in `submit`; removing them restores today's behaviour exactly, with no data
loss.

## 5. Verification

Run from `backend/` with the guarded environment (`NODE_ENV=test`, `DATABASE_URL` and
`SBMS_TEST_DATABASE_URL` both the loopback `sbms_test` URL for `sbms_test_runner`), otherwise the
guard aborts every suite before a single test runs (`tests/testDatabaseGuard.js:5-16`).

| Run | Result (2026-11-16) |
| --- | --- |
| `npx jest --runInBand tests` (before Phase 3) | 275 tests passed in 36 suites |
| `npx jest --runInBand tests` (Phase 3 tree) | **286 tests passed in 38 suites**, 0 failed |
| `npx jest --runInBand` on the four touched suites | 23 tests passed |
| `.\.venv\Scripts\python.exe -m unittest discover -s tests` in `ml-service` | 33 tests passed, 1.0 s |

Non-regression note: `npx jest` without the `tests` argument also picks up the six `test/*.test.js`
files that belong to `node:test` (`npm run test:smoke`); under Jest they report as failed suites at
suite level with zero failing tests. That predates Phase 3 and is outside `npm test`.

Reproducibility notes: the shell `python` is the container `.venv`, which has no `pytest` and no
`numpy`/`pandas`; `ml-service/.venv` is the interpreter that runs the suite, and it uses `unittest`.
Jest without the guarded environment fails before running a test, which is the guard working, not a
regression.

This reconciles the earlier "33 suites / 255 tests" shorthand: the current tree runs 38 suites / 286
tests, of which 275 are the pre-existing baseline and 11 are the concurrency, application-case and
schema guards added here. `docs/guardian-led-handover-2026-11-16.md` §4 still quotes the 274-test run
of its own branch point; the number to carry forward is 286. No regressions.

Tests that landed with the guard commit:

| Test | Asserts |
| --- | --- |
| `tests/applicationConcurrency.test.js` — one child, one guardian | two simultaneous submissions create exactly one application; the loser answers `409 APPLICATION_ALREADY_SUBMITTED` |
| `tests/applicationConcurrency.test.js` — one child, two guardians | the child-identity keys serialise the pair (see §7.3) |
| `tests/applicationConcurrency.test.js` — different children | unrelated submissions are not serialised; both answer `201` |
| `tests/applicationConcurrency.test.js` — shared name/dob/school | the composite key serialises but never rejects, so the second application is still accepted |
| `tests/applicationConcurrency.test.js` — late resubmission | a submission after the first has committed is refused by the pre-check, not by the lock |
| `tests/duplicateCaseKinds.test.js` | an application case is listed by the review queue, its identifiers can be revealed (audited), and both decision outcomes sync the application |
| `tests/applicationsSchema.test.js` | `duplicate_flags_case_kind_check` rejects a row naming both subjects; `student_applications_guardian_child_idx` exists |
| `tests/applicationWorkflow.test.js` — P3-2 | verifying a second application for an existing child answers `409 DUPLICATE_STUDENT_EXISTS`, non-admins get `403 OVERRIDE_NOT_PERMITTED`, administrators proceed and the override is audited |

## 6. Register carried forward

| Id | Gap | State |
| --- | --- | --- |
| P3-1 | Concurrent/duplicate submission race | **implemented** — advisory locks + in-transaction pre-checks (§7.4); residual limitation §7.1 |
| P3-2 | `verify` creates a student with no namespace check | **implemented** — mandatory namespace check with administrator override (§7.5) |
| P3-3 | Staff queue hides application cases while counts include them | **fixed** — queue and detail read application cases (`controllers/duplicateFlags.controller.js`) |
| P3-4 | `GET /api/duplicate-flags/:id` answers `404` for an application case | **fixed** — detail resolves either subject |
| P3-5 | Legacy resolve on an application case answers a misleading `400` | **fixed** — answers `409 APPLICATION_CASE` and points at the shared decision endpoint |
| — | Two different guardians submitting the same child with no shared identifier | **open** — only serialised, not rejected (§7.1, §7.3); P3-2 covers the record that verification would create |
| — | Candidate generation scans the whole register per submission | unchanged; cost, not correctness |
| — | No re-screen retry worker for `DUPLICATE_SCREENING_UNAVAILABLE` | unchanged; the failure code is visible in the queue |
| — | Scores uncalibrated (F1 0.651) and thresholds unvalidated | unchanged, deliberate (Decision 1) |
| — | No staff notifications for application events | unchanged |
| — | No frontend for the application workflow | unchanged |
| — | Migrations not applied to Azure | unchanged, out of scope |
| — | `FINAL_TEST_REPORT.md` still reflects an older tree | unchanged |

## 7. Advisory-lock coverage, child-identity safeguard, final transaction strategy

### 7.1 What the §2.5 key covers, and what it does not

The key is `guardian_phone | lower(full_name) | date_of_birth`. `guardian_phone` is part of the key
because the product rule it protects is "the same guardian resubmitting the same child in a day"
(`controllers/applications.controller.js:97-111`). That choice leaves the following uncovered:

| Scenario | Serialised? | Notes |
| --- | --- | --- |
| Same guardian, same child, two simultaneous posts | **yes** | the case the §2.5 key was designed for |
| **Different guardians, same child, two simultaneous posts** | **no** | the key differs, so both transactions run side by side and both insert |
| Same guardian, two different children | no | correct: they are different applications and must not queue behind each other |
| Different guardians, different children | no | correct |
| Same child keyed differently (`0712…` vs `+254712…`, a mistyped name) | no | normalisation is a data-quality problem, not a concurrency one |

So the guardian key alone does **not** protect the child, and the different-guardian case is not
hypothetical: the workflow is public, and a mother and a father can both submit from their own
phones (`docs/guardian-led-workflow.md` §3).

### 7.2 Is a child-identity safeguard feasible in this sprint? Yes, for identifier keys

The submission form already validates at least one child identifier (UPI, birth certificate number
or National ID — `applications.controller.js:41-44`), normalised by `normalizeIdentifier`. That is
enough to lock on child identity without a new column, a new table or a migration beyond plain
indexes:

| Lock key (all transaction-scoped advisory locks) | Purpose |
| --- | --- |
| `sbms.application.child:upi:<value>` | one lock per identifier present on the submission |
| `sbms.application.child:birth_certificate:<value>` | |
| `sbms.application.child:national_id:<value>` | |
| `sbms.application.child:name_dob_school:<lower(name)>|<dob>|<school_code>` | catches a submission with no shared identifier: same name, date of birth and school |
| `sbms.application.submission:<guardian_phone>|<lower(name)>|<dob>` | the original §2.5 key, kept |

All keys are acquired in **sorted order** (`ORDER BY key` before the first lock), so two transactions
can never take the same pair of locks in opposite order. Deadlock is impossible; contention is
bounded to submissions that share a key, and the lock is held for one insert plus its audit row.
Restart safety is inherent: a transaction-scoped lock cannot outlive its transaction, so a crashed
API instance cannot leave a stuck lock behind.

Limits that stay after this change, and must not be written out of the record:

| Limit | Consequence |
| --- | --- |
| Identifiers are optional individually and can differ between submissions for one child | no shared identifier means no shared lock; the composite name/dob/school lock still serialises, but it is a **lock only** — a namesake collision must not be turned into an automatic rejection |
| A guardian can mistype an identifier | the lock misses; the advisory screening and the P3-2 check at verification remain the backstop |
| Advisory locks are per database, not per schema or tenant | acceptable: this deployment has one database |
| `hashtext` is 32-bit | a collision serialises two unrelated inserts for a few milliseconds — already accepted in §2.5 |

Because a lock alone prevents nothing, the identity work is paired with a **child pre-check** inside
the same transaction (§7.3). This is a deliberate behaviour change and is listed as such.

### 7.3 Child pre-check — one child, one application (behaviour change)

After the locks are held and inside the same transaction, the submission checks whether another
application already exists in the last 24 hours with the same UPI, birth certificate number or
National ID, whatever guardian phone it was submitted from:

```sql
SELECT id, status FROM student_applications
 WHERE id <> COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
   AND created_at > NOW() - INTERVAL '24 hours'
   AND (($1::text IS NOT NULL AND upi IS NOT NULL AND upi = $1)
     OR ($2::text IS NOT NULL AND birth_certificate_number IS NOT NULL AND birth_certificate_number = $2)
     OR ($3::text IS NOT NULL AND national_id_number IS NOT NULL AND national_id_number = $3))
 LIMIT 1
```

A hit answers `409 APPLICATION_ALREADY_SUBMITTED`, the same code the same-guardian rule already
uses, so a client needs no new branch. The message names the 24-hour window and tells the guardian to
use the tracking code of the existing application.

Why this is the right trade-off and what it costs:

| Argument | Detail |
| --- | --- |
| One child cannot legitimately have two applications in a day | the guardians would have to reconcile two case files and two verification visits for one child |
| An identifier is shared by no two children | a UPI, birth certificate number or National ID match is not a heuristic, so a rejection here is not a model decision |
| Cost: a second guardian loses their own tracking code | the message says an application already exists; the office can look it up by identifier. Acceptable, and the alternative (two silent applications) is worse |
| Not covered: no shared identifier, or a mistyped one | the pair is then only serialised, not rejected; screening and P3-2 remain the backstop |
| Not covered: an application older than 24 hours | unchanged product rule (`docs/guardian-led-workflow.md` §7); P3-2 covers verification, which is what actually creates the duplicate student |

### 7.4 Final transaction strategy

| Step | Transaction | Statements |
| --- | --- | --- |
| 1. Validate | none | `applicationSchema.safeParse` — no connection is taken, so invalid input can never hold a lock |
| 2. Locks | T1 | `pg_advisory_xact_lock(hashtext(key))` for each key of §7.2, sorted |
| 3. Same-guardian pre-check | T1 | the §2.1 query, unchanged, now race-free |
| 4. Child pre-check | T1 | §7.3 |
| 5. Insert + audit | T1 | `INSERT INTO student_applications`, `APPLICATION_SUBMITTED`, `COMMIT` |
| 6. Screening | T2 | `screenApplication` + `APPLICATION_SCREENED`; failures are recorded, never rolled back into T1 |
| 7. Verification | T3 | `pg_advisory_xact_lock('sbms.student.registration')`, `lockApplication` (`FOR UPDATE`), duplicate-case gate, **P3-2 namespace check**, `studentModel.create`, eligibility rows, `APPLICATION_VERIFIED` |

Invariants: locks are taken only after validation, always in sorted order, always transaction-scoped,
and never held across the predictor call (step 6 is a separate transaction, as today). A failed
insert releases every lock on `ROLLBACK`; the `finally` block releases the connection.

### 7.5 P3-2 — namespace check at verification (now mandatory)

Before `studentModel.create` (`applications.controller.js:599`), inside T3:

```sql
SELECT s.id, s.full_name, s.school_code, TO_CHAR(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
       s.duplicate_of_student_id,
       (s.upi IS NOT NULL AND s.upi = $1) AS upi_match,
       (s.birth_certificate_number IS NOT NULL AND s.birth_certificate_number = $2) AS birth_certificate_match,
       (s.national_id_number IS NOT NULL AND s.national_id_number = $3) AS national_id_match
  FROM students s
 WHERE ($1::text IS NOT NULL AND s.upi = $1)
    OR ($2::text IS NOT NULL AND s.birth_certificate_number = $2)
    OR ($3::text IS NOT NULL AND s.national_id_number = $3)
    OR (lower(s.full_name) = lower($4) AND s.date_of_birth = $5::date AND s.school_code = $6)
 ORDER BY s.created_at ASC
 LIMIT 1
```

| Situation | Response |
| --- | --- |
| no match | verification proceeds exactly as today |
| match, no `override_reason` | `409 DUPLICATE_STUDENT_EXISTS`, carrying `existing_student_id`, `canonical_student_id` (`COALESCE(duplicate_of_student_id, id)`) and the matching fields |
| match, `override_reason`, caller not an administrator | `403 OVERRIDE_NOT_PERMITTED` — the same rule as the open-case override |
| match, `override_reason`, administrator | verification proceeds; the application stores the reason, and `APPLICATION_VERIFIED` records `duplicate_student_override`, `matched_student_id` and `matched_fields` |

The match is exact on an identifier or on `(lower(name), date_of_birth, school_code)`; no score is
consulted, so this is a deterministic guard, not a second model. Residual: a child whose identifier
is mistyped *and* whose name or school differs between the two submissions is still not detected.

