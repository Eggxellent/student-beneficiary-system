# Current implementation verification

**Snapshot:** 25 November 2026; branch `fix/restore-original-ui`; HEAD `0080482354b35d3d784cd34bd05879c63f2fd326`; dirty working tree. These are source inspection findings, not a fresh runtime acceptance test.

## Guardian workflow

| Capability | Verdict | Evidence and limits |
|---|---|---|
| Guardian account registration | Implemented | `backend/src/routes/guardian.routes.js` exposes rate-limited `POST /register`; `guardian.controller.js` validates account fields, hashes password, creates Guardian account. UI: `frontend/src/pages/GuardianRegistration.jsx`. |
| Guardian login/authentication | Implemented | Shared `/api/auth/login`; Guardian routes use `authenticateToken` and `requireRole('guardian')`. Account flow is not a separate login API. |
| Submit student application | Implemented | Guardian-only `POST /applications`; controller validates application and eligibility fields, inserts `guardian_applications` with `under_review`, links/screen student in same transaction. `guardianApplicationLink.js`. UI: `NewApplication.jsx`. |
| View own applications | Implemented | `GET /applications` and `GET /applications/:reference`; queries are scoped to `req.user.id`. UI: `MyApplications.jsx`, `ApplicationDetails.jsx`. |
| Edit submitted application | Not implemented | No Guardian application PATCH/PUT route. `PATCH /me` edits Guardian profile only. `ApplicationDetails.jsx` explicitly says submitted applications cannot be edited. |
| Under Review read-only state | Implemented for Guardian UI | Details page is read-only and shows status; no edit action. Backend has no application edit endpoint. |
| Submission receipt | Partially implemented | API response supplies a generated application reference and submitted application; UI displays reference/date. No distinct receipt-generation/download/receipt endpoint was found. |
| Admin “More Info Required” | Not implemented | Status vocabulary is `submitted`, `under_review`, `approved`, `rejected`; decision schema has no `more_info_required`. Staff queue can review and set status through `PATCH /staff/applications/:id/status`. |
| Selectively reopen flagged fields/documents | Not implemented | No field-level editability/allowlist or reopening route found. |
| Guardian resubmission | Not implemented as a correction workflow | Duplicate submission handling is idempotent/returns existing application; it does not reopen arbitrary fields. |
| Approved/Rejected terminal states | Partially implemented | Guardian decision endpoint sets `decided_at` on approve/reject, but schema allows Admin to set `under_review` later; no immutable terminal transition is enforced here. Do not claim terminality. |

Additional evidence: `guardian.controller.js` status comments state submission itself is always under review and duplicate review is separate. Its `decisionSchema` permits `under_review|approved|rejected`. `guardianApplicationLink.js` links the new application to a student, screens it, and triggers automatic eligibility subject to duplicate clearance. The application schema requires fee balance, vulnerability, sibling count, prior-bursary history, and declaration.

## Other relevant local behavior

- Duplicate screening is an advisory ML score plus evidence/candidate handling; an administrator resolves review cases. See `backend/src/controllers/duplicateFlags.controller.js` and `backend/src/services/duplicateAggregation.js`.
- Student registration and Guardian application linkage use a Python prediction child process. An unavailable screening service prevents the Guardian submission from being committed, per `guardian.controller.js`.
- The award/certificate and eligibility flow is summarized separately in `03_ELIGIBILITY_AND_AWARD_FLOW.md`.

## Evidence limits

This is code-level verification. No browser session, API server, or database was started for this audit. Runtime behavior on a particular local database and exact UI build therefore remains unverified. Uncommitted changes are part of the inspected snapshot and reduce reproducibility.
