/**
 * use-social-popup.ts
 *
 * React hook that owns the complete JunoTalk Browser popup workflow.
 * Manages all state, polling, and cleanup — MediaCarousel is UI only.
 *
 * States:
 *   waiting        — popup is open, user is on the platform
 *   awaitingConfirm — popup closed, waiting for user to confirm login worked
 *   blocked        — popup was blocked or URL failed security check
 *   connected      — set of platform IDs confirmed this session
 *
 * Returned API:
 *   openSignIn(p)     — runs security check, then opens the popup
 *   confirmConnected() — user confirms login worked → marks connected
 *   retrySignIn()      — user says login didn't work → reopens popup
 *   focusPopup()       — switches focus back to the still-open popup
 *   cancelActive()     — cancels all state and closes any popup
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  isMobileDevice,
  ensureBrowserMode,
  openPopupWindow,
  launchMobileSignIn,
  consumePendingReturn,
  requestNotificationPermission,
  fireReturnNotification,
  POLL_INTERVAL_MS,
} from "@/lib/junotalk-browser";
import { validateUrl } from "@/lib/junotalk-browser-security";

export type SocialPlatform = {
  id: string;
  name: string;
  loginUrl: string;
};

export type UseSocialPopupResult = {
  connected:        string[];
  waiting:          SocialPlatform | null;
  awaitingConfirm:  SocialPlatform | null;
  blocked:          SocialPlatform | null;
  justConnectedId:  string | null;
  openSignIn:       (platform: SocialPlatform) => void;
  confirmConnected: () => void;  // "Yes, I'm connected"
  retrySignIn:      () => void;  // "Try again" — reopens popup
  focusPopup:       () => void;  // Bring popup window back to front
  cancelActive:     () => void;
};

const JUST_CONNECTED_MS = 4000;

export function useSocialPopup(): UseSocialPopupResult {
  const [connected,        setConnected]        = useState<string[]>([]);
  const [waiting,          setWaiting]          = useState<SocialPlatform | null>(null);
  const [awaitingConfirm,  setAwaitingConfirm]  = useState<SocialPlatform | null>(null);
  const [blocked,          setBlocked]          = useState<SocialPlatform | null>(null);
  const [justConnectedId,  setJustConnectedId]  = useState<string | null>(null);

  const winRef      = useRef<Window | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const platformRef = useRef<SocialPlatform | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const markConnected = useCallback((id: string) => {
    setConnected(prev => prev.includes(id) ? prev : [...prev, id]);
    setJustConnectedId(id);
    setTimeout(() => setJustConnectedId(null), JUST_CONNECTED_MS);
  }, []);

  // Detect mobile auth return.
  // We check on mount AND on every pageshow (bfcache restore) / visibilitychange
  // event, because on iOS Safari pressing the Back button restores from bfcache
  // without re-running mount effects.
  const checkPendingReturn = useCallback(() => {
    // Legacy: sessionStorage PENDING_KEY (desktop popup fallback)
    const pending = consumePendingReturn();
    if (pending) {
      platformRef.current = pending;
      setWaiting(null);
      setAwaitingConfirm(pending);
      return;
    }

    // Relay return: /home?rp=<platformId>&rn=<platformName>&rt=<loginUrl>
    // Written by auth-relay.tsx when the user presses Back from the platform.
    const params = new URLSearchParams(window.location.search);
    const rp = params.get("rp");
    const rn = params.get("rn");
    const rt = params.get("rt") ?? "";
    if (rp) {
      // Strip relay params from the URL so a refresh doesn't re-trigger the overlay
      window.history.replaceState(null, "", window.location.pathname);
      const platform: SocialPlatform = { id: rp, name: rn ?? rp, loginUrl: rt };
      platformRef.current = platform;
      setWaiting(null);
      setAwaitingConfirm(platform);
    }
  }, []);

  useEffect(() => {
    checkPendingReturn();

    // bfcache restore (Back button on iOS Safari)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) checkPendingReturn();
    };
    // Switching back from YouTube in Chrome app → Safari tab becomes visible
    const onVisible = () => {
      if (document.visibilityState === "visible") checkPendingReturn();
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      stopPolling();
    };
  }, [checkPendingReturn]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the user comes back to the tab (desktop: switched away while popup open),
  // immediately check if the popup closed and move to confirmation.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && winRef.current) {
        if (winRef.current.closed) {
          stopPolling();
          const p = platformRef.current;
          setWaiting(null);
          winRef.current = null;
          if (p) setAwaitingConfirm(p);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelActive = useCallback(() => {
    stopPolling();
    setWaiting(null);
    setAwaitingConfirm(null);
    setBlocked(null);
    winRef.current?.close();
    winRef.current = null;
    platformRef.current = null;
  }, []);

  // User taps "Yes, I'm Connected" on the return confirmation screen
  const confirmConnected = useCallback(() => {
    const p = awaitingConfirm;
    if (!p) return;
    setAwaitingConfirm(null);
    markConnected(p.id);
    // Popup is already closed at this point — nothing to keep open
  }, [awaitingConfirm, markConnected]);

  // User taps "Try Again" — reopens the platform browser from the confirmation screen
  const retrySignIn = useCallback(async () => {
    const p = awaitingConfirm || platformRef.current;
    if (!p) return;
    setAwaitingConfirm(null);

    // Mobile: re-run the redirect flow (same as initial sign-in)
    if (isMobileDevice()) {
      fireReturnNotification(p.id, p.name);
      launchMobileSignIn(p.id, p.loginUrl, p.name);
      return;
    }

    // Desktop: reopen the popup window
    const win = openPopupWindow(p.loginUrl);
    if (!win) {
      setBlocked(p);
      return;
    }

    winRef.current = win;
    setWaiting(p);

    pollRef.current = setInterval(() => {
      if (!winRef.current || winRef.current.closed) {
        stopPolling();
        setWaiting(null);
        setAwaitingConfirm(p);
        winRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, [awaitingConfirm]);

  // Brings the popup window back into focus while it's still open
  const focusPopup = useCallback(() => {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.focus();
    }
  }, []);

  const openSignIn = useCallback(async (platform: SocialPlatform) => {
    ensureBrowserMode();

    const permitted = await validateUrl(platform.loginUrl);
    if (!permitted) {
      setBlocked(platform);
      return;
    }

    if (isMobileDevice()) {
      // Request notification permission, then fire the return nudge before navigating away.
      // The OS notification stays in the tray while the user is on the external platform
      // and tapping it brings JunoTalk back into focus.
      await requestNotificationPermission();
      fireReturnNotification(platform.id, platform.name);
      launchMobileSignIn(platform.id, platform.loginUrl, platform.name);
      return;
    }

    const win = openPopupWindow(platform.loginUrl);
    if (!win) {
      setBlocked(platform);
      return;
    }

    platformRef.current = platform;
    winRef.current = win;
    setWaiting(platform);

    // When the popup closes, move to the "return confirmation" step
    // instead of auto-marking connected — the user confirms explicitly.
    pollRef.current = setInterval(() => {
      if (!winRef.current || winRef.current.closed) {
        stopPolling();
        setWaiting(null);
        setAwaitingConfirm(platform);
        winRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, []);

  return {
    connected,
    waiting,
    awaitingConfirm,
    blocked,
    justConnectedId,
    openSignIn,
    confirmConnected,
    retrySignIn,
    focusPopup,
    cancelActive,
  };
}
