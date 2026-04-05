import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useNetworkStatus } from "@/hooks/use-network-status";

type Status = "online" | "reconnecting" | "offline";

const DOT_COLOR: Record<Status, string> = {
  online:       "#22c55e",
  reconnecting: "#f59e0b",
  offline:      "#ef4444",
};

const DOT_LABEL: Record<Status, string> = {
  online:       "Connected",
  reconnecting: "Reconnecting…",
  offline:      "Offline",
};

// Pages that render the dot inline in their own header
const INLINE_DOT_ROUTES = new Set(["/", "/home", "/juno", "/voice-translate"]);

export function ConnectionDot() {
  const [location] = useLocation();
  const { isOnline } = useNetworkStatus();
  const [serverDown, setServerDown] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const checkRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkServer = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok || res.status === 401 || res.status === 403) {
        setServerDown(false);
      } else if (res.status >= 500) {
        setServerDown(true);
      }
    } catch {
      setServerDown(true);
    }
  }, []);

  useEffect(() => {
    checkRef.current = setInterval(checkServer, 15_000);
    const onRestarting = () => setServerDown(true);
    window.addEventListener("jt:server:restarting", onRestarting);
    return () => {
      if (checkRef.current) clearInterval(checkRef.current);
      window.removeEventListener("jt:server:restarting", onRestarting);
    };
  }, [checkServer]);

  // Don't render on pages that handle the dot themselves inline
  if (INLINE_DOT_ROUTES.has(location)) return null;

  const finalStatus: Status = !isOnline ? "offline" : serverDown ? "reconnecting" : "online";
  const color = DOT_COLOR[finalStatus];

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 14,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 5,
        cursor: "default",
      }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      {/* Tooltip */}
      {showTip && (
        <span style={{
          position: "absolute",
          right: 16,
          top: "50%",
          transform: "translateY(-50%)",
          background: "rgba(10,20,45,0.92)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 8px",
          borderRadius: 6,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          border: "1px solid rgba(96,165,250,0.2)",
        }}>
          {DOT_LABEL[finalStatus]}
        </span>
      )}

      {/* The dot */}
      <span style={{
        display: "block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 2px rgba(0,0,0,0.3), 0 0 6px ${color}88`,
        transition: "background 0.4s ease, box-shadow 0.4s ease",
        flexShrink: 0,
      }} />
    </div>
  );
}

/** Inline variant — renders just the dot, no fixed positioning, for use inside page headers */
export function InlineConnectionDot() {
  const { isOnline } = useNetworkStatus();
  const [serverDown, setServerDown] = useState(false);
  const [showTip, setShowTip] = useState(false);

  const checkServer = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(4000) });
      setServerDown(!(res.ok || res.status === 401 || res.status === 403));
    } catch { setServerDown(true); }
  }, []);

  useEffect(() => {
    const iv = setInterval(checkServer, 15_000);
    const onRestarting = () => setServerDown(true);
    window.addEventListener("jt:server:restarting", onRestarting);
    return () => { clearInterval(iv); window.removeEventListener("jt:server:restarting", onRestarting); };
  }, [checkServer]);

  const finalStatus: Status = !isOnline ? "offline" : serverDown ? "reconnecting" : "online";
  const color = DOT_COLOR[finalStatus];

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", cursor: "default" }}
      onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}>
      {showTip && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,20,45,0.92)", color: "#fff", fontSize: 10, fontWeight: 600,
          padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none",
          border: "1px solid rgba(96,165,250,0.2)",
        }}>
          {DOT_LABEL[finalStatus]}
        </span>
      )}
      <span style={{
        display: "block", width: 6, height: 6, borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 1.5px rgba(0,0,0,0.3), 0 0 5px ${color}99`,
        transition: "background 0.4s ease, box-shadow 0.4s ease",
        flexShrink: 0,
      }} />
    </div>
  );
}
