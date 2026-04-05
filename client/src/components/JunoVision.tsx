import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, X, Loader2, Volume2, RotateCcw, Mic, MicOff, Share2, ChevronDown, ArrowLeftRight } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";

interface JunoVisionProps {
  isOpen: boolean;
  onClose: () => void;
  sourceLang: string;
  targetLang: string;
}

interface Insight {
  emoji: string;
  text: string;
}

interface FoodFacts {
  product?: string; brands?: string; categories?: string;
  nutriScore?: string; calories?: string; ingredients?: string;
  allergens?: string; quantity?: string;
}

interface BookFacts {
  title?: string; authors?: string; year?: string;
  publisher?: string; pages?: string; subjects?: string;
}

interface OsintData {
  wikiSummary?: string;
  wikiUrl?: string;
  foodFacts?: FoodFacts;
  bookFacts?: BookFacts;
  sources?: string[];
}

interface VisionResult {
  label: string;
  brand?: string;
  translation: string;
  sentence: string;
  answer?: string;
  insights?: Insight[];
  hasQuestion?: boolean;
  price?: string;
  englishDetails?: string;
  yoloHints?: Array<{ category: string; confidence: number }>;
  osint?: OsintData;
}

const SCAN_PHASES = [
  "Object scanning...",
  "Reading labels...",
  "Identifying brand...",
  "Querying databases...",
  "Translating...",
] as const;

const LANG_MAP: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
  pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", cs: "cs-CZ", ru: "ru-RU",
  ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", ar: "ar-SA", hi: "hi-IN",
  tr: "tr-TR", sv: "sv-SE", da: "da-DK", fi: "fi-FI", no: "nb-NO",
  el: "el-GR", he: "he-IL", th: "th-TH", vi: "vi-VN",
  id: "id-ID", ms: "ms-MY", tl: "fil-PH", sw: "sw-KE", bn: "bn-BD",
  ur: "ur-PK", ro: "ro-RO", hu: "hu-HU", uk: "uk-UA", fa: "fa-IR",
};

const WAKE_PHRASES = ["hey juno", "hey june", "hei juno", "a juno", "hey junior"];

export default function JunoVision({ isOpen, onClose, sourceLang, targetLang }: JunoVisionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [wakeWordListening, setWakeWordListening] = useState(false);
  const [liveDetections, setLiveDetections] = useState<Array<{ label: string; confidence: number }>>([]);
  const [yoloFrameCount, setYoloFrameCount] = useState(0);
  const [yoloFps, setYoloFps] = useState(0);
  const yoloIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const yoloScanningRef = useRef(false);
  const yoloTimestampsRef = useRef<number[]>([]); // rolling window for FPS calculation
  const [mode, setMode] = useState<"smart" | "fun">(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.visionMode);
    return saved === "fun" ? "fun" : "smart";
  });
  const [showEnglish, setShowEnglish] = useState(false);
  const [scanPhaseIdx, setScanPhaseIdx] = useState(0);

  // Local language selection — persisted per-session
  const [localSource, setLocalSource] = useState(() =>
    localStorage.getItem(STORAGE_KEYS.visionSourceLang) || sourceLang
  );
  const [localTarget, setLocalTarget] = useState(() =>
    localStorage.getItem(STORAGE_KEYS.visionTargetLang) || targetLang
  );
  const [langPicker, setLangPicker] = useState<"source" | "target" | null>(null);

  // Keep in sync with parent props when they change
  useEffect(() => { setLocalSource(sourceLang); }, [sourceLang]);
  useEffect(() => { setLocalTarget(targetLang); }, [targetLang]);

  // Persist vision preferences using isolated brand keys
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.visionMode, mode); }, [mode]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.visionSourceLang, localSource); }, [localSource]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.visionTargetLang, localTarget); }, [localTarget]);

  // Cycle scan phase label while processing
  useEffect(() => {
    if (!isProcessing) { setScanPhaseIdx(0); return; }
    setScanPhaseIdx(0);
    const intervals = [1200, 1400, 1600, 1400];
    let idx = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = () => {
      if (idx >= intervals.length) return;
      const t = setTimeout(() => {
        idx++;
        setScanPhaseIdx(idx);
        schedule();
      }, intervals[idx]);
      timers.push(t);
    };
    schedule();
    return () => timers.forEach(clearTimeout);
  }, [isProcessing]);

  const swapLangs = useCallback(() => {
    setLocalSource(prev => { const next = localTarget; setLocalTarget(prev); return next; });
    setResult(null);
  }, [localTarget]);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      setCameraReady(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err: any) {
      setError("Camera access denied. Please allow camera permissions.");
    }
  }, []);

  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!videoRef.current || !canvasRef.current) { resolve(null); return; }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setCapturedImageUrl(dataUrl);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
    });
  }, []);

  // Silent frame capture for continuous YOLO — does not update capturedImageUrl
  const captureFrameSilent = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!videoRef.current) { resolve(null); return; }
      const video = videoRef.current;
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.min(video.videoWidth || 320, 320);
      offscreen.height = Math.min(video.videoHeight || 240, 240);
      const ctx = offscreen.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
      offscreen.toBlob((blob) => resolve(blob), "image/jpeg", 0.6);
    });
  }, []);

  const sendToVision = useCallback(async (blob: Blob, question?: string) => {
    const formData = new FormData();
    formData.append("frame", blob, "frame.jpg");
    formData.append("sourceLang", localSource);
    formData.append("targetLang", localTarget);
    formData.append("mode", mode);
    if (question) {
      formData.append("userQuestion", question);
    }

    const res = await fetch("/api/juno-vision", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Session expired — please sign in again");
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Vision request failed");
    }
    return await res.json();
  }, [localSource, localTarget, mode]);

  const speakWithTTS = useCallback(async (text: string, lang: string) => {
    if (!text) return;
    setIsSpeaking(true);

    try {
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, lang, voice: "nova" }),
      });

      if (res.ok) {
        const audioBlob = await res.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        if (audioRef.current) {
          audioRef.current.pause();
          URL.revokeObjectURL(audioRef.current.src);
        }
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          speakFallback(text, lang);
        };
        await audio.play();
        return;
      }
    } catch {}

    speakFallback(text, lang);
  }, []);

  const speakFallback = useCallback((text: string, lang: string) => {
    if (!("speechSynthesis" in window)) { setIsSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANG_MAP[lang] || lang;
    utter.rate = 0.9;
    utter.pitch = 1.15;
    const voices = window.speechSynthesis.getVoices();
    const targetVoice = voices.find(v => v.lang.startsWith(lang) && v.name.toLowerCase().includes("male"))
      || voices.find(v => v.lang.startsWith(lang));
    if (targetVoice) utter.voice = targetVoice;
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, []);

  const processVoiceQuestion = useCallback(async (question: string) => {
    setIsProcessing(true);
    const blob = await captureFrame();
    if (!blob) { setIsProcessing(false); setError("Failed to capture frame"); return; }

    try {
      const data = await sendToVision(blob, question);
      setResult(data);
      setShowEnglish(false);
      const speakText = data.answer || data.sentence || data.translation;
      const speakLang = data.answer ? localSource : localTarget;
      await speakWithTTS(speakText, speakLang);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsProcessing(false);
      activeRef.current = false;
    }
  }, [captureFrame, sendToVision, localSource, localTarget, speakWithTTS]);

  const startQuestionListener = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = LANG_MAP[localSource] || localSource;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    setIsRecording(true);
    setVoiceText("");
    setError("");
    setResult(null);

    let finalTranscript = "";
    let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

    autoStopTimer = setTimeout(() => {
      try { recognition.stop(); } catch {}
    }, 8000);

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      setVoiceText(finalTranscript || interim);
    };

    recognition.onend = () => {
      if (autoStopTimer) clearTimeout(autoStopTimer);
      setIsRecording(false);
      recognitionRef.current = null;

      if (finalTranscript.trim()) {
        processVoiceQuestion(finalTranscript.trim());
      } else {
        activeRef.current = false;
      }
    };

    recognition.onerror = (event: any) => {
      if (autoStopTimer) clearTimeout(autoStopTimer);
      setIsRecording(false);
      recognitionRef.current = null;
      activeRef.current = false;
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError("Could not hear you. Please try again.");
      }
    };

    recognition.start();
  }, [localSource, processVoiceQuestion]);

  const clearWakeRestartTimer = useCallback(() => {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }, []);

  const startWakeWordListenerRef = useRef<() => void>(() => {});

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
          if (WAKE_PHRASES.some(phrase => text.includes(phrase))) {
            try { wake.abort(); } catch {}
            wakeRecognitionRef.current = null;
            setWakeWordListening(false);
            if (!activeRef.current) {
              activeRef.current = true;
              startQuestionListener();
            }
            return;
          }
        }
      }
    };

    wake.onend = () => {
      setWakeWordListening(false);
      if (!activeRef.current) {
        wakeRestartTimerRef.current = setTimeout(() => {
          if (!activeRef.current) {
            startWakeWordListenerRef.current();
          }
        }, 300);
      }
    };

    wake.onerror = (event: any) => {
      setWakeWordListening(false);
      if (event.error === "no-speech" || event.error === "aborted") {
        if (!activeRef.current) {
          wakeRestartTimerRef.current = setTimeout(() => {
            startWakeWordListenerRef.current();
          }, 500);
        }
      }
    };

    wakeRecognitionRef.current = wake;
    wake.start();
  }, [clearWakeRestartTimer, startQuestionListener]);

  useEffect(() => {
    startWakeWordListenerRef.current = startWakeWordListener;
  }, [startWakeWordListener]);

  const stopWakeWordListener = useCallback(() => {
    clearWakeRestartTimer();
    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort(); } catch {}
      wakeRecognitionRef.current = null;
    }
    setWakeWordListening(false);
  }, [clearWakeRestartTimer]);

  useEffect(() => {
    if (isOpen && cameraReady) {
      startWakeWordListener();
    }
    return () => {
      stopWakeWordListener();
    };
  }, [isOpen, cameraReady]);

  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
      setResult(null);
      setError("");
      setVoiceText("");
      setCapturedImageUrl(null);
      setYoloFrameCount(0);
      setYoloFps(0);
      yoloTimestampsRef.current = [];
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      activeRef.current = false;
    };
  }, [isOpen, facingMode, startCamera]);

  useEffect(() => {
    if (!isProcessing && !isRecording && !activeRef.current && isOpen && cameraReady) {
      const timer = setTimeout(() => {
        if (!activeRef.current && !wakeRecognitionRef.current) {
          startWakeWordListenerRef.current();
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isProcessing, isRecording, isOpen, cameraReady]);

  // Continuous YOLO scan — runs every 1s while camera is open, pauses during full vision processing
  useEffect(() => {
    if (!isOpen || !cameraReady) {
      if (yoloIntervalRef.current) {
        clearInterval(yoloIntervalRef.current);
        yoloIntervalRef.current = null;
      }
      setLiveDetections([]);
      return;
    }

    const runYoloScan = async () => {
      if (yoloScanningRef.current || isProcessing) return;
      yoloScanningRef.current = true;
      try {
        const blob = await captureFrameSilent();
        if (!blob) return;
        const formData = new FormData();
        formData.append("frame", blob, "frame.jpg");
        const res = await fetch("/api/v1/yolo-scan", {
          method: "POST",
          credentials: "include",
          body: formData,
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json();
          const dets: Array<{ label: string; confidence: number }> = (data.detections || [])
            .slice(0, 4)
            .map((d: any) => ({ label: d.label, confidence: d.confidence }));
          setLiveDetections(dets);

          // Track FPS using a rolling 5-scan window
          const now = performance.now();
          yoloTimestampsRef.current.push(now);
          if (yoloTimestampsRef.current.length > 5) yoloTimestampsRef.current.shift();
          if (yoloTimestampsRef.current.length >= 2) {
            const span = yoloTimestampsRef.current[yoloTimestampsRef.current.length - 1] - yoloTimestampsRef.current[0];
            const fps = ((yoloTimestampsRef.current.length - 1) / (span / 1000));
            setYoloFps(Math.round(fps * 10) / 10);
          }
          setYoloFrameCount(prev => prev + 1);
        }
      } catch {}
      finally { yoloScanningRef.current = false; }
    };

    yoloIntervalRef.current = setInterval(runYoloScan, 1000);
    return () => {
      if (yoloIntervalRef.current) {
        clearInterval(yoloIntervalRef.current);
        yoloIntervalRef.current = null;
      }
    };
  }, [isOpen, cameraReady, isProcessing, captureFrameSilent]);

  const captureAndIdentify = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || isProcessing) return;
    stopWakeWordListener();
    activeRef.current = true;
    setIsProcessing(true);
    setError("");
    setResult(null);
    setVoiceText("");

    const blob = await captureFrame();
    if (!blob) { setIsProcessing(false); activeRef.current = false; setError("Failed to capture frame"); return; }

    try {
      const data = await sendToVision(blob);
      setResult(data);
      setShowEnglish(false);
      await speakWithTTS(data.sentence || data.translation, localTarget);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsProcessing(false);
      activeRef.current = false;
    }
  }, [isProcessing, localTarget, captureFrame, sendToVision, speakWithTTS, stopWakeWordListener]);

  const startVoiceInput = useCallback(() => {
    stopWakeWordListener();
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }
    activeRef.current = true;
    startQuestionListener();
  }, [isRecording, stopWakeWordListener, startQuestionListener]);

  const shareImage = useCallback(async () => {
    if (!capturedImageUrl) return;

    try {
      const response = await fetch(capturedImageUrl);
      const blob = await response.blob();
      const file = new File([blob], "juno-vision.jpg", { type: "image/jpeg" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: result ? `${result.label} - ${result.translation}` : "Juno Vision",
          text: result?.sentence || "Captured with Juno Vision",
          files: [file],
        });
      } else {
        const link = document.createElement("a");
        link.href = capturedImageUrl;
        link.download = "juno-vision.jpg";
        link.click();
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError("Could not share image");
      }
    }
  }, [capturedImageUrl, result]);

  const flipCamera = useCallback(() => {
    setFacingMode(f => f === "environment" ? "user" : "environment");
  }, []);

  const handleClose = useCallback(() => {
    stopWakeWordListener();
    if (yoloIntervalRef.current) {
      clearInterval(yoloIntervalRef.current);
      yoloIntervalRef.current = null;
    }
    yoloScanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
    setResult(null);
    setError("");
    setCameraReady(false);
    setIsRecording(false);
    setVoiceText("");
    setCapturedImageUrl(null);
    setLiveDetections([]);
    setYoloFrameCount(0);
    setYoloFps(0);
    yoloTimestampsRef.current = [];
    activeRef.current = false;
    onClose();
  }, [onClose, stopWakeWordListener]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" data-testid="juno-vision-overlay">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="juno-vision-video"
        />

        <canvas ref={canvasRef} className="hidden" />

        {!cameraReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3" style={{ zIndex: 20 }}>
          <button
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
            data-testid="button-vision-close"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1 rounded-full bg-black/50 backdrop-blur flex items-center gap-1.5">
              <span className="text-xs text-blue-300 font-medium" data-testid="text-vision-label">Juno Vision</span>
              {wakeWordListening && !isRecording && !isProcessing && (
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              )}
            </div>
            <div className="flex items-center rounded-full bg-black/50 backdrop-blur overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.15)" }}>
              <button
                onClick={() => { setMode("smart"); setResult(null); }}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${mode === "smart" ? "bg-white text-black" : "text-white/70"}`}
                data-testid="button-mode-smart"
              >Smart</button>
              <button
                onClick={() => { setMode("fun"); setResult(null); }}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${mode === "fun" ? "bg-blue-500 text-white" : "text-white/70"}`}
                data-testid="button-mode-fun"
              >Fun</button>
            </div>
          </div>
          <button
            onClick={flipCamera}
            className="w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
            data-testid="button-vision-flip"
          >
            <RotateCcw className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Live YOLO detection strip — auto-updates every second */}
        {cameraReady && !isProcessing && (
          <div
            className="absolute left-0 right-0 flex flex-col items-center gap-1.5 px-3 pt-1.5"
            style={{ top: "56px", zIndex: 15 }}
            data-testid="yolo-live-strip"
          >
            {/* FPS + frame counter */}
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold"
                style={{ background: "rgba(0,0,0,0.45)", color: "#fff44f", backdropFilter: "blur(6px)", border: "1px solid rgba(255,244,79,0.3)" }}
                data-testid="yolo-fps-counter"
              >
                {yoloFrameCount === 0 ? "YOLO starting..." : `${yoloFps > 0 ? yoloFps : "~1"} fps · ${yoloFrameCount} frames`}
              </span>
            </div>
            {/* Detection tags */}
            {liveDetections.length > 0 ? (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {liveDetections.map((det, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{
                      background: "rgba(0,200,120,0.22)",
                      border: "1px solid rgba(0,200,120,0.5)",
                      color: "#00e896",
                      backdropFilter: "blur(6px)",
                    }}
                    data-testid={`yolo-detection-${i}`}
                  >
                    {det.label} <span style={{ opacity: 0.7 }}>{Math.round(det.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            ) : (
              <span
                className="px-2.5 py-0.5 rounded-full text-[10px]"
                style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.35)", backdropFilter: "blur(4px)" }}
                data-testid="yolo-scanning-label"
              >
                scanning...
              </span>
            )}
          </div>
        )}

        {/* Language picker dropdown (bottom-anchored, opens upward from bottom panel) */}
        {langPicker && (
          <>
            <div className="absolute inset-0" style={{ zIndex: 25 }} onClick={() => setLangPicker(null)} />
            <div
              className="absolute left-1/2 -translate-x-1/2 rounded-2xl overflow-hidden"
              style={{ bottom: "175px", zIndex: 30, width: "200px", background: "rgba(10,15,30,0.92)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
              data-testid="vision-lang-picker"
            >
              <div className="px-3 py-2 border-b border-white/10">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">
                  {langPicker === "source" ? "Speak in" : "Translate to"}
                </p>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {LANGUAGES.map(lang => {
                  const isActive = langPicker === "source" ? localSource === lang.code : localTarget === lang.code;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => {
                        if (langPicker === "source") setLocalSource(lang.code);
                        else setLocalTarget(lang.code);
                        setLangPicker(null);
                        setResult(null);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-white/5"
                      style={{ background: isActive ? "rgba(96,165,250,0.12)" : "transparent" }}
                      data-testid={`vision-lang-option-${lang.code}`}
                    >
                      <span className="text-sm" style={{ color: isActive ? "#93c5fd" : "rgba(255,255,255,0.8)" }}>{lang.name}</span>
                      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {cameraReady && (
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-52"
              style={{ overflow: "hidden", isolation: "isolate" }}
            >
              <div className="absolute top-0 left-0 w-9 h-9 border-t-[3px] border-l-[3px] border-blue-400" />
              <div className="absolute top-0 right-0 w-9 h-9 border-t-[3px] border-r-[3px] border-blue-400" />
              <div className="absolute bottom-0 left-0 w-9 h-9 border-b-[3px] border-l-[3px] border-blue-400" />
              <div className="absolute bottom-0 right-0 w-9 h-9 border-b-[3px] border-r-[3px] border-blue-400" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400/70" />
              <div
                className="juno-scan-line absolute left-2 right-2 h-[2px]"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.9), transparent)",
                  willChange: "top, opacity",
                }}
              />
            </div>

            {isProcessing && (
              <div className="absolute bottom-[30%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}>
                  <div className="flex gap-[3px] items-end h-3">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-[3px] rounded-full bg-blue-400"
                        style={{ height: "100%", animation: `pulse-bar 0.9s ease-in-out ${i * 0.18}s infinite alternate`, transformOrigin: "bottom" }} />
                    ))}
                  </div>
                  <span className="text-blue-200 text-[10px] font-medium tracking-wide" data-testid="text-scan-phase">
                    {SCAN_PHASES[Math.min(scanPhaseIdx, SCAN_PHASES.length - 1)]}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {isRecording && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-[85%]">
            <div className="px-4 py-2 rounded-full bg-red-500/80 backdrop-blur flex items-center gap-2 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-white" />
              <span className="text-white text-xs font-medium truncate">
                {voiceText || "Listening..."}
              </span>
            </div>
          </div>
        )}

        {voiceText && !isRecording && isProcessing && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-[80%]">
            <div className="px-4 py-2 rounded-full bg-blue-500/60 backdrop-blur">
              <span className="text-white text-xs">"{voiceText}"</span>
            </div>
          </div>
        )}

        {isSpeaking && (
          <div className="absolute bottom-4 right-4 z-10">
            <div className="w-8 h-8 rounded-full bg-blue-500/60 backdrop-blur flex items-center justify-center">
              <Volume2 className="w-4 h-4 text-white animate-pulse" />
            </div>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-t from-black via-black/95 to-transparent px-4 pb-6 pt-4" style={{ minHeight: result ? "300px" : "160px" }}>
        {error && (
          <div className="text-center mb-3">
            <p className="text-red-400 text-sm" data-testid="text-vision-error">{error}</p>
          </div>
        )}

        {result && (
          <div className="mb-4 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="vision-result">

            {/* Item name row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <span className="text-white/40 text-[9px] uppercase tracking-widest">
                  {result.brand ? "Brand" : "English"}
                </span>
                <div className="text-white font-bold text-lg leading-tight" data-testid="text-vision-detected">
                  {result.brand || result.label}
                </div>
                {result.brand && result.label !== result.brand && (
                  <div className="text-white/50 text-xs mt-0.5 leading-snug">{result.label}</div>
                )}
              </div>
              <div className="w-px self-stretch bg-white/10 mx-1" />
              <div className="flex-1 text-right">
                <span className="text-blue-400/60 text-[9px] uppercase tracking-widest">{localTarget.toUpperCase()}</span>
                <div className="text-blue-300 font-bold text-lg leading-tight" data-testid="text-vision-translation">{result.translation}</div>
              </div>
              <div className="flex items-center gap-1 ml-1">
                {capturedImageUrl && (
                  <button
                    onClick={shareImage}
                    className="p-1.5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
                    data-testid="button-vision-share"
                  >
                    <Share2 className="w-4 h-4 text-blue-400" />
                  </button>
                )}
                <button
                  onClick={() => speakWithTTS(result.answer || result.sentence || result.translation, result.answer ? localSource : localTarget)}
                  className="p-1.5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
                  data-testid="button-vision-speak"
                >
                  <Volume2 className={`w-4 h-4 ${isSpeaking ? "text-blue-300 animate-pulse" : "text-blue-400"}`} />
                </button>
              </div>
            </div>

            {/* Price row */}
            {result.price && result.price !== "N/A" && (
              <div className="flex items-center gap-1.5" data-testid="text-vision-price">
                <span className="text-lg">💰</span>
                <span className="text-green-300 font-semibold text-sm">{result.price}</span>
                <span className="text-white/35 text-[10px]">approx. retail price</span>
              </div>
            )}

            {/* Answer (if voice question) */}
            {result.answer && (
              <p className="text-green-300/90 text-sm" data-testid="text-vision-answer">{result.answer}</p>
            )}

            {/* EN / Target language toggle */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                <button
                  onClick={() => setShowEnglish(false)}
                  className={`px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${!showEnglish ? "bg-blue-500 text-white" : "text-white/50"}`}
                  data-testid="button-lang-target"
                >{localTarget.toUpperCase()}</button>
                <button
                  onClick={() => setShowEnglish(true)}
                  className={`px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${showEnglish ? "bg-white text-black" : "text-white/50"}`}
                  data-testid="button-lang-english"
                >EN</button>
              </div>
            </div>

            {/* Detail sentence */}
            <p className="text-white/70 text-xs leading-relaxed" data-testid="text-vision-sentence">
              {showEnglish ? (result.englishDetails || result.label) : (result.sentence)}
            </p>

            {/* Insight chips */}
            {result.insights && result.insights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5" data-testid="vision-insights">
                {result.insights.map((ins, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
                    data-testid={`insight-${i}`}
                  >
                    <span>{ins.emoji}</span>
                    <span className="text-white/80">{ins.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* OSINT panel — open-source intelligence enrichment */}
            {result.osint && (result.osint.wikiSummary || result.osint.foodFacts || result.osint.bookFacts) && (
              <div className="mt-1 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
                data-testid="vision-osint-panel">

                {/* Wikipedia summary */}
                {result.osint.wikiSummary && (
                  <div className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-blue-300/60">Wikipedia</span>
                    </div>
                    <p className="text-white/60 text-[11px] leading-relaxed line-clamp-4" data-testid="text-osint-wiki">
                      {result.osint.wikiSummary}
                    </p>
                  </div>
                )}

                {/* Food facts */}
                {result.osint.foodFacts && (result.osint.foodFacts.calories || result.osint.foodFacts.nutriScore || result.osint.foodFacts.allergens) && (
                  <div className="px-3 py-2.5 border-t border-white/5" data-testid="vision-food-facts">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-green-300/60">Nutrition</span>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {result.osint.foodFacts.calories && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)" }}>
                          <span className="text-green-300 text-[10px] font-medium" data-testid="text-food-calories">{result.osint.foodFacts.calories}</span>
                        </div>
                      )}
                      {result.osint.foodFacts.nutriScore && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)" }}>
                          <span className="text-green-300 text-[10px] font-medium">Nutri-Score {result.osint.foodFacts.nutriScore}</span>
                        </div>
                      )}
                      {result.osint.foodFacts.allergens && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)" }}>
                          <span className="text-yellow-300 text-[10px]">Allergens: {result.osint.foodFacts.allergens}</span>
                        </div>
                      )}
                    </div>
                    {result.osint.foodFacts.ingredients && (
                      <p className="text-white/40 text-[10px] mt-1.5 leading-relaxed line-clamp-2" data-testid="text-food-ingredients">
                        {result.osint.foodFacts.ingredients}
                      </p>
                    )}
                  </div>
                )}

                {/* Book facts */}
                {result.osint.bookFacts && result.osint.bookFacts.authors && (
                  <div className="px-3 py-2.5 border-t border-white/5" data-testid="vision-book-facts">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-purple-300/60">Book</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {result.osint.bookFacts.authors && (
                        <span className="text-white/55 text-[10px]">by {result.osint.bookFacts.authors}</span>
                      )}
                      {result.osint.bookFacts.year && (
                        <span className="text-white/40 text-[10px]">{result.osint.bookFacts.year}</span>
                      )}
                      {result.osint.bookFacts.pages && (
                        <span className="text-white/40 text-[10px]">{result.osint.bookFacts.pages} pages</span>
                      )}
                    </div>
                    {result.osint.bookFacts.subjects && (
                      <p className="text-white/35 text-[10px] mt-0.5">{result.osint.bookFacts.subjects}</p>
                    )}
                  </div>
                )}

                {/* Sources footer */}
                {result.osint.sources && result.osint.sources.length > 0 && (
                  <div className="px-3 py-1.5 border-t border-white/5 flex items-center gap-1.5">
                    <span className="text-[9px] text-white/25">Sources:</span>
                    <span className="text-[9px] text-white/30" data-testid="text-osint-sources">{result.osint.sources.join(", ")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Language bar — moved here from top so the viewfinder stays clean */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => setLangPicker(langPicker === "source" ? null : "source")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur transition-all"
            style={{ background: langPicker === "source" ? "rgba(96,165,250,0.25)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
            data-testid="button-vision-source-lang"
          >
            <span className="text-xs font-semibold text-white/90">
              {LANGUAGES.find(l => l.code === localSource)?.name ?? localSource.toUpperCase()}
            </span>
            <ChevronDown className="w-3 h-3 text-white/50" />
          </button>

          <button
            onClick={swapLangs}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-transform active:scale-90"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
            data-testid="button-vision-swap-lang"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-white/70" />
          </button>

          <button
            onClick={() => setLangPicker(langPicker === "target" ? null : "target")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur transition-all"
            style={{ background: langPicker === "target" ? "rgba(96,165,250,0.25)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
            data-testid="button-vision-target-lang"
          >
            <span className="text-xs font-semibold text-blue-300">
              {LANGUAGES.find(l => l.code === localTarget)?.name ?? localTarget.toUpperCase()}
            </span>
            <ChevronDown className="w-3 h-3 text-white/50" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            onClick={startVoiceInput}
            disabled={isProcessing || !cameraReady}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? "bg-red-500 border-2 border-red-300/50 animate-pulse"
                : "bg-white/10 border-2 border-white/20 active:scale-95"
            }`}
            data-testid="button-vision-mic"
          >
            {isRecording ? (
              <MicOff className="w-5 h-5 text-white" />
            ) : (
              <Mic className="w-5 h-5 text-white" />
            )}
          </button>

          <button
            onClick={captureAndIdentify}
            disabled={isProcessing || !cameraReady}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
              isProcessing
                ? "bg-blue-500/30 border-2 border-blue-400/50"
                : "bg-gradient-to-br from-blue-500 to-blue-600 border-2 border-blue-300/30 active:scale-95"
            }`}
            data-testid="button-vision-capture"
          >
            {isProcessing ? (
              <Loader2 className="w-7 h-7 text-white animate-spin" />
            ) : (
              <Camera className="w-7 h-7 text-white" />
            )}
          </button>

          {capturedImageUrl && result ? (
            <button
              onClick={shareImage}
              disabled={isProcessing}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 border-2 border-white/20 active:scale-95 transition-all"
              data-testid="button-vision-share-bottom"
            >
              <Share2 className="w-5 h-5 text-white" />
            </button>
          ) : (
            <div className="w-12 h-12" />
          )}
        </div>
        <p className="text-center text-white/30 text-[10px] mt-2">
          {isRecording
            ? "Speak your question..."
            : wakeWordListening
              ? "Say \"Hey Juno\" to ask about what you see"
              : "Tap camera to identify \u00B7 Tap mic to ask"}
        </p>
      </div>
    </div>
  );
}
