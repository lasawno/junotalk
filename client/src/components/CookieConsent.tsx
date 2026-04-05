import { useState, useEffect } from "react";
import { Cookie, Shield } from "lucide-react";
import { getConsentStatus, setConsent } from "@/lib/cookie-consent";

const initialStatus = getConsentStatus();

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (initialStatus !== "pending") return;
    const status = getConsentStatus();
    if (status === "pending") {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    setConsent("accepted");
    setVisible(false);
  };

  const handleDecline = () => {
    setConsent("declined");
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300"
      data-testid="cookie-consent-overlay"
    >
      <div
        className="w-full max-w-lg mx-3 mb-4 rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden animate-in slide-in-from-bottom-4 duration-400"
        data-testid="cookie-consent-banner"
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Cookie className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                Cookie Preferences
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                We use cookies to improve your experience and remember your preferences. 
                Accepting helps us provide a better, more personalized service.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 mb-4">
            <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
              Your data is encrypted and never shared without consent. 
              <a href="/privacy" className="text-primary underline ml-0.5" data-testid="cookie-privacy-link">Privacy Policy</a>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDecline}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              data-testid="cookie-decline-btn"
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors shadow-sm"
              data-testid="cookie-accept-btn"
            >
              Accept All Cookies
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
