# SBMS UI SCREEN AND WORKFLOW INVENTORY

**Prepared:** 2026-11-02
**Revision described:** `fix/sbms-completion-work` @ `d6b5032`
**Sources read:** `frontend/src/App.jsx`, every file in `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/context/AuthContext.jsx`, `frontend/src/hooks/useHashToken.js`, `frontend/src/services/api.js`, and the three browser harnesses in `scripts/`.

---

## 1. Application shell and routing

The frontend is a single-page React application built with Vite and routed with `react-router-dom`. Every route is declared in `frontend/src/App.jsx`; there is no server-side rendering and no separate admin application.

| Path | Component | Guard | Roles admitted |
| --- | --- | --- | --- |
| `/login` | `Login` | none | anyone |
| `/admin/login` | `Login role="admin"` | none | anyone (endpoint decides) |
| `/field-officer/login` | `Login role="field_officer"` | none | anyone (endpoint decides) |
| `/verify` | `Verification` | none | public |
| `/verify-certificate` | `CertificateVerification` | none | public |
| `/dashboard` | `DashboardHome` | authenticated | admin renders the dashboard; officer is redirected to `/field-officer` |
| `/field-officer` | `FieldOfficerDashboard` | authenticated | field officer |
| `/students` | `Students` | `ProtectedPage` | field officer |
| `/students/register` | `StudentRegistration` | `ProtectedPage` | field officer |
| `/eligibility` | `Eligibility` | `ProtectedPage` | field officer |
| `/duplicate-review` | `DuplicateReview` | `ProtectedPage` | admin |
| `/disbursements` | `Disbursements` | `ProtectedPage` | admin and field officer |
| `/reports` | `Reports` | `ProtectedPage` | admin |
| `/settings` | `Settings` | `ProtectedPage` | admin |
| `/audit` | `AuditLogs` | `ProtectedPage` | admin |
| `/users` | `UserManagement` | `ProtectedPage` | admin |
| `/` | redirect | authenticated | to `/dashboard` |

`ProtectedRoute` waits for `authLoading`, redirects an unauthenticated visitor to `/login`, and redirects a role mismatch to `/dashboard`. The guard is a **convenience, not a control**: every page's data still arrives from role-guarded endpoints, so a user who forced a route into the DOM would see an empty page and 403 responses rather than another role's data.

## 2. Shared frontend infrastructure

| Element | File | Behaviour |
| --- | --- | --- |
| Axios instance | `services/api.js` | `baseURL` is `VITE_API_ORIGIN + /api` when configured, otherwise `/api`; a request interceptor attaches `Authorization: Bearer <token>` from `localStorage` |
| Auth context | `context/AuthContext.jsx` | Loads the current user from `GET /auth/me` on mount, exposes `isAuthenticated`, `user`, `authLoading`, sign-in and sign-out |
| Layout | `components/AppLayout.jsx` | Sidebar navigation with role-specific entries, header with the signed-in user and a sign-out action |
| Public layout | `components/PublicVerificationLayout.jsx` | Minimal centred shell used by both public verification pages, with no navigation and no authenticated data |
| Hash-token hook | `hooks/useHashToken.js` | Reads `window.location.hash`, captures the token during render (so React StrictMode's double effect cannot strip it before the second pass), removes it with `history.replaceState`, and re-runs on `hashchange` |
| Certificate panel | `components/AwardCertificatePanel.jsx` | Issue, read, print and download controls for an award certificate; used inside the disbursement screen |

The hash-token hook exists because of a real defect: verifying once on mount left a stale result when a second QR code was opened in the same tab. That defect, its fix and the StrictMode regression it exposed are recorded in `docs/qr-verification-2026-10-30.md` §4.

## 3. Public screens

### 3.1 `/verify` — student QR verification

| Property | Detail |
| --- | --- |
| Data loaded | None on mount; a token from the fragment is POSTed to `/api/verify` |
| Success state | A single line, "Record found" |
| Refusal states | A single line for an unknown, malformed or absent token; "Verification is temporarily unavailable" for a 429 or 503 |
| Data shown | **Nothing else.** No name, school, date of birth, identifier or phone number |
| URL hygiene | The token is removed from the visible address bar before the request is sent |
| Evidence | `scripts/qr-smoke.mjs` 9/9 (2026-10-30) asserts each of the above, including that a query-string token is rejected and that a second code in the same tab re-verifies |

### 3.2 `/verify-certificate` — certificate authenticity

| Property | Detail |
| --- | --- |
| Data loaded | Token from the fragment, or a typed printed reference, POSTed to `/api/certificates/verify` |
| Success state | Authenticity facts: certificate reference, beneficiary name, institution, programme, constituency, award period, approved amount, issue date, approval date, issuing authority |
| Refusal states | `not_recognised`, `not_current`, or a temporary-unavailability line |
| Data shown | No UPI or other identifier, date of birth, national ID, guardian or phone details, address, or the verification token |
| Evidence | API contracts covered by `certificateVerificationRoute.test.js` (5) and `bursaryCertificates.test.js` (12); **no browser harness exists for this page** |

### 3.3 Sign-in screens

| Route | Behaviour |
| --- | --- |
| `/login` | Shared sign-in that presents both roles |
| `/admin/login` | Administrator sign-in; posts to `/api/auth/login/admin` |
| `/field-officer/login` | Field-officer sign-in; posts to `/api/auth/login/field-officer` |

A wrong-role attempt returns 403 from the API with a plain sentence telling the user which door to use, and the page surfaces that sentence rather than a generic failure.

## 4. Field-officer screens

### 4.1 `/field-officer` — officer workspace

| Property | Detail |
| --- | --- |
| Purpose | Entry point for a field officer after sign-in; shows the officer's next actions rather than administrator totals |
| Data loaded | Uses the authenticated user from context; no administrator endpoint is called |
| Actions | Navigation to registration, registry and eligibility |

### 4.2 `/students` — registry list

| Property | Detail |
| --- | --- |
| Data loaded | `GET /students` |
| Shown | Student rows returned by the endpoint |
| Actions | Open a student (single read), navigate to registration |
| Limitation | The endpoint has no pagination or filter parameters, so the screen renders the whole array as returned; a large register would be rendered client-side |

### 4.3 `/students/register` — registration and screening confirmation

| Property | Detail |
| --- | --- |
| Data loaded | `GET /students/schools` for the school picker |
| Inputs | Full name (required), date of birth, school (required, five options), national ID, primary phone, guardian ID, **UPI**, **birth certificate number** |
| Validation | Client-side required fields; the server-side Zod schema is authoritative and its `errors` block is surfaced |
| Success state | The created student, the QR image, and plain-language screening information: a possible-match sentence, the exact-identifier sentence when applicable, and counts ("checked against N existing students; M flagged; K recorded in the audit log without a separate case") |
| Refusal state | The API's error sentence in an error panel, with **no confirmation panel** |
| Deliberate omission | No model version, no cut-off, no score and no `risk_level`: the officer sees wording, not model internals |
| Evidence | `scripts/browser-smoke.mjs` checks 2-14; `scripts/registration-fields-smoke.mjs` 11/11 against the live deployment |

The UPI and birth-certificate inputs were added on 2026-11-01 because the critical exact-identifier rule could otherwise fire only for seeded rows. Both are optional: a guardian may not have the document at the counter, and a blank box is dropped from the payload rather than sent as an empty string.

### 4.4 `/eligibility` — rule-based scoring

| Property | Detail |
| --- | --- |
| Data loaded | `GET /students` for the student picker |
| Inputs | Fee balance, household income, vulnerability status, siblings in school, prior bursary history |
| Action | `POST /eligibility` |
| Result shown | Score, category, per-factor breakdown and the reason sentences produced by `services/eligibility.js` |
| Persistence | Score, category and assessment time are written back to the student row |
| Limitation | The arithmetic has no automated test (FR-12), so a defect in the banding would not be caught by the suite |

### 4.5 `/disbursements` — awards, payments, reconciliation and certificates

| Property | Detail |
| --- | --- |
| Data loaded | `GET /awards`, `GET /students` |
| Award actions | Submit application (`POST /awards`), record verification (`POST /awards/:id/verification`), approve or reject (`PATCH /awards/:id/decision`) |
| Payment actions | Record payment (`POST /disbursements`), change payment status (`PATCH /disbursements/:id/payment-status`), record acknowledgement (`PATCH /disbursements/:id/acknowledgement`), link a legacy payment (`PATCH /disbursements/:id/award`) |
| Certificate panel | `AwardCertificatePanel` issues, reads and prints certificates through `/awards/:id/certificate*` |
| Role behaviour | The page renders for both roles; controls are permitted by the API, so an officer attempting an administrator-only action receives 403 |
| Known asymmetry | The student picker calls `GET /students`, which is officer-only; for an administrator that call returns 403 and the picker has no data (inspection finding, `SBMS_API_ENDPOINT_CATALOGUE.md` §7.2) |
| Evidence | Payment and award rules are covered by 20 API tests; **no browser harness drives this screen** |

## 5. Administrator screens

### 5.1 `/dashboard` — administrative dashboard

| Property | Detail |
| --- | --- |
| Data loaded | `GET /admin/dashboard` |
| Shown | Registry, duplicate, award and payment totals; a six-month registration and payment trend; recent audit activity |
| Limitation | Each counter's arithmetic is not individually tested (FR-25); the endpoint is authorised and the screen is browser-checked as reachable |

### 5.2 `/duplicate-review` — adjudication queue

| Property | Detail |
| --- | --- |
| Data loaded | `GET /duplicate-flags` |
| Shown | Per case: priority band, model score, model version, cut-off, reason, masked identifiers. Policy line: both cut-offs, the aggregation policy, and the statement that the thresholds are provisional |
| Actions | Select a case, reveal identifiers (`GET /duplicate-flags/:id/identifiers`, audited), record a decision (`PATCH /duplicate-flags/:id`) with a reason of at least five characters |
| Colour rule | Red only for exact identifier agreement; amber for any other review case; green when nothing is flagged |
| Deliberate design | No control can approve, reject or pay anything; the screen produces a decision record and the award and payment gates read that record |
| Evidence | `scripts/browser-smoke.mjs` checks 15-23 (queue contents, both cut-offs, model version, "score is not a decision", audit counters) |

### 5.3 `/reports` — PDF export

| Property | Detail |
| --- | --- |
| Data loaded | `GET /reports/export?start_date=&end_date=` |
| Actions | Choose a range and download the PDF |
| Validation | The API refuses a missing range and a reversed range; the screen surfaces the message |
| Limitation | The PDF's content is verified by inspection only (FR-26) |

### 5.4 `/settings` — duplicate cut-offs

| Property | Detail |
| --- | --- |
| Data loaded | `GET /settings/threshold` |
| Inputs | High-priority cut-off, review cut-off, model review cut-off |
| Action | `PUT /settings/threshold` |
| Validation | Each value 0-1; the high-priority cut-off must be greater than or equal to the review cut-off |
| Persistence | Process memory only; a restart restores environment defaults (`SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §5) |

### 5.5 `/audit` and `/users`

| Screen | Data loaded | Actions | Notes |
| --- | --- | --- | --- |
| `/audit` | `GET /audit-logs` | Read; screening counters are rendered as readable text rather than raw JSON | Append-only by convention only |
| `/users` | `GET /users` | Create an account (`POST /users`), change a role (`PATCH /users/:id/role`) | Self-demotion and last-administrator removal are refused by the API |

## 6. Workflow walkthroughs as the interface presents them

| Workflow | Screens in order | What the user sees at each step |
| --- | --- | --- |
| Register and screen a beneficiary | `/field-officer/login` → `/students/register` → confirmation panel | Sign-in → form → created student, QR image, plain-language screening outcome |
| Adjudicate a duplicate | `/admin/login` → `/duplicate-review` → case detail → decision form | Queue with priority → masked identifiers, score, cut-offs → reason prompt → confirmation that the decision was recorded |
| Award and pay | `/students/register` → `/disbursements` (submit, verify, approve) → record payment → clear → acknowledge | Each step either succeeds or returns a named reason (not verified, duplicate open, amount exceeded, evidence missing) |
| Identify a student | Printed QR → phone camera → `/verify` | One line: record found or not, and nothing else |
| Verify a certificate | Printed certificate → `/verify-certificate` | Authenticity facts for a verified certificate, or not current / not recognised |
| Administrative review | `/dashboard`, `/reports`, `/audit`, `/users`, `/settings` | Totals, exported PDF, history, accounts, cut-offs |

## 7. Interface states

| State | Presentation |
| --- | --- |
| Loading | `ProtectedRoute` renders nothing while `authLoading` is true, so a protected page cannot flash before authentication resolves |
| Empty | Lists render with no rows rather than a placeholder message |
| Error | Panels show the server's `message`; a 5xx shows `Internal server error`, never a stack |
| Refused action | The sentence names the missing precondition, e.g. `Verify the beneficiary before approving this award.` |
| Role mismatch | Redirect to `/dashboard`, or a 403 sentence naming the correct sign-in page |

## 8. Accessibility and responsiveness: what is and is not established

| Aspect | State |
| --- | --- |
| Layout | Responsive, single-column on narrow viewports |
| Keyboard operation | Standard form controls and buttons; no custom widget with bespoke key handling was introduced |
| Colour | Status colour is always accompanied by text, so meaning does not depend on colour alone |
| Contrast, font scaling, screen-reader labelling | **Not audited** |
| Automated accessibility testing | **None** |
| Usability testing with officers | **None** (G-06) |

NFR-14 must therefore be reported as partially verified on the strength of browser checks that assert rendered text, classes and navigation, not on any accessibility or usability evidence.

## 9. Screens that do not exist

| Absent screen | Consequence |
| --- | --- |
| Password reset or change | A user cannot recover an account unaided, and the live administrator password has already drifted from the stored secret |
| Student edit or delete | The API exposes create, list and read only; a typo cannot be corrected through the interface |
| QR token re-issue | A student row without a token cannot be given one (FR-35) |
| Payment execution | Payments are recorded, never transferred (FR-37) |
| Case assignment | Deliberately absent: any administrator may take any case |
| Notification or messaging | No email, SMS or in-app notification exists |

## 10. Mapping to the Chapter Four interface figures

| Figure in Chapter Four | Screen | Evidence available for the figure |
| --- | --- | --- |
| Fig. 4.13 sign-in | `/login`, `/admin/login`, `/field-officer/login` | Screenshot not captured (G-04) |
| Fig. 4.14 registry list | `/students` | Screenshot not captured |
| Fig. 4.15 eligibility | `/eligibility` | Screenshot not captured |
| Fig. 4.16 registration form | `/students/register` | Screenshot not captured; field list verified by the 11-check harness |
| Fig. 4.17 screening confirmation | `/students/register` success panel | Screenshot not captured; text verified by browser checks 3-7 |
| Fig. 4.18 dashboard | `/dashboard` | Screenshot not captured |
| Fig. 4.19 duplicate review | `/duplicate-review` | Screenshot not captured; contents verified by browser checks 15-21 |
| Fig. 4.20 awards and certificates | `/disbursements` plus the certificate panel | Screenshot not captured |
| Fig. 4.21 administrative support screens | `/reports`, `/audit`, `/users`, `/settings` | Screenshot not captured |
| Fig. 4.22 student verification page | `/verify` | Screenshot not captured; behaviour verified by 9 browser checks |
| Fig. 4.23 certificate verification page | `/verify-certificate` | Screenshot not captured; behaviour verified at API level only |

Every screenshot must be taken against synthetic data and checked for real beneficiary details before insertion (G-05). No screenshot in this folder may show a live deployment record created during testing, including the two `E2E Probe` students named in the deployment log.



