import { useRef, useEffect, useCallback } from "react";

export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch {}
  }, []);

  const release = useCallback(() => {
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch {}
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (active) {
      acquire();
    } else {
      release();
    }
    return () => release();
  }, [active, acquire, release]);

  useEffect(() => {
    if (!active) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && active) {
        acquire();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [active, acquire]);
}
