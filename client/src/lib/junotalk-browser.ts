/**
 * junotalk-browser.ts
 *
 * Isolated module for JunoTalk Browser popup / OAuth routing.
 * Pure utility functions — no React, no side-effects on import.
 *
 * Architecture note (see replit.md § Authentication Flow):
 *   Desktop  → window.open() with "popup" keyword — fully detached, movable window.
 *              NOT an iframe. X-Frame-Options / frame-ancestors CSP do not apply.
 *   Mobile   → window.location.href redirect via iOS googlechromes:// scheme or
 *              Android Intent URL (com.android.chrome). sessionStorage holds the
 *              pending platform ID; auto-confirmed on return.
 */

import { STORAGE_KEYS } from "@/lib/storage-keys";

// ─── Storage keys ─────────────────────────────────────────────────────────────
export const PENDING_KEY       = "junotalk_social_pending";
export const BROWSER_SETUP_KEY = "junotalk_browser_setup_dismissed";
const        BROWSER_MODE      = "chrome_popup";

// ─── Desktop popup config ─────────────────────────────────────────────────────
export const POPUP_WIDTH  = 480;
export const POPUP_HEIGHT = 660;
export const POPUP_NAME   = "junotalk_browser";
export const POLL_INTERVAL_MS = 600;
export const MOBILE_REDIRECT_DELAY_MS = 180;
export const MOBILE_FALLBACK_DELAY_MS = 1500;

// ─── Device detection ─────────────────────────────────────────────────────────

/** True on any mobile/tablet device. */
export function isMobileDevice(): boolean {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * True when the device needs JunoTalk Browser activation.
 * iOS without Chrome (CriOS) or Android without Chrome are the two cases
 * where the standard system browser won't handle the popup correctly.
 */
export function needsBrowserSetup(): boolean {
  const ua = navigator.userAgent;
  const iosNonChrome     = /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
  const androidNonChrome = /Android/i.test(ua) && !/Chrome\//i.test(ua);
  return iosNonChrome || androidNonChrome;
}

// ─── Browser mode persistence ─────────────────────────────────────────────────

/**
 * Writes the browser mode flag to localStorage on every sign-in initiation.
 * Keeps the mode consistent across sessions.
 */
export function ensureBrowserMode(): void {
  if (localStorage.getItem(STORAGE_KEYS.socialBrowserMode) !== BROWSER_MODE) {
    localStorage.setItem(STORAGE_KEYS.socialBrowserMode, BROWSER_MODE);
  }
}

// ─── URL builders ─────────────────────────────────────────────────────────────

/**
 * Wraps a target URL in the correct JunoTalk Browser deep-link scheme
 * for the current device. Falls through to the original URL on desktop.
 *
 *   iOS   → googlechromes:// (forces Chrome app)
 *   Android → android-app Intent URL targeting com.android.chrome
 *   Other → unchanged
 */
export function buildJunoTalkBrowserURL(target: string): string {
  const ua     = navigator.userAgent;
  const bare   = target.replace(/^https?:\/\//, "");
  const secure = target.startsWith("https");

  if (/iPhone|iPad|iPod/i.test(ua)) {
    return `${secure ? "googlechromes" : "googlechrome"}://${bare}`;
  }
  if (/Android/i.test(ua)) {
    return `intent://${bare}#Intent;scheme=${secure ? "https" : "http"};package=com.android.chrome;end`;
  }
  return target;
}

/**
 * Builds the JunoTalk Browser deep-link for the *current page* (not a target URL).
 * Used by the "Activate" banner to re-open JunoTalk itself inside Chrome.
 */
export function buildSelfActivationURL(): string {
  return buildJunoTalkBrowserURL(window.location.href);
}

// ─── Activation ───────────────────────────────────────────────────────────────

/**
 * Redirects the current page into JunoTalk Browser (Chrome) on iOS / Android.
 * No-op on desktop or already-Chrome mobile.
 */
export function activateJunoTalkBrowser(): void {
  const url = buildSelfActivationURL();
  if (url !== window.location.href) {
    window.location.href = url;
  }
}

// ─── Platform brand colours (used to theme the relay overlay) ─────────────────

export const RELAY_COLORS: Record<string, string> = {
  youtube:   "#ff0000",
  tiktok:    "#ffffff",
  instagram: "#ff0000",
  twitter:   "#ffffff",
  facebook:  "#1877f2",
  threads:   "#ffffff",
  snapchat:  "#fffc00",
  twitch:    "#9146ff",
  discord:   "#5865f2",
  reddit:    "#ff4500",
  linkedin:  "#0077b5",
  pinterest: "#e60023",
  telegram:  "#2aabee",
  whatsapp:  "#25d366",
  spotify:   "#1db954",
  tumblr:    "#35465c",
  rumble:    "#85c742",
  roblox:    "#e3342f",
  steam:     "#1b2838",
  psn:       "#003791",
  epic:      "#ffffff",
  nintendo:  "#e60012",
  riot:      "#d13639",
  itchio:    "#fa5c5c",
  ea:        "#ff4747",
  ubisoft:   "#0070d1",
};

// ─── Desktop popup launcher ───────────────────────────────────────────────────

/**
 * Opens a detached JunoTalk Browser popup window (desktop only).
 * Returns the Window handle, or null if the popup was blocked.
 *
 * The popup is:
 *   • A separate browser window (NOT an iframe)
 *   • Centred on screen
 *   • Named "junotalk_browser" so repeated calls reuse the same slot
 */
export function openPopupWindow(url: string): Window | null {
  const left = Math.round(window.screenX + (window.outerWidth  - POPUP_WIDTH)  / 2);
  const top  = Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2);
  const features = `popup,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;

  const win = window.open(url, POPUP_NAME, features);
  if (!win || win.closed || typeof win.closed === "undefined") return null;
  return win;
}

// ─── Mobile redirect launcher ─────────────────────────────────────────────────

/**
 * Handles the full mobile sign-in redirect flow via the /auth/relay trampoline.
 *
 * Instead of going straight to the external platform, the browser navigates to
 * /auth/relay which stores state and immediately redirects outbound.  /auth/relay
 * stays in the browser's back-stack, so when the user presses Back (iOS swipe or
 * Android back button) they land on OUR page — which detects the return and shows
 * the "You're back!" overlay.
 */
export function launchMobileSignIn(platformId: string, loginUrl: string, platformName?: string): void {
  const name  = platformName ?? platformId;
  const color = RELAY_COLORS[platformId] ?? "#4285f4";

  const relayUrl = [
    "/auth/relay",
    `?platform=${encodeURIComponent(platformId)}`,
    `&name=${encodeURIComponent(name)}`,
    `&color=${encodeURIComponent(color)}`,
    `&target=${encodeURIComponent(loginUrl)}`,
  ].join("");

  setTimeout(() => {
    window.location.href = relayUrl;
  }, MOBILE_REDIRECT_DELAY_MS);
}

// ─── Return notifications ─────────────────────────────────────────────────────

/**
 * Requests browser notification permission.
 * Called before redirecting so we have permission when we need it.
 * Returns true if permission is granted (or was already granted).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/**
 * Fires an OS-level notification immediately (before the page navigates away).
 * The notification stays in the tray while the user is on the external platform.
 * Tapping it navigates directly to /auth/relay?...&return=1, which shows the
 * "You're back!" overlay without needing the user to press Back manually.
 * No-op if permission was not granted.
 */
export function fireReturnNotification(platformId: string, platformName: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const color     = RELAY_COLORS[platformId] ?? "#4285f4";
    const returnUrl = [
      window.location.origin,
      "/auth/relay",
      `?platform=${encodeURIComponent(platformId)}`,
      `&name=${encodeURIComponent(platformName)}`,
      `&color=${encodeURIComponent(color)}`,
      "&return=1",
    ].join("");

    const n = new Notification(`Done with ${platformName}?`, {
      body: "Tap here to return to JunoTalk and confirm your connection.",
      tag: "junotalk-return",
      requireInteraction: true,
    });
    n.onclick = () => {
      window.open(returnUrl, "_self");
      n.close();
    };
  } catch { /* unsupported */ }
}

// ─── Return detection ─────────────────────────────────────────────────────────

/**
 * Reads and clears the pending platform from sessionStorage.
 * Call this on component mount to detect a mobile auth return.
 * Returns the full platform object if present, otherwise null.
 */
export function consumePendingReturn(): { id: string; name: string; loginUrl: string } | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    // Legacy: old sessions stored only the ID string
    return { id: raw, name: raw, loginUrl: "" };
  }
}
