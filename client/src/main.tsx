import "./rendering-baseline.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.env.PROD) {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
}

// ── Global resilience layer ──────────────────────────────────────────────────
// Catch every unhandled JS error and promise rejection so they are logged to
// the server and never surface as a browser crash / blank screen for users.
function reportError(payload: Record<string, unknown>) {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, url: window.location.href, userAgent: navigator.userAgent }),
    }).catch(() => {});
  } catch {}
}

window.addEventListener("error", (event) => {
  // Chunk/module load failure → let the page reload once
  const msg = event.message || "";
  if (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk")
  ) {
    // Share the same throttle key used by retryImport and ErrorBoundary
    // so all three reload-on-chunk-error paths coordinate as one
    const reloadKey = "__retry_reload__";
    const last = Number(sessionStorage.getItem(reloadKey) || 0);
    if (Date.now() - last > 15000) {
      sessionStorage.setItem(reloadKey, String(Date.now()));
      window.location.reload();
    }
    return;
  }

  reportError({
    type: "uncaught_error",
    message: msg,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack?.slice(0, 2000),
  });

  // Prevent the default browser error overlay
  event.preventDefault();
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : JSON.stringify(reason);

  reportError({
    type: "unhandled_rejection",
    message,
    stack: reason instanceof Error ? reason.stack?.slice(0, 2000) : undefined,
  });

  // Prevent the browser from treating this as a crash
  event.preventDefault();
});
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(<App />);
