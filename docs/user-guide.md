# Student Beneficiary Management System User Guide

## Purpose

SBMS helps administrators identify potentially duplicated student beneficiary records before they proceed through the beneficiary workflow. Duplicate detection supports human review; it does not replace an authorized decision.

## Start the system

1. Start PostgreSQL.
2. Start the backend from `backend` with `npm run dev`.
3. Start the frontend from `frontend` with `npm run dev`.
4. Open the frontend URL in a browser.

## Sign in

Use an administrator account. Protected pages redirect unauthenticated users to the login screen. Administrator-only pages include duplicate review and audit logs.

## Register a student

Open **Students** and choose **Register Student**. Enter:

- Full name
- Date of birth
- School code
- Guardian ID
- UPI
- Birth Certificate Number

Submit the form to save the student and run duplicate comparison against existing records. A QR code is returned for a successful registration.

## Understand duplicate results

The system compares:

- Name similarity
- Date of birth
- School
- Guardian
- UPI
- Birth certificate number

Exact identity-related matches contribute evidence, while name similarity is graded. Missing values are not treated as matching values. Pending cases are refreshed automatically when the Duplicate Review page loads.

## Review a possible duplicate

Open **Duplicate Review** to see pending cases. Open **Review Case** to compare both student records side by side. The page shows:

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

Register a student with the same UPI or birth certificate number as an existing record. The system should create a pending admin-review flag. Scores of 70% or higher are labelled Duplicate; lower scores remain Review. Field officers can submit the registration; admins confirm or clear the flag.

### Similar name, different learner

Use similar names with different DOB, guardian, UPI, and birth certificate values. Name similarity alone should not determine a duplicate.

### Twins or multiples

Use the same DOB, school, and guardian but different names, UPI values, and birth certificate numbers. Shared demographic attributes should trigger careful review rather than automatic identity confirmation.

## Limitations

The trained model uses synthetic data and must be validated with representative real-world records before operational use. Exact UPI and birth-certificate matches each carry 40% of the score, but an identifier match alone does not bypass the 70% Duplicate threshold. Admins confirm or clear flagged records; probabilities alone are not proof of identity.
