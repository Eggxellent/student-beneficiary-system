# Student Beneficiary System

Full-stack application for managing student beneficiary records.

## Stack

- **Frontend:** React
- **Backend:** Node.js + Express
- **Database:** PostgreSQL

## Project Structure

```
student-beneficiary-system/
├── backend/     # Express API server
└── frontend/    # React client app
```

## Getting Started

Install dependencies once:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

Set `DATABASE_URL`, `JWT_SECRET`, and `PUBLIC_APP_URL` in `backend/.env`, then
start the API and frontend together from this directory:

```bash
npm start
```

Open `http://localhost:4174`. The frontend runs on port 4174, and the API runs
on port 5000 and is proxied by Vite.

`PUBLIC_APP_URL` must be set to the frontend origin used in student QR links.
For local development, use `http://localhost:4174`; production requires the
public HTTPS origin and rejects localhost. Student QR images point to
`/verify#token=...`. The verification page and endpoint are a later implementation
phase, so new QR links cannot be verified until those are added.

`CORS_ORIGINS` is a comma-separated allowlist of bare frontend origins (scheme
and host, without a path). The example allows only the local Vite origin. In
production, set the exact HTTPS origin(s); if the setting is absent, browser
origins are denied. Invalid configured origins stop the API at startup. The API
also limits JSON request bodies and sign-in requests. CORS is a browser policy,
not a replacement for API authentication and authorization.

## Database operations

The application does not automatically apply SQL migrations. Review the
baseline schema in `backend/src/db/schema.sql` and each file in
`backend/src/db/migrations/` before applying it. Back up the target database,
verify the backup can be restored into a separate disposable database, and
apply changes through an authorized operator. Never point restore or test
commands at the production database.

Configure PostgreSQL libpq service entries named `sbms-backup` and
`sbms-restore` in a permission-protected service file, with passwords in a
permission-protected passfile. Point `PGSERVICEFILE` and `PGPASSFILE` at those
files in the current shell. Do not put a connection URL or password on a
command line or in source control.

```powershell
pg_dump --dbname="service=sbms-backup" --format=custom --file=sbms-backup.dump
```

Restore only into a separately created, empty verification database:

```powershell
pg_restore --dbname="service=sbms-restore" --exit-on-error sbms-backup.dump
```

Ensure the restore service points to a separately created, empty verification
database before running the restore command. Confirm the restored schema and
synthetic-only test data there. These instructions do not indicate that a
backup has been taken.

See [docs/REMEDIATION_PROGRESS.md](docs/REMEDIATION_PROGRESS.md) for the audit,
verification status, and remaining deployment work.

## Award and payment reconciliation

Field officers submit bursary awards and record beneficiary verification with
an evidence reference. An administrator can approve only verified awards and
can reject an application with a reason. Open duplicate-review flags block approval and payment; the existing ML
screening and human review flow remain in place.

Payments are recorded as **issued** first. An authorised user records clearance
separately with evidence, and receipt acknowledgement is an officer-assisted
record, not an independent school confirmation. A mismatch is retained as an
exception for follow-up. Split payments are allowed up to the approved award
amount. Existing unlinked payments remain visible as legacy exceptions; an
administrator can link one to an approved award for the same student, with a
reason. Linking does not certify its payment or receipt status.

`ACKNOWLEDGEMENT_OVERDUE_DAYS` optionally sets the acknowledgement follow-up
deadline (integer 1–3650). Leave it unset until the responsible programme owner
defines the service standard; overdue alerts are then disabled. Existing
records need the unapplied migration
`backend/src/db/migrations/20261023_bursary_award_reconciliation.sql` before
the new endpoints and screens can operate. This repository does not apply
migrations automatically. Review the SQL, back up and verify a restore in a
separate database, then have an authorised operator apply it. No migration was
applied as part of this change.

The verification evidence reference is a generic audit pointer, not an upload
or document checklist. Required document types and an independent school
account flow remain policy decisions. QR verification is deferred; the current
student QR code does not confirm award, identity, clearance, or receipt.
