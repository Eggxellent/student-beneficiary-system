import { useEffect, useRef, useState } from "react";

// Both public verification pages read their token from the URL fragment. A fragment is never sent
// to a web server, never written to an access log and never forwarded as a Referer, so the token is
// removed from the visible URL as soon as it has been read.
export function readHashToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

export function stripHashToken() {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
}

export default function useHashToken() {
  // Captured during render, because the effect below removes the token from the URL and React
  // StrictMode runs effects twice in development: reading the hash inside the effect would leave
  // the second pass with nothing to verify.
  const initialToken = useRef(readHashToken());
  const [token, setToken] = useState(initialToken.current);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    try {
      stripHashToken();
    } catch {
      setReadFailed(true);
    }
  }, []);

  // A second code opened in the same tab only changes the fragment, so the component is not
  // remounted and the previous result would otherwise stay on screen.
  useEffect(() => {
    function handleHashChange() {
      const next = readHashToken();
      try {
        stripHashToken();
      } catch {
        setReadFailed(true);
        return;
      }
      setToken(next);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return { token, readFailed };
}
