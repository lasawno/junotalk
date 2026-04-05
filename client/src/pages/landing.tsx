import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { Button } from "@/components/ui/button";
import { Video, MessageSquare, Globe, Shield, Lock, Eye, Trash2, Mic, Languages, X, ChevronDown, Smartphone, ShieldCheck, BadgeCheck, DollarSign, AudioLines, Phone } from "lucide-react";
import { CDN_ASSETS } from "@/lib/cdn";
const logoImage = CDN_ASSETS.logo;
import { translations, SITE_LANGUAGES, type SiteLang } from "@/lib/landing-translations";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import landingBg from "@assets/Untitled_design_1773160647475.png";
import heroImg from "@assets/Untitled_design_1773124384849.png";

const QRCodeSVG = lazy(() => import("qrcode.react").then(m => ({ default: m.QRCodeSVG })));

function LandingShootingStars() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    interface Shooter {
      x: number; y: number; vx: number; vy: number;
      life: number; maxLife: number; len: number;
    }
    const shooters: Shooter[] = [];
    let nextShoot = 1500 + Math.random() * 3000;

    const render = () => {
      const w = W(), h = H();
      ctx.clearRect(0, 0, w, h);

      nextShoot -= 16.67;
      if (nextShoot <= 0) {
        const edge = Math.floor(Math.random() * 4);
        let sx: number, sy: number, angle: number;
        if (edge === 0) { sx = Math.random() * w; sy = -10; angle = Math.random() * 1.0 + 0.5; }
        else if (edge === 1) { sx = w + 10; sy = Math.random() * h * 0.6; angle = Math.PI - (Math.random() * 0.6 + 0.3); }
        else if (edge === 2) { sx = -10; sy = Math.random() * h * 0.6; angle = Math.random() * 0.6 + 0.2; }
        else { sx = Math.random() * w; sy = -10; angle = Math.random() * 0.8 + 0.4; }
        const speed = Math.random() * 4 + 3;
        shooters.push({
          x: sx, y: sy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: Math.random() * 45 + 25,
          len: Math.random() * 100 + 60,
        });
        nextShoot = 2500 + Math.random() * 5000;
      }

      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life++;
        const progress = sh.life / sh.maxLife;
        const fadeIn = Math.min(progress * 5, 1);
        const fadeOut = progress > 0.5 ? 1 - ((progress - 0.5) / 0.5) : 1;
        const a = fadeIn * fadeOut * 0.8;

        if (a > 0) {
          const spd = Math.sqrt(sh.vx * sh.vx + sh.vy * sh.vy);
          const tailX = sh.x - (sh.vx / spd) * sh.len * fadeOut;
          const tailY = sh.y - (sh.vy / spd) * sh.len * fadeOut;

          const sg = ctx.createLinearGradient(tailX, tailY, sh.x, sh.y);
          sg.addColorStop(0, "rgba(255, 255, 255, 0)");
          sg.addColorStop(0.6, `rgba(200, 220, 255, ${a * 0.15})`);
          sg.addColorStop(0.9, `rgba(240, 245, 255, ${a * 0.6})`);
          sg.addColorStop(1, `rgba(255, 255, 255, ${a})`);
          ctx.strokeStyle = sg;
          ctx.lineWidth = 1.2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(sh.x, sh.y);
          ctx.stroke();

          const headGlow = ctx.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, 3);
          headGlow.addColorStop(0, `rgba(255, 255, 255, ${a})`);
          headGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = headGlow;
          ctx.fillRect(sh.x - 3, sh.y - 3, 6, 6);
        }

        if (sh.life >= sh.maxLife) shooters.splice(i, 1);
      }

      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[1] pointer-events-none"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export default function Landing() {
  useSEO(SEO_CONFIGS.landing);
  const [showBetaBanner, setShowBetaBanner] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.betaDismissed) !== "true";
  });
  const [siteLang, setSiteLang] = useState<SiteLang>(() => {
    return (localStorage.getItem(STORAGE_KEYS.siteLang) as SiteLang) || "en";
  });
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const t = translations[siteLang];

  const handleLangChange = (lang: SiteLang) => {
    setSiteLang(lang);
    localStorage.setItem(STORAGE_KEYS.siteLang, lang);
    setLangMenuOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const siteUrl = window.location.origin;
  const currentLang = SITE_LANGUAGES.find(l => l.code === siteLang)!;
  
  return (
    <div className="min-h-screen relative" style={{ backgroundColor: "#030812" }}>
      <main>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-blue-400/50" style={{ background: "rgba(8,16,32,0.88)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 sm:h-20">
            <div className="flex items-center gap-0">
              <span className="text-3xl sm:text-4xl font-bold text-white">Juno<span className="text-primary">Talk</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative" ref={langMenuRef}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="gap-1 text-xs font-semibold px-2"
                  aria-label={`Change language, current: ${currentLang.label}`}
                  aria-expanded={langMenuOpen}
                  aria-haspopup="listbox"
                  data-testid="button-lang-switcher"
                >
                  <Globe className="w-4 h-4" aria-hidden="true" />
                  {currentLang.flag}
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </Button>
                {langMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-card border rounded-lg shadow-lg py-1 min-w-[160px] max-h-[70vh] overflow-y-auto z-50" role="listbox" aria-label="Select language" data-testid="lang-dropdown">
                    {SITE_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        role="option"
                        aria-selected={siteLang === lang.code}
                        onClick={() => handleLangChange(lang.code)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover-elevate ${
                          siteLang === lang.code ? "text-primary font-semibold" : "text-foreground"
                        }`}
                        data-testid={`lang-option-${lang.code}`}
                      >
                        <span className="font-bold text-xs w-6" aria-hidden="true">{lang.flag}</span>
                        {lang.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button asChild data-testid="button-login">
                <a href="/api/login">{t.nav.signIn}</a>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {showBetaBanner && (
        <div className="fixed top-16 sm:top-20 left-0 right-0 z-40 border-b border-blue-400/40" style={{ background: "rgba(3,8,18,0.9)" }} data-testid="beta-banner">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-start gap-3">
            <p className="flex-1 text-sm text-white">
              {t.beta.banner}
            </p>
            <button
              onClick={() => {
                setShowBetaBanner(false);
                localStorage.setItem(STORAGE_KEYS.betaDismissed, "true");
              }}
              className="flex-shrink-0 p-1 rounded-full text-white hover:text-primary transition-colors"
              aria-label="Dismiss beta notice"
              data-testid="button-dismiss-beta"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `url(${landingBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: [
              "radial-gradient(ellipse 70% 90% at -5% 60%, rgba(40,110,240,0.04) 0%, transparent 60%)",
              "radial-gradient(ellipse 50% 80% at 8% 40%, rgba(50,130,255,0.025) 0%, transparent 50%)",
              "radial-gradient(ellipse 90% 60% at 30% 20%, rgba(35,100,220,0.025) 0%, transparent 55%)",
              "radial-gradient(ellipse 80% 50% at 60% 15%, rgba(30,90,210,0.02) 0%, transparent 50%)",
              "radial-gradient(ellipse 70% 70% at 85% 25%, rgba(35,100,220,0.025) 0%, transparent 55%)",
              "radial-gradient(ellipse 60% 80% at 105% 50%, rgba(40,110,240,0.04) 0%, transparent 55%)",
              "radial-gradient(ellipse 80% 40% at 50% 90%, rgba(30,85,200,0.02) 0%, transparent 50%)",
            ].join(", "),
            mixBlendMode: "screen",
          }}
        />
      </div>
      <LandingShootingStars />

      <section className="relative pt-24 pb-10 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="relative max-w-3xl mx-auto">
          <div className="space-y-5 text-center">
            <div className="flex flex-col items-center gap-1">
              <div className="relative flex flex-col items-center w-full overflow-hidden" style={{ maxHeight: '280px' }}>
                <img
                  src={heroImg}
                  alt="Two people speaking different languages connected by AI translation"
                  className="w-[22rem] sm:w-[30rem] object-contain object-top"
                  style={{ filter: "none" }}
                  data-testid="img-hero-translate"
                />
              </div>
              <div className="relative inline-block text-center" data-testid="text-juno-tagline">
                <p className="text-base sm:text-xl font-medium tracking-wide text-white/90" style={{ textShadow: "0 0 14px rgba(255,255,255,0.4), 0 0 30px rgba(100,150,255,0.2)" }}>
                  Hi, I'm <span className="font-bold" style={{ color: "hsl(210, 95%, 72%)" }}>Juno</span>, Your <span className="whitespace-nowrap">Communication AI</span>
                </p>
                <svg className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-[110%] h-3 overflow-visible" viewBox="0 0 200 12" preserveAspectRatio="none">
                  <path d="M10 8 Q100 -2 190 8" fill="none" stroke="url(#streakGrad)" strokeWidth="2" strokeLinecap="round" className="juno-streak" />
                  <defs>
                    <linearGradient id="streakGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                      <stop offset="30%" stopColor="rgba(255,255,255,0.8)" />
                      <stop offset="50%" stopColor="rgba(255,255,255,1)" />
                      <stop offset="70%" stopColor="rgba(255,255,255,0.8)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h1 className="text-[1.55rem] sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mt-2">
                <span className="block" style={{ color: "hsl(210, 95%, 72%)" }}>{t.hero.titleHighlight}</span>
                <span className="block text-white/80 text-[0.75em] font-semibold mt-1">{t.hero.titlePart1}</span>
              </h1>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-0">
              <Button size="lg" asChild data-testid="button-get-started">
                <a href="/api/login">{t.hero.getStarted}</a>
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} className="border-2 border-white/40 text-white bg-white/5 hover:bg-white/15 hover:border-white/70 backdrop-blur-sm" data-testid="button-see-features">
                {t.hero.seeFeatures}
              </Button>
            </div>
            <div className="flex flex-col items-center gap-2 pt-0" data-testid="privacy-pitch">
              <div className="flex items-center justify-center gap-4 flex-wrap text-xl sm:text-2xl">
                <span className="line-through text-white/80 decoration-white/60" style={{ textDecorationThickness: '1px' }}>{t.hero.noPhone}</span>
                <span className="line-through text-white/80 decoration-white/60" style={{ textDecorationThickness: '1px' }}>{t.hero.noSocial}</span>
              </div>
              <p className="text-sm sm:text-base font-semibold text-white/90">
                {t.hero.sixDigit} <span className="text-primary font-bold">{t.hero.sixDigitCode}</span> {t.hero.privacyLine}
              </p>
              <div className="flex items-center justify-center gap-1.5 text-sm text-white/80">
                <Lock className="w-4 h-4 text-primary" aria-hidden="true" />
                <span>{t.hero.privacyEverything}</span>
              </div>
              <div className="pt-3 flex flex-col items-center gap-2 border-t border-white/10 w-48" data-testid="hero-qr-code">
                <p className="text-xs text-white/80 pt-2">{t.hero.scanToSignUp}</p>
                <div className="bg-white p-3 rounded-lg inline-block" role="img" aria-label="QR code to sign up for JunoTalk">
                  <Suspense fallback={null}>
                    <QRCodeSVG
                      value={siteUrl}
                      size={110}
                      level="H"
                      includeMargin={false}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

        <section id="features" className="relative px-4 sm:px-6 lg:px-8 pb-8 scroll-mt-20" aria-label="Features">
          <div className="max-w-7xl mx-auto">
            <h2 className="sr-only">Features</h2>
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-blue-500/15 p-4" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)", boxShadow: "0 0 12px 2px rgba(96,165,250,0.35), 0 0 3px rgba(96,165,250,0.5)" }} data-testid="feature-ai-translation">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border border-blue-400/50" style={{ boxShadow: "0 0 6px 1px rgba(96,165,250,0.4)" }}><Languages className="w-4.5 h-4.5 text-blue-300" aria-hidden="true" /></div>
                  <h3 className="text-[15px] font-bold text-white leading-tight">{t.features.aiTranslation}</h3>
                </div>
                <p className="text-sm text-blue-200/90 leading-snug">{t.features.aiTranslationDesc}</p>
              </div>
              <div className="rounded-xl border border-blue-500/15 p-4" style={{ background: "linear-gradient(140deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)", boxShadow: "0 0 12px 2px rgba(96,165,250,0.35), 0 0 3px rgba(96,165,250,0.5)" }} data-testid="feature-encrypted-calls">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border border-blue-400/50" style={{ boxShadow: "0 0 6px 1px rgba(96,165,250,0.4)" }}><Phone className="w-4.5 h-4.5 text-blue-300" aria-hidden="true" /></div>
                  <h3 className="text-[15px] font-bold text-white leading-tight">{t.features.encryptedCalls}</h3>
                </div>
                <p className="text-sm text-blue-200/90 leading-snug">{t.features.encryptedCallsDesc}</p>
              </div>
              <div className="rounded-xl border border-purple-500/15 p-4" style={{ background: "linear-gradient(140deg, #1a3a6e 0%, #1a1040 50%, #1a3a6e 100%)", boxShadow: "0 0 12px 2px rgba(168,85,247,0.35), 0 0 3px rgba(168,85,247,0.5)" }} data-testid="feature-juno-vision">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border border-purple-400/50" style={{ boxShadow: "0 0 6px 1px rgba(168,85,247,0.4)" }}><Eye className="w-4.5 h-4.5 text-purple-300" aria-hidden="true" /></div>
                  <h3 className="text-[15px] font-bold text-white leading-tight">{t.features.junoVision || "Juno Vision"}</h3>
                </div>
                <p className="text-sm text-purple-200/80 leading-snug">{t.features.junoVisionDesc || "Point your camera at anything and Juno describes what it sees in your language. Foreign menus, street signs, documents, any scene explained instantly."}</p>
              </div>
              <div className="rounded-xl border border-blue-500/15 p-4" style={{ background: "linear-gradient(140deg, #1a3a6e 0%, #0d2a2a 50%, #1a3a6e 100%)", boxShadow: "0 0 12px 2px rgba(20,184,166,0.35), 0 0 3px rgba(20,184,166,0.5)" }} data-testid="feature-esim">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border border-teal-400/50" style={{ boxShadow: "0 0 6px 1px rgba(20,184,166,0.4)" }}><Globe className="w-4.5 h-4.5 text-teal-300" aria-hidden="true" /></div>
                  <h3 className="text-[15px] font-bold text-white leading-tight">{t.features.travelEsim}</h3>
                </div>
                <p className="text-sm text-teal-200/80 leading-snug">{t.features.travelEsimDesc}</p>
              </div>
            </div>
          </div>
        </section>


      
      <section className="relative py-12 px-4 sm:px-6 lg:px-8" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(10,22,40,0.6) 100%)" }}>
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            {t.cta.title}
          </h2>
          <p className="text-lg text-white max-w-2xl mx-auto">
            {t.cta.subtitle}
          </p>
          <Button size="lg" asChild data-testid="button-cta-get-started">
            <a href="/api/login">{t.cta.button}</a>
          </Button>
        </div>
      </section>


      </main>
      <footer className="relative py-4 px-4 sm:px-6 lg:px-8 border-t border-blue-400/50">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">Juno<span className="text-primary">Talk</span></span>
              <span className="text-primary font-bold text-sm select-none">A ⇄ 文</span>
            </div>
            
            <div className="flex flex-col items-center sm:items-end gap-2">
              <div className="flex items-center gap-3 text-sm text-white">
                <button onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-primary transition-colors" data-testid="footer-link-features">{t.nav.features}</button>
                <span className="text-[6px] text-white/70" aria-hidden="true">&#9679;</span>
                <a href="/privacy" className="hover:text-primary transition-colors" data-testid="footer-link-privacy">{t.footer.privacyPolicy}</a>
              </div>
              <details className="group" data-testid="footer-secure-details">
                <summary className="flex items-center justify-center sm:justify-end gap-1.5 cursor-pointer list-none text-sm">
                  <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
                  <span className="font-medium text-primary">{t.footer.securedBy}</span>
                  <span className="text-xs text-white group-open:hidden">{t.footer.tapDetails}</span>
                  <span className="text-xs text-white hidden group-open:inline">{t.footer.tapHide}</span>
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="flex flex-col items-center gap-1 p-2 rounded-md border-2 border-blue-400" style={{ background: "#0f1d3a" }}>
                    <Lock className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    <span className="font-medium text-white">{t.footer.httpsEncrypted}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 rounded-md border-2 border-blue-400" style={{ background: "#0f1d3a" }}>
                    <Eye className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    <span className="font-medium text-white">{t.footer.noRecordings}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 rounded-md border-2 border-blue-400" style={{ background: "#0f1d3a" }}>
                    <Trash2 className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    <span className="font-medium text-white">{t.footer.autoDelete}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 rounded-md border-2 border-blue-400" style={{ background: "#0f1d3a" }}>
                    <Shield className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                    <span className="font-medium text-white">{t.footer.privateRooms}</span>
                  </div>
                </div>
              </details>
              <div className="flex items-center justify-center gap-3 py-2" data-testid="trust-badges-landing">
                <div className="flex items-center gap-1 text-[10px] text-white/90">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <span className="font-medium">Verified Site</span>
                </div>
                <span className="text-[8px] text-white/70" aria-hidden="true">&#9679;</span>
                <div className="flex items-center gap-1 text-[10px] text-white/90">
                  <Lock className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <span className="font-medium">SSL Secured</span>
                </div>
                <span className="text-[8px] text-white/70" aria-hidden="true">&#9679;</span>
                <div className="flex items-center gap-1 text-[10px] text-white/90">
                  <BadgeCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <span className="font-medium">Trusted Platform</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/90" data-testid="text-app-coming-soon-landing">
                <Smartphone className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <span>JunoTalk App Coming Soon</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-white/90">
                <p>{t.footer.rights}</p>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
