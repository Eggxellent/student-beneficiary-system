import { Fragment, useEffect, useState } from "react";
import { BadgeCheck, CircleCheck, Eye, FlaskConical, ShieldAlert, X } from "lucide-react";
import api from "../services/api";

const sampleStudent = (full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number) => ({
  full_name,
  date_of_birth,
  school_code,
  guardian_id,
  upi,
  birth_certificate_number,
});

const evaluationPairs = [
  // Critical: an exact UPI or birth certificate match always requires action.
  {
    label: "Exact same student record",
    first: sampleStudent("Nia Wanjiku", "2008-04-12", "SCH-041", "G-481725", "UPI-041", "BC-2008-041"),
    second: sampleStudent("Nia Wanjiku", "2008-04-12", "SCH-041", "G-481725", "UPI-041", "BC-2008-041"),
  },
  {
    label: "UPI reused with a different name and date of birth",
    first: sampleStudent("Brian Otieno", "2007-02-16", "SCH-052", "G-520041", "UPI-052", "BC-2007-052"),
    second: sampleStudent("Kevin Kiptoo", "2009-11-03", "SCH-091", "G-910037", "UPI-052", "BC-2009-091"),
  },
  {
    label: "Birth certificate reused after a name change",
    first: sampleStudent("Mary Wanjiku", "2006-06-18", "SCH-061", "G-610019", "UPI-061", "BC-2006-061"),
    second: sampleStudent("Faith Njeri", "2008-09-21", "SCH-092", "G-920014", "UPI-092", "BC-2006-061"),
  },
  {
    label: "Both unique identifiers match",
    first: sampleStudent("Achieng Otieno", "2011-08-07", "SCH-108", "G-10832", "UPI-108", "BC-2011-108"),
    second: sampleStudent("Achieng Otieno", "2011-08-07", "SCH-108", "G-10832", "UPI-108", "BC-2011-108"),
  },
  {
    label: "UPI match despite spaces and letter case",
    first: sampleStudent("Peter Ochieng", "2009-01-24", "SCH-024", "G-240021", "UPI-TEST-204", "BC-2009-024"),
    second: sampleStudent("Peter Ochieng", "2009-01-24", "SCH-024", "G-240021", "upi test 204", "BC-2009-024B"),
  },
  {
    label: "Birth certificate match despite formatting differences",
    first: sampleStudent("Zawadi Muthoni", "2012-05-30", "SCH-030", "G-300035", "UPI-030", "BC-2012-030"),
    second: sampleStudent("Zawadi Muthoni", "2012-05-30", "SCH-030", "G-300035", "UPI-030B", "bc 2012 030"),
  },
  {
    label: "Possible UPI entry error across two applicants",
    first: sampleStudent("Samuel Mwangi", "2006-11-08", "SCH-008", "G-800007", "UPI-70008", "BC-2006-008"),
    second: sampleStudent("Jane Wambui", "2010-07-12", "SCH-112", "G-112008", "UPI-70008", "BC-2010-112"),
  },

  // Review: similar identity details, but no unique identifier is shared.
  {
    label: "Same name, date, school, and guardian; identifiers differ",
    first: sampleStudent("Amina Hassan", "2010-05-14", "SCH-114", "G-11401", "UPI-114", "BC-2010-114"),
    second: sampleStudent("Amina Hassan", "2010-05-14", "SCH-114", "G-11401", "UPI-115", "BC-2010-115"),
  },
  {
    label: "Small name typo with matching date, school, and guardian",
    first: sampleStudent("Amina Njeri", "2008-04-12", "SCH-101", "G-10101", "UPI-101", "BC-2008-101"),
    second: sampleStudent("Amina Njerii", "2008-04-12", "SCH-101", "G-10101", "UPI-102", "BC-2008-102"),
  },
  {
    label: "Name spelling variation across otherwise matching details",
    first: sampleStudent("Achieng Otieno", "2011-08-07", "SCH-108", "G-10832", "UPI-108A", "BC-2011-108A"),
    second: sampleStudent("Achieng Otiieno", "2011-08-07", "SCH-108", "G-10832", "UPI-108B", "BC-2011-108B"),
  },
  {
    label: "One-day date entry difference with matching identity details",
    first: sampleStudent("Mercy Wanjiku", "2010-11-03", "SCH-203", "G-20311", "UPI-203A", "BC-2010-203A"),
    second: sampleStudent("Mercy Wanjiku", "2010-11-04", "SCH-203", "G-20311", "UPI-203B", "BC-2010-203B"),
  },
  {
    label: "Same name and date after a school transfer",
    first: sampleStudent("Collins Omondi", "2009-12-01", "SCH-010", "G-10009", "UPI-010A", "BC-2009-010A"),
    second: sampleStudent("Collins Omondi", "2009-12-01", "SCH-016", "G-16009", "UPI-010B", "BC-2009-010B"),
  },
  {
    label: "Possible duplicate with a surname typo and matching supporting fields",
    first: sampleStudent("Kevin Kiptoo", "2007-01-15", "SCH-005", "G-50043", "UPI-005A", "BC-2007-005A"),
    second: sampleStudent("Kevin Kiptu", "2007-01-15", "SCH-005", "G-50043", "UPI-005B", "BC-2007-005B"),
  },

  // Clear: overlap is limited to common or non-unique attributes.
  {
    label: "Twins share date, school, and guardian but have different names",
    first: sampleStudent("Wanjiru Kamau", "2012-03-10", "SCH-310", "G-31002", "UPI-310A", "BC-2012-310A"),
    second: sampleStudent("Brian Otieno", "2012-03-10", "SCH-310", "G-31002", "UPI-310B", "BC-2012-310B"),
  },
  {
    label: "Siblings share a guardian and school",
    first: sampleStudent("Esther Akinyi", "2007-03-14", "SCH-027", "G-27053", "UPI-027", "BC-2007-027"),
    second: sampleStudent("Joseph Maina", "2009-08-30", "SCH-027", "G-27053", "UPI-028", "BC-2009-028"),
  },
  {
    label: "Common surname and same school only",
    first: sampleStudent("Susan Otieno", "2007-01-12", "SCH-039", "G-39067", "UPI-039", "BC-2007-039"),
    second: sampleStudent("Brian Otieno", "2009-05-22", "SCH-039", "G-39068", "UPI-040", "BC-2009-040"),
  },
  {
    label: "Similar names but different dates and identity details",
    first: sampleStudent("John Kamau", "2005-05-10", "SCH-121", "G-12101", "UPI-121", "BC-2005-121"),
    second: sampleStudent("John Kamao", "2008-11-14", "SCH-909", "G-90999", "UPI-122", "BC-2008-909"),
  },
  {
    label: "Same date of birth only",
    first: sampleStudent("Daniel Kibet", "2006-02-14", "SCH-030", "G-30057", "UPI-030A", "BC-2006-030A"),
    second: sampleStudent("Mercy Wanjiru", "2006-02-14", "SCH-031", "G-31058", "UPI-031", "BC-2006-031"),
  },
  {
    label: "Same school only",
    first: sampleStudent("Ann Wambui", "2005-07-19", "SCH-032", "G-32059", "UPI-032", "BC-2005-032"),
    second: sampleStudent("Robert Otieno", "2007-11-03", "SCH-032", "G-32060", "UPI-033", "BC-2007-033"),
  },
  {
    label: "Same guardian only",
    first: sampleStudent("Victor Omondi", "2004-04-09", "SCH-033", "G-33061", "UPI-033A", "BC-2004-033A"),
    second: sampleStudent("Cynthia Achieng", "2006-10-25", "SCH-034", "G-33061", "UPI-034", "BC-2006-034"),
  },
  {
    label: "Exact name and birthdate only; school and guardian differ",
    first: sampleStudent("Amina Hassan", "2010-05-14", "SCH-114", "G-11401", "UPI-114", "BC-2010-114"),
    second: sampleStudent("Amina Hassan", "2010-05-14", "SCH-115", "G-11501", "UPI-115", "BC-2010-115"),
  },
];

export default function DuplicateReview() {
  const [flags, setFlags] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFlagId, setSelectedFlagId] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanSummary, setScanSummary] = useState(null);

  function fetchFlags() {
    setLoading(true);
    api.get("/duplicate-flags?status=pending")
      .then((response) => setFlags(response.data))
      .catch((err) => setError(err.response?.data?.message || "Failed to load duplicate flags."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFlags();
    runEvaluation();
  }, []);

  function resolveFlag(id, status) {
    setError("");
    api.patch(`/duplicate-flags/${id}`, { status })
      .then(() => fetchFlags())
      .catch((err) => setError(err.response?.data?.message || "Failed to update duplicate flag."));
  }

  async function runEvaluation() {
    setEvaluationLoading(true);
    setError("");
    try {
      const response = await api.post("/duplicate-flags/evaluate", { pairs: evaluationPairs });
      setEvaluation(response.data.results);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to evaluate synthetic records.");
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function scanExistingRecords() {
    setScanLoading(true);
    setError("");
    setScanSummary(null);
    try {
      const response = await api.post("/duplicate-flags/scan");
      setScanSummary(response.data);
      const flagsResponse = await api.get("/duplicate-flags?status=pending");
      setFlags(flagsResponse.data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to scan existing student records.");
    } finally {
      setScanLoading(false);
    }
  }

  function evidence(flag) {
    const evidenceFields = [
      { label: "Name", key: "name", student: flag.student_name, matched: flag.matched_student_name },
      { label: "Date of birth", key: "date_of_birth", student: flag.student_date_of_birth, matched: flag.matched_date_of_birth },
      { label: "School", key: "school", student: flag.student_school, matched: flag.matched_school },
      { label: "Guardian", key: "guardian", student: flag.student_guardian_id, matched: flag.matched_guardian_id },
      { label: "UPI", key: "upi", student: flag.student_upi, matched: flag.matched_upi },
      { label: "Birth certificate", key: "birth_certificate", student: flag.student_birth_certificate_number, matched: flag.matched_birth_certificate_number },
    ];

    return evidenceFields.map((item) => {
      const maximum = Number(flag.score_maximums?.[item.key] || 0);
      const contribution = Number(flag.score_breakdown?.[item.key] || 0);
      return {
        ...item,
        similarity: maximum ? Math.min(100, contribution / maximum * 100) : 0,
      };
    });
  }

  const evaluationCounts = {
    critical: evaluation?.filter((result) => result.decision === "critical" || result.decision === "duplicate").length || 0,
    review: evaluation?.filter((result) => result.decision === "review").length || 0,
    clear: evaluation?.filter((result) => result.decision === "clear").length || 0,
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Duplicate Review</h1>
      <p className="mb-4 rounded border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900">
        <strong>Critical identifier rule:</strong> UPI and birth certificate numbers must not be shared between students. Any exact match is flagged as critical; both records stay blocked from disbursement until an administrator resolves it.
      </p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Review pending duplicate matches before disbursement.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={scanExistingRecords}
            disabled={scanLoading}
            className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            <ShieldAlert size={16} aria-hidden="true" />
            {scanLoading ? "Scanning records..." : "Scan existing records"}
          </button>
          <button
            type="button"
            onClick={runEvaluation}
            disabled={evaluationLoading}
            className="inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-60"
          >
            <FlaskConical size={16} aria-hidden="true" />
            {evaluationLoading ? "Checking samples..." : "Run duplicate samples"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {scanSummary && (
        <p className="mb-5 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" role="status">
          Scanned {scanSummary.records_scanned.toLocaleString()} records ({scanSummary.pairs_compared.toLocaleString()} pairs). Created {scanSummary.flags_created.toLocaleString()} new pending flags; {scanSummary.existing_pairs_skipped.toLocaleString()} already flagged pairs were skipped.
        </p>
      )}
      {evaluation && (
        <section className="mb-8 rounded-md border border-blue-200 bg-blue-50/50 p-4" aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Duplicate Scenario Samples</h2>
              <p className="mt-1 text-sm text-slate-600">{evaluation.length} realistic sample pairs scored with the current rules. They cover shared identifiers, near matches, transfers, twins, siblings, and common-field overlap. These examples are display-only and are not saved as students.</p>
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Scenario decisions summary">
                <span className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Critical: {evaluationCounts.critical}</span>
                <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Review: {evaluationCounts.review}</span>
                <span className="rounded bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">Clear: {evaluationCounts.clear}</span>
              </div>
            </div>
            <button type="button" onClick={() => setEvaluation(null)} aria-label="Dismiss evaluation results" title="Dismiss results" className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {evaluation.map((result) => {
              const isCritical = result.decision === "critical";
              const DecisionIcon = isCritical || result.decision === "duplicate" ? ShieldAlert : result.decision === "review" ? Eye : CircleCheck;
              const decisionStyle = isCritical || result.decision === "duplicate" ? "text-red-800 bg-red-100" : result.decision === "review" ? "text-amber-800 bg-amber-50" : "text-green-800 bg-green-50";
              return (
                <article key={result.label} className="rounded border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-slate-800">{result.label}</h3>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${decisionStyle}`}>
                      <DecisionIcon size={13} aria-hidden="true" />
                      {(result.probability * 100).toFixed(0)}% · {result.decision}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[{ label: "Record A", student: result.first }, { label: "Record B", student: result.second }].map(({ label, student }) => (
                      <div key={label} className="min-w-0 border-l-2 border-slate-200 pl-2">
                        <p className="mb-1 font-medium text-slate-700">{label}: {student.full_name}</p>
                        <p className="truncate text-slate-500">UPI: {student.upi}</p>
                        <p className="truncate text-slate-500">Birth certificate: {student.birth_certificate_number}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 border-t border-slate-100 pt-2 text-xs font-medium text-slate-600">Field similarity / maximum weight</p>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs">
                    {Object.entries(result.score_breakdown).map(([field, contribution]) => (
                      <div key={field} className="flex justify-between gap-2">
                        <span className="capitalize text-slate-500">{field.replaceAll("_", " ")}</span>
                        <span className="font-medium text-slate-700">
                          {(contribution * 100).toFixed(1)}% / {(result.score_maximums[field] * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  {result.review_reason && <p className={`mt-3 rounded border px-2 py-1.5 text-xs ${isCritical ? "border-red-300 bg-red-50 font-semibold text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{result.review_reason}</p>}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {loading && <p>Loading duplicate flags...</p>}
      {!loading && flags.length === 0 && <p>No pending duplicate flags.</p>}

      {!loading && flags.length > 0 && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Matched Student</th>
                <th>Probability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => {
                const probability = Number(flag.probability);
                const isCritical = flag.risk_level === 'critical';
                const isDuplicate = flag.risk_level === 'duplicate';
                const riskLevel = isCritical ? 'Critical identifier match' : isDuplicate ? 'Duplicate candidate' : 'Review';
                const riskClass = isCritical || isDuplicate ? 'font-bold text-red-800' : 'font-semibold text-amber-700';

                return (
                  <Fragment key={flag.id}>
                    <tr className={isCritical ? 'bg-red-50' : undefined}>
                      <td>{flag.student_name}</td>
                      <td>{flag.matched_student_name}</td>
                      <td>
                        <span className={riskClass}>
                          {(probability * 100).toFixed(1)}%
                        </span>
                        <div className={`text-xs ${riskClass}`}>{riskLevel}</div>
                      </td>
                      <td>
                        <button type="button" onClick={() => setSelectedFlagId(selectedFlagId === flag.id ? null : flag.id)}>
                          {selectedFlagId === flag.id ? "Close Review" : "Review Case"}
                        </button>
                      </td>
                    </tr>
                  {selectedFlagId === flag.id && (
                    <tr key={`${flag.id}-details`}>
                      <td colSpan="4">
                        <div className="rounded border border-slate-200 bg-slate-50 p-4">
                          <h2 className="mb-3 text-lg font-semibold">Manual Review: {flag.student_name}</h2>
                          {flag.review_reason && <p className={`mb-4 rounded border px-3 py-2 text-sm ${isCritical ? "border-red-300 bg-red-50 font-semibold text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{flag.review_reason}</p>}
                          <p className="mb-4 text-sm text-slate-600">
                            Compare the two records below before recording a decision. Clearing this flag means the records are not duplicates; eligibility is assessed separately.
                          </p>
                          <div className="grid gap-4 md:grid-cols-2">
                            {[{ title: flag.student_name, prefix: "student" }, { title: flag.matched_student_name, prefix: "matched" }].map((record) => (
                              <div key={record.prefix} className="rounded border border-white bg-white p-3">
                                <h3 className="mb-2 font-semibold text-slate-800">{record.title}</h3>
                                <dl className="space-y-1 text-sm text-slate-600">
                                  <div className="flex justify-between gap-3"><dt>Date of birth</dt><dd>{flag[`${record.prefix}_date_of_birth`] || "-"}</dd></div>
                                  <div className="flex justify-between gap-3"><dt>School</dt><dd>{flag[`${record.prefix}_school`] || "-"}</dd></div>
                                  <div className="flex justify-between gap-3"><dt>Guardian ID</dt><dd>{flag[`${record.prefix}_guardian_id`] || "-"}</dd></div>
                                  <div className="flex justify-between gap-3"><dt>UPI</dt><dd>{flag[`${record.prefix}_upi`] || "-"}</dd></div>
                                  <div className="flex justify-between gap-3"><dt>Birth certificate</dt><dd>{flag[`${record.prefix}_birth_certificate_number`] || "-"}</dd></div>
                                </dl>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 rounded border border-white bg-white p-3">
                            <h3 className="mb-2 font-semibold text-slate-800">Field similarity</h3>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {evidence(flag).map((item) => (
                                <div key={item.label} className="flex items-center justify-between text-sm">
                                  <span>{item.label}</span>
                                  <span className={isCritical && ['upi', 'birth_certificate'].includes(item.key) && item.similarity >= 99.9 ? "font-bold text-red-800" : item.similarity >= 99.9 ? "font-semibold text-green-700" : item.similarity > 0 ? "font-medium text-amber-700" : "text-slate-500"}>
                                    {isCritical && ['upi', 'birth_certificate'].includes(item.key) && item.similarity >= 99.9 ? "EXACT MATCH · CRITICAL" : `${item.similarity.toFixed(1)}% similar`}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {flag.score_breakdown && (
                              <div className="mt-4 border-t border-slate-100 pt-3">
                                <h3 className="mb-2 font-semibold text-slate-800">Score breakdown</h3>
                                <div className="grid gap-2 text-sm sm:grid-cols-2">
                                  {Object.entries(flag.score_breakdown).map(([label, contribution]) => (
                                    <div key={label} className="flex items-center justify-between">
                                      <span className="capitalize">{label.replaceAll("_", " ")}</span>
                                      <span className="font-medium">{(contribution * 100).toFixed(1)}% / {(flag.score_maximums[label] * 100).toFixed(0)}%</span>
                                    </div>
                                  ))}
                                </div>
                                <p className="mt-2 text-xs text-slate-500">Calculated score: {(Number(flag.calculated_probability) * 100).toFixed(1)}%</p>
                              </div>
                            )}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button type="button" onClick={() => resolveFlag(flag.id, "confirmed_duplicate")}>Confirm Duplicate</button>
                            <button type="button" onClick={() => resolveFlag(flag.id, "cleared")}>Clear as Not Duplicate</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
