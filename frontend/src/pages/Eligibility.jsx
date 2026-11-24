import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";

// Read-only Field Officer view. Every value below is either what the guardian submitted or what the
// automatic assessment recorded; the page never calculates a score and never sends an assessment.
const CATEGORY_STYLES = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

const INPUT_LABELS = {
  fee_balance: "Fee balance",
  household_income: "Household income",
  vulnerability_status: "Vulnerability status",
  siblings_in_school: "Siblings in school",
  prior_bursary_history: "Prior bursary history",
};

const TRIGGER_LABELS = {
  registration_screening: "Assessed automatically when the guardian registration passed duplicate screening",
  duplicate_clearance: "Assessed automatically when an administrator cleared the duplicate case",
  officer_form: "Assessed through the officer form",
};

const fieldLabel = "text-[10px] font-bold uppercase tracking-wide text-slate-500";
const fieldValue = "mt-0.5 text-sm font-medium text-slate-800";
const selectClass =
  "mt-2 h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white";

const money = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? `KSh ${amount.toLocaleString("en-KE")}` : "Not supplied";
};

const text = (value) => (value === null || value === undefined || value === "" ? "Not supplied" : value);
const when = (value) => (value ? new Date(value).toLocaleString() : "Not recorded");
const inputLabel = (key) => INPUT_LABELS[key] || String(key).replaceAll("_", " ");

function formatInput(key, value) {
  if (value === null || value === undefined) return "Not supplied";
  if (key === "fee_balance" || key === "household_income") return money(value);
  return String(value);
}

function statusBadge(record) {
  const status = record.assessment?.status;
  if (status === "complete") {
    return { label: "Assessed", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (status === "incomplete") {
    return { label: "Incomplete", className: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  return { label: "No assessment", className: "border-slate-200 bg-slate-50 text-slate-600" };
}

export default function Eligibility() {
  const [searchParams] = useSearchParams();
  const requestedStudentId = searchParams.get("student");
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/students/eligibility-findings")
      .then((response) => {
        if (!active) return;
        const list = Array.isArray(response.data) ? response.data : [];
        setRecords(list);
        // The dashboard links straight to a student whose assessment needs attention.
        const requested = list.find((record) => record.id === requestedStudentId);
        const initial = requested || list[0] || null;
        setSelectedId(initial ? initial.id : "");
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setRecords([]);
        setSelectedId("");
        setError(err.response?.data?.message || "Unable to load eligibility findings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requestedStudentId]);

  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) || null,
    [records, selectedId]
  );
  const assessedCount = records.filter((record) => record.assessment?.status === "complete").length;

  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Eligibility findings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Calculated automatically by the eligibility engine from the guardian&apos;s submitted
          application. Read-only for Field Officers: no score is recalculated or re-entered here.
        </p>
      </header>

      {error && (
        <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Guardian registrations
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {records.length} record{records.length === 1 ? "" : "s"} · {assessedCount} assessed
            </p>
          </div>
          <div className="p-4">
            {loading ? (
              <p className="text-sm text-slate-500">Loading eligibility findings…</p>
            ) : records.length === 0 ? (
              <p className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No guardian registration has passed duplicate screening yet.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className={fieldLabel}>Student</span>
                  <select
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    className={selectClass}
                  >
                    {records.map((record) => (
                      <option key={record.id} value={record.id}>
                        {`${record.full_name} — ${record.school || record.school_name || "School not recorded"}`}
                      </option>
                    ))}
                  </select>
                </label>

                <ul className="mt-4 divide-y divide-slate-100">
                  {records.map((record) => {
                    const badge = statusBadge(record);
                    return (
                      <li key={record.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(record.id)}
                          aria-pressed={record.id === selectedId}
                          className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-xs hover:bg-slate-50 ${
                            record.id === selectedId ? "bg-slate-50" : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-800">
                              {record.full_name}
                            </span>
                            <span className="block truncate text-slate-500">
                              {record.school || record.school_name || "School not recorded"}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="border border-slate-200 bg-white">
          {selected ? (
            <FindingDetail record={selected} />
          ) : (
            <p className="p-6 text-sm text-slate-500">
              Select a guardian registration to view its findings.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function FindingDetail({ record }) {
  const application = record.application;
  const assessment = record.assessment;
  const badge = statusBadge(record);

  return (
    <div className="divide-y divide-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold uppercase tracking-wide text-slate-700">
            {record.full_name}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {record.school || record.school_name || "School not recorded"}
            {record.birth_certificate_number
              ? ` · Birth certificate ${record.birth_certificate_number}`
              : ""}
          </p>
        </div>
        <span
          className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Guardian submission
        </h3>
        {application ? (
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className={fieldLabel}>Application</dt>
              <dd className={fieldValue}>{text(application.reference)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Submitted</dt>
              <dd className={fieldValue}>{when(application.submitted_at)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Guardian</dt>
              <dd className={fieldValue}>{text(application.guardian_full_name)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Phone</dt>
              <dd className={fieldValue}>{text(application.guardian_phone)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Relationship</dt>
              <dd className={`${fieldValue} capitalize`}>
                {text(application.relationship_to_student)}
              </dd>
            </div>
            <div>
              <dt className={fieldLabel}>School</dt>
              <dd className={fieldValue}>{text(application.school_name)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Level</dt>
              <dd className={`${fieldValue} capitalize`}>{text(application.school_level)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Class / year</dt>
              <dd className={fieldValue}>{text(application.class_year)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>County</dt>
              <dd className={fieldValue}>{text(application.school_county)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Household size</dt>
              <dd className={fieldValue}>{text(application.household_size)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Income source</dt>
              <dd className={fieldValue}>{text(application.income_source)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>Monthly household income</dt>
              <dd className={fieldValue}>{money(application.monthly_income)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>{inputLabel("fee_balance")}</dt>
              <dd className={fieldValue}>{money(application.fee_balance)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>{inputLabel("siblings_in_school")}</dt>
              <dd className={fieldValue}>{text(application.siblings_in_school)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>{inputLabel("vulnerability_status")}</dt>
              <dd className={`${fieldValue} capitalize`}>{text(application.vulnerability_status)}</dd>
            </div>
            <div>
              <dt className={fieldLabel}>{inputLabel("prior_bursary_history")}</dt>
              <dd className={`${fieldValue} capitalize`}>{text(application.prior_bursary_history)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            No guardian application is linked to this record.
          </p>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Eligibility findings
        </h3>
        {!assessment ? (
          <p className="mt-2 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The eligibility engine has not recorded an assessment for this record yet. No score is shown.
          </p>
        ) : assessment.status === "complete" ? (
          <>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div
                className={`border p-3 ${
                  CATEGORY_STYLES[assessment.category] || CATEGORY_STYLES.low
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide">Eligibility category</p>
                <p className="mt-1 text-xl font-bold capitalize">{assessment.category}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3 text-slate-800">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Eligibility score
                </p>
                <p className="mt-1 text-xl font-bold">{Number(assessment.score)} / 100</p>
              </div>
              <div className="border border-sky-200 bg-sky-50 p-3 text-sky-900">
                <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">
                  Recommended bursary range
                </p>
                <p className="mt-1 text-lg font-bold">
                  {money(assessment.recommended_min)} – {money(assessment.recommended_max)}
                </p>
                {assessment.provisional && (
                  <p className="mt-1 inline-block bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                    Provisional
                  </p>
                )}
              </div>
            </div>

            {assessment.provisional && (
              <p className="mt-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No approved allocation ranges are configured, so these figures are a provisional
                proposal - not an official NG-CDF allocation limit. The authorised officer sets the
                final amount.
              </p>
            )}

            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {Object.keys(INPUT_LABELS).map((key) => (
                <div
                  key={key}
                  className="flex justify-between gap-3 border-b border-slate-100 pb-1"
                >
                  <dt className="text-slate-500">{INPUT_LABELS[key]}</dt>
                  <dd className="font-medium capitalize text-slate-800">
                    {formatInput(key, assessment.inputs?.[key])}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-600">
              {TRIGGER_LABELS[assessment.trigger] || "Assessed automatically"} ·{" "}
              {when(assessment.assessed_at)}
            </p>
            {assessment.source && <p className="mt-1 text-xs text-slate-500">{assessment.source}</p>}
          </>
        ) : (
          <>
            <div className="mt-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">
                Assessment incomplete — no score, category or bursary range was produced.
              </p>
              <p className="mt-1">
                The guardian registration supplied the household income, but these scoring inputs
                were never submitted, so the engine recorded them as missing instead of estimating
                them:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {(assessment.missing_inputs || []).map((key) => (
                  <li key={key}>{inputLabel(key)}</li>
                ))}
              </ul>
              <p className="mt-1">
                Nothing was estimated, and this screen does not allow manual entry or recalculation.
              </p>
            </div>

            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                <dt className="text-slate-500">Household income (from guardian)</dt>
                <dd className="font-medium text-slate-800">
                  {money(assessment.inputs?.household_income ?? application?.monthly_income)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                <dt className="text-slate-500">Missing inputs</dt>
                <dd className="font-medium text-slate-800">
                  {(assessment.missing_inputs || []).length}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-600">
              {TRIGGER_LABELS[assessment.trigger] || "Assessed automatically"} ·{" "}
              {when(assessment.assessed_at)}
            </p>
          </>
        )}

      </div>
    </div>
  );
}


