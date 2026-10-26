import { useEffect, useRef, useState } from "react";

export default function Verification() {
  const [status, setStatus] = useState("loading");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");

    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    } catch {
      setStatus("invalid");
      return;
    }

    if (!token) {
      setStatus("invalid");
      return;
    }

    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (response.status === 503 || response.status >= 500 || response.status === 429) {
          setStatus("service-error");
          return;
        }
        if (!response.ok) {
          setStatus("invalid");
          return;
        }
        const result = await response.json();
        setStatus(result.found === true ? "found" : "invalid");
      })
      .catch(() => setStatus("service-error"));
  }, []);

  const message = {
    loading: "Checking code…",
    found: "Record found",
    invalid: "Unable to verify this code",
    "service-error": "Verification is temporarily unavailable. Try again later.",
  }[status];

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-10 text-slate-900">
      <section className="w-full max-w-md border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8" aria-live="polite">
        <p className="text-base" role="status">{message}</p>
      </section>
    </main>
  );
}
