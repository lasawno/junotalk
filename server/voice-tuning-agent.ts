/**
 * voice-tuning-agent.ts
 *
 * Autonomous background agent that continuously monitors every TTS call
 * across the entire app (Juno voice overlay, voice-translate, any future
 * voice surface) and self-tunes the synthesis parameters so Juno's voice
 * stays as natural and reliable as possible — automatically, forever.
 *
 * What it controls:
 *   styledegree      — intensity of the SSML mstts:express-as "assistant" style (1.0–2.0)
 *   sentenceBreakMs  — pause after . ! ? (200–500 ms)
 *   commaBreakMs     — pause after , ; (80–200 ms)
 *   ellipsisBreakMs  — pause after — … (150–350 ms)
 *
 * Tuning logic (runs every TUNE_INTERVAL_MS):
 *   • Error rate > 20%   → simplify SSML (reduce styledegree + shorten breaks)
 *   • Error rate < 5% AND avg latency < 2 s → try nudging quality up
 *   • Avg latency > 3 s AND error rate < 5% → keep params, don't push quality
 *   After every cycle → push winning config to GitHub CDN
 *
 * CDN path: config/voice-tuning.json
 *
 * Runs in parallel with all other voice pipelines. Zero blocking.
 */

import { fetchPrivateFile, pushPrivateFile } from "./github-config";

// ── Constants ──────────────────────────────────────────────────────────────────

const CDN_PATH               = "config/voice-tuning.json";
const TUNE_INTERVAL_MS       = 30 * 60 * 1000;  // 30-min background timer (catches idle periods)
const FIRST_TUNE_DELAY       = 60 * 1000;        // first background cycle 60s after startup
const WINDOW_SIZE            = 200;              // rolling window of last N TTS calls
const SESSION_TUNE_THRESHOLD = 8;               // tune after this many samples (covers 3-5 min session)
const MIN_TUNE_GAP_MS        = 90 * 1000;        // never re-tune more often than every 90s
const LOG_PREFIX             = "[VoiceTuningAgent]";

// ── Param bounds ───────────────────────────────────────────────────────────────

const BOUNDS = {
  styledegree:     { min: 1.0, max: 2.0, step: 0.1 },
  sentenceBreakMs: { min: 200, max: 500, step: 25  },
  commaBreakMs:    { min: 80,  max: 200, step: 10  },
  ellipsisBreakMs: { min: 150, max: 350, step: 25  },
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VoiceParams {
  styledegree:     number;
  sentenceBreakMs: number;
  commaBreakMs:    number;
  ellipsisBreakMs: number;
}

interface TTSSample {
  latencyMs: number;
  success:   boolean;
  engine:    "edge" | "browser" | "openai";
  ts:        number;
}

interface CdnPayload {
  version:      string;
  updatedAt:    string;
  params:       VoiceParams;
  metrics: {
    avgLatencyMs: number;
    errorRate:    number;
    sampleCount:  number;
  };
  tuningCycles: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: VoiceParams = {
  styledegree:     1.8,
  sentenceBreakMs: 350,
  commaBreakMs:    120,
  ellipsisBreakMs: 250,
};

// ── Agent class ────────────────────────────────────────────────────────────────

class VoiceTuningAgent {
  private params:       VoiceParams = { ...DEFAULT_PARAMS };
  private samples:      TTSSample[] = [];
  private tuningCycles: number = 0;
  private timer:        ReturnType<typeof setTimeout> | null = null;
  private running       = false;
  private lastTuneAt:   number = 0;

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Called by tts.controller after every synthesis attempt. */
  recordResult(latencyMs: number, success: boolean, engine: "edge" | "browser" | "openai"): void {
    this.samples.push({ latencyMs, success, engine, ts: Date.now() });
    if (this.samples.length > WINDOW_SIZE) {
      this.samples = this.samples.slice(-WINDOW_SIZE);
    }

    // Session-aware threshold tune: fires when a voice session has generated
    // enough samples (covers the 3–5 min runtime window) and enough time has
    // passed since the last tune so we never spam the CDN.
    const sinceLastTune = Date.now() - this.lastTuneAt;
    if (this.samples.length >= SESSION_TUNE_THRESHOLD && sinceLastTune >= MIN_TUNE_GAP_MS) {
      this.tune("session");
    }
  }

  /** Returns the currently optimised params. Passed to EdgeTTS on every request. */
  getCurrentParams(): VoiceParams {
    return { ...this.params };
  }

  /** Start the agent — load CDN config, then begin the tuning loop. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Load last winning config from CDN so we start from wherever we left off
    await this.loadFromCDN();

    // First tune fires after FIRST_TUNE_DELAY, then every TUNE_INTERVAL_MS
    this.timer = setTimeout(() => {
      this.tune();
      setInterval(() => this.tune(), TUNE_INTERVAL_MS);
    }, FIRST_TUNE_DELAY);

    console.log(
      `${LOG_PREFIX} Started — current params: styledegree=${this.params.styledegree} ` +
      `sentenceBreak=${this.params.sentenceBreakMs}ms commaBreak=${this.params.commaBreakMs}ms ` +
      `| session-tune: every ${SESSION_TUNE_THRESHOLD} samples (≥90s gap) | timer: every 30 min`
    );
  }

  // ── Tuning cycle ──────────────────────────────────────────────────────────

  private tune(trigger: "timer" | "session" = "timer"): void {
    this.lastTuneAt = Date.now();
    const { errorRate, avgLatencyMs, sampleCount } = this.computeMetrics();

    if (sampleCount < 5) {
      console.log(`${LOG_PREFIX} Skipping ${trigger} tune — only ${sampleCount} samples`);
      return;
    }
    console.log(`${LOG_PREFIX} Tune triggered by: ${trigger} | samples=${sampleCount} err=${(errorRate * 100).toFixed(1)}% lat=${avgLatencyMs.toFixed(0)}ms`);

    const prev = { ...this.params };

    if (errorRate > 0.20) {
      // Too many errors → SSML is too complex, simplify immediately
      this.params.styledegree     = clamp(this.params.styledegree     - BOUNDS.styledegree.step,     BOUNDS.styledegree);
      this.params.sentenceBreakMs = clamp(this.params.sentenceBreakMs - BOUNDS.sentenceBreakMs.step, BOUNDS.sentenceBreakMs);
      this.params.commaBreakMs    = clamp(this.params.commaBreakMs    - BOUNDS.commaBreakMs.step,    BOUNDS.commaBreakMs);
      this.params.ellipsisBreakMs = clamp(this.params.ellipsisBreakMs - BOUNDS.ellipsisBreakMs.step, BOUNDS.ellipsisBreakMs);
      console.log(`${LOG_PREFIX} High error rate (${(errorRate * 100).toFixed(1)}%) — simplified SSML`);

    } else if (errorRate < 0.05 && avgLatencyMs < 2000) {
      // Performing well → nudge quality upward
      this.params.styledegree     = clamp(this.params.styledegree     + BOUNDS.styledegree.step,     BOUNDS.styledegree);
      this.params.sentenceBreakMs = clamp(this.params.sentenceBreakMs + BOUNDS.sentenceBreakMs.step, BOUNDS.sentenceBreakMs);
      this.params.commaBreakMs    = clamp(this.params.commaBreakMs    + BOUNDS.commaBreakMs.step,    BOUNDS.commaBreakMs);
      this.params.ellipsisBreakMs = clamp(this.params.ellipsisBreakMs + BOUNDS.ellipsisBreakMs.step, BOUNDS.ellipsisBreakMs);
      console.log(`${LOG_PREFIX} Performance good (err=${(errorRate * 100).toFixed(1)}% lat=${avgLatencyMs.toFixed(0)}ms) — nudged quality up`);

    } else if (avgLatencyMs > 3000 && errorRate < 0.05) {
      // Slow but stable → don't degrade, just hold current params
      console.log(`${LOG_PREFIX} High latency (${avgLatencyMs.toFixed(0)}ms) but stable — holding params`);

    } else {
      console.log(`${LOG_PREFIX} Params stable — no change (err=${(errorRate * 100).toFixed(1)}% lat=${avgLatencyMs.toFixed(0)}ms)`);
    }

    this.tuningCycles++;

    // Log what changed
    const changed = (Object.keys(this.params) as (keyof VoiceParams)[])
      .filter(k => this.params[k] !== prev[k])
      .map(k => `${k}: ${prev[k]} → ${this.params[k]}`);

    if (changed.length > 0) {
      console.log(`${LOG_PREFIX} Param changes: ${changed.join(", ")}`);
    }

    // Clear samples so next window is fresh
    this.samples = [];

    // Persist to CDN (non-blocking)
    this.pushToCDN({ errorRate, avgLatencyMs, sampleCount }).catch(() => {});
  }

  // ── CDN operations ────────────────────────────────────────────────────────

  private async loadFromCDN(): Promise<void> {
    try {
      const data = await fetchPrivateFile(CDN_PATH) as CdnPayload | null;
      if (data?.params) {
        this.params = {
          styledegree:     clamp(data.params.styledegree     ?? DEFAULT_PARAMS.styledegree,     BOUNDS.styledegree),
          sentenceBreakMs: clamp(data.params.sentenceBreakMs ?? DEFAULT_PARAMS.sentenceBreakMs, BOUNDS.sentenceBreakMs),
          commaBreakMs:    clamp(data.params.commaBreakMs    ?? DEFAULT_PARAMS.commaBreakMs,    BOUNDS.commaBreakMs),
          ellipsisBreakMs: clamp(data.params.ellipsisBreakMs ?? DEFAULT_PARAMS.ellipsisBreakMs, BOUNDS.ellipsisBreakMs),
        };
        this.tuningCycles = data.tuningCycles ?? 0;
        console.log(`${LOG_PREFIX} CDN config loaded — styledegree=${this.params.styledegree} cycles=${this.tuningCycles}`);
      } else {
        console.log(`${LOG_PREFIX} No CDN config found — using defaults`);
      }
    } catch (e: any) {
      console.log(`${LOG_PREFIX} CDN load failed (${e?.message ?? e}) — using defaults`);
    }
  }

  private async pushToCDN(metrics: { errorRate: number; avgLatencyMs: number; sampleCount: number }): Promise<void> {
    const payload: CdnPayload = {
      version:     "1.0.0",
      updatedAt:   new Date().toISOString(),
      params:      { ...this.params },
      metrics:     {
        avgLatencyMs: Math.round(metrics.avgLatencyMs),
        errorRate:    parseFloat(metrics.errorRate.toFixed(4)),
        sampleCount:  metrics.sampleCount,
      },
      tuningCycles: this.tuningCycles,
    };

    const ok = await pushPrivateFile(
      CDN_PATH,
      payload,
      `[VoiceTuningAgent] cycle ${this.tuningCycles} — styledegree=${this.params.styledegree} err=${(metrics.errorRate * 100).toFixed(1)}%`
    );

    if (ok) {
      console.log(`${LOG_PREFIX} Config pushed to CDN (cycle ${this.tuningCycles})`);
    } else {
      console.warn(`${LOG_PREFIX} CDN push failed — will retry next cycle`);
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  private computeMetrics(): { errorRate: number; avgLatencyMs: number; sampleCount: number } {
    const sampleCount = this.samples.length;
    if (!sampleCount) return { errorRate: 0, avgLatencyMs: 0, sampleCount: 0 };

    const errors = this.samples.filter(s => !s.success).length;
    const successLatencies = this.samples.filter(s => s.success).map(s => s.latencyMs);
    const avgLatencyMs = successLatencies.length
      ? successLatencies.reduce((a, b) => a + b, 0) / successLatencies.length
      : 0;

    return {
      errorRate:    errors / sampleCount,
      avgLatencyMs: Math.round(avgLatencyMs),
      sampleCount,
    };
  }

  /** Snapshot for diagnostics / health checks. */
  getStatus() {
    const { errorRate, avgLatencyMs, sampleCount } = this.computeMetrics();
    return {
      params:       { ...this.params },
      tuningCycles: this.tuningCycles,
      window:       { sampleCount, avgLatencyMs: Math.round(avgLatencyMs), errorRate: parseFloat((errorRate * 100).toFixed(1)) },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, parseFloat(value.toFixed(2))));
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const voiceTuningAgent = new VoiceTuningAgent();

export function startVoiceTuningAgent(): void {
  voiceTuningAgent.start().catch(e => {
    console.warn("[VoiceTuningAgent] Failed to start:", e?.message ?? e);
  });
}
