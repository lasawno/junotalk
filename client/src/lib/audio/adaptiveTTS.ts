/**
 * adaptiveTTS.ts
 *
 * Self-healing TTS engine. Monitors EdgeTTS response latency in real time and
 * automatically routes to the fastest available voice source so the user's
 * calibrated voice settings always play at the right speed — no bottlenecks.
 *
 * Priority:
 *   1. EdgeTTS   — best quality, used when server responds within EDGE_TIMEOUT
 *   2. Browser SpeechSynthesis — instant, zero-network, used as fallback
 *
 * Recovery: after each fallback the next request retries EdgeTTS. If it is
 * fast again the engine silently upgrades back to EdgeTTS.
 */

import { queuePlay, stopAll } from "./audioQueue";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const TTS_ENDPOINT = "/api/v1/tts";

/** How long to wait for EdgeTTS before giving up and using browser TTS (ms). */
const EDGE_TIMEOUT = 4_000;

/** Rolling window size for latency averaging. */
const WINDOW = 6;

/** Below this average (ms) → connection is healthy, always use EdgeTTS. */
const HEALTHY_THRESHOLD = 1_500;

/** Above this average (ms) → connection is poor, skip EdgeTTS probing. */
const POOR_THRESHOLD = 5_000;

type Source = "edge" | "browser";
type Health = "good" | "degraded" | "poor";

interface Sample {
  ms: number;
  source: Source;
}

class AdaptiveTTSEngine {
  private history: Sample[] = [];
  private consecutiveFallbacks = 0;

  // ── preferred speed ──────────────────────────────────────────────────────

  /** Read the user's calibrated speed from localStorage (default 1.05). */
  private get preferredSpeed(): number {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.speed);
      return v ? parseFloat(v) : 1.05;
    } catch {
      return 1.05;
    }
  }

  // ── connection health ────────────────────────────────────────────────────

  private get avgLatency(): number {
    if (!this.history.length) return 0;
    const slice = this.history.slice(-WINDOW);
    return slice.reduce((s, r) => s + r.ms, 0) / slice.length;
  }

  get health(): Health {
    const avg = this.avgLatency;
    if (avg === 0 || avg < HEALTHY_THRESHOLD) return "good";
    if (avg < POOR_THRESHOLD) return "degraded";
    return "poor";
  }

  private record(ms: number, source: Source) {
    this.history.push({ ms, source });
    if (this.history.length > WINDOW * 2) this.history = this.history.slice(-WINDOW);
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Speak `text` using the fastest available voice source.
   * Always honours the user's calibrated speed setting.
   */
  async speak(
    text: string,
    lang = "en",
    voice?: string,
    speedOverride?: number,
  ): Promise<void> {
    if (!text.trim()) return;

    const speed = speedOverride ?? this.preferredSpeed;

    // If health is known poor after multiple failures, skip EdgeTTS probing
    // and go straight to browser TTS to avoid any perceptible delay.
    if (this.health === "poor" && this.consecutiveFallbacks >= 3) {
      console.log("[AdaptiveTTS] Connection poor — using browser TTS immediately");
      await this.browserSpeak(text, lang, speed);
      return;
    }

    // Attempt EdgeTTS with a hard timeout.
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EDGE_TIMEOUT);

    try {
      const res = await fetch(TTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ text, voice, lang, speed }),
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`EdgeTTS HTTP ${res.status}`);

      const buf = await res.arrayBuffer();
      if (!buf.byteLength) throw new Error("EdgeTTS returned empty buffer");

      const latency = performance.now() - t0;
      this.record(latency, "edge");
      this.consecutiveFallbacks = 0;

      console.log(
        `[AdaptiveTTS] EdgeTTS OK — ${latency.toFixed(0)} ms | health: ${this.health}`,
      );

      await queuePlay(buf);
    } catch (err: any) {
      clearTimeout(timer);
      const latency = performance.now() - t0;

      // Use a large sentinel latency for aborts so the health score degrades
      // quickly but recovers the moment EdgeTTS is fast again.
      const recorded = controller.signal.aborted ? EDGE_TIMEOUT : latency;
      this.record(recorded, "browser");
      this.consecutiveFallbacks++;

      console.warn(
        `[AdaptiveTTS] EdgeTTS failed (${latency.toFixed(0)} ms, ${err?.message ?? err}) — ` +
          `falling back to browser TTS | consecutive fallbacks: ${this.consecutiveFallbacks}`,
      );

      await this.browserSpeak(text, lang, speed);
    }
  }

  stop(): void {
    stopAll();
    try { window.speechSynthesis?.cancel(); } catch {}
  }

  /** Diagnostic snapshot — useful for dev overlays or console inspection. */
  status() {
    return {
      health: this.health,
      avgLatencyMs: Math.round(this.avgLatency),
      consecutiveFallbacks: this.consecutiveFallbacks,
      samples: this.history.length,
    };
  }

  // ── browser SpeechSynthesis ──────────────────────────────────────────────

  private browserSpeak(text: string, lang: string, speed: number): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) { resolve(); return; }

      synth.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      utter.rate = speed;   // honours the user's calibrated speed
      utter.pitch = 1.0;
      utter.volume = 1.0;

      // Prefer a natural-sounding voice that matches the language.
      const voices = synth.getVoices();
      const match =
        voices.find(v => v.lang.startsWith(lang) && v.localService) ||
        voices.find(v => v.lang.startsWith(lang));
      if (match) utter.voice = match;

      utter.onend = () => resolve();
      utter.onerror = () => resolve();

      synth.speak(utter);
    });
  }
}

/** Singleton — import and use across the entire app. */
export const adaptiveTTS = new AdaptiveTTSEngine();
