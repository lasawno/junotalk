import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";

export function ConnectionBanner() {
  const [visible, setVisible] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);
  const statusRef = useRef<"ok" | "down">("ok");

  const markDown = useCallback(() => {
    if (statusRef.current === "down") return;
    statusRef.current = "down";
    failCountRef.current = 0;
    setVisible(true);
    // Poll aggressively until recovered
    if (!pollingRef.current) {
      pollingRef.current = setInterval(checkServer, 3000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const markUp = useCallback(() => {
    statusRef.current = "ok";
    failCountRef.current = 0;
    setVisible(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const checkServer = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok || res.status === 401 || res.status === 403) {
        markUp();
        return;
      }
      if (res.status >= 500) failCountRef.current++;
    } catch {
      failCountRef.current++;
    }

    if (failCountRef.current >= 2) markDown();
  }, [markDown, markUp]);

  useEffect(() => {
    // Routine 15-second background check (catches silent failures)
    const interval = setInterval(checkServer, 15_000);

    // Instant response when the server broadcasts it's about to restart.
    // The socket hook forwards "server:restarting" as this custom event.
    const onServerRestarting = () => markDown();
    window.addEventListener("jt:server:restarting", onServerRestarting);

    return () => {
      clearInterval(interval);
      window.removeEventListener("jt:server:restarting", onServerRestarting);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [checkServer, markDown]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium animate-in slide-in-from-top duration-300"
      style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1a365d 100%)" }}
      data-testid="connection-banner"
    >
      <Loader2 className="w-4 h-4 animate-spin text-blue-200/90" />
      <span className="text-blue-100/95">Updating system, please wait...</span>
    </div>
  );
}
