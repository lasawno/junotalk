/**
 * Juno's Cache Intelligence
 *
 * Single source of truth for ALL caching decisions in the AI gateway.
 * Sits in front of the three-tier cache stack (L1 memory → L2 Redis → L3 GitHub)
 * and decides, per request:
 *
 *   - Is this response cacheable at all?
 *   - Which namespace does it belong to?
 *   - What key uniquely identifies it?
 *   - How long should it live?
 *
 * Rules:
 *   translation / translation_prompt  →  globally cacheable, 7 days.
 *     Same source text always produces the same translated output. Safe for
 *     every user. Unified into the existing "translations" namespace so it
 *     shares warm entries with the routes.ts translation cache.
 *
 *   chat  →  session-scoped, 30 min.
 *     Juno's replies can be personalised to the conversation context. Serving
 *     one user's answer to a different user is a privacy violation. The cache
 *     key is scoped to sessionId so responses never cross user boundaries.
 *     Without a sessionId the response is NOT cached.
 *
 *   monitor / general  →  not cached.
 *     One-off system signals or agent introspection. Context changes every
 *     call — caching would return stale snapshots.
 */

import { createHash } from "crypto";
import { cacheGet, cacheSet } from "./cache-layer";

// ── TTLs ──────────────────────────────────────────────────────────────────────
export const TTL_TRANSLATION = 7 * 24 * 60 * 60 * 1000;   // 7 days
export const TTL_CHAT        = 30 * 60 * 1000;             // 30 min

// ── Namespaces ────────────────────────────────────────────────────────────────
// "translations" is shared with the routes.ts translation cache so both paths
// benefit from the same warm entries.
const NS_TRANSLATION = "translations";
const NS_CHAT        = "chat-responses";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CacheDecision {
  cacheable: boolean;
  namespace: string;
  key: string;
  ttlMs: number;
  reason: string;
}

export interface CacheableRequest {
  task: "translation" | "translation_prompt" | "chat" | "monitor" | "general" | "background";
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  sessionId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── Core decision function ────────────────────────────────────────────────────
/**
 * Evaluate whether a gateway request can be cached, and if so produce the
 * exact namespace/key/TTL to use. Call this before hitting any provider.
 */
export function decideCaching(req: CacheableRequest): CacheDecision {
  const { task, prompt = "", messages = [], sessionId } = req;

  // ── Translations: deterministic output, safe to cache globally ─────────────
  if (task === "translation" || task === "translation_prompt") {
    const raw = prompt.trim() + JSON.stringify(messages.map(m => m.content));
    return {
      cacheable: true,
      namespace: NS_TRANSLATION,
      key: `gw:${sha256(raw).slice(0, 40)}`,
      ttlMs: TTL_TRANSLATION,
      reason: "translation output is deterministic — cached globally for 7 days",
    };
  }

  // ── Chat: personalised, must be scoped to the user session ─────────────────
  if (task === "chat") {
    if (!sessionId) {
      return {
        cacheable: false,
        namespace: "",
        key: "",
        ttlMs: 0,
        reason: "chat without sessionId cannot be cached — privacy boundary enforced",
      };
    }
    const raw = sessionId + JSON.stringify(messages.map(m => ({ r: m.role, c: (m.content ?? "").trim() })));
    return {
      cacheable: true,
      namespace: NS_CHAT,
      key: `gw:${sha256(raw).slice(0, 40)}`,
      ttlMs: TTL_CHAT,
      reason: `chat scoped to sessionId ${sessionId.slice(0, 8)}… — cached for 30 min`,
    };
  }

  // ── monitor / general: transient, never cached ──────────────────────────────
  return {
    cacheable: false,
    namespace: "",
    key: "",
    ttlMs: 0,
    reason: `task '${task}' is transient — not cached`,
  };
}

// ── Public cache I/O ──────────────────────────────────────────────────────────
/**
 * Read from all three cache layers (L1 → L2 → L3).
 * Returns the cached string or null on a complete miss.
 */
export async function junoGet(decision: CacheDecision): Promise<string | null> {
  if (!decision.cacheable) return null;
  return cacheGet(decision.namespace, decision.key);
}

/**
 * Write a response into all three cache layers.
 * Non-blocking — fires and forgets so it never adds latency to the response.
 */
export function junoSet(decision: CacheDecision, value: string): void {
  if (!decision.cacheable || !value) return;
  cacheSet(decision.namespace, decision.key, value, decision.ttlMs).catch(() => {});
}
