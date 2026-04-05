/**
 * PROPRIETARY AND CONFIDENTIAL
 * JunoTalk Agent Metrics Store
 * Copyright (c) 2024-2026 JunoTalk. All rights reserved.
 *
 * Lightweight, privacy-preserving metrics layer for the Translation Agent.
 * Persists only aggregate counters to Redis — NO conversation content is stored.
 * Designed for external threshold monitoring and auto-scaling triggers.
 */

import { redisGet, redisSet, isRedisAvailable } from "./redis-cache";
import { REDIS_KEYS } from "./brand-keys";

const METRICS_PREFIX = REDIS_KEYS.agentMetricsPrefix;
const METRICS_TTL = 7 * 24 * 60 * 60;

interface MetricsBatch {
  messagesProcessed: number;
  translationsCompleted: number;
  translationsSkipped: number;
  translationsFailed: number;
  cacheHits: number;
  providerCalls: Record<string, number>;
  langPairCounts: Record<string, number>;
  activeRooms: Set<string>;
  avgLatencyMs: number;
  latencySamples: number;
  latencySum: number;
}

const inMemoryBuffer: MetricsBatch = {
  messagesProcessed: 0,
  translationsCompleted: 0,
  translationsSkipped: 0,
  translationsFailed: 0,
  cacheHits: 0,
  providerCalls: {},
  langPairCounts: {},
  activeRooms: new Set(),
  avgLatencyMs: 0,
  latencySamples: 0,
  latencySum: 0,
};

const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastFlushAt = Date.now();

function getHourKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

function getDayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export function recordMessage() {
  inMemoryBuffer.messagesProcessed++;
}

export function recordTranslation(result: "completed" | "skipped" | "failed") {
  if (result === "completed") inMemoryBuffer.translationsCompleted++;
  else if (result === "skipped") inMemoryBuffer.translationsSkipped++;
  else inMemoryBuffer.translationsFailed++;
}

export function recordCacheHit() {
  inMemoryBuffer.cacheHits++;
}

export function recordProviderUsage(provider: string) {
  inMemoryBuffer.providerCalls[provider] = (inMemoryBuffer.providerCalls[provider] || 0) + 1;
}

export function recordLangPair(sourceLang: string, targetLang: string) {
  const pair = `${sourceLang}→${targetLang}`;
  inMemoryBuffer.langPairCounts[pair] = (inMemoryBuffer.langPairCounts[pair] || 0) + 1;
}

export function recordActiveRoom(roomCode: string) {
  inMemoryBuffer.activeRooms.add(roomCode);
}

export function recordLatency(ms: number) {
  inMemoryBuffer.latencySamples++;
  inMemoryBuffer.latencySum += ms;
  inMemoryBuffer.avgLatencyMs = Math.round(inMemoryBuffer.latencySum / inMemoryBuffer.latencySamples);
}

const queueMetricsBuffer = {
  jobsStarted: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  jobsRetried: 0,
  jobsSkipped: 0,
};

export function recordQueueJobStarted() { queueMetricsBuffer.jobsStarted++; }
export function recordQueueJobCompleted() { queueMetricsBuffer.jobsCompleted++; }
export function recordQueueJobFailed() { queueMetricsBuffer.jobsFailed++; }
export function recordQueueJobRetried() { queueMetricsBuffer.jobsRetried++; }
export function recordQueueJobSkipped() { queueMetricsBuffer.jobsSkipped++; }
export function getQueueMetricsBuffer() { return { ...queueMetricsBuffer }; }

async function flushToRedis(): Promise<boolean> {
  if (!isRedisAvailable()) return false;

  const hourKey = getHourKey();
  const dayKey = getDayKey();

  try {
    const hourlySnapshot = {
      ts: Date.now(),
      hour: hourKey,
      processed: inMemoryBuffer.messagesProcessed,
      translated: inMemoryBuffer.translationsCompleted,
      skipped: inMemoryBuffer.translationsSkipped,
      failed: inMemoryBuffer.translationsFailed,
      cacheHits: inMemoryBuffer.cacheHits,
      providers: { ...inMemoryBuffer.providerCalls },
      langPairs: { ...inMemoryBuffer.langPairCounts },
      activeRooms: inMemoryBuffer.activeRooms.size,
      avgLatencyMs: inMemoryBuffer.avgLatencyMs,
    };

    const existingRaw = await redisGet(`${METRICS_PREFIX}:hourly:${hourKey}`);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        hourlySnapshot.processed += existing.processed || 0;
        hourlySnapshot.translated += existing.translated || 0;
        hourlySnapshot.skipped += existing.skipped || 0;
        hourlySnapshot.failed += existing.failed || 0;
        hourlySnapshot.cacheHits += existing.cacheHits || 0;
        hourlySnapshot.activeRooms = Math.max(hourlySnapshot.activeRooms, existing.activeRooms || 0);
        if (existing.providers) {
          for (const [p, c] of Object.entries(existing.providers)) {
            hourlySnapshot.providers[p] = (hourlySnapshot.providers[p] || 0) + (c as number);
          }
        }
        if (existing.langPairs) {
          for (const [lp, c] of Object.entries(existing.langPairs)) {
            hourlySnapshot.langPairs[lp] = (hourlySnapshot.langPairs[lp] || 0) + (c as number);
          }
        }
      } catch {}
    }

    await redisSet(`${METRICS_PREFIX}:hourly:${hourKey}`, JSON.stringify(hourlySnapshot), METRICS_TTL);

    const dailySummaryRaw = await redisGet(`${METRICS_PREFIX}:daily:${dayKey}`);
    let dailySummary: any = dailySummaryRaw ? JSON.parse(dailySummaryRaw) : {
      date: dayKey,
      totalProcessed: 0,
      totalTranslated: 0,
      totalSkipped: 0,
      totalFailed: 0,
      totalCacheHits: 0,
      peakActiveRooms: 0,
      providers: {},
      langPairs: {},
    };

    dailySummary.totalProcessed += inMemoryBuffer.messagesProcessed;
    dailySummary.totalTranslated += inMemoryBuffer.translationsCompleted;
    dailySummary.totalSkipped += inMemoryBuffer.translationsSkipped;
    dailySummary.totalFailed += inMemoryBuffer.translationsFailed;
    dailySummary.totalCacheHits += inMemoryBuffer.cacheHits;
    dailySummary.peakActiveRooms = Math.max(dailySummary.peakActiveRooms, inMemoryBuffer.activeRooms.size);
    for (const [p, c] of Object.entries(inMemoryBuffer.providerCalls)) {
      dailySummary.providers[p] = (dailySummary.providers[p] || 0) + c;
    }
    for (const [lp, c] of Object.entries(inMemoryBuffer.langPairCounts)) {
      dailySummary.langPairs[lp] = (dailySummary.langPairs[lp] || 0) + c;
    }
    dailySummary.ts = Date.now();

    await redisSet(`${METRICS_PREFIX}:daily:${dayKey}`, JSON.stringify(dailySummary), METRICS_TTL);

    resetBuffer();
    lastFlushAt = Date.now();
    return true;
  } catch (err) {
    console.error("[AgentMetrics] Flush to Redis failed:", err);
    return false;
  }
}

function resetBuffer() {
  inMemoryBuffer.messagesProcessed = 0;
  inMemoryBuffer.translationsCompleted = 0;
  inMemoryBuffer.translationsSkipped = 0;
  inMemoryBuffer.translationsFailed = 0;
  inMemoryBuffer.cacheHits = 0;
  inMemoryBuffer.providerCalls = {};
  inMemoryBuffer.langPairCounts = {};
  inMemoryBuffer.activeRooms.clear();
  inMemoryBuffer.latencySamples = 0;
  inMemoryBuffer.latencySum = 0;
  inMemoryBuffer.avgLatencyMs = 0;
}

export function startMetricsFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (inMemoryBuffer.messagesProcessed > 0 || inMemoryBuffer.translationsCompleted > 0) {
      flushToRedis().catch(() => {});
    }
  }, FLUSH_INTERVAL_MS);
  console.log("[AgentMetrics] Periodic flush started (every 60s)");
}

export function stopMetricsFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (inMemoryBuffer.messagesProcessed > 0) {
    flushToRedis().catch(() => {});
  }
}

export async function getMetricsSnapshot(): Promise<{
  current: any;
  queue: any;
  hourly: any | null;
  daily: any | null;
  health: any;
}> {
  const hourKey = getHourKey();
  const dayKey = getDayKey();

  let hourly = null;
  let daily = null;

  if (isRedisAvailable()) {
    try {
      const hourlyRaw = await redisGet(`${METRICS_PREFIX}:hourly:${hourKey}`);
      if (hourlyRaw) hourly = JSON.parse(hourlyRaw);
    } catch {}
    try {
      const dailyRaw = await redisGet(`${METRICS_PREFIX}:daily:${dayKey}`);
      if (dailyRaw) daily = JSON.parse(dailyRaw);
    } catch {}
  }

  const totalProcessed = (daily?.totalProcessed || 0) + inMemoryBuffer.messagesProcessed;
  const totalTranslated = (daily?.totalTranslated || 0) + inMemoryBuffer.translationsCompleted;
  const totalFailed = (daily?.totalFailed || 0) + inMemoryBuffer.translationsFailed;

  const queueMetrics = getQueueMetricsBuffer();

  return {
    current: {
      bufferedMessages: inMemoryBuffer.messagesProcessed,
      bufferedTranslations: inMemoryBuffer.translationsCompleted,
      bufferedSkipped: inMemoryBuffer.translationsSkipped,
      bufferedFailed: inMemoryBuffer.translationsFailed,
      bufferedCacheHits: inMemoryBuffer.cacheHits,
      activeRooms: inMemoryBuffer.activeRooms.size,
      avgLatencyMs: inMemoryBuffer.avgLatencyMs,
      lastFlushAt: new Date(lastFlushAt).toISOString(),
      redisConnected: isRedisAvailable(),
    },
    queue: queueMetrics,
    hourly,
    daily,
    health: {
      failureRate: totalProcessed > 0 ? Math.round((totalFailed / totalProcessed) * 100) : 0,
      translationRate: totalProcessed > 0 ? Math.round((totalTranslated / totalProcessed) * 100) : 0,
      todayTotal: totalProcessed,
      todayTranslated: totalTranslated,
      scalingIndicator: totalProcessed > 1000 ? "high" : totalProcessed > 500 ? "medium" : "low",
    },
  };
}

export async function getMetricsForExternalMonitor(): Promise<{
  status: string;
  timestamp: number;
  today: any;
  thresholds: any;
}> {
  const dayKey = getDayKey();
  let daily: any = null;

  if (isRedisAvailable()) {
    try {
      const raw = await redisGet(`${METRICS_PREFIX}:daily:${dayKey}`);
      if (raw) daily = JSON.parse(raw);
    } catch {}
  }

  const totalProcessed = (daily?.totalProcessed || 0) + inMemoryBuffer.messagesProcessed;
  const totalTranslated = (daily?.totalTranslated || 0) + inMemoryBuffer.translationsCompleted;
  const totalFailed = (daily?.totalFailed || 0) + inMemoryBuffer.translationsFailed;
  const totalCacheHits = (daily?.totalCacheHits || 0) + inMemoryBuffer.cacheHits;

  return {
    status: "ok",
    timestamp: Date.now(),
    today: {
      processed: totalProcessed,
      translated: totalTranslated,
      failed: totalFailed,
      cacheHits: totalCacheHits,
      activeRooms: Math.max(daily?.peakActiveRooms || 0, inMemoryBuffer.activeRooms.size),
      providers: daily?.providers || inMemoryBuffer.providerCalls,
      langPairs: daily?.langPairs || inMemoryBuffer.langPairCounts,
    },
    thresholds: {
      scaleUpRecommended: totalProcessed > 1000,
      highFailureRate: totalProcessed > 50 && (totalFailed / totalProcessed) > 0.1,
      providerDiversityLow: Object.keys(daily?.providers || inMemoryBuffer.providerCalls).length < 2,
      cacheEfficiency: totalProcessed > 0 ? Math.round((totalCacheHits / totalProcessed) * 100) : 0,
    },
  };
}
