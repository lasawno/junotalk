/**
 * VoiceSession.ts
 *
 * A self-contained pipeline for voice-to-voice conversation:
 *   mic → transcript → translate/respond → TTS playback → mic again
 *
 * New capabilities vs. original:
 *
 * 1. AUDIO LEVEL MONITORING
 *    When the mic is open a requestAnimationFrame loop reads the analyser
 *    node and calls `onAudioLevel(0-100)` so the UI can animate the orb.
 *
 * 2. BARGE-IN
 *    When `bargeIn: true`, a VAD poll runs during TTS playback. If the
 *    user speaks for ≥350 ms, TTS is cut and mic opens immediately.
 *
 * 3. WHISPER STT
 *    When `whisperMode: true`, uses a MediaRecorder + VAD + /api/v1/transcribe
 *    pipeline instead of browser SpeechRecognition. More reliable across
 *    all devices and languages, especially mobile Safari.
 *
 * Core design unchanged:
 *  - Single `phase` property is the ONLY thing that decides what happens next.
 *  - Mic ALWAYS stops before TTS plays (mandatory on iOS).
 *  - All restarts go through one gated function.
 */

import { buildAudioProcessor, isSpeechActive } from '@/lib/audio-processor';
import type { AudioProcessorResult } from '@/lib/audio-processor';

export type VoicePhase = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceSessionOptions {
  lang: string;
  speechSpeed?: number;
  voiceId?: string;

  /** Called when the user finishes an utterance. */
  onFinalTranscript: (text: string) => void;
  /** Called continuously with partial text while the user speaks. */
  onInterimTranscript?: (text: string) => void;
  /** Called whenever the phase changes (idle/listening/processing/speaking). */
  onPhaseChange?: (phase: VoicePhase) => void;
  /** Called on fatal or user-facing errors. */
  onError?: (msg: string) => void;

  /**
   * Fetch raw TTS audio as an ArrayBuffer.
   * Should POST to /api/v1/tts and return the response body.
   * Throw on failure — VoiceSession will fall back to SpeechSynthesis.
   */
  fetchAudio: (text: string, lang: string, voiceId: string, speed: number) => Promise<ArrayBuffer>;

  /**
   * Called ~60fps while the mic is open with a 0–100 signal level.
   * Use to drive orb / waveform animations.
   */
  onAudioLevel?: (level: number) => void;

  /**
   * When true, TTS is interrupted if the user starts speaking during playback.
   * Default: false.
   */
  bargeIn?: boolean;

  /**
   * When true, uses a MediaRecorder + Whisper pipeline instead of browser
   * SpeechRecognition. More reliable on mobile and non-Chrome browsers.
   * Default: false (browser SpeechRecognition).
   */
  whisperMode?: boolean;
}

// ─── Timing constants ─────────────────────────────────────────────────────────
const MIC_RESUME_DELAY_MS    = 2000;   // iOS audio hardware flush after TTS
const NO_SPEECH_RESTART_MS   = 350;
const ONEND_RESTART_MS       = 200;
const TTS_SAFETY_TIMEOUT_MS  = 25_000;
const SAFETY_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Whisper recording constants
const VAD_POLL_MS      = 100;   // how often we check if user is speaking
const SILENCE_CUTOFF_MS = 700;  // silence this long → end of utterance
const MIN_SPEECH_MS    = 400;   // shorter clips are noise — discard

// Barge-in: how long sustained speech must be before we cut TTS
const BARGE_IN_THRESHOLD_MS = 350;
// VAD threshold for barge-in — higher than normal to ignore TTS echo from speakers
const BARGE_IN_VAD_THRESHOLD = 28;

const LANG_TO_BCP47: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA',
  ru: 'ru-RU', hi: 'hi-IN', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR',
  sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI', nb: 'nb-NO', el: 'el-GR',
  he: 'he-IL', th: 'th-TH', vi: 'vi-VN', uk: 'uk-UA', id: 'id-ID',
};

export class VoiceSession {
  phase: VoicePhase = 'idle';
  private sessionActive = false;
  private opts: VoiceSessionOptions;

  // Browser SpeechRecognition
  private recognition: any = null;
  private silenceTimer:  ReturnType<typeof setTimeout> | null = null;
  private restartTimer:  ReturnType<typeof setTimeout> | null = null;
  private safetyTimer:   ReturnType<typeof setTimeout> | null = null;

  // TTS playback
  private audioCtx: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private stopCurrentAudio: (() => void) | null = null;

  // Audio level monitoring
  private audioProc: AudioProcessorResult | null = null;
  private levelRafId: number | null = null;

  // Whisper mode
  private whisperLoopActive = false;

  // Barge-in
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeInInterval: ReturnType<typeof setInterval> | null = null;
  private bargeInTriggered = false;

  private cachedVoices: SpeechSynthesisVoice[] = [];

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
    this._cacheVoices();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Call synchronously inside a tap handler to unblock audio on iOS / Safari. */
  unlock(): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch {}

    if (!this.audioEl) this.audioEl = new Audio();
    const a = this.audioEl;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    a.volume = 0;
    a.play().then(() => { a.pause(); a.volume = 1; }).catch(() => {});

    if ('speechSynthesis' in window) {
      const primer = new SpeechSynthesisUtterance('');
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    }
    console.log('[VoiceSession] unlock() called');
  }

  /** Begin a listening session. Safe to call multiple times — idempotent. */
  start(): void {
    if (this.sessionActive) return;
    this._stopAudio();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.sessionActive = true;
    this._setPhase('listening');
    this._startRecognition('start()');
    this._resetSafetyTimer();
    console.log('[VoiceSession] start() — session active');
  }

  /** Stop the session. Cancels mic, TTS, and all timers. */
  stop(): void {
    console.log('[VoiceSession] stop() called, phase was:', this.phase);
    this.sessionActive = false;
    this.whisperLoopActive = false;
    this._setPhase('idle');
    this._clearAllTimers();
    this._abortRecognition('stop()');
    this._stopAudio();
    this._stopAudioLevel();
    this._stopBargeIn();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /**
   * Play TTS for `text`.
   *  1. Immediately transitions to 'speaking' — mic is aborted synchronously.
   *  2. Resumes AudioContext (iOS suspends it while mic is active).
   *  3. If `bargeIn: true`, monitors VAD during playback and cuts TTS on speech.
   *  4. Fetches and plays TTS audio; falls back to SpeechSynthesis on failure.
   *  5. Transitions back to 'listening' and restarts mic after MIC_RESUME_DELAY_MS.
   */
  async speak(text: string, ttsLang?: string, ttsVoiceId?: string): Promise<void> {
    if (!text.trim()) return;

    const cleanText = VoiceSession._cleanForTTS(text);
    if (!cleanText) return;

    const lang        = ttsLang    ?? this.opts.lang;
    const voiceId     = ttsVoiceId ?? this.opts.voiceId ?? 'nova';
    const speechSpeed = this.opts.speechSpeed ?? 0.95;

    // ── Phase transition (synchronous) ─────────────────────────────────────
    this._setPhase('speaking');
    this._clearAllTimers();
    this._abortRecognition('speak()');
    this._stopAudioLevel();
    this._stopAudio();

    // ── Resume AudioContext ─────────────────────────────────────────────────
    if (this.audioCtx && this.audioCtx.state !== 'running') {
      await this.audioCtx.resume().catch(() => {});
    }

    // ── Safety valve ────────────────────────────────────────────────────────
    this.safetyTimer = setTimeout(() => {
      console.warn('[VoiceSession] safety timer fired — forcing phase reset');
      this._exitSpeaking();
    }, TTS_SAFETY_TIMEOUT_MS);

    // ── Start barge-in monitoring ───────────────────────────────────────────
    this.bargeInTriggered = false;
    if (this.opts.bargeIn) {
      this._startBargeIn();
    }

    // ── TTS fetch + play ────────────────────────────────────────────────────
    let playedOk = false;
    try {
      const buf = await this.opts.fetchAudio(cleanText, lang, voiceId, speechSpeed);
      if (!this.bargeInTriggered) {
        await this._playBuffer(buf);
      }
      playedOk = true;
    } catch (e: any) {
      console.warn('[VoiceSession] TTS fetch/play failed:', e?.message ?? e);
    }

    // ── Fallback to browser SpeechSynthesis ─────────────────────────────────
    if (!playedOk && !this.bargeInTriggered) {
      try {
        await this._browserSpeak(cleanText, lang);
      } catch (e: any) {
        console.warn('[VoiceSession] SpeechSynthesis also failed:', e?.message ?? e);
      }
    }

    this._stopBargeIn();
    clearTimeout(this.safetyTimer!);
    this.safetyTimer = null;

    this._exitSpeaking();
  }

  /**
   * Pause mic without ending the session — use while waiting for AI response.
   */
  pauseForProcessing(): void {
    if (!this.sessionActive) return;
    this._clearAllTimers();
    this._abortRecognition('pauseForProcessing()');
    this._stopAudioLevel();
    this._setPhase('processing');
    // Safety valve in case speak() is never called
    this.safetyTimer = setTimeout(() => {
      if (this.sessionActive && this.phase === 'processing') {
        console.warn('[VoiceSession] processing timeout — resuming listening');
        this._exitSpeaking();
      }
    }, 35_000);
  }

  setLang(lang: string)     : void { this.opts.lang = lang; }
  setVoiceId(id: string)    : void { this.opts.voiceId = id; }
  setSpeed(speed: number)   : void { this.opts.speechSpeed = speed; }
  getPhase(): VoicePhase           { return this.phase; }

  /** Call on component unmount. */
  destroy(): void {
    this.stop();
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null;
    this.audioEl = null;
    console.log('[VoiceSession] destroyed');
  }

  // ─── Private: recognition dispatch ────────────────────────────────────────

  private _startRecognition(reason: string): void {
    if (!this.sessionActive || this.phase !== 'listening') {
      console.log(`[VoiceSession] _startRecognition(${reason}) skipped — phase:${this.phase} session:${this.sessionActive}`);
      return;
    }

    if (this.opts.whisperMode) {
      this._startWhisperLoop(reason);
    } else {
      this._startBrowserRecognition(reason);
    }
  }

  // ─── Private: Whisper STT pipeline ────────────────────────────────────────

  /**
   * Whisper STT loop:
   *   1. Open mic + audio processor (VAD + analyser + processed stream)
   *   2. Wait for speech to start (VAD)
   *   3. Record until 700 ms of silence
   *   4. POST audio blob to /api/v1/transcribe
   *   5. Deliver transcript and loop back to step 2
   *
   * Runs until sessionActive=false or phase changes away from 'listening'.
   */
  private async _startWhisperLoop(reason: string): Promise<void> {
    if (this.whisperLoopActive) return;
    this.whisperLoopActive = true;
    console.log(`[VoiceSession] Whisper loop starting (${reason})`);

    let proc: AudioProcessorResult | null = null;
    try {
      proc = await buildAudioProcessor();
      this.audioProc = proc;
      this._startAudioLevel(proc.analyserNode);
    } catch (e) {
      console.warn('[VoiceSession] Whisper: audio processor init failed:', e);
      this.whisperLoopActive = false;
      // Fall back to browser SR
      if (this.sessionActive && this.phase === 'listening') {
        this._startBrowserRecognition('whisper-fallback');
      }
      return;
    }

    const getMimeType = (): string | undefined => {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      return types.find(t => MediaRecorder.isTypeSupported(t));
    };
    const mimeType = getMimeType();

    while (this.whisperLoopActive && this.sessionActive && this.phase === 'listening') {
      // Phase 1: wait for speech to start
      const speechStarted = await this._waitForVAD(proc.analyserNode, true, 10_000);
      if (!speechStarted || !this.whisperLoopActive || !this.sessionActive) break;
      if (this.phase !== 'listening') break;

      console.log('[VoiceSession] Whisper: speech detected — recording');
      this.opts.onInterimTranscript?.('…');

      // Phase 2: record until silence
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(proc.processedStream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(100);

      const speechStart = Date.now();
      let lastSpeechMs = Date.now();

      // Poll VAD until silence sustained for SILENCE_CUTOFF_MS
      await new Promise<void>((resolve) => {
        const pollId = setInterval(() => {
          if (!this.whisperLoopActive || !this.sessionActive || this.phase !== 'listening') {
            clearInterval(pollId);
            resolve();
            return;
          }
          if (isSpeechActive(proc!.analyserNode)) {
            lastSpeechMs = Date.now();
          } else if (Date.now() - lastSpeechMs >= SILENCE_CUTOFF_MS) {
            clearInterval(pollId);
            resolve();
          }
        }, VAD_POLL_MS);
      });

      recorder.stop();
      await new Promise<void>((r) => { recorder.onstop = () => r(); });

      const speechDuration = Date.now() - speechStart;
      if (!this.whisperLoopActive || !this.sessionActive || this.phase !== 'listening') break;

      if (speechDuration < MIN_SPEECH_MS || chunks.length === 0) {
        console.log('[VoiceSession] Whisper: clip too short, ignoring');
        this.opts.onInterimTranscript?.('');
        continue;
      }

      // Phase 3: transcribe
      const blob = new Blob(chunks, { type: mimeType ?? 'audio/webm' });
      console.log(`[VoiceSession] Whisper: sending ${(blob.size / 1024).toFixed(1)} KB for transcription`);

      try {
        const fd = new FormData();
        fd.append('audio', blob, `clip.${mimeType?.includes('mp4') ? 'm4a' : 'webm'}`);
        fd.append('lang', LANG_TO_BCP47[this.opts.lang] || this.opts.lang);

        const res = await fetch('/api/v1/transcribe', { method: 'POST', body: fd, credentials: 'include' });
        if (res.ok) {
          const { text } = await res.json();
          const trimmed = (text ?? '').trim();
          console.log('[VoiceSession] Whisper transcript:', trimmed.slice(0, 80));
          this.opts.onInterimTranscript?.('');
          if (trimmed) {
            this._resetSafetyTimer();
            this.opts.onFinalTranscript(trimmed);
          }
        } else {
          console.warn('[VoiceSession] Whisper: transcribe API error', res.status);
          this.opts.onInterimTranscript?.('');
        }
      } catch (e) {
        console.warn('[VoiceSession] Whisper: transcribe fetch failed:', e);
        this.opts.onInterimTranscript?.('');
      }
    }

    // Cleanup
    proc?.dispose();
    if (this.audioProc === proc) this.audioProc = null;
    this._stopAudioLevel();
    this.whisperLoopActive = false;
    console.log('[VoiceSession] Whisper loop exited');
  }

  /**
   * Wait for VAD to return `targetState` (true=speech, false=silence) or
   * until `timeoutMs` elapses. Returns true if target state was reached.
   */
  private _waitForVAD(
    analyser: AnalyserNode,
    targetState: boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const id = setInterval(() => {
        if (!this.whisperLoopActive || !this.sessionActive) { clearInterval(id); resolve(false); return; }
        if (Date.now() > deadline) { clearInterval(id); resolve(false); return; }
        if (isSpeechActive(analyser) === targetState) { clearInterval(id); resolve(true); }
      }, VAD_POLL_MS);
    });
  }

  // ─── Private: Browser SpeechRecognition ───────────────────────────────────

  private _startBrowserRecognition(reason: string): void {
    if (this.recognition) return; // already running

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.opts.onError?.('Speech recognition not supported. Please use Chrome or Safari.');
      return;
    }

    // Start audio processor for level monitoring (browser SR manages its own mic)
    this._ensureAudioLevel();

    const r = new SR();
    r.lang = LANG_TO_BCP47[this.opts.lang] || this.opts.lang;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;

    r.onstart = () => console.log(`[VoiceSession] recognition started (${reason})`);

    r.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const t = event.results[i][0].transcript.trim();
          if (t) {
            console.log('[VoiceSession] final transcript:', t.slice(0, 60));
            this.opts.onFinalTranscript(t);
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) this.opts.onInterimTranscript?.(interim);
      this._resetSafetyTimer();
    };

    r.onend = () => {
      console.log(`[VoiceSession] recognition.onend — phase:${this.phase}`);
      if (this.recognition === r) this.recognition = null;
      if (this.sessionActive && this.phase === 'listening') {
        this._resetSafetyTimer();
        this.restartTimer = setTimeout(() => {
          if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
            this._startRecognition('onend restart');
          }
        }, ONEND_RESTART_MS);
      }
    };

    r.onerror = (event: any) => {
      console.log(`[VoiceSession] recognition.onerror: ${event.error}`);
      if (this.recognition === r) this.recognition = null;

      if (event.error === 'no-speech') {
        if (this.sessionActive && this.phase === 'listening') {
          this._resetSafetyTimer();
          this.restartTimer = setTimeout(() => {
            if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
              this._startRecognition('no-speech restart');
            }
          }, NO_SPEECH_RESTART_MS);
        }
        return;
      }

      if (event.error === 'not-allowed') {
        this.sessionActive = false;
        this._setPhase('idle');
        this.opts.onError?.('Microphone access denied. Please refresh and allow microphone access.');
        return;
      }

      if (event.error === 'aborted') return;

      // Transient errors — retry
      console.warn(`[VoiceSession] transient error "${event.error}" — scheduling recovery`);
      if (this.sessionActive && this.phase === 'listening') {
        this.restartTimer = setTimeout(() => {
          if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
            this._startRecognition(`recovery:${event.error}`);
          }
        }, 800);
      }
    };

    this.recognition = r;
    try {
      r.start();
    } catch (e) {
      console.warn('[VoiceSession] recognition.start() threw:', e);
      this.recognition = null;
      if (this.sessionActive && this.phase === 'listening') {
        this.restartTimer = setTimeout(() => {
          if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
            this._startRecognition('start-threw recovery');
          }
        }, 1200);
      }
    }
  }

  // ─── Private: audio level monitoring ──────────────────────────────────────

  /** Start a separate getUserMedia stream just for the analyser in browser SR mode. */
  private async _ensureAudioLevel(): Promise<void> {
    if (!this.opts.onAudioLevel) return;
    if (this.audioProc) return; // already have one
    try {
      const proc = await buildAudioProcessor();
      this.audioProc = proc;
      this._startAudioLevel(proc.analyserNode);
    } catch {
      // Not critical — orb just won't animate
    }
  }

  private _startAudioLevel(analyser: AnalyserNode): void {
    if (!this.opts.onAudioLevel) return;
    this._stopAudioLevel();

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!this.sessionActive || this.phase !== 'listening') {
        this.levelRafId = null;
        this.opts.onAudioLevel?.(0);
        return;
      }
      analyser.getByteFrequencyData(data);
      const lo = Math.floor(data.length * 0.10);
      const hi = Math.floor(data.length * 0.50);
      const slice = data.slice(lo, hi);
      const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
      const level = Math.min(100, Math.round((avg / 255) * 100 * 2.5)); // boost for UI
      this.opts.onAudioLevel?.(level);
      this.levelRafId = requestAnimationFrame(tick);
    };
    this.levelRafId = requestAnimationFrame(tick);
  }

  private _stopAudioLevel(): void {
    if (this.levelRafId != null) {
      cancelAnimationFrame(this.levelRafId);
      this.levelRafId = null;
    }
    this.opts.onAudioLevel?.(0);
    // Release audio processor if we own one and we're not in a Whisper loop
    if (this.audioProc && !this.whisperLoopActive) {
      try { this.audioProc.dispose(); } catch {}
      this.audioProc = null;
    }
  }

  // ─── Private: barge-in ────────────────────────────────────────────────────

  /**
   * Monitors VAD during TTS playback. If speech sustained for BARGE_IN_THRESHOLD_MS,
   * stop TTS so the mic can open for the user's response.
   */
  private _startBargeIn(): void {
    if (!this.opts.bargeIn) return;
    let speechMs = 0;

    this.bargeInInterval = setInterval(() => {
      if (!this.sessionActive || this.phase !== 'speaking' || !this.audioProc) return;

      if (isSpeechActive(this.audioProc.analyserNode, BARGE_IN_VAD_THRESHOLD)) {
        speechMs += VAD_POLL_MS;
        if (speechMs >= BARGE_IN_THRESHOLD_MS) {
          console.log('[VoiceSession] Barge-in detected — cutting TTS');
          this.bargeInTriggered = true;
          this._stopAudio();
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
          this._stopBargeIn();
        }
      } else {
        speechMs = 0; // reset on silence
      }
    }, VAD_POLL_MS);

    // For barge-in we need the analyser. Start it if not already running.
    if (!this.audioProc) {
      buildAudioProcessor().then((proc) => {
        this.audioProc = proc;
      }).catch(() => {});
    }
  }

  private _stopBargeIn(): void {
    if (this.bargeInInterval) { clearInterval(this.bargeInInterval); this.bargeInInterval = null; }
    if (this.bargeInTimer)    { clearTimeout(this.bargeInTimer); this.bargeInTimer = null; }
  }

  // ─── Private: TTS playback ────────────────────────────────────────────────

  private static _cleanForTTS(raw: string): string {
    return raw
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6}\s+/gm, '')
      .replace(/^[\s]*[•\-\*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private _exitSpeaking(): void {
    if (!this.sessionActive) { this._setPhase('idle'); return; }
    this._setPhase('listening');
    this.restartTimer = setTimeout(() => {
      if (this.sessionActive && this.phase === 'listening' && !this.recognition && !this.whisperLoopActive) {
        this._startRecognition('_exitSpeaking()');
        this._resetSafetyTimer();
      }
    }, MIC_RESUME_DELAY_MS);
  }

  private _playBuffer(buf: ArrayBuffer): Promise<void> {
    this._stopAudio();
    return new Promise<void>(async (resolve, reject) => {
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url  = URL.createObjectURL(blob);
      const audio = this.audioEl ?? new Audio();
      this.audioEl = audio;
      if (audio.src?.startsWith('blob:')) { try { URL.revokeObjectURL(audio.src); } catch {} }

      const cleanup = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = cleanup;
      audio.onerror = null;
      this.stopCurrentAudio = () => { try { audio.pause(); } catch {} cleanup(); };

      audio.src = url;
      audio.load();
      try {
        await audio.play();
        audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('<audio> error')); };
        return;
      } catch {
        URL.revokeObjectURL(url);
        this.stopCurrentAudio = null;
      }

      // Web Audio API fallback
      const ctx = this.audioCtx;
      if (ctx) {
        if (ctx.state !== 'running') await ctx.resume().catch(() => {});
        if (ctx.state === 'running') {
          try {
            const decoded = await ctx.decodeAudioData(buf.slice(0));
            const source  = ctx.createBufferSource();
            source.buffer = decoded;
            source.connect(ctx.destination);
            this.audioSource = source;
            this.stopCurrentAudio = () => { try { source.stop(); } catch {} resolve(); };
            source.onended = () => { if (this.audioSource === source) this.audioSource = null; resolve(); };
            source.start(0);
            return;
          } catch {}
        }
      }

      reject(new Error('Audio playback failed on all paths'));
    });
  }

  private _stopAudio(): void {
    if (this.stopCurrentAudio) { this.stopCurrentAudio(); this.stopCurrentAudio = null; }
    this.audioSource = null;
  }

  private _browserSpeak(text: string, lang: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const bcp47  = LANG_TO_BCP47[lang] || lang;
      const prefix = bcp47.split('-')[0];
      const voices = this.cachedVoices.length ? this.cachedVoices : window.speechSynthesis.getVoices();
      const byLang = voices.filter(v => v.lang.startsWith(prefix));
      const quality = ['enhanced','premium','natural','siri','samantha','eloquence'];
      let voice: SpeechSynthesisVoice | null = null;
      for (const q of quality) {
        const m = byLang.find(v => v.name.toLowerCase().includes(q));
        if (m) { voice = m; break; }
      }
      if (!voice) voice = byLang[0] ?? null;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = bcp47;
      u.rate  = this.opts.speechSpeed ?? 0.95;
      u.pitch = 1.05;
      u.volume = 1;
      if (voice) u.voice = voice;
      u.onend  = () => resolve();
      u.onerror = () => resolve();
      setTimeout(() => resolve(), 10_000);
      window.speechSynthesis.speak(u);
    });
  }

  // ─── Private: timers ──────────────────────────────────────────────────────

  private _abortRecognition(reason: string): void {
    this.whisperLoopActive = false;
    if (!this.recognition) return;
    console.log(`[VoiceSession] aborting recognition (${reason})`);
    try { this.recognition.abort(); } catch {}
    this.recognition = null;
  }

  private _setPhase(p: VoicePhase): void {
    if (this.phase === p) return;
    console.log(`[VoiceSession] phase: ${this.phase} → ${p}`);
    this.phase = p;
    this.opts.onPhaseChange?.(p);
  }

  private _resetSafetyTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      console.warn('[VoiceSession] 10-min safety timeout — stopping session');
      this.stop();
    }, SAFETY_IDLE_TIMEOUT_MS);
  }

  private _clearAllTimers(): void {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.safetyTimer)  { clearTimeout(this.safetyTimer);  this.safetyTimer  = null; }
  }

  private _cacheVoices(): void {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.cachedVoices = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }
}
