import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { X, Send, Loader2, User, ArrowLeftRight, MapPin, ScanText, ChevronDown, ChevronUp, Mic, Volume2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import planetOrbImg from "@assets/Untitled_design_1774637544301.png";
import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const LANG_FLAGS: Record<string, string> = {
  en: "🇺🇸", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹",
  pt: "🇧🇷", ru: "🇷🇺", zh: "🇨🇳", ja: "🇯🇵", ko: "🇰🇷",
  ar: "🇸🇦", hi: "🇮🇳", nl: "🇳🇱", pl: "🇵🇱", tr: "🇹🇷",
  sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", el: "🇬🇷", he: "🇮🇱",
  th: "🇹🇭", vi: "🇻🇳", cs: "🇨🇿", no: "🇳🇴",
  id: "🇮🇩", ms: "🇲🇾", tl: "🇵🇭", sw: "🇰🇪", bn: "🇧🇩",
  ur: "🇵🇰", ro: "🇷🇴", hu: "🇭🇺", uk: "🇺🇦", fa: "🇮🇷",
};

const LANG_BCP47: Record<string, string> = {
  en:"en-US", es:"es-ES", fr:"fr-FR", de:"de-DE", it:"it-IT",
  pt:"pt-BR", ru:"ru-RU", zh:"zh-CN", ja:"ja-JP", ko:"ko-KR",
  ar:"ar-SA", hi:"hi-IN", nl:"nl-NL", pl:"pl-PL", tr:"tr-TR",
  sv:"sv-SE", da:"da-DK", fi:"fi-FI", el:"el-GR", he:"he-IL",
  th:"th-TH", vi:"vi-VN", cs:"cs-CZ", no:"nb-NO",
  id:"id-ID", ms:"ms-MY", tl:"fil-PH", sw:"sw-KE", bn:"bn-BD",
  ur:"ur-PK", ro:"ro-RO", hu:"hu-HU", uk:"uk-UA", fa:"fa-IR",
};

function speakText(text: string, langCode: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = LANG_BCP47[langCode] || langCode;
  utt.rate = 0.95;
  window.speechSynthesis.speak(utt);
}

const COUNTRY_LANG: Record<string, string> = {
  US:"en",GB:"en",AU:"en",CA:"en",NZ:"en",IE:"en",ZA:"en",
  ES:"es",MX:"es",AR:"es",CO:"es",PE:"es",VE:"es",CL:"es",EC:"es",
  FR:"fr",BE:"fr",CH:"fr",SN:"fr",CI:"fr",
  DE:"de",AT:"de",IT:"it",
  PT:"pt",BR:"pt",AO:"pt",MZ:"pt",
  NL:"nl",PL:"pl",CZ:"cs",
  RU:"ru",BY:"ru",KZ:"ru",
  JP:"ja",CN:"zh",TW:"zh",HK:"zh",SG:"zh",KR:"ko",
  SA:"ar",EG:"ar",AE:"ar",IQ:"ar",SY:"ar",JO:"ar",LB:"ar",MA:"ar",DZ:"ar",TN:"ar",
  IN:"hi",TR:"tr",SE:"sv",DK:"da",FI:"fi",NO:"no",GR:"el",IL:"he",
  TH:"th",VN:"vi",ID:"id",MY:"ms",PH:"tl",
  KE:"sw",TZ:"sw",UG:"sw",BD:"bn",PK:"ur",RO:"ro",HU:"hu",UA:"uk",IR:"fa",AF:"fa",
};

function browserLangCode(): string | null {
  try {
    const raw = navigator.language || (navigator.languages && navigator.languages[0]) || "";
    const code = raw.split("-")[0].toLowerCase();
    return LANGUAGES.find(l => l.code === code) ? code : null;
  } catch { return null; }
}

function getStoredLang(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

interface ChatMessage { role: "user" | "juno"; content: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userLang?: string;
}

const SESSION_KEY = "juno_chat_messages";
const GEO_DISMISSED_KEY = "juno_geo_banner_dismissed";

function loadMessages(): ChatMessage[] {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

export default function JunoChatModal({ isOpen, onClose, userLang }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [fromLang, setFromLang] = useState(() => getStoredLang(STORAGE_KEYS.translateFromLang, "en"));
  const [toLang, setToLang]     = useState(() => getStoredLang(STORAGE_KEYS.translateToLang, "es"));
  const [pickingFrom, setPickingFrom] = useState(false);
  const [pickingTo, setPickingTo]     = useState(false);

  const [showLangPanel, setShowLangPanel] = useState(false);
  const langPanelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detectionSource, setDetectionSource] = useState<string | null>(null);
  const [showGeoBanner, setShowGeoBanner] = useState(false);
  const [detectingText, setDetectingText] = useState(false);
  const detectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);

  const fromObj = LANGUAGES.find(l => l.code === fromLang);
  const toObj   = LANGUAGES.find(l => l.code === toLang);

  const isManual = () => { try { return !!localStorage.getItem("juno_translate_lang_manual"); } catch { return false; } };

  function applyInferred(code: string, side: "from" | "to", source: string) {
    if (side === "to") {
      setToLang(code);
      try { localStorage.setItem(STORAGE_KEYS.translateToLang, code); } catch {}
    } else {
      setFromLang(code);
      try { localStorage.setItem(STORAGE_KEYS.translateFromLang, code); } catch {}
    }
    setDetectionSource(source);
    setTimeout(() => setDetectionSource(null), 3500);
  }

  useEffect(() => {
    if (!isOpen) {
      setShowLangPanel(false);
      if (langPanelTimerRef.current) clearTimeout(langPanelTimerRef.current);
      return;
    }
    setShowLangPanel(true);
    langPanelTimerRef.current = setTimeout(() => setShowLangPanel(false), 5000);
    if (!isManual()) {
      const browserCode = browserLangCode();
      if (browserCode && browserCode !== "en") applyInferred(browserCode, "from", "browser");
      try {
        const dismissed = sessionStorage.getItem(GEO_DISMISSED_KEY);
        if (!dismissed) setShowGeoBanner(true);
      } catch { setShowGeoBanner(true); }
    }
    return () => { if (langPanelTimerRef.current) clearTimeout(langPanelTimerRef.current); };
  }, [isOpen]);

  // Stop recording if modal closes
  useEffect(() => {
    if (!isOpen && recording) stopRecording();
  }, [isOpen]);

  function toggleLangPanel() {
    const next = !showLangPanel;
    setShowLangPanel(next);
    if (langPanelTimerRef.current) clearTimeout(langPanelTimerRef.current);
    if (next) langPanelTimerRef.current = setTimeout(() => setShowLangPanel(false), 5000);
  }

  const requestGeolocation = useCallback(() => {
    setShowGeoBanner(false);
    try { sessionStorage.setItem(GEO_DISMISSED_KEY, "1"); } catch {}
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
          );
          const data = await res.json();
          const langCode = COUNTRY_LANG[data.countryCode as string];
          if (langCode && langCode !== fromLang) applyInferred(langCode, "from", "location");
        } catch {}
      },
      () => {},
      { timeout: 6000, maximumAge: 3600000 }
    );
  }, [fromLang]);

  const detectTextLanguage = useCallback(async (text: string) => {
    if (text.length < 8) return;
    setDetectingText(true);
    try {
      const res = await fetch("/api/v1/detect-language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      // Detection is for display only — selectors define the fixed language pair, not auto-updated
      const detected = data.language || data.lang;
      if (detected && detected !== "unknown") {
        setDetectionSource(detected);
        setTimeout(() => setDetectionSource(null), 2500);
      }
    } catch {} finally { setDetectingText(false); }
  }, [fromLang]);

  useEffect(() => {
    if (detectDebounceRef.current) clearTimeout(detectDebounceRef.current);
    if (input.length >= 8) detectDebounceRef.current = setTimeout(() => detectTextLanguage(input), 800);
    return () => { if (detectDebounceRef.current) clearTimeout(detectDebounceRef.current); };
  }, [input, detectTextLanguage]);

  useEffect(() => {
    if (!isOpen) { setKeyboardHeight(0); return; }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kbH = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop ?? 0));
      setKeyboardHeight(kbH);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); setKeyboardHeight(0); };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setInput("");
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        document.body.style.overflow = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function saveMessages(msgs: ChatMessage[]) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs)); } catch {}
    setMessages(msgs);
  }

  // ── Voice recording ──
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      // Web Audio noise-gate buffer: soft compress + filter before recording
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);

      // High-pass filter to remove low-frequency rumble
      const highPass = audioCtx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      // Dynamics compressor to even out volume and suppress quiet noise
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -40;
      compressor.knee.value = 10;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.1;

      const dest = audioCtx.createMediaStreamDestination();
      source.connect(highPass);
      highPass.connect(compressor);
      compressor.connect(dest);
      audioCtxRef.current = audioCtx;

      const processedStream = dest.stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(processedStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const ext = mimeType.includes("mp4") ? "mp4" : "webm";
          const formData = new FormData();
          formData.append("audio", blob, `voice.${ext}`);
          formData.append("language", fromLang);
          const res = await fetch("/api/v1/transcribe", {
            method: "POST",
            credentials: "include",
            body: formData,
          });
          const data = await res.json();
          if (data.text?.trim()) {
            sendMessage(data.text.trim());
          }
        } catch {
          // silently ignore transcription errors
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start(200);
      setRecording(true);
    } catch {
      // mic permission denied or not available
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  function swapLangs() {
    setFromLang(toLang); setToLang(fromLang);
    try { localStorage.setItem(STORAGE_KEYS.translateFromLang, toLang); localStorage.setItem(STORAGE_KEYS.translateToLang, fromLang); } catch {}
  }
  function selectFrom(code: string) {
    setFromLang(code); setPickingFrom(false);
    try { localStorage.setItem(STORAGE_KEYS.translateFromLang, code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {}
  }
  function selectTo(code: string) {
    setToLang(code); setPickingTo(false);
    try { localStorage.setItem(STORAGE_KEYS.translateToLang, code); localStorage.setItem("juno_translate_lang_manual", "true"); } catch {}
  }

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: msg }];
    saveMessages(next);
    setLoading(true);
    try {
      // fromLang selector drives nativeLang — changing it tells the server which language to respond in
      const res = await fetch("/api/v1/chat-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: msg,
          sourceLang: fromLang || "auto",
          targetLang: toLang || userLang || "en",
          nativeLang: fromLang || userLang || "en",
        }),
      });
      const data = await res.json();
      const reply = data?.translatedText || data?.text || data?.translation || "Translation unavailable. Try again.";
      saveMessages([...next, { role: "juno", content: reply }]);
    } catch {
      saveMessages([...next, { role: "juno", content: "Sorry, couldn't connect right now. Try again." }]);
    } finally { setLoading(false); }
  };

  if (!isOpen) return null;

  const BG        = "rgba(18,38,74,0.98)";
  const PILL_BG   = "rgba(30,58,115,0.9)";
  const PILL_ACT  = "rgba(59,100,200,0.85)";
  const BORDER    = "rgba(99,155,255,0.35)";
  const BORDER_ACT = "rgba(99,155,255,0.65)";
  const TEXT      = "#e8f0ff";
  const TEXT_DIM  = "rgba(180,210,255,0.75)";

  const detectionLabel: Record<string, string> = {
    browser: "Detected from browser",
    location: "Detected from your location",
    text: "Detected from your text",
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center px-4"
      style={{
        background: "rgba(5,15,40,0.30)",
        backdropFilter: "blur(3px)",
        alignItems: keyboardHeight > 0 ? "flex-end" : "flex-start",
        paddingTop: keyboardHeight > 0 ? 0 : 16,
        paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0,
        transition: "padding 0.2s ease",
      }}
      onClick={onClose}
      data-testid="overlay-juno-chat-modal"
    >
      {/* ── Modal card ── */}
      <div
        className="relative w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: 520,
          height: "min(520px, 70dvh)",
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 24,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <img src={planetOrbImg} className="w-9 h-9 object-contain flex-shrink-0" alt="Juno" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none" style={{ color: TEXT }}>Juno</p>
            <p className="text-[11px] mt-0.5" style={{ color: TEXT_DIM }}>AI Translator</p>
          </div>

          {/* Translator toggle pill */}
          <button
            onClick={toggleLangPanel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all active:scale-90 flex-shrink-0"
            style={{
              background: showLangPanel ? PILL_ACT : PILL_BG,
              border: `1px solid ${showLangPanel ? BORDER_ACT : BORDER}`,
              color: TEXT_DIM,
            }}
            data-testid="button-toggle-lang-panel"
          >
            <span>{LANG_FLAGS[fromLang] || "🌐"}</span>
            <ArrowLeftRight className="w-2.5 h-2.5 opacity-60" />
            <span>{LANG_FLAGS[toLang] || "🌐"}</span>
            {showLangPanel ? <ChevronUp className="w-2.5 h-2.5 opacity-60" /> : <ChevronDown className="w-2.5 h-2.5 opacity-60" />}
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 flex-shrink-0"
            style={{ background: "rgba(99,155,255,0.15)", border: `1px solid ${BORDER}` }}
            data-testid="button-close-juno-modal"
          >
            <X className="w-4 h-4" style={{ color: TEXT }} />
          </button>
        </div>

        {/* ── Collapsible language panel ── */}
        <div
          className="flex-shrink-0 overflow-hidden"
          style={{
            maxHeight: showLangPanel ? 240 : 0,
            transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1)",
            borderBottom: showLangPanel ? `1px solid ${BORDER}` : "none",
          }}
        >
          <div className="px-4 pt-2.5 pb-2 flex flex-col gap-1.5">
            {detectionSource && (
              <div
                className="flex items-center gap-1.5 px-3 py-1 rounded-full self-start text-[10px]"
                style={{ background: "rgba(59,200,120,0.15)", border: "1px solid rgba(59,200,120,0.35)", color: "rgba(120,230,160,0.9)" }}
              >
                {detectionSource === "location" ? <MapPin className="w-2.5 h-2.5" /> : <ScanText className="w-2.5 h-2.5" />}
                {detectionLabel[detectionSource]}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => { setPickingFrom(p => !p); setPickingTo(false); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all"
                style={{ background: pickingFrom ? PILL_ACT : PILL_BG, border: `1px solid ${pickingFrom ? BORDER_ACT : BORDER}`, color: TEXT }}
                data-testid="button-translate-from"
              >
                <span>{LANG_FLAGS[fromLang] || "🌐"}</span>
                <span>{fromObj?.name || fromLang}</span>
                {detectingText && <Loader2 className="w-2.5 h-2.5 animate-spin opacity-60" />}
              </button>
              <button
                onClick={swapLangs}
                className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-90"
                style={{ background: PILL_BG, border: `1px solid ${BORDER}` }}
                data-testid="button-swap-langs"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: TEXT }} />
              </button>
              <button
                onClick={() => { setPickingTo(p => !p); setPickingFrom(false); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all"
                style={{ background: pickingTo ? PILL_ACT : PILL_BG, border: `1px solid ${pickingTo ? BORDER_ACT : BORDER}`, color: TEXT }}
                data-testid="button-translate-to"
              >
                <span>{LANG_FLAGS[toLang] || "🌐"}</span>
                <span>{toObj?.name || toLang}</span>
              </button>
            </div>

            {showGeoBanner && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px]"
                style={{ background: "rgba(30,58,115,0.7)", border: `1px solid ${BORDER}`, color: TEXT_DIM }}
              >
                <MapPin className="w-3 h-3 flex-shrink-0 opacity-70" />
                <span className="flex-1">Use your location to auto-detect language. Never stored or shared.</span>
                <button
                  onClick={requestGeolocation}
                  className="px-2 py-0.5 rounded-full text-white text-[10px] font-semibold flex-shrink-0"
                  style={{ background: "rgba(59,100,220,0.9)" }}
                  data-testid="button-allow-location"
                >Allow</button>
                <button
                  onClick={() => { setShowGeoBanner(false); try { sessionStorage.setItem(GEO_DISMISSED_KEY, "1"); } catch {} }}
                  className="opacity-50 flex-shrink-0"
                  data-testid="button-dismiss-geo"
                ><X className="w-3 h-3" /></button>
              </div>
            )}

            {(pickingFrom || pickingTo) && (
              <div className="grid grid-cols-3 gap-1 max-h-28 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                {LANGUAGES.map(lang => {
                  const active = pickingFrom ? lang.code === fromLang : lang.code === toLang;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => pickingFrom ? selectFrom(lang.code) : selectTo(lang.code)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-[11px] font-medium transition-all text-left"
                      style={{ background: active ? PILL_ACT : PILL_BG, border: `1px solid ${active ? BORDER_ACT : BORDER}`, color: active ? "#ffffff" : TEXT_DIM }}
                    >
                      <span>{LANG_FLAGS[lang.code] || "🌐"}</span>
                      <span className="truncate">{lang.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {messages.map((msg, i) => {
            const prevIsUser = i > 0 && messages[i - 1].role === "user";
            const isTranslation = msg.role === "juno" && prevIsUser;

            if (isTranslation) {
              // Translation bubble: stacked right below user message, same side
              return (
                <div
                  key={i}
                  className="flex gap-2.5 justify-start"
                  style={{ marginTop: 4, marginBottom: 12 }}
                  data-testid={`bubble-juno-msg-${i}`}
                >
                  <img src={planetOrbImg} className="w-7 h-7 object-contain flex-shrink-0 mt-0.5" alt="Juno" />
                  <div
                    className="relative max-w-[78%] px-4 pt-2 pb-6 rounded-2xl text-sm leading-relaxed"
                    style={{
                      background: "rgba(20,110,60,0.75)",
                      border: "1px solid rgba(60,200,100,0.35)",
                      color: "#b6f5cc",
                    }}
                  >
                    <span
                      className="block text-[9px] font-semibold uppercase tracking-widest mb-1"
                      style={{ color: "rgba(100,220,140,0.6)" }}
                    >
                      {LANG_FLAGS[toLang]} {toObj?.name}
                    </span>
                    {msg.content}
                    <button
                      onClick={() => speakText(msg.content, toLang)}
                      className="absolute bottom-1.5 right-2 flex items-center justify-center w-5 h-5 rounded-full active:scale-90 transition-transform"
                      style={{ background: "rgba(60,200,100,0.2)", border: "1px solid rgba(60,200,100,0.35)" }}
                      data-testid={`speak-juno-${i}`}
                    >
                      <Volume2 className="w-2.5 h-2.5" style={{ color: "rgba(100,220,140,0.9)" }} />
                    </button>
                  </div>
                </div>
              );
            }

            // Standard message bubble
            return (
              <div
                key={i}
                className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                style={{ marginBottom: 4 }}
                data-testid={`bubble-juno-msg-${i}`}
              >
                {msg.role === "juno" && (
                  <img src={planetOrbImg} className="w-7 h-7 object-contain flex-shrink-0 mt-0.5" alt="Juno" />
                )}
                <div
                  className="relative max-w-[78%] px-4 pt-2.5 pb-6 rounded-2xl text-sm leading-relaxed"
                  style={
                    msg.role === "user"
                      ? { background: "rgba(59,100,220,0.55)", border: `1px solid ${BORDER_ACT}`, color: "#ffffff" }
                      : { background: "rgba(30,58,115,0.8)", border: `1px solid ${BORDER}`, color: TEXT }
                  }
                >
                  {msg.role === "user" && (
                    <span
                      className="block text-[9px] font-semibold uppercase tracking-widest mb-1"
                      style={{ color: "rgba(180,210,255,0.55)" }}
                    >
                      {LANG_FLAGS[fromLang]} {fromObj?.name}
                    </span>
                  )}
                  {msg.content}
                  <button
                    onClick={() => speakText(msg.content, msg.role === "user" ? fromLang : toLang)}
                    className="absolute bottom-1.5 right-2 flex items-center justify-center w-5 h-5 rounded-full active:scale-90 transition-transform"
                    style={{
                      background: msg.role === "user" ? "rgba(100,150,255,0.2)" : "rgba(80,120,220,0.2)",
                      border: `1px solid ${BORDER}`,
                    }}
                    data-testid={`speak-user-${i}`}
                  >
                    <Volume2 className="w-2.5 h-2.5" style={{ color: "rgba(180,210,255,0.85)" }} />
                  </button>
                </div>
                {msg.role === "user" && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: PILL_ACT, border: `1px solid ${BORDER_ACT}` }}
                  >
                    <User className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-2.5 justify-start">
              <img src={planetOrbImg} className="w-7 h-7 object-contain flex-shrink-0 mt-0.5" alt="Juno" />
              <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(30,58,115,0.8)", border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: TEXT_DIM, animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input bar (no mic inside) ── */}
        <div className="px-5 pb-5 pt-2 flex-shrink-0">
          {/* Transcribing indicator */}
          {transcribing && (
            <p className="text-[10px] mb-1.5 text-center" style={{ color: TEXT_DIM }}>Transcribing voice...</p>
          )}
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-full"
            style={{ background: PILL_BG, border: `1px solid ${recording ? "rgba(220,100,100,0.5)" : BORDER}`, transition: "border-color 0.2s" }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder={recording ? "Listening..." : "Juno Translator"}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: TEXT, caretColor: TEXT }}
              data-testid="input-juno-chat-modal"
            />
            {/* Mic button inside input bar */}
            <button
              onClick={toggleRecording}
              className="relative w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 flex-shrink-0 overflow-hidden"
              style={{
                background: recording ? "rgba(59,100,220,0.9)" : transcribing ? "rgba(59,100,220,0.6)" : "rgba(59,100,220,0.45)",
                border: `1px solid ${recording ? BORDER_ACT : BORDER}`,
                transition: "all 0.2s ease",
              }}
              data-testid="button-juno-mic-modal"
            >
              {transcribing ? (
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              ) : recording ? (
                <X className="w-3.5 h-3.5 text-white" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-white" />
              )}
              {recording && (
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(59,100,220,0.25)" }} />
              )}
            </button>
            {/* Send button */}
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-40 flex-shrink-0"
              style={{ background: "rgba(59,100,220,0.9)", border: `1px solid ${BORDER_ACT}` }}
              data-testid="button-juno-send-modal"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Send className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
