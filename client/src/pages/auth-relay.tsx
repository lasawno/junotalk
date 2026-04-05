/**
 * auth-relay.tsx — JunoTalk Social Login Relay
 *
 * A transparent "trampoline" page.  It never shows any UI of its own —
 * it either redirects outbound to the platform (first visit) or navigates
 * back into the main app with relay params (return visit).
 *
 * FIRST VISIT:
 *   Browser arrives here from launchMobileSignIn instead of going directly
 *   to YouTube / TikTok / etc.  The relay:
 *     1. Writes its state to sessionStorage.
 *     2. Immediately redirects the browser to the external platform.
 *   This page stays in the browser's back-stack.
 *
 * RETURN VISIT (Back button / notification deep-link):
 *   Browser lands back here.  Relay reads the stored state and navigates
 *   to /home?rp=<platformId>&rn=<platformName>&rt=<loginUrl>.
 *   The home page (via useSocialPopup) reads those params on mount and
 *   shows the "You're back!" overlay ON TOP of the full JunoTalk UI.
 */

import { useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { buildJunoTalkBrowserURL } from "@/lib/junotalk-browser";

const RELAY_KEY = "junotalk_relay_active";

type RelayInfo = {
  platform: string;
  name: string;
  color: string;
  target: string;
};

function parseParams(): { info: RelayInfo; returnMode: boolean } {
  const p = new URLSearchParams(window.location.search);
  return {
    returnMode: p.get("return") === "1",
    info: {
      platform: p.get("platform") || "platform",
      name:     p.get("name")     || p.get("platform") || "the platform",
      color:    p.get("color")    || "#4285f4",
      target:   p.get("target")   || "",
    },
  };
}

export default function AuthRelay() {
  const [, navigate] = useLocation();

  const goHome = useCallback((info: RelayInfo) => {
    sessionStorage.removeItem(RELAY_KEY);
    const qs = new URLSearchParams({ rp: info.platform, rn: info.name, rt: info.target });
    navigate(`/home?${qs.toString()}`);
  }, [navigate]);

  useEffect(() => {
    const { info, returnMode } = parseParams();

    // Notification tap or explicit return=1 → hand off to home immediately
    if (returnMode) {
      const stored = sessionStorage.getItem(RELAY_KEY);
      const active: RelayInfo = (() => {
        try { return stored ? JSON.parse(stored) : info; } catch { return info; }
      })();
      goHome(active);
      return;
    }

    // Already launched → we're returning from the platform
    const stored = sessionStorage.getItem(RELAY_KEY);
    if (stored) {
      try {
        goHome(JSON.parse(stored));
      } catch {
        navigate("/home");
      }
      return;
    }

    // First visit — save state, redirect outbound
    if (!info.target) { navigate("/home"); return; }

    sessionStorage.setItem(RELAY_KEY, JSON.stringify(info));
    window.location.href = buildJunoTalkBrowserURL(info.target);

    // Fallback: deep-link scheme may not open Chrome; go plain HTTPS
    const t = setTimeout(() => {
      if (document.visibilityState !== "hidden") {
        window.location.href = info.target;
      }
    }, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bfcache restore — pageshow fires even when React doesn't re-mount
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const stored = sessionStorage.getItem(RELAY_KEY);
      if (!stored) return;
      try { goHome(JSON.parse(stored)); }
      catch { navigate("/home"); }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [goHome, navigate]);

  // Minimal loading screen (shown for the ~180 ms before the outbound redirect)
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "#040712" }}
      data-testid="relay-redirecting"
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: "rgba(100,140,255,0.65)" }}
        />
        <p className="text-white/25 text-xs tracking-wide">Opening platform…</p>
      </div>
    </div>
  );
}
