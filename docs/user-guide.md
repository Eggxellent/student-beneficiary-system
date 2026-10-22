# Student Beneficiary Management System User Guide

## Purpose

SBMS helps administrators identify potentially duplicated student beneficiary records before they proceed through the beneficiary workflow. Duplicate detection supports human review; it does not replace an authorized decision.

## Start the system

1. Start PostgreSQL.
2. Start the backend from `backend` with `npm run dev`.
3. Start the frontend from `frontend` with `npm run dev`.
4. Open the frontend URL in a browser.

## Sign in

Open `/login` and choose the Admin or Field Officer sign-in. SBMS checks the account's stored role and rejects sign-in through the other role's page. Admins use the system dashboard and duplicate review; Field Officers use the separate field dashboard for student registration and field operations.

## Register a student

Open **Students** and choose **Register Student**. Enter:

- Full name
- Date of birth
- One of the five approved schools
- National ID number
- Primary phone number
- Link a QR token

Submit the form to save the student and run duplicate comparison against existing records. A QR code is returned for a successful registration.

Student records use a consistent storage format across the form and API: names are trimmed and repeated spaces are collapsed; dates use `YYYY-MM-DD`; school names match the approved list exactly; identifier values are trimmed and stored in uppercase; and Kenyan mobile numbers are stored in `+254` format. Phone numbers entered as `07...`, `01...`, or `254...` are normalized automatically. Empty optional fields are stored as `NULL`.

## Understand duplicate results

The system compares:

- Name similarity
- Date of birth
- School
- Guardian
- UPI
- Birth certificate number

UPI and birth certificate numbers must be unique across students. Any exact match is marked **Critical**, even when the weighted score is below the Duplicate threshold. Missing values are not treated as matches. When a pending case falls below the review threshold and has no critical identifier or corroborating match, it is automatically cleared and recorded in the audit log.

## Review a possible duplicate

Open **Duplicate Review** to see pending cases. Use **Scan existing records** to compare all stored student pairs and create flags for qualifying pairs that have not already been reviewed. Use **Review Case** to compare both student records side by side. The page shows:

- The values from each record
- Match or difference evidence
- Score contributions
- The calculated probability

Choose **Confirm Duplicate** when the records represent the same learner, or **Clear as Not Duplicate** when the records are legitimate separate students. Both actions are recorded in the audit log.

## Audit logs

Open **Audit Logs** to review recorded actions, including the user, action, resource, record ID, and timestamp. Use this page as evidence of review accountability during demonstrations.

## Demonstration scenarios

### Normal student

Register a student with identity values that do not match an existing record. The student should be saved without a pending duplicate flag.

### Likely duplicate

Register a student with the same UPI or birth certificate number as an existing record. The system creates a pending critical flag and alerts the field officer immediately. Both records are blocked from disbursement until an admin confirms or clears the flag. The system does not automatically declare the records to be the same learner.

### Similar name, different learner

Use similar names with different DOB, guardian, UPI, and birth certificate values. Name similarity alone should not determine a duplicate.

### Twins or multiples

Use the same DOB, school, and guardian but different names, UPI values, and birth certificate numbers. Shared demographic attributes should trigger careful review rather than automatic identity confirmation.

## Limitations

The trained model uses synthetic data and must be validated with representative real-world records before operational use. Exact UPI and birth-certificate matches each carry 40% of the score and receive critical status independently of the score threshold. Admins confirm or clear flagged records; probabilities alone are not proof of identity.
