/**
 * PROPRIETARY AND CONFIDENTIAL
 * Juno Bridge — JunoTalk Server-Side Text Translation Router
 * Copyright (c) 2024-2026 JunoTalk. All rights reserved.
 *
 * Juno Bridge is the central routing layer for all text translation tasks.
 * Every message sent or edited in a chat room flows through this module.
 *
 * ─── FLOW OVERVIEW ───────────────────────────────────────────────────────────
 *
 *  INPUT TRIGGERS
 *  1. New message   → socket-io.ts (WebSocket) → processMessageTranslation()
 *  2. Edited message→ socket-io.ts (WebSocket) → processEditedMessageTranslation()
 *  3. API route     → routes.ts               → processMessageTranslation()
 *  4. Queue task    → agent-queue.ts           → processMessageTranslationWithOutcome()
 *
 *  PIPELINE (executed in order, short-circuits on first hit)
 *  Gate   Validate input — skip emoji-only, media markers, vanish, e2ee msgs
 *  L0     Language resolution — sender lang + receiver lang (LRU cache, 5 min TTL)
 *         Same-language check — if langs match, skip (no translation needed)
 *  L1     In-memory LRU cache (2 000 entries, 2 hr TTL) — zero-latency hits
 *  L2     DB Translation Memory — exact-match lookup via storage layer
 *  L3     Fallback phrase dictionary — static high-frequency phrase table
 *  L4     Recall / OSINT — GitHub-sourced reference phrase matching
 *  L5     Vector similarity search (pgvector) — if similarity ≥ 0.92 use directly
 *         Vector context — top-5 similar pairs passed as prompt context to L6
 *  L6     JunoAgent-T1 — dedicated Groq multilingual agent (llama-3.3-70b → llama-3.1-8b)
 *  L7     AI Gateway provider chain — OpenAI / Anthropic fallback if T1 fails
 *
 *  OUTPUT
 *  • Translated text saved to DB  → storage.saveMessageTranslation()
 *  • Translation stored in memory → storage.saveTranslationMemory()
 *  • Embedding indexed            → storage.storeTranslationWithEmbedding()
 *  • Result returned to caller    → socket-io broadcasts to room / API response
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Unauthorized copying, distribution, or reverse engineering is strictly prohibited.
 * Protected under applicable intellectual property laws.
 */

import { storage } from "./storage";
import type { RoomChatMsg } from "./routes";
import {
  recordMessage,
  recordTranslation,
  recordCacheHit,
  recordProviderUsage,
  recordLangPair,
  recordActiveRoom,
  recordLatency,
} from "./agent-metrics";
import { lookupFallbackPhrase, getFallbackStats } from "./translation-fallback";
import { gatewayTranslate, getConfiguredProviders } from "./ai-gateway";
import { t1Translate } from "./juno-agent-t1";
import { recallForTranslation, getRecallStats } from "./agent-recall";
import { checkContent } from "./juno-safety";
import { writeAuditLog, addRiskFlag } from "./juno-moderation";
import { detectLanguageIntelligence } from "./lang-intelligence";

const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u20e3\s0-9#*]+$/u;
const HAS_EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
const MEDIA_MARKERS = new Set(["[Emoji]", "[GIF]", "[Voice]", "[Image]", "[Video]", "[Sticker]"]);

const AGENT_TIMEOUT_MS = 12000;

const VECTOR_DIRECT_THRESHOLD = 0.92;

interface UserLangInfo {
  userId: string;
  spokenLanguage: string;
  subtitleLanguage: string;
}

class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}
  get size() { return this.map.size; }
  has(key: K) { return this.map.has(key); }
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
    return this;
  }
  delete(key: K) { return this.map.delete(key); }
  clear() { this.map.clear(); }
}

const MAX_USER_LANG_CACHE = 200;
const userLangCache = new LRUCache<string, { info: UserLangInfo; expires: number }>(MAX_USER_LANG_CACHE);
const CACHE_TTL = 5 * 60 * 1000;

const MAX_TRANSLATION_CACHE = 2000;
const translationCache = new LRUCache<string, { result: string; expires: number }>(MAX_TRANSLATION_CACHE);
const TRANSLATION_CACHE_TTL = 2 * 60 * 60 * 1000;

let agentStats = { processed: 0, translated: 0, skipped: 0, failed: 0, cacheHits: 0, memoryHits: 0, fallbackHits: 0, vectorHits: 0, vectorDirectHits: 0, recallHits: 0 };

async function getUserLanguage(userId: string): Promise<UserLangInfo> {
  const cached = userLangCache.get(userId);
  if (cached && Date.now() < cached.expires) return cached.info;

  const prefs = await storage.getPreferences(userId);
  const spoken = prefs?.spokenLanguage || "auto";
  const subtitle = prefs?.subtitleLanguage || "en";

  const info: UserLangInfo = { userId, spokenLanguage: spoken, subtitleLanguage: subtitle };
  userLangCache.set(userId, { info, expires: Date.now() + CACHE_TTL });
  return info;
}

function getEffectiveLang(info: UserLangInfo): string {
  return info.spokenLanguage !== "auto" ? info.spokenLanguage : info.subtitleLanguage;
}

function isTranslatable(text: string): boolean {
  if (!text || text.length < 2) return false;
  if (MEDIA_MARKERS.has(text)) return false;
  if (text.startsWith("[Location:") || text.startsWith("[LiveLocation:")) return false;
  if (EMOJI_ONLY_RE.test(text)) return false;
  return true;
}

function normalizeForCache(text: string): string {
  return text.trim().toLowerCase();
}

function getTranslationCacheKey(text: string, sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}:${normalizeForCache(text).slice(0, 200)}`;
}

function getCachedTranslation(text: string, sourceLang: string, targetLang: string): string | null {
  const key = getTranslationCacheKey(text, sourceLang, targetLang);
  const cached = translationCache.get(key);
  if (cached && Date.now() < cached.expires) {
    agentStats.cacheHits++;
    return cached.result;
  }
  if (cached) translationCache.delete(key);
  return null;
}

function setCachedTranslation(text: string, sourceLang: string, targetLang: string, result: string) {
  const key = getTranslationCacheKey(text, sourceLang, targetLang);
  translationCache.set(key, { result, expires: Date.now() + TRANSLATION_CACHE_TTL });
}

export type TranslationOutcome =
  | { status: "translated"; translatedText: string; targetLang: string }
  | { status: "skipped" }
  | { status: "failed"; error: string };

export async function processMessageTranslation(
  roomCode: string,
  msg: RoomChatMsg,
  senderId: string
): Promise<{ translatedText: string; targetLang: string } | null> {
  const outcome = await processMessageTranslationWithOutcome(roomCode, msg, senderId);
  if (outcome.status === "translated") return { translatedText: outcome.translatedText, targetLang: outcome.targetLang };
  return null;
}

export async function processMessageTranslationWithOutcome(
  roomCode: string,
  msg: RoomChatMsg,
  senderId: string
): Promise<TranslationOutcome> {
  agentStats.processed++;

  recordMessage();

  if (!isTranslatable(msg.text)) { agentStats.skipped++; recordTranslation("skipped"); return { status: "skipped" }; }
  if (msg.vanish) { agentStats.skipped++; recordTranslation("skipped"); return { status: "skipped" }; }
  if (msg.e2ee) { agentStats.skipped++; recordTranslation("skipped"); return { status: "skipped" }; }
  if (msg.imageData || msg.videoData) { agentStats.skipped++; recordTranslation("skipped"); return { status: "skipped" }; }

  try {
    const timeoutSymbol = Symbol("timeout");
    const timeoutPromise = new Promise<typeof timeoutSymbol>((resolve) => {
      setTimeout(() => resolve(timeoutSymbol), AGENT_TIMEOUT_MS);
    });

    const translationPromise = executeTranslation(roomCode, msg, senderId);
    const result = await Promise.race([translationPromise, timeoutPromise]);

    if (result === timeoutSymbol) {
      agentStats.failed++;
      const reason = `Timeout after ${AGENT_TIMEOUT_MS}ms for message in ${roomCode}`;
      console.warn(`[JunoBridge] ${reason}`);
      return { status: "failed", error: reason };
    }

    if (!result) {
      agentStats.skipped++;
      return { status: "skipped" };
    }

    return { status: "translated", translatedText: result.translatedText, targetLang: result.targetLang };
  } catch (err: unknown) {
    agentStats.failed++;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[JunoBridge] processMessageTranslation error:", err);
    return { status: "failed", error: errorMsg };
  }
}

async function executeTranslation(
  roomCode: string,
  msg: RoomChatMsg,
  senderId: string
): Promise<{ translatedText: string; targetLang: string } | null> {
  const members = await storage.getRoomMembers(roomCode);
  const activeMembers = members.filter(m => m.isActive);
  const receiver = activeMembers.find(m => m.userId !== senderId);
  if (!receiver) { recordTranslation("skipped"); return null; }

  recordActiveRoom(roomCode);

  const senderLang = await getUserLanguage(senderId);
  const receiverLang = await getUserLanguage(receiver.userId);

  const senderEffective = getEffectiveLang(senderLang);
  const receiverEffective = getEffectiveLang(receiverLang);

  // Profile language is primary; detection monitors and fills in if profile resolution fails
  const detected = await detectLanguageIntelligence(msg.text);
  const actualSrcLang = (detected && detected !== receiverEffective) ? detected : senderEffective;

  if (actualSrcLang === receiverEffective) { recordTranslation("skipped"); return null; }

  // Translation moderation (#10) — screen original text before translation
  const inputSafety = checkContent(msg.text);
  if (!inputSafety.safe) {
    console.log(`[JunoBridge] Translation blocked (${inputSafety.category}) for sender ${senderId}`);
    addRiskFlag(senderId, "translation_violation").catch(() => {});
    writeAuditLog({ actorId: senderId, action: "translation_blocked", category: "moderation", detail: inputSafety.category ?? undefined, severity: "medium" }).catch(() => {});
    return null;
  }

  recordLangPair(actualSrcLang, receiverEffective);

  const cached = getCachedTranslation(msg.text, actualSrcLang, receiverEffective);
  if (cached) {
    recordCacheHit();
    recordTranslation("completed");
    storage.saveMessageTranslation(msg.id, cached, receiverEffective).catch(err => {
      console.error("[JunoBridge] DB save failed:", err);
    });
    return { translatedText: cached, targetLang: receiverEffective };
  }

  const memoryResult = await storage.lookupTranslationMemory(msg.text, actualSrcLang, receiverEffective);
  if (memoryResult) {
    agentStats.memoryHits++;
    agentStats.translated++;
    recordCacheHit();
    recordTranslation("completed");
    recordProviderUsage("memory");
    setCachedTranslation(msg.text, actualSrcLang, receiverEffective, memoryResult);
    storage.saveMessageTranslation(msg.id, memoryResult, receiverEffective).catch(err => {
      console.error("[JunoBridge] DB save failed:", err);
    });
    return { translatedText: memoryResult, targetLang: receiverEffective };
  }

  const fallback = lookupFallbackPhrase(msg.text, actualSrcLang, receiverEffective);
  if (fallback) {
    agentStats.fallbackHits++;
    agentStats.translated++;
    recordTranslation("completed");
    recordProviderUsage("fallback");
    setCachedTranslation(msg.text, actualSrcLang, receiverEffective, fallback);
    storage.saveMessageTranslation(msg.id, fallback, receiverEffective).catch(() => {});
    storage.saveTranslationMemory(msg.text, actualSrcLang, receiverEffective, fallback, "fallback").catch(() => {});
    return { translatedText: fallback, targetLang: receiverEffective };
  }

  const recall = recallForTranslation(msg.text, actualSrcLang, receiverEffective);
  if (recall.githubPhrase) {
    agentStats.recallHits++;
    agentStats.translated++;
    recordTranslation("completed");
    recordProviderUsage("recall-osint");
    setCachedTranslation(msg.text, actualSrcLang, receiverEffective, recall.githubPhrase);
    storage.saveMessageTranslation(msg.id, recall.githubPhrase, receiverEffective).catch(() => {});
    storage.saveTranslationMemory(msg.text, actualSrcLang, receiverEffective, recall.githubPhrase, "recall-osint").catch(() => {});
    return { translatedText: recall.githubPhrase, targetLang: receiverEffective };
  }

  let vectorContext: { sourceText: string; translatedText: string }[] = [];
  try {
    const similar = await storage.searchSimilarTranslations(msg.text, actualSrcLang, receiverEffective, 5, roomCode);
    if (similar.length > 0) {
      agentStats.vectorHits++;

      const bestMatch = similar[0];
      if (bestMatch.similarity >= VECTOR_DIRECT_THRESHOLD) {
        agentStats.vectorDirectHits++;
        agentStats.translated++;
        recordCacheHit();
        recordTranslation("completed");
        recordProviderUsage("vector-direct");
        setCachedTranslation(msg.text, actualSrcLang, receiverEffective, bestMatch.translatedText);
        storage.saveMessageTranslation(msg.id, bestMatch.translatedText, receiverEffective).catch(() => {});
        storage.saveTranslationMemory(msg.text, actualSrcLang, receiverEffective, bestMatch.translatedText, "vector-direct").catch(() => {});
        return { translatedText: bestMatch.translatedText, targetLang: receiverEffective };
      }

      vectorContext = similar.map(s => ({ sourceText: s.sourceText, translatedText: s.translatedText }));
    }
  } catch {}

  const startMs = Date.now();
  const result = await translateViaProviderChain(msg.text, receiverEffective, actualSrcLang, vectorContext);
  const elapsed = Date.now() - startMs;
  recordLatency(elapsed);

  if (result) {
    agentStats.translated++;
    recordTranslation("completed");
    setCachedTranslation(msg.text, actualSrcLang, receiverEffective, result.translatedText);

    storage.saveMessageTranslation(msg.id, result.translatedText, receiverEffective).catch(err => {
      console.error("[JunoBridge] DB save failed:", err);
    });
    storage.saveTranslationMemory(msg.text, actualSrcLang, receiverEffective, result.translatedText, result.provider).catch(err => {
      console.error("[JunoBridge] Memory save failed:", err);
    });
    storage.storeTranslationWithEmbedding(msg.text, result.translatedText, actualSrcLang, receiverEffective, roomCode, result.provider).catch(err => {
      console.error("[JunoBridge] Embedding store failed:", err);
    });

    return { translatedText: result.translatedText, targetLang: receiverEffective };
  }

  agentStats.failed++;
  recordTranslation("failed");
  throw new Error(`All translation providers failed for ${senderEffective}→${receiverEffective}`);
}

export async function processEditedMessageTranslation(
  roomCode: string,
  messageId: string,
  newText: string,
  senderId: string
): Promise<{ translatedText: string; targetLang: string } | null> {
  const outcome = await processEditedMessageTranslationWithOutcome(roomCode, messageId, newText, senderId);
  if (outcome.status === "translated") return { translatedText: outcome.translatedText, targetLang: outcome.targetLang };
  return null;
}

export async function processEditedMessageTranslationWithOutcome(
  roomCode: string,
  messageId: string,
  newText: string,
  senderId: string
): Promise<TranslationOutcome> {
  if (!isTranslatable(newText)) return { status: "skipped" };

  try {
    const members = await storage.getRoomMembers(roomCode);
    const activeMembers = members.filter(m => m.isActive);
    const receiver = activeMembers.find(m => m.userId !== senderId);
    if (!receiver) return { status: "skipped" };

    const senderLang = await getUserLanguage(senderId);
    const receiverLang = await getUserLanguage(receiver.userId);
    const senderEffective = getEffectiveLang(senderLang);
    const receiverEffective = getEffectiveLang(receiverLang);

    // Profile language is primary; detection monitors and fills in if profile resolution fails
    const detected = await detectLanguageIntelligence(newText);
    const actualSrcLang = (detected && detected !== receiverEffective) ? detected : senderEffective;

    if (actualSrcLang === receiverEffective) return { status: "skipped" };

    const cached = getCachedTranslation(newText, actualSrcLang, receiverEffective);
    if (cached) {
      storage.saveMessageTranslation(messageId, cached, receiverEffective).catch(() => {});
      return { status: "translated", translatedText: cached, targetLang: receiverEffective };
    }

    const memoryResult = await storage.lookupTranslationMemory(newText, actualSrcLang, receiverEffective);
    if (memoryResult) {
      agentStats.memoryHits++;
      setCachedTranslation(newText, actualSrcLang, receiverEffective, memoryResult);
      storage.saveMessageTranslation(messageId, memoryResult, receiverEffective).catch(() => {});
      return { status: "translated", translatedText: memoryResult, targetLang: receiverEffective };
    }

    const fallback = lookupFallbackPhrase(newText, actualSrcLang, receiverEffective);
    if (fallback) {
      agentStats.fallbackHits++;
      setCachedTranslation(newText, actualSrcLang, receiverEffective, fallback);
      storage.saveMessageTranslation(messageId, fallback, receiverEffective).catch(() => {});
      storage.saveTranslationMemory(newText, actualSrcLang, receiverEffective, fallback, "fallback").catch(() => {});
      return { status: "translated", translatedText: fallback, targetLang: receiverEffective };
    }

    const recall = recallForTranslation(newText, actualSrcLang, receiverEffective);
    if (recall.githubPhrase) {
      agentStats.recallHits++;
      setCachedTranslation(newText, actualSrcLang, receiverEffective, recall.githubPhrase);
      storage.saveMessageTranslation(messageId, recall.githubPhrase, receiverEffective).catch(() => {});
      storage.saveTranslationMemory(newText, actualSrcLang, receiverEffective, recall.githubPhrase, "recall-osint").catch(() => {});
      return { status: "translated", translatedText: recall.githubPhrase, targetLang: receiverEffective };
    }

    let vectorContext: { sourceText: string; translatedText: string }[] = [];
    try {
      const similar = await storage.searchSimilarTranslations(newText, actualSrcLang, receiverEffective, 5, roomCode);
      if (similar.length > 0) {
        const bestMatch = similar[0];
        if (bestMatch.similarity >= VECTOR_DIRECT_THRESHOLD) {
          agentStats.vectorDirectHits++;
          setCachedTranslation(newText, actualSrcLang, receiverEffective, bestMatch.translatedText);
          storage.saveMessageTranslation(messageId, bestMatch.translatedText, receiverEffective).catch(() => {});
          storage.saveTranslationMemory(newText, actualSrcLang, receiverEffective, bestMatch.translatedText, "vector-direct").catch(() => {});
          return { status: "translated", translatedText: bestMatch.translatedText, targetLang: receiverEffective };
        }
        vectorContext = similar.map(s => ({ sourceText: s.sourceText, translatedText: s.translatedText }));
      }
    } catch {}

    const result = await translateViaProviderChain(newText, receiverEffective, actualSrcLang, vectorContext);
    if (result) {
      setCachedTranslation(newText, actualSrcLang, receiverEffective, result.translatedText);
      storage.saveMessageTranslation(messageId, result.translatedText, receiverEffective).catch(() => {});
      storage.saveTranslationMemory(newText, actualSrcLang, receiverEffective, result.translatedText, result.provider).catch(() => {});
      return { status: "translated", translatedText: result.translatedText, targetLang: receiverEffective };
    }

    return { status: "failed", error: "All providers failed" };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[JunoBridge] Edit re-translation error:", err);
    return { status: "failed", error: errorMsg };
  }
}

async function translateViaProviderChain(
  text: string,
  targetLang: string,
  sourceLang: string,
  vectorContext: { sourceText: string; translatedText: string }[] = []
): Promise<{ translatedText: string; provider: string } | null> {
  // L6 — JunoAgent-T1: dedicated Groq multilingual agent (fast, isolated from gateway)
  const t1Result = await t1Translate(text, sourceLang, targetLang, vectorContext);
  if (t1Result) {
    recordProviderUsage("groq-t1");
    return t1Result;
  }

  // L7 — AI Gateway fallback: shared provider chain (OpenAI, Anthropic, OpenRouter…)
  const providers = getConfiguredProviders("translation");
  if (providers.length === 0) {
    console.error("[JunoBridge] No AI Gateway providers configured — translation failed.");
    return null;
  }

  return gatewayTranslate(text, targetLang, sourceLang, getLanguageName, vectorContext);
}

function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
    pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
    ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
    tr: "Turkish", vi: "Vietnamese", th: "Thai", sv: "Swedish", da: "Danish",
    fi: "Finnish", no: "Norwegian", uk: "Ukrainian", el: "Greek", he: "Hebrew",
    id: "Indonesian", ms: "Malay", ro: "Romanian", hu: "Hungarian", bg: "Bulgarian",
  };
  return names[code.toLowerCase()] || code;
}

export function clearUserLangCache(userId?: string) {
  if (userId) {
    userLangCache.delete(userId);
  } else {
    userLangCache.clear();
  }
}

export function getAgentStats() {
  return {
    ...agentStats,
    translationCacheSize: translationCache.size,
    userLangCacheSize: userLangCache.size,
    configuredProviders: getConfiguredProviders("translation"),
    fallbackData: getFallbackStats(),
    recallData: getRecallStats(),
  };
}

export function resetAgentStats() {
  agentStats = { processed: 0, translated: 0, skipped: 0, failed: 0, cacheHits: 0, memoryHits: 0, fallbackHits: 0, vectorHits: 0, vectorDirectHits: 0, recallHits: 0 };
}
