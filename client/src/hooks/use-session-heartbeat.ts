import { useEffect, useRef } from "react";

const HEARTBEAT_INTERVAL = 2 * 60 * 1000;
const ACTIVITY_TIMEOUT = 5 * 60 * 1000;

async function pingHeartbeat() {
  try {
    await fetch("/api/v1/session/heartbeat", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // silent
  }
}

export function useSessionHeartbeat() {
  const lastActivityRef = useRef(Date.now());
  const hiddenAtRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"];
    activityEvents.forEach((e) => window.addEventListener(e, updateActivity, { passive: true }));

    const origWsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (...args: Parameters<typeof origWsSend>) {
      updateActivity();
      return origWsSend.apply(this, args);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      updateActivity();
      hiddenAtRef.current = 0;
      pingHeartbeat();
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      updateActivity();
      hiddenAtRef.current = 0;
      if (e.persisted) {
        pingHeartbeat();
      }
    };

    const handleOnline = () => {
      updateActivity();
      pingHeartbeat();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    const sendHeartbeat = () => {
      const idleTime = Date.now() - lastActivityRef.current;
      if (idleTime > ACTIVITY_TIMEOUT) return;
      if (document.visibilityState !== "visible") return;
      pingHeartbeat();
    };

    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      activityEvents.forEach((e) => window.removeEventListener(e, updateActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      WebSocket.prototype.send = origWsSend;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
