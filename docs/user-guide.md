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
- Birth certificate number (optional)
- UPI (optional)
- Primary phone number
- Link a QR token

Birth certificate number and UPI are optional because a guardian may not have the document at the counter, but they are the two identifiers with a critical exact-match rule: leave them blank only when the document is genuinely unavailable, because a missing identifier can never be matched against another record. Both are trimmed and stored in uppercase like the other identifiers, and a blank box is not sent at all.

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

## Issue and print a bursary certificate

A certificate can be issued once an award has been approved. Open **Awards** and use the **Bursary certificates** panel:

1. Enter the award period. A single year such as `2026` or a range such as `2025/2026` is accepted, and leaving it blank records the year of approval.
2. Choose **Issue certificate**. The panel shows the certificate reference, the QR code and the verification link.
3. Use **PDF** or **Print** to give the student or school a copy. **View QR** shows the code on screen.

The QR code is what makes the paper checkable: scanning it opens the public verification page, which answers from the live database. The certificate states that the award was approved and that **approval is not payment** — the system records decisions only, so the certificate never claims that money was released.

Only an administrator can issue a certificate; field officers can view, print and download it. One approved award carries exactly one certificate, and it cannot be reissued for the same award. A certificate that was already printed keeps its reference, so the document stays checkable for as long as the award exists. SBMS has no revocation step: a certificate cannot be withdrawn through the system, and if the award itself is later changed the public page reports the certificate as not current rather than as valid.

## Audit logs

Open **Audit Logs** to review recorded actions, including the user, action, resource, record ID, and timestamp. Use this page as evidence of review accountability during demonstrations.

## Demonstration scenarios

### Normal student

Register a student with identity values that do not match an existing record. The student should be saved without a pending duplicate flag.

### Likely duplicate

Register a student with the same UPI or birth certificate number as an existing record. The system creates a pending critical flag and alerts the field officer immediately. Both records are blocked from award approval until an admin confirms or clears the flag. The system does not automatically declare the records to be the same learner.

### Similar name, different learner

Use similar names with different DOB, guardian, UPI, and birth certificate values. Name similarity alone should not determine a duplicate.

### Twins or multiples

Use the same DOB, school, and guardian but different names, UPI values, and birth certificate numbers. Shared demographic attributes should trigger careful review rather than automatic identity confirmation.

## Limitations

The trained model uses synthetic data and must be validated with representative real-world records before operational use. Exact UPI and birth-certificate matches each carry 40% of the score and receive critical status independently of the score threshold. Admins confirm or clear flagged records; probabilities alone are not proof of identity.
