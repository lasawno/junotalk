import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, getAuthPolicy } from "@/hooks/use-auth";
import { useSessionHeartbeat } from "@/hooks/use-session-heartbeat";
import { useUpdateCheck, consumePendingUpdate } from "@/hooks/use-update-check";
import { I18nProvider } from "@/lib/i18n.jsx";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { ConnectionDot } from "@/components/ConnectionDot";
import { FeatureFlagsProvider } from "@/components/FeatureFlagsProvider";
import { CallProvider } from "@/contexts/call-context";
import { STORAGE_KEYS } from "@/lib/storage-keys";

/** Resets error state automatically whenever the user navigates to a new route */
function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

function retryImport<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    const key = "__retry_reload__";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
      // Page is reloading — keep Suspense suspended until reload completes
      return new Promise<T>(() => {});
    }
    // Already reloaded recently — throw so ErrorBoundary can show a recovery UI
    // instead of hanging forever on the loading screen
    throw err;
  });
}

const Toaster = lazy(() => retryImport(() => import("@/components/ui/toaster").then(m => ({ default: m.Toaster }))));
const CookieConsent = lazy(() => retryImport(() => import("@/components/CookieConsent")));

const Landing = lazy(() => retryImport(() => import("@/pages/landing")));
const Home = lazy(() => retryImport(() => import("@/pages/home")));
const Chat = lazy(() => retryImport(() => import("@/pages/chat")));
const RoomCall = lazy(() => retryImport(() => import("@/pages/room-call")));
const ActiveRoom = lazy(() => retryImport(() => import("@/pages/active-room")));
const JoinRoom = lazy(() => retryImport(() => import("@/pages/join-room")));
const Settings = lazy(() => retryImport(() => import("@/pages/settings")));
const Profile = lazy(() => retryImport(() => import("@/pages/profile")));
const AddContact = lazy(() => retryImport(() => import("@/pages/add-contact")));
const Calls = lazy(() => retryImport(() => import("@/pages/calls")));
const DeveloperPortal = lazy(() => retryImport(() => import("@/pages/developer-portal")));
const Onboarding = lazy(() => retryImport(() => import("@/pages/onboarding")));
const PrivacyPolicy = lazy(() => retryImport(() => import("@/pages/privacy-policy")));
const Support = lazy(() => retryImport(() => import("@/pages/support")));
const FeedbackPage = lazy(() => retryImport(() => import("@/pages/feedback")));
const ChatRooms = lazy(() => retryImport(() => import("@/pages/chat-rooms")));
const RoomChat = lazy(() => retryImport(() => import("@/pages/room-chat")));
const Earning = lazy(() => retryImport(() => import("@/pages/earning")));
const VoiceTranslate = lazy(() => retryImport(() => import("@/pages/voice-translate")));
const TravelESim = lazy(() => retryImport(() => import("@/pages/travel-esim")));
const NotFound = lazy(() => retryImport(() => import("@/pages/not-found")));
const Terms = lazy(() => retryImport(() => import("@/pages/terms")));
const DashboardTheme = lazy(() => retryImport(() => import("@/pages/dashboard-theme")));
const AiAgentHub = lazy(() => retryImport(() => import("@/pages/ai-agent-hub")));
const JunoHistory = lazy(() => retryImport(() => import("@/pages/juno-history")));
const JunoSession = lazy(() => retryImport(() => import("@/pages/juno-session")));
const AuthRelay   = lazy(() => retryImport(() => import("@/pages/auth-relay")));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#050c1e" }}>
      <div className="relative flex items-center justify-center">
        <div
          className="absolute rounded-full"
          style={{
            width: 220,
            height: 220,
            background: "radial-gradient(circle, rgba(100,140,255,0.28) 0%, rgba(100,140,255,0) 70%)",
            animation: "pageLoaderGlow 1.4s ease-in-out infinite alternate",
          }}
        />
        <img
          src="/speech-bubble-icon.png"
          alt=""
          width={160}
          height={160}
          className="relative z-10 object-contain"
          style={{ animation: "pageLoaderPulse 1.4s ease-in-out infinite alternate" }}
        />
      </div>
      <style>{`
        @keyframes pageLoaderPulse {
          from { transform: scale(1.0); opacity: 0.85; }
          to   { transform: scale(1.12); opacity: 1; }
        }
        @keyframes pageLoaderGlow {
          from { transform: scale(0.85); opacity: 0.4; }
          to   { transform: scale(1.2); opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}

const SPLASH_SESSION_KEY = STORAGE_KEYS.splashSeen;

function shouldShowSplash(): boolean {
  try {
    if (typeof navigator !== "undefined" && /lighthouse|googlebot|pagespeed|playwright|headless/i.test(navigator.userAgent)) {
      return false;
    }
    if (new URLSearchParams(window.location.search).has("skipSplash")) {
      return false;
    }
    if (sessionStorage.getItem(SPLASH_SESSION_KEY)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const TRANSLATION_CHARS = [
  "あ", "文", "Â", "Ω", "ب", "가", "А", "花", "大", "朝",
  "ñ", "ü", "ø", "ê", "百", "茶", "龙", "光", "工", "井",
  "タ", "ム", "ヨ", "ス", "サ", "ハ", "ヤ", "コ", "セ", "ネ",
  "ع", "ش", "ف", "ق", "ح", "ك", "م", "ط", "ض", "ز",
  "Ă", "Ğ", "Ş", "Ő", "Ŧ", "Đ", "Ŋ", "Ʒ", "Ɓ", "Ƙ",
  "α", "β", "γ", "δ", "θ", "λ", "π", "σ", "φ", "ψ",
  "Б", "Д", "Ж", "И", "Л", "Ф", "Ц", "Ч", "Щ", "Э",
  "漢", "ম", "翻", "ท", "ገ", "မ", "ꦏ", "ᮞ", "ꤊ", "ᱚ",
];

function generateParticles() {
  const cols = 10;
  const rows = Math.ceil(TRANSLATION_CHARS.length / cols);
  const cellW = 420 / cols;
  const cellH = 740 / rows;
  return TRANSLATION_CHARS.map((word, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tx = col * cellW - 210 + cellW * 0.5 + (Math.random() - 0.5) * cellW * 0.5;
    const ty = row * cellH - 370 + cellH * 0.5 + (Math.random() - 0.5) * cellH * 0.5;
    const rot = (Math.random() - 0.5) * 25;
    const size = 14 + Math.random() * 18;
    const delay = Math.random() * 0.25;
    return { word, tx, ty, rot, size, delay };
  });
}

function CinematicSplash({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(1);
  const [pulseCount, setPulseCount] = useState(1);
  const [particles] = useState(() => generateParticles());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    // Remove the pre-React HTML splash overlay the instant this component mounts.
    // Both overlays are black + same icon, so removing it is invisible.
    const htmlSplash = document.getElementById("html-splash");
    if (htmlSplash) htmlSplash.remove();

    try { sessionStorage.setItem(SPLASH_SESSION_KEY, "1"); } catch {}
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => { if (!cancelled) setPulseCount(2); }, 350));
    timers.push(setTimeout(() => { if (!cancelled) setPulseCount(3); }, 700));
    timers.push(setTimeout(() => { if (!cancelled) setPulseCount(4); }, 1050));

    timers.push(setTimeout(() => { if (!cancelled) setPhase(2); }, 1300));
    timers.push(setTimeout(() => { if (!cancelled) setPhase(3); }, 1750));
    timers.push(setTimeout(() => {
      if (cancelled) return;
      onCompleteRef.current();
    }, 2200));

    // Hard safety: force-complete after 4s no matter what so we can never
    // leave the user permanently stuck behind the splash screen.
    timers.push(setTimeout(() => {
      if (cancelled) return;
      onCompleteRef.current();
    }, 4000));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const pulseScale = phase === 1
    ? (pulseCount % 2 === 1 ? 1.15 : 1.0)
    : 1.0;

  const glowScale = phase === 1
    ? (pulseCount % 2 === 1 ? 1.2 : 0.85)
    : 1.0;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        background: "#000",
        transition: "opacity 0.55s ease-out",
        opacity: phase >= 3 ? 0 : 1,
        overflow: "hidden",
        touchAction: "none",
        contain: "strict",
      }}
    >
      <div className="min-h-screen flex items-center justify-center overflow-hidden">
        <div className="relative flex items-center justify-center" style={{ width: 400, height: 720, contain: "layout style" }}>
          <div
            className="absolute rounded-full"
            style={{
              width: 400,
              height: 400,
              background: "radial-gradient(circle, rgba(100,140,255,0.3) 0%, rgba(100,140,255,0) 70%)",
              opacity: phase >= 2 ? 0 : (pulseCount % 2 === 1 ? 0.9 : 0.4),
              transform: phase >= 2 ? "scale(3)" : `scale(${glowScale})`,
              willChange: "transform, opacity",
              transition: phase >= 2
                ? "opacity 0.3s ease-out, transform 0.5s ease-out"
                : "opacity 0.3s ease-in-out, transform 0.3s ease-in-out",
            }}
          />
          <img
            src="/speech-bubble-icon.png"
            alt=""
            width={320}
            height={320}
            className="w-80 h-80 object-contain relative z-10"
            style={{
              opacity: phase >= 2 ? 0 : 1,
              transform: phase >= 2
                ? "scale(2.5)"
                : `scale(${pulseScale})`,
              filter: phase >= 2 ? "blur(8px) brightness(2)" : "none",
              willChange: "transform, opacity, filter",
              transition: phase >= 2
                ? "opacity 0.25s ease-out, transform 0.35s ease-out, filter 0.25s ease-out"
                : "transform 0.3s ease-in-out",
            }}
          />
          {particles.map((p, i) => {
            const isShattered = phase >= 2;
            const isFading = phase >= 3;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  fontWeight: 700,
                  fontSize: p.size,
                  color: `hsl(${215 + (i * 7) % 30}, ${80 + (i * 3) % 20}%, ${70 + (i * 5) % 15}%)`,
                  whiteSpace: "nowrap",
                  opacity: isShattered ? (isFading ? 0 : 0.95) : 0,
                  transform: isShattered
                    ? `translate(${p.tx}px, ${p.ty}px) rotate(${p.rot}deg) scale(1)`
                    : "translate(0, 0) rotate(0deg) scale(0)",
                  willChange: phase < 3 ? "transform, opacity" : "auto",
                  transition: isFading
                    ? `opacity 0.5s ease-out ${p.delay}s`
                    : `opacity 0.15s ease-in, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${p.delay}s`,
                  textShadow: "0 0 16px rgba(100,150,255,0.7), 0 0 40px rgba(80,120,255,0.3)",
                  zIndex: 20,
                  pointerEvents: "none",
                }}
              >
                {p.word}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function useScrollBrighten() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
          } else {
            entry.target.classList.remove("in-view");
          }
        });
      },
      { threshold: 0.15 }
    );

    const observe = () => {
      document.querySelectorAll(".scroll-brighten").forEach((el) => {
        observer.observe(el);
      });
    };

    observe();
    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
    };
  }, []);
}

function SeamlessUpdateWatcher() {
  const [location] = useLocation();
  const prevLocationRef = useRef(location);
  const { updateAvailable } = useUpdateCheck();

  useEffect(() => {
    if (location !== prevLocationRef.current && updateAvailable) {
      if (consumePendingUpdate()) {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;opacity:0;transition:opacity 0.25s ease;pointer-events:none;";
        document.body.appendChild(overlay);
        requestAnimationFrame(() => { overlay.style.opacity = "1"; });
        setTimeout(() => {
          window.location.href = location;
        }, 280);
        return;
      }
    }
    prevLocationRef.current = location;
  }, [location, updateAvailable]);

  return null;
}

function useVisibilityAutoLogout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Read the remote policy — default is disabled (server-side session handles expiry).
    // Can be re-enabled remotely via config/auth-policy.json in the GitHub CDN.
    const policy = getAuthPolicy();
    if (!policy.visibility_logout_enabled) return;

    const delay = policy.visibility_logout_delay_ms;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        timerRef.current = setTimeout(() => {
          window.location.href = "/api/logout";
        }, delay);
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

function usePrefetchPages() {
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    const timer = setTimeout(() => {
      const pages = [
        () => import("@/pages/room-chat"),
        () => import("@/pages/room-call"),
        () => import("@/pages/chat-rooms"),
        () => import("@/pages/profile"),
        () => import("@/pages/voice-translate"),
        () => import("@/pages/calls"),
        () => import("@/pages/active-room"),
        () => import("@/pages/support"),
        () => import("@/pages/earning"),
        () => import("@/pages/travel-esim"),
        () => import("@/pages/feedback"),
      ];
      let i = 0;
      const loadNext = () => {
        if (i < pages.length) {
          pages[i]().catch(() => {}).finally(() => { i++; setTimeout(loadNext, 150); });
        }
      };
      loadNext();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
}

function AuthenticatedRoutes() {
  useSessionHeartbeat();
  useScrollBrighten();
  useVisibilityAutoLogout();
  usePrefetchPages();
  const [showSplash, setShowSplash] = useState(() => shouldShowSplash());
  const handleSplashComplete = useCallback(() => setShowSplash(false), []);

  // Safety net: if splash was already seen this session (showSplash=false),
  // CinematicSplash never mounts and never cleans up the HTML overlay.
  // Remove it here immediately instead.
  useEffect(() => {
    if (!showSplash) {
      const htmlSplash = document.getElementById("html-splash");
      if (htmlSplash) htmlSplash.remove();
    }
  }, [showSplash]);

  return (
    <CallProvider>
      <ConnectionBanner />
      <ConnectionDot />
      <SeamlessUpdateWatcher />
      {/* While splash is active it covers the screen — suppress PageLoader to avoid two loading visuals */}
      <Suspense fallback={showSplash ? null : <PageLoader />}>
        <PageErrorBoundary>
        <Switch>
          <Route path="/auth/relay" component={AuthRelay} />
          <Route path="/" component={Home} />
          <Route path="/home" component={Home} />
          <Route path="/join/:code" component={JoinRoom} />
          <Route path="/chat/:contactId" component={Chat} />
          <Route path="/room/:code/call" component={RoomCall} />
          <Route path="/room/:code" component={ActiveRoom} />
          <Route path="/settings" component={Settings} />
          <Route path="/profile" component={Profile} />
          <Route path="/add-contact" component={AddContact} />
          <Route path="/calls" component={Calls} />
          <Route path="/call-history" component={Calls} />
          <Route path="/developer" component={DeveloperPortal} />
          <Route path="/support" component={Support} />
          <Route path="/feedback" component={FeedbackPage} />
          <Route path="/chat-rooms/:code" component={RoomChat} />
          <Route path="/chat-rooms" component={ChatRooms} />
          <Route path="/earning" component={Earning} />
          <Route path="/juno" component={VoiceTranslate} />
          <Route path="/travel-esim" component={TravelESim} />
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route path="/terms" component={Terms} />
          <Route path="/dashboard-theme" component={DashboardTheme} />
          <Route path="/ai-agent-hub" component={AiAgentHub} />
          <Route path="/juno/history" component={JunoHistory} />
          <Route path="/juno/session/:id" component={JunoSession} />
          <Route component={NotFound} />
        </Switch>
        </PageErrorBoundary>
      </Suspense>
      {showSplash && <CinematicSplash onComplete={handleSplashComplete} />}
    </CallProvider>
  );
}

function Router() {
  const { user, isLoading } = useAuth();
  const wasOnboardingRef = useRef(false);
  // Never hold the user on a black screen indefinitely. If the auth check
  // hasn't resolved in 5 seconds, treat it as "not logged in" so the
  // landing page shows and they can at least try to log in.
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setLoadingTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading && !loadingTimedOut) {
    return <div className="min-h-screen bg-black" />;
  }

  if (!user) {
    // Clear both the session flag and the HTML splash overlay.
    // The overlay is position:fixed z-9999 and is only removed inside
    // AuthenticatedRoutes — which never mounts when logged out — so without
    // this the splash covers the entire login page and users can't log in.
    try { sessionStorage.removeItem(SPLASH_SESSION_KEY); } catch {}
    try {
      const htmlSplash = document.getElementById("html-splash");
      if (htmlSplash) htmlSplash.remove();
    } catch {}
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/auth/relay" component={AuthRelay} />
          <Route path="/join/:code">{() => isLoading ? <PageLoader /> : <JoinRoom />}</Route>
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route component={Landing} />
        </Switch>
      </Suspense>
    );
  }

  if (!user.onboardingComplete) {
    wasOnboardingRef.current = true;
    // Remove the HTML splash here too — AuthenticatedRoutes never mounts
    // during onboarding, so the overlay would cover the onboarding UI otherwise.
    try {
      const htmlSplash = document.getElementById("html-splash");
      if (htmlSplash) htmlSplash.remove();
    } catch {}
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/auth/relay" component={AuthRelay} />
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route component={Onboarding} />
        </Switch>
      </Suspense>
    );
  }

  if (wasOnboardingRef.current) {
    wasOnboardingRef.current = false;
    try { sessionStorage.removeItem(SPLASH_SESSION_KEY); } catch {}
  }

  return <AuthenticatedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <FeatureFlagsProvider>
          <TooltipProvider>
            <Suspense fallback={null}><Toaster /></Suspense>
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
            <Suspense fallback={null}><CookieConsent /></Suspense>
          </TooltipProvider>
        </FeatureFlagsProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
