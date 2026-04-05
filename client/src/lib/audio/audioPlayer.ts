/**
 * audioPlayer.ts
 * Low-level audio playback — uses Web Audio API with <audio> fallback.
 */

import { getAudioContext } from "./audioContext";

export interface PlaybackHandle {
  /** Resolves when playback ends naturally or is stopped. */
  done: Promise<void>;
  /** Stop playback immediately. */
  stop: () => void;
}

/**
 * Decode and play a raw audio ArrayBuffer through the Web Audio API.
 * Falls back to an <audio> element if decoding fails.
 */
export function playBuffer(buf: ArrayBuffer): PlaybackHandle {
  let stopFn: () => void = () => {};

  const done = new Promise<void>(async (resolve) => {
    // ── Web Audio API path ─────────────────────────────────────────────────
    try {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);

      stopFn = () => {
        try { source.stop(); } catch {}
        resolve();
      };

      source.onended = () => resolve();
      source.start(0);
      console.log("[JunoAudio] AudioContext playback started");
      return;
    } catch (e) {
      console.warn("[JunoAudio] Web Audio failed, using <audio> fallback:", e);
    }

    // ── <audio> element fallback ───────────────────────────────────────────
    const blob = new Blob([buf], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.volume = 1;

    const cleanup = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onended = cleanup;
    audio.onerror = cleanup;

    stopFn = () => {
      audio.pause();
      cleanup();
    };

    audio.src = url;
    audio.play()
      .then(() => console.log("[JunoAudio] <audio> playback started"))
      .catch(e => { console.error("[JunoAudio] <audio> play() failed:", e); cleanup(); });
  });

  return { done, stop: () => stopFn() };
}
