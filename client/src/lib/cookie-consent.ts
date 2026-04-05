import { STORAGE_KEYS } from "@/lib/storage-keys";
const CONSENT_KEY = STORAGE_KEYS.cookieConsent;

export type ConsentStatus = "accepted" | "declined" | "pending";

const listeners = new Set<(status: ConsentStatus) => void>();

export function getConsentStatus(): ConsentStatus {
  try {
    const val = localStorage.getItem(CONSENT_KEY);
    if (val === "accepted" || val === "declined") return val;
  } catch {}
  return "pending";
}

export function setConsent(status: "accepted" | "declined") {
  try {
    localStorage.setItem(CONSENT_KEY, status);
  } catch {}
  listeners.forEach((fn) => fn(status));
}

export function onConsentChange(fn: (status: ConsentStatus) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
