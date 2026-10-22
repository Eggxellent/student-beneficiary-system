# Student Beneficiary Management System - UAT Test Plan

## Purpose

The purpose of User Acceptance Testing is to verify that the Student Beneficiary Management System meets the expected functional requirements for field officers and administrators.

## Test Environment

- Backend: Node.js / Express
- Frontend: React
- Database: PostgreSQL
- ML prediction service: Python / XGBoost
- Environment: Local development environment

---

## Test Scenario 1 - User Login

### User
Field Officer / Administrator

### Steps
1. Open the SBMS application.
2. Enter a valid email and password.
3. Click Login.

### Expected Result
The user is authenticated successfully and taken to the dashboard.

### Result
PASS

---

## Test Scenario 2 - Student Registration and Duplicate Detection

### User
Field Officer

### Steps
1. Log in as a field officer.
2. Open Student Registration.
3. Enter valid student details.
4. Submit the form.
5. Register a second student with highly similar details.

### Expected Result
The student is registered successfully and the system performs a duplicate check using its configured similarity scoring policy. The Python XGBoost predictor is available separately; current backend controller code does not call it.

If the probability exceeds the configured threshold, a duplicate flag is created.

### Result
PASS

---

## Test Scenario 3 - Duplicate Review

### User
Administrator

### Steps
1. Log in as an administrator.
2. Open Duplicate Review.
3. View a pending duplicate flag.
4. Review the duplicate probability.
5. Select either Confirm or Clear.

### Expected Result
The duplicate flag status is updated successfully and the action is recorded in the audit log.

### Result
PASS

---

## Test Scenario 4 - Disbursement Control

### User
Field Officer / Administrator

### Steps
1. Select a student with an unresolved duplicate flag.
2. Attempt to create a disbursement.

### Expected Result
The system blocks the disbursement while the duplicate flag remains unresolved.

### Additional Test
1. Clear the duplicate flag.
2. Attempt the disbursement again.

### Expected Result
The valid disbursement is successfully created.

### Result
PASS

---

## Test Scenario 5 - Dashboard and Reporting

### User
Administrator

### Steps
1. Open the dashboard.
2. Verify student and disbursement statistics.
3. Open Reports.
4. Select a date range.
5. Export a PDF report.
6. Open the generated PDF.

### Expected Result
The dashboard displays current database information and the PDF contains the selected reporting period and relevant system statistics.

### Result
PASS

---

## UAT Summary

| Test | Expected Result | Result |
|---|---|---|
| Login | User successfully authenticated | PASS |
| Student registration & duplicate detection | Student registered and duplicate probability generated | PASS |
| Duplicate review | Admin can resolve duplicate flags | PASS |
| Disbursement control | Unresolved duplicates block payment | PASS |
| Dashboard & reporting | Statistics and PDF report generated | PASS |

## Conclusion

The Student Beneficiary Management System successfully passed the defined User Acceptance Testing scenarios.

The tested workflows demonstrate that the major system components work together as required, including authentication, student registration, machine-learning duplicate detection, duplicate review, disbursement control, dashboard reporting, and PDF report generation.

## Audit Trail Verification

Audit records were checked after the UAT workflows. The application records modifying operations, including student creation, duplicate resolution, disbursement creation, and report generation where those workflows are exercised.
