import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Settings, X, Volume2, Check, Languages as LanguagesIcon, AudioLines, History, Eye, HelpCircle, ChevronRight, ChevronLeft, Mic, Send, MessageCircle, Loader2, SquarePen, Trash2, Plus, AlignJustify, Images, Download } from "lucide-react";
import ImageSessionModal from "@/components/ImageSessionModal";
import BackTriangle from "@/components/BackTriangle";
import JunoBubble from "@/components/JunoBubble";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import JunoVision from "@/components/JunoVision";
import { Link, useLocation } from "wouter";
import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import spaceRealBg from "@assets/Night_Sky_Photo_Serene_&_Calm_Virtual_Background_1773787692779.png";
import junoOrbImg from "@assets/juno_clean_transparent_1775255850684.png";
import micIconPath from "@assets/mic_speech_bubbles_icon.png";

// Renders Juno's AI responses with basic formatting:
// - Line breaks (\n) → <br />
// - **bold** → <strong>
// - Lines starting with •, -, or * → rendered as bullet rows
function renderJunoText(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    const isBullet = /^(\s*)(•|-|\*)\s+/.test(line);
    const content = isBullet ? line.replace(/^(\s*)(•|-|\*)\s+/, "") : line;

    // Split on **bold** markers
    const parts = content.split(/\*\*(.*?)\*\*/g);
    const inline: React.ReactNode[] = parts.map((part, pi) =>
      pi % 2 === 1 ? <strong key={pi} style={{ color: "#93c5fd" }}>{part}</strong> : part
    );

    if (isBullet) {
      nodes.push(
        <div key={li} style={{ display: "flex", gap: 8, marginTop: li === 0 ? 0 : 4 }}>
          <span style={{ color: "#60a5fa", flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{inline}</span>
        </div>
      );
    } else if (content.trim() === "") {
      if (li > 0 && li < lines.length - 1) nodes.push(<div key={li} style={{ height: 6 }} />);
    } else {
      nodes.push(
        <div key={li} style={{ marginTop: li === 0 ? 0 : 4 }}>
          {inline}
        </div>
      );
    }
  });

  return nodes;
}

interface ConvMessage {
  role: string;
  content: string;
  image?: { url: string; title: string };
}

interface ConvSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ConvMessage[];
}

function generateSessionTitle(messages: ConvMessage[]): string {
  const first = messages.find(m => m.role === "user");
  if (!first) return `Voice Session ${new Date().toLocaleDateString()}`;
  const t = first.content.trim().slice(0, 46);
  return t.length < first.content.trim().length ? t + "…" : t;
}

function groupSessionsByDate(sessions: ConvSession[]): { label: string; items: ConvSession[] }[] {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const todayTs = startOfToday.getTime();
  const yesterdayTs = todayTs - 86400000;

  const groups: { label: string; items: ConvSession[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
  ];
  for (const s of sessions) {
    const t = new Date(s.createdAt).getTime();
    if (t >= todayTs) groups[0].items.push(s);
    else if (t >= yesterdayTs) groups[1].items.push(s);
    else groups[2].items.push(s);
  }
  return groups.filter(g => g.items.length > 0);
}

function DreamyStarfield() {
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
        const sx = Math.random() * w * 0.8;
        const sy = Math.random() * h * 0.4;
        const angle = Math.random() * 0.6 + 0.3;
        const speed = Math.random() * 5 + 4;
        shooters.push({
          x: sx, y: sy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: Math.random() * 45 + 25,
          len: Math.random() * 100 + 60,
        });
        nextShoot = 2000 + Math.random() * 5000;
      }

      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life++;
        const progress = sh.life / sh.maxLife;
        const fadeIn = Math.min(progress * 5, 1);
        const fadeOut = progress > 0.5 ? 1 - ((progress - 0.5) / 0.5) : 1;
        const a = fadeIn * fadeOut * 0.85;

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
    <>
      {/* Base space photo — slightly brighter so colors show through */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: "#050c1e",
          backgroundImage: `url(${spaceRealBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          filter: "brightness(0.52) contrast(1.1) saturate(1.3)",
        }}
      />
      {/* Color tint overlay — deep blue/indigo nebula wash */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: "linear-gradient(160deg, rgba(15,25,80,0.45) 0%, rgba(8,18,55,0.55) 40%, rgba(20,10,50,0.4) 70%, rgba(5,15,40,0.5) 100%)",
        }}
      />
      {/* Shooting-star canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />
    </>
  );
}


function ParticleOrb({ size, isActive, isSpeaking }: { size: number; isActive?: boolean; isSpeaking?: boolean }) {
  const getAnimation = () => {
    if (isSpeaking) return "orbSpeaking 3s ease-in-out infinite";
    if (isActive) return "orbListening 4s ease-in-out infinite";
    return "orbFloat 4s ease-in-out infinite";
  };

  return (
    <img
        src={junoOrbImg}
        alt=""
        data-testid="orb-planet"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: "contain",
          pointerEvents: "none",
          filter: isSpeaking
            ? "brightness(1.58) contrast(1.2) saturate(1.3) drop-shadow(0 0 12px rgba(100,180,255,0.7))"
            : isActive
              ? "brightness(1.48) contrast(1.15) saturate(1.25) drop-shadow(0 0 10px rgba(100,180,255,0.5))"
              : "brightness(1.38) contrast(1.15) saturate(1.18) drop-shadow(0 0 8px rgba(100,180,255,0.4))",
          animation: getAnimation(),
          imageRendering: "auto",
          WebkitBackfaceVisibility: "hidden",
          backfaceVisibility: "hidden",
          transition: "filter 0.5s ease, width 0.6s cubic-bezier(0.4,0,0.2,1), height 0.6s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
  );
}

const orbStyles = document.createElement("style");
orbStyles.textContent = `
@keyframes orb3DFloat {
  0%, 100% { transform: perspective(500px) rotateX(0deg) rotateY(0deg) translateY(0px); }
  25%       { transform: perspective(500px) rotateX(6deg) rotateY(10deg) translateY(-5px); }
  50%       { transform: perspective(500px) rotateX(-4deg) rotateY(-7deg) translateY(-7px); }
  75%       { transform: perspective(500px) rotateX(5deg) rotateY(8deg) translateY(-4px); }
}
@keyframes orb3DListening {
  0%, 100% { transform: perspective(500px) rotateX(0deg) rotateY(0deg) scale(1); }
  25%       { transform: perspective(500px) rotateX(10deg) rotateY(14deg) scale(1.04); }
  50%       { transform: perspective(500px) rotateX(-7deg) rotateY(-10deg) scale(0.97); }
  75%       { transform: perspective(500px) rotateX(8deg) rotateY(12deg) scale(1.03); }
}
@keyframes orb3DSpeaking {
  0%   { transform: perspective(500px) rotateX(0deg) rotateY(0deg) scale(1); }
  20%  { transform: perspective(500px) rotateX(12deg) rotateY(18deg) scale(1.08); }
  40%  { transform: perspective(500px) rotateX(-9deg) rotateY(-12deg) scale(0.95); }
  60%  { transform: perspective(500px) rotateX(14deg) rotateY(10deg) scale(1.1); }
  80%  { transform: perspective(500px) rotateX(-7deg) rotateY(14deg) scale(0.97); }
  100% { transform: perspective(500px) rotateX(0deg) rotateY(0deg) scale(1); }
}
@keyframes orbFloat {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-6px); }
}

@keyframes orbListening {
  0%, 100% { transform: scale(1) translateY(0px); }
  25% { transform: scale(1.04) translateY(-3px); }
  50% { transform: scale(0.98) translateY(0px); }
  75% { transform: scale(1.03) translateY(-2px); }
}

@keyframes orbSpeaking {
  0% { transform: scale(1) translateY(0px); }
  8% { transform: scale(1.09) translateY(-3px); }
  16% { transform: scale(0.95) translateY(1px); }
  24% { transform: scale(1.11) translateY(-4px); }
  32% { transform: scale(0.96) translateY(0px); }
  40% { transform: scale(1.08) translateY(-3px); }
  48% { transform: scale(0.97) translateY(1px); }
  56% { transform: scale(1.1) translateY(-3px); }
  64% { transform: scale(0.95) translateY(0px); }
  72% { transform: scale(1.07) translateY(-2px); }
  80% { transform: scale(0.97) translateY(1px); }
  88% { transform: scale(1.06) translateY(-2px); }
  100% { transform: scale(1) translateY(0px); }
}
@keyframes rimRotate {
  0% { filter: hue-rotate(0deg) brightness(1); }
  50% { filter: hue-rotate(15deg) brightness(1.3); }
  100% { filter: hue-rotate(0deg) brightness(1); }
}
@keyframes rimRotateActive {
  0% { filter: hue-rotate(0deg) brightness(1.2); }
  25% { filter: hue-rotate(20deg) brightness(1.6); }
  50% { filter: hue-rotate(-10deg) brightness(1.1); }
  75% { filter: hue-rotate(15deg) brightness(1.5); }
  100% { filter: hue-rotate(0deg) brightness(1.2); }
}
@keyframes particleShimmer {
  0%, 100% { opacity: 0.6; background-position: 0% 0%; }
  25% { opacity: 0.8; background-position: 50% 25%; }
  50% { opacity: 0.5; background-position: 100% 50%; }
  75% { opacity: 0.7; background-position: 25% 75%; }
}
@keyframes orbGlow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes glowBreath {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.35; }
}
@keyframes auroraBreath {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes junoTextIn {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes junoLookAround {
  0%   { transform: translateY(0px) rotate(0deg); }
  15%  { transform: translateY(-7px) rotate(-4deg); }
  30%  { transform: translateY(0px) rotate(0deg); }
  55%  { transform: translateY(6px) rotate(3deg); }
  70%  { transform: translateY(0px) rotate(0deg); }
  85%  { transform: translateY(-4px) rotate(-2deg); }
  100% { transform: translateY(0px) rotate(0deg); }
}
@keyframes junoListen {
  0%, 100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 12px rgba(100,180,255,0.6)); }
  50%       { transform: scale(1.04) rotate(0deg); filter: drop-shadow(0 0 22px rgba(100,180,255,0.9)); }
}
@keyframes junoFloat {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-5px); }
}
@keyframes junoBlink {
  0%, 88%, 100% { transform: scaleY(0); }
  91%           { transform: scaleY(1); }
  94%           { transform: scaleY(0); }
}
`;
if (!document.getElementById("orb-animations")) {
  orbStyles.id = "orb-animations";
  document.head.appendChild(orbStyles);
}

const LANG_FLAGS: Record<string, string> = {
  en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹",
  pt: "🇧🇷", nl: "🇳🇱", pl: "🇵🇱", cs: "🇨🇿", ru: "🇷🇺",
  ja: "🇯🇵", zh: "🇨🇳", ko: "🇰🇷", ar: "🇸🇦", hi: "🇮🇳",
  tr: "🇹🇷", sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", no: "🇳🇴",
  el: "🇬🇷", he: "🇮🇱", th: "🇹🇭", vi: "🇻🇳",
  id: "🇮🇩", ms: "🇲🇾", tl: "🇵🇭", sw: "🇰🇪", bn: "🇧🇩",
  ur: "🇵🇰", ro: "🇷🇴", hu: "🇭🇺", uk: "🇺🇦", fa: "🇮🇷",
};

const SPEECH_LANG_MAP: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
  pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", cs: "cs-CZ", ru: "ru-RU",
  ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", ar: "ar-SA", hi: "hi-IN",
  tr: "tr-TR", sv: "sv-SE", da: "da-DK", fi: "fi-FI", no: "nb-NO",
  el: "el-GR", he: "he-IL", th: "th-TH", vi: "vi-VN",
  id: "id-ID", ms: "ms-MY", tl: "fil-PH", sw: "sw-KE", bn: "bn-BD",
  ur: "ur-PK", ro: "ro-RO", hu: "hu-HU", uk: "uk-UA", fa: "fa-IR",
};


interface VoiceOption {
  id: string;
  name: string;
  provider: "polly" | "openai";
  accent?: string;
}

const VOICE_OPTIONS: VoiceOption[] = [
  { id: "nova", name: "Nova", provider: "openai", accent: "Warm Female" },
  { id: "alloy", name: "Alloy", provider: "openai", accent: "Neutral" },
  { id: "echo", name: "Echo", provider: "openai", accent: "Male" },
  { id: "fable", name: "Fable", provider: "openai", accent: "Expressive" },
  { id: "onyx", name: "Onyx", provider: "openai", accent: "Deep Male" },
  { id: "shimmer", name: "Shimmer", provider: "openai", accent: "Soft Female" },
];

const POLLY_LANG_MAP: Record<string, string> = {
  en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
  pt: "pt-BR", nl: "nl-NL", ja: "ja-JP", zh: "cmn-CN", ko: "ko-KR",
  ru: "ru-RU", pl: "pl-PL", cs: "cs-CZ", ar: "arb", hi: "hi-IN",
  tr: "tr-TR", sv: "sv-SE", da: "da-DK", fi: "fi-FI", no: "nb-NO",
  el: "el-GR", he: "he-IL", th: "th-TH", vi: "vi-VN",
  id: "id-ID", ro: "ro-RO", uk: "uk-UA",
};

class JunoPageBoundary extends React.Component<{ children: React.ReactNode }, { hasCrashed: boolean }> {
  state = { hasCrashed: false };
  static getDerivedStateFromError() { return { hasCrashed: true }; }
  componentDidCatch(err: Error) {
    try {
      fetch("/api/v1/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: err.message, stack: err.stack?.slice(0, 2000), url: window.location.href, userAgent: navigator.userAgent }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.hasCrashed) {
      return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e27 0%, #0c1445 40%, #0a0e27 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "-0.25rem" }}>
            <img src={junoOrbImg} alt="Juno" style={{ width: 220, height: 220, objectFit: "contain" }} />
          </div>
          <h2 style={{ color: "white", fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>Something went wrong</h2>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.875rem", maxWidth: 320, lineHeight: 1.6 }}>
            Juno ran into an unexpected issue. Please try reloading. This usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: "1.5rem", padding: "0.625rem 1.5rem", borderRadius: "0.75rem", background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.3)", color: "rgb(147,197,253)", fontSize: "0.875rem", cursor: "pointer" }}
            data-testid="button-juno-retry"
          >
            Reload Page
          </button>
          <a href="/" style={{ marginTop: "1rem", color: "rgba(255,255,255,0.3)", fontSize: "0.75rem", textDecoration: "none" }} data-testid="link-juno-back-home">← Back to Home</a>
        </div>
      );
    }
    return this.props.children;
  }
}

const JUNO_PROMPTS = [
  "Where are you headed next?",
  "Ask me anything: travel tips, local culture, what to pack.",
  "Planning a trip? I can help with flights, hotels, and more.",
  "What's on your mind? I'm here for anything.",
  "Need travel advice or just want to chat?",
  "Ask about destinations, visa requirements, or local customs.",
  "I can help you plan, explore, or just answer your questions.",
  "Curious about a place? Ask me anything about it.",
];

function getJunoSubtitle(): string {
  try {
    const last = localStorage.getItem("juno_last_prompt");
    const available = last ? JUNO_PROMPTS.filter(p => p !== last) : JUNO_PROMPTS;
    const selected = available[Math.floor(Math.random() * available.length)];
    localStorage.setItem("juno_last_prompt", selected);
    return selected;
  } catch {
    return JUNO_PROMPTS[0];
  }
}

// ── Image Gallery (localStorage — no API calls) ───────────────────────────────
const IMAGE_GALLERY_KEY = "juno:image_gallery";
const IMAGE_GALLERY_MAX = 50;

interface GalleryImage {
  id: string;
  prompt: string;
  imageUrl: string;
  createdAt: number;
}

function loadGallery(): GalleryImage[] {
  try {
    const raw = localStorage.getItem(IMAGE_GALLERY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToGallery(prompt: string, imageUrl: string) {
  try {
    const existing = loadGallery();
    const entry: GalleryImage = {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      prompt,
      imageUrl,
      createdAt: Date.now(),
    };
    const updated = [entry, ...existing].slice(0, IMAGE_GALLERY_MAX);
    localStorage.setItem(IMAGE_GALLERY_KEY, JSON.stringify(updated));
    return updated;
  } catch { return []; }
}

function deleteFromGallery(id: string) {
  try {
    const updated = loadGallery().filter(img => img.id !== id);
    localStorage.setItem(IMAGE_GALLERY_KEY, JSON.stringify(updated));
    return updated;
  } catch { return []; }
}
// ─────────────────────────────────────────────────────────────────────────────

function VoiceTranslateInner() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [sessionActive, setSessionActive] = useState(false);
  const [junoSubtitle, setJunoSubtitle] = useState(() => getJunoSubtitle());
  useWakeLock(sessionActive);
  const [fromLang, setFromLang] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.translateFromLang) || "en"; } catch { return "en"; }
  });
  const [toLang, setToLang] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.translateToLang) || "es"; } catch { return "es"; }
  });
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"chat" | "translate">("chat");
  const [chatMessages, setChatMessages] = useState<{ id: number; type: "user" | "translation" | "ai_image"; text: string; prompt?: string; imageUrl?: string; imageUrls?: { url: string; label: string; model: string }[]; image?: { url: string; title: string; attribution: string; pageUrl: string } }[]>([]);
  const [imageSession, setImageSession] = useState<{ imageUrls: { url: string; label: string; model: string }[]; prompt: string } | null>(null);
  const [voiceLimitPopup, setVoiceLimitPopup] = useState<{ show: boolean; limit: number } | null>(null);
  const voiceLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatIdRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [offlineRemainingMs, setOfflineRemainingMs] = useState<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [manualInput, setManualInput] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<"main" | "languages" | "voice" | "voice-clone" | "history" | "history-detail" | "appearance" | "help">("main");

  // Lux Voice Clone — persistent voice preference
  type VoiceProfileData = { enabled: boolean; voice: string; sample: { status: string; hasSample: boolean } | null };
  const { data: luxVoiceProfile } = useQuery<VoiceProfileData>({
    queryKey: ["/api/v1/voice-profile"],
    enabled: !!user,
  });
  const luxVoiceMutation = useMutation({
    mutationFn: async (voice: string) =>
      apiRequest("PATCH", "/api/v1/voice-profile", { enabled: true, voice }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/v1/voice-profile"] }),
  });
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.voice) || "nova"; } catch { return "nova"; }
  });
  const [autoPlayVoice, setAutoPlayVoice] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.autoplay) !== "false"; } catch { return true; }
  });
  const [textSize, setTextSize] = useState<"small" | "medium" | "large">(() => {
    try { return (localStorage.getItem(STORAGE_KEYS.textSize) as any) || "medium"; } catch { return "medium"; }
  });
  const [historyKey, setHistoryKey] = useState(0);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>(() => loadGallery());
  const [sessions, setSessions] = useState<ConvSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showInlineInput, setShowInlineInput] = useState(false);
  const [inlineDraft, setInlineDraft] = useState("");
  const [savedSessionTitle, setSavedSessionTitle] = useState<string | null>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const pendingSessionTitleRef = useRef<string | null>(null);
  const [speechSpeed, setSpeechSpeed] = useState<number>(() => {
    try { const v = localStorage.getItem(STORAGE_KEYS.speed); return v ? parseFloat(v) : 1.0; } catch { return 1.0; }
  });
  const [supportMessages, setSupportMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [supportInput, setSupportInput] = useState("");
  const [supportLoading, setSupportLoading] = useState(false);
  const supportEndRef = useRef<HTMLDivElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState("");
  const [showVision, setShowVision] = useState(false);
  const [visionHintVisible, setVisionHintVisible] = useState(false);
  const [showJunoWelcome, setShowJunoWelcome] = useState(true);
  const [junoFading, setJunoFading] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.wakeWord) === "true"; } catch { return false; }
  });
  const [wakeWordListening, setWakeWordListening] = useState(false);
  const [dashboardTheme, setDashboardTheme] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.dashboardTheme) || "liquid-blue"; } catch { return "liquid-blue"; }
  });
  const wakeRecognitionRef = useRef<any>(null);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});
  const startWakeWordListenerRef = useRef<() => void>(() => {});
  const conversationHistoryRef = useRef<{ role: string; content: string }[]>(
    (() => {
      try {
        // Only restore crash-recovery buffer when not resuming an explicit session
        const resumeId = new URLSearchParams(window.location.search).get("resume");
        if (resumeId) return [];
        const saved = localStorage.getItem("juno_conv_history");
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    })()
  );
  const activeSessionIdRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Refs kept for the voice-preview panel only (not used for live sessions) ──
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Stable refs to the latest callbacks — used by the session via optsRef
  const translateTextRef = useRef<(text: string, voiceMode?: boolean) => void>(() => {});
  const chatWithJunoRef = useRef<(text: string) => void>(() => {});
  // Legacy compat refs kept for the wake-word listener; will delegate to session
  const activeSessionRef = useRef(false);
  const cachedVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      const loadVoices = () => {
        cachedVoicesRef.current = window.speechSynthesis.getVoices();
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Resume a previous session — load its messages into conversation history
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resumeId = params.get("resume");
    if (!resumeId) return;
    fetch(`/api/v1/juno/conversations/${resumeId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((conv) => {
        if (!conv?.messages?.length) return;
        const caption = {
          role: "system",
          content: `You are resuming a previous conversation titled "${conv.title || "Previous conversation"}". Use the full conversation history below as your memory — continue naturally as if no time has passed.`,
        };
        const msgs = conv.messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        }));
        conversationHistoryRef.current = [caption, ...msgs].slice(-20);
        try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}
      })
      .catch(() => {});
  }, []);

  // Track keyboard height so the input bar hugs the keyboard on mobile
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kbH = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop ?? 0));
      setKeyboardHeight(kbH);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const dismissJuno = useCallback(() => {
    if (!showJunoWelcome || junoFading) return;
    setJunoFading(true);
    setTimeout(() => {
      setShowJunoWelcome(false);
      setJunoFading(false);
    }, 1400);
  }, [showJunoWelcome, junoFading]);

  useEffect(() => {
    if (sessionActive || isListening) return;

    const cycle = () => {
      setJunoSubtitle(getJunoSubtitle());
      setShowJunoWelcome(true);
      setJunoFading(false);
    };

    if (showJunoWelcome) {
      const hideTimer = setTimeout(() => {
        dismissJuno();
      }, 4000);
      return () => clearTimeout(hideTimer);
    } else {
      const showTimer = setTimeout(cycle, 3000);
      return () => clearTimeout(showTimer);
    }
  }, [showJunoWelcome, dismissJuno, sessionActive, isListening]);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
    try { localStorage.setItem(STORAGE_KEYS.wakeWord, wakeWordEnabled ? "true" : "false"); } catch {}
  }, [wakeWordEnabled]);

  useEffect(() => {
    fetch("/api/v1/preferences", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(prefs => {
        if (!prefs) return;
        if (typeof prefs.wakeWordEnabled === "boolean") setWakeWordEnabled(prefs.wakeWordEnabled);

        // Apply profile language pair as the default — unless the user has already
        // manually chosen languages on this device (tracked by the manual flag).
        const hasManual = localStorage.getItem("juno_translate_lang_manual") === "true";
        if (!hasManual && prefs.spokenLanguage && prefs.spokenLanguage !== "auto") {
          const from = prefs.spokenLanguage;
          // Use subtitleLanguage as target if it's different from spoken, otherwise
          // pick a smart opposite so both sides are never the same language.
          const to = (prefs.subtitleLanguage && prefs.subtitleLanguage !== from)
            ? prefs.subtitleLanguage
            : (from === "es" ? "en" : "es");
          setFromLang(from);
          setToLang(to);
          try {
            localStorage.setItem(STORAGE_KEYS.translateFromLang, from);
            localStorage.setItem(STORAGE_KEYS.translateToLang, to);
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const clearWakeRestartTimer = useCallback(() => {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }, []);

  // ── VoiceSession callbacks (defined at top level — hooks rules) ─────────────
  const vsOnFinalTranscript = useCallback((text: string) => {
    setTranscript(text);
    chatWithJunoRef.current(text);
  }, []);

  const vsOnInterimTranscript = useCallback((text: string) => setTranscript(text), []);

  const vsOnPhaseChange = useCallback((phase: import("@/hooks/useVoiceSession").VoicePhase) => {
    const listening = phase === 'listening';
    const speaking  = phase === 'speaking';
    const active    = phase !== 'idle';
    setIsListening(listening);
    setIsSpeaking(speaking);
    setSessionActive(active);
    activeSessionRef.current = active;
  }, []);

  const vsOnError = useCallback((msg: string) => setError(msg), []);

  const vsFetchAudio = useCallback(async (text: string, lang: string, voiceId: string, speed: number) => {
    const VALID_VOICES = new Set(['alloy','echo','fable','onyx','nova','shimmer']);
    const voice = VALID_VOICES.has(voiceId) ? voiceId : 'nova';
    const res = await fetch('/api/v1/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, voice, lang, speed }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return res.arrayBuffer();
  }, []);

  // ── VoiceSession — owns the entire mic → Juno reasoning → TTS pipeline ─────
  const voiceSession = useVoiceSession({
    lang: fromLang,
    speechSpeed,
    voiceId: selectedVoice,
    onFinalTranscript: vsOnFinalTranscript,
    onInterimTranscript: vsOnInterimTranscript,
    onError: vsOnError,
    fetchAudio: vsFetchAudio,
  });

  // Phase changes come from voiceSession.phase (reactive state exposed by the hook)
  useEffect(() => { vsOnPhaseChange(voiceSession.phase); }, [voiceSession.phase]);

  // Keep legacy compat refs in sync with the session
  useEffect(() => {
    startListeningRef.current = voiceSession.start;
    stopListeningRef.current  = voiceSession.stop;
  }, [voiceSession.start, voiceSession.stop]);

  const unlockAudio = useCallback(() => {
    voiceSession.unlock();
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    } catch {}

    if (audioUnlockedRef.current) return;
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
    }
    const a = audioElementRef.current;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    a.volume = 0;
    a.play().then(() => {
      a.pause();
      a.volume = 1;
      audioUnlockedRef.current = true;
    }).catch(() => {});
  }, []);

  const startWakeWordListener = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    clearWakeRestartTimer();

    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort(); } catch {}
      wakeRecognitionRef.current = null;
    }

    const wake = new SpeechRecognition();
    wake.lang = "en-US";
    wake.interimResults = true;
    wake.continuous = true;
    wake.maxAlternatives = 3;

    wake.onstart = () => setWakeWordListening(true);

    wake.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        for (let alt = 0; alt < event.results[i].length; alt++) {
          const text = (event.results[i][alt].transcript || "").toLowerCase().trim();
          if (text.includes("hey juno") || text.includes("hey june") || text.includes("hei juno") || text.includes("a juno") || text.includes("hey junior")) {
            try { wake.abort(); } catch {}
            wakeRecognitionRef.current = null;
            setWakeWordListening(false);
            if (!activeSessionRef.current) {
              unlockAudio();
              startListeningRef.current(); // session sets activeSessionRef via onPhaseChange
            }
            return;
          }
        }
      }
    };

    wake.onend = () => {
      setWakeWordListening(false);
      if (wakeWordEnabledRef.current && !activeSessionRef.current) {
        wakeRestartTimerRef.current = setTimeout(() => {
          if (wakeWordEnabledRef.current && !activeSessionRef.current) {
            startWakeWordListenerRef.current();
          }
        }, 300);
      }
    };

    wake.onerror = (event: any) => {
      setWakeWordListening(false);
      if (event.error === "no-speech" || event.error === "aborted") {
        if (wakeWordEnabledRef.current && !activeSessionRef.current) {
          wakeRestartTimerRef.current = setTimeout(() => startWakeWordListenerRef.current(), 500);
        }
      }
    };

    wakeRecognitionRef.current = wake;
    wake.start();
  }, [unlockAudio, clearWakeRestartTimer]);

  const stopWakeWordListener = useCallback(() => {
    clearWakeRestartTimer();
    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort(); } catch {}
      wakeRecognitionRef.current = null;
    }
    setWakeWordListening(false);
  }, [clearWakeRestartTimer]);

  useEffect(() => {
    startWakeWordListenerRef.current = startWakeWordListener;
  }, [startWakeWordListener]);

  useEffect(() => {
    if (showVision) {
      stopWakeWordListener();
      return;
    }
    if (wakeWordEnabled && !activeSessionRef.current) {
      startWakeWordListener();
    } else if (!wakeWordEnabled) {
      stopWakeWordListener();
    }
    return () => {
      stopWakeWordListener();
    };
  }, [wakeWordEnabled, startWakeWordListener, stopWakeWordListener, showVision]);

  useEffect(() => {
    return () => {
      if (offlineTimerRef.current) clearInterval(offlineTimerRef.current);
    };
  }, []);

  useSEO(SEO_CONFIGS.voiceTranslate);

  useEffect(() => {
    return () => {
      voiceSession.stop();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (audioElementRef.current) {
        try { audioElementRef.current.pause(); } catch {}
        audioElementRef.current = null;
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    };
  }, []);

  const stopCurrentAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch {}
      audioSourceRef.current = null;
    }
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      } catch {}
    }
  }, []);

  const playTTSAudio = useCallback(async (text: string, voice: string, lang?: string, speed?: number): Promise<void> => {
    stopCurrentAudio();

    const res = await fetch("/api/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text, voice, lang, speed: speed ?? speechSpeed }),
    });
    if (!res.ok) throw new Error("TTS request failed");
    const arrayBuffer = await res.arrayBuffer();

    const actx = audioContextRef.current;
    // Always try to resume before checking — iOS suspends it when mic is active
    if (actx && actx.state !== "running") {
      await actx.resume().catch(() => {});
    }
    if (actx && actx.state === "running") {
      return new Promise<void>((resolve, reject) => {
        actx.decodeAudioData(
          arrayBuffer.slice(0),
          (buffer) => {
            stopCurrentAudio();
            const source = actx.createBufferSource();
            source.buffer = buffer;
            source.connect(actx.destination);
            audioSourceRef.current = source;
            source.onended = () => {
              if (audioSourceRef.current === source) audioSourceRef.current = null;
              resolve();
            };
            source.start(0);
          },
          () => reject(new Error("AudioContext decode failed"))
        );
      });
    }

    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    return new Promise<void>((resolve, reject) => {
      const audio = audioElementRef.current || new Audio();
      audioElementRef.current = audio;
      if (audio.src && audio.src.startsWith("blob:")) {
        try { URL.revokeObjectURL(audio.src); } catch {}
      }
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Audio playback failed")); };
      audio.src = url;
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      });
    });
  }, [speechSpeed, stopCurrentAudio]);

  /**
   * puterSpeak — now delegates entirely to VoiceSession.
   * The session handles mic suspension, AudioContext resume, TTS fetch,
   * SpeechSynthesis fallback, and mic restart after playback.
   * Kept as a named function so existing JSX replay buttons can still call it.
   */
  const puterSpeak = useCallback(async (text: string, _lang?: string, _voiceId?: string) => {
    return voiceSession.speak(text);
  }, [voiceSession.speak]);

  const previewVoice = useCallback(async (voiceId: string) => {
    if (previewPlaying) return;
    setPreviewPlaying(voiceId);
    const sampleText = "Hello, I'm your voice assistant. How can I help you today?";
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(sampleText);
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        await new Promise<void>((resolve) => {
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          setTimeout(() => resolve(), 8000);
          window.speechSynthesis.speak(utterance);
        });
      }
    } catch {
      try {
        const voice = VOICE_OPTIONS.find(v => v.id === voiceId) || VOICE_OPTIONS[0];
        const openaiVoice = voice.provider === "openai" ? voice.id : "nova";
        await playTTSAudio(sampleText, openaiVoice);
      } catch {}
    }
    setPreviewPlaying(null);
  }, [previewPlaying, playTTSAudio]);

  const sendSupportMessage = useCallback(async () => {
    const msg = supportInput.trim();
    if (!msg || supportLoading) return;
    setSupportInput("");
    setSupportMessages(prev => [...prev, { role: "user", text: msg }]);
    setSupportLoading(true);
    try {
      const res = await fetch("/api/v1/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error("Support request failed");
      const data = await res.json();
      setSupportMessages(prev => [...prev, { role: "ai", text: data.reply || "Sorry, I couldn't process that. Please try again." }]);
    } catch {
      setSupportMessages(prev => [...prev, { role: "ai", text: "Something went wrong. Please check your connection and try again." }]);
    }
    setSupportLoading(false);
  }, [supportInput, supportLoading]);

  useEffect(() => {
    if (supportEndRef.current) {
      supportEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [supportMessages]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const startOfflineCountdown = useCallback((remainingMs: number) => {
    if (offlineTimerRef.current) clearInterval(offlineTimerRef.current);
    setOfflineRemainingMs(remainingMs);
    offlineTimerRef.current = setInterval(() => {
      setOfflineRemainingMs(prev => {
        if (prev === null || prev <= 1000) {
          if (offlineTimerRef.current) clearInterval(offlineTimerRef.current);
          offlineTimerRef.current = null;
          return null;
        }
        return prev - 1000;
      });
    }, 1000);
  }, []);

  const clearOfflineMode = useCallback(() => {
    if (offlineTimerRef.current) clearInterval(offlineTimerRef.current);
    offlineTimerRef.current = null;
    setOfflineRemainingMs(null);
  }, []);

  // ── Dedicated chat function — calls /api/v1/chat directly, no fallback chain ──
  const chatWithJuno = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setLoadingMode("chat");
    setIsTranslating(true);
    setError("");
    setAiResponse("");

    const userMsgId = ++chatIdRef.current;
    setChatMessages(prev => [...prev, { id: userMsgId, type: "user", text: text.trim() }]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50000);
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: text.trim(),
          lang: fromLang,
          conversationHistory: conversationHistoryRef.current,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Juno could not respond right now.");
      }

      const data = await res.json();

      // ── Image response (isolated branch) ──────────────────────────────────
      if (data.mode === "image" && (data.imageUrl || data.imageUrls?.length)) {
        const imgMsgId = ++chatIdRef.current;
        const caption  = data.text || "Here are your images, each from a different open-source model:";
        const imageUrls: { url: string; label: string; model: string }[] = data.imageUrls || (data.imageUrl ? [{ url: data.imageUrl, label: "Flux", model: "flux" }] : []);
        const imgPrompt = text.trim();
        setChatMessages(prev => [...prev, { id: imgMsgId, type: "ai_image", text: caption, prompt: imgPrompt, imageUrl: imageUrls[0]?.url, imageUrls }]);
        // Save all to localStorage gallery (no API call)
        const prompt = text.trim();
        const updated = imageUrls.reduce((acc: GalleryImage[], img) => saveToGallery(`${prompt} [${img.label}]`, img.url), []);
        if (updated.length) setGalleryImages(loadGallery());
        conversationHistoryRef.current.push(
          { role: "user",      content: text.trim() },
          { role: "assistant", content: caption }
        );
        if (conversationHistoryRef.current.length > 20) {
          conversationHistoryRef.current = conversationHistoryRef.current.slice(-20);
        }
        try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}
        return;
      }
      // ── End image branch ──────────────────────────────────────────────────

      const result = data.text;
      if (!result) throw new Error("No response from Juno.");

      setTranslatedText(result);
      setAiResponse(result);
      const transMsgId = ++chatIdRef.current;
      setChatMessages(prev => [...prev, { id: transMsgId, type: "translation", text: result }]);

      conversationHistoryRef.current.push(
        { role: "user", content: text.trim() },
        { role: "assistant", content: result }
      );
      if (conversationHistoryRef.current.length > 20) {
        conversationHistoryRef.current = conversationHistoryRef.current.slice(-20);
      }
      try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}

      // Speak Juno's response out loud when voice auto-play is on
      if (autoPlayVoice) puterSpeak(result, fromLang);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Juno timed out. Please try again.");
      } else {
        setError(err.message || "Chat failed.");
      }
    } finally {
      setIsTranslating(false);
    }
  }, [fromLang, conversationHistoryRef, autoPlayVoice, puterSpeak]);

  // ── Translation function — voice/mic only, calls /api/v1/ai-translate ──
  const translateText = useCallback(async (text: string, voiceMode = false) => {
    if (!text.trim()) return;

    // Mode is driven by the call site — no inference from language settings
    const mode: "translate" | "voice" = voiceMode ? "voice" : "translate";

    setLoadingMode("translate");
    setIsTranslating(true);
    setError("");
    setAiResponse("");

    const userMsgId = ++chatIdRef.current;
    setChatMessages(prev => [...prev, { id: userMsgId, type: "user", text: text.trim() }]);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch("/api/v1/ai-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: text.trim(),
          sourceLang: fromLang,
          targetLang: toLang,
          voiceMode: mode === "voice",
          // Voice is conversational — pass history so Juno remembers the exchange.
          // Translation is stateless — history omitted.
          ...(mode === "voice" ? { conversationHistory: conversationHistoryRef.current } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === "offline_limit_exceeded") {
          clearOfflineMode();
          throw new Error("Offline limit reached (3 min). Reconnect to keep translating.");
        }
        if (errData.code === "voice_limit_exceeded") {
          if (voiceLimitTimerRef.current) clearTimeout(voiceLimitTimerRef.current);
          setVoiceLimitPopup({ show: true, limit: errData.limit ?? 20 });
          voiceLimitTimerRef.current = setTimeout(() => setVoiceLimitPopup(null), 6000);
          setIsTranslating(false);
          return;
        }
        const fallbackRes = await fetch("/api/v1/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: text.trim(),
            sourceLang: fromLang,
            targetLang: toLang,
          }),
        });
        if (!fallbackRes.ok) {
          const data = await fallbackRes.json().catch(() => ({}));
          if (data.code === "offline_limit_exceeded") {
            clearOfflineMode();
            throw new Error("Offline limit reached (3 min). Reconnect to keep translating.");
          }
          throw new Error(data.message || "Translation failed");
        }
        const fallbackData = await fallbackRes.json();
        const result = fallbackData.translatedText || text;
        if (fallbackData.mode === "offline_cache" && fallbackData.offlineRemainingMs != null) {
          startOfflineCountdown(fallbackData.offlineRemainingMs);
        }
        setTranslatedText(result);
        const transMsgId = ++chatIdRef.current;
        setChatMessages(prev => [...prev, { id: transMsgId, type: "translation", text: result }]);
        if (mode === "voice") puterSpeak(result, toLang);
        return;
      }

      const data = await res.json();
      const result = data.translatedText || text;

      if (data.mode === "offline_cache" && data.offlineRemainingMs != null) {
        startOfflineCountdown(data.offlineRemainingMs);
      } else if (data.mode === "ai" || data.mode === "voice_ai") {
        clearOfflineMode();
      }

      setTranslatedText(result);
      setAiResponse(result);
      const transMsgId = ++chatIdRef.current;
      setChatMessages(prev => [...prev, { id: transMsgId, type: "translation", text: result }]);

      // Voice responses are conversational — write to history so the next voice turn has context.
      // Stateless translation (mode "ai") does not touch history.
      if (data.mode === "voice_ai") {
        conversationHistoryRef.current.push(
          { role: "user", content: text.trim() },
          { role: "assistant", content: result }
        );
        if (conversationHistoryRef.current.length > 20) {
          conversationHistoryRef.current = conversationHistoryRef.current.slice(-20);
        }
        try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}
      }

      // Voice logging (separate from conversation history).
      fetch("/api/v1/voice-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          role: "user",
          originalText: text.trim(),
          translatedText: result,
          sourceLang: fromLang,
          targetLang: toLang,
        }),
      }).catch(() => {});

      // TTS only fires in voice mode — text input and chat mode are text-only
      if (mode === "voice") puterSpeak(result, toLang);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Translation timed out. Please try again.");
      } else {
        setError(err.message || "Translation failed");
      }
    } finally {
      setIsTranslating(false);
    }
  }, [fromLang, toLang, puterSpeak, autoPlayVoice, startOfflineCountdown, clearOfflineMode]);

  // Keep refs pointing at the latest closures so stable callbacks always use the newest version.
  useEffect(() => {
    translateTextRef.current = translateText;
  }, [translateText]);
  useEffect(() => {
    chatWithJunoRef.current = chatWithJuno;
  }, [chatWithJuno]);

  useEffect(() => {
    try {
      const pending = localStorage.getItem("juno_pending_msg");
      if (!pending) return;
      localStorage.removeItem("juno_pending_msg");
      const t = setTimeout(() => chatWithJunoRef.current(pending), 500);
      return () => clearTimeout(t);
    } catch {}
  }, []);

  // startListening / stopListening now delegate to VoiceSession.
  // These stubs exist so wake-word code can still call startListeningRef.current().
  const startListening = useCallback(() => {
    setError("");
    voiceSession.start();
  }, [voiceSession.start]);

  const stopListening = useCallback(() => {
    voiceSession.stop();
    setIsTranslating(false);
    // Restart wake-word listener after the session ends
    if (wakeWordEnabledRef.current) {
      wakeRestartTimerRef.current = setTimeout(() => {
        if (wakeWordEnabledRef.current && !activeSessionRef.current) {
          startWakeWordListenerRef.current();
        }
      }, 1500);
    }
  }, [voiceSession.stop]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = (delay: number) => {
      timers.push(setTimeout(() => setVisionHintVisible(true), delay));
      timers.push(setTimeout(() => setVisionHintVisible(false), delay + 3000));
    };
    show(800);
    show(4200);
    show(7600);
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const hiddenAt = { ts: 0 };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.ts = Date.now();
        return;
      }
      const awayMs = hiddenAt.ts > 0 ? Date.now() - hiddenAt.ts : 0;
      // App was hidden for > 30s — session stops automatically inside VoiceSession's
      // visibility/audio-session handling; just sync our local state
      if (awayMs > 30000) {
        voiceSession.stop();
        return;
      }
      // Short hide (e.g. notification banner) — session is still active; no action needed
      // VoiceSession handles its own no-speech restarts internally
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [voiceSession.stop]);

  const toggleListening = useCallback(() => {
    unlockAudio();
    if (isListening || activeSessionRef.current) {
      stopListening();
    } else {
      stopWakeWordListener();
      startListening();
    }
  }, [isListening, startListening, stopListening, stopWakeWordListener, unlockAudio]);

  // Shared helper — upserts the current chatMessages into local sessions state
  // AND fires a CDN write. Safe to call any time.
  const saveNow = useCallback((msgs: typeof chatMessages) => {
    // At minimum: 1 complete exchange (user message + Juno reply)
    if (msgs.length < 2) return;
    // User must have said at least a proper sentence — filters out single words / taps
    const userWords = msgs
      .filter(m => m.type === "user")
      .reduce((n, m) => n + m.text.trim().split(/\s+/).filter(Boolean).length, 0);
    if (userWords < 6) return;
    // Total conversation must have real substance
    const totalWords = msgs.reduce((n, m) => n + m.text.trim().split(/\s+/).filter(Boolean).length, 0);
    if (totalWords < 20) return;
    if (!activeSessionIdRef.current) {
      activeSessionIdRef.current = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    const sessionId = activeSessionIdRef.current;
    const convMsgs: ConvMessage[] = msgs.map(m => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.text,
      ...(m.image ? { image: { url: m.image.url, title: m.image.title } } : {}),
    }));
    const pendingTitle = pendingSessionTitleRef.current;
    if (pendingTitle) pendingSessionTitleRef.current = null;
    const session: ConvSession = {
      id: sessionId,
      title: pendingTitle || generateSessionTitle(convMsgs),
      createdAt: new Date().toISOString(),
      messages: convMsgs,
    };
    setSessions(prev => {
      const updated = [session, ...prev.filter(s => s.id !== sessionId)].slice(0, 10);
      fetch("/api/conv-sessions", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: updated }),
      }).catch(() => {});
      return updated;
    });
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/conv-sessions", { credentials: "include" });
      const data = await res.json();
      if (Array.isArray(data?.sessions)) {
        // Merge: keep any locally-saved sessions that CDN hasn't confirmed yet
        setSessions(prev => {
          const cdnIds = new Set(data.sessions.map((s: ConvSession) => s.id));
          const localOnly = prev.filter(s => !cdnIds.has(s.id));
          return [...localOnly, ...data.sessions].slice(0, 10);
        });
      }
    } catch {}
    setSessionsLoading(false);
  }, []);

  const handleNewChat = useCallback(() => {
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    activeSessionIdRef.current = null;
    setChatMessages([]);
    setTranscript("");
    setManualInput("");
    conversationHistoryRef.current = [];
    setShowHistoryPanel(false);
    setTimeout(() => { manualInputRef.current?.focus(); }, 100);
  }, []);

  const handleOpenHistory = useCallback(async () => {
    // Cancel pending debounce
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    // Flush current conversation to local state immediately (don't wait for CDN)
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (chatMessages.length >= 2 && lastMsg?.type === "translation") {
      saveNow(chatMessages);
    }
    setSelectedSessionId(null);
    setHistoryKey(k => k + 1);
    setShowHistoryPanel(true);
    loadSessions();
  }, [loadSessions, saveNow, chatMessages]);

  // ── Auto-save conversation to CDN — 2 s after last AI response ──
  useEffect(() => {
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (chatMessages.length < 2 || lastMsg?.type !== "translation") return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveNow(chatMessages);
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [chatMessages, saveNow]);
  // ─────────────────────────────────────────────────────────────────────────────

  const swapLanguages = useCallback(() => {
    setFromLang(toLang);
    setToLang(fromLang);
    try {
      localStorage.setItem(STORAGE_KEYS.translateFromLang, toLang);
      localStorage.setItem(STORAGE_KEYS.translateToLang, fromLang);
      localStorage.setItem("juno_translate_lang_manual", "true");
    } catch {}
    conversationHistoryRef.current = [];
  }, [fromLang, toLang]);

  const fromLangObj = LANGUAGES.find(l => l.code === fromLang);
  const toLangObj = LANGUAGES.find(l => l.code === toLang);

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-row" style={{ background: "transparent" }}>
      {/* Main chat/conversation panel — shrinks when image session is open */}
      <div className={`relative flex flex-col overflow-hidden ${imageSession ? "w-[43%]" : "w-full"}`} style={{ transition: "width 0.28s cubic-bezier(0.4,0,0.2,1)" }}>
      <DreamyStarfield />

      <div className="relative z-30 flex flex-col">
        <div className="relative flex items-center justify-between px-3 py-3">
          {/* Top-left: back button */}
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-juno" label="Juno" />

          {/* Top-center: language pickers */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <button
              onClick={() => setShowFromPicker(!showFromPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/5"
              data-testid="button-from-lang"
            >
              <span className="text-sm">{LANG_FLAGS[fromLang] || "🌐"}</span>
              <span className="text-xs text-white font-medium">{fromLangObj?.name || fromLang}</span>
            </button>

            <button
              onClick={swapLanguages}
              className="w-6 h-6 rounded-full border border-blue-500/20 bg-blue-500/10 flex items-center justify-center"
              data-testid="button-swap-langs"
            >
              <ArrowLeftRight className="w-3 h-3 text-blue-400" />
            </button>

            <button
              onClick={() => setShowToPicker(!showToPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/5"
              data-testid="button-to-lang"
            >
              <span className="text-sm">{LANG_FLAGS[toLang] || "🌐"}</span>
              <span className="text-xs text-white font-medium">{toLangObj?.name || toLang}</span>
            </button>
          </div>

          {/* Top-right: Status dot + Menu */}
          <div className="flex items-center gap-1">
            <div className="relative flex items-center justify-center w-9 h-9">
              {/* Green status dot — simple, no glow or animation */}
              <span className="inline-flex w-1.5 h-1.5 rounded-full bg-green-400" />
            </div>
            <div className="relative flex flex-col items-center">
              <Button variant="ghost" size="icon" className="w-9 h-9" onClick={() => { setSettingsView("main"); setShowVoiceSettings(true); }} data-testid="button-voice-settings">
                <AlignJustify style={{ width: "20px", height: "20px", color: "rgba(148,163,184,0.7)" }} />
              </Button>
            </div>
          </div>
        </div>

        {showFromPicker && (
          <SectionBoundary label="Language Picker">
          <div className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-1.5 p-3 rounded-xl border border-white/10" style={{ background: "rgba(8, 12, 35, 0.95)", backdropFilter: "blur(12px)" }} data-testid="picker-from-lang">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => { setFromLang(lang.code); setShowFromPicker(false); conversationHistoryRef.current = []; try { localStorage.setItem(STORAGE_KEYS.translateFromLang, lang.code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {} }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${fromLang === lang.code ? "bg-blue-500/20 text-blue-300" : "hover:bg-blue-500/10 text-muted-foreground"}`}
                  data-testid={`from-lang-${lang.code}`}
                >
                  <span>{LANG_FLAGS[lang.code] || "🌐"}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
          </SectionBoundary>
        )}

        {showToPicker && (
          <SectionBoundary label="Language Picker">
          <div className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-1.5 p-3 rounded-xl border border-white/10" style={{ background: "rgba(8, 12, 35, 0.95)", backdropFilter: "blur(12px)" }} data-testid="picker-to-lang">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => { setToLang(lang.code); setShowToPicker(false); conversationHistoryRef.current = []; try { localStorage.setItem(STORAGE_KEYS.translateToLang, lang.code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {} }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${toLang === lang.code ? "bg-blue-500/20 text-blue-300" : "hover:bg-blue-500/10 text-muted-foreground"}`}
                  data-testid={`to-lang-${lang.code}`}
                >
                  <span>{LANG_FLAGS[lang.code] || "🌐"}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
          </SectionBoundary>
        )}
      </div>

      {showVoiceSettings && (
        <SectionBoundary label="Voice Settings">
        <div className="fixed inset-0 z-50" onClick={() => { setShowVoiceSettings(false); setSettingsView("main"); }}>
          <div
            className="absolute right-3 top-12 border border-white/10 rounded-2xl shadow-2xl w-72 max-h-[60vh] overflow-y-auto"
            style={{ background: "rgba(8, 12, 35, 0.95)", backdropFilter: "blur(24px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {settingsView === "main" && (
              <>
                <div className="flex items-center justify-center pt-4 pb-2">
                  <div className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <Settings className="w-4.5 h-4.5 text-white/70" />
                  </div>
                </div>
                <p className="text-center text-sm font-semibold text-white/90 pb-3" data-testid="text-settings-title">Settings</p>
                <div className="px-2 pb-3 space-y-0.5">
                  <button
                    onClick={() => setSettingsView("languages")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors"
                    data-testid="button-settings-languages"
                  >
                    <LanguagesIcon className="w-5 h-5 text-white/70" />
                    <span className="flex-1 text-left text-sm text-white/90 font-medium">Languages</span>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                  <button
                    onClick={() => setSettingsView("voice")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors"
                    data-testid="button-settings-voice"
                  >
                    <AudioLines className="w-5 h-5 text-white/70" />
                    <span className="flex-1 text-left text-sm text-white/90 font-medium">Voice</span>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                  <button
                    onClick={() => setSettingsView("voice-clone")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors"
                    style={{
                      background: luxVoiceProfile?.enabled ? "rgba(139,92,246,0.08)" : "transparent",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = luxVoiceProfile?.enabled ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.05)")}
                    onMouseLeave={e => (e.currentTarget.style.background = luxVoiceProfile?.enabled ? "rgba(139,92,246,0.08)" : "transparent")}
                    data-testid="button-settings-voice-clone"
                  >
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      <span style={{ fontSize: "16px", lineHeight: 1 }}>✦</span>
                    </div>
                    <span className="flex-1 text-left text-sm font-medium" style={{ color: luxVoiceProfile?.enabled ? "#c4b5fd" : "rgba(255,255,255,0.9)" }}>
                      Lux Voice Clone
                    </span>
                    {luxVoiceProfile?.enabled && luxVoiceProfile.voice && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold capitalize" style={{ background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.35)" }}>
                        {luxVoiceProfile.voice}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4" style={{ color: luxVoiceProfile?.enabled ? "rgba(196,181,253,0.5)" : "rgba(255,255,255,0.3)" }} />
                  </button>
                  <button
                    onClick={() => setSettingsView("appearance")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors"
                    data-testid="button-settings-appearance"
                  >
                    <Eye className="w-5 h-5 text-white/70" />
                    <span className="flex-1 text-left text-sm text-white/90 font-medium">Appearance</span>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                  <button
                    onClick={() => setSettingsView("help")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors"
                    data-testid="button-settings-help"
                  >
                    <HelpCircle className="w-5 h-5 text-white/70" />
                    <span className="flex-1 text-left text-sm text-white/90 font-medium">Help & Support</span>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                </div>
              </>
            )}

            {settingsView === "languages" && (
              <>
                <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
                  <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/5" data-testid="button-back-languages">
                    <ChevronLeft className="w-4 h-4 text-white/70" />
                  </button>
                  <span className="text-sm font-semibold text-white/90">Languages</span>
                </div>
                <div className="p-3 space-y-3">
                  <div>
                    <p className="text-[10px] uppercase text-white/40 font-semibold mb-1.5 px-1">Speak (From)</p>
                    <div className="grid grid-cols-2 gap-1">
                      {LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          onClick={() => { setFromLang(lang.code); conversationHistoryRef.current = []; try { localStorage.setItem(STORAGE_KEYS.translateFromLang, lang.code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {} }}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${fromLang === lang.code ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "hover:bg-white/5 text-white/70 border border-transparent"}`}
                          data-testid={`settings-from-lang-${lang.code}`}
                        >
                          <span>{LANG_FLAGS[lang.code] || "🌐"}</span>
                          <span>{lang.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-white/40 font-semibold mb-1.5 px-1">Response Language</p>
                    <div className="grid grid-cols-2 gap-1">
                      {LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          onClick={() => { setToLang(lang.code); conversationHistoryRef.current = []; try { localStorage.setItem(STORAGE_KEYS.translateToLang, lang.code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {} }}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${toLang === lang.code ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "hover:bg-white/5 text-white/70 border border-transparent"}`}
                          data-testid={`settings-to-lang-${lang.code}`}
                        >
                          <span>{LANG_FLAGS[lang.code] || "🌐"}</span>
                          <span>{lang.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {settingsView === "voice" && (
              <>
                <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
                  <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/5" data-testid="button-back-voice">
                    <ChevronLeft className="w-4 h-4 text-white/70" />
                  </button>
                  <span className="text-sm font-semibold text-white/90" data-testid="text-voice-settings-title">Voice</span>
                </div>
                <div className="p-2 space-y-1">
                  {VOICE_OPTIONS.map((v) => (
                    <div
                      key={v.id}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all ${
                        selectedVoice === v.id
                          ? "bg-blue-500/15 border border-blue-500/40"
                          : "border border-transparent hover:bg-white/5"
                      }`}
                      data-testid={`button-voice-${v.id}`}
                    >
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          setSelectedVoice(v.id);
                          try { localStorage.setItem(STORAGE_KEYS.voice, v.id); } catch {}
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-white/90">{v.name}</span>
                          <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-white/40 uppercase">
                            {v.provider === "polly" ? "Neural" : "AI"}
                          </span>
                        </div>
                        <span className="text-[10px] text-white/40">{v.accent}</span>
                      </div>
                      <button
                        onClick={() => previewVoice(v.id)}
                        className="p-1.5 rounded-full hover:bg-white/5 shrink-0 active:scale-90 transition-transform"
                        data-testid={`button-preview-${v.id}`}
                      >
                        <Volume2 className={`w-4 h-4 ${previewPlaying === v.id ? "text-blue-400 animate-pulse" : "text-white/40"}`} />
                      </button>
                      {selectedVoice === v.id && (
                        <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3">
                  <div className="px-2 py-2.5 rounded-xl border border-white/8" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-white/70 font-medium">Speech Speed</span>
                      <span className="text-[10px] text-blue-400/70 font-mono">{speechSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={speechSpeed}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setSpeechSpeed(val);
                        try { localStorage.setItem(STORAGE_KEYS.speed, String(val)); } catch {}
                      }}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer accent-blue-500"
                      style={{ background: `linear-gradient(to right, rgb(59,130,246) ${((speechSpeed - 0.5) / 1.0) * 100}%, rgba(255,255,255,0.1) ${((speechSpeed - 0.5) / 1.0) * 100}%)` }}
                      data-testid="slider-speech-speed"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-white/25">Slower</span>
                      <span className="text-[9px] text-white/25">Faster</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {settingsView === "voice-clone" && (
              <>
                {/* Lux header */}
                <div className="px-3 pt-4 pb-3 border-b border-white/10" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(96,165,250,0.08) 100%)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/10" data-testid="button-back-voice-clone">
                      <ChevronLeft className="w-4 h-4 text-white/70" />
                    </button>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,rgba(139,92,246,0.4),rgba(96,165,250,0.3))", border: "1px solid rgba(139,92,246,0.4)" }}>
                        <span style={{ fontSize: "11px" }}>✦</span>
                      </div>
                      <span className="text-sm font-semibold text-white/95">Lux Voice Clone</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold tracking-wide" style={{ background: "linear-gradient(90deg,rgba(139,92,246,0.3),rgba(96,165,250,0.3))", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.4)" }}>BETA</span>
                  </div>
                  <p className="text-[10px] text-white/40 leading-relaxed">Choose a voice persona for Juno to use when speaking your translations.</p>
                </div>

                {/* Voice cards */}
                <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                  {[
                    { id: "nova",    label: "Nova",    sub: "Warm Female",   char: "Celestial warmth",   emoji: "🌟" },
                    { id: "alloy",   label: "Alloy",   sub: "Neutral",       char: "Precision clarity",  emoji: "💎" },
                    { id: "echo",    label: "Echo",    sub: "Male",          char: "Natural resonance",  emoji: "🌊" },
                    { id: "fable",   label: "Fable",   sub: "Expressive",    char: "Gentle storytelling",emoji: "📖" },
                    { id: "onyx",    label: "Onyx",    sub: "Deep Male",     char: "Deep authority",     emoji: "🌑" },
                    { id: "shimmer", label: "Shimmer", sub: "Soft Female",   char: "Bright energy",      emoji: "✨" },
                  ].map((v) => {
                    const isActive = luxVoiceProfile?.enabled === true && luxVoiceProfile?.voice === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => {
                          luxVoiceMutation.mutate(v.id);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                        style={{
                          background: isActive ? "linear-gradient(135deg,rgba(139,92,246,0.18),rgba(96,165,250,0.12))" : "rgba(255,255,255,0.03)",
                          border: isActive ? "1px solid rgba(139,92,246,0.45)" : "1px solid rgba(255,255,255,0.06)",
                        }}
                        data-testid={`lux-voice-${v.id}`}
                      >
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{
                          background: isActive ? "linear-gradient(135deg,rgba(139,92,246,0.25),rgba(96,165,250,0.2))" : "rgba(255,255,255,0.05)",
                          border: isActive ? "1px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                        }}>
                          {v.emoji}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold" style={{ color: isActive ? "#c4b5fd" : "rgba(255,255,255,0.85)" }}>
                              Lux {v.label}
                            </p>
                            <span className="text-[8px] px-1 py-0.5 rounded font-medium" style={{ background: "rgba(139,92,246,0.15)", color: "rgba(196,181,253,0.7)" }}>{v.sub}</span>
                          </div>
                          <p className="text-[10px] text-white/35 truncate">{v.char}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); previewVoice(v.id); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                            data-testid={`lux-preview-${v.id}`}
                          >
                            <Volume2 className={`w-3.5 h-3.5 ${previewPlaying === v.id ? "text-violet-400 animate-pulse" : "text-white/30"}`} />
                          </button>
                          {isActive && (
                            <div className="w-2 h-2 rounded-full" style={{ background: "linear-gradient(135deg,#8b5cf6,#60a5fa)" }} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Footer */}
                <div className="px-3 py-2.5 border-t border-white/8 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: "linear-gradient(135deg,#8b5cf6,#60a5fa)" }} />
                  <p className="text-[9px] text-white/25 flex-1">Selection applies to all Juno translations</p>
                  <span className="text-[8px] font-semibold" style={{ color: "rgba(139,92,246,0.6)" }}>LuxTTS</span>
                </div>
              </>
            )}

            {settingsView === "history" && (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10 flex-shrink-0">
                  <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/5" data-testid="button-back-history">
                    <ChevronLeft className="w-4 h-4 text-white/70" />
                  </button>
                  <span className="text-sm font-semibold text-white/90 flex-1">Conversation History</span>
                  {sessions.length > 0 && (
                    <button
                      onClick={() => {
                        setSessions([]);
                        fetch("/api/conv-sessions", {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ sessions: [] }),
                        }).catch(() => {});
                      }}
                      className="text-[10px] text-red-400/70 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                      data-testid="button-clear-all-sessions"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* Session catalog */}
                <div className="overflow-y-auto flex-1" key={historyKey} style={{ maxHeight: 340 }}>
                  {sessionsLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-5 h-5 animate-spin text-white/30" />
                    </div>
                  ) : sessions.length > 0 ? (
                    <div className="pb-3">
                      {groupSessionsByDate(sessions).map(group => (
                        <div key={group.label}>
                          {/* Date group label */}
                          <div className="px-4 pt-3 pb-1">
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(147,197,253,0.95)" }}>
                              {group.label}
                            </span>
                          </div>

                          {/* Session rows */}
                          {group.items.map(s => {
                            const sessionTime = new Date(s.createdAt);
                            const isToday = sessionTime.toDateString() === new Date().toDateString();
                            const timeLabel = isToday
                              ? sessionTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : sessionTime.toLocaleDateString([], { month: "short", day: "numeric" });
                            return (
                              <div
                                key={s.id}
                                onClick={() => {
                                  const caption = { role: "system", content: `You are resuming a previous conversation titled "${s.title || "Previous conversation"}". Use the full conversation history below as your memory — continue naturally as if no time has passed.` };
                                  const msgs = s.messages.map((m: ConvMessage) => ({ role: m.role, content: m.content }));
                                  conversationHistoryRef.current = [caption, ...msgs].slice(-20);
                                  try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}
                                  setShowVoiceSettings(false);
                                  setSettingsView("main");
                                  setShowHistoryPanel(false);
                                }}
                                className="flex items-center mx-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-white/5 active:bg-white/8 gap-3"
                                style={{ borderLeft: "2px solid rgba(96,165,250,0.55)" }}
                                data-testid={`item-settings-session-${s.id}`}
                              >
                                {/* Icon */}
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(96,165,250,0.2)", border: "1px solid rgba(96,165,250,0.4)" }}>
                                  <MessageCircle className="w-3.5 h-3.5" style={{ color: "#93c5fd" }} />
                                </div>

                                {/* Title + time */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-white truncate leading-tight">{s.title}</p>
                                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.70)" }}>{timeLabel}</p>
                                </div>

                                {/* Delete */}
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    const updated = sessions.filter(x => x.id !== s.id);
                                    setSessions(updated);
                                    fetch("/api/conv-sessions", {
                                      method: "POST", credentials: "include",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ sessions: updated }),
                                    }).catch(() => {});
                                  }}
                                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 hover:bg-red-500/15 transition-colors"
                                  data-testid={`button-delete-settings-session-${s.id}`}
                                >
                                  <Trash2 className="w-3 h-3 text-white/50 hover:text-red-400/70" />
                                </button>

                                <ChevronRight className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <History className="w-9 h-9 text-white/10" />
                      <p className="text-xs font-medium text-white/35">No conversations yet</p>
                      <p className="text-[10px] text-white/20 text-center px-6 leading-relaxed">Start a chat with Juno. Each session will be saved here automatically.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {settingsView === "history-detail" && (() => {
              const activeSession = sessions.find(s => s.id === selectedSessionId);
              const sessionTime = activeSession ? new Date(activeSession.createdAt) : null;
              return (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10 flex-shrink-0">
                    <button
                      onClick={() => setSettingsView("history")}
                      className="p-1 rounded-lg hover:bg-white/5"
                      data-testid="button-back-history-detail"
                    >
                      <ChevronLeft className="w-4 h-4 text-white/70" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/90 truncate leading-tight">{activeSession?.title || "Conversation"}</p>
                      {sessionTime && (
                        <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {sessionTime.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {sessionTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="overflow-y-auto flex-1 px-3 py-3 space-y-2.5" style={{ maxHeight: 340 }}>
                    {(activeSession?.messages || []).length > 0 ? (
                      (activeSession!.messages).map((entry, i) => (
                        <div key={i} className={`flex flex-col gap-0.5 ${entry.role === "user" ? "items-end" : "items-start"}`}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", paddingInline: 3, color: entry.role === "user" ? "rgba(255,255,255,0.65)" : "rgba(147,197,253,0.9)" }}>
                            {entry.role === "user" ? "You" : "Juno"}
                          </span>
                          <div
                            style={{
                              maxWidth: "86%",
                              padding: "8px 11px",
                              borderRadius: entry.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                              background: entry.role === "user" ? "rgba(35,50,95,0.88)" : "rgba(22,54,120,0.82)",
                              border: `1px solid ${entry.role === "user" ? "rgba(255,255,255,0.2)" : "rgba(59,130,246,0.45)"}`,
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: "#ffffff",
                            }}
                          >
                            {entry.image && (
                              <div style={{ marginBottom: 6 }}>
                                <img src={entry.image.url} alt={entry.image.title} style={{ width: "100%", borderRadius: 8, maxHeight: 120, objectFit: "cover" }} />
                              </div>
                            )}
                            <p style={{ margin: 0 }}>{entry.content}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-xs text-white/30">No messages in this session</p>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {settingsView === "appearance" && (
              <>
                <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
                  <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/5" data-testid="button-back-appearance">
                    <ChevronLeft className="w-4 h-4 text-white/70" />
                  </button>
                  <span className="text-sm font-semibold text-white/90">Appearance</span>
                </div>
                <div className="p-4 space-y-4">
                  {/* Background Theme */}
                  <div className="px-1">
                    <span className="text-xs text-white/70 block mb-2">Background Theme</span>
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { id: "navy",       label: "Navy",       gradient: "linear-gradient(135deg,#1a3a80,#1a3a8f)" },
                        { id: "aurora",     label: "Aurora",     gradient: "linear-gradient(135deg,#0d1b3e,#3b1f6b,#0f4a4a)" },
                        { id: "storm",      label: "Storm",      gradient: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)" },
                        { id: "ember",      label: "Ember",      gradient: "linear-gradient(135deg,#1a0a00,#7c2d12,#dc6a18)" },
                        { id: "void",       label: "Void",       gradient: "linear-gradient(135deg,#050505,#1a0533,#0d0d1a)" },
                        { id: "forest",     label: "Forest",     gradient: "linear-gradient(135deg,#0a1a0a,#0d3b1e,#1a5c2a)" },
                        { id: "deep-black", label: "Black",      gradient: "linear-gradient(135deg,#000000,#0a0a0a,#111111)" },
                        { id: "spectrum",   label: "Spectrum",   gradient: "linear-gradient(135deg,#1a0030,#003060,#001a30)" },
                        { id: "liquid-blue",label: "Ocean",      gradient: "linear-gradient(135deg,#001a40,#003080,#0050b3)" },
                        { id: "rain-glass", label: "Rain",       gradient: "linear-gradient(135deg,#0a1520,#1a3050,#0d2540)" },
                        { id: "prism",      label: "Prism",      gradient: "linear-gradient(135deg,#1a0030,#300060,#600000,#006040)" },
                        { id: "circuit",    label: "Circuit",    gradient: "linear-gradient(135deg,#001a10,#003320,#00501a)" },
                      ] as const).map(t => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setDashboardTheme(t.id);
                            try {
                              localStorage.setItem(STORAGE_KEYS.dashboardTheme, t.id);
                              window.dispatchEvent(new Event("storage"));
                            } catch {}
                          }}
                          style={{ background: t.gradient, position: "relative" }}
                          className={`h-12 rounded-xl transition-all ${dashboardTheme === t.id ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-black/50 scale-105" : "opacity-75 hover:opacity-100"}`}
                          data-testid={`button-theme-${t.id}`}
                        >
                          <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                            {t.label}
                          </span>
                          {dashboardTheme === t.id && (
                            <span style={{ position: "absolute", top: 3, right: 3, width: 8, height: 8, borderRadius: "50%", background: "#60a5fa" }} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-1">
                    <span className="text-xs text-white/70 block mb-2">Text Size</span>
                    <div className="flex gap-2">
                      {(["small", "medium", "large"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => { setTextSize(s); try { localStorage.setItem(STORAGE_KEYS.textSize, s); } catch {} }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium capitalize transition-all ${
                            textSize === s ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "bg-white/5 text-white/50 border border-transparent hover:bg-white/8"
                          }`}
                          data-testid={`button-textsize-${s}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <div>
                      <span className="text-xs text-white/70 block">Auto-play voice</span>
                      <span className="text-[10px] text-white/30">Automatically speak translations</span>
                    </div>
                    <button
                      onClick={() => {
                        const next = !autoPlayVoice;
                        setAutoPlayVoice(next);
                        try { localStorage.setItem(STORAGE_KEYS.autoplay, String(next)); } catch {}
                      }}
                      className={`w-10 h-5 rounded-full transition-all relative ${autoPlayVoice ? "bg-blue-500" : "bg-white/15"}`}
                      data-testid="button-toggle-autoplay"
                    >
                      <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{ left: autoPlayVoice ? "22px" : "2px" }} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between px-1">
                    <div>
                      <span className="text-xs text-white/70 block">"Hey Juno" Wake Word</span>
                      <span className="text-[10px] text-white/30">{wakeWordEnabled ? (wakeWordListening ? "Listening for \"Hey Juno\"..." : "Active") : "Say \"Hey Juno\" to start translating"}</span>
                    </div>
                    <button
                      onClick={async () => {
                        if (!wakeWordEnabled) {
                          try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            stream.getTracks().forEach(t => t.stop());
                          } catch {
                            setError("Microphone access is required for Hey Juno. Please allow mic permissions.");
                            return;
                          }
                        }
                        const next = !wakeWordEnabled;
                        setWakeWordEnabled(next);
                        fetch("/api/v1/preferences", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ wakeWordEnabled: next }),
                        }).catch(() => {});
                      }}
                      className={`w-10 h-5 rounded-full transition-all relative ${wakeWordEnabled ? "bg-blue-500" : "bg-white/15"}`}
                      data-testid="button-toggle-wakeword"
                    >
                      <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{ left: wakeWordEnabled ? "22px" : "2px" }} />
                    </button>
                  </div>
                  <p className="text-[10px] text-white/25 px-1">Dark mode is always enabled for the best experience.</p>
                </div>
              </>
            )}

            {settingsView === "help" && (
              <>
                <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
                  <button onClick={() => setSettingsView("main")} className="p-1 rounded-lg hover:bg-white/5" data-testid="button-back-help">
                    <ChevronLeft className="w-4 h-4 text-white/70" />
                  </button>
                  <span className="text-sm font-semibold text-white/90 flex-1">Help & Support</span>
                  {supportMessages.length > 0 && (
                    <button
                      onClick={() => setSupportMessages([])}
                      className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1 rounded-lg hover:bg-white/5"
                      data-testid="button-clear-support"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-col" style={{ height: "340px" }}>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {supportMessages.length === 0 && (
                      <div className="text-center py-4">
                        <MessageCircle className="w-8 h-8 text-blue-400/20 mx-auto mb-2" />
                        <p className="text-xs text-white/50 font-medium mb-1">AI Support Assistant</p>
                        <p className="text-[10px] text-white/30 mb-3">Ask anything about JunoTalk</p>
                        <div className="space-y-1.5">
                          {[
                            "How do I talk to Juno?",
                            "Why isn't my microphone working?",
                            "How do I change the voice?",
                          ].map((q) => (
                            <button
                              key={q}
                              onClick={() => { setSupportInput(q); }}
                              className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/8 text-[10px] text-white/50 transition-colors"
                              data-testid={`button-suggestion-${q.slice(0, 10)}`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {supportMessages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] px-3 py-2 rounded-xl text-[11px] leading-relaxed ${
                            m.role === "user"
                              ? "bg-blue-500/20 text-blue-100 rounded-br-sm"
                              : "bg-white/5 text-white/70 rounded-bl-sm"
                          }`}
                          data-testid={`support-message-${m.role}-${i}`}
                        >
                          {m.text}
                        </div>
                      </div>
                    ))}
                    {supportLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white/5 px-3 py-2 rounded-xl rounded-bl-sm">
                          <Loader2 className="w-4 h-4 text-blue-400/50 animate-spin" />
                        </div>
                      </div>
                    )}
                    <div ref={supportEndRef} />
                  </div>
                  <div className="px-3 pb-3 pt-1 border-t border-white/8">
                    <div className="flex gap-2">
                      <input
                        value={supportInput}
                        onChange={(e) => setSupportInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSupportMessage(); } }}
                        placeholder="Ask a question..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-white/80 placeholder-white/25 outline-none focus:border-blue-500/40 transition-colors"
                        data-testid="input-support-message"
                      />
                      <button
                        onClick={sendSupportMessage}
                        disabled={!supportInput.trim() || supportLoading}
                        className="p-2 rounded-xl bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        data-testid="button-send-support"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                    <a href="https://junotalk.app" target="_blank" rel="noopener noreferrer" className="block text-center mt-2 text-[9px] text-blue-400/40 hover:text-blue-400/60 transition-colors" data-testid="link-contact">
                      junotalk.app
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        </SectionBoundary>
      )}

      <main className="flex-1 flex flex-col min-h-0 relative z-10">
        {/* Idle state — orb + greeting + suggestion cards */}
        {chatMessages.length === 0 && !transcript && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Orb + greeting — anchored at top */}
            <div className="flex flex-col items-center pt-6 gap-2">
              <div className="relative flex items-center justify-center" style={{ width: "96px", height: "96px" }}>
                <ParticleOrb size={90} isActive={isListening || sessionActive} isSpeaking={isSpeaking} />
              </div>
              {showJunoWelcome && (
                <div
                  style={{ opacity: junoFading ? 0 : 1, transition: "opacity 1.2s ease" }}
                  className="flex flex-col items-center"
                  data-testid="juno-welcome-text"
                >
                  <p
                    className="text-lg font-semibold text-white/90 tracking-wide text-center"
                    style={{ textShadow: "0 0 15px rgba(100,180,255,0.3)", animation: "junoTextIn 1s ease forwards" }}
                    data-testid="text-juno-greeting"
                  >
                    Hi, I'm Juno.
                  </p>
                  <p
                    className="text-sm text-blue-200/60 mt-0.5 text-center px-6"
                    style={{ animation: "junoTextIn 1s ease forwards 0.3s", opacity: 0 }}
                    data-testid="text-juno-subtitle"
                  >
                    {junoSubtitle}
                  </p>
                </div>
              )}
            </div>
            {/* Spacer fills remaining area */}
            <div className="flex-1 min-h-0" />
          </div>
        )}

        {/* Conversation state — chat bubbles */}
        {(chatMessages.length > 0 || transcript) && (
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            style={{
              minHeight: 0,
              background: "linear-gradient(to bottom, transparent 0%, rgba(4,10,30,0.6) 18%, rgba(4,10,30,0.72) 100%)",
            }}
          >
            {/* Small orb at top when in conversation */}
            <div className="flex justify-center mb-2">
              <div className="relative flex items-center justify-center" style={{ width: "72px", height: "72px" }}>
                <ParticleOrb size={68} isActive={isListening || sessionActive} isSpeaking={isSpeaking} />
              </div>
            </div>

            {chatMessages.map((msg) =>
              msg.type === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div
                    className="max-w-[82%] px-4 py-3 rounded-2xl rounded-br-sm"
                    style={{ background: "rgba(35,50,95,0.88)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <p className="text-[9px] text-white/70 mb-1 uppercase tracking-wide font-semibold">You</p>
                    <p
                      className={`${textSize === "small" ? "text-xs" : textSize === "large" ? "text-base" : "text-sm"} text-white leading-relaxed`}
                      data-testid={`text-transcript-${msg.id}`}
                    >{msg.text}</p>
                  </div>
                </div>
              ) : msg.type === "ai_image" ? (
                <div key={msg.id} className="flex justify-start items-start">
                  <div
                    className="rounded-2xl rounded-bl-sm overflow-hidden"
                    style={{ border: "1px solid rgba(59,130,246,0.45)", maxWidth: "92%" }}
                  >
                    <div className="px-3 py-2" style={{ background: "rgba(22,54,120,0.82)", backdropFilter: "blur(12px)" }}>
                      <p className="text-[9px] text-blue-300 uppercase tracking-wide mb-0.5 font-semibold">Juno</p>
                      <p className="text-xs text-white">{msg.text}</p>
                    </div>
                    {msg.imageUrls && msg.imageUrls.length > 1 ? (
                      <div className="grid grid-cols-2 gap-0.5 cursor-pointer" style={{ background: "rgba(10,20,50,0.9)" }} onClick={() => setImageSession({ imageUrls: msg.imageUrls!, prompt: msg.prompt || msg.text })}>
                        {msg.imageUrls.map((img, idx) => (
                          <div key={idx} className="relative">
                            <img
                              src={img.url}
                              alt={img.label}
                              className="w-full object-cover"
                              style={{ height: msg.imageUrls!.length > 4 ? "100px" : "130px", display: "block" }}
                              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                              data-testid={`image-ai-${msg.id}-${idx}`}
                            />
                            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5" style={{ background: "rgba(0,0,0,0.55)" }}>
                              <p className="text-[8px] text-blue-200 font-semibold">{img.label}</p>
                            </div>
                          </div>
                        ))}
                        <div className="col-span-2 flex items-center justify-center gap-1 py-1.5" style={{ background: "rgba(59,130,246,0.12)" }}>
                          <p className="text-[9px] text-blue-300 font-semibold tracking-wide">Tap to open Image Session</p>
                        </div>
                      </div>
                    ) : (
                      <div className="cursor-pointer relative" onClick={() => setImageSession({ imageUrls: msg.imageUrls || (msg.imageUrl ? [{ url: msg.imageUrl, label: "Image", model: "flux" }] : []), prompt: msg.prompt || msg.text })}>
                        <img
                          src={msg.imageUrl}
                          alt="AI generated"
                          className="w-full object-cover"
                          style={{ maxHeight: "260px", display: "block" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          data-testid={`image-ai-${msg.id}`}
                        />
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center py-1.5" style={{ background: "rgba(59,130,246,0.12)" }}>
                          <p className="text-[9px] text-blue-300 font-semibold tracking-wide">Tap to open Image Session</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start items-start gap-2">
                  <div
                    className="max-w-[80%] px-4 py-3 rounded-2xl rounded-bl-sm"
                    style={{ background: "rgba(22,54,120,0.82)", backdropFilter: "blur(12px)", border: "1px solid rgba(59,130,246,0.45)" }}
                  >
                    <div className="flex items-center justify-between mb-1 gap-3">
                      <p className="text-[9px] text-blue-300 uppercase tracking-wide font-semibold">Juno</p>
                      <button
                        onClick={() => { unlockAudio(); puterSpeak(msg.text, toLang); }}
                        disabled={isSpeaking}
                        className="p-0.5 rounded-full hover:bg-white/10 active:scale-90 transition-all disabled:opacity-40"
                        data-testid={`button-play-${msg.id}`}
                      >
                        <Volume2 className={`w-3 h-3 ${isSpeaking ? "text-blue-400 animate-pulse" : "text-blue-300"}`} />
                      </button>
                    </div>
                    <div
                      className={`${textSize === "small" ? "text-xs" : textSize === "large" ? "text-base" : "text-sm"} text-white leading-relaxed`}
                      data-testid={`text-translated-${msg.id}`}
                    >{renderJunoText(msg.text)}</div>
                    {msg.image && (
                      <a
                        href={msg.image.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-3 rounded-xl overflow-hidden"
                        style={{ border: "1px solid rgba(59,130,246,0.25)" }}
                        data-testid={`image-cultural-${msg.id}`}
                      >
                        <img
                          src={msg.image.url}
                          alt={msg.image.title}
                          className="w-full object-cover"
                          style={{ maxHeight: "180px" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="px-2.5 py-1.5" style={{ background: "rgba(10,20,50,0.7)" }}>
                          <p className="text-[9px] text-blue-300/70 truncate">{msg.image.title}</p>
                          <p className="text-[8px] text-white/30 mt-0.5">Wikipedia · Tap to open</p>
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )
            )}

            {isTranslating && (
              <div className="flex justify-start items-start gap-2">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)" }}
                >
                  <img src={micIconPath} alt="Juno" className="w-6 h-6 object-contain opacity-80" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2"
                  style={{ background: "rgba(14,36,80,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(59,130,246,0.22)" }}
                >
                  <Loader2 className="w-3.5 h-3.5 text-blue-300/60 animate-spin" />
                  <p className="text-xs text-blue-300/55">{"Thinking..."}</p>
                </div>
              </div>
            )}

            {chatMessages.length === 0 && transcript && (
              <div className="flex justify-end">
                <div
                  className="max-w-[82%] px-4 py-3 rounded-2xl rounded-br-sm"
                  style={{ background: "rgba(28,38,68,0.8)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <p className="text-[9px] text-white/35 mb-1 uppercase tracking-wide">You</p>
                  <p
                    className={`${textSize === "small" ? "text-xs" : textSize === "large" ? "text-base" : "text-sm"} text-white/90 leading-relaxed`}
                    data-testid="text-transcript"
                  >{transcript}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {offlineRemainingMs !== null && offlineRemainingMs > 0 && (
          <div className="mx-4 mb-1 px-3 py-1.5 rounded-lg flex items-center gap-2 text-[10px] font-medium text-amber-300 border border-amber-500/30" style={{ background: "rgba(120,80,0,0.25)" }} data-testid="banner-offline-mode">
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round"/></svg>
            <span>Offline mode, cached results only &bull; {Math.ceil(offlineRemainingMs / 1000)}s remaining</span>
          </div>
        )}

        {error && (
          <div className="flex justify-start items-start gap-2" data-testid="text-error">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <img src={micIconPath} alt="Juno" className="w-6 h-6 object-contain opacity-60" />
            </div>
            <div
              className="px-4 py-3 rounded-2xl rounded-bl-sm"
              style={{ background: "rgba(60,14,14,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(239,68,68,0.25)" }}
            >
              <p className="text-xs text-red-300/90">{error}</p>
            </div>
          </div>
        )}

        {voiceLimitPopup?.show && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-6"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
            onClick={() => setVoiceLimitPopup(null)}
            data-testid="popup-voice-limit"
          >
            <div
              className="w-full rounded-2xl px-5 py-6 flex flex-col items-center gap-3 text-center"
              style={{ background: "linear-gradient(135deg,#1a3a70,#2a4a85)", border: "1px solid rgba(59,130,246,0.35)", boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)" }}>
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm mb-1">Daily Voice Limit Reached</p>
                <p className="text-blue-200/70 text-xs leading-relaxed">
                  You've used all {voiceLimitPopup.limit} voice conversations with Juno for today.
                </p>
              </div>
              <div className="w-full rounded-xl px-4 py-3" style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}>
                <p className="text-blue-300 text-xs">Typing is still unlimited. Just use the text box below. Voice resets at midnight UTC.</p>
              </div>
              <button
                className="mt-1 px-5 py-2 rounded-full text-xs font-medium text-white"
                style={{ background: "rgba(59,130,246,0.3)", border: "1px solid rgba(59,130,246,0.4)" }}
                onClick={() => setVoiceLimitPopup(null)}
                data-testid="button-dismiss-voice-limit"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Bottom input bar — ChatGPT style */}
        <div
          className="pl-3 pr-0 flex items-center gap-0.5"
          style={{
            paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
            transition: "padding-bottom 0.2s ease",
            ...(chatMessages.length > 0 || transcript ? { background: "rgba(4,10,30,0.72)" } : {}),
          }}
        >
          {/* Diamond-chevron button — opens history */}
          <button
            onClick={handleOpenHistory}
            className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center active:scale-90 transition-all"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
            data-testid="button-open-history"
          >
            <svg width="20" height="22" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Up chevron ∧ */}
              <path d="M2 9.5L10 2L18 9.5" stroke="rgba(255,255,255,0.75)" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter"/>
              {/* Down chevron ∨ */}
              <path d="M2 12.5L10 20L18 12.5" stroke="rgba(255,255,255,0.75)" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter"/>
            </svg>
          </button>

          {/* Text input with mic icon inside */}
          <div className="flex-1 relative flex items-center">
            <input
              ref={manualInputRef}
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && manualInput.trim()) {
                  chatWithJuno(manualInput.trim());
                  setManualInput("");
                }
              }}
              placeholder={sessionActive ? "Listening..." : wakeWordListening ? "Say \"Hey Juno\"..." : "Ask Juno..."}
              className="w-full pr-9 pl-4 py-3 rounded-full text-sm text-white placeholder-white/30 outline-none bg-transparent"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)",
                caretColor: "#60a5fa",
              }}
              data-testid="input-manual-translate"
            />
            {/* Mic icon inside input — tap to record voice → text */}
            <button
              onClick={() => {
                if (manualInput.trim()) {
                  chatWithJuno(manualInput.trim());
                  setManualInput("");
                } else {
                  toggleListening();
                }
              }}
              className="absolute right-3 text-white/40 hover:text-white/70 active:scale-90 transition-all"
              data-testid="button-input-mic"
            >
              <Mic className="w-4 h-4" style={{ color: isListening ? "#60a5fa" : undefined }} />
            </button>
          </div>

          {/* Juno bubble button — right side */}
          <button
            onClick={toggleListening}
            className="flex-shrink-0 active:scale-90 transition-transform"
            data-testid="button-mic"
          >
            <JunoBubble size={36} isActive={isListening || sessionActive} isSpeaking={isSpeaking} />
          </button>
        </div>
      </main>

      {/* History bottom-sheet panel */}
      {showHistoryPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
            onClick={() => { setShowHistoryPanel(false); setShowInlineInput(false); setInlineDraft(""); }}
          />
          {/* Sheet */}
          <div
            className="fixed inset-0 z-50 flex flex-col"
            style={{
              background: "#111111",
              animation: "slideUp 0.3s cubic-bezier(0.4,0,0.2,1) forwards",
              paddingTop: "env(safe-area-inset-top)",
            }}
          >

            {!selectedSessionId ? (
              /* ── Sessions list ── */
              <div className="flex flex-col flex-1 overflow-hidden relative">

                {/* Header */}
                <div className="flex items-center justify-between flex-shrink-0 px-5 pt-3 pb-4">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 20, fontWeight: 700, color: "white", letterSpacing: "-0.3px" }}>History</span>
                    <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
                    <button
                      onClick={() => { setShowImageGallery(true); setGalleryImages(loadGallery()); }}
                      className="flex items-center justify-center relative"
                      data-testid="button-open-image-gallery"
                      title="Image Gallery"
                    >
                      <Images className="w-5 h-5 text-white" />
                      {galleryImages.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold" style={{ background: "#2563eb", color: "white" }}>
                          {galleryImages.length > 9 ? "9+" : galleryImages.length}
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setShowInlineInput(true);
                        setInlineDraft("");
                        setSavedSessionTitle(null);
                        setTimeout(() => inlineInputRef.current?.focus(), 60);
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.09)" }}
                      data-testid="button-new-session"
                    >
                      <Plus className="w-3.5 h-3.5 text-white/60" />
                    </button>
                    <button
                      onClick={() => { setShowHistoryPanel(false); setShowInlineInput(false); setInlineDraft(""); setSavedSessionTitle(null); }}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.09)" }}
                      data-testid="button-close-history-panel"
                    >
                      <X className="w-3.5 h-3.5 text-white/60" />
                    </button>
                  </div>
                </div>


                {/* Session list — grouped by date */}
                <div className="flex-1 overflow-y-auto" key={historyKey} style={{ paddingBottom: 12, scrollbarWidth: "thin", scrollbarColor: "rgba(147,197,253,0.35) transparent" }}>

                  {/* Inline new session — step 1: editing */}
                  {showInlineInput && (
                    <div
                      className="mx-3 mb-2 rounded-2xl flex items-center gap-3 px-4"
                      style={{ background: "rgba(55,115,215,0.18)", border: "1px solid rgba(96,165,250,0.35)", minHeight: 54 }}
                      data-testid="row-new-session-edit"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: "rgba(96,165,250,0.2)" }}
                      >
                        <SquarePen size={14} className="text-blue-300" />
                      </div>
                      <input
                        ref={inlineInputRef}
                        value={inlineDraft}
                        onChange={e => setInlineDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const topic = inlineDraft.trim();
                            if (!topic) return;
                            setShowInlineInput(false);
                            setSavedSessionTitle(topic);
                            setInlineDraft("");
                          }
                          if (e.key === "Escape") {
                            setShowInlineInput(false);
                            setInlineDraft("");
                          }
                        }}
                        placeholder="Name your session…"
                        style={{
                          flex: 1, background: "transparent", border: "none", outline: "none",
                          color: "white", fontSize: 14, caretColor: "#60a5fa",
                        }}
                        data-testid="input-new-session"
                      />
                      {/* Save checkmark */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          const topic = inlineDraft.trim();
                          if (!topic) return;
                          setShowInlineInput(false);
                          setSavedSessionTitle(topic);
                          setInlineDraft("");
                        }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
                        style={{ background: inlineDraft.trim() ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.07)" }}
                        data-testid="button-save-session"
                      >
                        <Check size={13} className={inlineDraft.trim() ? "text-blue-200" : "text-white/20"} />
                      </button>
                    </div>
                  )}


                  {sessionsLoading ? (
                    <div className="flex items-center justify-center py-14">
                      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(255,255,255,0.3)" }} />
                    </div>
                  ) : sessions.length > 0 || savedSessionTitle ? (
                    (() => {
                      const groups = groupSessionsByDate(sessions);
                      // Inject pending saved session into "Today" group
                      if (savedSessionTitle) {
                        const todayGroup = groups.find(g => g.label === "Today");
                        if (todayGroup) {
                          todayGroup.items = [{ id: "__pending__", title: savedSessionTitle, createdAt: new Date().toISOString(), messages: [] } as ConvSession, ...todayGroup.items];
                        } else {
                          groups.unshift({ label: "Today", items: [{ id: "__pending__", title: savedSessionTitle, createdAt: new Date().toISOString(), messages: [] } as ConvSession] });
                        }
                      }
                      return groups.map(group => (
                      <div key={group.label}>
                        {/* Date group label */}
                        <div style={{ padding: "10px 20px 4px" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(147,197,253,0.95)" }}>
                            {group.label}
                          </span>
                        </div>

                        {group.items.map((s, idx) => {
                          const sessionTime = new Date(s.createdAt);
                          const isToday = sessionTime.toDateString() === new Date().toDateString();
                          const timeLabel = isToday
                            ? sessionTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : sessionTime.toLocaleDateString([], { month: "short", day: "numeric" });
                          return (
                            <div key={s.id}>
                              <div
                                onClick={() => {
                                  if (s.id === "__pending__") {
                                    pendingSessionTitleRef.current = s.title;
                                    setSavedSessionTitle(null);
                                    handleNewChat();
                                    return;
                                  }
                                  const caption = { role: "system", content: `You are resuming a previous conversation titled "${s.title || "Previous conversation"}". Use the full conversation history below as your memory — continue naturally as if no time has passed.` };
                                  const msgs = s.messages.map((m: ConvMessage) => ({ role: m.role, content: m.content }));
                                  conversationHistoryRef.current = [caption, ...msgs].slice(-20);
                                  try { localStorage.setItem("juno_conv_history", JSON.stringify(conversationHistoryRef.current)); } catch {}
                                  setShowVoiceSettings(false);
                                  setSettingsView("main");
                                  setShowHistoryPanel(false);
                                }}
                                style={{
                                  display: "flex", alignItems: "center",
                                  paddingInline: "20px 12px", paddingBlock: 13,
                                  cursor: "pointer", gap: 10,
                                  transition: "background 0.15s",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                data-testid={`item-session-${s.id}`}
                              >
                                {/* Icon */}
                                <MessageCircle size={15} style={{ color: "#93c5fd", flexShrink: 0 }} />

                                {/* Title + date pill */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
                                    {s.title}
                                  </p>
                                  <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.70)", marginTop: 2 }}>
                                    {sessionTime.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                                  </p>
                                </div>

                                {/* Time */}
                                <span style={{ width: 60, textAlign: "right", fontSize: 13, color: "rgba(255,255,255,0.75)", flexShrink: 0 }}>
                                  {timeLabel}
                                </span>

                                {/* Delete — hidden for pending sessions */}
                                {s.id !== "__pending__" && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      const updated = sessions.filter(x => x.id !== s.id).slice(0, 10);
                                      setSessions(updated);
                                      fetch("/api/conv-sessions", {
                                        method: "POST", credentials: "include",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ sessions: updated }),
                                      }).catch(() => {});
                                    }}
                                    style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                                    data-testid={`button-delete-session-${s.id}`}
                                  >
                                    <Trash2 size={13} style={{ color: "rgba(255,255,255,0.55)" }} />
                                  </button>
                                )}
                              </div>
                              {/* Row divider */}
                              {idx < group.items.length - 1 && (
                                <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginInline: 20 }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <History className="w-10 h-10" style={{ color: "rgba(255,255,255,0.1)" }} />
                      <p style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.35)", margin: 0 }}>No history yet</p>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", margin: 0, textAlign: "center", paddingInline: 32, lineHeight: 1.5 }}>
                        Start a conversation with Juno. Each session will appear here automatically.
                      </p>
                    </div>
                  )}
                </div>

              </div>

            ) : (() => {
              /* ── Session detail view ── */
              const activeSession = sessions.find(s => s.id === selectedSessionId);
              return (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Detail header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <button
                      onClick={() => setSelectedSessionId(null)}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                      data-testid="button-back-session"
                    >
                      <ChevronLeft className="w-4 h-4 text-white/70" />
                    </button>
                    <div className="flex-1 min-w-0 text-center">
                      <p className="text-sm font-semibold text-white/90 truncate">{activeSession?.title || "Conversation"}</p>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {activeSession ? new Date(activeSession.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowHistoryPanel(false)}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                      data-testid="button-close-detail"
                    >
                      <X className="w-3.5 h-3.5 text-white/60" />
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {(activeSession?.messages || []).map((entry, i) => (
                      <div key={i} className={`flex flex-col gap-1 ${entry.role === "user" ? "items-end" : "items-start"}`}>
                        {/* Role label */}
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: entry.role === "user" ? "rgba(255,255,255,0.65)" : "rgba(147,197,253,0.9)", paddingInline: 4 }}>
                          {entry.role === "user" ? "You" : "Juno"}
                        </span>

                        {/* Bubble */}
                        <div
                          style={{
                            maxWidth: "82%",
                            padding: "10px 13px",
                            borderRadius: entry.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                            background: entry.role === "user" ? "rgba(35,50,95,0.88)" : "rgba(22,54,120,0.82)",
                            border: `1px solid ${entry.role === "user" ? "rgba(255,255,255,0.2)" : "rgba(59,130,246,0.45)"}`,
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: "#ffffff",
                            position: "relative",
                          }}
                        >
                          {/* Image (only from Juno chat messages) */}
                          {entry.image && (
                            <div style={{ marginBottom: 8 }}>
                              <img
                                src={entry.image.url}
                                alt={entry.image.title}
                                style={{ width: "100%", borderRadius: 10, maxHeight: 160, objectFit: "cover" }}
                              />
                              {entry.image.title && (
                                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{entry.image.title}</p>
                              )}
                            </div>
                          )}
                          <p style={{ margin: 0 }}>{entry.content}</p>

                          {/* Copy button */}
                          <button
                            onClick={() => navigator.clipboard?.writeText(entry.content).catch(() => {})}
                            style={{
                              position: "absolute", top: 6, right: entry.role === "user" ? -30 : "auto", left: entry.role !== "user" ? -30 : "auto",
                              width: 22, height: 22, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.08)",
                              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
                            }}
                            data-testid={`button-copy-msg-${i}`}
                            title="Copy"
                          >
                            <Check className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to   { transform: translateY(0); }
            }
          `}</style>
        </>
      )}


      {/* Image Gallery Panel */}
      {showImageGallery && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowImageGallery(false)} />
          <div
            className="fixed inset-0 z-50 flex flex-col"
            style={{ background: "rgba(4,10,30,0.97)", backdropFilter: "blur(24px)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0 px-5 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <Images className="w-4 h-4 text-blue-300" />
                <span style={{ fontSize: 18, fontWeight: 700, color: "white", letterSpacing: "-0.3px" }}>Image Gallery</span>
                <span className="text-[10px] text-blue-300/60 font-medium">({galleryImages.length})</span>
              </div>
              <button
                onClick={() => setShowImageGallery(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.09)" }}
                data-testid="button-close-image-gallery"
              >
                <X className="w-3.5 h-3.5 text-white/60" />
              </button>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(147,197,253,0.25) transparent" }}>
              {galleryImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
                  <Images className="w-10 h-10 text-blue-300" />
                  <p className="text-sm text-white/60 text-center">No images yet.<br />Ask Juno to create one in chat.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {galleryImages.map((img) => (
                    <div
                      key={img.id}
                      className="relative rounded-xl overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
                      style={{ border: "1px solid rgba(59,130,246,0.25)" }}
                      data-testid={`gallery-image-${img.id}`}
                      onClick={() => {
                        setShowImageGallery(false);
                        // Send image into the chat so the user can continue conversing with Juno about it
                        const newMsgId = ++chatIdRef.current;
                        setChatMessages(prev => [...prev, {
                          id: newMsgId,
                          type: "ai_image",
                          text: img.prompt,
                          prompt: img.prompt,
                          imageUrl: img.imageUrl,
                          imageUrls: [{ url: img.imageUrl, label: "Image", model: "flux" }],
                        }]);
                        setTimeout(() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }), 150);
                      }}
                    >
                      <img
                        src={img.imageUrl}
                        alt={img.prompt}
                        className="w-full object-cover"
                        style={{ height: "150px", display: "block", background: "rgba(15,25,60,0.8)" }}
                        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.opacity = "0.3"; }}
                      />
                      {/* Overlay with prompt + delete */}
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 flex items-end justify-between gap-1" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }}>
                        <p className="text-[8px] text-white/70 leading-tight line-clamp-2 flex-1">{img.prompt}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteFromGallery(img.id); setGalleryImages(loadGallery()); }}
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-red-500/30"
                          style={{ background: "rgba(255,255,255,0.12)" }}
                          data-testid={`button-delete-gallery-${img.id}`}
                        >
                          <Trash2 className="w-2.5 h-2.5 text-white/60" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {galleryImages.length > 0 && (
              <div className="flex-shrink-0 px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <button
                  onClick={() => { localStorage.removeItem(IMAGE_GALLERY_KEY); setGalleryImages([]); }}
                  className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                  data-testid="button-clear-gallery"
                >
                  Clear all images
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <JunoVision
        isOpen={showVision}
        onClose={() => setShowVision(false)}
        sourceLang={fromLang}
        targetLang={toLang}
      />
      </div>{/* end main panel */}

      {/* Image session — right panel, runs in parallel with chat */}
      {imageSession && (
        <div className="flex-1 h-full overflow-hidden flex flex-col" style={{ borderLeft: "1px solid rgba(59,130,246,0.22)" }}>
          <ImageSessionModal
            initialImageUrls={imageSession.imageUrls}
            originalPrompt={imageSession.prompt}
            onClose={() => setImageSession(null)}
            onNewVersion={(newImageUrls, combinedPrompt) => {
              newImageUrls.forEach(img => saveToGallery(`${combinedPrompt} [${img.label}]`, img.url));
              setGalleryImages(loadGallery());
            }}
            onSendToChat={(newImageUrls, prompt) => {
              const newMsgId = ++chatIdRef.current;
              setChatMessages(prev => [...prev, {
                id: newMsgId,
                type: "ai_image",
                text: `Refined: ${prompt}`,
                prompt,
                imageUrl: newImageUrls[0]?.url,
                imageUrls: newImageUrls,
              }]);
              // Session stays open — chat receives the image in parallel
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function VoiceTranslate() {
  return (
    <JunoPageBoundary>
      <VoiceTranslateInner />
    </JunoPageBoundary>
  );
}
