/**
 * voiceGuard.ts
 *
 * Singleton that enforces three invariants across the entire app:
 *
 * 1. SESSION EXCLUSIVITY
 *    Only one component can own the microphone at a time.
 *    Calling claim() from a new owner force-stops the current holder.
 *
 * 2. ECHO SUPPRESSION
 *    Every TTS response is registered here. Any incoming transcript
 *    that has >50% word overlap with recent TTS (within 6 s) is
 *    flagged as echo and must be discarded by the caller.
 *
 * 3. PERMISSION TRACKING
 *    Caches the browser's microphone permission state and exposes
 *    a synchronous check so callers never have to async-query it.
 *
 * Usage:
 *   // claim (returns false if mic is blocked)
 *   const ok = await voiceGuard.claim('voice-page', () => stopSession());
 *
 *   // release when done
 *   voiceGuard.release('voice-page');
 *
 *   // register TTS so echoes can be detected
 *   voiceGuard.registerTTS(text);
 *   voiceGuard.markTTSEnd();
 *
 *   // echo check before calling the API
 *   if (voiceGuard.isEcho(transcript)) return;
 */

type ReleaseCallback = () => void;

interface TTSEntry {
  words: Set<string>;
  ts: number;
}

class VoiceGuard {
  private _owner: string | null = null;
  private _release: ReleaseCallback | null = null;
  private _permState: PermissionState | null = null;
  private _ttsHistory: TTSEntry[] = [];
  private _permStatus: PermissionStatus | null = null;

  constructor() {
    this._watchPermission();
  }

  // ── Session exclusivity ───────────────────────────────────────────────────

  /**
   * Claim exclusive mic access.
   * @param ownerId    Stable string identifier for the caller (e.g. 'voice-page').
   * @param onRelease  Called when another owner claims or you call release() yourself.
   * @returns true if the claim succeeded (mic permission not denied).
   */
  async claim(ownerId: string, onRelease: ReleaseCallback): Promise<boolean> {
    if (this._permState === 'denied') {
      console.warn(`[VoiceGuard] claim("${ownerId}") rejected — mic permission denied`);
      return false;
    }

    if (this._owner && this._owner !== ownerId) {
      console.log(`[VoiceGuard] "${ownerId}" claiming — force-releasing "${this._owner}"`);
      this._forceRelease();
    }

    this._owner = ownerId;
    this._release = onRelease;
    console.log(`[VoiceGuard] "${ownerId}" now owns the session`);
    return true;
  }

  /** Release the session. No-op if the caller is not the current owner. */
  release(ownerId: string): void {
    if (this._owner !== ownerId) return;
    this._owner = null;
    this._release = null;
    console.log(`[VoiceGuard] "${ownerId}" released the session`);
  }

  get currentOwner(): string | null { return this._owner; }
  get isActive(): boolean { return this._owner !== null; }

  private _forceRelease(): void {
    const cb = this._release;
    this._owner = null;
    this._release = null;
    try { cb?.(); } catch {}
  }

  // ── Echo suppression ──────────────────────────────────────────────────────

  /**
   * Register text that is about to be spoken by TTS so its words can be
   * compared against incoming transcripts for echo detection.
   */
  registerTTS(text: string): void {
    const words = new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
    );
    this._ttsHistory.push({ words, ts: Date.now() });
    // Keep only the last 12 seconds of TTS history
    this._pruneHistory();
  }

  /** Call when TTS audio finishes playing — refreshes echo window. */
  markTTSEnd(): void {
    // Entries are timestamped on register; re-stamp the latest to extend the window.
    const last = this._ttsHistory[this._ttsHistory.length - 1];
    if (last) last.ts = Date.now();
  }

  /**
   * Returns true when the transcript is likely a TTS echo.
   * Callers MUST discard the transcript if this returns true.
   */
  isEcho(transcript: string): boolean {
    this._pruneHistory();
    if (!this._ttsHistory.length) return false;

    const transcriptWords = transcript
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    if (transcriptWords.length < 2) return false; // too short to compare meaningfully

    for (const entry of this._ttsHistory) {
      const overlap = transcriptWords.filter(w => entry.words.has(w)).length;
      const ratio = overlap / transcriptWords.length;
      if (ratio >= 0.5) {
        console.warn(
          `[VoiceGuard] Echo suppressed — ${Math.round(ratio * 100)}% overlap: "${transcript.slice(0, 60)}"`
        );
        return true;
      }
    }
    return false;
  }

  private _pruneHistory(): void {
    const cutoff = Date.now() - 6_000; // 6-second echo window
    this._ttsHistory = this._ttsHistory.filter(e => e.ts > cutoff);
  }

  // ── Permission tracking ───────────────────────────────────────────────────

  get permissionState(): PermissionState | null { return this._permState; }
  get isPermissionDenied(): boolean { return this._permState === 'denied'; }
  get isPermissionGranted(): boolean { return this._permState === 'granted'; }

  private async _watchPermission(): Promise<void> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      this._permStatus = status;
      this._permState = status.state;
      status.addEventListener('change', () => {
        this._permState = status.state;
        console.log(`[VoiceGuard] Mic permission changed → ${status.state}`);
        // If permission is revoked while a session is active, force-stop it
        if (status.state === 'denied' && this._owner) {
          console.warn(`[VoiceGuard] Permission revoked — force-releasing "${this._owner}"`);
          this._forceRelease();
        }
      });
      console.log(`[VoiceGuard] Initial mic permission: ${status.state}`);
    } catch {
      // navigator.permissions not supported (some mobile browsers) — assume prompt
      this._permState = null;
    }
  }
}

export const voiceGuard = new VoiceGuard();
