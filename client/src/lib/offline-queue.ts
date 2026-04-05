/**
 * offline-queue.ts
 *
 * IndexedDB-backed queue for content captured while the device is offline.
 * Survives page refresh. Drains automatically when connectivity is restored.
 *
 * Two entry types are supported:
 *
 *  "voice-message"
 *    A room-chat voice recording that couldn't be delivered because the
 *    WebSocket was down and the HTTP fallback also failed.
 *    Payload mirrors the room-messages API body + socket message shape.
 *
 *  "whisper-chunk"
 *    A 5-second audio chunk from the Whisper caption sidecar that couldn't
 *    be transcribed because the network was down during a live call.
 *    Stored as base64 so it survives serialisation through IndexedDB.
 *    On drain, the chunk is sent to /api/transcribe and the resulting text
 *    is dispatched as a "buffered-caption" DOM event for room-call to handle.
 */

const DB_NAME = "junotalk-offline";
const DB_VERSION = 1;
const STORE = "queue";

export type QueueEntryType = "voice-message" | "whisper-chunk";

export interface VoiceMessagePayload {
  roomCode: string;
  fromName: string;
  audioData: string;            // base64 data-URL
  transcription?: string;
  replyTo?: { id: number | string; text: string; fromName: string };
  vanish?: boolean;
}

export interface WhisperChunkPayload {
  roomCode: string;
  audioBase64: string;          // raw base64 (no data-URL prefix)
  mimeType: string;
  extension: string;
}

export interface QueueEntry {
  id?: number;                  // auto-assigned by IndexedDB
  type: QueueEntryType;
  timestamp: number;
  retries: number;
  payload: VoiceMessagePayload | WhisperChunkPayload;
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Add one entry to the persistent queue. */
export async function enqueue(entry: Omit<QueueEntry, "id">): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(entry);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/** Return the number of pending entries. */
export async function getQueueSize(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read all pending entries in insertion order. */
async function getAllEntries(): Promise<QueueEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueueEntry[]);
    req.onerror = () => reject(req.error);
  });
}

/** Remove a successfully delivered entry by its id. */
async function dequeue(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Increment the retry counter on a failed entry (max 3 — then auto-drop). */
async function incrementRetry(entry: QueueEntry): Promise<void> {
  if (entry.id == null) return;
  if (entry.retries >= 3) {
    await dequeue(entry.id);
    return;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put({ ...entry, retries: entry.retries + 1 });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Drain handlers ───────────────────────────────────────────────────────────

export interface DrainHandlers {
  /**
   * Called for each "voice-message" entry.
   * Should send the message to the server and return true on success.
   */
  onVoiceMessage: (payload: VoiceMessagePayload) => Promise<boolean>;

  /**
   * Called for each "whisper-chunk" entry.
   * Should transcribe and return true on success.
   */
  onWhisperChunk: (payload: WhisperChunkPayload) => Promise<boolean>;
}

let _draining = false;

/**
 * Process all queued entries in insertion order.
 * Safe to call multiple times — concurrent runs are coalesced.
 *
 * Emits a "offline-queue-drained" CustomEvent on window when finished
 * (even if some entries failed and were retried/dropped).
 */
export async function drainQueue(handlers: DrainHandlers): Promise<void> {
  if (_draining) return;
  _draining = true;

  try {
    const entries = await getAllEntries();
    for (const entry of entries) {
      if (!navigator.onLine) break; // re-check mid-drain

      let success = false;
      try {
        if (entry.type === "voice-message") {
          success = await handlers.onVoiceMessage(entry.payload as VoiceMessagePayload);
        } else if (entry.type === "whisper-chunk") {
          success = await handlers.onWhisperChunk(entry.payload as WhisperChunkPayload);
        }
      } catch {
        success = false;
      }

      if (success && entry.id != null) {
        await dequeue(entry.id);
      } else {
        await incrementRetry(entry);
      }
    }
  } finally {
    _draining = false;
    window.dispatchEvent(new CustomEvent("offline-queue-drained"));
  }
}

// ── Audio blob ↔ base64 utilities ─────────────────────────────────────────────

/** Convert a Blob to raw base64 (no data-URL prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — store raw base64 only
      resolve(result.split(",")[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Reconstruct a Blob from raw base64. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
