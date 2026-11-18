// Shared vocabulary for the guardian portal and the Field Officer workspace.
//
// Everything here is derived from fields the API already returns. No status is invented: an
// unknown status falls back to a neutral badge showing the raw value, so the interface never
// claims progress that has not been recorded.

export const APPLICATION_STATUS = {
  submitted: {
    label: "Submitted",
    tone: "neutral",
    guardianLabel: "Application received",
    description: "The application has been received. Identity screening has not been recorded yet.",
  },
  screened: {
    label: "Screened",
    tone: "info",
    guardianLabel: "Initial checks completed",
    description: "Initial identity checks are complete. The office is reviewing the application.",
  },
  needs_investigation: {
    label: "Duplicate review pending",
    tone: "warning",
    guardianLabel: "Under duplicate review",
    description: "A possible matching record needs a Field Officer to check it before the application continues.",
  },
  investigated: {
    label: "Awaiting administrator decision",
    tone: "warning",
    guardianLabel: "Review findings recorded",
    description: "A Field Officer has recorded findings. An administrator makes the duplicate decision.",
  },
  resolved: {
    label: "Duplicate cleared",
    tone: "info",
    guardianLabel: "Duplicate review decided",
    description: "The duplicate review is complete. The application can proceed to eligibility verification.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    guardianLabel: "Eligibility verified",
    description: "Eligibility has been verified and the student record created.",
  },
  award_recommended: {
    label: "Award recommended",
    tone: "info",
    guardianLabel: "Award recommendation submitted",
    description: "A Field Officer has recommended an award. An administrator makes the final decision.",
  },
  approved: {
    label: "Approved",
    tone: "success",
    guardianLabel: "Award approved",
    description: "An administrator has approved the bursary award.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    guardianLabel: "Closed without an award",
    description: "An administrator closed the application without an award.",
  },
  withdrawn: {
    label: "Withdrawn",
    tone: "neutral",
    guardianLabel: "Withdrawn",
    description: "The application was withdrawn before a decision.",
  },
};

export const DUPLICATE_CASE_STATUS = {
  pending: { label: "Awaiting investigation", tone: "warning" },
  needs_verification: { label: "Needs further checks", tone: "warning" },
  investigated: { label: "Findings recorded", tone: "info" },
  resolved_not_duplicate: { label: "Cleared as not a duplicate", tone: "success" },
  resolved_duplicate: { label: "Confirmed duplicate", tone: "danger" },
};

const OPEN_CASE_STATUSES = new Set(["pending", "needs_verification"]);

export const AWARD_STATUS = {
  submitted: { label: "Awaiting admin decision", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  voided: { label: "Voided", tone: "neutral" },
};

export const RECOMMENDATION_LABELS = {
  likely_duplicate: "Likely duplicate",
  likely_not_duplicate: "Likely not a duplicate",
  needs_further_checks: "Needs further checks",
};

export function statusMeta(status) {
  return APPLICATION_STATUS[status] || {
    label: String(status || "Unknown").replaceAll("_", " "),
    tone: "neutral",
    guardianLabel: "Application updated",
    description: "The office has recorded a new status for this application.",
  };
}

export function caseMeta(status) {
  return DUPLICATE_CASE_STATUS[status] || {
    label: String(status || "recorded").replaceAll("_", " "),
    tone: "neutral",
  };
}

export function awardMeta(status) {
  return AWARD_STATUS[String(status || "").toLowerCase()] || {
    label: String(status || "unknown").replaceAll("_", " "),
    tone: "neutral",
  };
}

export function openCases(cases) {
  return (cases || []).filter((entry) => OPEN_CASE_STATUSES.has(entry.status));
}

// A single sentence answering "what is happening with duplicate screening?" without showing another
// applicant's data or the model's internal features.
export function screeningSummary(application, cases = []) {
  if (!application) {
    return { label: "Not recorded", tone: "neutral", detail: "No screening information is available." };
  }
  const open = openCases(cases);

  if (application.screening_failure_code) {
    return {
      label: "Screening not completed",
      tone: "warning",
      detail:
        "Identity screening did not complete for this application. It has not been cleared, so staff check the identity details manually.",
    };
  }
  if (application.duplicate_of_student_id) {
    return {
      label: "Confirmed duplicate",
      tone: "danger",
      detail: "This application was resolved as a duplicate of an existing student record.",
    };
  }
  if (open.length > 0) {
    return {
      label: open.some((entry) => entry.status === "needs_verification")
        ? "Investigation in progress"
        : "Possible duplicate",
      tone: "warning",
      detail:
        "A possible matching record was identified. A person investigates it; the screening score alone never decides the case.",
    };
  }
  if (cases.length > 0) {
    return {
      label: "Cleared after review",
      tone: "success",
      detail: "The possible match was reviewed and the application was allowed to continue.",
    };
  }
  if (["screened", "resolved", "verified", "award_recommended", "approved"].includes(application.status)) {
    return {
      label: "No potential duplicate identified",
      tone: "success",
      detail: "Identity screening did not flag a possible matching beneficiary record.",
    };
  }
  return {
    label: "Not screened yet",
    tone: "neutral",
    detail: "Identity screening has not produced a result for this application yet.",
  };
}

export function requiredAction(application, cases = []) {
  if (!application) return "Open the application";
  if (application.status === "needs_investigation") return "Record investigation findings";
  if (openCases(cases).length > 0) return "Wait for the administrator decision";
  if (["screened", "resolved"].includes(application.status) && !application.duplicate_of_student_id) {
    return "Verify eligibility";
  }
  if (application.status === "verified") return "Recommend an award";
  return "No action required";
}

// Guardian-facing progress. Each stage is derived from the recorded status only; future stages stay
// pending, and a guardian never sees duplicate candidates, scores or staff notes.
export function trackingStages(application) {
  if (!application) return [];
  const status = application.status;
  const uniqueDone = ["resolved", "verified", "award_recommended", "approved"].includes(status);
  const inDuplicate = ["needs_investigation", "investigated"].includes(status);
  const eligibilityDone = ["verified", "award_recommended", "approved"].includes(status);

  return [
    {
      key: "submitted",
      title: "Application submitted",
      state: "done",
      detail: "The bursary office received the guardian's application.",
    },
    {
      key: "screening",
      title: "Identity screening",
      state: application.screening_failure_code ? "blocked" : status === "submitted" ? "current" : "done",
      detail: application.screening_failure_code
        ? "Screening could not be completed. Staff review the identity details manually; this is not a decision."
        : "Submitted identity details were compared with existing beneficiary records.",
    },
    {
      key: "duplicate",
      title: "Duplicate review (if required)",
      state: uniqueDone ? "done" : inDuplicate ? "current" : status === "screened" ? "skipped" : "pending",
      detail: uniqueDone
        ? "Any possible match has been reviewed and the application may continue."
        : inDuplicate
          ? "A possible matching record is being investigated by a Field Officer. This is not a rejection."
          : "Only applications with a possible matching record go through this step.",
    },
    {
      key: "eligibility",
      title: "Eligibility verification",
      state: eligibilityDone ? "done" : status === "resolved" ? "current" : "pending",
      detail: "A Field Officer verifies eligibility against the defined eligibility rules.",
    },
    {
      key: "award",
      title: "Award decision",
      state: status === "approved" ? "done" : status === "award_recommended" ? "current" : "pending",
      detail: "An administrator makes the final award decision. A recommendation is not an approval.",
    },
  ];
}

export function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function maskIdentifier(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.min(6, Math.max(2, text.length - 4)))}${text.slice(-4)}`;
}

export function shortRef(value) {
  return value ? String(value).slice(0, 8).toUpperCase() : "—";
}

export function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `KSh ${amount.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

