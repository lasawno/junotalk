/**
 * audioContext.ts
 * Singleton AudioContext manager — handles creation and Safari resume fix.
 * Must call unlockAudioContext() inside a user gesture before playback.
 */

let _ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
    console.log("[JunoAudio] AudioContext created, state:", _ctx.state);
  }
  return _ctx;
}

/**
 * Call this synchronously inside a user gesture (tap/click) to unlock
 * audio on Safari and Chrome's autoplay-blocked contexts.
 */
export async function unlockAudioContext(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
      console.log("[JunoAudio] AudioContext resumed, state:", ctx.state);
    }
  } catch (e) {
    console.warn("[JunoAudio] AudioContext unlock failed:", e);
  }
}

export function closeAudioContext(): void {
  if (_ctx) {
    try { _ctx.close(); } catch {}
    _ctx = null;
    console.log("[JunoAudio] AudioContext closed");
  }
}
