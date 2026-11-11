# SBMS SCREENSHOT INSERTION CHECKLIST

> Use this to capture, name, caption and place every screenshot the report needs. Routes were read from
> `frontend/src/App.jsx` at HEAD `cca0625`; capture at that commit so the figures match the code quoted in Chapter 5.

## 1. Before capturing

| Step | Command / action | Why |
| --- | --- | --- |
| 1 | `cd backend; npm start` | API on port 5000 |
| 2 | `cd backend; npm run seed:synthetic` | loads synthetic Kenyan demo data — **never** use real records |
| 3 | `cd frontend; npm run dev` | SPA on the Vite dev port, pointed at the API |
| 4 | Sign in as administrator, then as field officer (two browser profiles) | captions must name the role shown |
| 5 | Set the browser to 1440×900, zoom 100 %, hide bookmarks bar | consistent figure size |
| 6 | Clear any name/UPI that looks identifiable; keep synthetic names | G-05 (no real beneficiary data) |

Supplementary helpers that exist in `backend/package.json`: `npm run reset:synthetic` (returns the demo data to a
known state), `npm run seed:verification` (creates the verification accounts used for the live probes) and
`npm run db:provision-test` (the guarded test database — **do not** point it at the demo database).

## 2. Capture list

| ID | Figure | Screen / state | Route | Capture from | Caption must say |
| --- | --- | --- | --- | --- | --- |
| S-01 | 4.13 | Field-officer sign-in, empty | `/login` | local | role, date |
| S-02 | 4.13 (b) | Sign-in failure state (wrong password) | `/login` | local | "invalid credentials" |
| S-03 | 4.14 | Administrator sign-in | `/admin/login` | local | role, date |
| S-04 | 4.15 | Registry list with ≥ 8 synthetic students | `/students` | local | record count shown |
| S-05 | 4.15 (b) | Registry search/filter result | `/students` | local | filter used |
| S-06 | 4.16 | Registration form, top half (identity + school) | `/students/register` | local | fields visible: UPI, birth certificate, national ID |
| S-07 | 4.16 (b) | Registration form, lower half (guardian + eligibility inputs) | `/students/register` | local | continuation |
| S-08 | 4.17 | Validation error on submit (missing required field) | `/students/register` | local | which field |
| S-09 | 4.17 (b) | Post-registration screening notice, **advisory** wording visible | post-submit | local | "advisory only, not a decision" |
| S-10 | 4.18 | Eligibility result with score out of 100 and category | `/eligibility` | local | score, category |
| S-11 | 4.19 | Administrator dashboard (totals, six-month trend, recent activity) | `/dashboard` | local | date range |
| S-12 | 4.20 | Duplicate review queue with masked identifiers | `/duplicate-review` | local | "identifiers masked by default" |
| S-13 | 4.21 | Case dialog, masked comparison + per-feature evidence | `/duplicate-review` | local | case id (synthetic) |
| S-14 | 4.21 (b) | Case dialog after audited reveal | `/duplicate-review` | local | "reveal is logged" |
| S-15 | 4.21 (c) | Decision form with mandatory reason and a completed decision | `/duplicate-review` | local | decision made |
| S-16 | 4.22 | Award record with verification state and approval controls | `/students` (award panel) | local | state shown |
| S-17 | 4.22 (b) | Approval blocked while a duplicate case is open | `/students` | local | blocking message quoted |
| S-18 | 4.22 (c) | Payment recorded as issued + reconciliation entries | `/disbursements` | local | states |
| S-19 | 4.23 | Public verification, "no record found" | `/verify` | local **and** live (`sbms-web.azurewebsites.net/verify`) | environment |
| S-20 | 4.23 (b) | Public verification, record found (minimal disclosure) | `/verify` | local | "no personal data returned" |
| S-21 | Ch.5 | Certificate issued for an approved award | award panel | **local only** | "local build, HEAD cca0625 — not in the deployed image" |
| S-22 | Ch.5 | Certificate PDF / printed view | download | **local only** | same note |
| S-23 | Ch.5 | Public certificate verification: **Certificate verified** for a real issued certificate (QR token or printed reference) | `/verify-certificate` | **local only** | same note; a revoked-certificate figure is no longer required or permitted — revocation is not part of SBMS |
| S-24 | Ch.5 | Reports: date-range PDF export | `/reports` | local | range used |
| S-25 | Ch.5 | Audit log entries for the actions in S-09 … S-18 | `/audit` | local | "each state change is audited" |
| S-26 | Ch.5 | Users and settings screens | `/users`, `/settings` | local | admin-only |
| S-27 | Ch.5 | Terminal: `npm test` summary line (24 suites / 151 tests) | terminal | local | commit and date |
| S-28 | Ch.5 | Terminal: `unittest` summary (33 tests OK) | terminal | local | interpreter used |
| S-29 | Ch.5 | Live `/api/ready` JSON | browser/curl | **live** | URL, date |
| S-30 | Ch.5 | Live `/api/certificates/verify` 404 | browser/curl | **live** | used as evidence of the deployment lag |

## 3. Placement, caption and format rules

| Rule | Detail |
| --- | --- |
| File naming | `fig-4-16-registration-form.png` — figure number first, lower-case, hyphens |
| Format | PNG for UI, JPEG for photos of a phone scanning a QR code; no screenshots of screenshots |
| Resolution | 1440×900 or taller; crop only browser chrome, never the data |
| Caption | `Figure 4.n: <title>. <role> view, local build at commit cca0625, captured <YYYY-MM-DD>.` |
| Live captions | append `Live: https://sbms-web.azurewebsites.net/api image a3714f8.` |
| Local-only features | append `Local build at HEAD cca0625; the deployed image a3714f8 does not serve this route (HTTP 404).` |
| Redaction | mask UPI, birth certificate number and national ID with a bar unless the figure's purpose is to show the field exists |
| Text in figures | no caption may claim "validated", "production", "accurate" or "prevents fraud" |
| Terminal figures | include the command line and the final summary line; do not crop out the commit or the date |

## 4. Screenshots that do not yet exist and cannot be captured from the deployment

| Figure | Why it cannot come from the deployment | What to do |
| --- | --- | --- |
| S-19 (live half) | the live SPA is reachable, so this one **can** be live | capture both, label both |
| S-21, S-22, S-23 | certificate routes return 404 on the deployed API | capture locally at HEAD and label |
| S-25 (audit entries for certificate actions) | same | capture locally and label |
| Phone-camera QR scan | the feature does not exist (G-11) | do not stage a fake photo; show the printed QR and the manual-entry page instead |
| Restricted-network field use | not tested | omit, and say so in Chapter 5 limitations |

