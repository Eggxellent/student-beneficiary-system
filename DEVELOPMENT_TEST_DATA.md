# SBMS synthetic Kenyan test data

This dataset is deterministic, fictional test content. It does not use beneficiary information. Synthetic records have `students.is_synthetic = TRUE`, QR tokens beginning `SBMS-SYNTHETIC-KE-20261019-`, and use only the five approved schools: Nairobi School, Alliance High, Bishop Gatimu, Loreto Limuru, and Maranda.

The current schema has no county, class/year, or guardian-name fields. County context is mapped to the five approved school names in `backend/scripts/kenyanSyntheticDataset.js`. Scholarship examples use the existing `disbursements.amount` field. No ML training data, model, or experiment result is changed.

## Safety and requirements

- Use only a local development/test PostgreSQL database. Both scripts reject non-loopback database hosts and production-looking database names.
- Apply `backend/src/db/migrations/20261019_synthetic_student_marker.sql` before seeding. Existing records get `is_synthetic = FALSE` by default.
- Apply `backend/src/db/migrations/20261019_limit_synthetic_schools.sql` to map this marked synthetic batch to the approved school names. New student registrations accept only those five names.
- The seed script is dry-run by default. It requires both `SBMS_ALLOW_LOCAL_SYNTHETIC_SEED=YES` and `--apply` for writes.
- It never truncates, updates, or deletes student rows. Existing seeded rows must exactly match their deterministic marker and content or the script stops.
- Duplicate cases are reviewed directly by Admin users; no case assignment is used.
- Never point this script at production or a remote database. Do not put database URLs or passwords in command output or this document.

## Seed, inspect, reset

From `backend/`, set the process environment to your local development DB URL and run the preview:

```powershell
npm run seed:synthetic
```

Review the printed target database and expected scenario/outcome counts. To seed, explicitly opt in for that PowerShell session:

```powershell
$env:SBMS_ALLOW_LOCAL_SYNTHETIC_SEED = 'YES'
npm run seed:synthetic -- --apply
```

The operation is repeatable. A rerun reports already-present matching records/cases rather than duplicating them. Inspect only marked content with PostgreSQL:

```sql
SELECT COUNT(*) FROM students WHERE is_synthetic = TRUE;
SELECT status, COUNT(*) FROM duplicate_flags
WHERE student_id IN (SELECT id FROM students WHERE is_synthetic = TRUE)
   OR matched_student_id IN (SELECT id FROM students WHERE is_synthetic = TRUE)
GROUP BY status ORDER BY status;
```

Reset only this synthetic batch (including flags and sample disbursements linked to it) with the separate guarded command:

```powershell
npm run reset:synthetic -- --confirm-reset-synthetic-kenyan-data
```

The reset requires the same explicit opt-in. It only selects rows whose synthetic flag and stable QR marker both match this seed batch; it does not reset the database.

## Expected scenarios

The seed contains 50 students and 21 curated comparison pairs: 3 likely duplicate pairs, 3 spelling variations, 3 name-order/format cases, 4 similar-name distinct-student cases, 3 conflicting-identifier cases, 3 missing-field cases, and 2 exact synthetic UPI matches. Eight ordinary records have sample KES disbursements. Actual queued counts are calculated and printed using the application’s current feature builder and thresholds; pairs classified `clear` do not become review flags. Every queued case starts `pending`, never confirmed.

Seed run on 2026-10-19 against the local development DB added **50 students, 13 pending unassigned review flags, and 8 disbursements totaling KSh 123,500**. The 21 comparisons produced 4 critical, 9 review, 0 duplicate-classified, and 8 clear outcomes. Queued flags by scenario: 3 clear-duplicate candidates, 3 typo variants, 2 formatting variants, 0 similar-name siblings, 3 conflicting-identifier pairs, 0 missing-data pairs, and 2 exact-UPI pairs. Together with pre-existing rows the DB now reports 161 total students; the Admin dashboard separately shows the 50 synthetic records. A repeat run created **0** additional students, flags, or disbursements.

An exact UPI match is displayed as deterministic review evidence. It is not a human decision. Missing values are scored as unavailable/zero evidence. Admin users review synthetic cases in Duplicate Review.
