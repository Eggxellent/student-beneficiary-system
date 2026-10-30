import { useEffect, useRef, useState } from "react";

function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

function stripTokenFromUrl() {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
}

export default function Verification() {
  const [status, setStatus] = useState("loading");

  // Captured during render, because the effect below removes the token from the URL and
  // React StrictMode runs effects twice in development: reading the hash inside the effect
  // would leave the second pass with nothing to verify.
  const initialToken = useRef(readToken());
  const [token, setToken] = useState(initialToken.current);

  useEffect(() => {
    try {
      stripTokenFromUrl();
    } catch {
      setStatus("invalid");
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");

    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 503 || response.status >= 500 || response.status === 429) {
          setStatus("service-error");
          return;
        }
        if (!response.ok) {
          setStatus("invalid");
          return;
        }
        const result = await response.json();
        if (!cancelled) setStatus(result.found === true ? "found" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setStatus("service-error");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // A second code opened in the same tab only changes the fragment, so the component is not
  // remounted and the previous result would otherwise stay on screen.
  useEffect(() => {
    function handleHashChange() {
      const next = readToken();
      try {
        stripTokenFromUrl();
      } catch {
        setStatus("invalid");
        return;
      }
      setToken(next);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
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
