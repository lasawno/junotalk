/**
 * JunoTalk Three-Tier Cache Layer
 *
 * L1 — CacheableMemory  : sub-millisecond, lives in process RAM, lost on restart
 * L2 — Redis (@keyv/redis): ~1–5ms, survives restarts, shared across instances
 * L3 — GitHub CDN repo  : ~200ms, permanent cold store, survives everything
 *
 * Read path:  L1 → L2 → L3 → compute fresh → back-fill all layers
 * Write path: L1 + L2 async, L3 async (non-blocking for L3 to keep writes fast)
 */

import { Cacheable, CacheableMemory, Keyv } from "cacheable";
import KeyvRedis from "@keyv/redis";
import { fetchPrivateFile, pushPrivateFile } from "./github-config";

const REDIS_URL = process.env.REDIS_URL;

const L1_DEFAULT_TTL = 5 * 60 * 1000;       // 5 minutes in memory
const L2_DEFAULT_TTL = 60 * 60 * 1000;      // 1 hour in Redis
const L3_FLUSH_DEBOUNCE = 30 * 1000;        // batch GitHub writes every 30s
const L3_MAX_ENTRIES = 2000;                 // max entries per namespace in GitHub

interface CacheStats {
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;
  misses: number;
  sets: number;
  l3Writes: number;
}

const stats: CacheStats = { l1Hits: 0, l2Hits: 0, l3Hits: 0, misses: 0, sets: 0, l3Writes: 0 };

// ─── L1: fast in-process memory ─────────────────────────────────────────────
const l1 = new CacheableMemory({ ttl: L1_DEFAULT_TTL, lruSize: 5000 });

// ─── L2: Redis (reuses existing REDIS_URL) ───────────────────────────────────
let l2Keyv: Keyv | null = null;
let cacheInstance: Cacheable | null = null;

function initCacheable() {
  if (cacheInstance) return cacheInstance;

  const primary = new Keyv({ store: l1 });

  if (REDIS_URL) {
    try {
      const redisStore = new KeyvRedis(REDIS_URL);
      l2Keyv = new Keyv({ store: redisStore, ttl: L2_DEFAULT_TTL });
      cacheInstance = new Cacheable({ primary, secondary: l2Keyv, nonBlocking: true });
      console.log("[CacheLayer] L1 (memory) + L2 (Redis) + L3 (GitHub) — online");
    } catch (err) {
      console.warn("[CacheLayer] Redis init failed, falling back to L1+L3 only:", (err as Error).message);
      cacheInstance = new Cacheable({ primary });
    }
  } else {
    cacheInstance = new Cacheable({ primary });
    console.log("[CacheLayer] L1 (memory) + L3 (GitHub) — Redis not configured");
  }

  return cacheInstance;
}

// ─── L3: GitHub CDN cold store ───────────────────────────────────────────────
// Each namespace maps to one JSON file in the CDN repo: cache/<namespace>.json
// Structure: { [key]: { v: value, exp: epochMs | null } }

const l3InMemory: Map<string, Map<string, { v: string; exp: number | null }>> = new Map();
const l3DirtyNamespaces: Set<string> = new Set();
const l3Timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let l3Initialized = false;
const l3InitPromises: Map<string, Promise<void>> = new Map();

function l3FilePath(namespace: string) {
  return `cache/${namespace}.json`;
}

async function ensureL3Namespace(namespace: string): Promise<void> {
  if (l3InMemory.has(namespace)) return;

  if (l3InitPromises.has(namespace)) {
    await l3InitPromises.get(namespace)!;
    return;
  }

  const p = (async () => {
    try {
      const raw = await fetchPrivateFile(l3FilePath(namespace));
      const now = Date.now();
      const map = new Map<string, { v: string; exp: number | null }>();
      if (raw && typeof raw === "object") {
        for (const [k, entry] of Object.entries(raw as Record<string, { v: string; exp: number | null }>)) {
          if (!entry.exp || entry.exp > now) {
            map.set(k, entry);
          }
        }
      }
      l3InMemory.set(namespace, map);
    } catch {
      l3InMemory.set(namespace, new Map());
    }
  })();

  l3InitPromises.set(namespace, p);
  await p;
  l3InitPromises.delete(namespace);
}

function scheduleL3Flush(namespace: string) {
  if (l3Timers.has(namespace)) return;
  const timer = setTimeout(async () => {
    l3Timers.delete(namespace);
    l3DirtyNamespaces.delete(namespace);
    const map = l3InMemory.get(namespace);
    if (!map || map.size === 0) return;

    const now = Date.now();
    const obj: Record<string, { v: string; exp: number | null }> = {};
    let count = 0;
    // Write only non-expired entries, up to L3_MAX_ENTRIES (most recent)
    const entries = Array.from(map.entries());
    for (const [k, entry] of entries.slice(-L3_MAX_ENTRIES)) {
      if (!entry.exp || entry.exp > now) {
        obj[k] = entry;
        count++;
      }
    }

    if (count > 0) {
      const ok = await pushPrivateFile(
        l3FilePath(namespace),
        obj,
        `cache: update ${namespace} (${count} entries)`
      );
      if (ok) {
        stats.l3Writes++;
      }
    }
  }, L3_FLUSH_DEBOUNCE);

  l3Timers.set(namespace, timer);
}

function l3Get(namespace: string, key: string): string | null {
  const map = l3InMemory.get(namespace);
  if (!map) return null;
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.exp && Date.now() > entry.exp) {
    map.delete(key);
    return null;
  }
  return entry.v;
}

function l3Set(namespace: string, key: string, value: string, ttlMs: number | null) {
  let map = l3InMemory.get(namespace);
  if (!map) {
    map = new Map();
    l3InMemory.set(namespace, map);
  }
  map.set(key, { v: value, exp: ttlMs ? Date.now() + ttlMs : null });
  l3DirtyNamespaces.add(namespace);
  scheduleL3Flush(namespace);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a cached value. Checks L1 → L2 → L3 in order.
 * On L3 hit, backfills L1+L2. On total miss, returns null.
 */
export async function cacheGet(namespace: string, key: string): Promise<string | null> {
  const cache = initCacheable();
  const cacheKey = `${namespace}:${key}`;

  // L1 + L2 via cacheable
  try {
    const l1l2 = await cache.get<string>(cacheKey);
    if (l1l2 !== undefined && l1l2 !== null) {
      stats.l1Hits++;
      return l1l2;
    }
  } catch {}

  // L3 — in-memory mirror of GitHub (loaded lazily at first access)
  await ensureL3Namespace(namespace);
  const l3val = l3Get(namespace, key);
  if (l3val !== null) {
    stats.l3Hits++;
    // Back-fill L1+L2 silently
    cache.set(cacheKey, l3val, L2_DEFAULT_TTL).catch(() => {});
    return l3val;
  }

  stats.misses++;
  return null;
}

/**
 * Set a cached value in all three layers.
 * L3 write is debounced (non-blocking) to avoid slowing down responses.
 *
 * @param namespace  logical group (e.g. "translations", "feature-flags")
 * @param key        unique key within the namespace
 * @param value      string value to cache (serialize objects before passing)
 * @param ttlMs      optional TTL in milliseconds (default: 1 hour)
 */
export async function cacheSet(
  namespace: string,
  key: string,
  value: string,
  ttlMs: number = L2_DEFAULT_TTL
): Promise<void> {
  const cache = initCacheable();
  const cacheKey = `${namespace}:${key}`;

  stats.sets++;

  // L1 + L2
  try {
    await cache.set(cacheKey, value, ttlMs);
  } catch {}

  // L3 — async, debounced, non-blocking
  ensureL3Namespace(namespace).then(() => {
    l3Set(namespace, key, value, ttlMs);
  }).catch(() => {});
}

/**
 * Delete a cached value from all layers.
 */
export async function cacheDel(namespace: string, key: string): Promise<void> {
  const cache = initCacheable();
  const cacheKey = `${namespace}:${key}`;
  try { await cache.delete(cacheKey); } catch {}
  const map = l3InMemory.get(namespace);
  if (map) {
    map.delete(key);
    l3DirtyNamespaces.add(namespace);
    scheduleL3Flush(namespace);
  }
}

/**
 * Wrap an async function with caching. If the cache has a value, returns it.
 * Otherwise calls fn(), caches the result, and returns it.
 *
 * @param namespace  cache namespace
 * @param key        cache key
 * @param fn         async factory function called on cache miss
 * @param ttlMs      optional TTL
 */
export async function cacheWrap<T>(
  namespace: string,
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = L2_DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet(namespace, key);
  if (cached !== null) {
    try { return JSON.parse(cached) as T; } catch { return cached as unknown as T; }
  }

  const result = await fn();
  if (result !== null && result !== undefined) {
    const serialized = typeof result === "string" ? result : JSON.stringify(result);
    await cacheSet(namespace, key, serialized, ttlMs);
  }
  return result;
}

/**
 * Pre-warm a namespace by loading its GitHub cold store into memory.
 * Call this at server startup for critical namespaces.
 */
export async function cacheWarm(namespace: string): Promise<void> {
  await ensureL3Namespace(namespace);
  const map = l3InMemory.get(namespace);
  console.log(`[CacheLayer] Warmed namespace "${namespace}": ${map?.size ?? 0} entries from GitHub`);
}

/**
 * Flush all dirty namespaces to GitHub immediately (e.g. on graceful shutdown).
 */
export async function cacheFlushAll(): Promise<void> {
  for (const ns of Array.from(l3DirtyNamespaces)) {
    const timer = l3Timers.get(ns);
    if (timer) { clearTimeout(timer); l3Timers.delete(ns); }
    l3DirtyNamespaces.delete(ns);

    const map = l3InMemory.get(ns);
    if (!map || map.size === 0) continue;

    const now = Date.now();
    const obj: Record<string, { v: string; exp: number | null }> = {};
    let count = 0;
    for (const [k, entry] of Array.from(map.entries()).slice(-L3_MAX_ENTRIES)) {
      if (!entry.exp || entry.exp > now) { obj[k] = entry; count++; }
    }
    if (count > 0) {
      await pushPrivateFile(l3FilePath(ns), obj, `cache: flush ${ns} (${count} entries)`).catch(() => {});
      stats.l3Writes++;
    }
  }
}

export function getCacheStats(): CacheStats & { namespaces: string[] } {
  return {
    ...stats,
    namespaces: Array.from(l3InMemory.keys()),
  };
}

// Graceful shutdown — flush dirty L3 data to GitHub
process.on("SIGTERM", () => { cacheFlushAll().catch(() => {}); });
process.on("SIGINT",  () => { cacheFlushAll().catch(() => {}); });
