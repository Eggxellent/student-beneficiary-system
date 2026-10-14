import { Fragment, useEffect, useState } from "react";
import { BadgeCheck, CircleCheck, Eye, FlaskConical, ShieldAlert, X } from "lucide-react";
import api from "../services/api";

const evaluationNames = [
  "Amina Hassan", "Brian Otieno", "Faith Njeri", "John Kamau",
  "Mary Wanjiku", "Peter Ochieng", "Wanjiku Mwangi", "Samuel Kiptoo",
];

function randomItem(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomInteger(minimum, maximum) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function createEvaluationPairs() {
  const makeStudent = (fullName) => ({
    full_name: fullName,
    date_of_birth: `${2005 + Math.floor(Math.random() * 9)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`,
    school_code: `SCH-${String(randomInteger(1, 80)).padStart(3, "0")}`,
    guardian_id: `G-${randomInteger(100000, 999999)}`,
    upi: `UPI-${randomInteger(10000000, 99999999)}`,
    birth_certificate_number: `BC-${randomInteger(100000, 999999)}`,
  });

  const exactUpiFirst = makeStudent(randomItem(evaluationNames));
  const exactUpiSecond = makeStudent(randomItem(evaluationNames));
  exactUpiSecond.upi = exactUpiFirst.upi;

  const exactCertificateFirst = makeStudent(randomItem(evaluationNames));
  const exactCertificateSecond = makeStudent(randomItem(evaluationNames));
  exactCertificateSecond.birth_certificate_number = exactCertificateFirst.birth_certificate_number;

  const exactIdentifiersFirst = makeStudent("Nia Wanjiku");
  const exactIdentifiersSecond = makeStudent("David Otieno");
  exactIdentifiersSecond.upi = exactIdentifiersFirst.upi;
  exactIdentifiersSecond.birth_certificate_number = exactIdentifiersFirst.birth_certificate_number;

  const sharedName = randomItem(evaluationNames);
  const similarityFirst = makeStudent(sharedName);
  const similaritySecond = {
    ...similarityFirst,
    upi: `UPI-${randomInteger(10000000, 99999999)}`,
    birth_certificate_number: `BC-${randomInteger(100000, 999999)}`,
  };

  const clearFirst = makeStudent("Zainab Muthoni");
  const clearSecond = makeStudent("Abdullahi Wekesa");
  const quorumFirst = {
    ...makeStudent("Fatuma Wairimu"),
    date_of_birth: "1980-04-12",
    school_code: "SCH-4821765",
    guardian_id: "G-4821765",
  };
  const quorumSecond = {
    ...makeStudent("Amina Wanjiku"),
    date_of_birth: "1980-09-09",
    school_code: "SCH-4821750",
    guardian_id: "G-4821750",
  };

  return [
    { label: "Exact UPI match", first: exactUpiFirst, second: exactUpiSecond },
    { label: "Exact birth certificate match", first: exactCertificateFirst, second: exactCertificateSecond },
    { label: "Both unique identifiers match (80%+)", first: exactIdentifiersFirst, second: exactIdentifiersSecond },
    { label: "Name and household details match", first: similarityFirst, second: similaritySecond },
    { label: "Unrelated records", first: clearFirst, second: clearSecond },
    { label: "Four strong fields below weighted cutoff", first: quorumFirst, second: quorumSecond },
  ];
}

export default function DuplicateReview() {
  const [flags, setFlags] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFlagId, setSelectedFlagId] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  function fetchFlags() {
    setLoading(true);
    api.get("/duplicate-flags?status=pending")
      .then((response) => setFlags(response.data))
      .catch((err) => setError(err.response?.data?.message || "Failed to load duplicate flags."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFlags();
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
      const response = await api.post("/duplicate-flags/evaluate", { pairs: createEvaluationPairs() });
      setEvaluation(response.data.results);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to evaluate synthetic records.");
    } finally {
      setEvaluationLoading(false);
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

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Duplicate Review</h1>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Review pending duplicate matches before disbursement.</p>
        <button
          type="button"
          onClick={runEvaluation}
          disabled={evaluationLoading}
          className="inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-60"
        >
          <FlaskConical size={16} aria-hidden="true" />
          {evaluationLoading ? "Generating..." : "Generate Random Records"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {evaluation && (
        <section className="mb-8 rounded-md border border-blue-200 bg-blue-50/50 p-4" aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Synthetic Evaluation</h2>
              <p className="mt-1 text-sm text-slate-600">Six synthetic pairs scored with the current rules. These records were not saved.</p>
            </div>
            <button type="button" onClick={() => setEvaluation(null)} aria-label="Dismiss evaluation results" title="Dismiss results" className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {evaluation.map((result) => {
              const DecisionIcon = result.decision === "duplicate" ? ShieldAlert : result.decision === "review" ? Eye : CircleCheck;
              const decisionStyle = result.decision === "duplicate" ? "text-red-700 bg-red-50" : result.decision === "review" ? "text-amber-800 bg-amber-50" : "text-green-800 bg-green-50";
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
                  {result.review_reason && <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{result.review_reason}</p>}
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
                const isDuplicate = flag.risk_level === 'duplicate';
                const riskLevel = isDuplicate ? 'Duplicate' : 'Review';

                return (
                  <Fragment key={flag.id}>
                    <tr>
                      <td>{flag.student_name}</td>
                      <td>{flag.matched_student_name}</td>
                      <td>
                        <span className={isDuplicate ? 'font-bold text-red-700' : 'font-semibold text-yellow-700'}>
                          {(probability * 100).toFixed(1)}%
                        </span>
                        <div className="text-xs text-gray-500">{riskLevel}</div>
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
                          {flag.review_reason && <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{flag.review_reason}</p>}
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
                                  <span className={item.similarity >= 99.9 ? "font-semibold text-green-700" : item.similarity > 0 ? "font-medium text-amber-700" : "text-slate-500"}>
                                    {item.similarity.toFixed(1)}% similar
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
