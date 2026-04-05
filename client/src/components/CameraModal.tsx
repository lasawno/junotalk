import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { X, SwitchCamera, Circle, Square, Zap, ZapOff, Languages, ChevronDown, Send, RotateCcw, Play, Captions, Palette, Type, Scissors, Check, Trash2, Download, Share2, Loader2, CheckCircle, Minus, Plus } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";

type LiveCaption = {
  id: string;
  original: string;
  translated: string;
  isTranslating: boolean;
  timestamp: number;
};

export type VideoCaptionSegment = { start: number; end: number; text: string };

interface CameraModalProps {
  onCapture: (file: File, captions?: VideoCaptionSegment[]) => void;
  onClose: () => void;
}

const supportsMediaRecorder = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";

type CameraFilter = {
  id: string;
  label: string;
  css: string;
  canvas: string;
};

const FILTERS: CameraFilter[] = [
  { id: "none", label: "Normal", css: "none", canvas: "none" },
  { id: "warm", label: "Warm", css: "sepia(0.25) saturate(1.3) brightness(1.05)", canvas: "sepia(0.25) saturate(1.3) brightness(1.05)" },
  { id: "cool", label: "Cool", css: "saturate(0.9) hue-rotate(15deg) brightness(1.05)", canvas: "saturate(0.9) hue-rotate(15deg) brightness(1.05)" },
  { id: "bw", label: "B&W", css: "grayscale(1)", canvas: "grayscale(1)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.7)", canvas: "sepia(0.7)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.8) contrast(1.1)", canvas: "saturate(1.8) contrast(1.1)" },
  { id: "fade", label: "Fade", css: "contrast(0.85) brightness(1.1) saturate(0.7)", canvas: "contrast(0.85) brightness(1.1) saturate(0.7)" },
  { id: "drama", label: "Drama", css: "contrast(1.3) saturate(0.8) brightness(0.95)", canvas: "contrast(1.3) saturate(0.8) brightness(0.95)" },
];

const TEXT_COLORS = [
  "#ffffff", "#000000", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4",
  "#fff44f", "#ff6b6b", "#a855f7", "#14b8a6", "#f43f5e",
];

const TEXT_SIZES = [16, 20, 24, 30, 36, 44];

const SPEECH_LANG_MAP: Record<string, string> = Object.fromEntries(
  "en:en-US,es:es-ES,fr:fr-FR,de:de-DE,it:it-IT,pt:pt-BR,ja:ja-JP,ko:ko-KR,zh:zh-CN,ar:ar-SA,hi:hi-IN,ru:ru-RU,nl:nl-NL,pl:pl-PL,sv:sv-SE,tr:tr-TR,vi:vi-VN,th:th-TH,uk:uk-UA,cs:cs-CZ,ro:ro-RO,hu:hu-HU,el:el-GR,he:he-IL,id:id-ID,ms:ms-MY,fi:fi-FI,da:da-DK,no:nb-NO,sk:sk\x2DSK,bg:bg-BG,hr:hr-HR"
    .split(",")
    .map((p) => { const [k, v] = p.split(":"); return [k, v]; })
);

export default function CameraModal({ onCapture, onClose }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoFallbackRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const filterAnimFrameRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const MAX_RECORDING_SECONDS = 180;
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const [flashSupported, setFlashSupported] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);

  const [activeFilter, setActiveFilter] = useState<string>("none");
  const activeFilterRef = useRef("none");
  const [showFilters, setShowFilters] = useState(false);

  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const prevPreviewUrlRef = useRef<string | null>(null);

  const [showPreviewCaptions, setShowPreviewCaptions] = useState(true);
  const [previewFilter, setPreviewFilter] = useState<string>("none");
  const [showPreviewFilters, setShowPreviewFilters] = useState(false);
  const [activeEditTool, setActiveEditTool] = useState<string | null>(null);
  const [textOverlays, setTextOverlays] = useState<Array<{ id: string; text: string; x: number; y: number; color: string; size: number }>>([]);
  const [newTextInput, setNewTextInput] = useState("");
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [textInputMode, setTextInputMode] = useState(false);
  const [textColor, setTextColor] = useState("#ffffff");
  const [textSize, setTextSize] = useState(24);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(100);
  const [isHD, setIsHD] = useState(false);
  const [savedCaptions, setSavedCaptions] = useState<LiveCaption[]>([]);
  const [burnStatus, setBurnStatus] = useState<"idle" | "burning" | "done" | "error">("idle");
  const [burnedVideoUrl, setBurnedVideoUrl] = useState<string | null>(null);
  const [burnedVideoFile, setBurnedVideoFile] = useState<File | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  const [liveCaptions, setLiveCaptions] = useState<LiveCaption[]>([]);
  const [interimText, setInterimText] = useState("");
  const [translateTo, setTranslateTo] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "es";
    } catch { return "es"; }
  });
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [detectedSourceLang, setDetectedSourceLang] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const translateToRef = useRef(translateTo);
  const captionContainerRef = useRef<HTMLDivElement>(null);
  const langDetectedRef = useRef(false);

  const currentFilter = FILTERS.find(f => f.id === activeFilter) || FILTERS[0];

  useEffect(() => {
    activeFilterRef.current = activeFilter;
  }, [activeFilter]);

  useEffect(() => {
    translateToRef.current = translateTo;
  }, [translateTo]);

  useEffect(() => {
    if (captionContainerRef.current) {
      captionContainerRef.current.scrollTop = captionContainerRef.current.scrollHeight;
    }
  }, [liveCaptions, interimText]);

  const translateText = useCallback(async (text: string, targetLang: string): Promise<string> => {
    try {
      const response = await fetch("/api/v1/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, targetLang }),
      });
      if (!response.ok) return text;
      const data = await response.json();
      return data.translatedText || text;
    } catch {
      return text;
    }
  }, []);

  const detectSourceLanguage = useCallback(async (text: string) => {
    if (langDetectedRef.current) return;
    try {
      const response = await fetch("/api/detect-language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.language && !langDetectedRef.current) {
        langDetectedRef.current = true;
        setDetectedSourceLang(data.language);
        const speechLang = SPEECH_LANG_MAP[data.language];
        if (speechLang && recognitionRef.current) {
          try {
            recognitionRef.current.lang = speechLang;
            recognitionRef.current.stop();
          } catch {}
        }
      }
    } catch {}
  }, []);

  const addLiveCaption = useCallback((original: string) => {
    const captionId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const targetLang = translateToRef.current;
    const needsTranslation = targetLang && targetLang !== "en";

    setLiveCaptions(prev => [...prev.slice(-19), {
      id: captionId,
      original,
      translated: "",
      isTranslating: !!needsTranslation,
      timestamp: Date.now(),
    }]);

    if (needsTranslation) {
      translateText(original, targetLang).then(translated => {
        setLiveCaptions(prev => prev.map(c =>
          c.id === captionId ? { ...c, translated, isTranslating: false } : c
        ));
      }).catch(() => {
        setLiveCaptions(prev => prev.map(c =>
          c.id === captionId ? { ...c, isTranslating: false } : c
        ));
      });
    }
  }, [translateText]);

  const startSpeechRecognition = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const browserLangs = navigator.languages?.length ? navigator.languages : [navigator.language || "en-US"];
    const primaryLang = browserLangs[0];
    recognition.lang = primaryLang;

    let firstFinalDone = false;

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) setInterimText(interim);
      if (finalText.trim()) {
        setInterimText("");
        addLiveCaption(finalText.trim());

        if (!firstFinalDone) {
          firstFinalDone = true;
          detectSourceLanguage(finalText.trim());
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "aborted") return;
    };

    recognition.onend = () => {
      if (recognitionRef.current && mountedRef.current) {
        try {
          recognition.start();
        } catch {
          setTimeout(() => {
            if (recognitionRef.current && mountedRef.current) {
              try { recognition.start(); } catch {}
            }
          }, 500);
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error("[CameraModal Speech] Failed to start:", e);
    }
  }, [addLiveCaption]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setInterimText("");
  }, []);

  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopFilterLoop = useCallback(() => {
    if (filterAnimFrameRef.current !== null) {
      cancelAnimationFrame(filterAnimFrameRef.current);
      filterAnimFrameRef.current = null;
    }
  }, []);

  const stopRecordingStreams = useCallback(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(t => t.stop());
      canvasStreamRef.current = null;
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopFilterLoop();
    stopRecordingStreams();
    stopSpeechRecognition();
    setRecording(false);
    setRecordingTime(0);
    setLiveCaptions([]);
    setInterimText("");
    setDetectedSourceLang(null);
    langDetectedRef.current = false;
  }, [stopSpeechRecognition, stopFilterLoop, stopRecordingStreams]);

  useEffect(() => {
    if (prevPreviewUrlRef.current && prevPreviewUrlRef.current !== previewUrl) {
      URL.revokeObjectURL(prevPreviewUrlRef.current);
    }
    prevPreviewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const cleanupPreview = useCallback(() => {
    if (prevPreviewUrlRef.current) {
      URL.revokeObjectURL(prevPreviewUrlRef.current);
      prevPreviewUrlRef.current = null;
    }
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewPlaying(false);
  }, []);

  const checkFlashSupport = useCallback(async (stream: MediaStream) => {
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) { setFlashSupported(false); return; }
      const capabilities = videoTrack.getCapabilities?.();
      if (capabilities && "torch" in capabilities && (capabilities as any).torch) {
        setFlashSupported(true);
      } else {
        setFlashSupported(false);
      }
    } catch {
      setFlashSupported(false);
    }
  }, []);

  const startCamera = useCallback(async (facing: "user" | "environment") => {
    stopAllTracks();
    setCameraError(null);
    setFlashOn(false);
    try {
      const hdOn = isHD;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: hdOn ? 1920 : 1280 },
          height: { ideal: hdOn ? 1080 : 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      checkFlashSupport(stream);
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        setHasMultipleCameras(videoDevices.length > 1);
      } catch {}
    } catch (err: any) {
      setCameraError(err?.message || "Could not access camera");
    }
  }, [stopAllTracks, checkFlashSupport, isHD]);

  const toggleFlash = useCallback(async () => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    try {
      const newFlash = !flashOn;
      await videoTrack.applyConstraints({ advanced: [{ torch: newFlash } as any] });
      setFlashOn(newFlash);
    } catch {}
  }, [flashOn]);

  useEffect(() => {
    mountedRef.current = true;
    startCamera(facingMode);
    return () => {
      mountedRef.current = false;
      cleanupRecording();
      cleanupPreview();
      stopAllTracks();
      stopFilterLoop();
    };
  }, []);

  useEffect(() => {
    if (!previewUrl && !recording) {
      startCamera(facingMode);
    }
  }, [isHD]);

  const handleClose = useCallback(() => {
    cleanupRecording();
    cleanupPreview();
    stopAllTracks();
    stopFilterLoop();
    onClose();
  }, [cleanupRecording, cleanupPreview, stopAllTracks, stopFilterLoop, onClose]);

  const switchCamera = useCallback(() => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    startCamera(next);
  }, [facingMode, startCamera]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    if (currentFilter.canvas !== "none") {
      ctx.filter = currentFilter.canvas;
    }
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    ctx.restore();

    if (textOverlays.length > 0) {
      textOverlays.forEach(overlay => {
        const px = (overlay.x / 100) * canvas.width;
        const py = (overlay.y / 100) * canvas.height;
        const scaledSize = Math.round(overlay.size * (canvas.width / 400));
        ctx.save();
        ctx.font = `bold ${scaledSize}px sans-serif`;
        ctx.fillStyle = overlay.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.fillText(overlay.text, px, py);
        ctx.restore();
      });
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      }
    }, "image/jpeg", isHD ? 0.95 : 0.85);
  }, [facingMode, onCapture, currentFilter, textOverlays]);

  const handleVideoFallback = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      stopAllTracks();
      setPreviewFile(file);
      setPreviewUrl(url);
    }
    e.target.value = "";
  }, [stopAllTracks]);

  const isIOS = useCallback(() => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }, []);

  const startFilteredRecording = useCallback(async (audioStream: MediaStream | null): Promise<MediaStream | null> => {
    if (isIOS()) return null;

    const video = videoRef.current;
    const fCanvas = filterCanvasRef.current;
    if (!video || !fCanvas) return null;

    if (!video.videoWidth || !video.videoHeight) {
      await new Promise<void>((resolve) => {
        if (video.videoWidth && video.videoHeight) { resolve(); return; }
        const onMeta = () => { video.removeEventListener("loadedmetadata", onMeta); resolve(); };
        video.addEventListener("loadedmetadata", onMeta);
        setTimeout(() => { video.removeEventListener("loadedmetadata", onMeta); resolve(); }, 2000);
      });
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    fCanvas.width = vw;
    fCanvas.height = vh;
    const ctx = fCanvas.getContext("2d");
    if (!ctx) return null;

    const drawFrame = () => {
      if (!mountedRef.current) return;
      ctx.save();
      const filterVal = FILTERS.find(f => f.id === activeFilterRef.current)?.canvas || "none";
      if (filterVal !== "none") {
        ctx.filter = filterVal;
      } else {
        ctx.filter = "none";
      }
      if (facingMode === "user") {
        ctx.translate(fCanvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, fCanvas.width, fCanvas.height);
      ctx.restore();
      filterAnimFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    try {
      const canvasStream = fCanvas.captureStream(30);
      canvasStreamRef.current = canvasStream;

      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach(t => combinedStream.addTrack(t));
      if (audioStream) {
        audioStream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      }
      return combinedStream;
    } catch {
      return null;
    }
  }, [facingMode, isIOS]);

  const startRecording = useCallback(async () => {
    if (!streamRef.current || !supportsMediaRecorder) return;

    let audioStream: MediaStream | null = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = audioStream;
    } catch {}

    chunksRef.current = [];
    const mimeTypes = ["video/mp4", "video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    let selectedMime = "";
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) { selectedMime = mt; break; }
    }

    try {
      const hasFilter = activeFilterRef.current !== "none";
      let recordStream: MediaStream;

      if (hasFilter) {
        const filteredStream = await startFilteredRecording(audioStream);
        if (filteredStream) {
          recordStream = filteredStream;
        } else {
          const combined = new MediaStream();
          streamRef.current.getVideoTracks().forEach(t => combined.addTrack(t));
          if (audioStream) {
            audioStream.getAudioTracks().forEach(t => combined.addTrack(t));
          }
          recordStream = combined;
        }
      } else {
        const combined = new MediaStream();
        streamRef.current.getVideoTracks().forEach(t => combined.addTrack(t));
        if (audioStream) {
          audioStream.getAudioTracks().forEach(t => combined.addTrack(t));
        }
        recordStream = combined;
      }

      const recorderOptions: MediaRecorderOptions = {
        ...(selectedMime ? { mimeType: selectedMime } : {}),
        videoBitsPerSecond: isHD ? 5_000_000 : 1_500_000,
      };
      const recorder = new MediaRecorder(recordStream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopFilterLoop();
        stopRecordingStreams();
        if (!mountedRef.current) return;
        const actualMime = recorder.mimeType || selectedMime || "";
        const isMp4 = actualMime.includes("mp4");
        const blobType = isMp4 ? "video/mp4" : "video/webm";
        const ext = isMp4 ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const file = new File([blob], `video-${Date.now()}.${ext}`, { type: blobType });
        const url = URL.createObjectURL(blob);
        stopAllTracks();
        setPreviewFile(file);
        setPreviewUrl(url);
      };

      recorder.start(100);
      recordingStartTimeRef.current = Date.now();
      setRecording(true);
      setRecordingTime(0);
      setLiveCaptions([]);
      setInterimText("");
      setDetectedSourceLang(null);
      langDetectedRef.current = false;
      setShowFilters(false);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      startSpeechRecognition();
    } catch {
      stopFilterLoop();
      stopRecordingStreams();
      videoFallbackRef.current?.click();
    }
  }, [startSpeechRecognition, startFilteredRecording, stopFilterLoop, stopRecordingStreams, stopAllTracks, isIOS]);

  const captionSnapshotTakenRef = useRef(false);

  const stopRecording = useCallback(() => {
    stopSpeechRecognition();
    captionSnapshotTakenRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [stopSpeechRecognition]);

  useEffect(() => {
    if (recording && recordingTime >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordingTime, stopRecording]);

  useEffect(() => {
    if (previewUrl && previewFile && !captionSnapshotTakenRef.current) {
      const hasInFlight = liveCaptions.some(c => c.isTranslating);
      if (!hasInFlight) {
        setSavedCaptions([...liveCaptions]);
        captionSnapshotTakenRef.current = true;
      } else {
        const timeout = setTimeout(() => {
          if (!captionSnapshotTakenRef.current) {
            setSavedCaptions([...liveCaptions]);
            captionSnapshotTakenRef.current = true;
          }
        }, 3000);
        return () => clearTimeout(timeout);
      }
    }
  }, [previewUrl, previewFile, liveCaptions]);

  const buildCaptionSegments = useCallback(() => {
    if (savedCaptions.length === 0 || recordingStartTimeRef.current <= 0) return undefined;
    const startT = recordingStartTimeRef.current;
    const segs = savedCaptions
      .filter(c => !c.isTranslating && (c.translated || c.original))
      .map((c, i, arr) => {
        const relStart = Math.max(0, c.timestamp - startT);
        const nextStart = i < arr.length - 1 ? Math.max(0, arr[i + 1].timestamp - startT) : relStart + 4000;
        const text = c.translated && c.translated !== c.original
          ? `${c.original}\n${c.translated}`
          : c.original;
        return { start: relStart, end: nextStart, text };
      });
    return segs.length > 0 ? segs : undefined;
  }, [savedCaptions]);

  const handleSendVideo = useCallback(() => {
    if (previewFile) {
      const segments = buildCaptionSegments();
      onCapture(previewFile, segments);
      cleanupPreview();
    }
  }, [previewFile, onCapture, cleanupPreview, buildCaptionSegments]);

  const burnCaptionsToVideo = useCallback(async () => {
    if (!previewFile || burnStatus === "burning") return;
    if (burnedVideoUrl) {
      URL.revokeObjectURL(burnedVideoUrl);
      setBurnedVideoUrl(null);
      setBurnedVideoFile(null);
    }
    const segments = buildCaptionSegments();
    if (!segments) {
      setBurnStatus("done");
      setBurnedVideoUrl(previewUrl);
      setBurnedVideoFile(previewFile);
      return;
    }
    setBurnStatus("burning");
    try {
      const reader = new FileReader();
      const videoData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(previewFile);
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const res = await fetch("/api/video-captions/burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoData, captions: segments }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const result = await res.json();
        if (result.videoData) {
          const byteString = atob(result.videoData.split(",")[1] || result.videoData);
          const mimeMatch = result.videoData.match(/^data:([^;]+)/);
          const mime = mimeMatch ? mimeMatch[1] : "video/mp4";
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          const blob = new Blob([ab], { type: mime });
          const file = new File([blob], `junotalk-captioned-${Date.now()}.mp4`, { type: mime });
          const url = URL.createObjectURL(blob);
          setBurnedVideoUrl(url);
          setBurnedVideoFile(file);
          setBurnStatus("done");
          return;
        }
      }
      setBurnStatus("error");
    } catch {
      setBurnStatus("error");
    }
  }, [previewFile, previewUrl, buildCaptionSegments, burnStatus]);

  const handleDownloadVideo = useCallback(() => {
    const url = burnedVideoUrl || previewUrl;
    const file = burnedVideoFile || previewFile;
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || `video-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [previewUrl, previewFile, burnedVideoUrl, burnedVideoFile]);

  const handleShareVideo = useCallback(async () => {
    const file = burnedVideoFile || previewFile;
    if (!file) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "JunoTalk Video",
          text: savedCaptions.length > 0
            ? savedCaptions.map(c => c.translated && c.translated !== c.original ? `${c.original}\n${c.translated}` : c.original).join("\n")
            : "Check out this video!",
          files: [file],
        });
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          handleDownloadVideo();
        }
      }
    } else {
      handleDownloadVideo();
    }
  }, [previewFile, burnedVideoFile, savedCaptions, handleDownloadVideo]);

  const handleReRecord = useCallback(() => {
    cleanupPreview();
    setShowPreviewCaptions(true);
    setPreviewFilter("none");
    setShowPreviewFilters(false);
    setActiveEditTool(null);
    setTextOverlays([]);
    setNewTextInput("");
    setTrimStart(0);
    setTrimEnd(100);
    setIsHD(false);
    setSavedCaptions([]);
    setBurnStatus("idle");
    if (burnedVideoUrl) URL.revokeObjectURL(burnedVideoUrl);
    setBurnedVideoUrl(null);
    setBurnedVideoFile(null);
    startCamera(facingMode);
  }, [cleanupPreview, startCamera, facingMode, burnedVideoUrl]);

  const togglePreviewPlayback = useCallback(() => {
    const vid = previewVideoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play();
      setPreviewPlaying(true);
    } else {
      vid.pause();
      setPreviewPlaying(false);
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleVideoModeAction = useCallback(() => {
    if (supportsMediaRecorder) {
      startRecording();
    } else {
      videoFallbackRef.current?.click();
    }
  }, [startRecording]);

  const handleLanguageSelect = useCallback((code: string) => {
    setTranslateTo(code);
    translateToRef.current = code;
    setShowLangPicker(false);
    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, code); } catch {}

    // "en" means translation is off — clear translated captions instead of calling the API
    if (!code || code === "en") {
      setLiveCaptions(prev => prev.map(c => ({ ...c, translated: "", isTranslating: false })));
      return;
    }

    setLiveCaptions(prev => {
      if (prev.length === 0) return prev;
      const updated = prev.map(c => ({ ...c, isTranslating: true }));
      prev.forEach(c => {
        translateText(c.original, code).then(translated => {
          setLiveCaptions(curr => curr.map(cap =>
            cap.id === c.id ? { ...cap, translated, isTranslating: false } : cap
          ));
        }).catch(() => {
          setLiveCaptions(curr => curr.map(cap =>
            cap.id === c.id ? { ...cap, isTranslating: false } : cap
          ));
        });
      });
      return updated;
    });
  }, [translateText]);

  const selectedLangName = LANGUAGES.find(l => l.code === translateTo)?.name || translateTo;

  const previewFilterObj = FILTERS.find(f => f.id === previewFilter) || FILTERS[0];

  const handleAddTextOverlay = useCallback(() => {
    if (!newTextInput.trim()) return;
    if (editingOverlayId) {
      setTextOverlays(prev => prev.map(o =>
        o.id === editingOverlayId ? { ...o, text: newTextInput.trim(), color: textColor, size: textSize } : o
      ));
      setEditingOverlayId(null);
    } else {
      const id = `txt-${Date.now()}`;
      setTextOverlays(prev => [...prev, {
        id,
        text: newTextInput.trim(),
        x: 50,
        y: 30 + (prev.length * 12) % 40,
        color: textColor,
        size: textSize,
      }]);
    }
    setNewTextInput("");
    setTextInputMode(false);
  }, [newTextInput, textColor, textSize, editingOverlayId]);

  const handleRemoveTextOverlay = useCallback((id: string) => {
    setTextOverlays(prev => prev.filter(t => t.id !== id));
    if (selectedOverlayId === id) setSelectedOverlayId(null);
    if (editingOverlayId === id) {
      setEditingOverlayId(null);
      setNewTextInput("");
      setTextInputMode(false);
    }
  }, [selectedOverlayId, editingOverlayId]);

  const openTextInput = useCallback(() => {
    setTextInputMode(true);
    setEditingOverlayId(null);
    setNewTextInput("");
  }, []);

  const openEditOverlay = useCallback((id: string) => {
    const overlay = textOverlays.find(o => o.id === id);
    if (!overlay) return;
    setEditingOverlayId(id);
    setNewTextInput(overlay.text);
    setTextColor(overlay.color);
    setTextSize(overlay.size);
    setTextInputMode(true);
  }, [textOverlays]);

  const cancelTextInput = useCallback(() => {
    setTextInputMode(false);
    setNewTextInput("");
    setEditingOverlayId(null);
  }, []);

  const dragElementRef = useRef<HTMLElement | null>(null);

  const handleOverlayDragStart = useCallback((id: string, clientX: number, clientY: number, target: HTMLElement, pointerId: number) => {
    const container = overlayContainerRef.current;
    if (!container) return;
    const overlay = textOverlays.find(o => o.id === id);
    if (!overlay) return;
    setSelectedOverlayId(id);
    dragRef.current = { id, startX: clientX, startY: clientY, origX: overlay.x, origY: overlay.y };
    dragElementRef.current = target;
    try { target.setPointerCapture(pointerId); } catch {}
  }, [textOverlays]);

  const handleOverlayDragMove = useCallback((clientX: number, clientY: number) => {
    if (!dragRef.current) return;
    const container = overlayContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dx = ((clientX - dragRef.current.startX) / rect.width) * 100;
    const dy = ((clientY - dragRef.current.startY) / rect.height) * 100;
    const newX = Math.max(5, Math.min(95, dragRef.current.origX + dx));
    const newY = Math.max(5, Math.min(95, dragRef.current.origY + dy));
    setTextOverlays(prev => prev.map(o =>
      o.id === dragRef.current!.id ? { ...o, x: newX, y: newY } : o
    ));
  }, []);

  const handleOverlayDragEnd = useCallback((pointerId?: number) => {
    if (dragElementRef.current && pointerId !== undefined) {
      try { dragElementRef.current.releasePointerCapture(pointerId); } catch {}
    }
    dragRef.current = null;
    dragElementRef.current = null;
  }, []);

  const handleEditToolSelect = useCallback((tool: string) => {
    if (activeEditTool === tool) {
      setActiveEditTool(null);
      setShowPreviewFilters(false);
      if (tool === "text") {
        setTextInputMode(false);
        setSelectedOverlayId(null);
      }
    } else {
      setActiveEditTool(tool);
      setShowPreviewFilters(tool === "filter");
      if (tool === "text") {
        setSelectedOverlayId(null);
        if (textOverlays.length === 0) {
          openTextInput();
        }
      }
    }
  }, [activeEditTool, textOverlays.length, openTextInput]);

  if (previewUrl && previewFile) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="video-preview-modal">
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="text-white bg-black/40 rounded-full"
            data-testid="button-preview-close"
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            {isHD && (
              <div className="bg-primary/80 text-white px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider" data-testid="badge-hd-active">
                HD
              </div>
            )}
            <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm font-medium" data-testid="text-preview-size">
              {(previewFile.size / (1024 * 1024)).toFixed(1)} MB
            </div>
          </div>
        </div>

        <div className="absolute top-20 right-3 z-20 flex flex-col gap-3" data-testid="edit-toolbar">
          <button
            onClick={() => setIsHD(!isHD)}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              isHD ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-edit-hd"
          >
            <span className="text-xs font-extrabold tracking-tight leading-none">HD</span>
          </button>

          <button
            onClick={() => handleEditToolSelect("filter")}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              activeEditTool === "filter" ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-edit-filter"
          >
            <Palette className="w-5 h-5" />
          </button>

          <button
            onClick={() => {
              setShowPreviewCaptions(!showPreviewCaptions);
            }}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              showPreviewCaptions && savedCaptions.length > 0 ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-edit-captions"
          >
            <Captions className="w-5 h-5" />
          </button>

          <button
            onClick={() => handleEditToolSelect("text")}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              activeEditTool === "text" ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-edit-text"
          >
            <Type className="w-5 h-5" />
          </button>

          <button
            onClick={() => handleEditToolSelect("trim")}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              activeEditTool === "trim" ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-edit-trim"
          >
            <Scissors className="w-5 h-5" />
          </button>
        </div>

        <div
          ref={overlayContainerRef}
          className="flex-1 flex items-center justify-center overflow-hidden relative"
          onClick={(e) => {
            if (activeEditTool === "text" && !textInputMode) {
              const target = e.target as HTMLElement;
              if (!target.closest("[data-overlay-id]")) {
                setSelectedOverlayId(null);
              }
              return;
            }
            if (activeEditTool) return;
            togglePreviewPlayback();
          }}
        >
          <video
            ref={previewVideoRef}
            src={previewUrl}
            className="w-full h-full object-contain"
            style={{
              filter: previewFilterObj.css !== "none" ? previewFilterObj.css : undefined,
            }}
            playsInline
            loop
            autoPlay
            onPlay={() => setPreviewPlaying(true)}
            onPause={() => setPreviewPlaying(false)}
            data-testid="video-preview-player"
          />

          {textOverlays.map((overlay) => (
            <div
              key={overlay.id}
              data-overlay-id={overlay.id}
              className={`absolute select-none ${activeEditTool === "text" ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
              style={{
                left: `${overlay.x}%`,
                top: `${overlay.y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: selectedOverlayId === overlay.id ? 30 : 20,
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                if (activeEditTool !== "text") return;
                e.preventDefault();
                e.stopPropagation();
                handleOverlayDragStart(overlay.id, e.clientX, e.clientY, e.currentTarget as HTMLElement, e.pointerId);
              }}
              onPointerMove={(e) => { if (dragRef.current?.id === overlay.id) { e.preventDefault(); handleOverlayDragMove(e.clientX, e.clientY); } }}
              onPointerUp={(e) => { if (dragRef.current?.id === overlay.id) handleOverlayDragEnd(e.pointerId); }}
              onPointerCancel={(e) => { if (dragRef.current?.id === overlay.id) handleOverlayDragEnd(e.pointerId); }}
              onDoubleClick={(e) => {
                if (activeEditTool !== "text") return;
                e.stopPropagation();
                openEditOverlay(overlay.id);
              }}
              onClick={(e) => {
                if (activeEditTool !== "text") return;
                e.stopPropagation();
                setSelectedOverlayId(prev => prev === overlay.id ? null : overlay.id);
              }}
              data-testid={`text-overlay-${overlay.id}`}
            >
              <div className={`relative ${selectedOverlayId === overlay.id ? "ring-2 ring-white/70 ring-offset-2 ring-offset-transparent rounded-md px-1" : ""}`}>
                <p
                  className="font-bold whitespace-nowrap"
                  style={{
                    color: overlay.color,
                    fontSize: `${overlay.size}px`,
                    textShadow: "0 2px 6px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5)",
                  }}
                >
                  {overlay.text}
                </p>
                {selectedOverlayId === overlay.id && activeEditTool === "text" && (
                  <button
                    className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg"
                    onClick={(e) => { e.stopPropagation(); handleRemoveTextOverlay(overlay.id); }}
                    data-testid={`button-remove-overlay-${overlay.id}`}
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {!previewPlaying && !activeEditTool && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" />
              </div>
            </div>
          )}
        </div>

        {showPreviewCaptions && savedCaptions.length > 0 && (
          <SectionBoundary label="Preview Captions">
          <div className="absolute left-0 right-0 z-15 px-4" style={{ bottom: "130px", maxHeight: "40vh" }} data-testid="preview-captions-overlay">
            <div className="bg-gradient-to-t from-black/60 via-black/30 to-transparent pt-4 pb-2 rounded-md">
              <div className="overflow-y-auto space-y-1.5 py-2 px-2 scrollbar-thin" style={{ maxHeight: "35vh", WebkitOverflowScrolling: "touch" as any }}>
                {savedCaptions.map((caption) => (
                  <div key={caption.id} className="text-center">
                    <p
                      className="text-white text-sm font-semibold leading-snug"
                      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                    >
                      {caption.original}
                    </p>
                    {caption.translated && caption.translated !== caption.original && (
                      <p
                        className="text-yellow-300 text-xs italic mt-0.5 leading-snug"
                        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                      >
                        {caption.translated}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          </SectionBoundary>
        )}

        {showPreviewFilters && activeEditTool === "filter" && (
          <SectionBoundary label="Preview Filters">
          <div className="absolute bottom-32 left-0 right-0 z-20 px-2" data-testid="preview-filter-strip">
            <div className="bg-black/60 backdrop-blur-md rounded-md p-2">
              <div className="flex gap-3 overflow-x-auto pb-1 px-1 scrollbar-thin snap-x snap-mandatory">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setPreviewFilter(filter.id)}
                    className={`flex-shrink-0 snap-center flex flex-col items-center gap-1 ${
                      previewFilter === filter.id ? "opacity-100" : "opacity-60"
                    }`}
                    data-testid={`button-preview-filter-${filter.id}`}
                  >
                    <div
                      className={`w-12 h-12 rounded-md overflow-hidden border-2 ${
                        previewFilter === filter.id ? "border-primary" : "border-white/20"
                      }`}
                    >
                      <div
                        className="w-full h-full bg-gradient-to-br from-sky-400 via-red-400 to-amber-300"
                        style={{ filter: filter.css !== "none" ? filter.css : undefined }}
                      />
                    </div>
                    <span className={`text-[10px] font-medium ${
                      previewFilter === filter.id ? "text-white" : "text-white/50"
                    }`}>
                      {filter.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          </SectionBoundary>
        )}

        {activeEditTool === "text" && !textInputMode && (
          <SectionBoundary label="Text Tool">
          <div className="absolute bottom-32 left-0 right-0 z-20 px-4" data-testid="text-overlay-panel">
            <div className="bg-black/60 backdrop-blur-md rounded-xl p-3 flex items-center gap-3">
              <button
                onClick={openTextInput}
                className="flex-1 bg-white/10 text-white/50 border border-white/20 rounded-full px-4 py-2.5 text-sm text-left"
                data-testid="button-open-text-input"
              >
                Tap to add text...
              </button>
              {selectedOverlayId && (
                <button
                  onClick={() => openEditOverlay(selectedOverlayId)}
                  className="bg-primary/80 text-white rounded-full px-3 py-2 text-xs font-medium"
                  data-testid="button-edit-selected"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
          </SectionBoundary>
        )}

        {textInputMode && (
          <SectionBoundary label="Text Input">
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col" data-testid="text-input-fullscreen">
            <div className="flex items-center justify-between p-4">
              <button
                onClick={cancelTextInput}
                className="text-white/80 text-sm font-medium px-3 py-1"
                data-testid="button-cancel-text"
              >
                Cancel
              </button>
              <span className="text-white/60 text-xs">
                {editingOverlayId ? "Edit Text" : "Add Text"}
              </span>
              <button
                onClick={handleAddTextOverlay}
                disabled={!newTextInput.trim()}
                className="text-primary font-semibold text-sm px-3 py-1 disabled:opacity-40"
                data-testid="button-done-text"
              >
                Done
              </button>
            </div>

            <div className="flex-1 flex items-center justify-center px-8">
              <input
                autoFocus
                type="text"
                value={newTextInput}
                onChange={(e) => setNewTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newTextInput.trim()) handleAddTextOverlay(); }}
                placeholder="Type here..."
                className="w-full text-center bg-transparent border-none outline-none font-bold placeholder:text-white/30"
                style={{
                  color: textColor,
                  fontSize: `${textSize}px`,
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                  caretColor: textColor,
                }}
                data-testid="input-text-overlay"
              />
            </div>

            <div className="pb-8 px-4 space-y-4">
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => { const idx = TEXT_SIZES.indexOf(textSize); if (idx > 0) setTextSize(TEXT_SIZES[idx - 1]); }}
                  className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white"
                  data-testid="button-text-size-down"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-white/60 text-xs font-medium w-8 text-center">{textSize}</span>
                <button
                  onClick={() => { const idx = TEXT_SIZES.indexOf(textSize); if (idx < TEXT_SIZES.length - 1) setTextSize(TEXT_SIZES[idx + 1]); }}
                  className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white"
                  data-testid="button-text-size-up"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-center gap-2.5 flex-wrap" data-testid="color-picker">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setTextColor(color)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${textColor === color ? "border-white scale-125" : "border-white/20 scale-100"}`}
                    style={{ backgroundColor: color }}
                    data-testid={`button-color-${color.replace("#", "")}`}
                  />
                ))}
              </div>
            </div>
          </div>
          </SectionBoundary>
        )}

        {activeEditTool === "trim" && (
          <SectionBoundary label="Trim Tool">
          <div className="absolute bottom-32 left-0 right-0 z-20 px-4" data-testid="trim-panel">
            <div className="bg-black/70 backdrop-blur-md rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between text-white/70 text-xs">
                <span>Trim</span>
                <span>{trimStart}% - {trimEnd}%</span>
              </div>
              <div className="relative h-8 bg-white/10 rounded-md overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 bg-primary/30 rounded-md"
                  style={{ left: `${trimStart}%`, right: `${100 - trimEnd}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={trimStart}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val < trimEnd - 5) setTrimStart(val);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  data-testid="input-trim-start"
                />
              </div>
              <div className="relative h-8 bg-white/10 rounded-md overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 bg-primary/30 rounded-md"
                  style={{ left: `${trimStart}%`, right: `${100 - trimEnd}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={trimEnd}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val > trimStart + 5) setTrimEnd(val);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  data-testid="input-trim-end"
                />
              </div>
            </div>
          </div>
          </SectionBoundary>
        )}

        <div className="absolute bottom-0 left-0 right-0 z-10 pb-8 pt-4 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="ghost"
              onClick={handleReRecord}
              className="text-white bg-white/15 rounded-full gap-2 px-4"
              data-testid="button-rerecord"
            >
              <RotateCcw className="w-4 h-4" />
              Re-record
            </Button>
            {savedCaptions.length > 0 && (burnStatus === "idle" || burnStatus === "error") && (
              <Button
                variant="ghost"
                onClick={burnCaptionsToVideo}
                className="text-white bg-white/15 rounded-full gap-2 px-4"
                data-testid="button-burn-captions"
              >
                <Captions className="w-4 h-4" />
                {burnStatus === "error" ? "Retry" : "Burn"}
              </Button>
            )}
            {burnStatus === "burning" && (
              <div className="flex items-center gap-2 text-white/70 px-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Adding captions...</span>
              </div>
            )}
            {burnStatus === "done" && (
              <div className="flex items-center gap-1 text-cyan-400 px-2">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs">Ready</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownloadVideo}
              className="text-white bg-white/15 rounded-full"
              data-testid="button-download-video"
              disabled={burnStatus === "burning"}
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleShareVideo}
              className="text-white bg-white/15 rounded-full"
              data-testid="button-share-video"
              disabled={burnStatus === "burning"}
            >
              <Share2 className="w-4 h-4" />
            </Button>
            <Button
              variant="default"
              onClick={handleSendVideo}
              className="rounded-full gap-2 px-6"
              data-testid="button-send-video"
              disabled={burnStatus === "burning"}
            >
              <Send className="w-4 h-4" />
              Send
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="camera-modal">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={filterCanvasRef} className="hidden" />
      <input
        ref={videoFallbackRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleVideoFallback}
        data-testid="input-video-fallback"
      />

      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="text-white bg-black/40 rounded-full"
          data-testid="button-camera-close"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2">
          {isHD && !recording && (
            <div className="bg-primary/80 text-white px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider" data-testid="badge-camera-hd-active">
              HD
            </div>
          )}
          {flashSupported && !recording && facingMode === "environment" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFlash}
              className={`rounded-full ${flashOn ? "text-yellow-400 bg-yellow-400/20" : "text-white bg-black/40"}`}
              data-testid="button-flash-toggle"
            >
              {flashOn ? <Zap className="h-5 w-5 fill-yellow-400" /> : <ZapOff className="h-5 w-5" />}
            </Button>
          )}
          {recording && (
            <div className={`flex items-center gap-2 ${recordingTime >= MAX_RECORDING_SECONDS - 10 ? "bg-red-700" : "bg-red-600"} text-white px-3 py-1 rounded-full text-sm font-medium`} data-testid="text-recording-timer">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              {formatTime(recordingTime)} / {formatTime(MAX_RECORDING_SECONDS)}
            </div>
          )}
          {hasMultipleCameras && !recording && (
            <Button
              variant="ghost"
              size="icon"
              onClick={switchCamera}
              className="text-white bg-black/40 rounded-full"
              data-testid="button-switch-camera"
            >
              <SwitchCamera className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      {!recording && (
        <div className="absolute top-20 right-3 z-20 flex flex-col gap-3" data-testid="camera-edit-toolbar">
          <button
            onClick={() => setIsHD(!isHD)}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              isHD ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-camera-hd"
          >
            <span className="text-xs font-extrabold tracking-tight leading-none">HD</span>
          </button>

          <button
            onClick={() => { setShowFilters(!showFilters); setShowLangPicker(false); }}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              activeFilter !== "none" ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-camera-filter"
          >
            <Palette className="w-5 h-5" />
          </button>

          <button
            onClick={() => {
              setShowPreviewCaptions(!showPreviewCaptions);
            }}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              showPreviewCaptions ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-camera-captions"
          >
            <Captions className="w-5 h-5" />
          </button>

          <button
            onClick={() => handleEditToolSelect("text")}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
              activeEditTool === "text" ? "bg-primary border-primary text-white shadow-lg shadow-primary/30" : "bg-black/50 border-white/30 text-white"
            }`}
            data-testid="button-camera-text"
          >
            <Type className="w-5 h-5" />
          </button>
        </div>
      )}

      <div
        ref={!previewUrl ? overlayContainerRef : undefined}
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onClick={(e) => {
          if (activeEditTool === "text" && !textInputMode && !recording) {
            const target = e.target as HTMLElement;
            if (!target.closest("[data-overlay-id]")) {
              setSelectedOverlayId(null);
            }
          }
        }}
      >
        {cameraError ? (
          <div className="text-white text-center px-6" data-testid="text-camera-error">
            <p className="text-lg font-medium mb-2">Camera Unavailable</p>
            <p className="text-sm text-white/70">{cameraError}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{
              ...(facingMode === "user" ? { transform: "scaleX(-1)" } : {}),
              filter: currentFilter.css !== "none" ? currentFilter.css : undefined,
            }}
            data-testid="camera-preview"
          />
        )}

        {!recording && textOverlays.map((overlay) => (
          <div
            key={overlay.id}
            data-overlay-id={overlay.id}
            className={`absolute select-none ${activeEditTool === "text" ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
            style={{
              left: `${overlay.x}%`,
              top: `${overlay.y}%`,
              transform: "translate(-50%, -50%)",
              zIndex: selectedOverlayId === overlay.id ? 30 : 20,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (activeEditTool !== "text") return;
              e.preventDefault();
              e.stopPropagation();
              handleOverlayDragStart(overlay.id, e.clientX, e.clientY, e.currentTarget as HTMLElement, e.pointerId);
            }}
            onPointerMove={(e) => { if (dragRef.current?.id === overlay.id) { e.preventDefault(); handleOverlayDragMove(e.clientX, e.clientY); } }}
            onPointerUp={(e) => { if (dragRef.current?.id === overlay.id) handleOverlayDragEnd(e.pointerId); }}
            onPointerCancel={(e) => { if (dragRef.current?.id === overlay.id) handleOverlayDragEnd(e.pointerId); }}
            onDoubleClick={(e) => {
              if (activeEditTool !== "text") return;
              e.stopPropagation();
              openEditOverlay(overlay.id);
            }}
            onClick={(e) => {
              if (activeEditTool !== "text") return;
              e.stopPropagation();
              setSelectedOverlayId(prev => prev === overlay.id ? null : overlay.id);
            }}
            data-testid={`camera-text-overlay-${overlay.id}`}
          >
            <div className={`relative ${selectedOverlayId === overlay.id ? "ring-2 ring-white/70 ring-offset-2 ring-offset-transparent rounded-md px-1" : ""}`}>
              <p
                className="font-bold whitespace-nowrap"
                style={{
                  color: overlay.color,
                  fontSize: `${overlay.size}px`,
                  textShadow: "0 2px 6px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5)",
                }}
              >
                {overlay.text}
              </p>
              {selectedOverlayId === overlay.id && activeEditTool === "text" && (
                <button
                  className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg"
                  onClick={(e) => { e.stopPropagation(); handleRemoveTextOverlay(overlay.id); }}
                  data-testid={`button-camera-remove-overlay-${overlay.id}`}
                >
                  <X className="w-3.5 h-3.5 text-white" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!recording && activeEditTool === "text" && !textInputMode && (
        <SectionBoundary label="Camera Text Tool">
        <div className="absolute bottom-36 left-0 right-0 z-20 px-4" data-testid="camera-text-panel">
          <div className="bg-black/60 backdrop-blur-md rounded-xl p-3 flex items-center gap-3">
            <button
              onClick={openTextInput}
              className="flex-1 bg-white/10 text-white/50 border border-white/20 rounded-full px-4 py-2.5 text-sm text-left"
              data-testid="button-camera-open-text-input"
            >
              Tap to add text...
            </button>
            {selectedOverlayId && (
              <button
                onClick={() => openEditOverlay(selectedOverlayId)}
                className="bg-primary/80 text-white rounded-full px-3 py-2 text-xs font-medium"
                data-testid="button-camera-edit-selected"
              >
                Edit
              </button>
            )}
          </div>
        </div>
        </SectionBoundary>
      )}

      {!recording && textInputMode && !previewUrl && (
        <SectionBoundary label="Camera Text Input">
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col" data-testid="camera-text-input-fullscreen">
          <div className="flex items-center justify-between p-4">
            <button
              onClick={cancelTextInput}
              className="text-white/80 text-sm font-medium px-3 py-1"
              data-testid="button-camera-cancel-text"
            >
              Cancel
            </button>
            <span className="text-white/60 text-xs">
              {editingOverlayId ? "Edit Text" : "Add Text"}
            </span>
            <button
              onClick={handleAddTextOverlay}
              disabled={!newTextInput.trim()}
              className="text-primary font-semibold text-sm px-3 py-1 disabled:opacity-40"
              data-testid="button-camera-done-text"
            >
              Done
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center px-8">
            <input
              autoFocus
              type="text"
              value={newTextInput}
              onChange={(e) => setNewTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newTextInput.trim()) handleAddTextOverlay(); }}
              placeholder="Type here..."
              className="w-full text-center bg-transparent border-none outline-none font-bold placeholder:text-white/30"
              style={{
                color: textColor,
                fontSize: `${textSize}px`,
                textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                caretColor: textColor,
              }}
              data-testid="input-camera-text-overlay"
            />
          </div>

          <div className="pb-8 px-4 space-y-4">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => { const idx = TEXT_SIZES.indexOf(textSize); if (idx > 0) setTextSize(TEXT_SIZES[idx - 1]); }}
                className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white"
                data-testid="button-camera-text-size-down"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-white/60 text-xs font-medium w-8 text-center">{textSize}</span>
              <button
                onClick={() => { const idx = TEXT_SIZES.indexOf(textSize); if (idx < TEXT_SIZES.length - 1) setTextSize(TEXT_SIZES[idx + 1]); }}
                className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white"
                data-testid="button-camera-text-size-up"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-center gap-2.5 flex-wrap" data-testid="camera-color-picker">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setTextColor(color)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${textColor === color ? "border-white scale-125" : "border-white/20 scale-100"}`}
                  style={{ backgroundColor: color }}
                  data-testid={`button-camera-color-${color.replace("#", "")}`}
                />
              ))}
            </div>
          </div>
        </div>
        </SectionBoundary>
      )}

      {recording && showPreviewCaptions && (liveCaptions.length > 0 || interimText) && (
        <SectionBoundary label="Live Captions">
        <div className="absolute left-0 right-0 z-20 flex flex-col" style={{ bottom: "160px", maxHeight: "40vh" }}>
          <div className="bg-gradient-to-t from-black/60 via-black/30 to-transparent pt-6 pb-2">
            <div
              ref={captionContainerRef}
              className="overflow-y-auto px-4 py-2 space-y-1.5 scrollbar-thin"
              style={{ WebkitOverflowScrolling: "touch", maxHeight: "35vh" }}
              data-testid="live-caption-overlay"
            >
              {liveCaptions.map((caption) => (
                <div key={caption.id} className="text-center">
                  <p
                    className="text-white text-sm font-semibold leading-snug"
                    style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  >
                    {caption.original}
                  </p>
                  {caption.isTranslating ? (
                    <p
                      className="text-yellow-300 text-xs italic animate-pulse mt-0.5"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                    >
                      Translating...
                    </p>
                  ) : caption.translated && caption.translated !== caption.original ? (
                    <p
                      className="text-yellow-300 text-xs italic mt-0.5 leading-snug"
                      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                    >
                      {caption.translated}
                    </p>
                  ) : null}
                </div>
              ))}
              {interimText && (
                <div className="text-center">
                  <p
                    className="text-white/60 text-sm font-medium leading-snug"
                    style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  >
                    {interimText}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        </SectionBoundary>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 pb-6 pt-2 bg-gradient-to-t from-black/80 to-transparent">
        {!recording && showFilters && (
          <SectionBoundary label="Camera Filters">
          <div className="mb-2 px-2" data-testid="filter-strip">
            <div className="flex gap-2 overflow-x-auto pb-1 px-2 scrollbar-thin snap-x snap-mandatory">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={`flex-shrink-0 snap-center flex flex-col items-center gap-0.5 ${
                    activeFilter === filter.id ? "opacity-100" : "opacity-60"
                  }`}
                  data-testid={`button-filter-${filter.id}`}
                >
                  <div
                    className={`w-10 h-10 rounded-full overflow-hidden border-2 ${
                      activeFilter === filter.id ? "border-primary" : "border-white/30"
                    }`}
                  >
                    <div
                      className="w-full h-full bg-gradient-to-br from-sky-400 via-red-400 to-amber-300"
                      style={{ filter: filter.css !== "none" ? filter.css : undefined }}
                    />
                  </div>
                  <span className={`text-[9px] font-medium ${
                    activeFilter === filter.id ? "text-white" : "text-white/60"
                  }`}>
                    {filter.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          </SectionBoundary>
        )}

        {mode === "video" && !recording && (
          <div className="flex items-center justify-center mb-2">
            <div className="relative">
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowLangPicker(!showLangPicker)}
                className="rounded-full bg-primary/80 backdrop-blur-sm text-white gap-1.5 h-7 text-xs px-3"
                data-testid="button-lang-picker-toggle"
              >
                <Languages className="w-3 h-3" />
                <span>Translate: {selectedLangName}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>

              {showLangPicker && (
                <SectionBoundary label="Language Picker">
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur-md rounded-md border border-white/10 py-1 w-44 max-h-52 overflow-y-auto z-50"
                  data-testid="lang-picker-dropdown"
                >
                  {LANGUAGES.map((lang) => (
                    <Button
                      key={lang.code}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLanguageSelect(lang.code)}
                      className={`w-full justify-start rounded-none ${
                        lang.code === translateTo
                          ? "bg-primary/30 text-white font-medium"
                          : "text-white/80"
                      }`}
                      data-testid={`button-lang-option-${lang.code}`}
                    >
                      {lang.name}
                    </Button>
                  ))}
                </div>
                </SectionBoundary>
              )}
            </div>
          </div>
        )}

        {recording && (
          <div className="flex items-center justify-center mb-1 gap-2">
            {detectedSourceLang && (
              <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm text-white px-2 py-1 rounded-full text-[11px] font-medium" data-testid="text-detected-lang">
                <span>{LANGUAGES.find(l => l.code === detectedSourceLang)?.name || detectedSourceLang.toUpperCase()}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 bg-primary/60 backdrop-blur-sm text-white px-3 py-1 rounded-full text-[11px] font-medium" data-testid="text-recording-lang">
              <Languages className="w-3 h-3" />
              <span>{selectedLangName}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-8 mb-2">
          {!recording && (
            <div className="flex items-center gap-1 bg-black/50 rounded-full p-0.5" data-testid="camera-mode-toggle">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMode("video"); setShowLangPicker(false); }}
                className={`rounded-full h-7 text-xs px-3 ${mode === "video" ? "bg-white text-black" : "text-white/70"}`}
                data-testid="button-mode-video"
              >
                VIDEO
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMode("photo"); setShowLangPicker(false); }}
                className={`rounded-full h-7 text-xs px-3 ${mode === "photo" ? "bg-white text-black" : "text-white/70"}`}
                data-testid="button-mode-photo"
              >
                PHOTO
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-6">
          {!recording && (
            <div className="w-10 h-10" />
          )}

          {mode === "photo" ? (
            <button
              onClick={capturePhoto}
              disabled={!!cameraError}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50"
              data-testid="button-capture-photo"
            >
              <Circle className="w-12 h-12 text-white fill-white" />
            </button>
          ) : recording ? (
            <button
              onClick={stopRecording}
              className="w-16 h-16 rounded-full border-4 border-red-500 flex items-center justify-center bg-red-500/20"
              data-testid="button-stop-recording"
            >
              <Square className="w-6 h-6 text-white fill-white" />
            </button>
          ) : (
            <button
              onClick={handleVideoModeAction}
              disabled={!!cameraError}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50"
              data-testid="button-start-recording"
            >
              <Circle className="w-12 h-12 text-red-500 fill-red-500" />
            </button>
          )}

          {!recording && (
            <div className="w-10 h-10" />
          )}
        </div>

        {mode === "video" && !supportsMediaRecorder && !recording && (
          <p className="text-center text-white/50 text-xs mt-2" data-testid="text-video-fallback-hint">
            Tap to record using your device camera
          </p>
        )}
      </div>
    </div>
  );
}
