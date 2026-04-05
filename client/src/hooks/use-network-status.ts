/**
 * useNetworkStatus
 *
 * Subscribes to window online/offline events and returns the current
 * connectivity state.
 *
 *  isOnline   — true when navigator.onLine is true and no "offline" event
 *               has fired since the last "online" event.
 *  justReconnected — pulses true for exactly one render cycle immediately
 *               after the device comes back online. Use this to trigger
 *               side-effects (e.g. draining the offline queue) without
 *               depending on isOnline edge-detection in the caller.
 *  offlineSince — Date the device went offline, or null when online.
 *               Use for "offline for N seconds" indicators.
 */

import { useEffect, useRef, useState } from "react";

export interface NetworkStatus {
  isOnline: boolean;
  justReconnected: boolean;
  offlineSince: Date | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(
    navigator.onLine ? null : new Date(),
  );

  // Clear the justReconnected pulse after one render so callers can use it
  // as a one-shot effect trigger.
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOfflineSince(null);

      // Pulse justReconnected true then immediately reset
      setJustReconnected(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setJustReconnected(false), 0);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOfflineSince(new Date());
      setJustReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  return { isOnline, justReconnected, offlineSince };
}
