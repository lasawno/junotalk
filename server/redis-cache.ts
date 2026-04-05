import { Redis as UpstashRedis } from "@upstash/redis";
import { REDIS_KEYS } from "./brand-keys";
import { Redis as IORedis, type RedisOptions as IORedisOptions } from "ioredis";
import { fetchPrivateFile } from "./github-config";

type RedisMode = "direct" | "upstash" | "none";

let upstashClient: UpstashRedis | null = null;
let directClient: IORedis | null = null;
let redisReady = false;
let currentMode: RedisMode = "none";

const UPSTASH_FREE_TIER_DAILY_LIMIT = 10000;

export type RouteType = "voice" | "text" | "video";

const redisUsageStats = {
  commandsToday: 0,
  commandsDayStart: Date.now(),
  hits: 0,
  misses: 0,
  sets: 0,
  errors: 0,
  lastResetAt: Date.now(),
  throttled: false,
  byRoute: { voice: { hits: 0, misses: 0, sets: 0 }, text: { hits: 0, misses: 0, sets: 0 }, video: { hits: 0, misses: 0, sets: 0 } } as Record<RouteType, { hits: number; misses: number; sets: number }>,
};

function resetDailyCounterIfNeeded() {
  const now = Date.now();
  const msInDay = 24 * 60 * 60 * 1000;
  if (now - redisUsageStats.commandsDayStart >= msInDay) {
    redisUsageStats.commandsToday = 0;
    redisUsageStats.commandsDayStart = now;
    redisUsageStats.throttled = false;
    redisUsageStats.lastResetAt = now;
  }
}

function shouldThrottle(): boolean {
  if (currentMode === "direct") return false;

  resetDailyCounterIfNeeded();
  const warningThreshold = Math.floor(UPSTASH_FREE_TIER_DAILY_LIMIT * 0.8);
  const hardLimit = Math.floor(UPSTASH_FREE_TIER_DAILY_LIMIT * 0.95);

  if (redisUsageStats.commandsToday >= hardLimit) {
    if (!redisUsageStats.throttled) {
      console.warn(`[RedisCache] THROTTLED — ${redisUsageStats.commandsToday}/${UPSTASH_FREE_TIER_DAILY_LIMIT} daily commands used (95% limit reached). Falling back to in-memory cache.`);
      redisUsageStats.throttled = true;
    }
    return true;
  }

  if (redisUsageStats.commandsToday >= warningThreshold && redisUsageStats.commandsToday % 500 === 0) {
    console.warn(`[RedisCache] WARNING — ${redisUsageStats.commandsToday}/${UPSTASH_FREE_TIER_DAILY_LIMIT} daily commands used (${Math.round(redisUsageStats.commandsToday / UPSTASH_FREE_TIER_DAILY_LIMIT * 100)}%)`);
  }

  return false;
}

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_TLS = process.env.REDIS_TLS === "true";
const REDIS_ALLOWED_IPS = process.env.REDIS_ALLOWED_IPS;

interface SharedRedisOptions {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  tls?: { rejectUnauthorized: boolean };
  connectTimeout: number;
  lazyConnect: boolean;
}

function buildBaseOptions(): SharedRedisOptions | null {
  if (!REDIS_URL && !REDIS_HOST) return null;

  if (REDIS_URL) {
    const parsed = new URL(REDIS_URL);
    const isTls = parsed.protocol === "rediss:" || REDIS_TLS;
    const dbIndex = parsed.pathname && parsed.pathname.length > 1
      ? parseInt(parsed.pathname.slice(1), 10)
      : undefined;
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379", 10),
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      ...(dbIndex !== undefined && !isNaN(dbIndex) ? { db: dbIndex } : {}),
      connectTimeout: 5000,
      lazyConnect: true,
      ...(isTls ? { tls: { rejectUnauthorized: true } } : {}),
    };
  }

  return {
    host: REDIS_HOST!,
    port: REDIS_PORT,
    password: REDIS_PASSWORD || undefined,
    connectTimeout: 5000,
    lazyConnect: true,
    ...(REDIS_TLS ? { tls: { rejectUnauthorized: true } } : {}),
  };
}

export function buildRedisConnectionOptions(): IORedisOptions | null {
  const base = buildBaseOptions();
  if (!base) return null;
  return {
    ...base,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function buildCacheClientOptions(): IORedisOptions | null {
  const base = buildBaseOptions();
  if (!base) return null;
  return {
    ...base,
    maxRetriesPerRequest: 2,
  };
}

export function createRawIoredis(): IORedis | null {
  const opts = buildRedisConnectionOptions();
  if (!opts) return null;
  return new IORedis(opts);
}

export function getDirectClient(): IORedis | null {
  return directClient;
}

export function getRedisMode(): RedisMode {
  return currentMode;
}

if (REDIS_URL || REDIS_HOST) {
  const cacheOpts = buildCacheClientOptions();
  if (cacheOpts) {
    try {
      directClient = new IORedis(cacheOpts);

      const isTlsEnabled = !!cacheOpts.tls;
      directClient.on("ready", () => {
        redisReady = true;
        currentMode = "direct";
        console.log(`[RedisCache] Direct Redis connected (${isTlsEnabled ? "TLS" : "plain"}) — no daily command limits`);
      });

      directClient.on("error", (err) => {
        console.warn("[RedisCache] Direct Redis error:", err.message);
        redisReady = false;
      });

      directClient.on("close", () => {
        redisReady = false;
      });

      directClient.connect().catch((err) => {
        console.warn("[RedisCache] Direct Redis connection failed:", err.message);
        redisReady = false;
      });

      currentMode = "direct";

      const isManagedRedis = !!(REDIS_URL && (REDIS_URL.includes("upstash.io") || REDIS_URL.includes("redis-cloud")));
      if (REDIS_ALLOWED_IPS) {
        console.log(`[RedisCache] Firewall recommendation: Restrict Redis port ${cacheOpts.port} to allowed IPs: ${REDIS_ALLOWED_IPS}`);
      } else if (!isManagedRedis) {
        console.warn("[RedisCache] SECURITY WARNING: REDIS_ALLOWED_IPS not set. Ensure your Redis server firewall restricts access to trusted sources only.");
      }

      if (isTlsEnabled) {
        console.log("[RedisCache] TLS/SSL encryption enabled for Redis connection");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[RedisCache] Direct Redis setup failed:", msg);
    }
  }
} else if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    upstashClient = UpstashRedis.fromEnv();
    redisReady = true;
    currentMode = "upstash";
    console.log("[RedisCache] Upstash REST configured (fallback mode — BullMQ queue will not activate)");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[RedisCache] Upstash setup failed:", msg);
  }
} else {
  console.log("[RedisCache] No Redis configured — using in-memory cache only");
}

export function isRedisAvailable(): boolean {
  return redisReady && (upstashClient !== null || directClient !== null);
}

export function isDirectRedisAvailable(): boolean {
  return redisReady && currentMode === "direct" && directClient !== null;
}

export function getRedisUsageStats() {
  resetDailyCounterIfNeeded();
  const usagePercent = currentMode === "upstash"
    ? Math.round(redisUsageStats.commandsToday / UPSTASH_FREE_TIER_DAILY_LIMIT * 100)
    : 0;
  const hitRate = (redisUsageStats.hits + redisUsageStats.misses) > 0
    ? Math.round(redisUsageStats.hits / (redisUsageStats.hits + redisUsageStats.misses) * 100)
    : 0;

  return {
    connected: isRedisAvailable(),
    mode: currentMode,
    directRedisAvailable: isDirectRedisAvailable(),
    tlsEnabled: currentMode === "direct" ? !!(buildBaseOptions()?.tls) : currentMode === "upstash" ? true : false,
    firewallConfigured: currentMode === "direct" ? !!REDIS_ALLOWED_IPS : true,
    dailyCommands: redisUsageStats.commandsToday,
    dailyLimit: currentMode === "upstash" ? UPSTASH_FREE_TIER_DAILY_LIMIT : "unlimited",
    usagePercent: currentMode === "upstash" ? `${usagePercent}%` : "N/A (direct)",
    throttled: redisUsageStats.throttled,
    hits: redisUsageStats.hits,
    misses: redisUsageStats.misses,
    sets: redisUsageStats.sets,
    errors: redisUsageStats.errors,
    hitRate: `${hitRate}%`,
    byRoute: redisUsageStats.byRoute,
    estimatedDailyProjection: currentMode === "upstash" && redisUsageStats.commandsDayStart > 0
      ? Math.round(redisUsageStats.commandsToday / Math.max(1, (Date.now() - redisUsageStats.commandsDayStart) / (24 * 60 * 60 * 1000)))
      : 0,
    dayStartedAt: new Date(redisUsageStats.commandsDayStart).toISOString(),
  };
}

export async function redisGet(key: string): Promise<string | null> {
  if (!isRedisAvailable() || shouldThrottle()) return null;
  try {
    redisUsageStats.commandsToday++;
    let val: string | null = null;

    if (currentMode === "direct" && directClient) {
      val = await directClient.get(key);
    } else if (currentMode === "upstash" && upstashClient) {
      val = await upstashClient.get<string>(key) ?? null;
    }

    if (val) {
      redisUsageStats.hits++;
    } else {
      redisUsageStats.misses++;
    }
    return val;
  } catch (err: unknown) {
    redisUsageStats.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[RedisCache] GET error:", msg);
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  if (!isRedisAvailable() || shouldThrottle()) return false;
  try {
    redisUsageStats.commandsToday++;
    redisUsageStats.sets++;

    if (currentMode === "direct" && directClient) {
      await directClient.set(key, value, "EX", ttlSeconds);
    } else if (currentMode === "upstash" && upstashClient) {
      await upstashClient.set(key, value, { ex: ttlSeconds });
    }

    return true;
  } catch (err: unknown) {
    redisUsageStats.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[RedisCache] SET error:", msg);
    return false;
  }
}

export async function redisIncrBy(key: string, increment: number, ttlSeconds: number): Promise<number> {
  if (!isRedisAvailable() || shouldThrottle()) return 0;
  try {
    redisUsageStats.commandsToday++;

    let newVal = 0;
    if (currentMode === "direct" && directClient) {
      newVal = await directClient.incrby(key, increment);
      await directClient.expire(key, ttlSeconds);
    } else if (currentMode === "upstash" && upstashClient) {
      newVal = await upstashClient.incrby(key, increment);
      await upstashClient.expire(key, ttlSeconds);
    }
    return newVal;
  } catch (err: unknown) {
    redisUsageStats.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[RedisCache] INCRBY error:", msg);
    return 0;
  }
}

function buildCacheKey(routeType: RouteType, sourceLang: string, targetLang: string, textHash: string): string {
  return `${REDIS_KEYS.translatePrefix}:${routeType}:${sourceLang}:${targetLang}:${textHash}`;
}

export async function getCachedTranslationRedis(
  routeType: RouteType,
  sourceLang: string,
  targetLang: string,
  textHash: string
): Promise<string | null> {
  const key = buildCacheKey(routeType, sourceLang, targetLang, textHash);
  const result = await redisGet(key);
  if (result) {
    redisUsageStats.byRoute[routeType].hits++;
  } else if (isRedisAvailable() && !shouldThrottle()) {
    redisUsageStats.byRoute[routeType].misses++;
  }
  return result;
}

export async function setCachedTranslationRedis(
  routeType: RouteType,
  sourceLang: string,
  targetLang: string,
  textHash: string,
  translatedText: string,
  ttlSeconds: number = 600
): Promise<boolean> {
  const result = await redisSet(buildCacheKey(routeType, sourceLang, targetLang, textHash), translatedText, ttlSeconds * _ttlMultiplier);
  if (result) {
    redisUsageStats.byRoute[routeType].sets++;
  }
  return result;
}

/* ── GitHub CDN Redis Limits ────────────────────────────────────────────────
 * Loads memory thresholds and TTL policy from config/redis-limits.json in
 * the private CDN repo. Falls back to safe defaults if CDN is unreachable.
 *
 * CDN file format (config/redis-limits.json):
 * {
 *   "maxMemoryMB": 200,
 *   "warnThresholdPercent": 75,
 *   "hardThresholdPercent": 90,
 *   "checkIntervalMinutes": 5,
 *   "ttlMultiplierOnWarn": 0.5,
 *   "ttlMultiplierOnHard": 0.25
 * }
 */

interface RedisLimitsConfig {
  maxMemoryMB: number;
  warnThresholdPercent: number;
  hardThresholdPercent: number;
  checkIntervalMinutes: number;
  ttlMultiplierOnWarn: number;
  ttlMultiplierOnHard: number;
}

const DEFAULT_LIMITS: RedisLimitsConfig = {
  maxMemoryMB: 200,
  warnThresholdPercent: 75,
  hardThresholdPercent: 90,
  checkIntervalMinutes: 5,
  ttlMultiplierOnWarn: 0.5,
  ttlMultiplierOnHard: 0.25,
};

let _redisLimits: RedisLimitsConfig = { ...DEFAULT_LIMITS };
let _ttlMultiplier = 1.0;
let _memoryUsedMB = 0;
let _memoryPressure: "normal" | "warn" | "hard" = "normal";
let _limitsLoadedAt = 0;

async function loadRedisLimitsFromCdn(): Promise<void> {
  try {
    const data = await fetchPrivateFile("config/redis-limits.json");
    if (data && typeof data === "object") {
      _redisLimits = { ...DEFAULT_LIMITS, ...data };
      console.log(`[RedisGuard] Limits loaded from CDN — maxMem: ${_redisLimits.maxMemoryMB}MB, warn: ${_redisLimits.warnThresholdPercent}%, hard: ${_redisLimits.hardThresholdPercent}%`);
    }
  } catch {
    console.log("[RedisGuard] CDN limits unavailable — using defaults");
  }
  _limitsLoadedAt = Date.now();
}

async function checkRedisMemory(): Promise<void> {
  if (!directClient || currentMode !== "direct") return;
  try {
    const infoRaw = await directClient.info("memory");
    const usedMatch = infoRaw.match(/used_memory:(\d+)/);
    if (!usedMatch) return;

    const usedBytes = parseInt(usedMatch[1], 10);
    _memoryUsedMB = Math.round(usedBytes / (1024 * 1024));
    const usedPercent = (_memoryUsedMB / _redisLimits.maxMemoryMB) * 100;

    if (usedPercent >= _redisLimits.hardThresholdPercent) {
      if (_memoryPressure !== "hard") {
        _memoryPressure = "hard";
        _ttlMultiplier = _redisLimits.ttlMultiplierOnHard;
        console.warn(`[RedisGuard] HARD PRESSURE — ${_memoryUsedMB}MB / ${_redisLimits.maxMemoryMB}MB (${Math.round(usedPercent)}%). TTLs reduced to ${_ttlMultiplier * 100}%. Proactively clearing volatile keys.`);
        directClient.call("SCAN", "0", "MATCH", `${REDIS_KEYS.translatePrefix}:*`, "COUNT", "100")
          .catch(() => {});
      }
    } else if (usedPercent >= _redisLimits.warnThresholdPercent) {
      if (_memoryPressure !== "warn") {
        _memoryPressure = "warn";
        _ttlMultiplier = _redisLimits.ttlMultiplierOnWarn;
        console.warn(`[RedisGuard] WARN — ${_memoryUsedMB}MB / ${_redisLimits.maxMemoryMB}MB (${Math.round(usedPercent)}%). TTLs reduced to ${_ttlMultiplier * 100}%.`);
      }
    } else {
      if (_memoryPressure !== "normal") {
        _memoryPressure = "normal";
        _ttlMultiplier = 1.0;
        console.log(`[RedisGuard] Memory normal — ${_memoryUsedMB}MB / ${_redisLimits.maxMemoryMB}MB (${Math.round(usedPercent)}%). TTLs restored.`);
      }
    }
  } catch (e: any) {
    console.warn("[RedisGuard] Memory check failed:", e.message);
  }
}

export function getRedisMemoryStats() {
  return {
    usedMB: _memoryUsedMB,
    maxMB: _redisLimits.maxMemoryMB,
    usagePercent: _memoryUsedMB > 0 ? `${Math.round((_memoryUsedMB / _redisLimits.maxMemoryMB) * 100)}%` : "unknown",
    pressure: _memoryPressure,
    ttlMultiplier: _ttlMultiplier,
    limitsSource: _limitsLoadedAt > 0 ? "github-cdn" : "defaults",
    limits: _redisLimits,
  };
}

export function getRedisTtlMultiplier(): number {
  return _ttlMultiplier;
}

// Start the memory guard once Redis is connected
export async function startRedisMemoryGuard(): Promise<void> {
  await loadRedisLimitsFromCdn();
  await checkRedisMemory();

  const intervalMs = _redisLimits.checkIntervalMinutes * 60 * 1000;
  setInterval(async () => {
    // Reload CDN limits every hour
    if (Date.now() - _limitsLoadedAt > 60 * 60 * 1000) {
      await loadRedisLimitsFromCdn();
    }
    await checkRedisMemory();
  }, intervalMs);

  console.log(`[RedisGuard] Memory guard active — checking every ${_redisLimits.checkIntervalMinutes} min`);
}
