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

export function apiErrorMessage(error, fallback) {
  const details = error.response?.data?.details;
  const fieldErrors = details?.fieldErrors || details?.flatten?.()?.fieldErrors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().filter(Boolean)[0]
    : undefined;
  return (
    firstFieldError ||
    error.response?.data?.error ||
    error.response?.data?.message ||
    fallback
  );
}
