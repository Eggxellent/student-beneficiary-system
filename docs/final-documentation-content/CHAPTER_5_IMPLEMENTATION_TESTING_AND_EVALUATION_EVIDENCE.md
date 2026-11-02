# CHAPTER 5 EVIDENCE PACKAGE: IMPLEMENTATION, TESTING AND EVALUATION

> **What this file is.** The Chapter 5 entry point of the nine-file handover set: the implementation and test facts
> a writer may assert, their evidence, and the exact numbers with dates. Repository `student-beneficiary-system`,
> branch `fix/sbms-completion-work`, commit `d6b5032`.
>
> **Full detail:** `CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` (§5.1–§5.7),
> `SBMS_TEST_EVIDENCE_CATALOGUE.md` (every artefact, command and date), `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md`
> (features, artifact, metrics), `SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md` (environments, pipeline).

---

## 1. Implementation environment (evidence, not recollection)

| Item | Value | Status |
| --- | --- | --- |
| Operating system | Windows 11 (win32) | Recorded |
| Node.js / npm | v22.11.0 / 10.9.0 | Recorded |
| Python | 3.11.9 in a service virtual environment | Recorded |
| PostgreSQL | 17.11 client and server | Recorded |
| Docker | CLI 29.9.2; engine **not running** here, image built by CI | Recorded |
| Browser automation | Headless Chrome over the DevTools Protocol from Node 22's `WebSocket` | Recorded |
| Hardware specification | **Not recorded**; logs show 7.4 GB RAM with about 0.5 GB free | **Blocking gap G-01** |
| Test database | Disposable `sbms_test` on loopback, role `sbms_test_runner`, guarded by `testDatabaseGuard.js` | Recorded |

The hardware gap must be written as a gap. It is honest to say the workstation was not captured, that memory was
observed at 7.4 GB with about 0.5 GB free during sweeps, and that one sweep completed 149 or 150 of 151 tests
under memory pressure (G-02). It is not honest to invent a processor, memory size or storage type.

## 2. Test results: the only counts that may be quoted

| Level | Command | Result | Date |
| --- | --- | --- | --- |
| Backend Jest, whole tree | `npx jest --runInBand tests` | **24 suites / 151 tests pass** | 2026-11-01 |
| Backend Jest, earlier generation | `npm test` | 21 suites / 128 tests pass | 2026-10-31 |
| Backend native, in-process | `node --test` over seven files | **43/43 pass** | 2026-10-31 |
| Backend native, out-of-process | `node --test test/api.smoke.test.js` | **3/3 pass** | 2026-10-31 |
| Frontend production build | `npm.cmd --prefix frontend run build` | **exit 0**, 2 006 modules, 10.11 s | 2026-11-01 |
| ML service | `unittest discover -s ml-service/tests` | **33/33 pass** | 2026-10-31 |
| ML research helper | `unittest discover -s experiments/sbms_dataset` | **7/7 pass** | 2026-10-31 |
| Browser: registration and review | `node scripts/browser-smoke.mjs` | **23/23 pass** | 2026-10-30 |
| Browser: QR page | `node scripts/qr-smoke.mjs` | **9/9 pass** | 2026-10-30 |
| Browser: registration fields, live deployment | `node scripts/registration-fields-smoke.mjs` | **11/11 pass** | 2026-11-01 |
| Database restore | `pg_dump` then `pg_restore` into an independent database | Pass, digests compared | 2026-10-31 |
| Phone-camera QR scan | manual | **Not run** | — |
| Browser check of `/verify-certificate` | no harness exists | **Not run** | — |
| User acceptance | — | **Not conducted** | — |
| Load or scale test | — | **Not run** | — |
| Docker build in this environment | — | **Not run** (engine unavailable) | — |

**Two rules, both mandatory.** A count is never quoted without its date, because the suite grew from 21/128 to
24/151 between 2026-10-31 and 2026-11-01. And counts are never summed across levels: 151 Jest tests, 46 native
tests, 43 browser checks, 40 Python tests are four separate positions, not a total of 280.

`scripts/admin-reveal-smoke.mjs` exists but was **not** re-run (the seeded administrator password had drifted).
It is listed as not run, not as passed and not as skipped.

## 3. Implementation by feature: what the code does

| Feature | Implementation | Tests |
| --- | --- | --- |
| Authentication and RBAC | Two sign-in endpoints, JWT, role re-read, user administration | 4 + 6 + 1 |
| Registration and validation | Zod schema, five-school constraint, phone and identifier normalisation | 9 |
| Duplicate screening | Advisory lock, whole-registry comparison, Python subprocess, `top-1` aggregation, provenance | 15 + 13 + 8 + 6 + 1 + 4 |
| Duplicate review | Masked queue, audited reveal, decision with reason, terminal states | 9 |
| Eligibility scoring | Five weighted factors, four categories, persisted result | Route and validation only |
| Award lifecycle | Submission, verification with evidence, approval and rejection with reasons | 5 |
| Payments and reconciliation | Issue, clearance with evidence, officer-assisted acknowledgement, discrepancy detection, exceptions | 4 + 4 + 4 |
| Student QR identification | 32 random bytes, fragment token, existence-only endpoint, dedicated limiter | 10 + 4 |
| Award certificates | Snapshot row, reference, token, A4 landscape PDF, revocation, `not_current` | 12 + 5 |
| Dashboard, reports, audit, settings | Totals and trend, date-range PDF, audit trail, three cut-offs | 6 (authorisation); content by inspection |
| Operations | Health, readiness, start-up guards, migration ledger | 1 + 5 + migration unit tests |

## 4. Machine-learning evaluation: the four numbers that are defensible

| Item | Value | Basis |
| --- | --- | --- |
| Model | XGBoost over six similarity features | `ml-service/model/`, `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §5 |
| Live cut-off | 0.50: precision 0.9204, recall 0.8927, F1 0.9063, miss 10.73% | Synthetic test partition; operating-point script output |
| Hard-negative false-positive rate at 0.50 | 7.72% | Same partition; the number to quote for "how often a wrong pair is flagged" |
| Independent per-pair baseline | 0.35% of 2 000 synthetic unrelated pairs | `docs/ml-evaluation-baseline-2026-10.md` |

The 7.72% and 0.35% answer **different questions** (one is the operating point on a constructed hard-negative
set, the other a base rate on unrelated pairs). Quote both or neither; quoting one alone misleads. Ranking
quality: ROC-AUC 0.9685, PR-AUC 0.9727. Every figure is synthetic, so no real-world accuracy claim is available.

**The distinction the chapter must preserve:** these are pair-level classification metrics on generated data.
They are not beneficiary-level duplicate-detection performance and they do not survive contact with real records
until adjudicated labels exist.

**Research-only artifact:** `ml-service/model/research/rf_attachment_style_candidate.joblib` is a ten-feature
Random Forest candidate. It is not the production model, and its metrics must not be mixed with the six-feature
model's (§5.3.4, `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` §11).

## 5. Defects: six with a fix and a test, others pointed to

| # | Defect | Resolution | Validation |
| --- | --- | --- | --- |
| 1 | Duplicate sweep could double-flag under concurrency | Advisory lock around the sweep | Concurrency tests |
| 2 | Reveal endpoint leaked full identifiers before adjudication | Masked by default; reveal audited | Route tests |
| 3 | QR token in the path was logged | Token moved to the URL fragment | Route and browser tests |
| 4 | Certificate PDF ignored `not_current` awards | Snapshot row plus explicit state check | 12 route tests |
| 5 | Readiness endpoint returned healthy with a stale queue | Queue freshness check added | Readiness tests |
| 6 | Payment recorded without verification state | Database-level gate in addition to the API check | Integration tests |

The wider defect history — date-of-birth feature skew, registration 500, the deployed `/api/verify` 404, the
queue-closes-on-open bug and the readiness false pass — is recorded in
`docs/SBMS_PROJECT_HANDOVER_2026-10.md` §13.2–§13.4 and `docs/azure-deployment-log-2026-10-31.md` §7–§8.
Chapter 5 §5.4.7 scopes its table to the six and points to these sources rather than implying completeness.

## 6. Evaluation: what the evidence supports

| Objective (Chapter 1) | Extent achieved | Limitation that must be stated |
| --- | --- | --- |
| (i) Investigate existing registration and tracking challenges | Achieved as literature and workflow analysis | No field study, no interviews recorded |
| (ii) Design architecture, schema and ML pipeline | Achieved and implemented | Classifier deviates from the proposal (G-21) |
| (iii) Implement registration, unique identifiers, QR and RBAC | Achieved | Physical QR scan not exercised (G-11) |
| (iv) Validate, test and evaluate | Partly achieved | No real data, no user acceptance, no load test |

What the tests establish: the delivered behaviour matches the specified behaviour at route and workflow level,
across 151 backend tests, 43 browser checks and 40 Python tests, with a reproducible command for each.
What they do not establish: fitness for a real bursary office, accuracy on real records, usability, scale, or
production assurance.

## 7. Limits of the evidence itself

| Limit | Consequence for the chapter |
| --- | --- |
| Results are recorded from runs on one workstation, not from CI for every suite | The chapter states the command, environment and date for each count |
| Two test generations exist (21/128 and 24/151) | Only the dated, current generation is quoted; the older one is footnoted if mentioned at all |
| One sweep was incomplete under memory pressure | The stability caveat appears wherever the 151 figure appears |
| Browser checks depend on a seeded account; one harness was not re-run | The chapter says so rather than implying a full browser sweep |
| No user acceptance, no load test, no phone capture, no production assurance | Each is named as a gap, with the gap ID |

## 8. Open items affecting Chapter 5

| Item | Effect | Owner |
| --- | --- | --- |
| G-01 hardware specification | §5.2.1 cannot be completed | Author |
| G-06 user-acceptance position | §5.5.6 stays empty; NFR-14 stays partial | Author |
| G-11 phone-camera scan | The identification mechanism rests on a headless-browser check | Author |
| G-02 149/150-of-151 instability | Every 151 figure needs the caveat | Author |
| G-25 two test-count generations | A count without a date is misleading | Author |

## 9. Related files

`CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md` (the chapter), `SBMS_TEST_EVIDENCE_CATALOGUE.md` (test
inventory), `SBMS_ML_SUBSYSTEM_DOCUMENTATION.md` (ML evidence), `MASTER_EVIDENCE_REGISTER.md` (evidence IDs).


