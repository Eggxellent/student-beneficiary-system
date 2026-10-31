# SBMS database backup and restore rehearsal — 2026-10-31

**Purpose:** close the Phase 5 exit criterion "a documented, tested restore exists" (handover §8)
with real evidence rather than a procedure description.

**Scope:** the local disposable `sbms_test` database only. No production or development database was
read from, written to, dumped, restored or dropped. No backup file was uploaded, committed or pasted
anywhere.

**Checkout:** `fix/sbms-completion-work` at `3a29fab19502aad4cf45c1e44055c54cc4ff7c6e`.
**Tools:** PostgreSQL 17.11 client and server (`psql`, `pg_dump`, `pg_restore`), Windows 11.
**Date of execution:** 2026-10-31, 11:31–11:35 (UTC+03:00).

## 1. Safety rules applied

| Rule | How it was enforced |
|---|---|
| Use only the disposable test database | Identity was queried before any other command: `current_user=sbms_test_runner`, `current_database()=sbms_test`, `inet_server_addr()=::1/128`, port 5432 |
| Never touch the development database | `student_beneficiary_system` was **only** used as an authenticated `postgres` session against the `postgres` maintenance database to run `CREATE DATABASE`. It was never a dump source, restore target or query target |
| Never touch production | No production credential exists in this environment; every operation was loopback-only |
| Never overwrite an existing backup | The filename embeds a `yyyyMMdd_HHmmss` timestamp, and the script aborted (`throw`) if the path already existed |
| Never restore over an existing database | The restore name was asserted against `^sbms_restore_rehearsal_\d{8}_\d{6}$`, rejected if it equalled `student_beneficiary_system`, `sbms_test` or `postgres`, and a `SELECT 1 FROM pg_database WHERE datname = ...` check refused to continue if it already existed |
| Keep the backup local | Written to `C:\Users\user\Desktop\Projects\sbms-db-backups\`, outside the git repository; not added to git (verified with `git status` at the end) |
| Never print credentials | Connection strings were parsed into `PGPASSWORD`/`DATABASE_URL` inside the process; no password was echoed at any point |
| Do not delete the backup afterwards | The file is still present and its hash is recorded below |

## 2. Target identification (before any write)

```
IDENTITY {"usr":"sbms_test_runner","db":"sbms_test","addr":"::1/128","port":5432,"version":"17.11"}
SIZE     8966 kB
TABLECOUNT 12
TABLES   audit_logs,beneficiaries,bursary_award_verification_events,bursary_awards,
         disbursement_reconciliation_events,disbursements,duplicate_flags,
         duplicate_review_events,reports,sbms_schema_migrations,students,users
COLUMNCOUNT 118
MIGRATIONS 12
```

`sbms_test_runner` is **not** a superuser and cannot create databases
(`rolsuper=false, rolcreatedb=false`). The local `postgres` role is a superuser; it was used only to
create the empty restore database.

Data at the time of the backup (`sbms_test`):

| Table | Rows |
|---|---|
| `users` | 4 (`admin@sbms.com`, `bootstrap-admin@example.invalid`, `phase3.admin@example.invalid`, `phase3.officer@example.invalid`) |
| `audit_logs` | 1 |
| `sbms_schema_migrations` | 12 |
| every other table (`students`, `duplicate_flags`, `duplicate_review_events`, `bursary_awards`, `bursary_award_verification_events`, `disbursements`, `disbursement_reconciliation_events`, `reports`, `beneficiaries`) | 0 |

The 12 applied migrations were: `20261019_admin_field_officer_roles.sql`,
`20261019_duplicate_review_workflow.sql`, `20261019_enforce_supported_schools.sql`,
`20261019_field_officer_registration.sql`, `20261019_limit_synthetic_schools.sql`,
`20261019_remove_duplicate_case_assignment.sql`, `20261019_standardize_student_records.sql`,
`20261019_synthetic_student_marker.sql`, `20261022_ml_duplicate_provenance.sql`,
`20261023_bursary_award_reconciliation.sql`, `20261024_add_user_activation_flag.sql`,
`20261025_legacy_beneficiaries_baseline.sql`.

## 3. Backup

```powershell
# credentials loaded from backend/.env.test inside the process; nothing printed
pg_dump -h localhost -p 5432 -U sbms_test_runner -d sbms_test -Fc -f <unique path>
```

| Property | Value |
|---|---|
| File | `C:\Users\user\Desktop\Projects\sbms-db-backups\sbms_test_custom_20261031_113123.dump` |
| Format | custom (`-Fc`), compressed |
| Size | 39,336 bytes |
| SHA-256 | `DA124354961BB6EF986EBD91D181867ECD279BE94401CB5883726C154B888AA7` |
| Created | 2026-10-31 11:31:23 (+03:00) |
| Exit code | 0 |
| Dumped by | `sbms_test_runner` (the object owner, **not** a superuser) |

Backup readability was verified twice before any restore:

```
pg_restore -l <dump>                    -> exit 0, 88 TOC entries
                                          12 "TABLE DATA public <table>" entries
pg_restore --data-only --file=NUL <dump> -> exit 0 (payload decompressed and discarded)
```

The 12 table-data entries confirm every table was archived, including empty ones.

## 4. Restore into a separate disposable database

```powershell
# 1. create an empty database owned by the test role (superuser, maintenance DB "postgres")
psql -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 `
     -c "CREATE DATABASE sbms_restore_rehearsal_20261031_113123 OWNER sbms_test_runner"

# 2. restore as the owner, without owner statements (the connecting role becomes the owner)
pg_restore -h localhost -p 5432 -U sbms_test_runner `
           -d sbms_restore_rehearsal_20261031_113123 --no-owner --exit-on-error <dump>
```

```
CREATE DATABASE                 exit 0
pg_restore                      exit 0   (no warnings on stderr)
```

`--no-owner` was required because the dump records `OWNER TO sbms_test_runner` statements and the
restore runs as that same non-superuser role; skipping owner statements avoids any attempt to change
ownership while still giving every object the correct owner. `--exit-on-error` makes the exit code
meaningful: any single failing statement would have aborted the run. `pgcrypto` is a trusted
extension and was created successfully by the database owner.

## 5. Verification of the restored database

### 5.1 Readiness contract (application code, not a bespoke query)

Both databases were checked with the production helper
`backend/src/services/databaseReadiness.js` -> `checkDatabaseReadiness(query, { expectedDatabaseName })`,
which asserts that all 11 required relations exist in `public` and are not shadowed by a
search-path resolution to a different schema:

| Database | Result |
|---|---|
| `sbms_test` (source) | `{"ready":true}` |
| `sbms_restore_rehearsal_20261031_113123` (restored) | `{"ready":true}` |

### 5.2 Structural comparison

| Signature | Source | Restored | Result |
|---|---|---|---|
| Base tables | 12 | 12 | **match** |
| Columns (name, type, nullability, default) | 118 | 118 | **match** |
| Constraints (relation + name + type) | 56 | 56 | **match** |
| Constraint definitions after cast normalisation | 56 | 56 | **match** |
| Indexes (name + definition) | 21 | 21 | **match** |
| Sequences (name + last value) | 1 | 1 | **match** |
| Triggers | 0 | 0 | **match** |
| Extensions | 2 | 2 | **match** |
| Migration ledger rows | 12 | 12 | **match** |

**A cosmetic difference was found and analysed, not waved away.** The naive comparison of
`pg_get_constraintdef()` reported 24 differences (12 pairs). Each pair is the *same* constraint whose
text deparses differently after a dump and restore, because re-parsing the `CHECK` expression adds
explicit casts to each `ARRAY[...]` element:

```
source   : ... = ANY ((ARRAY['admin'::character varying,'field_officer'::character varying])::text[])
restored : ... = ANY (ARRAY[('admin'::character varying)::text,('field_officer'::character varying)::text])
```

Identity (relation, name, `contype`) matched exactly on both sides, and after normalising away
`::text` / `::character varying` casts the definitions were identical. Enforcement was then proven
functionally rather than textually (section 5.3).

### 5.3 Constraint enforcement parity

Each insert below was executed inside `BEGIN ... ROLLBACK`, so nothing was persisted. Both databases
were probed with the same statements:

| Probe | Source result | Restored result |
|---|---|---|
| `users` with `role='wizard'` | rejected `23514` `users_role_supported_check` | rejected `23514` `users_role_supported_check` |
| `duplicate_review_events` with `decision='maybe'` | rejected `23514` `duplicate_review_events_decision_check` | rejected `23514` `duplicate_review_events_decision_check` |

Both databases enforce the same `CHECK` constraints with the same SQLSTATE and the same constraint
names. (An earlier version of the probe was rejected by `NOT NULL`/type errors before reaching the
`CHECK`; it was corrected so the `CHECK` is genuinely exercised — that first result was not reported
as a pass.)

### 5.4 Row counts and row-content digests

Row counts were identical for all 12 tables. Because equal counts do not prove equal contents, a
per-table digest was also compared: `md5(string_agg(row::text, '|' ORDER BY row::text))`.

| Table | Rows | Digest |
|---|---|---|
| `users` | 4 | `8bcf004095c4c1d1d4a32fcedc61af8a` |
| `audit_logs` | 1 | `38081650ab032ae46b44f0c0f40f7912` |
| `sbms_schema_migrations` | 12 | `d047a788308b2e0723a5ffe8ee2e4fbf` |
| 9 empty tables | 0 | `EMPTY` |

`DATA_DIGEST source=12 tables restored=12 tables MATCH=true` — the restored copy was **row-identical**
in content, not merely in shape.

### 5.5 Application smoke test against the restored database

The API was started against the restored database only
(`DATABASE_URL=<restored>`, `SBMS_EXPECTED_DATABASE_NAME=sbms_restore_rehearsal_20261031_113123`,
`PORT=5055`, random 64-hex `JWT_SECRET`, `PUBLIC_APP_URL=https://sbms.example.ke`), then driven with
the repository's out-of-process smoke suite:

```
Server running on port 5055
GET /api/ready -> {"status":"ready"}
ok 1 - health endpoint is available
ok 2 - admin can authenticate, read admin resources, and is blocked from field workflows
ok 3 - report export validates its date range
# tests 3   # pass 3   # fail 0        exit 0
```

Startup validation (`databaseStartup`) accepted the restored database, an administrator restored from
the dump authenticated with the credentials that were valid before the backup, admins were still
blocked from field-officer routes, and the report-export date-range guard still returned its
validation error. The server was stopped afterwards (`Stop-Process`).

The data digest was recomputed **after** the smoke run and still matched, so the smoke test left no
stray rows behind.

### 5.6 Source database left untouched

| Check | Result |
|---|---|
| `sbms_test` row counts after the whole rehearsal | `users=4, audit_logs=1, sbms_schema_migrations=12`, all others 0 — identical to the pre-backup state |
| `sbms_test` readiness | `{"ready":true}` |
| Development database `student_beneficiary_system` | never a dump source, restore target or query target |

## 6. What this proves and what it does not

**Proven (local, `sbms_test`):**

- A custom-format dump of the real application database can be produced by the unprivileged owning
  role and read back (`pg_restore -l`, payload decompression).
- That dump restores cleanly (`--exit-on-error`, exit 0, no warnings) into an independent, newly
  created database.
- The restored database satisfies the same readiness contract the API enforces at startup.
- Schema, constraints, indexes, sequences, extensions and the migration ledger are equivalent, and
  constraint *enforcement* is identical (same SQLSTATE, same constraint names).
- Row contents are identical (per-table MD5 digests), not just row counts.
- The real API boots against the restored database and completes authentication and authenticated
  reads.

**Not proven:**

- **Production recovery.** No production database exists yet (Azure is unprovisioned), so this is a
  rehearsal against a test database. A real runbook will also need Azure PostgreSQL Flexible Server
  point-in-time restore, a retention policy and an encrypted off-site copy of dumps.
  `docs/PRODUCTION_DATABASE_RECOVERY_AUDIT.md` remains the production document; its conclusion is
  unchanged and no production restore is authorized.
- **Recovery of a populated database.** `sbms_test` holds 4 users and no students, awards or
  disbursements, so this does not exercise large row volumes, sequence continuity under write load,
  or restore duration at production size.
- **Security of the artefact.** The dump is a plain custom-format archive in a local folder. It is not
  encrypted at rest and this document does not claim it is. It must never be committed, uploaded or
  attached to a ticket.
- **Point-in-time / partial recovery.** Only a full logical dump and restore was tested. No PITR, WAL
  replay, single-table recovery or cross-version restore was tested.

## 7. Repeatable procedure (runbook)

1. **Confirm the target** before anything else: read `current_user`, `current_database()`,
   `inet_server_addr()`. Stop unless it is a disposable database on loopback.
2. **Pick a unique name** — `<db>_custom_<yyyyMMdd_HHmmss>.dump` — and abort if the file exists.
3. **Dump** with `pg_dump -Fc` as the owning role; record size and SHA-256.
4. **Verify the archive** with `pg_restore -l` (expect one `TABLE DATA` entry per table) and a payload
   read (`pg_restore --data-only --file=NUL`).
5. **Create a separate database** with a name matching `^sbms_restore_rehearsal_\d{8}_\d{6}$`,
   refusing any existing name and any live database name.
6. **Restore** with `pg_restore --no-owner --exit-on-error` as the owner.
7. **Check readiness** through `checkDatabaseReadiness` with the restored database name as
   `expectedDatabaseName`.
8. **Compare** tables, columns, constraints, indexes, sequences, extensions, migration ledger, row
   counts and per-table row digests against the source.
9. **Probe constraints** functionally inside `BEGIN ... ROLLBACK`.
10. **Smoke test** the API against the restored database only, then stop the process.
11. **Re-check the source** counts to prove the rehearsal was read-only towards it.
12. **Keep the dump**; record its name, size and hash in the evidence document.

## 8. Cleanup and retention

| Item | State |
|---|---|
| Backup `sbms_test_custom_20261031_113123.dump` (39,336 bytes) | **retained**, local only, outside the repository |
| Restore database `sbms_restore_rehearsal_20261031_113123` | **retained** for inspection; disposable and safe to drop at any time |
| `sbms_test` | unchanged, readiness `{"ready":true}` |
| Repository | no dump, SQL export or credential was added to git |

To drop the rehearsal database once it has been inspected (superuser, maintenance database):

```sql
DROP DATABASE IF EXISTS sbms_restore_rehearsal_20261031_113123;
```

## 9. Phase 5 exit criterion

Handover §8 Phase 5 reads: *"`db:init` builds a DB that satisfies readiness; a documented, tested
restore exists."*

- **Readiness** — satisfied: `sbms_test` (built through the guarded bootstrap and migration path)
  reports `{"ready":true}` through the application's own helper, and the API serves `/api/ready` with
  `{"status":"ready"}`.
- **Documented, tested restore** — satisfied for the local database: this document is the procedure and
  the evidence in sections 3–5 is the executed test (2026-10-31).

Both halves of the criterion are now met with executed evidence. The same rehearsal against the
hosted Azure PostgreSQL Flexible Server remains open and is tracked in
`docs/azure-deployment-plan-2026-10-30.md`.

## 10. Command log (this session, in order)

| # | Command | Outcome |
|---|---|---|
| 1 | identity query on `DATABASE_URL` (from `backend/.env.test`) | `sbms_test` / `sbms_test_runner` / `::1` / 17.11 |
| 2 | role attributes query | `sbms_test_runner` not superuser, not `createdb`; `postgres` superuser |
| 3 | database list | `postgres`, `sbms_test`, `student_beneficiary_system` |
| 4 | `pg_dump -Fc` to `sbms_test_custom_20261031_113123.dump` | exit 0, 39,336 bytes |
| 5 | `pg_restore -l` | exit 0, 88 TOC entries, 12 `TABLE DATA` |
| 6 | `pg_restore --data-only --file=NUL` | exit 0 |
| 7 | `CREATE DATABASE sbms_restore_rehearsal_20261031_113123 OWNER sbms_test_runner` | exit 0 |
| 8 | `pg_restore --no-owner --exit-on-error` into that database | exit 0, no warnings |
| 9 | readiness + signature + row-count comparison script | ready on both, all signatures match, counts match |
| 10 | constraint identity / normalised-definition / enforcement comparison | identity and normalised defs match; both probe `23514` |
| 11 | per-table row digest comparison | `MATCH=true` |
| 12 | API on port 5055 against the restored database + `api.smoke.test.js` | `/api/ready` OK, 3/3 pass, exit 0 |
| 13 | digest re-check after the smoke run | still `MATCH=true` |
| 14 | final row counts on both databases | source unchanged |

No step was run against production, and no step used the development database
`student_beneficiary_system` as a source or target.




