import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Award, ChevronDown, Download, Printer, RefreshCw } from "lucide-react";
import api from "../services/api";

// Certificates for approved awards. The panel is deliberately separate from the award decision
// form: approving an award is a decision, issuing a certificate is a document, and only an approved
// award can produce one.
function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

function shortId(value) {
  return value ? value.slice(0, 8).toUpperCase() : "-";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CertificateChip({ record }) {
  if (!record) {
    return <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">Not issued</span>;
  }
  return (
    <span className="inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800">
      Issued
      <span className="ml-1 font-mono text-[11px]">{record.certificate.certificate_reference}</span>
    </span>
  );
}

export default function AwardCertificatePanel({ awards, isAdmin, currentUserId }) {
  // A field officer prints the certificates for the awards they proposed. The API enforces the same
  // rule; filtering here keeps another officer's awards out of the list in the first place.
  const approvedAwards = useMemo(
    () => awards.filter((award) => award.status === "approved" && (isAdmin || award.submitted_by === currentUserId)),
    [awards, isAdmin, currentUserId]
  );
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);

  const loadCertificates = useCallback(async () => {
    if (approvedAwards.length === 0) {
      setRecords({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const entries = await Promise.all(approvedAwards.map(async (award) => {
        try {
          const response = await api.get(`/awards/${award.id}/certificate`);
          return [award.id, response.data];
        } catch (err) {
          // 404 is the normal "no certificate yet" answer, not a load failure.
          if (err.response?.status === 404) return [award.id, null];
          throw err;
        }
      }));
      setRecords(Object.fromEntries(entries));
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load certificates.");
    } finally {
      setLoading(false);
    }
  }, [approvedAwards]);

  useEffect(() => { loadCertificates(); }, [loadCertificates]);

  async function certificatePdfUrl(awardId) {
    const response = await api.get(`/awards/${awardId}/certificate.pdf`, { responseType: "blob" });
    return URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
  }

  async function downloadPdf(awardId, reference) {
    setBusy(`pdf-${awardId}`);
    setError("");
    try {
      const url = await certificatePdfUrl(awardId);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reference}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to download the certificate.");
    } finally {
      setBusy("");
    }
  }

  async function printPdf(awardId) {
    setBusy(`print-${awardId}`);
    setError("");
    try {
      const url = await certificatePdfUrl(awardId);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to open the certificate for printing.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="overflow-x-auto rounded border border-slate-200 bg-white">
      <div className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${sectionOpen ? "border-b" : ""}`}>
        <div>
          <button
            type="button"
            onClick={() => setSectionOpen((value) => !value)}
            aria-expanded={sectionOpen}
            className="flex items-center gap-1.5 font-semibold text-slate-900"
          >
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${sectionOpen ? "" : "-rotate-90"}`} />
            Bursary certificates
          </button>
          {sectionOpen && (
            <p className="mt-1 text-xs text-slate-600">
              Generated automatically when an administrator approves an award. The field officer who proposed it prints it for the student or school. Approval is not payment.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={loadCertificates}
          disabled={loading}
          className="flex w-fit items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} aria-hidden="true" className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {sectionOpen && (
      <div id="certificate-list">
      {error && <p className="border-b border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      {loading ? (
        <p className="p-6 text-sm text-slate-600">Loading certificates...</p>
      ) : approvedAwards.length === 0 ? (
        <div className="flex items-start gap-3 p-6 text-sm text-slate-600">
          <Award size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <p>No approved awards yet. A certificate becomes available as soon as an administrator approves an award.</p>
        </div>
      ) : (
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="p-3">Award</th>
              <th className="p-3">Student</th>
              <th className="p-3">Approved</th>
              <th className="p-3">Certificate</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {approvedAwards.map((award) => {
              const record = records[award.id];
              const certificate = record?.certificate;
              return (
                <Fragment key={award.id}>
                  <tr>
                    <td className="p-3 font-mono text-xs">{shortId(award.id)}</td>
                    <td className="p-3">
                      {award.student_name}
                      <div className="text-xs text-slate-500">{award.school_code}</div>
                    </td>
                    <td className="p-3">{money(award.approved_amount)}</td>
                    <td className="p-3"><CertificateChip record={record} /></td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {!record && (
                          <span className="text-xs text-slate-500">Not available for printing</span>
                        )}
                        {record && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpanded(expanded === award.id ? "" : award.id)}
                              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {expanded === award.id ? "Hide QR" : "View QR"}
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadPdf(award.id, certificate.certificate_reference)}
                              disabled={busy === `pdf-${award.id}`}
                              className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <Download size={13} aria-hidden="true" />
                              {busy === `pdf-${award.id}` ? "Preparing..." : "PDF"}
                            </button>
                            <button
                              type="button"
                              onClick={() => printPdf(award.id)}
                              disabled={busy === `print-${award.id}`}
                              className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <Printer size={13} aria-hidden="true" />
                              Print
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === award.id && record && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50 p-4">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                          <div className="shrink-0 rounded border border-slate-200 bg-white p-3 text-center">
                            <img
                              src={record.qr_code}
                              alt={`Verification QR code for certificate ${certificate.certificate_reference}`}
                              width={132}
                              height={132}
                              className="mx-auto h-[132px] w-[132px]"
                            />
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Scan to verify</p>
                          </div>
                          <dl className="min-w-0 flex-1 space-y-1 text-sm">
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Certificate reference</dt>
                              <dd className="font-mono text-xs font-semibold text-slate-900">{certificate.certificate_reference}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Award period</dt>
                              <dd className="font-semibold text-slate-900">{certificate.award_period}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Issued</dt>
                              <dd className="text-slate-900">{formatDate(certificate.issued_at)} by {certificate.issued_by_name}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Proposed by</dt>
                              <dd className="text-slate-900">{certificate.proposed_by_name || "-"}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Approved by</dt>
                              <dd className="text-slate-900">{certificate.approved_by_name || certificate.issued_by_name}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Approved on</dt>
                              <dd className="text-slate-900">{formatDate(certificate.award_approved_at)}</dd>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2">
                              <dt className="text-slate-600">Approved amount</dt>
                              <dd className="text-slate-900">{money(certificate.approved_amount)}</dd>
                            </div>
                            <div className="pt-2">
                              <dt className="text-slate-600">Verification link encoded in the QR code</dt>
                              <dd className="mt-1 break-all font-mono text-[11px] text-slate-700">{certificate.verification_url}</dd>
                            </div>
                            <div className="pt-2">
                              <dt className="text-slate-600">Manual verification page (reference is printed on the PDF)</dt>
                              <dd className="mt-1 break-all font-mono text-[11px] text-slate-700">
                                {certificate.verification_page_url}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

          </tbody>
        </table>
      )}
      </div>
      )}
    </section>
  );
}
