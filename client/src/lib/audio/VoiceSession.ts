/**
 * VoiceSession.ts
 *
 * A self-contained pipeline for voice-to-voice conversation:
 *   mic (SpeechRecognition) → translate/respond → TTS playback → mic again
 *
 * Core design:
 *  - Single `phase` property is the ONLY thing that decides what can happen next.
 *    No scattered boolean flags that can diverge under race conditions.
 *  - Mic is ALWAYS stopped before TTS plays (mandatory on iOS — device cannot
 *    simultaneously record and play through the Web Audio API).
 *  - TTS always tries the provided `fetchAudio` path first, then falls back to
 *    the browser's built-in SpeechSynthesis API.
 *  - All restarts go through `_startRecognition` so the guards are in one place.
 *
 * Usage:
 *   const session = new VoiceSession({ lang: 'en', onFinalTranscript, ... });
 *   session.unlock();          // call inside a tap handler
 *   session.start();           // begin listening
 *   await session.speak(text); // play TTS (mic auto-pauses / resumes)
 *   session.stop();            // end session
 *   session.destroy();         // cleanup on unmount
 */

export type VoicePhase = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceSessionOptions {
  lang: string;
  speechSpeed?: number;
  voiceId?: string;
  onFinalTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onPhaseChange?: (phase: VoicePhase) => void;
  onError?: (msg: string) => void;
  /**
   * Fetch raw TTS audio as an ArrayBuffer.
   * Should POST to /api/v1/tts and return the response body.
   * Throw on failure — VoiceSession will fall back to SpeechSynthesis.
   */
  fetchAudio: (text: string, lang: string, voiceId: string, speed: number) => Promise<ArrayBuffer>;
}

const MIC_RESUME_DELAY_MS   = 700;
const NO_SPEECH_RESTART_MS  = 350;
const ONEND_RESTART_MS      = 200;
const TTS_SAFETY_TIMEOUT_MS = 25_000;
// After 3 minutes of silence the session auto-stops.
// The timer resets on every speech event so active conversations keep going.
const SAFETY_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

const LANG_TO_BCP47: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA',
  ru: 'ru-RU', hi: 'hi-IN', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR',
  sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI', nb: 'nb-NO', el: 'el-GR',
  he: 'he-IL', th: 'th-TH', vi: 'vi-VN', uk: 'uk-UA', id: 'id-ID',
};

export class VoiceSession {
  private phase: VoicePhase = 'idle';
  private sessionActive = false;
  private opts: VoiceSessionOptions;

  private recognition: any = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  private audioCtx: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private stopCurrentAudio: (() => void) | null = null;

  private cachedVoices: SpeechSynthesisVoice[] = [];

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
    this._cacheVoices();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Call synchronously inside a tap handler to unblock audio on iOS / Safari.
   */
  unlock(): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch {}

    // Prime the <audio> element so play() works without a user gesture later
    if (!this.audioEl) {
      this.audioEl = new Audio();
    }
    const a = this.audioEl;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    a.volume = 0;
    a.play()
      .then(() => { a.pause(); a.volume = 1; })
      .catch(() => {});

    console.log('[VoiceSession] unlock() called');
  }

  /** Begin a listening session. Safe to call multiple times — idempotent. */
  start(): void {
    if (this.sessionActive) return;
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
    this._setPhase('idle');
    this._clearAllTimers();
    this._abortRecognition('stop()');
    this._stopAudio();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /**
   * Play TTS for `text`.
   *  1. Immediately transitions to 'speaking' — mic is aborted synchronously.
   *  2. Resumes AudioContext (iOS suspends it while mic is active).
   *  3. Fetches and plays TTS audio; falls back to SpeechSynthesis on failure.
   *  4. Transitions back to 'listening' and restarts mic after MIC_RESUME_DELAY_MS.
   *
   * Safe to call from async contexts — the phase transition is synchronous so
   * recognition.onend / onerror can see it before any await completes.
   *
   * @param ttsLang  Optional override for the TTS language (e.g. the target language
   *                 when translating). Defaults to the session's recognition language.
   * @param ttsVoiceId  Optional voice override for this utterance.
   */
  async speak(text: string, ttsLang?: string, ttsVoiceId?: string): Promise<void> {
    if (!text.trim()) return;

    const lang      = ttsLang    ?? this.opts.lang;
    const voiceId   = ttsVoiceId ?? this.opts.voiceId ?? 'nova';
    const speechSpeed = this.opts.speechSpeed ?? 0.92;

    // ── Phase transition (synchronous — must be first) ──────────────────────
    this._setPhase('speaking');
    this._clearAllTimers();
    this._abortRecognition('speak()');
    this._stopAudio();

    // ── Resume AudioContext — iOS suspends it when mic is active ────────────
    if (this.audioCtx && this.audioCtx.state !== 'running') {
      await this.audioCtx.resume().catch(() => {});
    }
    console.log('[VoiceSession] speak() — AudioContext state:', this.audioCtx?.state ?? 'none');

    // ── Safety valve — ensure we always leave speaking phase ────────────────
    this.safetyTimer = setTimeout(() => {
      console.warn('[VoiceSession] safety timer fired — forcing phase reset');
      this._exitSpeaking();
    }, TTS_SAFETY_TIMEOUT_MS);

    // ── Attempt TTS fetch → Web Audio / <audio> element ─────────────────────
    let playedOk = false;
    try {
      console.log('[VoiceSession] fetching TTS audio...');
      const buf = await this.opts.fetchAudio(text, lang, voiceId, speechSpeed);
      await this._playBuffer(buf);
      console.log('[VoiceSession] TTS audio finished');
      playedOk = true;
    } catch (e: any) {
      console.warn('[VoiceSession] TTS fetch/play failed:', e?.message ?? e);
    }

    // ── Fallback to browser SpeechSynthesis ─────────────────────────────────
    if (!playedOk) {
      try {
        await this._browserSpeak(text, lang);
        console.log('[VoiceSession] SpeechSynthesis finished');
      } catch (e: any) {
        console.warn('[VoiceSession] SpeechSynthesis also failed:', e?.message ?? e);
      }
    }

    clearTimeout(this.safetyTimer!);
    this.safetyTimer = null;

    this._exitSpeaking();
  }

  /**
   * Pause mic without ending the session — use this when waiting for an AI
   * response so the mic doesn't pick up background noise or the user speaking
   * again before Juno has had a chance to reply.
   *
   * The session stays "alive" (sessionActive=true). Calling speak() after this
   * will transition straight to 'speaking' → 'listening' as normal.
   */
  pauseForProcessing(): void {
    if (!this.sessionActive) return;
    this._clearAllTimers();
    this._abortRecognition('pauseForProcessing()');
    this._setPhase('processing');
    console.log('[VoiceSession] pauseForProcessing() — mic paused while AI thinks');
  }

  /** Update the recognition language (takes effect on next recognition start). */
  setLang(lang: string): void {
    this.opts.lang = lang;
  }

  setVoiceId(id: string): void {
    this.opts.voiceId = id;
  }

  setSpeed(speed: number): void {
    this.opts.speechSpeed = speed;
  }

  getPhase(): VoicePhase {
    return this.phase;
  }

  /** Call on component unmount. */
  destroy(): void {
    this.stop();
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null;
    this.audioEl = null;
    console.log('[VoiceSession] destroyed');
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _setPhase(p: VoicePhase): void {
    if (this.phase === p) return;
    console.log(`[VoiceSession] phase: ${this.phase} → ${p}`);
    this.phase = p;
    this.opts.onPhaseChange?.(p);
  }

  /**
   * Called after TTS finishes (or fails). Decides whether to re-enter listening.
   */
  private _exitSpeaking(): void {
    if (!this.sessionActive) {
      this._setPhase('idle');
      return;
    }
    // Back to listening — give iOS time to fully release the audio session
    this._setPhase('listening');
    this.restartTimer = setTimeout(() => {
      if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
        this._startRecognition('_exitSpeaking()');
        this._resetSafetyTimer();
      }
    }, MIC_RESUME_DELAY_MS);
  }

  private _startRecognition(reason: string): void {
    // Don't allow recognition while speaking or when session is off
    if (!this.sessionActive || this.phase !== 'listening') {
      console.log(`[VoiceSession] _startRecognition(${reason}) skipped — phase:${this.phase} session:${this.sessionActive}`);
      return;
    }
    if (this.recognition) {
      // Already running
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.opts.onError?.('Speech recognition not supported. Please use Chrome or Safari.');
      return;
    }

    const r = new SR();
    r.lang = LANG_TO_BCP47[this.opts.lang] || this.opts.lang;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      console.log(`[VoiceSession] recognition started (${reason})`);
      // Phase was already set to 'listening' before start() was called
    };

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
      // Any actual speech resets the 10-min safety timer
      this._resetSafetyTimer();
    };

    r.onend = () => {
      console.log(`[VoiceSession] recognition.onend — phase:${this.phase} session:${this.sessionActive}`);
      // Null-out only if this is still the active instance
      if (this.recognition === r) this.recognition = null;

      if (this.sessionActive && this.phase === 'listening') {
        // Normal end-of-utterance restart (iOS fires onend after every phrase)
        this._resetSafetyTimer(); // keep the 10-min safety clock alive
        this.restartTimer = setTimeout(() => {
          if (this.sessionActive && this.phase === 'listening' && !this.recognition) {
            this._startRecognition('onend restart');
          }
        }, ONEND_RESTART_MS);
      }
      // If phase is 'speaking', _exitSpeaking() owns the restart
    };

    r.onerror = (event: any) => {
      console.log(`[VoiceSession] recognition.onerror: ${event.error} — phase:${this.phase}`);
      if (this.recognition === r) this.recognition = null;

      if (event.error === 'no-speech') {
        // no-speech is completely normal — the browser times out when it hears
        // silence. Just restart transparently, like ChatGPT voice mode does.
        if (this.sessionActive && this.phase === 'listening') {
          this._resetSafetyTimer(); // silence resets the idle safety clock
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
        this.opts.onError?.('Microphone access denied. Please allow microphone permissions.');
        return;
      }

      if (event.error !== 'aborted') {
        this.opts.onError?.(`Speech recognition error: ${event.error}`);
      }
    };

    this.recognition = r;
    try {
      r.start();
    } catch (e) {
      console.warn('[VoiceSession] recognition.start() threw:', e);
      this.recognition = null;
    }
  }

  private _abortRecognition(reason: string): void {
    if (!this.recognition) return;
    console.log(`[VoiceSession] aborting recognition (${reason})`);
    try { this.recognition.abort(); } catch {}
    this.recognition = null;
  }

  /**
   * Play an ArrayBuffer of audio data.
   * Tries Web Audio API first, falls back to an <audio> element.
   */
  private _playBuffer(buf: ArrayBuffer): Promise<void> {
    this._stopAudio();

    return new Promise<void>(async (resolve, reject) => {
      // ── Web Audio API ──────────────────────────────────────────────────────
      const ctx = this.audioCtx;
      if (ctx) {
        // Always try to resume — iOS suspends after mic releases
        if (ctx.state !== 'running') await ctx.resume().catch(() => {});
        if (ctx.state === 'running') {
          try {
            const decoded = await ctx.decodeAudioData(buf.slice(0));
            const source = ctx.createBufferSource();
            source.buffer = decoded;
            source.connect(ctx.destination);
            this.audioSource = source;
            this.stopCurrentAudio = () => {
              try { source.stop(); } catch {}
              resolve();
            };
            source.onended = () => {
              if (this.audioSource === source) this.audioSource = null;
              resolve();
            };
            source.start(0);
            console.log('[VoiceSession] AudioContext playback started');
            return;
          } catch (e) {
            console.warn('[VoiceSession] AudioContext decode failed, trying <audio>:', e);
          }
        }
      }

      // ── <audio> element fallback ───────────────────────────────────────────
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = this.audioEl ?? new Audio();
      this.audioEl = audio;
      if (audio.src?.startsWith('blob:')) {
        try { URL.revokeObjectURL(audio.src); } catch {}
      }

      const cleanup = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = cleanup;
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('<audio> playback error')); };
      this.stopCurrentAudio = () => { audio.pause(); cleanup(); };

      audio.src = url;
      audio.play()
        .then(() => console.log('[VoiceSession] <audio> playback started'))
        .catch(e => { URL.revokeObjectURL(url); reject(new Error(`<audio>.play() failed: ${e}`)); });
    });
  }

  private _stopAudio(): void {
    if (this.stopCurrentAudio) {
      this.stopCurrentAudio();
      this.stopCurrentAudio = null;
    }
    this.audioSource = null;
  }

  /**
   * Browser SpeechSynthesis fallback — picks the best available voice.
   */
  private _browserSpeak(text: string, lang: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();

      const bcp47 = LANG_TO_BCP47[lang] || lang;
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
      u.rate = this.opts.speechSpeed ?? 0.95;
      u.pitch = 1.05;
      u.volume = 1;
      if (voice) u.voice = voice;

      u.onend = () => resolve();
      u.onerror = () => resolve();
      // Safety — browser sometimes never fires onend
      setTimeout(() => resolve(), 10_000);
      window.speechSynthesis.speak(u);
    });
  }

  /**
   * Reset the 10-minute idle safety timer.
   * Called on start, every restart (no-speech, onend), every speech result,
   * and after every TTS reply. The session NEVER auto-stops from silence —
   * it keeps listening indefinitely like ChatGPT voice mode. This timer is
   * only a last-resort safeguard in case something goes wrong internally.
   */
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
    if (this.safetyTimer)  { clearTimeout(this.safetyTimer);  this.safetyTimer = null; }
  }

  private _cacheVoices(): void {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.cachedVoices = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }
}
