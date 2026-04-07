/**
 * junoAudioEngine.ts
 * Main entry point for all Juno audio output.
 *
 * Usage:
 *   junoUnlock()              — call inside a tap handler to unlock audio
 *   junoSpeak(text, lang?)    — fetch TTS and play using adaptive engine
 *   junoStop()                — cancel current playback
 *
 * The adaptive engine (adaptiveTTS) monitors EdgeTTS response latency and
 * automatically falls back to the browser's built-in SpeechSynthesis when
 * the server is slow, then recovers silently when EdgeTTS is fast again.
 * The user's calibrated speed setting is always honoured regardless of source.
 */

import { unlockAudioContext } from "./audioContext";
import { getSelectedVoice } from "./voiceStore";
import { adaptiveTTS } from "./adaptiveTTS";

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
  adaptiveTTS.stop();
}

/**
 * Fetch TTS audio for `text` and play it through the adaptive audio engine.
 * Automatically falls back to browser SpeechSynthesis if the server is slow,
 * and recovers to EdgeTTS as soon as latency improves.
 *
 * @param text   The text Juno should speak.
 * @param lang   Language code (e.g. "en", "es", "fr"). Defaults to "en".
 * @param voice  OpenAI voice ID. Defaults to the user's selected voice.
 */
export async function junoSpeak(text: string, lang = "en", voice?: string): Promise<void> {
  if (!text.trim()) return;

  const resolvedVoice = voice || getSelectedVoice();
  console.log(
    "[JunoAudio] junoSpeak() →",
    text.slice(0, 80),
    `| voice: ${resolvedVoice} | lang: ${lang} | engine-health: ${adaptiveTTS.health}`,
  );

  await adaptiveTTS.speak(text, lang, resolvedVoice);
}
