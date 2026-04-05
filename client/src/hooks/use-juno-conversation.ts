import { useCallback, useEffect, useRef, useState } from "react";
import { buildAudioProcessor, isSpeechActive, AUDIO_CONSTRAINTS } from "@/lib/audio-processor";
import { junoSpeak, junoStop, junoUnlock } from "@/lib/audio/junoAudioEngine";

export type JunoListeningState = "listening" | "processing" | "responding";

export interface JunoConversationState {
  showOverlay: boolean;
  listeningState: JunoListeningState;
  currentMessage: string | null;
  isSpeaking: boolean;
}

export interface JunoConversationHandlers {
  handleMicTap: () => Promise<void>;
  handleTextSubmit: (text: string) => void;
  closeOverlay: () => void;
}

export interface JunoSessionConfig {
  aiEndpoint?: string;
  requestTimeoutMs?: number;
  historyLimit?: number;
  historyTtlMs?: number;
}

const DEFAULT_SESSION_CONFIG: Required<JunoSessionConfig> = {
  aiEndpoint: "/api/v1/ai-translate",
  requestTimeoutMs: 20_000,
  historyLimit: 20,
  historyTtlMs: 4 * 60 * 60 * 1000,
};

const SPEECH_LANG_MAP: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
  pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", cs: "cs-CZ", ru: "ru-RU",
  ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", ar: "ar-SA", hi: "hi-IN",
  tr: "tr-TR", sv: "sv-SE", da: "da-DK", fi: "fi-FI", no: "nb-NO",
  el: "el-GR", he: "he-IL", th: "th-TH", vi: "vi-VN",
};

const LANG_NAMES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", dutch: "nl", polish: "pl", russian: "ru",
  japanese: "ja", chinese: "zh", korean: "ko", arabic: "ar", hindi: "hi",
  turkish: "tr", swedish: "sv", danish: "da", finnish: "fi", greek: "el",
  hebrew: "he", thai: "th", vietnamese: "vi",
};

const CONV_HISTORY_KEY = "juno_conv_history";
const CONV_HISTORY_TS_KEY = "juno_conv_history_ts";

function loadHistory(ttlMs: number): { role: string; content: string }[] {
  try {
    const ts = parseInt(localStorage.getItem(CONV_HISTORY_TS_KEY) || "0", 10);
    if (Date.now() - ts > ttlMs) {
      localStorage.removeItem(CONV_HISTORY_KEY);
      localStorage.removeItem(CONV_HISTORY_TS_KEY);
      return [];
    }
    return JSON.parse(localStorage.getItem(CONV_HISTORY_KEY) || "[]");
  } catch { return []; }
}

async function persistSession(
  messages: { role: string; content: string }[],
  sessionType: "chat" | "voice",
  durationSeconds: number
): Promise<void> {
  if (!messages.length) return;
  try {
    await fetch("/api/v1/juno/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages, sessionType, durationSeconds }),
    });
  } catch {}
}

export function useJunoConversation(
  userLang?: string,
  config?: JunoSessionConfig,
): [JunoConversationState, JunoConversationHandlers] {
  const cfg: Required<JunoSessionConfig> = { ...DEFAULT_SESSION_CONFIG, ...config };

  // ── State ─────────────────────────────────────────────────────────────────
  const [showOverlay, setShowOverlay] = useState(false);
  const [listeningState, setListeningState] = useState<JunoListeningState>("listening");
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const recognitionRef = useRef<any>(null);
  const audioProcessorDisposeRef = useRef<(() => void) | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const convActiveRef = useRef(false);
  const userLangRef = useRef(userLang || "en");
  const sessionStartRef = useRef<number>(0);
  const sessionTypeRef = useRef<"chat" | "voice">("chat");
  const aiControllerRef = useRef<AbortController | null>(null);
  const convHistoryRef = useRef<{ role: string; content: string }[]>(loadHistory(cfg.historyTtlMs));

  useEffect(() => {
    if (userLang) userLangRef.current = userLang;
  }, [userLang]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const saveHistory = (history: { role: string; content: string }[]) => {
    convHistoryRef.current = history;
    try {
      localStorage.setItem(CONV_HISTORY_KEY, JSON.stringify(history));
      if (history.length > 0) {
        localStorage.setItem(CONV_HISTORY_TS_KEY, String(Date.now()));
      } else {
        localStorage.removeItem(CONV_HISTORY_TS_KEY);
      }
    } catch {}
  };

  const detectLangSwitch = (text: string) => {
    const match = text.toLowerCase().match(
      /(?:speak|respond|reply|answer|talk|write|use|switch to|change to|in)\s+([a-z]+)(?:\s+(?:language|please|now|from now))?/i
    );
    if (match) {
      const detected = LANG_NAMES[match[1].toLowerCase()];
      if (detected) userLangRef.current = detected;
    }
  };

  // ── speak: thin UI wrapper around the audio engine ────────────────────────
  // Sets React state for the overlay animation, then delegates all playback
  // to junoSpeak() from the dedicated audio engine module.
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!convActiveRef.current) return;
    setCurrentMessage(text);
    setListeningState("responding");
    setIsSpeaking(true);
    await junoSpeak(text, userLangRef.current);
    setIsSpeaking(false);
  }, []);

  // ── Close / teardown ──────────────────────────────────────────────────────
  const closeOverlay = useCallback(() => {
    convActiveRef.current = false;
    try { aiControllerRef.current?.abort(); } catch {}
    aiControllerRef.current = null;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    try { audioProcessorDisposeRef.current?.(); } catch {}
    audioProcessorDisposeRef.current = null;
    junoStop();
    setIsSpeaking(false);
    setCurrentMessage(null);
    setShowOverlay(false);
    setListeningState("listening");

    const msgs = convHistoryRef.current;
    const duration = sessionStartRef.current
      ? Math.round((Date.now() - sessionStartRef.current) / 1000)
      : 0;
    const type = sessionTypeRef.current;
    if (msgs.length >= 2) {
      persistSession(msgs, type, duration);
      saveHistory([]);
    }
    sessionStartRef.current = 0;
  }, []);

  // ── Core voice loop ───────────────────────────────────────────────────────
  const runConversation = useCallback(async () => {

    const listen = (): Promise<string | null> => new Promise((resolve) => {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR || !convActiveRef.current) { resolve(null); return; }
      setListeningState("listening");
      setCurrentMessage(null);
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = SPEECH_LANG_MAP[userLangRef.current] || "en-US";
      let got = false;
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            const t = e.results[i][0].transcript.trim();
            if (t) { got = true; rec.stop(); resolve(t); }
          }
        }
      };
      rec.onerror = () => resolve(null);
      rec.onend = () => { if (!got) resolve(null); };
      recognitionRef.current = rec;
      try { rec.start(); } catch { resolve(null); }
    });

    const askJuno = async (text: string): Promise<string | null> => {
      if (!convActiveRef.current) return null;
      setListeningState("processing");
      setCurrentMessage(null);
      detectLangSwitch(text);
      try {
        const controller = new AbortController();
        aiControllerRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
        const res = await fetch(cfg.aiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            text: text.trim(),
            sourceLang: userLangRef.current,
            targetLang: userLangRef.current,
            conversationHistory: convHistoryRef.current,
            voiceMode: true,
          }),
        });
        clearTimeout(timeout);
        aiControllerRef.current = null;
        if (!res.ok || !convActiveRef.current) return null;
        const data = await res.json();
        const reply = (data.translatedText || data.message || "").trim();
        if (reply) {
          saveHistory([
            ...convHistoryRef.current,
            { role: "user", content: text.trim() },
            { role: "assistant", content: reply },
          ].slice(-cfg.historyLimit));
          return reply;
        }
        return null;
      } catch { return null; }
    };

    // Greeting
    try {
      const greetRes = await fetch(cfg.aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: "__juno_open__",
          sourceLang: userLangRef.current,
          targetLang: userLangRef.current,
          conversationHistory: [],
          voiceMode: false,
        }),
      });
      if (greetRes.ok && convActiveRef.current) {
        const gd = await greetRes.json();
        const greetMsg = (gd.translatedText || gd.message || "").trim();
        if (greetMsg && convActiveRef.current) await speak(greetMsg);
      }
    } catch {}

    // Conversation loop
    while (convActiveRef.current) {
      const userText = await listen();
      if (!convActiveRef.current) break;
      if (!userText) continue;
      // Show the user's own transcribed speech as a caption before Juno replies
      setCurrentMessage(userText);
      const reply = await askJuno(userText);
      if (!convActiveRef.current) break;
      if (!reply) continue;
      await speak(reply);
    }

    if (convActiveRef.current) closeOverlay();
  }, [closeOverlay, speak]);

  // ── VAD setup ─────────────────────────────────────────────────────────────
  const startVAD = async () => {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });
      const processor = await buildAudioProcessor(rawStream);
      audioProcessorDisposeRef.current = processor.dispose;
      const analyser = processor.analyserNode;
      const tick = () => {
        if (!audioProcessorDisposeRef.current) return;
        setIsSpeaking(isSpeechActive(analyser));
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {}
  };

  // ── Public handlers ───────────────────────────────────────────────────────

  const handleMicTap = useCallback(async () => {
    if (showOverlay) { closeOverlay(); return; }
    await junoUnlock();
    setCurrentMessage(null);
    setListeningState("listening");
    setShowOverlay(true);
    convActiveRef.current = true;
    sessionTypeRef.current = "voice";
    sessionStartRef.current = Date.now();
    await startVAD();
    runConversation();
  }, [showOverlay, closeOverlay, runConversation]);

  const handleTextSubmit = useCallback((text: string) => {
    if (!text.trim()) return;
    junoUnlock();
    setListeningState("processing");
    setShowOverlay(true);
    convActiveRef.current = true;
    sessionTypeRef.current = "chat";
    if (!sessionStartRef.current) sessionStartRef.current = Date.now();

    (async () => {
      detectLangSwitch(text);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const res = await fetch("/api/v1/ai-translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            text: text.trim(),
            sourceLang: userLangRef.current,
            targetLang: userLangRef.current,
            conversationHistory: convHistoryRef.current,
            voiceMode: false,
          }),
        });
        clearTimeout(timeout);
        let data: any = {};
        try { data = await res.json(); } catch {}
        if (res.ok) {
          const reply = (data.translatedText || data.message || "").trim();
          if (reply) {
            saveHistory([
              ...convHistoryRef.current,
              { role: "user", content: text.trim() },
              { role: "assistant", content: reply },
            ].slice(-20));
            await speak(reply);
          }
        }
      } catch (e) {
        console.error("[Juno] handleTextSubmit error:", e);
      }
      closeOverlay();
    })();
  }, [closeOverlay, speak]);

  return [
    { showOverlay, listeningState, currentMessage, isSpeaking },
    { handleMicTap, handleTextSubmit, closeOverlay },
  ];
}
