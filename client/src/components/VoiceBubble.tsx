import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Mic, Loader2 } from "lucide-react";

type Props = {
  audioUrl: string;
  isMine?: boolean;
  timestamp?: string;
  transcription?: string;
  transcriptionTranslated?: string;
  isTranscriptionTranslating?: boolean;
  onTranscriptFeedback?: (useful: boolean) => void;
  transcriptionFeedback?: "useful" | "not_useful";
};

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VoiceBubble({
  audioUrl,
  isMine = true,
  timestamp,
  transcription,
  transcriptionTranslated,
  isTranscriptionTranslating,
  onTranscriptFeedback,
  transcriptionFeedback,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);

  const bars = useMemo(() => {
    const seed = Array.from(audioUrl.slice(0, 100)).reduce((a, c) => a + c.charCodeAt(0), 0);
    const rand = (i: number) => {
      const x = Math.sin(seed + i * 999) * 10000;
      return x - Math.floor(x);
    };
    const n = 28;
    return Array.from({ length: n }, (_, i) => 20 + Math.floor(rand(i) * 80));
  }, [audioUrl]);

  const resolvedUrl = useMemo(() => {
    if (!audioUrl.startsWith("data:")) return audioUrl;
    try {
      const [header, b64] = audioUrl.split(",");
      const mime = header.match(/data:(.*?);/)?.[1] || "audio/mp4";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      return url;
    } catch {
      return audioUrl;
    }
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onLoaded = () => setDuration(a.duration || 0);
    const onDurationChange = () => {
      if (a.duration && isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrent(0);
      if (a) a.currentTime = 0;
      stopRAF();
    };

    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("durationchange", onDurationChange);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("durationchange", onDurationChange);
      a.removeEventListener("ended", onEnded);
      stopRAF();
    };
  }, [resolvedUrl]);

  function startRAF() {
    stopRAF();
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurrent(a.currentTime || 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopRAF() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  async function togglePlay(e: React.MouseEvent | React.TouchEvent) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;

    if (!isPlaying) {
      try {
        await a.play();
        setIsPlaying(true);
        startRAF();
      } catch {
      }
    } else {
      a.pause();
      setIsPlaying(false);
      stopRAF();
    }
  }

  function seekFromClick(e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    const pct = x / rect.width;
    a.currentTime = pct * duration;
    setCurrent(a.currentTime);
  }

  const pct = duration > 0 ? Math.min(1, current / duration) : 0;
  const hasTranslation = !!transcriptionTranslated && transcriptionTranslated !== transcription;
  const hasTranscript = !!transcription || !!transcriptionTranslated;

  return (
    <div className="w-full" data-testid="voice-bubble">
      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          onTouchEnd={(e) => { e.stopPropagation(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
          className={`h-9 w-9 shrink-0 rounded-full grid place-items-center transition-colors ${
            isMine ? "bg-white/20" : "bg-black/10 dark:bg-white/15"
          }`}
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="button-voice-play"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" fill="currentColor" />
          ) : (
            <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div
            className="relative h-8 rounded-lg flex items-center gap-[2px] cursor-pointer select-none px-1"
            onClick={seekFromClick}
            onTouchStart={seekFromClick}
            role="progressbar"
            aria-valuenow={Math.round(pct * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-testid="voice-progress-bar"
          >
            <div
              className="absolute left-0 top-0 h-full rounded-lg pointer-events-none"
              style={{
                width: `${pct * 100}%`,
                background: isMine ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
              }}
            />
            {bars.map((h, i) => {
              const barPct = (i + 1) / bars.length;
              const active = barPct <= pct;
              return (
                <div
                  key={i}
                  className={`relative w-[3px] rounded-full transition-colors duration-150 ${
                    active
                      ? (isMine ? "bg-white" : "bg-foreground/70")
                      : (isMine ? "bg-white/40" : "bg-foreground/25")
                  }`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] opacity-75 tabular-nums" data-testid="text-voice-duration">
              {formatTime(isPlaying ? current : duration || 0)}
            </span>
            {timestamp && (
              <span className="text-[10px] opacity-60">{timestamp}</span>
            )}
          </div>
        </div>
      </div>

      {(hasTranscript || isTranscriptionTranslating) && (
        <div className="mt-2" data-testid="voice-transcript-section">
          {isTranscriptionTranslating ? (
            <div className="flex items-center gap-1.5 py-1">
              <Loader2 className="w-3 h-3 animate-spin opacity-50" />
              <span className="text-[11px] opacity-50">Transcribing...</span>
            </div>
          ) : hasTranscript && showTranscript ? (
            <div>
              <p
                className="text-[13px] leading-relaxed cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasTranslation) setShowOriginal(prev => !prev);
                }}
                style={{ color: (!isMine && hasTranslation && !showOriginal) ? undefined : "rgba(255,255,255,0.9)" }}
                data-testid="text-voice-transcript"
              >
                "{showOriginal ? transcription : (transcriptionTranslated || transcription)}"
              </p>
              {hasTranslation && (
                <p
                  className="text-[11px] mt-0.5 opacity-40 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowOriginal(prev => !prev);
                  }}
                  data-testid="button-toggle-transcript-lang"
                >
                  {showOriginal ? "Tap for translation" : "Tap for original"}
                </p>
              )}
              {onTranscriptFeedback && !transcriptionFeedback && (
                <div className="mt-1.5 flex items-center gap-1" data-testid="transcript-feedback">
                  <span className="text-[11px] opacity-40">Was this transcript</span>
                  <button
                    className="text-[11px] font-bold text-green-400 hover:text-green-300"
                    onClick={(e) => { e.stopPropagation(); onTranscriptFeedback(true); }}
                    data-testid="button-transcript-useful"
                  >
                    useful
                  </button>
                  <span className="text-[11px] opacity-40">or</span>
                  <button
                    className="text-[11px] font-bold text-red-400 hover:text-red-300"
                    onClick={(e) => { e.stopPropagation(); onTranscriptFeedback(false); }}
                    data-testid="button-transcript-not-useful"
                  >
                    not useful
                  </button>
                  <span className="text-[11px] opacity-40">?</span>
                </div>
              )}
              {transcriptionFeedback && (
                <p className="text-[11px] mt-1 opacity-30" data-testid="text-transcript-feedback-thanks">
                  Thanks for your feedback!
                </p>
              )}
            </div>
          ) : hasTranscript ? (
            <button
              className="text-[11px] opacity-40 hover:opacity-60 flex items-center gap-1 mt-0.5"
              onClick={(e) => { e.stopPropagation(); setShowTranscript(true); }}
              data-testid="button-show-transcript"
            >
              <Mic className="w-3 h-3" />
              Show transcript
            </button>
          ) : null}
        </div>
      )}

      <audio ref={audioRef} src={resolvedUrl} preload="metadata" />
    </div>
  );
}
