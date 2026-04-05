/**
 * junoAudioEngine.ts
 * Main entry point for all Juno audio output.
 *
 * Usage:
 *   junoUnlock()   — call inside user gesture to pre-approve audio
 *   junoSpeak(text, lang?) — fetch TTS and play
 *   junoStop()     — cancel current playback
 */

import { unlockAudioContext } from "./audioContext";
import { queuePlay, stopAll } from "./audioQueue";

const TTS_ENDPOINT = "/api/v1/tts";

/**
 * Call this synchronously inside a tap/click handler to unlock audio
 * on browsers that enforce autoplay policies (Safari, Chrome).
 */
export async function junoUnlock(): Promise<void> {
  await unlockAudioContext();
}

/**
 * Stop whatever Juno is currently saying.
 */
export function junoStop(): void {
  stopAll();
}

/**
 * Fetch TTS audio for `text` and play it through the audio engine.
 * Cancels any currently playing audio before starting.
 *
 * @param text  The text Juno should speak.
 * @param lang  BCP-47 language code (e.g. "en", "es", "fr"). Defaults to "en".
 */
export async function junoSpeak(text: string, lang = "en"): Promise<void> {
  if (!text.trim()) return;

  console.log("[JunoAudio] junoSpeak() →", text.slice(0, 80));

  let buf: ArrayBuffer;
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text, voice: "nova", lang }),
    });

    console.log("[JunoAudio] TTS status:", res.status);

    if (!res.ok) {
      console.error("[JunoAudio] TTS request failed:", res.status, res.statusText);
      return;
    }

    buf = await res.arrayBuffer();
    if (!buf.byteLength) {
      console.error("[JunoAudio] TTS returned empty buffer");
      return;
    }
  } catch (e) {
    console.error("[JunoAudio] TTS fetch error:", e);
    return;
  }

  await queuePlay(buf);
  console.log("[JunoAudio] Playback complete");
}
