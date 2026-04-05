import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Zap, Globe, Monitor, Shield, ExternalLink, AlertTriangle, X, HandCoins } from "lucide-react";
import { CDN_ASSETS } from "@/lib/cdn";
const junoLogo = CDN_ASSETS.planetOrb;
import { Link, useLocation } from "wouter";
import BackTriangle from "@/components/BackTriangle";
import MobileBottomNav from "@/components/MobileBottomNav";

const ALLOWED_DOMAINS = new Set([
  "www.swagbucks.com",
  "www.inboxdollars.com",
  "www.mistplay.com",
  "gengo.com",
  "translated.com",
  "unbabel.com",
  "www.rakuten.com",
  "ibotta.com",
  "www.joinhoney.com",
  "www.fiverr.com",
  "www.upwork.com",
  "www.mturk.com",
]);

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}

const CATEGORIES = [
  {
    id: "quick",
    icon: Zap,
    iconColor: "text-yellow-400",
    title: "Quick Earnings",
    description: "Complete simple tasks, surveys, and app trials to start earning right away.",
    buttonText: "Start",
    streakAngle: "135deg",
    streakPos: "40%",
    links: [
      { label: "Swagbucks - Earn rewards for surveys & tasks", url: "https://www.swagbucks.com" },
      { label: "InboxDollars - Get paid to read emails", url: "https://www.inboxdollars.com" },
      { label: "Mistplay - Earn for playing mobile games", url: "https://www.mistplay.com" },
    ],
  },
  {
    id: "language",
    icon: Globe,
    iconColor: "text-blue-400",
    title: "Language Opportunities",
    description: "Use your language skills for freelance translation and global communication work.",
    buttonText: "Explore",
    streakAngle: "140deg",
    streakPos: "55%",
    links: [
      { label: "Gengo - Freelance translation jobs", url: "https://gengo.com" },
      { label: "Translated - Professional translation work", url: "https://translated.com" },
      { label: "Unbabel - AI-assisted translation tasks", url: "https://unbabel.com" },
    ],
  },
  {
    id: "bonus",
    icon: null as any,
    iconColor: "text-orange-400",
    title: "Bonus Signups",
    description: "Join verified platforms and earn sign-up bonuses plus cash-back rewards.",
    buttonText: "View Offers",
    streakAngle: "130deg",
    streakPos: "45%",
    links: [
      { label: "Rakuten - Cash back on shopping", url: "https://www.rakuten.com" },
      { label: "Ibotta - Earn cash back on groceries", url: "https://ibotta.com" },
      { label: "Honey - Automatic coupon savings", url: "https://www.joinhoney.com" },
    ],
  },
  {
    id: "remote",
    icon: Monitor,
    iconColor: "text-cyan-400",
    title: "Remote Tasks",
    description: "Find flexible online work you can do from anywhere on your own schedule.",
    buttonText: "Discover",
    streakAngle: "145deg",
    streakPos: "50%",
    links: [
      { label: "Fiverr - Freelance services marketplace", url: "https://www.fiverr.com" },
      { label: "Upwork - Remote freelance work", url: "https://www.upwork.com" },
      { label: "Amazon Mechanical Turk - Micro tasks", url: "https://www.mturk.com" },
    ],
  },
];

function ExitConfirmModal({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  const domain = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="modal-exit-confirm">
      <Card className="w-full max-w-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <CardTitle className="text-base">Leaving JunoTalk</CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-exit-close">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>You are about to visit an external website:</p>
            <p className="font-mono text-xs bg-muted px-3 py-2 rounded break-all" data-testid="text-exit-domain">{domain}</p>
            <p>This is an independent partner platform not operated by JunoTalk. Please review their terms and privacy policy before proceeding.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-exit-cancel">
              Stay
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                try {
                  const parsed = new URL(url);
                  if (parsed.protocol === "https:") {
                    window.open(url, "_blank", "noopener,noreferrer");
                  }
                } catch {}
                onClose();
              }}
              data-testid="button-exit-proceed"
            >
              <ExternalLink className="w-4 h-4 mr-1" />
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Earning() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [exitLink, setExitLink] = useState<{ url: string; label: string } | null>(null);

  useSEO(SEO_CONFIGS.earning);

  const handleExternalLink = (url: string, label: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return;
    } catch { return; }
    setExitLink({ url, label });
  };

  return (
    <div className="min-h-screen bg-background relative">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-earning" label="Earning Hub" />
        </div>
      
      </header>

      <main className="px-4 py-6 space-y-5 max-w-lg mx-auto">
        <div className="text-center space-y-2 py-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
            <HandCoins className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold" data-testid="text-earning-heading">
            Earn with JunoTalk
          </h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Find trusted tasks, quick rewards, remote work, and language gigs.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isExpanded = expandedCategory === cat.id;
            return (
              <div key={cat.id} className={`${isExpanded ? "col-span-2" : ""}`}>
                <div
                  className="rounded-xl border border-blue-500/15 h-full flex flex-col overflow-hidden relative"
                  style={{
                    background: `linear-gradient(${cat.streakAngle}, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)`,
                  }}
                  data-testid={`card-earning-${cat.id}`}
                >
                  <div className="pt-3 pb-3 px-3 flex flex-col flex-1 relative z-10">
                    <div className="flex items-center gap-2 mb-0.5">
                      {cat.id === "bonus" ? (
                        <img src={junoLogo} alt="Juno" className="w-5 h-5 flex-shrink-0 rounded-full object-cover" />
                      ) : Icon ? (
                        <Icon className={`w-4 h-4 ${cat.iconColor} flex-shrink-0`} />
                      ) : null}
                      <h3 className="text-[13px] font-bold text-white leading-tight" data-testid={`text-category-${cat.id}`}>{cat.title}</h3>
                    </div>
                    <p className="text-[11px] text-blue-200/70 mb-2 leading-snug" data-testid={`text-description-${cat.id}`}>{cat.description}</p>
                    <div className="mt-auto flex justify-end">
                      <button
                        className="px-3 py-1 text-xs font-semibold text-blue-200 border border-blue-400/40 rounded-md bg-blue-500/10"
                        onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                        data-testid={`button-category-${cat.id}`}
                      >
                        {isExpanded ? "Close" : cat.buttonText} &rsaquo;
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-blue-500/15 space-y-2" data-testid={`links-${cat.id}`}>
                        {cat.links.map((link, i) => (
                          <button
                            key={i}
                            onClick={() => handleExternalLink(link.url, link.label)}
                            className="flex items-start gap-2 text-sm text-blue-300 w-full text-left"
                            data-testid={`link-${cat.id}-${i}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{link.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(160deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="card-earning-security">
          <CardContent className="flex items-start gap-3 pt-5">
            <Shield className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-200/70">
              <p className="font-medium text-white text-sm" data-testid="text-security-heading">Your Security</p>
              <p className="mt-1 leading-relaxed" data-testid="text-security-details">All connections are encrypted over HTTPS. External links open in new tabs and are clearly marked with a confirmation step. JunoTalk does not store sensitive earning data. No external scripts are loaded on this page.</p>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-earning-disclaimer">
          Opportunities are provided by independent partner platforms. JunoTalk connects users to external earning opportunities and may receive commissions from participation. Earnings are not guaranteed and depend on individual effort, availability, and partner platform terms. Always review partner terms before participating.
        </p>

        <div className="flex items-center justify-center gap-2 pt-2" data-testid="link-back-to-home">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-to-home" size="sm" />
          <span className="text-sm text-primary font-medium">Back to JunoTalk</span>
        </div>
      </main>

      <div className="pb-20 sm:pb-3" />
      <MobileBottomNav />

      {exitLink && (
        <ExitConfirmModal
          url={exitLink.url}
          label={exitLink.label}
          onClose={() => setExitLink(null)}
        />
      )}
    </div>
  );
}
