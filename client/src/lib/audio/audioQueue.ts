/**
 * audioQueue.ts
 * Serialized playback queue — prevents overlap and allows cancel.
 * Each new item cancels the previous one immediately before playing.
 */

import { playBuffer, type PlaybackHandle } from "./audioPlayer";

let _current: PlaybackHandle | null = null;

/**
 * Stop whatever is currently playing, then play the given buffer.
 * Returns a Promise that resolves when this playback finishes.
 */
export async function queuePlay(buf: ArrayBuffer): Promise<void> {
  // Cancel any in-progress audio immediately
  if (_current) {
    console.log("[JunoAudio] Stopping previous playback");
    _current.stop();
    _current = null;
  }

  const handle = playBuffer(buf);
  _current = handle;

  try {
    await handle.done;
  } finally {
    if (_current === handle) _current = null;
  }
}

/**
 * Stop current playback and clear the queue.
 */
export function stopAll(): void {
  if (_current) {
    _current.stop();
    _current = null;
    console.log("[JunoAudio] Queue cleared");
  }
}
