import { useState, useEffect, useCallback, useRef } from "react";
import { STORAGE_KEYS, DOM_IDS } from "@/lib/storage-keys";

const CHECK_INTERVAL = 60_000;
const VERSION_KEY = STORAGE_KEYS.knownVersion;
const PENDING_UPDATE_KEY = STORAGE_KEYS.pendingUpdate;

export function useUpdateCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      const res = await fetch("/api/app-version", { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      const known = sessionStorage.getItem(VERSION_KEY);
      if (!known) {
        sessionStorage.setItem(VERSION_KEY, version);
        return;
      }
      if (version !== known) {
        setUpdateAvailable(true);
        sessionStorage.setItem(PENDING_UPDATE_KEY, version);
        try {
          const htmlRes = await fetch("/", { cache: "no-store" });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            const srcMatches = html.match(/src="([^"]+\.js)"/g) || [];
            const hrefMatches = html.match(/href="([^"]+\.css)"/g) || [];
            const urls = [
              ...srcMatches.map(m => m.replace(/^src="/, "").replace(/"$/, "")),
              ...hrefMatches.map(m => m.replace(/^href="/, "").replace(/"$/, "")),
            ];
            urls.forEach(url => {
              const link = document.createElement("link");
              link.rel = "prefetch";
              link.href = url;
              document.head.appendChild(link);
            });
          }
        } catch {}
      }
    } catch {}
  }, []);

  const applyUpdate = useCallback(() => {
    setUpdating(true);
    sessionStorage.removeItem(VERSION_KEY);
    sessionStorage.removeItem(PENDING_UPDATE_KEY);
    const overlay = document.createElement("div");
    overlay.id = DOM_IDS.updateOverlay;
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;opacity:0;transition:opacity 0.3s ease;pointer-events:none;";
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });
    setTimeout(() => { window.location.reload(); }, 350);
  }, []);

  useEffect(() => {
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkForUpdate]);

  return { updateAvailable, updating, applyUpdate };
}

export function hasPendingUpdate(): boolean {
  return !!sessionStorage.getItem(PENDING_UPDATE_KEY);
}

export function consumePendingUpdate(): boolean {
  const pending = sessionStorage.getItem(PENDING_UPDATE_KEY);
  if (pending) {
    sessionStorage.removeItem(VERSION_KEY);
    sessionStorage.removeItem(PENDING_UPDATE_KEY);
    return true;
  }
  return false;
}
