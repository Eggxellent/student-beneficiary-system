import api from "./api";

// Guardian API surface. The token interceptor in api.js attaches the guardian's JWT, and every
// server query is scoped to the signed-in guardian's user id.

export async function registerGuardian(payload) {
  const { data } = await api.post("/guardian/register", payload);
  return data;
}

export async function fetchGuardianProfile() {
  const { data } = await api.get("/guardian/me");
  return data;
}

export async function updateGuardianProfile(payload) {
  const { data } = await api.patch("/guardian/me", payload);
  return data;
}

export async function fetchGuardianDashboard() {
  const { data } = await api.get("/guardian/dashboard");
  return data;
}

export async function fetchGuardianApplications() {
  const { data } = await api.get("/guardian/applications");
  return data.applications;
}

export async function submitGuardianApplication(payload) {
  const { data } = await api.post("/guardian/applications", payload);
  return data.application;
}

export async function fetchGuardianApplication(reference) {
  const { data } = await api.get(`/guardian/applications/${encodeURIComponent(reference)}`);
  return data.application;
}

export async function downloadGuardianApplicationInvoice(reference) {
  const { data } = await api.get(
    `/guardian/applications/${encodeURIComponent(reference)}/invoice.pdf`,
    { responseType: "blob" },
  );
  return data;
}

export function apiErrorMessage(error, fallback) {
  const response = error?.response;
  const details = response?.data?.details;
  const fieldErrors = details?.fieldErrors || details?.flatten?.()?.fieldErrors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().filter(Boolean)[0]
    : undefined;
  const serverMessage =
    firstFieldError || response?.data?.error || response?.data?.message;

  if (serverMessage) return serverMessage;

  // A response without a readable body (a proxy error page, for example) still carries the
  // status, so show it instead of blaming the values the user typed.
  if (response) return `${fallback} (server status ${response.status})`;

  // No response at all means the request never reached the API. Saying so is the difference
  // between "your details are wrong" and "the backend is not running".
  if (error?.request) {
    return "Cannot reach the server. Check that the API is running, then try again.";
  }

  return fallback;
}
