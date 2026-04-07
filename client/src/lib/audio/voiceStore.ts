/**
 * voiceStore.ts
 *
 * Single source of truth for the user's selected TTS voice.
 * All parts of the app (audio engine, voice session, previews) read from here.
 *
 * Valid OpenAI TTS voices: alloy | echo | fable | onyx | nova | shimmer
 */

const STORAGE_KEY = "junotalk_voice";
const VALID_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
const DEFAULT_VOICE = "nova";

let _cached: string | null = null;

/**
 * Get the currently selected voice.
 * Reads from memory cache first, then localStorage.
 */
export function getSelectedVoice(): string {
  if (_cached && VALID_VOICES.has(_cached)) return _cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_VOICES.has(stored)) {
      _cached = stored;
      return stored;
    }
  } catch {}
  return DEFAULT_VOICE;
}

/**
 * Set the selected voice.
 * Writes to memory cache and localStorage immediately.
 */
export function setSelectedVoice(voice: string): void {
  if (!VALID_VOICES.has(voice)) return;
  _cached = voice;
  try {
    localStorage.setItem(STORAGE_KEY, voice);
  } catch {}
}

export const VALID_VOICE_IDS = [...VALID_VOICES];
