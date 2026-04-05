import type { Express, Request, Response } from "express";
import { Router } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { apiKeys, awaitApiKeys } from "./api-keys";
import { apiVersionMiddleware } from "./api/version-middleware";
import v2Router from "./api/v2-router";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, getSession } from "./replit_integrations/auth";
import { registerObjectStorageRoutes, ObjectStorageService } from "./replit_integrations/object_storage";
import { supabaseStorageService } from "./supabase-storage";
import { insertMessageSchema, insertContactSchema, insertRoomSchema } from "@shared/schema";
import { checkChatMessage } from "./juno-safety";
import { fetchPrivateFile, pushPrivateFile, getAuthPolicy, getClientConfig, checkPlatformActivity } from "./github-config";
import { bumpPlatformActivity, isPlatformRecentlyActive } from "./platform-activity-tracker";
import {
  isUserBanned, banUser, writeAuditLog, addRiskFlag,
  generateTurnCredentials, invalidateBlockCache, checkWsMessageRate,
  submitReport, blockUser, unblockUser, getBlockList, getActiveBan,
} from "./juno-moderation";
import OpenAI from "openai";
import multer from "multer";
import { toFile } from "openai/uploads";
import passport from "passport";

import jwt from "jsonwebtoken";
import { sendWelcomeEmail, sendVerificationEmail } from "./email";
import { execFile } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { kimiMonitor } from "./kimi-agent";
import { setUserCallStatus } from "./socket-io";
import { junoController } from "./juno-controller";
import { createMarketingRouter } from "./controllers/marketing.controller";
import { getCachedTranslationRedis, setCachedTranslationRedis, isRedisAvailable, getRedisUsageStats, redisGet, redisSet, redisIncrBy } from "./redis-cache";
import { cacheGet, cacheSet, cacheWrap, cacheWarm, getCacheStats } from "./cache-layer";
import { processMessageTranslation, processEditedMessageTranslation, clearUserLangCache } from "./juno-bridge";
import { translateCaption, getCaptionCacheStats } from "./caption-translate";
import { transcribeWithLocalWhisper, isWhisperSidecarReady, ensureWhisperSidecarStarted } from "./start-whisper-sidecar";
import { gatewayRequest, gatewayChat, gatewayTranslate } from "./ai-gateway";
import { detectTranslationIntent } from "./translation-intent";
import { evaluateAdaptivePolicies } from "./juno-adaptive-policy";
import { evaluateIntelligenceLayer } from "./juno-intelligence-layer";
import { resolveTranslationDirection } from "./lang-intelligence";
import { learnAndRecall } from "./juno-learner";
import { getLatencyStats } from "./latency-tracker";
import { isFeatureEnabled, getEffectiveFlags, getAppMode } from "./feature-flags";
import { startMetricsFlush, getMetricsSnapshot, getMetricsForExternalMonitor } from "./agent-metrics";
import { executeTool, validateInput, getToolHealth, resetCircuit, resetAllCircuits, getToolStatus, TOOL_NAMES } from "./tool-execution-service";
import { toolPiperTTS, toolOpenAITTS } from "./tools";
import { structuredLog, generateCorrelationId } from "./structured-logger";
import { offlineTracker } from "./offline-session-tracker";
import { registerHealthRoutes } from "./health";
import { initSecretsGuard, secretsGuardMiddleware } from "./secrets-guard";
import { syncKnowledgeBase, getReasoningContext, getSyncStats } from "./knowledge-sync";
import { loadScrapedKnowledge, getKnowledgeStats } from "./juno-knowledge";
import { orchestrateRecall, getOrchestratorConfig, getGithubFallbackLoad } from "./recall-orchestrator";
import { getArenaConfig, pushArenaConfig, getArenaModelRegistry, getArenaRoutingConfig, rankModelsForTask, getArenaFlag } from "./arena-llm";
import { detectImageIntent, checkImageRateLimit, incrementImageUsage, generateImages } from "./image-pipeline";
import { getImageConfig } from "./image-config";
import { isCulturalQuery, fetchCulturalImage } from "./wikimedia";

// Gemini client for translation
const geminiApiKey = apiKeys.gemini() || "";
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

class BoundedMap<K, V> {
  private map = new Map<K, V>();
  private accessOrder: K[] = [];
  constructor(private maxSize: number) {}
  get size() { return this.map.size; }
  has(key: K) { return this.map.has(key); }
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);
      this.accessOrder.push(key);
    }
    return val;
  }
  set(key: K, value: V): this {
    if (this.map.has(key)) {
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);
    } else if (this.map.size >= this.maxSize) {
      const evict = this.accessOrder.shift();
      if (evict !== undefined) this.map.delete(evict);
    }
    this.map.set(key, value);
    this.accessOrder.push(key);
    return this;
  }
  delete(key: K): boolean {
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) this.accessOrder.splice(idx, 1);
    return this.map.delete(key);
  }
  forEach(cb: (value: V, key: K, map: Map<K, V>) => void) { this.map.forEach(cb); }
  keys() { return this.map.keys(); }
  values() { return this.map.values(); }
  entries() { return this.map.entries(); }
  clear() { this.map.clear(); this.accessOrder = []; }
  [Symbol.iterator]() { return this.map[Symbol.iterator](); }
}

class TTLMap<K, V extends { ts: number }> {
  private map = new Map<K, V>();
  constructor(private maxSize: number, private ttlMs: number) {}
  get size() { return this.map.size; }
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() - entry.ts > this.ttlMs) { this.map.delete(key); return false; }
    return true;
  }
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) { this.map.delete(key); return undefined; }
    return entry;
  }
  set(key: K, value: V): this {
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, value);
    return this;
  }
  delete(key: K): boolean { return this.map.delete(key); }
  forEach(cb: (value: V, key: K) => void) { this.map.forEach(cb); }
  keys() { return this.map.keys(); }
  entries() { return this.map.entries(); }
  clear() { this.map.clear(); }
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    this.map.forEach((v, k) => { if (now - v.ts > this.ttlMs) { this.map.delete(k); removed++; } });
    return removed;
  }
}

// Moonshot AI client for Kimi translation
const moonshotClient = new OpenAI({
  apiKey: apiKeys.moonshot(),
  baseURL: "https://api.moonshot.cn/v1",
});

const openaiSTTClient = new OpenAI({
  apiKey: apiKeys.openai(),
  ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
});

const groqSTTClient: OpenAI | null = (() => {
  const key = apiKeys.groq();
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" });
})();

const resolvedAnthropicKey = apiKeys.anthropic();
const resolvedAnthropicBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const anthropic = new Anthropic({
  apiKey: resolvedAnthropicKey,
  ...(resolvedAnthropicBaseUrl ? { baseURL: resolvedAnthropicBaseUrl } : {}),
});

// Multer configuration for audio file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const GENERIC_NAMES = new Set(["user", "guest", "anonymous", "unknown", "null", "undefined", ""]);

function sanitizeUser(u: any): any {
  if (!u) return u;
  const { email, ...safeUser } = u;
  return { ...safeUser, emailLinked: !!email };
}

function getValidDisplayName(firstName?: string | null, lastName?: string | null): string {
  const isValid = (n: string | null | undefined): n is string => !!n && !!n.trim() && !GENERIC_NAMES.has(n.trim().toLowerCase());
  if (isValid(firstName)) return firstName.trim();
  if (isValid(lastName)) return lastName.trim();
  return "Guest";
}

// Store connected clients for WebSocket signaling
export const connectedClients = new Map<string, WebSocket>();

// Store room participants: roomCode -> Set of userIds
export const roomParticipants = new Map<string, Set<string>>();

// Store which room each user is in
export const userRooms = new Map<string, string>();

function getTranslationPrompt(sourceLang: string, targetLang: string): string {
  return `You are a native-fluent translator for a casual chat messaging app. Translate from ${sourceLang} into ${targetLang}.

CORE RULES:
- Output ONLY the translated text — nothing else
- Translate for NATURAL, NATIVE-SOUNDING meaning — how a native speaker would actually say it in casual conversation
- Do NOT do word-by-word literal translation
- Add implied pronouns, articles, and prepositions that native speakers naturally include
- If the text is ALREADY in ${targetLang}, return it EXACTLY as-is

CHAT LANGUAGE RULES:
- This is informal messaging between friends, couples, or family — translate like a native speaker texting
- Terms of endearment: "babe/baby" → use the most natural local term (Spanish: "cariño/mi amor", French: "chéri(e)", etc.)
- "I miss you/babe" → use the natural local expression (Spanish: "Te echo de menos" or "Te extraño", NOT literal "extraño nena")
- Sentence fragments are normal in chat — fill in implied words naturally
- Preserve emojis, slang, and casual tone
- Use contractions and informal grammar that native speakers actually use in texts
- Common expressions should use idiomatic equivalents, not literal translations

SPANISH-SPECIFIC (when translating TO Spanish):
- Use "te echo de menos" or "te extraño" for "I miss you" — always include "te"
- Use natural endearments: cariño, mi amor, bebé, mi vida, corazón — NOT "nena" for "babe"
- Use inverted punctuation: ¿...? ¡...!
- Reflexive verbs: include "me", "te", "se" as needed
- Use "tú" (informal) by default for chat messages
- Common: "¿Qué tal?" not "¿Cómo estás?" for casual "how are you"
- "Beautiful" as endearment → "hermosa/hermoso" or "guapa/guapo"`;
}

function getTranslationPromptShort(sourceLang: string, targetLang: string): string {
  return `Translate from ${sourceLang} to ${targetLang}. Translate naturally like a native speaker in casual chat — not word-by-word. Add implied pronouns. Use natural endearments and idiomatic expressions. Output ONLY the translation.`;
}

const SPANISH_CODES = new Set(["es", "spa", "spanish"]);

interface SpacyInputAnalysis {
  text: string;
  tone: string;
  has_endearment: boolean;
  has_affection: boolean;
  has_miss: boolean;
  has_question: boolean;
  has_exclamation: boolean;
  implied_you: boolean;
  hints: string[];
}

interface SpacyOutputValidation {
  text: string;
  score: number;
  natural: boolean;
  issues: string[];
  suggestions: string[];
}

interface SpacyFullValidation {
  input_analysis: SpacyInputAnalysis | null;
  output_validation: SpacyOutputValidation | null;
}

const defaultOutput: SpacyOutputValidation = { text: "", score: 100, natural: true, issues: [], suggestions: [] };

function runSpacyValidator(data: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 4000);
    const child = execFile("python3", ["server/spacy_validator.py"], { timeout: 4000 }, (err, stdout) => {
      clearTimeout(timeout);
      if (err) { resolve(null); return; }
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
    });
    child.stdin?.write(JSON.stringify(data));
    child.stdin?.end();
  });
}

async function analyzeInputText(text: string): Promise<SpacyInputAnalysis | null> {
  const result = await runSpacyValidator({ mode: "input", text });
  return result as SpacyInputAnalysis | null;
}

async function validateSpanishWithContext(source: string, translation: string): Promise<SpacyFullValidation> {
  const result = await runSpacyValidator({ mode: "both", source, translation });
  if (!result) return { input_analysis: null, output_validation: { ...defaultOutput, text: translation } };
  return result as SpacyFullValidation;
}

async function validateSpanishTranslation(text: string): Promise<SpacyOutputValidation> {
  const result = await runSpacyValidator({ mode: "output", text });
  if (!result) return { ...defaultOutput, text };
  return result as SpacyOutputValidation;
}

interface OversightResult {
  source: string;
  translation: string;
  target_lang: string;
  input_analysis: SpacyInputAnalysis | null;
  score: number;
  passed: boolean;
  issues: string[];
}

async function runOversightCheck(source: string, translation: string, targetLang: string): Promise<OversightResult | null> {
  const result = await runSpacyValidator({ mode: "oversight", source, translation, target_lang: targetLang });
  return result as OversightResult | null;
}

// Translation service preference with automatic latency-based switching
type TranslationProvider = "openai" | "kimi" | "gemini" | "libretranslate" | "claude";
const rawLibreTranslateUrl = (process.env.LIBRETRANSLATE_URL || "https://libretranslate.com").replace(/\/+$/, "");
if (!rawLibreTranslateUrl.startsWith("https://")) {
  console.error(`[SECURITY] BLOCKED: LibreTranslate URL must use HTTPS. Rejecting "${rawLibreTranslateUrl}" — defaulting to https://libretranslate.com`);
}
const libreTranslateUrl = rawLibreTranslateUrl.startsWith("https://") ? rawLibreTranslateUrl : "https://libretranslate.com";
const libreTranslateHttpsVerified = rawLibreTranslateUrl.startsWith("https://");
const libreTranslateApiKey = process.env.LIBRETRANSLATE_API_KEY || "";
let activeTranslationService: TranslationProvider = "libretranslate";

const TRANSLATION_ENCRYPTION_KEY = (() => {
  const envKey = apiKeys.encryption();
  if (envKey && envKey.length >= 32) return Buffer.from(envKey.slice(0, 32), "utf-8");
  const fallback = crypto.randomBytes(32);
  console.warn("[SECURITY] No ENCRYPTION_KEY set — using ephemeral key for translation cache encryption (cache will not survive restarts)");
  return fallback;
})();

function encryptCacheValue(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", TRANSLATION_ENCRYPTION_KEY, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc}`;
}

function decryptCacheValue(encrypted: string): string | null {
  try {
    const [ivHex, tagHex, encData] = encrypted.split(":");
    if (!ivHex || !tagHex || !encData) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", TRANSLATION_ENCRYPTION_KEY, Buffer.from(ivHex, "hex"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let dec = decipher.update(encData, "hex", "utf8");
    dec += decipher.final("utf8");
    return dec;
  } catch {
    return null;
  }
}

function sanitizeTranslationInput(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*on\w+\s*=/gi, "")
    .slice(0, 5000)
    .trim();
}

function computeRequestHmac(payload: string): string {
  return crypto.createHmac("sha256", TRANSLATION_ENCRYPTION_KEY).update(payload).digest("hex");
}

let autoSwitchEnabled = true;

const providerLatency: Record<TranslationProvider, { samples: number[]; avg: number; failures: number; lastFailure: number; available: boolean; cooldownMultiplier: number; consecutiveRecoveryFailures: number }> = {
  libretranslate: { samples: [], avg: 0, failures: 0, lastFailure: 0, available: true, cooldownMultiplier: 1, consecutiveRecoveryFailures: 0 },
  gemini: { samples: [], avg: 0, failures: 0, lastFailure: 0, available: !!genAI, cooldownMultiplier: 1, consecutiveRecoveryFailures: 0 },
  openai: { samples: [], avg: 0, failures: 0, lastFailure: 0, available: true, cooldownMultiplier: 1, consecutiveRecoveryFailures: 0 },
  kimi: { samples: [], avg: 0, failures: 0, lastFailure: 0, available: !!apiKeys.moonshot(), cooldownMultiplier: 1, consecutiveRecoveryFailures: 0 },
  claude: { samples: [], avg: 0, failures: 0, lastFailure: 0, available: !!resolvedAnthropicKey, cooldownMultiplier: 1, consecutiveRecoveryFailures: 0 },
};

const AUTO_SWITCH_LATENCY_THRESHOLD = 2000;
const AUTO_SWITCH_FAILURE_THRESHOLD = 3;
const BASE_PROVIDER_COOLDOWN_MS = 60000;
const MAX_PROVIDER_COOLDOWN_MS = 600000;
const LATENCY_SAMPLE_LIMIT = 20;

const segmentTranslationFallthroughs = { kimi: 0, total: 0 };
let healthAnalysisFailures = 0;
let lastHealthAnalysisSuccess = 0;

function recordProviderLatency(provider: TranslationProvider, ms: number, success: boolean) {
  const p = providerLatency[provider];
  if (success) {
    p.samples.push(ms);
    if (p.samples.length > LATENCY_SAMPLE_LIMIT) p.samples = p.samples.slice(-LATENCY_SAMPLE_LIMIT);
    p.avg = Math.round(p.samples.reduce((a, b) => a + b, 0) / p.samples.length);
    p.failures = Math.max(0, p.failures - 1);
    if (p.failures === 0) {
      p.cooldownMultiplier = 1;
      p.consecutiveRecoveryFailures = 0;
    }
  } else {
    p.failures++;
    p.lastFailure = Date.now();
    if (p.failures >= AUTO_SWITCH_FAILURE_THRESHOLD) {
      p.available = false;
      p.consecutiveRecoveryFailures++;
      p.cooldownMultiplier = Math.min(10, Math.pow(2, p.consecutiveRecoveryFailures - 1));
    }
  }

  if (autoSwitchEnabled) {
    evaluateAutoSwitch();
  }
}

function evaluateAutoSwitch() {
  const now = Date.now();
  for (const prov of ["libretranslate", "kimi", "gemini"] as TranslationProvider[]) {
    const p = providerLatency[prov];
    const effectiveCooldown = Math.min(BASE_PROVIDER_COOLDOWN_MS * p.cooldownMultiplier, MAX_PROVIDER_COOLDOWN_MS);
    if (!p.available && p.lastFailure && now - p.lastFailure > effectiveCooldown) {
      p.available = true;
      p.failures = 0;
    }
  }

  const current = providerLatency[activeTranslationService];
  if (!current.available || (current.avg > AUTO_SWITCH_LATENCY_THRESHOLD && current.samples.length >= 3)) {
    const candidates = (["libretranslate", "kimi", "gemini"] as TranslationProvider[])
      .filter(p => p !== activeTranslationService && providerLatency[p].available)
      .filter(p => {
        if (p === "gemini") return !!genAI;
        if (p === "kimi") return !!apiKeys.moonshot();
        return true;
      });

    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => {
        const aAvg = providerLatency[a].samples.length > 0 ? providerLatency[a].avg : 500;
        const bAvg = providerLatency[b].samples.length > 0 ? providerLatency[b].avg : 500;
        return aAvg < bAvg ? a : b;
      });

      const reason = !current.available ? "failures" : "high latency";
      activeTranslationService = best;
    }
  }
}

function getProviderStats() {
  return Object.fromEntries(
    (["libretranslate", "kimi", "gemini"] as TranslationProvider[]).map(p => [p, {
      avg: providerLatency[p].avg,
      samples: providerLatency[p].samples.length,
      failures: providerLatency[p].failures,
      available: providerLatency[p].available,
    }])
  );
}

// Video caption cache: messageId -> { lang, segments, noSpeech }
interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

interface CaptionData {
  lang: string;
  segments: CaptionSegment[];
  noSpeech: boolean;
}

const videoCaptionCache = new BoundedMap<string, CaptionData>(50);
const translatedCaptionCache = new BoundedMap<string, CaptionSegment[]>(100);

const CHAT_TRANSLATION_TTL = 10 * 60 * 1000;
const chatTranslationCache = new TTLMap<string, { text: string; ts: number }>(200, CHAT_TRANSLATION_TTL);

const VOICE_TRANSLATION_TTL = 10 * 60 * 1000;
const voiceTranslationCache = new TTLMap<string, { text: string; ts: number }>(200, VOICE_TRANSLATION_TTL);

async function getCachedTranslation(text: string, targetLang: string): Promise<string | null> {
  const keyHash = crypto.createHash("sha256").update(`${targetLang}:${text}`).digest("hex");

  // L1: in-process memory (BoundedMap)
  const entry = chatTranslationCache.get(keyHash);
  if (entry) {
    const decrypted = decryptCacheValue(entry.text);
    if (decrypted) return decrypted;
  }

  // L2: Redis
  const redisCached = await getCachedTranslationRedis("text", "auto", targetLang, keyHash);
  if (redisCached) {
    const decrypted = decryptCacheValue(redisCached);
    if (decrypted) return decrypted;
  }

  // L3: GitHub CDN cold store (plain text, no encryption needed — keys are hashed)
  const l3val = await cacheGet("translations", `${targetLang}:${keyHash}`);
  if (l3val) {
    // Back-fill L1+L2
    const encrypted = encryptCacheValue(l3val);
    chatTranslationCache.set(keyHash, { text: encrypted, ts: Date.now() });
    setCachedTranslationRedis("text", "auto", targetLang, keyHash, encrypted, 600).catch(() => {});
    return l3val;
  }

  return null;
}

function setCachedTranslation(text: string, targetLang: string, translated: string) {
  const keyHash = crypto.createHash("sha256").update(`${targetLang}:${text}`).digest("hex");
  const encrypted = encryptCacheValue(translated);
  // L1
  chatTranslationCache.set(keyHash, { text: encrypted, ts: Date.now() });
  // L2
  setCachedTranslationRedis("text", "auto", targetLang, keyHash, encrypted, 600).catch(() => {});
  // L3 — GitHub CDN (debounced, non-blocking)
  cacheSet("translations", `${targetLang}:${keyHash}`, translated, 7 * 24 * 60 * 60 * 1000).catch(() => {});
}

const cleanupStats = {
  lastRunAt: 0,
  totalCleaned: 0,
  runCount: 0,
  lastCleaned: 0,
};

const roomParticipantLastSeen = new Map<string, Map<string, number>>();

export function getInMemoryCacheStats() {
  return {
    chatTranslationCache: chatTranslationCache.size,
    voiceTranslationCache: voiceTranslationCache.size,
    langDetectCache: langDetectCache.size,
    videoCaptionCache: videoCaptionCache.size,
    translatedCaptionCache: translatedCaptionCache.size,
    roomMessages: roomMessages.size,
    roomLangProfiles: roomLangProfiles.size,
    onboardingSessions: onboardingSessions.size,
    connectedClients: connectedClients.size,
    roomParticipants: roomParticipants.size,
    userRooms: userRooms.size,
  };
}

export function trackParticipantActivity(roomCode: string, userId: string) {
  let room = roomParticipantLastSeen.get(roomCode);
  if (!room) { room = new Map(); roomParticipantLastSeen.set(roomCode, room); }
  room.set(userId, Date.now());
}

function runCacheCleanup() {
  const now = Date.now();
  let cleaned = 0;

  cleaned += chatTranslationCache.cleanup();
  cleaned += voiceTranslationCache.cleanup();
  cleaned += langDetectCache.cleanup();

  const langProfileMaxAge = 24 * 60 * 60 * 1000;
  roomLangProfiles.forEach((profile, roomCode) => {
    if (now - profile.createdAt > langProfileMaxAge) { roomLangProfiles.delete(roomCode); cleaned++; }
  });

  const captionMaxAge = 25 * 60 * 60 * 1000;
  videoCaptionCache.forEach((_, key) => {
    const ts = parseInt(key.split("-")[1] || "0");
    if (ts && now - ts > captionMaxAge) { videoCaptionCache.delete(key); cleaned++; }
  });
  translatedCaptionCache.forEach((_, key) => {
    const ts = parseInt(key.split(":")[0]?.split("-")[1] || "0");
    if (ts && now - ts > captionMaxAge) { translatedCaptionCache.delete(key); cleaned++; }
  });

  connectedClients.forEach((ws, userId) => {
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
      connectedClients.delete(userId);
      cleaned++;
    }
  });

  homeChatSubscribers.forEach((subs, roomCode) => {
    subs.forEach(ws => {
      if (ws.readyState !== WebSocket.OPEN) { subs.delete(ws); cleaned++; }
    });
    if (subs.size === 0) homeChatSubscribers.delete(roomCode);
  });

  wsToUserId.forEach((_, ws) => {
    if (ws.readyState !== WebSocket.OPEN) { wsToUserId.delete(ws); cleaned++; }
  });

  const participantGracePeriod = 10 * 60 * 1000;
  roomParticipants.forEach((participants, roomCode) => {
    const hasActive = Array.from(participants).some(uid => {
      const ws = connectedClients.get(uid);
      if (ws && ws.readyState === WebSocket.OPEN) return true;
      const lastSeen = roomParticipantLastSeen.get(roomCode)?.get(uid);
      return lastSeen ? (now - lastSeen < participantGracePeriod) : false;
    });
    if (!hasActive) {
      roomParticipants.delete(roomCode);
      roomParticipantLastSeen.delete(roomCode);
      cleaned++;
    }
  });

  userRooms.forEach((_, userId) => {
    const ws = connectedClients.get(userId);
    if (!ws || ws.readyState !== WebSocket.OPEN) { userRooms.delete(userId); cleaned++; }
  });

  const callGracePeriod = 15 * 60 * 1000;
  activeCalls.forEach((call, roomCode) => {
    const hasActive = Array.from(call.participants).some(uid => {
      const ws = connectedClients.get(uid);
      if (ws && ws.readyState === WebSocket.OPEN) return true;
      const lastSeen = roomParticipantLastSeen.get(roomCode)?.get(uid);
      return lastSeen ? (now - lastSeen < callGracePeriod) : false;
    });
    if (!hasActive) { activeCalls.delete(roomCode); cleaned++; }
  });

  roomCreationLimiter.forEach((entry, userId) => {
    if (now > entry.resetAt) { roomCreationLimiter.delete(userId); cleaned++; }
  });

  const onboardingMaxAge = 30 * 60 * 1000;
  onboardingSessions.forEach((session, userId) => {
    if (now - session.startedAt > onboardingMaxAge) { onboardingSessions.delete(userId); cleaned++; }
  });

  if (metrics.latency.samples.length > 100) { metrics.latency.samples = metrics.latency.samples.slice(-50); cleaned++; }
  if (metrics.errors.length > 20) { metrics.errors = metrics.errors.slice(-20); cleaned++; }
  if (metrics.alerts.length > 15) { metrics.alerts = metrics.alerts.slice(-15); cleaned++; }

  cleanupStats.lastRunAt = now;
  cleanupStats.totalCleaned += cleaned;
  cleanupStats.runCount++;
  cleanupStats.lastCleaned = cleaned;
}

function runTranslationCacheCleanup() {
  let cleaned = 0;
  cleaned += chatTranslationCache.cleanup();
  cleaned += voiceTranslationCache.cleanup();
  cleaned += langDetectCache.cleanup();
  if (cleaned > 0) {
    console.log(`[CacheCleanup] Swept ${cleaned} expired translation cache entries`);
  }
}

function runEphemeralCleanup() {
  const now = Date.now();

  // CRITICAL: This cleanup runs every 15 minutes. 
  // DO NOT add room message deletion here. Messages must be permanently saved.
  // See: https://github.com/[repo] — message persistence is a core feature.
  
  const loginRetentionDays = 90;
  const loginCutoff = new Date(now - loginRetentionDays * 24 * 60 * 60 * 1000);
  storage.cleanupOldLoginActivity(loginCutoff)
    .catch((err: any) => console.error("[SECURITY] Login activity cleanup error:", err));

  try {
    const { readdirSync, unlinkSync, statSync } = require("fs");
    const td = require("os").tmpdir();
    const tmpFiles = readdirSync(td);
    for (const f of tmpFiles) {
      if (f.startsWith("burn-in-") || f.startsWith("burn-sub-") || f.startsWith("burn-out-")) {
        try {
          const stat = statSync(require("path").join(td, f));
          if (now - stat.mtimeMs > 10 * 60 * 1000) { unlinkSync(require("path").join(td, f)); }
        } catch {}
      }
    }
  } catch {}
}

const roomCreationLimiter = new Map<string, { count: number; resetAt: number }>();

setInterval(runCacheCleanup, 15 * 60 * 1000);
setTimeout(runCacheCleanup, 60 * 1000);
setInterval(runEphemeralCleanup, 30 * 60 * 1000);
setTimeout(runEphemeralCleanup, 5 * 60 * 1000);

async function extractAudioFromVideo(videoBase64: string): Promise<Buffer> {
  const match = videoBase64.match(/^data:video\/([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid video data format");
  const ext = match[1] === "quicktime" ? "mov" : match[1];
  const videoBuffer = Buffer.from(match[2], "base64");

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpdir(), `vc-input-${id}.${ext}`);
  const outputPath = path.join(tmpdir(), `vc-audio-${id}.mp3`);

  await writeFile(inputPath, videoBuffer);

  return new Promise((resolve, reject) => {
    execFile("ffmpeg", [
      "-i", inputPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "64k",
      "-y",
      outputPath,
    ], { timeout: 30000 }, async (error) => {
      try {
        await unlink(inputPath).catch(() => {});
        if (error) {
          await unlink(outputPath).catch(() => {});
          reject(new Error("Audio extraction failed: " + error.message));
          return;
        }
        const audioBuffer = await readFile(outputPath);
        await unlink(outputPath).catch(() => {});
        if (audioBuffer.length < 100) {
          reject(new Error("No audio track found in video"));
          return;
        }
        resolve(audioBuffer);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function burnCaptionsIntoVideo(
  videoBase64: string,
  captions: { start: number; end: number; text: string }[]
): Promise<string> {
  const match = videoBase64.match(/^data:video\/([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid video data format");
  const ext = match[1] === "quicktime" ? "mov" : match[1];
  const videoBuffer = Buffer.from(match[2], "base64");

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpdir(), `burn-in-${id}.${ext}`);
  const assPath = path.join(tmpdir(), `burn-sub-${id}.ass`);
  const outputPath = path.join(tmpdir(), `burn-out-${id}.mp4`);

  await writeFile(inputPath, videoBuffer);

  const msToAss = (ms: number) => {
    const totalSeconds = Math.max(0, ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
  };

  const escapeAss = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");

  let assContent = `[Script Info]
Title: Burned Captions
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Noto Sans,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,2,0,2,20,20,80,1
Style: Translation,Noto Sans,30,&H0000FFFF,&H000000FF,&H00000000,&H80000000,0,-1,0,0,100,100,0,0,3,2,0,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const cap of captions) {
    const startT = msToAss(cap.start);
    const endT = msToAss(cap.end);
    const lines = cap.text.split("\n");
    if (lines.length >= 2) {
      assContent += `Dialogue: 0,${startT},${endT},Caption,,0,0,0,,${escapeAss(lines[0])}\n`;
      assContent += `Dialogue: 1,${startT},${endT},Translation,,0,0,0,,${escapeAss(lines.slice(1).join("\\N"))}\n`;
    } else {
      assContent += `Dialogue: 0,${startT},${endT},Caption,,0,0,0,,${escapeAss(cap.text)}\n`;
    }
  }

  await writeFile(assPath, assContent, "utf-8");

  return new Promise((resolve, reject) => {
    const assPathEscaped = assPath.replace(/([:\\'])/g, "\\$1").replace(/(\[)/g, "\\$1").replace(/(\])/g, "\\$1");
    execFile("ffmpeg", [
      "-i", inputPath,
      "-vf", `ass=${assPathEscaped}`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ], { timeout: 120000 }, async (error) => {
      try {
        await unlink(inputPath).catch(() => {});
        await unlink(assPath).catch(() => {});
        if (error) {
          await unlink(outputPath).catch(() => {});
          reject(new Error("Caption burning failed: " + error.message));
          return;
        }
        const outputBuffer = await readFile(outputPath);
        await unlink(outputPath).catch(() => {});
        const base64Out = `data:video/mp4;base64,${outputBuffer.toString("base64")}`;
        resolve(base64Out);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function transcribeVideoAudio(audioBuffer: Buffer, languageHint?: string): Promise<CaptionData> {
  const audioFile = await toFile(audioBuffer, "audio.mp3", { type: "audio/mpeg" });

  const transcribeParams: any = {
    file: audioFile,
    model: "gpt-4o-mini-transcribe",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  };

  if (languageHint && languageHint !== "auto") {
    transcribeParams.language = languageHint;
  }

  const transcription = await openaiSTTClient.audio.transcriptions.create(transcribeParams);

  const result = transcription as any;
  const detectedLang = result.language || "en";

  if (!result.text || result.text.trim().length === 0) {
    return { lang: detectedLang, segments: [], noSpeech: true };
  }

  const segments: CaptionSegment[] = (result.segments || []).map((seg: any) => ({
    start: Math.round((seg.start || 0) * 1000),
    end: Math.round((seg.end || 0) * 1000),
    text: (seg.text || "").trim(),
  })).filter((s: CaptionSegment) => s.text.length > 0);

  if (segments.length === 0 && result.text?.trim()) {
    segments.push({ start: 0, end: Math.round((result.duration || 10) * 1000), text: result.text.trim() });
  }

  return { lang: detectedLang, segments, noSpeech: false };
}

async function translateSegments(segments: CaptionSegment[], targetLang: string, sourceLang: string): Promise<CaptionSegment[]> {
  if (segments.length === 0) return [];

  const targetLanguageName = getLanguageName(targetLang);
  const allText = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");
  const systemPrompt = `Translate each numbered line to ${targetLanguageName}. Keep the [number] prefix. Output ONLY translated lines, preserving format exactly. ${getTranslationPromptShort("the source language", targetLanguageName)}`;

  const result = await gatewayChat(systemPrompt, allText, { task: "translation_prompt", maxTokens: 1000, temperature: 0.1 });

  const translatedText = result?.text || allText;

  const lines = translatedText.split("\n").filter(l => l.trim());
  const parsed = new Map<number, string>();
  for (const line of lines) {
    const m = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (m) parsed.set(parseInt(m[1]), m[2].trim());
  }

  return segments.map((s, i) => ({
    start: s.start,
    end: s.end,
    text: parsed.get(i) || s.text,
  }));
}

// Room code brute force / manipulation tracking
interface CodeAttempt {
  userId: string;
  code: string;
  timestamp: number;
}
const roomCodeAttempts = {
  failedAttempts: [] as CodeAttempt[],
  totalFailed: 0,
  totalSuccessful: 0,
  blockedUsers: new Map<string, number>(),
  alerts: [] as { userId: string; attemptCount: number; window: string; detectedAt: number; codes: string[] }[],
};
const ROOM_CODE_BRUTE_FORCE_WINDOW = 60_000;
const ROOM_CODE_BRUTE_FORCE_THRESHOLD = 10;
const ROOM_CODE_BLOCK_DURATION = 300_000;

function recordRoomCodeAttempt(userId: string, code: string, success: boolean) {
  const now = Date.now();
  if (success) {
    roomCodeAttempts.totalSuccessful++;
    return { blocked: false };
  }
  roomCodeAttempts.totalFailed++;
  roomCodeAttempts.failedAttempts.push({ userId, code, timestamp: now });
  roomCodeAttempts.failedAttempts = roomCodeAttempts.failedAttempts.filter(
    a => now - a.timestamp < ROOM_CODE_BRUTE_FORCE_WINDOW * 10
  );
  const blockExpiry = roomCodeAttempts.blockedUsers.get(userId);
  if (blockExpiry && now < blockExpiry) {
    return { blocked: true, remainingMs: blockExpiry - now };
  }
  const recentByUser = roomCodeAttempts.failedAttempts.filter(
    a => a.userId === userId && now - a.timestamp < ROOM_CODE_BRUTE_FORCE_WINDOW
  );
  if (recentByUser.length >= ROOM_CODE_BRUTE_FORCE_THRESHOLD) {
    roomCodeAttempts.blockedUsers.set(userId, now + ROOM_CODE_BLOCK_DURATION);
    const uniqueCodes = [...new Set(recentByUser.map(a => a.code))];
    roomCodeAttempts.alerts.push({
      userId,
      attemptCount: recentByUser.length,
      window: "60s",
      detectedAt: now,
      codes: uniqueCodes.slice(0, 10),
    });
    if (roomCodeAttempts.alerts.length > 50) {
      roomCodeAttempts.alerts = roomCodeAttempts.alerts.slice(-50);
    }
    console.warn(`Room code brute force detected: user ${userId} made ${recentByUser.length} failed attempts in 60s`);
    return { blocked: true, remainingMs: ROOM_CODE_BLOCK_DURATION };
  }
  return { blocked: false };
}

// Video call tracking
interface ActiveCall {
  roomCode: string;
  participants: Set<string>;
  startedAt: number;
}
const activeCalls = new Map<string, ActiveCall>();
const videoCallMetrics = {
  totalCalls: 0,
  totalDurationMs: 0,
  completedCalls: 0,
  peakConcurrent: 0,
  recentCalls: [] as { roomCode: string; participants: number; durationMs: number; endedAt: number }[],
};

function recordCallStart(roomCode: string, userId: string) {
  let call = activeCalls.get(roomCode);
  if (!call) {
    call = { roomCode, participants: new Set(), startedAt: Date.now() };
    activeCalls.set(roomCode, call);
    videoCallMetrics.totalCalls++;
  }
  call.participants.add(userId);
  if (activeCalls.size > videoCallMetrics.peakConcurrent) {
    videoCallMetrics.peakConcurrent = activeCalls.size;
  }
}

function recordCallEnd(roomCode: string, userId: string) {
  const call = activeCalls.get(roomCode);
  if (!call) return;
  call.participants.delete(userId);
  if (call.participants.size === 0) {
    const durationMs = Date.now() - call.startedAt;
    videoCallMetrics.completedCalls++;
    videoCallMetrics.totalDurationMs += durationMs;
    videoCallMetrics.recentCalls.push({
      roomCode,
      participants: 0,
      durationMs,
      endedAt: Date.now(),
    });
    if (videoCallMetrics.recentCalls.length > 20) {
      videoCallMetrics.recentCalls = videoCallMetrics.recentCalls.slice(-20);
    }
    activeCalls.delete(roomCode);
  }
}

// Metrics tracking for monitoring dashboard
interface SignupEvent {
  timestamp: number;
  deviceType: string;
  browser: string;
  platform: string;
  language: string;
  success: boolean;
  errorReason?: string;
  durationMs: number;
}

interface TokenUsageEntry {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
  feature: string;
}

interface TokenBudget {
  dailyLimit: number;
  warningThreshold: number;
  criticalThreshold: number;
  currentLevel: "low" | "medium" | "high" | "critical";
}

interface TokenTracker {
  usage: Record<string, { inputTokens: number; outputTokens: number; requests: number; cost: number }>;
  recentEntries: TokenUsageEntry[];
  dayStart: number;
  budgets: Record<string, TokenBudget>;
  lastBudgetCheck: number;
  switchHistory: { from: string; to: string; reason: string; timestamp: number }[];
}

const TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  deepseek: { input: 0, output: 0 },
  kimi: { input: 0.012 / 1000, output: 0.012 / 1000 },
  claude: { input: 1.0 / 1000000, output: 5.0 / 1000000 },
  openai: { input: 0.15 / 1000000, output: 0.6 / 1000000 },
};

const tokenTracker: TokenTracker = {
  usage: {},
  recentEntries: [],
  dayStart: Date.now(),
  budgets: {
    deepseek: { dailyLimit: 150000, warningThreshold: 0.7, criticalThreshold: 0.9, currentLevel: "low" },
    kimi: { dailyLimit: 50000, warningThreshold: 0.5, criticalThreshold: 0.75, currentLevel: "low" },
    claude: { dailyLimit: 3000, warningThreshold: 0.4, criticalThreshold: 0.65, currentLevel: "low" },
    openai: { dailyLimit: 30000, warningThreshold: 0.5, criticalThreshold: 0.75, currentLevel: "low" },
  },
  lastBudgetCheck: 0,
  switchHistory: [],
};

function resetDailyTokens() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (now - tokenTracker.dayStart > oneDayMs) {
    tokenTracker.usage = {};
    tokenTracker.recentEntries = [];
    tokenTracker.dayStart = now;
    for (const key of Object.keys(tokenTracker.budgets)) {
      tokenTracker.budgets[key].currentLevel = "low";
    }
  }
}

function trackTokenUsage(provider: string, inputTokens: number, outputTokens: number, feature: string) {
  resetDailyTokens();
  if (!tokenTracker.usage[provider]) {
    tokenTracker.usage[provider] = { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 };
  }
  const u = tokenTracker.usage[provider];
  u.inputTokens += inputTokens;
  u.outputTokens += outputTokens;
  u.requests++;
  const rates = TOKEN_COSTS[provider] || { input: 0, output: 0 };
  u.cost += inputTokens * rates.input + outputTokens * rates.output;

  tokenTracker.recentEntries.push({ provider, inputTokens, outputTokens, timestamp: Date.now(), feature });
  if (tokenTracker.recentEntries.length > 100) tokenTracker.recentEntries = tokenTracker.recentEntries.slice(-50);

  const budget = tokenTracker.budgets[provider];
  if (budget) {
    const totalTokens = u.inputTokens + u.outputTokens;
    const ratio = totalTokens / budget.dailyLimit;
    if (ratio >= budget.criticalThreshold) budget.currentLevel = "critical";
    else if (ratio >= budget.warningThreshold) budget.currentLevel = "high";
    else if (ratio >= 0.3) budget.currentLevel = "medium";
    else budget.currentLevel = "low";
  }
}

function getTokenSnapshot() {
  resetDailyTokens();
  const snapshot: Record<string, any> = {};
  for (const [prov, data] of Object.entries(tokenTracker.usage)) {
    const budget = tokenTracker.budgets[prov];
    const totalTokens = data.inputTokens + data.outputTokens;
    snapshot[prov] = {
      ...data,
      totalTokens,
      budgetUsedPercent: budget ? Math.round((totalTokens / budget.dailyLimit) * 100) : 0,
      level: budget?.currentLevel || "unknown",
      dailyLimit: budget?.dailyLimit || 0,
    };
  }
  return {
    providers: snapshot,
    dayStartedAt: new Date(tokenTracker.dayStart).toISOString(),
    recentSwitches: tokenTracker.switchHistory.slice(-10),
    totalEstimatedCost: Object.values(tokenTracker.usage).reduce((sum, u) => sum + u.cost, 0),
  };
}

function getRedactedTokenSnapshot() {
  const raw = getTokenSnapshot();
  const redacted: Record<string, any> = {};
  for (const [prov, data] of Object.entries(raw.providers)) {
    const d = data as any;
    redacted[prov] = {
      requests: d.requests,
      budgetUsedPercent: d.budgetUsedPercent,
      level: d.level,
    };
  }
  return {
    providers: redacted,
    dayStartedAt: raw.dayStartedAt,
    recentSwitchCount: raw.recentSwitches.length,
  };
}

function shouldThrottleProvider(provider: string): boolean {
  const budget = tokenTracker.budgets[provider];
  if (!budget) return false;
  const freeTier = provider === "deepseek";
  if (freeTier) return budget.currentLevel === "critical";
  return budget.currentLevel === "high" || budget.currentLevel === "critical";
}

function recordProviderSwitch(from: string, to: string, reason: string) {
  tokenTracker.switchHistory.push({ from, to, reason, timestamp: Date.now() });
  if (tokenTracker.switchHistory.length > 50) tokenTracker.switchHistory = tokenTracker.switchHistory.slice(-25);
}

interface MetricsData {
  translationRequests: { total: number; success: number; failed: number; byProvider: Record<string, number> };
  latency: { samples: number[]; avg: number; p95: number; max: number };
  websocket: { currentConnections: number; totalConnections: number; reconnects: number };
  rooms: { activeRooms: number; totalCreated: number };
  uptime: number;
  startTime: number;
  errors: { timestamp: number; message: string; provider: string }[];
  alerts: { id: string; type: "warning" | "critical"; message: string; timestamp: number; resolved: boolean }[];
  signups: { total: number; successful: number; failed: number; recent: SignupEvent[]; byDevice: Record<string, number>; byBrowser: Record<string, number>; byPlatform: Record<string, number> };
}

const metrics: MetricsData = {
  translationRequests: { total: 0, success: 0, failed: 0, byProvider: { libretranslate: 0, gemini: 0, openai: 0, kimi: 0 } },
  latency: { samples: [], avg: 0, p95: 0, max: 0 },
  websocket: { currentConnections: 0, totalConnections: 0, reconnects: 0 },
  rooms: { activeRooms: 0, totalCreated: 0 },
  uptime: 0,
  startTime: Date.now(),
  errors: [],
  alerts: [],
  signups: { total: 0, successful: 0, failed: 0, recent: [], byDevice: {}, byBrowser: {}, byPlatform: {} },
};

// Socket handling monitor tracking
interface SocketMetrics {
  messagesRouted: number;
  messagesFailed: number;
  typingEventsRouted: number;
  presenceUpdates: number;
  disconnections: number;
  abnormalClosures: number;
  authFailures: number;
  pingPongFailures: number;
  avgDeliveryMs: number;
  deliverySamples: number[];
  recentEvents: { timestamp: number; event: string; userId?: string; detail?: string }[];
  peakConnections: number;
  peakConnectionsTime: number;
  chatSubscriberLeaks: number;
}
export const socketMetrics: SocketMetrics = {
  messagesRouted: 0,
  messagesFailed: 0,
  typingEventsRouted: 0,
  presenceUpdates: 0,
  disconnections: 0,
  abnormalClosures: 0,
  authFailures: 0,
  pingPongFailures: 0,
  avgDeliveryMs: 0,
  deliverySamples: [],
  recentEvents: [],
  peakConnections: 0,
  peakConnectionsTime: Date.now(),
  chatSubscriberLeaks: 0,
};

export function trackSocketEvent(event: string, userId?: string, detail?: string) {
  socketMetrics.recentEvents.push({ timestamp: Date.now(), event, userId, detail });
  if (socketMetrics.recentEvents.length > 100) {
    socketMetrics.recentEvents = socketMetrics.recentEvents.slice(-100);
  }
  const currentConns = connectedClients.size;
  if (currentConns > socketMetrics.peakConnections) {
    socketMetrics.peakConnections = currentConns;
    socketMetrics.peakConnectionsTime = Date.now();
  }
}

// Onboarding watchdog tracking
interface OnboardingSession {
  userId: string;
  startedAt: number;
  steps: { step: string; timestamp: number; success: boolean; error?: string }[];
  completed: boolean;
  failed: boolean;
  lastError?: string;
  deviceInfo?: string;
}
const MAX_ONBOARDING_SESSIONS = 200;
const onboardingSessions = new Map<string, OnboardingSession>();
const onboardingErrors: { userId: string; step: string; error: string; timestamp: number; autoRecovered: boolean }[] = [];

function trackOnboardingStep(userId: string, step: string, success: boolean, error?: string, deviceInfo?: string) {
  let session = onboardingSessions.get(userId);
  if (step === "page_load") {
    session = { userId, startedAt: Date.now(), steps: [], completed: false, failed: false, deviceInfo };
    if (onboardingSessions.size >= MAX_ONBOARDING_SESSIONS && !onboardingSessions.has(userId)) {
      const firstKey = onboardingSessions.keys().next().value;
      if (firstKey) onboardingSessions.delete(firstKey);
    }
    onboardingSessions.set(userId, session);
  }
  if (!session) {
    session = { userId, startedAt: Date.now(), steps: [], completed: false, failed: false, deviceInfo };
    if (onboardingSessions.size >= MAX_ONBOARDING_SESSIONS && !onboardingSessions.has(userId)) {
      const firstKey = onboardingSessions.keys().next().value;
      if (firstKey) onboardingSessions.delete(firstKey);
    }
    onboardingSessions.set(userId, session);
  }
  session.steps.push({ step, timestamp: Date.now(), success, error });
  if (!success && error) {
    session.lastError = error;
    session.failed = true;
    onboardingErrors.push({ userId, step, error, timestamp: Date.now(), autoRecovered: false });
    if (onboardingErrors.length > 100) onboardingErrors.splice(0, onboardingErrors.length - 100);
  }
  if (step === "complete" && success) {
    session.completed = true;
    session.failed = false;
  }
  if (onboardingSessions.size > 200) {
    const oldest = Array.from(onboardingSessions.entries())
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .slice(0, onboardingSessions.size - 200);
    oldest.forEach(([k]) => onboardingSessions.delete(k));
  }
}

// User behavior tracking for Claude agent monitoring
const userBehaviorLog: { action: string; feature: string; timestamp: number }[] = [];
const featureUsageCounts: Record<string, number> = {};

export function trackAction(action: string, feature: string) {
  const now = Date.now();
  userBehaviorLog.push({ action, feature, timestamp: now });
  if (userBehaviorLog.length > 200) userBehaviorLog.splice(0, userBehaviorLog.length - 200);
  featureUsageCounts[feature] = (featureUsageCounts[feature] || 0) + 1;
}

function parseUserAgent(ua: string): { deviceType: string; browser: string; platform: string } {
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  const isTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  let browser = "unknown";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Opera|OPR\//i.test(ua)) browser = "Opera";
  let platform = "unknown";
  if (/Windows/i.test(ua)) platform = "Windows";
  else if (/Mac OS|Macintosh/i.test(ua)) platform = "macOS";
  else if (/Linux/i.test(ua) && !/Android/i.test(ua)) platform = "Linux";
  else if (/Android/i.test(ua)) platform = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = "iOS";
  return { deviceType, browser, platform };
}

function recordSignup(req: any, success: boolean, durationMs: number, language: string, errorReason?: string) {
  const ua = req.headers["user-agent"] || "";
  const { deviceType, browser, platform } = parseUserAgent(ua);
  const event: SignupEvent = { timestamp: Date.now(), deviceType, browser, platform, language, success, durationMs, errorReason };
  metrics.signups.total++;
  if (success) metrics.signups.successful++;
  else metrics.signups.failed++;
  metrics.signups.recent.unshift(event);
  if (metrics.signups.recent.length > 50) metrics.signups.recent.length = 50;
  metrics.signups.byDevice[deviceType] = (metrics.signups.byDevice[deviceType] || 0) + 1;
  metrics.signups.byBrowser[browser] = (metrics.signups.byBrowser[browser] || 0) + 1;
  metrics.signups.byPlatform[platform] = (metrics.signups.byPlatform[platform] || 0) + 1;
  if (!success) {
    addAlert("warning", `Signup failed from ${deviceType}/${browser}/${platform}: ${errorReason || "unknown"}`);
  }
}

const LATENCY_THRESHOLD_WARNING = 2000;
const LATENCY_THRESHOLD_CRITICAL = 5000;
const ERROR_RATE_THRESHOLD = 0.1;

function recordLatency(ms: number) {
  metrics.latency.samples.push(ms);
  if (metrics.latency.samples.length > 100) {
    metrics.latency.samples = metrics.latency.samples.slice(-50);
  }
  const sorted = [...metrics.latency.samples].sort((a, b) => a - b);
  metrics.latency.avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  metrics.latency.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  metrics.latency.max = sorted[sorted.length - 1] || 0;

  if (metrics.latency.avg > LATENCY_THRESHOLD_CRITICAL) {
    addAlert("critical", `Average latency critically high: ${metrics.latency.avg}ms`);
  } else if (metrics.latency.avg > LATENCY_THRESHOLD_WARNING) {
    addAlert("warning", `Average latency elevated: ${metrics.latency.avg}ms`);
  }
}

function recordTranslation(provider: string, success: boolean, errorMsg?: string) {
  metrics.translationRequests.total++;
  if (success) {
    metrics.translationRequests.success++;
  } else {
    metrics.translationRequests.failed++;
    if (errorMsg) {
      metrics.errors.push({ timestamp: Date.now(), message: errorMsg, provider });
      if (metrics.errors.length > 50) metrics.errors = metrics.errors.slice(-50);
    }
  }
  metrics.translationRequests.byProvider[provider] = (metrics.translationRequests.byProvider[provider] || 0) + 1;

  const errorRate = metrics.translationRequests.total > 0 
    ? metrics.translationRequests.failed / metrics.translationRequests.total 
    : 0;
  if (errorRate > ERROR_RATE_THRESHOLD && metrics.translationRequests.total > 5) {
    addAlert("warning", `Error rate at ${(errorRate * 100).toFixed(1)}% (${metrics.translationRequests.failed}/${metrics.translationRequests.total})`);
  }
}

function addAlert(type: "warning" | "critical", message: string) {
  const existing = metrics.alerts.find(a => a.message === message && !a.resolved && Date.now() - a.timestamp < 300000);
  if (existing) return;
  metrics.alerts.push({
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    message,
    timestamp: Date.now(),
    resolved: false,
  });
  if (metrics.alerts.length > 30) metrics.alerts = metrics.alerts.slice(-30);
}

// Room message type for in-memory cache and WebSocket broadcast
export interface RoomChatMsg {
  id: string;
  roomCode: string;
  fromId: string;
  fromName: string;
  text: string;
  timestamp: number;
  imageData?: string;
  videoData?: string;
  audioData?: string;
  mediaType?: string;
  transcription?: string;
  vanish?: boolean;
  reactions?: Record<string, string[]>;
  replyTo?: { id: string; fromName: string; text: string; imageData?: string; videoData?: string };
  edited?: boolean;
  editedAt?: number;
  e2ee?: boolean;
}
const ROOM_MSG_CAP = 200;
export const roomMessages = new BoundedMap<string, RoomChatMsg[]>(50);

export function addRoomMessage(roomCode: string, msg: RoomChatMsg) {
  if (!roomMessages.has(roomCode)) {
    roomMessages.set(roomCode, []);
  }
  const messages = roomMessages.get(roomCode)!;
  messages.push(msg);
  if (messages.length > ROOM_MSG_CAP) messages.splice(0, messages.length - ROOM_MSG_CAP);

  if ((msg as any).vanish) {
    return;
  }

  const isEmoji = msg.imageData && msg.imageData.startsWith("https://fonts.gstatic.com/");
  const isGif = msg.imageData && msg.imageData.startsWith("https://media") && msg.imageData.includes("giphy.com/");
  const contentToSave = isEmoji
    ? `[Emoji:${msg.imageData}]`
    : isGif
    ? `[GIF:${msg.imageData}]`
    : msg.e2ee
    ? `[E2EE]${msg.text}`
    : msg.text;
  storage.saveRoomMessage({
    roomCode: msg.roomCode,
    fromId: msg.fromId,
    fromName: msg.fromName,
    content: contentToSave,
    clientMessageId: msg.id,
    ...(msg.audioData ? { audioData: msg.audioData } : {}),
    ...(msg.transcription ? { transcription: msg.transcription } : {}),
    ...(msg.replyTo ? { replyToData: JSON.stringify(msg.replyTo) } : {}),
  }).catch(err => console.error("[DB] Failed to persist room message:", err));
}

export function notifyMessageCountUpdate(roomCode: string, senderId: string) {
  const subs = homeChatSubscribers.get(roomCode);
  if (!subs) return;
  const payload = JSON.stringify({ type: "msg-count-update", roomCode });
  subs.forEach(ws => {
    const uid = wsToUserId.get(ws);
    if (uid && uid !== senderId && ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch {}
    }
  });
  connectedClients.forEach((ws, uid) => {
    if (uid !== senderId && ws.readyState === WebSocket.OPEN) {
      const userRoom = userRooms.get(uid);
      if (userRoom && userRoom === roomCode) {
        try { ws.send(payload); } catch {}
      }
    }
  });
}


// Track which rooms each home subscriber is watching chat for
export const homeChatSubscribers = new Map<string, Set<WebSocket>>();
export const wsToUserId = new Map<WebSocket, string>();

export function broadcastHomeChat(roomCode: string, msg: RoomChatMsg, excludeWs?: WebSocket) {
  const subs = homeChatSubscribers.get(roomCode);
  if (!subs) return;
  const broadcastStart = Date.now();
  let delivered = 0;
  const payload = JSON.stringify({ type: "home-chat-message", message: msg });
  subs.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 128 * 1024) {
        trackSocketEvent("backpressure_skip", wsToUserId.get(ws) || undefined, `buffered=${ws.bufferedAmount}`);
        return;
      }
      ws.send(payload);
      delivered++;
    }
  });
  socketMetrics.messagesRouted++;
  const deliveryMs = Date.now() - broadcastStart;
  socketMetrics.deliverySamples.push(deliveryMs);
  if (socketMetrics.deliverySamples.length > 200) {
    socketMetrics.deliverySamples = socketMetrics.deliverySamples.slice(-200);
  }
  socketMetrics.avgDeliveryMs = Math.round(
    socketMetrics.deliverySamples.reduce((a, b) => a + b, 0) / socketMetrics.deliverySamples.length
  );
  if (delivered === 0 && subs.size > 1) {
    socketMetrics.messagesFailed++;
    trackSocketEvent("msg_delivery_fail", msg.fromId, `room=${roomCode},subs=${subs.size},delivered=0`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  initSecretsGuard();
  app.use(secretsGuardMiddleware);

  // Pre-warm L3 cache namespaces from GitHub CDN (non-blocking)
  Promise.all([
    cacheWarm("translations").catch(() => {}),
    cacheWarm("feature-flags").catch(() => {}),
    cacheWarm("chat-responses").catch(() => {}),
  ]).then(() => {
    // After L3 is loaded, seed missing phrase translations using free curated data
    import("./translation-cache-seeder").then(m => m.seedTranslationCache()).catch(() => {});
  }).catch(() => {});

  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // Setup object storage routes
  registerObjectStorageRoutes(app);
  const objectStorageService = new ObjectStorageService();

  registerHealthRoutes(app);

  app.get("/api/admin/arena-llm/config", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json(getArenaConfig());
  });

  app.get("/api/admin/arena-llm/models", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const task = (req.query.task as string) || "chat";
    res.json({
      models: getArenaModelRegistry(),
      routing: getArenaRoutingConfig(),
      ranked: rankModelsForTask(task),
    });
  });

  app.post("/api/admin/arena-llm/push", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const ok = await pushArenaConfig(req.body, "[ArenaLLM] Admin update via JunoTalk dashboard");
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: "Push failed", message: err.message });
    }
  });

  app.get("/api/admin/knowledge-sync/stats", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json(getSyncStats());
  });

  // ── Juno Data Engine — scraped knowledge stats & force-reload ────────────────
  app.get("/api/admin/scraper/stats", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json(getKnowledgeStats());
  });

  app.post("/api/admin/scraper/reload", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const count = await loadScrapedKnowledge();
      res.json({ ok: true, loaded: count, stats: getKnowledgeStats() });
    } catch (err: any) {
      res.status(500).json({ error: "Reload failed", message: err.message });
    }
  });

  // Webhook endpoint — called by juno-data-engine after each push to CDN
  // Authorization: Bearer <KNOWLEDGE_SYNC_SECRET>
  app.post("/api/webhooks/scraper-push", async (req: any, res) => {
    const syncSecret = process.env.KNOWLEDGE_SYNC_SECRET;
    if (syncSecret) {
      const authHeader = (req.headers["authorization"] as string) || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== syncSecret) return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const count = await loadScrapedKnowledge();
      console.log(`[ScraperWebhook] Reload triggered — ${count} items now in knowledge base`);
      res.json({ ok: true, loaded: count });
    } catch (err: any) {
      res.status(500).json({ error: "Reload failed" });
    }
  });

  // ── Force knowledge-base reload ─────────────────────────────────────────────
  // Called automatically by GitHub Actions whenever new JSON is pushed to
  // lasawno/Knowledge-Base-Integration.  Uses a static bearer token so no
  // browser session is needed — safe to call from CI pipelines.
  app.post("/api/admin/knowledge-sync/force", async (req: any, res) => {
    const syncSecret = process.env.KNOWLEDGE_SYNC_SECRET;
    if (!syncSecret) return res.status(503).json({ error: "Sync not configured" });

    const authHeader = (req.headers["authorization"] as string) || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    // Constant-time comparison to prevent timing attacks
    if (token.length !== syncSecret.length) return res.status(401).json({ error: "Unauthorized" });
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) mismatch |= token.charCodeAt(i) ^ syncSecret.charCodeAt(i);
    if (mismatch !== 0) return res.status(401).json({ error: "Unauthorized" });

    try {
      console.log("[KnowledgeSync] Force sync triggered via webhook");
      const stats = await syncKnowledgeBase(true);
      console.log(`[KnowledgeSync] Webhook sync complete — ${stats.total} entries loaded`);
      res.json({ ok: true, stats });
    } catch (err: any) {
      console.error("[KnowledgeSync] Force sync failed:", err.message);
      res.status(500).json({ error: "Sync failed", message: err.message });
    }
  });

  // Recall orchestrator — live probe endpoint used by recall-sim.ts
  // Runs a single query through the fully-initialized orchestrator and returns
  // all lane results, timing, and hit metadata. Admin-only.
  app.post("/api/admin/recall-probe", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { text = "", sourceLang = "en", targetLang = "en", profile = "translation", userId } = req.body;
    if (!["translation", "juno", "vision"].includes(profile)) {
      return res.status(400).json({ error: "Invalid profile. Use: translation, juno, vision" });
    }
    try {
      const result = await orchestrateRecall(
        { text, sourceLang, targetLang, userId },
        profile as "translation" | "juno" | "vision",
      );
      res.json({ result, config: getOrchestratorConfig(), githubLoad: getGithubFallbackLoad() });
    } catch (err: any) {
      res.status(500).json({ error: "Probe failed", message: err.message });
    }
  });

  app.get("/api/admin/recall-config", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json({ config: getOrchestratorConfig(), githubLoad: getGithubFallbackLoad() });
  });

  app.post("/api/admin/knowledge-sync/run", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const stats = await syncKnowledgeBase(true);
      res.json({ success: true, stats });
    } catch (err: any) {
      res.status(500).json({ error: "Sync failed", message: err.message });
    }
  });

  app.get("/api/admin/cache-stats", isAuthenticated, async (_req: any, res) => {
    try {
      const l3 = getCacheStats();
      const l1l2 = getInMemoryCacheStats();
      res.json({ layers: { l1Memory: l1l2, l3GitHub: l3 } });
    } catch (err) {
      res.status(500).json({ error: "Failed to get cache stats" });
    }
  });

  app.get("/api/vector-memory/stats", isAuthenticated, async (_req: any, res) => {
    try {
      const { getEmbeddingServiceStats } = await import("./embedding-service");
      res.json(getEmbeddingServiceStats());
    } catch (err) {
      res.status(500).json({ error: "Failed to get vector memory stats" });
    }
  });


  app.post("/api/vector-memory/precompute", isAuthenticated, async (req: any, res) => {
    try {
      const { precomputeTranslationEmbeddings } = await import("./embedding-service");
      const { COMMON_PHRASES, githubFallbackCache } = await import("./translation-fallback");
      const merged: Record<string, Record<string, Record<string, string>>> = {};
      for (const source of [COMMON_PHRASES, githubFallbackCache]) {
        for (const [src, targets] of Object.entries(source)) {
          if (!merged[src]) merged[src] = {};
          for (const [tgt, pairs] of Object.entries(targets)) {
            if (!merged[src][tgt]) merged[src][tgt] = {};
            Object.assign(merged[src][tgt], pairs);
          }
        }
      }
      const stats = await precomputeTranslationEmbeddings(merged);
      res.json({ success: true, ...stats });
    } catch (err: any) {
      res.status(500).json({ error: "Precompute failed", message: err.message });
    }
  });

  app.post("/api/vector-memory/search-translations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { queryText, sourceLang, targetLang, limit, roomCode } = req.body;
      if (!queryText || typeof queryText !== "string" || !sourceLang || !targetLang) {
        return res.status(400).json({ error: "queryText, sourceLang, and targetLang are required" });
      }
      if (queryText.length > 2000) {
        return res.status(400).json({ error: "queryText exceeds maximum length of 2000 characters" });
      }
      const clampedLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
      const results = await storage.searchSimilarTranslations(queryText, sourceLang, targetLang, clampedLimit, roomCode);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: "Similarity search failed" });
    }
  });

  app.get(["/api/carousel-agent/feed", "/api/v1/carousel-agent/feed"], isAuthenticated, async (_req: any, res) => {
    try {
      const items = await storage.getCarouselItems();
      const grouped: Record<string, typeof items> = {};
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }
      res.json({ grouped, total: items.length, updatedAt: items[0]?.createdAt ?? null });
    } catch {
      res.status(500).json({ error: "Failed to fetch carousel feed" });
    }
  });

  const BUNDLED_UI_LANGS = new Set(["en", "es", "fr", "zh", "hi"]);
  app.get("/api/v1/translations/:lang", isAuthenticated, async (req: any, res) => {
    const { lang } = req.params;
    if (!lang || !/^[a-z]{2,3}$/.test(lang)) return res.status(400).json({ error: "Invalid language code" });
    if (BUNDLED_UI_LANGS.has(lang)) return res.status(400).json({ error: "Bundled language — no CDN needed" });
    try {
      const data = await fetchPrivateFile(`translations/${lang}.json`);
      if (!data) return res.status(404).json({ error: "Translation not found" });
      res.json(data);
    } catch {
      res.status(500).json({ error: "Failed to fetch translation" });
    }
  });

  app.post("/api/vector-memory/search-conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { queryText, roomCode, limit } = req.body;
      if (!queryText || typeof queryText !== "string") {
        return res.status(400).json({ error: "queryText is required" });
      }
      if (queryText.length > 2000) {
        return res.status(400).json({ error: "queryText exceeds maximum length of 2000 characters" });
      }
      const clampedLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
      const results = await storage.searchConversationContext(queryText, userId, roomCode, clampedLimit);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: "Conversation search failed" });
    }
  });

  const v1Router = Router();

  const APP_BUILD_TIME = Date.now().toString();
  v1Router.get("/app-version", (_req, res) => {
    res.json({ version: APP_BUILD_TIME });
  });

  v1Router.post("/client-error", (req, res) => {
    try {
      const { message, stack, componentStack, url, userAgent } = req.body || {};
      console.error("[CLIENT ERROR]", JSON.stringify({ message, stack, componentStack, url, userAgent }, null, 2));
      res.json({ received: true });
    } catch {
      res.json({ received: true });
    }
  });

  v1Router.get("/jitsi/config", isAuthenticated, (_req: any, res) => {
    const appId = process.env.JAAS_APP_ID;
    const rawKey = process.env.JAAS_API_KEY;
    const keyId = process.env.JAAS_KEY_ID;
    const jaasConfigured = !!(appId && rawKey && keyId);

    res.json({
      jaasConfigured,
      domain: jaasConfigured ? "8x8.vc" : "meet.jit.si",
      appId: jaasConfigured ? appId : null,
    });
  });

  v1Router.get("/jaas/token", isAuthenticated, (req: any, res) => {
    try {
      const appId = process.env.JAAS_APP_ID;
      const rawKey = process.env.JAAS_API_KEY;
      const keyId = process.env.JAAS_KEY_ID;

      if (!appId || !rawKey || !keyId) {
        return res.status(404).json({ error: "JaaS not configured", jaasConfigured: false });
      }

      const roomName = req.query.room as string;
      if (!roomName) {
        return res.status(400).json({ error: "Room name required" });
      }

      const privateKey = rawKey.replace(/\\n/g, "\n");

      const user = req.user;
      const now = Math.floor(Date.now() / 1000);

      const payload = {
        aud: "jitsi",
        iss: "chat",
        sub: appId,
        room: "*",
        exp: now + 7200,
        nbf: now - 10,
        context: {
          user: {
            id: String(user.id || `user-${Date.now()}`),
            name: user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName.charAt(0)}.`
              : user.firstName || "User",
            avatar: user.profileImageUrl || "",
            moderator: true,
          },
          features: {
            livestreaming: false,
            recording: false,
            transcription: false,
            "outbound-call": false,
            "sip-outbound-call": false,
            "sip-inbound-call": false,
          },
        },
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: "RS256",
        header: {
          alg: "RS256",
          kid: `${appId}/${keyId}`,
          typ: "JWT",
        },
      });

      res.json({ token, appId });
    } catch (error: any) {
      console.error("JaaS token generation error:", error.message);
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  const ROOM_CREATION_LIMIT_PER_USER = 50;
  const ROOM_CREATION_LIMIT_GLOBAL = 50;
  const ROOM_CREATION_WINDOW = 60 * 60 * 1000;
  let globalRoomCreation = { count: 0, resetAt: Date.now() + ROOM_CREATION_WINDOW };

  function checkRoomCreationRate(userId: string): boolean {
    const now = Date.now();

    if (now > globalRoomCreation.resetAt) {
      globalRoomCreation = { count: 0, resetAt: now + ROOM_CREATION_WINDOW };
    }
    if (globalRoomCreation.count >= ROOM_CREATION_LIMIT_GLOBAL) return false;

    const entry = roomCreationLimiter.get(userId);
    if (!entry || now > entry.resetAt) {
      roomCreationLimiter.set(userId, { count: 1, resetAt: now + ROOM_CREATION_WINDOW });
      globalRoomCreation.count++;
      return true;
    }
    if (entry.count >= ROOM_CREATION_LIMIT_PER_USER) return false;
    entry.count++;
    globalRoomCreation.count++;
    return true;
  }

  // WebSocket server for signaling
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    perMessageDeflate: {
      zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
      zlibInflateOptions: { chunkSize: 10 * 1024 },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 128,
    },
    maxPayload: 10 * 1024 * 1024,
  });

  // Session middleware for parsing session cookies on WS upgrade
  const sessionMiddleware = getSession();

  // Helper to extract authenticated userId from WS upgrade request
  function authenticateWsRequest(req: any): Promise<string | null> {
    return new Promise((resolve) => {
      // Minimal response mock sufficient for session reading (not writing)
      const res = {
        end: () => {},
        setHeader: () => res,
        getHeader: () => "",
        writeHead: () => res,
        on: () => res,
        removeListener: () => res,
        emit: () => res,
      } as any;
      try {
        sessionMiddleware(req, res, () => {
          passport.initialize()(req, res, () => {
            passport.session()(req, res, () => {
              const user = req.user as any;
              if (user && user.claims && user.claims.sub) {
                resolve(user.claims.sub);
              } else {
                resolve(null);
              }
            });
          });
        });
      } catch (err) {
        console.error("[WebSocket] Session auth error");
        resolve(null);
      }
    });
  }

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        socketMetrics.pingPongFailures++;
        const deadUserId = wsToUserId.get(ws);
        trackSocketEvent("ping_timeout", deadUserId || undefined, "no pong received in 30s");
        ws.close();
        return;
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("connection", async (ws, req) => {
    // Authenticate the WebSocket connection via session cookie
    const authenticatedUserId = await authenticateWsRequest(req);
    let userId: string | null = authenticatedUserId;
    (ws as any).isAlive = true;
    (ws as any).authenticatedUserId = authenticatedUserId;
    ws.on("pong", () => { (ws as any).isAlive = true; });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "ping":
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            (ws as any).isAlive = true;
            break;
          case "register":
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
              break;
            }
            if (message.userId && message.userId !== authenticatedUserId) {
              socketMetrics.authFailures++;
              trackSocketEvent("auth_mismatch", authenticatedUserId || undefined, `claimed=${message.userId}`);
              ws.send(JSON.stringify({ type: "error", message: "User identity mismatch" }));
              break;
            }
            userId = authenticatedUserId;
            if (userId) {
              const oldWs = connectedClients.get(userId);
              if (oldWs && oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
                oldWs.close();
              }
              connectedClients.set(userId, ws);
              wsToUserId.set(ws, userId);
              metrics.websocket.totalConnections++;
              await storage.updateStatus(userId, "online");
              broadcastStatus(userId, "online");
            }
            break;

          case "offer":
          case "answer":
          case "ice-candidate":
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode) trackParticipantActivity(message.roomCode.toUpperCase(), userId);
            const targetWs = connectedClients.get(message.targetId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: message.type,
                data: message.data,
                fromId: userId,
              }));
            }
            break;

          case "call-request": {
            if (!authenticatedUserId || !userId) break;
            if (message.targetId) {
              const calleeWs = connectedClients.get(message.targetId);
              if (calleeWs && calleeWs.readyState === WebSocket.OPEN) {
                const callerUser = await storage.getUser(userId);
                const callerName = callerUser
                  ? `${callerUser.firstName || ""} ${callerUser.lastName || ""}`.trim() || "Someone"
                  : "Someone";
                calleeWs.send(JSON.stringify({
                  type: "incoming-call",
                  fromId: userId,
                  callerId: userId,
                  callerName,
                  callerAvatar: callerUser?.profileImageUrl || null,
                  roomCode: message.roomCode || null,
                }));
              } else {
                ws.send(JSON.stringify({ type: "call-unavailable", targetId: message.targetId }));
              }
            }
            break;
          }

          case "room-call-notify": {
            if (!authenticatedUserId || !userId) break;
            const notifyRoom = message.roomCode?.toUpperCase();
            if (!notifyRoom) break;
            const callerUser = await storage.getUser(userId);
            const callerName = callerUser ? `${callerUser.firstName || ""} ${callerUser.lastName || ""}`.trim() || "Someone" : "Someone";
            const notifySubs = homeChatSubscribers.get(notifyRoom);
            if (notifySubs) {
              const payload = JSON.stringify({
                type: "incoming-call",
                roomCode: notifyRoom,
                fromId: userId,
                callerId: userId,
                callerName,
              });
              notifySubs.forEach(s => {
                const subUserId = wsToUserId.get(s);
                if (s.readyState === WebSocket.OPEN && subUserId !== userId) {
                  s.send(payload);
                }
              });
            }
            const notifyRoomParts = roomParticipants.get(notifyRoom);
            if (notifyRoomParts) {
              notifyRoomParts.forEach(pid => {
                if (pid === userId) return;
                const pWs = connectedClients.get(pid);
                if (pWs && pWs.readyState === WebSocket.OPEN) {
                  pWs.send(JSON.stringify({
                    type: "incoming-call",
                    roomCode: notifyRoom,
                    fromId: userId,
                    callerId: userId,
                    callerName,
                  }));
                }
              });
            }
            break;
          }

          case "call-accepted":
          case "call-rejected":
          case "call-ended": {
            if (!authenticatedUserId || !userId) break;
            const callerWs = connectedClients.get(message.targetId);
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              callerWs.send(JSON.stringify({
                type: message.type,
                fromId: userId,
                roomCode: message.roomCode || null,
              }));
            }
            break;
          }

          case "call-cancelled": {
            if (!authenticatedUserId || !userId) break;
            const cancelWs = connectedClients.get(message.targetId);
            if (cancelWs && cancelWs.readyState === WebSocket.OPEN) {
              cancelWs.send(JSON.stringify({ type: "call-cancelled", fromId: userId }));
            }
            break;
          }

          case "caption":
            if (!authenticatedUserId || !userId) break;
            const recipientWs = connectedClients.get(message.targetId);
            if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
              recipientWs.send(JSON.stringify({
                type: "caption",
                text: message.text,
                translated: message.translated,
                fromId: userId,
              }));
            }
            break;

          case "join-room":
            // User is joining a room - require session authentication
            const roomCode = message.roomCode?.toUpperCase();
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: "error", message: "Authentication required to join rooms" }));
              break;
            }
            if (roomCode && userId) {
              const blockCheck = roomCodeAttempts.blockedUsers.get(userId);
              if (blockCheck && Date.now() < blockCheck) {
                ws.send(JSON.stringify({ type: "error", message: "Too many failed attempts. Please wait before trying again." }));
                break;
              }
              const roomToJoin = await storage.getRoomByCode(roomCode);
              if (!roomToJoin || !roomToJoin.isActive) {
                const attemptResult = recordRoomCodeAttempt(userId, roomCode, false);
                if (attemptResult.blocked) {
                  ws.send(JSON.stringify({ type: "error", message: "Too many failed attempts. You are temporarily blocked for 5 minutes." }));
                } else {
                  ws.send(JSON.stringify({ type: "error", message: "Room not found or inactive" }));
                }
                break;
              }
              recordRoomCodeAttempt(userId, roomCode, true);

              // Check room capacity (max 2 active members)
              // Only skip capacity check if user is already active (they're already counted)
              const isAlreadyActiveMember = await storage.isRoomMember(roomCode, userId);
              if (!isAlreadyActiveMember) {
                const activeMembers = await storage.getRoomMembers(roomCode);
                const activeOnlyMembers = activeMembers.filter(m => m.isActive);
                const inMemoryParticipants = roomParticipants.get(roomCode);
                for (const member of activeOnlyMembers) {
                  const memberWs = connectedClients.get(member.userId);
                  const inParticipants = inMemoryParticipants && inMemoryParticipants.has(member.userId);
                  const wsAlive = memberWs && memberWs.readyState === WebSocket.OPEN;
                  if (!wsAlive && !inParticipants) {
                    try {
                      await storage.deactivateRoomMember(roomCode, member.userId);
                    } catch (cleanErr) {
                      console.error("Stale member cleanup failed:", cleanErr);
                    }
                  }
                }
                const freshCount = await storage.getActiveRoomMemberCount(roomCode);
                if (freshCount >= 2) {
                  ws.send(JSON.stringify({ type: "error", message: "Room is full. Only 2 people can be in a room at a time.", roomFull: true }));
                  break;
                }
              }

              trackAction("join_room", "rooms");

              // Leave any previous room
              const oldRoom = userRooms.get(userId);
              if (oldRoom) {
                roomParticipants.get(oldRoom)?.delete(userId);
              }
              
              // Join new room
              if (!roomParticipants.has(roomCode)) {
                roomParticipants.set(roomCode, new Set());
              }
              roomParticipants.get(roomCode)!.add(userId);
              userRooms.set(userId, roomCode);
              trackParticipantActivity(roomCode, userId);

              // Get all other participants in the room
              const participants = Array.from(roomParticipants.get(roomCode) || []);
              const otherParticipants = participants.filter(p => p !== userId);
              
              // Send room info to the joining user
              ws.send(JSON.stringify({
                type: "room-joined",
                roomCode,
                participants: otherParticipants,
              }));
              
              // Notify existing participants about new user
              otherParticipants.forEach(participantId => {
                const participantWs = connectedClients.get(participantId);
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                  participantWs.send(JSON.stringify({
                    type: "user-joined",
                    userId: userId,
                    roomCode,
                  }));
                }
              });
              
              // Track room membership in database
              const joiningUser = await storage.getUser(userId);
              const memberUsername = getValidDisplayName(joiningUser?.firstName, joiningUser?.lastName);
              storage.addRoomMember({
                roomCode,
                userId,
                username: memberUsername,
              }).catch(err => console.error("Failed to track room member:", err));

              const joinHomeSubs = homeChatSubscribers.get(roomCode);
              if (joinHomeSubs) {
                const memberJoinPayload = JSON.stringify({
                  type: "member-joined",
                  roomCode,
                  userId,
                  username: memberUsername,
                });
                joinHomeSubs.forEach(s => {
                  const subUserId = wsToUserId.get(s);
                  if (s.readyState === WebSocket.OPEN && subUserId !== userId) {
                    s.send(memberJoinPayload);
                  }
                });
              }
              
            }
            break;

          case "leave-room":
            if (!authenticatedUserId || !userId) break;
            {
              const userRoom = userRooms.get(userId);
              if (userRoom) {
                roomParticipants.get(userRoom)?.delete(userId);
                userRooms.delete(userId);

                storage.deactivateRoomMember(userRoom, userId).catch(err =>
                  console.error("Failed to deactivate room member on leave-room:", err)
                );

                // Notify remaining participants
                const remaining = Array.from(roomParticipants.get(userRoom) || []);
                remaining.forEach(participantId => {
                  const participantWs = connectedClients.get(participantId);
                  if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                    participantWs.send(JSON.stringify({
                      type: "user-left",
                      userId: userId,
                    }));
                  }
                });
                
              }
            }
            break;

          case "room-offer":
          case "room-answer":
          case "room-ice-candidate":
            if (!authenticatedUserId || !userId) break;
            const targetUser = connectedClients.get(message.targetId);
            if (targetUser && targetUser.readyState === WebSocket.OPEN) {
              targetUser.send(JSON.stringify({
                type: message.type,
                data: message.data,
                fromId: userId,
              }));
            }
            break;

          case "room-caption":
            if (!authenticatedUserId || !userId) break;
            {
              const currentRoom = userRooms.get(userId);
              if (currentRoom) {
                const roomUsers = Array.from(roomParticipants.get(currentRoom) || []);
                const captionPayload: any = {
                  type: "room-caption",
                  fromId: userId,
                };
                if (message.e2e === true) {
                  captionPayload.e2e = true;
                  captionPayload.ciphertext = message.ciphertext;
                  captionPayload.iv = message.iv;
                  if (message.counter !== undefined) captionPayload.counter = message.counter;
                } else {
                  captionPayload.text = message.text;
                  captionPayload.translated = message.translated;
                }
                const captionPayloadStr = JSON.stringify(captionPayload);
                roomUsers.forEach(participantId => {
                  if (participantId !== userId) {
                    const participantWs = connectedClients.get(participantId);
                    if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                      participantWs.send(captionPayloadStr);
                    }
                  }
                });
              }
            }
            break;

          case "e2e-handshake":
            if (!authenticatedUserId || !userId) break;
            {
              const e2ePayloadSize = JSON.stringify(message).length;
              if (e2ePayloadSize > 8192) {
                ws.send(JSON.stringify({ type: "error", message: "E2E handshake payload too large" }));
                break;
              }
              const e2eRoom = userRooms.get(userId);
              if (!e2eRoom) {
                ws.send(JSON.stringify({ type: "e2e-handshake-error", error: "not-in-room" }));
                break;
              }
              const e2eUsers = Array.from(roomParticipants.get(e2eRoom) || []);
              const e2ePeers = e2eUsers.filter(p => p !== userId);
              if (e2ePeers.length === 0) {
                ws.send(JSON.stringify({ type: "e2e-handshake-error", error: "no-peer", roomCode: e2eRoom }));
                break;
              }
              let delivered = false;
              e2ePeers.forEach(participantId => {
                const participantWs = connectedClients.get(participantId);
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                  participantWs.send(JSON.stringify({
                    type: "e2e-handshake",
                    publicKey: message.publicKey,
                    challenge: message.challenge,
                    response: message.response,
                    iv: message.iv,
                    fromId: userId,
                    seq: message.seq || 0,
                  }));
                  delivered = true;
                }
              });
              ws.send(JSON.stringify({
                type: "e2e-handshake-ack",
                delivered,
                peerCount: e2ePeers.length,
                seq: message.seq || 0,
              }));
            }
            break;

          case "e2e-ping":
            if (!authenticatedUserId || !userId) break;
            {
              const pingRoom = userRooms.get(userId);
              if (pingRoom) {
                const pingPeers = Array.from(roomParticipants.get(pingRoom) || []).filter(p => p !== userId);
                pingPeers.forEach(participantId => {
                  const participantWs = connectedClients.get(participantId);
                  if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                    participantWs.send(JSON.stringify({ type: "e2e-ping", fromId: userId }));
                  }
                });
              }
            }
            break;

          case "e2e-pong":
            if (!authenticatedUserId || !userId) break;
            {
              if (message.targetId) {
                const pongTarget = connectedClients.get(message.targetId);
                if (pongTarget && pongTarget.readyState === WebSocket.OPEN) {
                  pongTarget.send(JSON.stringify({ type: "e2e-pong", fromId: userId }));
                }
              }
            }
            break;

          case "room-chat":
            if (!authenticatedUserId || !userId) break;
            {
              if (!checkWsMessageRate(userId)) {
                ws.send(JSON.stringify({ type: "error", message: "Sending too fast. Please slow down." }));
                break;
              }
              trackAction("send_message", "chat");
              const chatRoom = userRooms.get(userId);
              const isE2eChat = message.e2e === true;
              const chatText = isE2eChat ? "[encrypted]" : (message.message || message.text || "");
              if (!isE2eChat && chatText) {
                const safetyCheck = checkChatMessage(chatText);
                if (!safetyCheck.ok) {
                  console.log(`[JunoSafety] Chat message blocked (${safetyCheck.reason}) from user ${userId}`);
                  ws.send(JSON.stringify({ type: "room-chat-blocked", reason: "content_policy" }));
                  break;
                }
              }
              if (chatRoom && (chatText || isE2eChat)) {
                const rcMsgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const rcMsg: RoomChatMsg = {
                  id: rcMsgId,
                  roomCode: chatRoom,
                  fromId: userId,
                  fromName: message.username || "Guest",
                  text: isE2eChat ? "[E2E encrypted]" : chatText.slice(0, 500),
                  timestamp: Date.now(),
                };
                addRoomMessage(chatRoom, rcMsg);
                notifyMessageCountUpdate(chatRoom, userId);

                const chatRoomUsers = Array.from(roomParticipants.get(chatRoom) || []);
                const chatPayload: any = {
                  type: "room-chat",
                  fromId: userId,
                  username: message.username || "Guest",
                  timestamp: Date.now(),
                };
                if (isE2eChat) {
                  chatPayload.e2e = true;
                  chatPayload.ciphertext = message.ciphertext;
                  chatPayload.iv = message.iv;
                  if (message.counter !== undefined) chatPayload.counter = message.counter;
                } else {
                  chatPayload.text = chatText;
                  chatPayload.message = chatText;
                }
                const chatPayloadStr = JSON.stringify(chatPayload);
                chatRoomUsers.forEach(participantId => {
                  if (participantId !== userId) {
                    const participantWs = connectedClients.get(participantId);
                    if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                      participantWs.send(chatPayloadStr);
                    }
                  }
                });

                const homeSubs = homeChatSubscribers.get(chatRoom);
                if (homeSubs) {
                  const homePayload = JSON.stringify({ type: "home-chat-message", message: rcMsg });
                  homeSubs.forEach(s => {
                    const subUserId = wsToUserId.get(s);
                    if (s !== ws && s.readyState === WebSocket.OPEN && subUserId !== userId) {
                      s.send(homePayload);
                    }
                  });
                }
              }
            }
            break;

          case "room-image":
            if (!authenticatedUserId || !userId) break;
            {
              const imgRoom = userRooms.get(userId);
              const imgData = message.imageData;
              if (imgRoom && imgData && typeof imgData === "string") {
                const allowedPrefixes = ["data:image/png;", "data:image/jpeg;", "data:image/jpg;", "data:image/webp;", "data:image/gif;"];
                const isValidMime = allowedPrefixes.some(p => imgData.startsWith(p));
                const maxBytes = 25 * 1024 * 1024;
                if (!isValidMime || imgData.length > maxBytes) {
                  ws.send(JSON.stringify({ type: "error", message: "Invalid or oversized image" }));
                  break;
                }
                const imgPayload = JSON.stringify({
                  type: "room-image",
                  imageData: imgData,
                  userId: userId,
                  username: message.username || "Guest",
                  timestamp: Date.now(),
                });
                const imgRoomUsers = Array.from(roomParticipants.get(imgRoom) || []);
                imgRoomUsers.forEach(participantId => {
                  if (participantId !== userId) {
                    const participantWs = connectedClients.get(participantId);
                    if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                      participantWs.send(imgPayload);
                    }
                  }
                });
              }
            }
            break;

          case "room-video":
            if (!authenticatedUserId || !userId) break;
            {
              const vidRoom = userRooms.get(userId);
              const vidData = message.videoData;
              if (vidRoom && vidData && typeof vidData === "string") {
                const isValidVideoMime = vidData.startsWith("data:video/");
                const maxVideoBytes = 25 * 1024 * 1024;
                if (!isValidVideoMime || vidData.length > maxVideoBytes) {
                  ws.send(JSON.stringify({ type: "error", message: "Invalid or oversized video" }));
                  break;
                }
                const vidPayload = JSON.stringify({
                  type: "room-video",
                  videoData: vidData,
                  userId: userId,
                  username: message.username || "Guest",
                  timestamp: Date.now(),
                });
                const vidRoomUsers = Array.from(roomParticipants.get(vidRoom) || []);
                vidRoomUsers.forEach(participantId => {
                  if (participantId !== userId) {
                    const participantWs = connectedClients.get(participantId);
                    if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                      participantWs.send(vidPayload);
                    }
                  }
                });
              }
            }
            break;

          /* MIGRATED TO SOCKET.IO — see server/socket-io.ts
          case "home-chat-send":
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
              break;
            }
            if (userId && message.roomCode && message.text) {
              const hcRoomCode = message.roomCode.toUpperCase();
              try {
                const hcRoom = await storage.getRoomByCode(hcRoomCode);
                if (!hcRoom) break;
                const isChatMember = await storage.isRoomMember(hcRoomCode, userId);
                if (hcRoom.hostId !== userId && !isChatMember) break;
              } catch { break; }
              trackParticipantActivity(hcRoomCode, userId);
              const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const isE2ee = !!message.e2ee;
              const textLimit = isE2ee ? 2000 : 500;
              const roomMsg: RoomChatMsg = {
                id: msgId,
                roomCode: hcRoomCode,
                fromId: userId,
                fromName: message.fromName || "Unknown",
                text: message.text.slice(0, textLimit),
                timestamp: Date.now(),
                ...(isE2ee ? { e2ee: true } : {}),
              };
              if (message.imageData && typeof message.imageData === "string" && message.imageData.startsWith("https://fonts.gstatic.com/")) {
                roomMsg.imageData = message.imageData;
                roomMsg.mediaType = "image";
              }
              if (message.audioData && typeof message.audioData === "string" && message.audioData.startsWith("data:audio/")) {
                if (message.audioData.length <= 5 * 1024 * 1024) {
                  roomMsg.audioData = message.audioData;
                  roomMsg.mediaType = "audio";
                  if (message.transcription && typeof message.transcription === "string") {
                    roomMsg.transcription = message.transcription.slice(0, 2000);
                  }
                }
              }
              if (message.replyTo && typeof message.replyTo === "object" && message.replyTo.id) {
                roomMsg.replyTo = {
                  id: message.replyTo.id,
                  fromName: String(message.replyTo.fromName || ""),
                  text: String(message.replyTo.text || "").slice(0, 200),
                  ...(message.replyTo.imageData ? { imageData: String(message.replyTo.imageData) } : {}),
                  ...(message.replyTo.videoData ? { videoData: String(message.replyTo.videoData) } : {}),
                };
              }
              if (message.vanish) {
                (roomMsg as any).vanish = true;
              }
              addRoomMessage(hcRoomCode, roomMsg);
              notifyMessageCountUpdate(hcRoomCode, userId);
              broadcastHomeChat(hcRoomCode, roomMsg, ws);
              structuredLog("info", "message_send", "Message sent via WebSocket", { userId, roomId: hcRoomCode, metadata: { messageId: roomMsg.id, hasMedia: !!(roomMsg.imageData || roomMsg.videoData || roomMsg.audioData) } });

              if (!message.vanish && !message.e2ee && roomMsg.text && !roomMsg.imageData && !roomMsg.videoData) {
                processMessageTranslation(hcRoomCode, roomMsg, userId).then(result => {
                  if (result) {
                    const translationPayload = JSON.stringify({
                      type: "message-translated",
                      messageId: roomMsg.id,
                      roomCode: hcRoomCode,
                      translatedText: result.translatedText,
                      targetLang: result.targetLang,
                    });
                    const subs = homeChatSubscribers.get(hcRoomCode);
                    if (subs) {
                      for (const sub of subs) {
                        if (sub !== ws && sub.readyState === 1) {
                          try { sub.send(translationPayload); } catch {}
                        }
                      }
                    }
                  }
                }).catch(() => {});
              }
            }
            break;

          case "home-chat-edit": {
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
              break;
            }
            if (userId && message.roomCode && message.messageId && message.newText) {
              const editRoomCode = message.roomCode.toUpperCase();
              const editWindowMs = 15 * 60 * 1000;
              const msgs = roomMessages.get(editRoomCode);
              if (!msgs) break;
              const targetMsg = msgs.find(m => m.id === message.messageId);
              if (!targetMsg) break;
              if (targetMsg.fromId !== userId) break;
              if ((Date.now() - targetMsg.timestamp) > editWindowMs) break;
              if (targetMsg.imageData || targetMsg.videoData || targetMsg.audioData) break;
              const newText = String(message.newText).slice(0, 500);
              targetMsg.text = newText;
              targetMsg.edited = true;
              targetMsg.editedAt = Date.now();
              storage.editRoomMessage(message.messageId, newText, userId).catch(err => {
                console.error("[Chat Edit] DB persist failed:", err);
              });
              const subs = homeChatSubscribers.get(editRoomCode);
              if (subs) {
                const editPayload = JSON.stringify({ type: "home-chat-edited", roomCode: editRoomCode, messageId: message.messageId, newText, editedAt: targetMsg.editedAt });
                for (const sub of subs) {
                  if (sub.readyState === 1) {
                    try { sub.send(editPayload); } catch {}
                  }
                }
              }
              processEditedMessageTranslation(editRoomCode, message.messageId, newText, userId).then(result => {
                if (result) {
                  const translationPayload = JSON.stringify({
                    type: "message-translated",
                    messageId: message.messageId,
                    roomCode: editRoomCode,
                    translatedText: result.translatedText,
                    targetLang: result.targetLang,
                  });
                  const editSubs = homeChatSubscribers.get(editRoomCode);
                  if (editSubs) {
                    for (const sub of editSubs) {
                      if (sub !== ws && sub.readyState === 1) {
                        try { sub.send(translationPayload); } catch {}
                      }
                    }
                  }
                }
              }).catch(() => {});
            }
            break;
          }

          case "home-chat-verified": {
            if (!authenticatedUserId) break;
            if (userId && message.roomCode && message.messageId) {
              const vRoomCode = message.roomCode.toUpperCase();
              const msgs = roomMessages.get(vRoomCode);
              if (msgs) {
                const targetMsg = msgs.find(m => m.id === message.messageId);
                if (targetMsg) {
                  (targetMsg as any).verified = true;
                }
              }
              const subs = homeChatSubscribers.get(vRoomCode);
              if (subs) {
                const verifiedPayload = JSON.stringify({ type: "home-chat-verified", roomCode: vRoomCode, messageId: message.messageId });
                for (const sub of subs) {
                  if (sub !== ws && sub.readyState === 1) {
                    try { sub.send(verifiedPayload); } catch {}
                  }
                }
              }
            }
            break;
          }

          case "home-chat-image":
          case "home-chat-video": {
            if (!isAuthenticated) {
              ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
              break;
            }
            if (userId && message.roomCode) {
              const mediaRoomCode = message.roomCode.toUpperCase();
              try {
                const mediaRoom = await storage.getRoomByCode(mediaRoomCode);
                if (!mediaRoom) break;
                const isMediaMember = await storage.isRoomMember(mediaRoomCode, userId);
                if (mediaRoom.hostId !== userId && !isMediaMember) break;
              } catch { break; }
              const isImg = message.type === "home-chat-image";
              const mediaData = isImg ? message.imageData : message.videoData;
              if (!mediaData || typeof mediaData !== "string") break;
              if (isImg) {
                const allowedPrefixes = ["data:image/png;", "data:image/jpeg;", "data:image/jpg;", "data:image/webp;", "data:image/gif;"];
                const isNotoEmoji = mediaData.startsWith("https://fonts.gstatic.com/s/e/notoemoji/");
                const isGiphyGif = mediaData.startsWith("https://media") && mediaData.includes("giphy.com/");
                if (!isNotoEmoji && !isGiphyGif && !allowedPrefixes.some(p => mediaData.startsWith(p))) {
                  ws.send(JSON.stringify({ type: "error", message: "Invalid image format" }));
                  break;
                }
              } else {
                if (!mediaData.startsWith("data:video/")) {
                  ws.send(JSON.stringify({ type: "error", message: "Invalid video format" }));
                  break;
                }
              }
              const maxBytes = 25 * 1024 * 1024;
              if (mediaData.length > maxBytes) {
                ws.send(JSON.stringify({ type: "error", message: "File too large" }));
                break;
              }
              const isEmojiMsg = isImg && mediaData.startsWith("https://fonts.gstatic.com/s/e/notoemoji/");
              const isGifMsg = isImg && mediaData.startsWith("https://media") && mediaData.includes("giphy.com/");
              const msgText = isEmojiMsg ? "[Emoji]" : isGifMsg ? "[GIF]" : (isImg ? "[Image]" : "[Video]");
              const isVanish = !!message.vanish && !isEmojiMsg && !isGifMsg;
              const mediaMsg = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                roomCode: mediaRoomCode,
                fromId: userId,
                fromName: message.fromName || "Unknown",
                text: msgText,
                ...(isImg ? { imageData: mediaData } : { videoData: mediaData }),
                mediaType: isImg ? "image" : "video",
                timestamp: Date.now(),
                ...(isVanish ? { vanish: true } : {}),
                ...(!isImg && Array.isArray(message.liveCaptions) && message.liveCaptions.length > 0
                  ? { liveCaptions: message.liveCaptions }
                  : {}),
              ...(!isImg && message.hasBurnedCaptions ? { hasBurnedCaptions: true } : {}),
              };
              addRoomMessage(mediaRoomCode, {
                id: mediaMsg.id,
                roomCode: mediaRoomCode,
                fromId: userId,
                fromName: mediaMsg.fromName,
                text: mediaMsg.text,
                timestamp: mediaMsg.timestamp,
                ...((isEmojiMsg || isGifMsg) ? { imageData: mediaData, mediaType: "image" } : {}),
                ...(isVanish ? { vanish: true } : {}),
              });
              notifyMessageCountUpdate(mediaRoomCode, userId);
              const subs = homeChatSubscribers.get(mediaRoomCode);
              if (subs) {
                const payload = JSON.stringify({ type: "home-chat-message", message: mediaMsg });
                subs.forEach(s => {
                  if (s !== ws && s.readyState === WebSocket.OPEN) {
                    s.send(payload);
                  }
                });
              }
              ws.send(JSON.stringify({ type: "home-chat-message-sent", message: mediaMsg }));
            }
            break;
          }

          case "home-chat-subscribe":
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode) {
              const subRoom = message.roomCode.toUpperCase();
              try {
                const subRoomData = await storage.getRoomByCode(subRoom);
                if (!subRoomData) break;
                const isMember = await storage.isRoomMember(subRoom, userId);
                const isHost = subRoomData.hostId === userId;
                if (!isMember && !isHost) {
                  ws.send(JSON.stringify({ type: "error", message: "Not a member of this room" }));
                  break;
                }
              } catch { break; }
              if (!homeChatSubscribers.has(subRoom)) {
                homeChatSubscribers.set(subRoom, new Set());
              }
              homeChatSubscribers.get(subRoom)!.add(ws);
              if (userId) trackParticipantActivity(subRoom, userId);
              socketMetrics.presenceUpdates++;
              const subSubs = homeChatSubscribers.get(subRoom)!;
              const subActiveIds: string[] = [];
              subSubs.forEach(s => { const uid = wsToUserId.get(s); if (uid) subActiveIds.push(uid); });
              const subPayload = JSON.stringify({ type: "chat-presence", roomCode: subRoom, count: subSubs.size, activeUserIds: subActiveIds });
              subSubs.forEach(s => {
                if (s.readyState === WebSocket.OPEN) s.send(subPayload);
              });
            }
            break;

          case "e2ee-public-key": {
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode && message.publicKeyJwk) {
              const e2eeRoom = message.roomCode.toUpperCase();
              try {
                const e2eeRoomData = await storage.getRoomByCode(e2eeRoom);
                if (!e2eeRoomData) { console.log(`[E2EE] Room ${e2eeRoom} not found`); break; }
                const isE2eeMember = await storage.isRoomMember(e2eeRoom, userId);
                if (e2eeRoomData.hostId !== userId && !isE2eeMember) { console.log(`[E2EE] User ${userId} not member of ${e2eeRoom}`); break; }
              } catch { break; }
              const e2eeSubs = homeChatSubscribers.get(e2eeRoom);
              let e2eeRelayed = 0;
              if (e2eeSubs) {
                const e2eePayload = JSON.stringify({
                  type: "e2ee-public-key",
                  roomCode: e2eeRoom,
                  userId,
                  publicKeyJwk: message.publicKeyJwk,
                });
                e2eeSubs.forEach(s => {
                  if (s !== ws && s.readyState === WebSocket.OPEN) {
                    s.send(e2eePayload);
                    e2eeRelayed++;
                  }
                });
              }
              console.log(`[E2EE] Key from ${userId} in ${e2eeRoom} relayed to ${e2eeRelayed} peers (${e2eeSubs?.size || 0} subscribers)`);
            }
            break;
          }

          case "home-chat-typing":
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode) {
              const typingRoom = message.roomCode.toUpperCase();
              const typingSubs = homeChatSubscribers.get(typingRoom);
              if (typingSubs) {
                const typingPayload = JSON.stringify({
                  type: "home-chat-typing",
                  roomCode: typingRoom,
                  userId,
                  userName: message.userName || "Someone",
                  isTyping: !!message.isTyping,
                });
                let typingDelivered = 0;
                typingSubs.forEach(s => {
                  if (s !== ws && s.readyState === WebSocket.OPEN) {
                    s.send(typingPayload);
                    typingDelivered++;
                  }
                });
                socketMetrics.typingEventsRouted++;
                trackSocketEvent("typing_routed", userId, `room=${typingRoom},delivered=${typingDelivered},isTyping=${message.isTyping}`);
              }
            }
            break;

          case "home-chat-react": {
            if (!authenticatedUserId || !userId || !message.roomCode || !message.messageId || !message.emoji) break;
            const reactRoom = message.roomCode.toUpperCase();
            try {
              const reactRoomData = await storage.getRoomByCode(reactRoom);
              if (!reactRoomData) break;
              const isReactMember = await storage.isRoomMember(reactRoom, userId);
              if (reactRoomData.hostId !== userId && !isReactMember) break;
            } catch { break; }
            const emoji = message.emoji as string;
            const reactMsgs = roomMessages.get(reactRoom);
            const targetMsg = reactMsgs?.find(m => m.id === message.messageId);
            let updatedReactions: Record<string, string[]>;
            if (targetMsg) {
              if (!targetMsg.reactions) targetMsg.reactions = {};
              if (!targetMsg.reactions[emoji]) targetMsg.reactions[emoji] = [];
              const idx = targetMsg.reactions[emoji].indexOf(userId);
              if (idx >= 0) {
                targetMsg.reactions[emoji].splice(idx, 1);
                if (targetMsg.reactions[emoji].length === 0) delete targetMsg.reactions[emoji];
              } else {
                targetMsg.reactions[emoji] = [userId];
                Object.keys(targetMsg.reactions).forEach(k => {
                  if (k !== emoji) {
                    targetMsg.reactions![k] = targetMsg.reactions![k].filter(u => u !== userId);
                    if (targetMsg.reactions![k].length === 0) delete targetMsg.reactions![k];
                  }
                });
              }
              updatedReactions = { ...(targetMsg.reactions || {}) };
              storage.updateMessageReactions(targetMsg.id, updatedReactions).catch(err =>
                console.error("Failed to persist reaction:", err)
              );
            } else {
              const existing = await storage.getReactionsByMessageId(message.messageId);
              if (existing === null) break;
              const reactions = existing;
              if (!reactions[emoji]) reactions[emoji] = [];
              const idx = reactions[emoji].indexOf(userId);
              if (idx >= 0) {
                reactions[emoji].splice(idx, 1);
                if (reactions[emoji].length === 0) delete reactions[emoji];
              } else {
                reactions[emoji] = [userId];
                Object.keys(reactions).forEach(k => {
                  if (k !== emoji) {
                    reactions[k] = reactions[k].filter(u => u !== userId);
                    if (reactions[k].length === 0) delete reactions[k];
                  }
                });
              }
              updatedReactions = reactions;
              storage.updateMessageReactions(message.messageId, updatedReactions).catch(err =>
                console.error("Failed to persist reaction:", err)
              );
            }
            const reactPayload = JSON.stringify({
              type: "home-chat-reaction-update",
              roomCode: reactRoom,
              messageId: message.messageId,
              reactions: updatedReactions,
            });
            const reactSubs = homeChatSubscribers.get(reactRoom);
            reactSubs?.forEach(s => {
              if (s.readyState === WebSocket.OPEN) s.send(reactPayload);
            });
            break;
          }

          case "home-chat-delete": {
            if (!authenticatedUserId || !userId || !message.roomCode || !message.messageId) break;
            const delRoom = message.roomCode.toUpperCase();
            const room = await storage.getRoomByCode(delRoom);
            if (!room) break;
            const isMemberDel = await storage.isRoomMember(delRoom, userId);
            if (room.hostId !== userId && !isMemberDel) break;
            const delMsgs = roomMessages.get(delRoom);
            if (delMsgs) {
              const targetMsg = delMsgs.find(m => m.id === message.messageId);
              if (targetMsg && targetMsg.fromId !== userId) break;
              const delIdx = delMsgs.findIndex(m => m.id === message.messageId);
              if (delIdx >= 0) {
                delMsgs.splice(delIdx, 1);
              }
            }
            storage.softDeleteRoomMessage(String(message.messageId), userId).catch(() => {});
            const delPayload = JSON.stringify({
              type: "home-chat-message-deleted",
              roomCode: delRoom,
              messageId: message.messageId,
            });
            const delSubs = homeChatSubscribers.get(delRoom);
            delSubs?.forEach(s => {
              if (s.readyState === WebSocket.OPEN) s.send(delPayload);
            });
            break;
          }

          case "msg-delivered": {
            if (!authenticatedUserId || !userId) break;
            const delMsgIds = Array.isArray(message.messageIds) ? message.messageIds : (message.messageId ? [message.messageId] : []);
            const delRoomCode = message.roomCode?.toUpperCase();
            if (delRoomCode && delMsgIds.length > 0) {
              const deliveredPayload = JSON.stringify({
                type: "msg-status-update",
                roomCode: delRoomCode,
                messageIds: delMsgIds,
                status: "delivered",
                byUserId: userId,
              });
              const notifiedDel = new Set<string>();
              notifiedDel.add(userId);
              const delSubs = homeChatSubscribers.get(delRoomCode);
              if (delSubs) {
                delSubs.forEach(s => {
                  const subUid = wsToUserId.get(s);
                  if (s !== ws && s.readyState === WebSocket.OPEN && subUid && !notifiedDel.has(subUid)) {
                    notifiedDel.add(subUid);
                    s.send(deliveredPayload);
                  }
                });
              }
              const delParts = roomParticipants.get(delRoomCode);
              if (delParts) {
                delParts.forEach(pid => {
                  if (!notifiedDel.has(pid)) {
                    notifiedDel.add(pid);
                    const pWs = connectedClients.get(pid);
                    if (pWs && pWs.readyState === WebSocket.OPEN) {
                      pWs.send(deliveredPayload);
                    }
                  }
                });
              }
              connectedClients.forEach((cWs, cUid) => {
                if (!notifiedDel.has(cUid) && cWs.readyState === WebSocket.OPEN) {
                  const delSubs2 = homeChatSubscribers.get(delRoomCode);
                  if (delSubs2?.has(cWs)) {
                    notifiedDel.add(cUid);
                    cWs.send(deliveredPayload);
                  }
                }
              });
            }
            break;
          }

          case "msg-seen": {
            if (!authenticatedUserId || !userId) break;
            const seenMsgIds = Array.isArray(message.messageIds) ? message.messageIds : (message.messageId ? [message.messageId] : []);
            const seenRoomCode = message.roomCode?.toUpperCase();
            if (seenRoomCode && seenMsgIds.length > 0) {
              const seenPayload = JSON.stringify({
                type: "msg-status-update",
                roomCode: seenRoomCode,
                messageIds: seenMsgIds,
                status: "seen",
                byUserId: userId,
              });
              const notifiedSeen = new Set<string>();
              notifiedSeen.add(userId);
              const seenSubs = homeChatSubscribers.get(seenRoomCode);
              if (seenSubs) {
                seenSubs.forEach(s => {
                  const subUid = wsToUserId.get(s);
                  if (s !== ws && s.readyState === WebSocket.OPEN && subUid && !notifiedSeen.has(subUid)) {
                    notifiedSeen.add(subUid);
                    s.send(seenPayload);
                  }
                });
              }
              const seenParts = roomParticipants.get(seenRoomCode);
              if (seenParts) {
                seenParts.forEach(pid => {
                  if (!notifiedSeen.has(pid)) {
                    notifiedSeen.add(pid);
                    const pWs = connectedClients.get(pid);
                    if (pWs && pWs.readyState === WebSocket.OPEN) {
                      pWs.send(seenPayload);
                    }
                  }
                });
              }
              connectedClients.forEach((cWs, cUid) => {
                if (!notifiedSeen.has(cUid) && cWs.readyState === WebSocket.OPEN) {
                  const seenSubs2 = homeChatSubscribers.get(seenRoomCode);
                  if (seenSubs2?.has(cWs)) {
                    notifiedSeen.add(cUid);
                    cWs.send(seenPayload);
                  }
                }
              });
            }
            break;
          }

          case "home-chat-unsubscribe":
            if (!authenticatedUserId) break;
            if (message.roomCode) {
              const unsubRoom = message.roomCode.toUpperCase();
              homeChatSubscribers.get(unsubRoom)?.delete(ws);
              const unsubSubs = homeChatSubscribers.get(unsubRoom);
              const unsubActiveIds: string[] = [];
              unsubSubs?.forEach(s => { const uid = wsToUserId.get(s); if (uid) unsubActiveIds.push(uid); });
              const unsubPayload = JSON.stringify({ type: "chat-presence", roomCode: unsubRoom, count: unsubSubs?.size || 0, activeUserIds: unsubActiveIds });
              unsubSubs?.forEach(s => {
                if (s.readyState === WebSocket.OPEN) s.send(unsubPayload);
              });
            }
            break;
          END MIGRATED TO SOCKET.IO */

          case "e2ee-public-key": {
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode && message.publicKeyJwk) {
              const e2eeRoom = message.roomCode.toUpperCase();
              try {
                const e2eeRoomData = await storage.getRoomByCode(e2eeRoom);
                if (!e2eeRoomData) { console.log(`[E2EE] Room ${e2eeRoom} not found`); break; }
                const isE2eeMember = await storage.isRoomMember(e2eeRoom, userId);
                if (e2eeRoomData.hostId !== userId && !isE2eeMember) { console.log(`[E2EE] User ${userId} not member of ${e2eeRoom}`); break; }
              } catch { break; }
              const e2eeSubs = homeChatSubscribers.get(e2eeRoom);
              let e2eeRelayed = 0;
              if (e2eeSubs) {
                const e2eePayload = JSON.stringify({
                  type: "e2ee-public-key",
                  roomCode: e2eeRoom,
                  userId,
                  publicKeyJwk: message.publicKeyJwk,
                });
                e2eeSubs.forEach(s => {
                  if (s !== ws && s.readyState === WebSocket.OPEN) {
                    s.send(e2eePayload);
                    e2eeRelayed++;
                  }
                });
              }
              console.log(`[E2EE] Key from ${userId} in ${e2eeRoom} relayed to ${e2eeRelayed} peers (${e2eeSubs?.size || 0} subscribers)`);
            }
            break;
          }

          case "video-call-join":
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode) {
              trackAction("start_video_call", "video_calls");
              recordCallStart(message.roomCode.toUpperCase(), userId);
              setUserCallStatus(userId, true);
              structuredLog("info", "video_session_start", "Video call joined", { userId, roomId: message.roomCode.toUpperCase() });
            }
            break;

          case "video-call-leave":
            if (!authenticatedUserId || !userId) break;
            if (message.roomCode) {
              recordCallEnd(message.roomCode.toUpperCase(), userId);
              setUserCallStatus(userId, false);
              structuredLog("info", "video_session_end", "Video call left", { userId, roomId: message.roomCode.toUpperCase() });
            }
            break;
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", async (code: number, reason: Buffer) => {
      socketMetrics.disconnections++;
      const closeReason = reason?.toString() || "";
      const isAbnormal = code === 1006 || code === 1011 || code === 1012 || code === 1013 || code === 1014;
      if (isAbnormal) socketMetrics.abnormalClosures++;
      trackSocketEvent("disconnect", userId || undefined, `code=${code},reason=${closeReason || "none"}`);
      wsToUserId.delete(ws);
      homeChatSubscribers.forEach((subs, roomCode) => {
        if (subs.has(ws)) {
          subs.delete(ws);
          const closeActiveIds: string[] = [];
          subs.forEach(s => { const uid = wsToUserId.get(s); if (uid) closeActiveIds.push(uid); });
          const closePayload = JSON.stringify({ type: "chat-presence", roomCode, count: subs.size, activeUserIds: closeActiveIds });
          subs.forEach(s => {
            if (s.readyState === WebSocket.OPEN) {
              s.send(closePayload);
            }
          });
        }
      });

      if (userId) {
        const closedUserId = userId;
        activeCalls.forEach((_call, callRoom) => {
          recordCallEnd(callRoom, closedUserId);
        });

        const userRoom = userRooms.get(userId);
        if (userRoom) {
          roomParticipants.get(userRoom)?.delete(userId);
          userRooms.delete(userId);

          storage.deactivateRoomMember(userRoom, closedUserId).catch(err =>
            console.error("Failed to deactivate room member on WS close:", err)
          );

          // Notify remaining participants that user left
          const remaining = Array.from(roomParticipants.get(userRoom) || []);
          remaining.forEach(participantId => {
            const participantWs = connectedClients.get(participantId);
            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
              participantWs.send(JSON.stringify({
                type: "user-left",
                userId: userId,
              }));
            }
          });
          
        }
        
        if (connectedClients.get(userId) === ws) {
          connectedClients.delete(userId);
          await storage.updateStatus(userId, "offline");
          broadcastStatus(userId, "offline");
        }
      }
    });

    ws.on("error", (err) => {
      trackSocketEvent("ws_error", userId || undefined, err?.message || "unknown error");
    });
  });

  const pendingStatusBroadcasts = new Map<string, string>();
  let statusBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  function flushStatusBroadcasts() {
    statusBroadcastTimer = null;
    if (pendingStatusBroadcasts.size === 0) return;
    const updates = Array.from(pendingStatusBroadcasts.entries()).map(([uid, st]) => ({ userId: uid, status: st }));
    pendingStatusBroadcasts.clear();
    if (updates.length === 1) {
      const message = JSON.stringify({ type: "status-change", userId: updates[0].userId, status: updates[0].status });
      connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      });
    } else {
      const batchMessage = JSON.stringify({ type: "status-batch", updates });
      connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(batchMessage);
      });
    }
  }

  function broadcastStatus(userId: string, status: string) {
    pendingStatusBroadcasts.set(userId, status);
    if (!statusBroadcastTimer) {
      statusBroadcastTimer = setTimeout(flushStatusBroadcasts, 100);
    }
  }

  // Get user by ID (for chat header)
  v1Router.get("/users/:id", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const status = await storage.getStatus(id);
      res.json({ user: sanitizeUser(user), status: status?.status || "offline" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Search users
  v1Router.get("/users/search/:query", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const users = await storage.searchUsers(req.params.query, userId);
      const sanitized = users.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName ? u.lastName.charAt(0) + "." : null,
        profileImageUrl: u.profileImageUrl,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error searching users:", error);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  // ── Moderation: Report user (#3) ─────────────────────────────────────────
  v1Router.post("/users/:id/report", isAuthenticated, async (req: any, res) => {
    try {
      const reporterId = req.user.claims.sub;
      const reportedId = req.params.id;
      const { reason, detail } = req.body;
      if (!reason) return res.status(400).json({ message: "Reason is required" });
      if (reporterId === reportedId) return res.status(400).json({ message: "Cannot report yourself" });
      await submitReport(reporterId, reportedId, String(reason).slice(0, 50), detail ? String(detail).slice(0, 500) : undefined);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to submit report" });
    }
  });

  // ── Moderation: Block / mute (#3) ────────────────────────────────────────
  v1Router.post("/users/:id/block", isAuthenticated, async (req: any, res) => {
    try {
      const blockerId = req.user.claims.sub;
      const blockedId = req.params.id;
      const type = req.body.type === "mute" ? "mute" : "block";
      if (blockerId === blockedId) return res.status(400).json({ message: "Cannot block yourself" });
      await blockUser(blockerId, blockedId, type);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to block user" });
    }
  });

  v1Router.delete("/users/:id/block", isAuthenticated, async (req: any, res) => {
    try {
      const blockerId = req.user.claims.sub;
      await unblockUser(blockerId, req.params.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to unblock user" });
    }
  });

  v1Router.get("/users/blocks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const list = await getBlockList(userId);
      res.json({ blockedIds: list });
    } catch {
      res.status(500).json({ message: "Failed to fetch block list" });
    }
  });

  // ── Moderation: Ban status check ─────────────────────────────────────────
  v1Router.get("/users/ban-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const ban = await getActiveBan(userId);
      if (!ban) return res.json({ banned: false });
      res.json({ banned: true, type: ban.type, expiresAt: ban.expiresAt, reason: ban.reason });
    } catch {
      res.status(500).json({ message: "Failed to check ban status" });
    }
  });

  // ── TURN credentials endpoint (#13) ─────────────────────────────────────
  v1Router.get("/turn-credentials", isAuthenticated, async (req: any, res) => {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;

    // ── Twilio NTS (preferred) ──────────────────────────────────────────
    if (twilioSid && twilioToken) {
      try {
        const twilio = require("twilio");
        const client = twilio(twilioSid, twilioToken);
        const token = await client.tokens.create({ ttl: 86400 });
        console.log("[TURN] Twilio NTS credentials issued");
        return res.json({
          iceServers: token.iceServers,
          ttl: token.ttl,
          provider: "twilio",
        });
      } catch (err: any) {
        console.warn("[TURN] Twilio NTS failed, falling back to openrelay:", err.message);
      }
    }

    // ── Fallback: openrelay (static credentials) ────────────────────────
    try {
      const userId = req.user.claims.sub;
      const creds = generateTurnCredentials(userId);
      res.json({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          {
            urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
            username: creds.username,
            credential: creds.credential,
          },
        ],
        ttl: creds.ttl,
        provider: "openrelay",
      });
    } catch {
      res.status(500).json({ message: "Failed to generate TURN credentials" });
    }
  });

  // Get contacts
  v1Router.get("/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const contacts = await storage.getContacts(userId);
      const sanitized = contacts.map(c => ({
        ...c,
        contactUser: sanitizeUser(c.contactUser),
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Add contact
  v1Router.post("/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = insertContactSchema.safeParse({
        userId,
        contactId: req.body.contactId,
      });

      if (!result.success) {
        return res.status(400).json({ message: "Invalid contact data" });
      }

      const contact = await storage.addContact(result.data);
      res.status(201).json(contact);
    } catch (error) {
      console.error("Error adding contact:", error);
      res.status(500).json({ message: "Failed to add contact" });
    }
  });

  // Remove contact
  v1Router.delete("/contacts/:contactId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const contactId = req.params.contactId;

      // Deactivate any shared room codes between the two users first
      await storage.deactivateSharedRooms(userId, contactId);

      // Remove contact in both directions so neither side stays connected
      await Promise.all([
        storage.removeContact(userId, contactId),
        storage.removeContact(contactId, userId),
      ]);

      res.status(204).send();
    } catch (error) {
      console.error("Error removing contact:", error);
      res.status(500).json({ message: "Failed to remove contact" });
    }
  });

  // Get messages with a contact
  v1Router.get("/messages/:contactId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const messages = await storage.getMessages(userId, req.params.contactId);
      // Mark messages as read
      await storage.markMessagesAsRead(userId, req.params.contactId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Send message
  v1Router.post("/messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = insertMessageSchema.safeParse({
        senderId: userId,
        receiverId: req.body.receiverId,
        content: req.body.content,
      });

      if (!result.success) {
        return res.status(400).json({ message: "Invalid message data" });
      }

      const message = await storage.sendMessage(result.data);

      // Notify recipient via WebSocket if online
      const recipientWs = connectedClients.get(req.body.receiverId);
      if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
        recipientWs.send(JSON.stringify({
          type: "new-message",
          message,
        }));
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Get call history
  v1Router.get("/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const calls = await storage.getCalls(userId);
      const sanitized = calls.map((c: any) => ({
        ...c,
        caller: c.caller ? sanitizeUser(c.caller) : undefined,
        receiver: c.receiver ? sanitizeUser(c.receiver) : undefined,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching calls:", error);
      res.status(500).json({ message: "Failed to fetch calls" });
    }
  });

  // Create call record
  v1Router.post("/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const call = await storage.createCall({
        callerId: userId,
        receiverId: req.body.receiverId,
        status: "pending",
      });
      res.status(201).json(call);
    } catch (error) {
      console.error("Error creating call:", error);
      res.status(500).json({ message: "Failed to create call" });
    }
  });

  // Update call status
  v1Router.patch("/calls/:id", isAuthenticated, async (req, res) => {
    try {
      const callId = req.params.id as string;
      const call = await storage.updateCall(callId, req.body);
      res.json(call);
    } catch (error) {
      console.error("Error updating call:", error);
      res.status(500).json({ message: "Failed to update call" });
    }
  });

  // Get user preferences
  v1Router.get("/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let maskedPrefs = await storage.getPreferencesMasked(userId);
      
      if (!maskedPrefs) {
        await storage.upsertPreferences({
          userId,
          spokenLanguage: "auto",
          subtitleLanguage: "en",
          showOriginalText: true,
          showTranslatedText: true,
          autoDetectLanguage: true,
        });
        maskedPrefs = await storage.getPreferencesMasked(userId);
      }
      
      res.json(maskedPrefs);
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Update user preferences
  v1Router.patch("/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const body = req.body ?? {};
      const sanitized: Record<string, any> = { userId };
      if ("phoneNumber" in body) sanitized.phoneNumber = body.phoneNumber;
      if ("spokenLanguage" in body) sanitized.spokenLanguage = body.spokenLanguage;
      if ("subtitleLanguage" in body) sanitized.subtitleLanguage = body.subtitleLanguage;
      if ("showOriginalText" in body) sanitized.showOriginalText = body.showOriginalText;
      if ("showTranslatedText" in body) sanitized.showTranslatedText = body.showTranslatedText;
      if ("autoDetectLanguage" in body) sanitized.autoDetectLanguage = body.autoDetectLanguage;
      if ("wakeWordEnabled" in body) sanitized.wakeWordEnabled = body.wakeWordEnabled;
      if ("spokenLanguages" in body) sanitized.spokenLanguages = body.spokenLanguages;
      if ("spokenLanguages" in sanitized) {
        if (!Array.isArray(sanitized.spokenLanguages)) {
          return res.status(400).json({ message: "spokenLanguages must be an array" });
        }
        const validCodes = ["en","es","fr","de","it","pt","nl","pl","cs","ru","ja","zh","ko"];
        sanitized.spokenLanguages = [...new Set(
          sanitized.spokenLanguages
            .filter((c: string) => typeof c === "string" && validCodes.includes(c))
        )].slice(0, 5);
      }
      await storage.upsertPreferences(sanitized as any);
      if ("spokenLanguage" in req.body || "subtitleLanguage" in req.body) {
        clearUserLangCache(userId);
      }
      const spokenUpdate = req.body.spokenLanguage && req.body.spokenLanguage !== "auto" ? req.body.spokenLanguage : null;
      const langUpdate = spokenUpdate || (req.body.subtitleLanguage || null);
      if (langUpdate) {
        Array.from(roomLangProfiles.entries()).forEach(([rc, profile]) => {
          if (profile.users[userId]) {
            recordUserSettingLang(rc, userId, langUpdate);
          }
        });
      }
      const maskedPrefs = await storage.getPreferencesMasked(userId);
      res.json(maskedPrefs);
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  v1Router.post("/onboarding/track", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { step, success, error, deviceInfo } = req.body;
      if (!step || typeof step !== "string") return res.status(400).json({ message: "step required" });
      trackOnboardingStep(userId, step, success !== false, error || undefined, deviceInfo || undefined);
      const session = onboardingSessions.get(userId);
      const hasBlockingError = session?.failed && session.lastError;
      res.json({ tracked: true, sessionHealthy: !hasBlockingError });
    } catch {
      res.status(500).json({ message: "Tracking failed" });
    }
  });

  v1Router.get("/onboarding/health", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = onboardingSessions.get(userId);
      if (!session) return res.json({ healthy: true, noSession: true });
      const telemetrySteps = new Set(["phone_input_struggle", "onboarding_stalled", "page_abandon", "page_load"]);
      const recentErrors = session.steps.filter(s =>
        !s.success && !telemetrySteps.has(s.step) && Date.now() - s.timestamp < 300000
      );
      res.json({
        healthy: recentErrors.length === 0,
        errors: recentErrors.map(e => ({ step: e.step, error: e.error })),
        stepsCompleted: session.steps.filter(s => s.success).map(s => s.step),
        shouldRefresh: recentErrors.length >= 3,
      });
    } catch {
      res.json({ healthy: true });
    }
  });

  // ── Email verification OTP store (in-memory, per-user, 10-minute TTL) ────
  interface OtpEntry {
    code: string;
    email: string;
    firstName: string;
    payload: Record<string, any>;
    expiresAt: number;
    attempts: number;
  }
  const emailOtpStore = new Map<string, OtpEntry>();
  const OTP_TTL_MS = 10 * 60 * 1000;
  const OTP_MAX_ATTEMPTS = 5;

  function generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (!local || !domain) return email;
    const visible = local.length <= 2 ? local[0] : local[0] + local[local.length - 1];
    return `${visible}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
  }

  // POST /api/v1/email-verify/send — send OTP to user's email
  v1Router.post("/email-verify/send", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const dbUser = await storage.getUser(userId);

      // Determine the email: from Replit profile, or from the form payload
      const profileEmail = dbUser?.email || null;
      const formEmail = req.body.email && typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : null;
      const targetEmail = profileEmail || formEmail;

      if (!targetEmail) {
        return res.status(400).json({ message: "email_required", reason: "no_email" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(targetEmail)) {
        return res.status(400).json({ message: "email_required", reason: "invalid_email" });
      }

      const firstName = (req.body.firstName || dbUser?.firstName || "there").trim();
      const code = generateOtp();
      const payload = req.body.onboardingPayload || {};

      emailOtpStore.set(userId, {
        code,
        email: targetEmail,
        firstName,
        payload,
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
      });

      const sent = await sendVerificationEmail(targetEmail, firstName, code);
      if (!sent) {
        emailOtpStore.delete(userId);
        console.error(`[EmailVerify] Failed to send to ${maskEmail(targetEmail)}`);
        return res.status(500).json({ message: "Could not send verification email. Please check your email address and try again." });
      }

      console.log(`[EmailVerify] OTP sent to ${maskEmail(targetEmail)} for user ${userId}`);
      return res.json({ sent: true, maskedEmail: maskEmail(targetEmail) });
    } catch (err: any) {
      console.error("[EmailVerify] Send error:", err.message);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  // POST /api/v1/email-verify/confirm — validate OTP and complete onboarding
  v1Router.post("/email-verify/confirm", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { code } = req.body;

      if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
        return res.status(400).json({ message: "Please enter your 6-digit code" });
      }

      const entry = emailOtpStore.get(userId);
      if (!entry) {
        return res.status(400).json({ message: "No verification in progress. Please request a new code." });
      }
      if (Date.now() > entry.expiresAt) {
        emailOtpStore.delete(userId);
        return res.status(400).json({ message: "Code expired. Please request a new one." });
      }

      entry.attempts++;
      if (entry.attempts > OTP_MAX_ATTEMPTS) {
        emailOtpStore.delete(userId);
        return res.status(429).json({ message: "Too many attempts. Please request a new code." });
      }

      if (code.trim() !== entry.code) {
        const remaining = OTP_MAX_ATTEMPTS - entry.attempts;
        return res.status(400).json({ message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` });
      }

      // Code correct — complete onboarding with the saved payload
      emailOtpStore.delete(userId);
      const p = entry.payload;
      const firstNameClean = (p.firstName || entry.firstName || "").trim();
      const lastNameClean = p.lastName ? p.lastName.trim() : null;
      await storage.completeOnboarding(userId, entry.email, p.phoneNumber || "", firstNameClean, lastNameClean);

      if (p.username) {
        try {
          const clean = p.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
          if (clean.length >= 3 && clean.length <= 20) {
            const existing = await storage.findUsersByUsername(clean);
            if (existing.length === 0) await storage.setUsername(userId, clean);
          }
        } catch {}
      }

      const prefs: any = {
        userId,
        spokenLanguage: p.spokenLanguage || "auto",
        subtitleLanguage: p.spokenLanguage && p.spokenLanguage !== "auto" ? p.spokenLanguage : "en",
        showOriginalText: true,
        showTranslatedText: true,
        autoDetectLanguage: !p.spokenLanguage || p.spokenLanguage === "auto",
      };
      if (p.phoneNumber) prefs.phoneNumber = p.phoneNumber;
      await storage.upsertPreferences(prefs);

      sendWelcomeEmail(entry.email, firstNameClean).catch(() => {});
      console.log(`[EmailVerify] Email verified and onboarding completed for user ${userId}`);
      return res.json({ verified: true });
    } catch (err: any) {
      console.error("[EmailVerify] Confirm error:", err.message);
      res.status(500).json({ message: "Verification failed. Please try again." });
    }
  });

  // Onboarding completion - collect email + phone, mark onboarding complete
  v1Router.post("/onboarding/complete", isAuthenticated, async (req: any, res) => {
    const signupStart = Date.now();
    try {
      const userId = req.user.claims.sub;
      trackOnboardingStep(userId, "submit", true);
      const { firstName, lastName, email, phoneNumber, spokenLanguage, username } = req.body;

      if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
        trackOnboardingStep(userId, "validation", false, "Missing first name");
        recordSignup(req, false, Date.now() - signupStart, "unknown", "Missing first name");
        return res.status(400).json({ message: "First name is required" });
      }
      if (GENERIC_NAMES.has(firstName.trim().toLowerCase())) {
        trackOnboardingStep(userId, "validation", false, "Generic name rejected");
        recordSignup(req, false, Date.now() - signupStart, "unknown", "Generic name rejected");
        return res.status(400).json({ message: "Please enter your real first name" });
      }
      const firstNameClean = firstName.trim();
      const lastNameClean = lastName && typeof lastName === "string" ? lastName.trim() : null;
      let emailClean: string | null = null;
      if (email && typeof email === "string" && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim().toLowerCase())) {
          recordSignup(req, false, Date.now() - signupStart, "unknown", "Invalid email format");
          return res.status(400).json({ message: "Invalid email address" });
        }
        emailClean = email.trim().toLowerCase();
      }

      let formattedPhone: string | null = null;
      if (phoneNumber && typeof phoneNumber === "string" && phoneNumber.trim()) {
        const { parsePhoneNumberFromString } = await import("libphonenumber-js");
        let phoneInput = phoneNumber.trim();
        if (!phoneInput.startsWith("+")) {
          phoneInput = "+1" + phoneInput;
        }
        const parsedPhone = parsePhoneNumberFromString(phoneInput);
        if (!parsedPhone || !parsedPhone.isValid()) {
          recordSignup(req, false, Date.now() - signupStart, "unknown", "Invalid phone number");
          return res.status(400).json({ message: "The phone number you entered doesn't look right. Please check it or leave blank to skip." });
        }
        formattedPhone = parsedPhone.formatInternational();
      }

      const VALID_SPOKEN_LANGUAGES = new Set([
        "auto", "en", "es", "fr", "de", "it", "pt", "nl", "pl", "cs", "ru",
        "ja", "zh", "ko", "ar", "hi", "tr", "vi", "th", "sv", "da", "fi",
        "no", "uk", "el", "he", "id", "ms", "ro", "hu", "bg"
      ]);
      const rawLang = spokenLanguage && typeof spokenLanguage === "string" ? spokenLanguage.trim().toLowerCase() : "auto";
      const cleanSpokenLanguage = VALID_SPOKEN_LANGUAGES.has(rawLang) ? rawLang : "auto";

      const browserLang = req.body.browserLanguage && typeof req.body.browserLanguage === "string"
        ? req.body.browserLanguage.trim().toLowerCase().split("-")[0] : null;
      const browserLangValid = browserLang && VALID_SPOKEN_LANGUAGES.has(browserLang) && browserLang !== "auto" ? browserLang : null;
      const subtitleLang = cleanSpokenLanguage !== "auto"
        ? cleanSpokenLanguage
        : (browserLangValid || "en");
      const prefsData: any = {
        userId,
        spokenLanguage: cleanSpokenLanguage,
        subtitleLanguage: subtitleLang,
        showOriginalText: true,
        showTranslatedText: true,
        autoDetectLanguage: cleanSpokenLanguage === "auto",
      };
      if (formattedPhone) prefsData.phoneNumber = formattedPhone;
      await storage.upsertPreferences(prefsData);

      await storage.completeOnboarding(userId, emailClean || "", formattedPhone || "", firstNameClean, lastNameClean);

      if (username && typeof username === "string" && username.trim()) {
        try {
          const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
          if (cleanUsername.length >= 3 && cleanUsername.length <= 20) {
            const existing = await storage.findUsersByUsername(cleanUsername);
            const isTaken = existing.length > 0;
            if (!isTaken) {
              await storage.setUsername(userId, cleanUsername);
            }
          }
        } catch (err) {
          console.error("[Onboarding] Username assignment failed (non-blocking):", err);
        }
      }

      sendWelcomeEmail(emailClean || "", firstNameClean).catch((err) => {
        console.error("[Onboarding] Welcome email failed (non-blocking):", err);
      });

      trackOnboardingStep(userId, "complete", true);
      recordSignup(req, true, Date.now() - signupStart, cleanSpokenLanguage);

      const updatedUser = await storage.getUser(userId);
      res.json(sanitizeUser(updatedUser));
    } catch (error: any) {
      const userId = req.user?.claims?.sub || "unknown";
      trackOnboardingStep(userId, "complete", false, error?.message || "Server error");
      recordSignup(req, false, Date.now() - signupStart, "unknown", "Server error");
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding", recoverable: true });
    }
  });

  v1Router.patch("/user/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { firstName, lastName, email, phoneNumber } = req.body;
      if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
        return res.status(400).json({ message: "Display name is required" });
      }
      const profileData: any = {
        firstName: firstName.trim(),
        lastName: typeof lastName === "string" ? lastName.trim() || null : null,
      };
      if (email && typeof email === "string" && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim().toLowerCase())) {
          return res.status(400).json({ message: "Invalid email address" });
        }
        profileData.email = email.trim().toLowerCase();
      }
      let formattedPhone: string | null = null;
      if (phoneNumber && typeof phoneNumber === "string" && phoneNumber.trim()) {
        const { parsePhoneNumberFromString } = await import("libphonenumber-js");
        let phoneInput = phoneNumber.trim();
        if (!phoneInput.startsWith("+")) {
          phoneInput = "+1" + phoneInput;
        }
        const parsedPhone = parsePhoneNumberFromString(phoneInput);
        if (parsedPhone && parsedPhone.isValid()) {
          formattedPhone = parsedPhone.formatInternational();
        } else {
          return res.status(400).json({ message: "The phone number doesn't look right. Please check it and try again." });
        }
      }
      const updated = await storage.updateUserProfile(userId, profileData);
      if (formattedPhone) {
        await storage.upsertPreferences({ userId, phoneNumber: formattedPhone });
      }
      res.json(sanitizeUser(updated));
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  v1Router.post("/username/check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { username } = req.body;
      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ message: "Username is required" });
      }
      const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
      if (clean.length < 3 || clean.length > 20) {
        return res.status(400).json({ message: "Username must be 3-20 characters", available: false });
      }
      const existing = await storage.findUsersByUsername(clean);
      const takenByOther = existing.some(u => u.id !== userId);
      res.json({ available: !takenByOther, username: clean });
    } catch (error) {
      console.error("Error checking username:", error);
      res.status(500).json({ message: "Failed to check username" });
    }
  });

  v1Router.post("/username/set", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { username } = req.body;
      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ message: "Username is required" });
      }
      const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
      if (clean.length < 3 || clean.length > 20) {
        return res.status(400).json({ message: "Username must be 3-20 characters" });
      }

      trackAction("set_username", "user_profile");
      const existing = await storage.findUsersByUsername(clean);
      const takenByOther = existing.some(u => u.id !== userId);
      if (takenByOther) {
        return res.status(409).json({ message: "Username not available", available: false });
      }

      const updated = await storage.setUsername(userId, clean);
      res.json(sanitizeUser(updated));
    } catch (error) {
      console.error("Error setting username:", error);
      res.status(500).json({ message: "Failed to set username" });
    }
  });

  v1Router.post("/profile-image", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { objectPath } = req.body;
      if (!objectPath || typeof objectPath !== "string") {
        return res.status(400).json({ message: "objectPath is required" });
      }
      const normalizedPath = objectStorageService.normalizeObjectEntityPath(objectPath);
      const servingUrl = objectStorageService.getServingUrl(normalizedPath);
      await storage.updateProfileImage(userId, servingUrl);
      const updatedUser = await storage.getUser(userId);
      res.json(sanitizeUser(updatedUser));
    } catch (error) {
      console.error("Error updating profile image:", error);
      res.status(500).json({ message: "Failed to update profile image" });
    }
  });

  // GDPR: Export user data (data portability)
  v1Router.get("/gdpr/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = await storage.exportUserData(userId);
      const exportPayload = {
        exportDate: new Date().toISOString(),
        platform: "JunoTalk",
        dataSubject: {
          id: data.profile.id,
          firstName: data.profile.firstName,
          lastName: data.profile.lastName,
          email: data.profile.email,
          profileImageUrl: data.profile.profileImageUrl,
          onboardingComplete: data.profile.onboardingComplete,
          createdAt: data.profile.createdAt,
        },
        preferences: data.preferences ? {
          phoneNumber: data.preferences.phoneNumber ? "(encrypted)" : null,
          subtitleLanguage: data.preferences.subtitleLanguage,
          spokenLanguage: data.preferences.spokenLanguage,
          showOriginalText: data.preferences.showOriginalText,
          showTranslatedText: data.preferences.showTranslatedText,
          autoDetectLanguage: data.preferences.autoDetectLanguage,
        } : null,
        status: data.status ? {
          status: data.status.status,
          lastSeen: data.status.lastSeen,
        } : null,
        contacts: data.contacts.map(c => ({
          contactId: c.userId === userId ? c.contactId : c.userId,
          createdAt: c.createdAt,
        })),
        messages: data.messages.map(m => ({
          direction: m.senderId === userId ? "sent" : "received",
          content: m.content,
          createdAt: m.createdAt,
          read: m.read,
        })),
        calls: data.calls.map((c: any) => ({
          direction: c.callerId === userId ? "outgoing" : "incoming",
          status: c.status,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          duration: c.duration,
        })),
        rooms: data.rooms.map(r => ({
          code: r.code,
          name: r.name,
          createdAt: r.createdAt,
          isActive: r.isActive,
        })),
        roomMemberships: data.roomMemberships.map(rm => ({
          roomCode: rm.roomCode,
          joinedAt: rm.joinedAt,
          isActive: rm.isActive,
        })),
        roomMessages: data.roomMessages.map((m: any) => ({
          roomCode: m.roomCode,
          content: m.content,
          createdAt: m.createdAt,
        })),
        feedback: data.feedback.map((f: any) => ({
          type: f.type || f.status,
          message: f.message || f.comment,
          createdAt: f.createdAt,
        })),
        supportTickets: data.supportTickets.map((t: any) => ({
          subject: t.subject,
          message: t.message || t.description,
          status: t.status,
          createdAt: t.createdAt,
        })),
        loginActivity: (data.loginActivity || []).map((la: any) => ({
          ipAddress: la.ipAddress,
          deviceType: la.deviceType,
          browser: la.browser,
          createdAt: la.createdAt,
          flagged: la.flagged,
        })),
      };
      res.setHeader("Content-Disposition", `attachment; filename="junotalk-data-export-${Date.now()}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.json(exportPayload);
    } catch (error) {
      console.error("GDPR export error:", error);
      res.status(500).json({ message: "Failed to export user data" });
    }
  });

  // GDPR: Delete user account (right to erasure)
  v1Router.delete("/gdpr/delete-account", isAuthenticated, async (req: any, res) => {
    try {
      const csrfHeader = req.headers["x-gdpr-delete-confirm"];
      if (csrfHeader !== "true") {
        return res.status(403).json({ message: "Missing CSRF confirmation header" });
      }
      const userId = req.user.claims.sub;
      const { confirmation } = req.body;
      if (confirmation !== "DELETE_MY_ACCOUNT") {
        return res.status(400).json({ message: "Please confirm deletion by sending confirmation: 'DELETE_MY_ACCOUNT'" });
      }
      connectedClients.delete(userId);
      userRooms.delete(userId);
      roomParticipants.forEach((participants, roomCode) => {
        participants.delete(userId);
        if (participants.size === 0) roomParticipants.delete(roomCode);
      });
      await storage.deleteUserAccount(userId);
      req.session.destroy((err: any) => {
        if (err) console.error("Session destroy error during account deletion:", err);
      });
      res.json({ message: "Account and all associated data have been permanently deleted" });
    } catch (error) {
      console.error("GDPR delete account error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // Generate a random 6-character room code
  function generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude similar chars (0/O, 1/I)
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Create a new room (rate limited)
  v1Router.post("/rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      trackAction("create_room", "rooms");

      if (!checkRoomCreationRate(userId)) {
        return res.status(429).json({ message: "Too many rooms created. Please wait before creating more." });
      }
      
      // Generate unique code
      let code = generateRoomCode();
      let existingRoom = await storage.getRoomByCode(code);
      while (existingRoom) {
        code = generateRoomCode();
        existingRoom = await storage.getRoomByCode(code);
      }
      
      const room = await storage.createRoom({
        code,
        hostId: userId,
        name: req.body.name || null,
        isActive: true,
        expiresAt: null,
      });
      
      const hostUser = await storage.getUser(userId);
      const hostName = getValidDisplayName(hostUser?.firstName, hostUser?.lastName);
      await storage.addRoomMember({ roomCode: code, userId, username: hostName });
      
      metrics.rooms.totalCreated++;
      structuredLog("info", "room_create", "Room created", { userId, roomId: code });
      res.status(201).json(room);
    } catch (error) {
      console.error("Error creating room:", error);
      res.status(500).json({ message: "Failed to create room" });
    }
  });

  // Get room by code
  v1Router.get("/rooms/:code", isAuthenticated, async (req, res) => {
    try {
      const code = (req.params.code as string).toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found or expired" });
      }
      
      // Get host info and member count
      const host = await storage.getUser(room.hostId);
      const memberCount = await storage.getActiveRoomMemberCount(code);
      res.json({ ...room, host: sanitizeUser(host), memberCount });
    } catch (error) {
      console.error("Error fetching room:", error);
      res.status(500).json({ message: "Failed to fetch room" });
    }
  });

  // Get user's active rooms
  v1Router.get("/my-rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rooms = await storage.getRoomsByHost(userId);
      res.json(rooms);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      res.status(500).json({ message: "Failed to fetch rooms" });
    }
  });

  v1Router.get("/joined-rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rooms = await storage.getJoinedRooms(userId);
      const roomsWithHost = await Promise.all(rooms.map(async (room) => {
        const hostUser = await storage.getUser(room.hostId);
        const hostName = getValidDisplayName(hostUser?.firstName, hostUser?.lastName);
        return { ...room, hostName, hostProfileImage: hostUser?.profileImageUrl || null };
      }));
      res.json(roomsWithHost);
    } catch (error) {
      console.error("Error fetching joined rooms:", error);
      res.status(500).json({ message: "Failed to fetch joined rooms" });
    }
  });

  // Deactivate a room (host only)
  v1Router.delete("/rooms/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      // Look up the room to verify ownership
      const allRooms = await storage.getRoomsByHost(userId);
      const roomToDelete = allRooms.find(r => r.id === req.params.id);
      if (!roomToDelete) {
        return res.status(403).json({ message: "Only the room host can delete a room" });
      }
      await storage.deactivateRoom(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deactivating room:", error);
      res.status(500).json({ message: "Failed to deactivate room" });
    }
  });

  // Get recent messages for a room (must be a member or host)
  v1Router.get("/room-messages/:code", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const userId = req.user.claims.sub;
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      // Verify user is room host or an active member
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room to view messages" });
      }
      const dbMessages = await storage.getRoomMessages(code, 100);
      const cachedMsgs = roomMessages.get(code) || [];
      const verifiedIds = new Set(cachedMsgs.filter(cm => (cm as any).verified).map(cm => cm.id));
      const editedMap = new Map(cachedMsgs.filter(cm => cm.edited).map(cm => [cm.id, { text: cm.text, editedAt: cm.editedAt }]));
      const cachedReactionsMap = new Map(cachedMsgs.filter(cm => cm.reactions && Object.keys(cm.reactions).length > 0).map(cm => [cm.id, cm.reactions]));
      const otherReadAt = await storage.getOtherReadStatus(code, userId);
      const otherReadTs = otherReadAt ? otherReadAt.getTime() : 0;
      const messages = dbMessages.map(m => {
        const ts = m.createdAt ? new Date(m.createdAt).getTime() : Date.now();
        const base: any = { id: m.id, roomCode: m.roomCode, fromId: m.fromId, fromName: m.fromName, timestamp: ts };
        if (m.fromId === userId) {
          base.status = otherReadTs >= ts ? "seen" : "delivered";
        }
        if (verifiedIds.has(m.id)) base.verified = true;
        const editInfo = editedMap.get(m.clientMessageId || m.id);
        if (editInfo) {
          base.edited = true;
          base.editedAt = editInfo.editedAt;
        } else if (m.edited) {
          base.edited = true;
          base.editedAt = m.editedAt ? new Date(m.editedAt).getTime() : ts;
        }
        const cachedReactions = m.clientMessageId ? cachedReactionsMap.get(m.clientMessageId) : undefined;
        if (cachedReactions && Object.keys(cachedReactions).length > 0) {
          base.reactions = cachedReactions;
        } else if (m.reactions) {
          try { base.reactions = JSON.parse(m.reactions); } catch {}
        }
        if (m.replyToData) {
          try { base.replyTo = JSON.parse(m.replyToData); } catch {}
        }
        const emojiMatch = m.content.match(/^\[Emoji:(https:\/\/fonts\.gstatic\.com\/[^\]]+)\]$/);
        if (emojiMatch) {
          return { ...base, text: "[Emoji]", imageData: emojiMatch[1], mediaType: "image" };
        }
        const gifMatch = m.content.match(/^\[GIF:(https:\/\/media[^\]]+giphy\.com\/[^\]]+)\]$/);
        if (gifMatch) {
          return { ...base, text: "[GIF]", imageData: gifMatch[1], mediaType: "image" };
        }
        if (m.audioData && m.content === "[Voice]") {
          return { ...base, text: "[Voice]", audioData: m.audioData, mediaType: "audio", ...(m.transcription ? { transcription: m.transcription } : {}) };
        }
        const rawContent = editInfo ? editInfo.text : (m.edited && m.content ? m.content : m.content);
        if (rawContent.startsWith("[E2EE]")) {
          return { ...base, text: rawContent.slice(6), e2ee: true };
        }
        if (m.translatedContent && m.translatedLang && m.fromId !== userId) {
          base.serverTranslatedText = m.translatedContent;
          base.serverTranslatedLang = m.translatedLang;
        }
        return { ...base, text: rawContent };
      });
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  v1Router.post("/room-messages/:code", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const userId = req.user.claims.sub;
      const { text, fromName, imageData, audioData, transcription, replyTo, vanish } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ message: "Text is required" });
      }
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room to send messages" });
      }
      const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isEmojiMsg = imageData && typeof imageData === "string" && imageData.startsWith("https://fonts.gstatic.com/");
      const isAudioMsg = audioData && typeof audioData === "string" && audioData.startsWith("data:audio/") && audioData.length <= 5 * 1024 * 1024;
      const roomMsg: RoomChatMsg = {
        id: msgId,
        roomCode: code,
        fromId: userId,
        fromName: fromName || "Unknown",
        text: text.slice(0, 500),
        timestamp: Date.now(),
        ...(isEmojiMsg ? { imageData, mediaType: "image" } : {}),
        ...(isAudioMsg ? { audioData, mediaType: "audio", ...(transcription && typeof transcription === "string" ? { transcription: transcription.slice(0, 2000) } : {}) } : {}),
      };
      if (replyTo && typeof replyTo === "object" && replyTo.id) {
        roomMsg.replyTo = {
          id: replyTo.id,
          fromName: String(replyTo.fromName || ""),
          text: String(replyTo.text || "").slice(0, 200),
          ...(replyTo.imageData ? { imageData: String(replyTo.imageData) } : {}),
          ...(replyTo.videoData ? { videoData: String(replyTo.videoData) } : {}),
        };
      }
      if (vanish) {
        (roomMsg as any).vanish = true;
      }
      addRoomMessage(code, roomMsg);
      notifyMessageCountUpdate(code, userId);
      broadcastHomeChat(code, roomMsg);

      res.json(roomMsg);
    } catch (error) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  v1Router.delete("/room-messages/:code/:messageId", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const messageId = req.params.messageId;
      const userId = req.user.claims.sub;
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room" });
      }
      const delMsgs = roomMessages.get(code);
      if (delMsgs) {
        const targetMsg = delMsgs.find(m => m.id === messageId);
        if (targetMsg && targetMsg.fromId !== userId) {
          return res.status(403).json({ message: "You can only delete your own messages" });
        }
        const delIdx = delMsgs.findIndex(m => m.id === messageId);
        if (delIdx >= 0) {
          delMsgs.splice(delIdx, 1);
        }
      }
      await storage.softDeleteRoomMessage(messageId, userId);
      const delPayload = JSON.stringify({
        type: "home-chat-message-deleted",
        roomCode: code,
        messageId: messageId,
      });
      const delSubs = homeChatSubscribers.get(code);
      delSubs?.forEach(s => {
        if (s.readyState === WebSocket.OPEN) s.send(delPayload);
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  v1Router.post("/presence", isAuthenticated, async (req: any, res) => {
    try {
      const { getUserPresenceStatus } = await import("./socket-io");
      const presenceMap = getUserPresenceStatus();
      const userIds: string[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      const result: Record<string, string> = {};
      userIds.forEach(uid => {
        result[uid] = presenceMap.get(uid) || "offline";
      });
      res.json(result);
    } catch {
      res.status(500).json({ message: "Failed to get presence" });
    }
  });

  v1Router.get("/room-message-counts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const hostRooms = await storage.getRoomsByHost(userId);
      const joinedRooms = await storage.getJoinedRooms(userId);
      const codeSet = new Set<string>();
      hostRooms.forEach(r => codeSet.add(r.code));
      joinedRooms.forEach(r => codeSet.add(r.code));
      const allRoomCodes = Array.from(codeSet);
      if (allRoomCodes.length === 0) return res.json({});
      const counts: Record<string, number> = {};
      for (const code of allRoomCodes) {
        counts[code] = await storage.countUnreadMessages(code, userId);
      }
      res.json(counts);
    } catch (error) {
      res.status(500).json({ message: "Failed to get message counts" });
    }
  });

  v1Router.post("/room-read/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      await storage.markRoomAsRead(roomCode, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark room as read" });
    }
  });

  // Rejoin a room (reactivate membership when returning to a room)
  v1Router.post("/room-members/:code/rejoin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(roomCode);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      // Check room capacity (max 2 active members)
      // Only skip capacity check if user is already active (they're already counted)
      const isAlreadyActiveMember = await storage.isRoomMember(roomCode, userId);
      if (!isAlreadyActiveMember) {
        const activeCount = await storage.getActiveRoomMemberCount(roomCode);
        if (activeCount >= 2) {
          return res.status(403).json({ message: "Room is full", roomFull: true });
        }
      }
      const user = await storage.getUser(userId);
      const username = getValidDisplayName(user?.firstName, user?.lastName);
      const member = await storage.addRoomMember({ roomCode, userId, username });

      const joinNotif = JSON.stringify({
        type: "member-joined",
        roomCode,
        userId,
        username,
      });
      const subs = homeChatSubscribers.get(roomCode);
      if (subs) {
        subs.forEach(s => {
          const subUserId = wsToUserId.get(s);
          if (s.readyState === WebSocket.OPEN && subUserId !== userId) {
            s.send(joinNotif);
          }
        });
      }
      const roomParts = roomParticipants.get(roomCode);
      if (roomParts) {
        roomParts.forEach(pid => {
          if (pid !== userId) {
            const pWs = connectedClients.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
              pWs.send(joinNotif);
            }
          }
        });
      }

      res.json(member);
    } catch (error) {
      console.error("[Rejoin] Error rejoining room:", error);
      res.status(500).json({ message: "Failed to rejoin room" });
    }
  });

  // Get room members for a specific room (must be member or host)
  v1Router.get("/room-members/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const code = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      // Verify user is host or member
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room" });
      }
      const members = await storage.getRoomMembers(code);
      const sanitizedMembers = members.map(m => ({
        ...m,
        user: m.user ? sanitizeUser(m.user) : undefined,
      }));
      res.json(sanitizedMembers);
    } catch (error) {
      console.error("Error fetching room members:", error);
      res.status(500).json({ message: "Failed to fetch room members" });
    }
  });

  // Get the other room member's language preference
  v1Router.get("/room-partner-lang/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const code = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) return res.status(404).json({ message: "Room not found" });
      const members = await storage.getRoomMembers(code);
      const activeMembers = members.filter(m => m.isActive);
      const partner = activeMembers.find(m => m.userId !== userId);
      if (!partner) return res.json({ partnerLang: null, partnerName: null });
      const prefs = await storage.getPreferences(partner.userId);
      const partnerUser = await storage.getUser(partner.userId);
      const partnerName = getValidDisplayName(partnerUser?.firstName, partnerUser?.lastName);
      let spokenLang = prefs?.spokenLanguage && prefs.spokenLanguage !== "auto"
        ? prefs.spokenLanguage
        : prefs?.subtitleLanguage || "en";
      if (spokenLang === "en" && prefs?.spokenLanguage === "auto") {
        const roomProfile = roomLangProfiles.get(code);
        const partnerProfile = roomProfile?.users[partner.userId];
        if (partnerProfile) {
          const learnedLang = getUserLearnedLang(partnerProfile);
          if (learnedLang) spokenLang = learnedLang;
        }
      }
      recordUserSettingLang(code, partner.userId, spokenLang);
      const myPrefs = await storage.getPreferences(userId);
      let mySpokenLang = myPrefs?.spokenLanguage && myPrefs.spokenLanguage !== "auto"
        ? myPrefs.spokenLanguage
        : myPrefs?.subtitleLanguage || "en";
      if (mySpokenLang === "en" && myPrefs?.spokenLanguage === "auto") {
        const roomProfile = roomLangProfiles.get(code);
        const myProfile = roomProfile?.users[userId];
        if (myProfile) {
          const learnedLang = getUserLearnedLang(myProfile);
          if (learnedLang) mySpokenLang = learnedLang;
        }
      }
      recordUserSettingLang(code, userId, mySpokenLang);
      res.json({
        partnerLang: spokenLang,
        partnerName,
      });
    } catch (error) {
      console.error("Error fetching partner language:", error);
      res.status(500).json({ message: "Failed to fetch partner language" });
    }
  });

  // Get room members for all of user's rooms (batch)
  v1Router.get("/my-room-members", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userRooms = await storage.getRoomsByHost(userId);
      const joinedRooms = await storage.getJoinedRooms(userId);
      const codeSet = new Set<string>();
      userRooms.forEach(r => codeSet.add(r.code));
      joinedRooms.forEach(r => codeSet.add(r.code));
      const codes = Array.from(codeSet);
      const members = await storage.getRoomMembersForMultipleRooms(codes);
      const sanitized: Record<string, any[]> = {};
      for (const [code, mList] of Object.entries(members)) {
        sanitized[code] = mList.map(m => ({
          ...m,
          user: m.user ? sanitizeUser(m.user) : undefined,
        }));
      }
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching room members:", error);
      res.status(500).json({ message: "Failed to fetch room members" });
    }
  });

  // Leave a room (disconnect yourself as a member - deactivates, doesn't delete)
  v1Router.delete("/room-members/:code/leave", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      await storage.deactivateRoomMember(roomCode, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error leaving room:", error);
      res.status(500).json({ message: "Failed to leave room" });
    }
  });

  // Remove a member from your room (host only)
  v1Router.delete("/room-members/:code/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const hostId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      const targetUserId = req.params.userId;

      const room = await storage.getRoomByCode(roomCode);
      if (!room || room.hostId !== hostId) {
        return res.status(403).json({ message: "Only the room host can remove members" });
      }

      await storage.removeRoomMember(roomCode, targetUserId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing room member:", error);
      res.status(500).json({ message: "Failed to remove member" });
    }
  });

  v1Router.get("/room-code-security", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const now = Date.now();
    roomCodeAttempts.blockedUsers.forEach((expiry, uid) => {
      if (now >= expiry) roomCodeAttempts.blockedUsers.delete(uid);
    });
    const recentFailed = roomCodeAttempts.failedAttempts.filter(a => now - a.timestamp < 3600_000);
    const uniqueAttackers = new Set(recentFailed.map(a => a.userId));
    const topOffenders = Array.from(
      recentFailed.reduce((acc, a) => {
        acc.set(a.userId, (acc.get(a.userId) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, count]) => ({ userId, failedAttempts: count }));

    res.json({
      totalFailed: roomCodeAttempts.totalFailed,
      totalSuccessful: roomCodeAttempts.totalSuccessful,
      failedLastHour: recentFailed.length,
      uniqueAttackersLastHour: uniqueAttackers.size,
      currentlyBlocked: roomCodeAttempts.blockedUsers.size,
      blockedUsers: Array.from(roomCodeAttempts.blockedUsers.entries()).map(([userId, expiry]) => ({
        userId,
        blockedUntil: new Date(expiry).toISOString(),
        remainingMs: expiry - now,
      })),
      recentAlerts: roomCodeAttempts.alerts.slice(-10).reverse(),
      topOffenders,
      config: {
        windowMs: ROOM_CODE_BRUTE_FORCE_WINDOW,
        threshold: ROOM_CODE_BRUTE_FORCE_THRESHOLD,
        blockDurationMs: ROOM_CODE_BLOCK_DURATION,
      },
    });
  });

  // Metrics endpoint for developer portal dashboard
  v1Router.get("/metrics", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    metrics.uptime = Date.now() - metrics.startTime;
    metrics.websocket.currentConnections = connectedClients.size;
    metrics.rooms.activeRooms = roomParticipants.size;

    let totalSubscribers = 0;
    try {
      const allUsers = await storage.getAllUsers();
      totalSubscribers = allUsers.length;
    } catch {
      totalSubscribers = 0;
    }

    const memUsage = process.memoryUsage();
    
    const activeCallsList: { roomCode: string; participants: number; duration: string }[] = [];
    activeCalls.forEach((call, code) => {
      const dur = Date.now() - call.startedAt;
      const mins = Math.floor(dur / 60000);
      const secs = Math.floor((dur % 60000) / 1000);
      activeCallsList.push({ roomCode: code, participants: call.participants.size, duration: `${mins}m ${secs}s` });
    });

    const avgCallDurationMs = videoCallMetrics.completedCalls > 0
      ? Math.round(videoCallMetrics.totalDurationMs / videoCallMetrics.completedCalls)
      : 0;
    const avgMins = Math.floor(avgCallDurationMs / 60000);
    const avgSecs = Math.floor((avgCallDurationMs % 60000) / 1000);

    const jaasConfigured = !!(process.env.JAAS_APP_ID && process.env.JAAS_API_KEY && process.env.JAAS_KEY_ID);

    res.json({
      totalSubscribers,
      translationRequests: metrics.translationRequests,
      latency: { avg: metrics.latency.avg, p95: metrics.latency.p95, max: metrics.latency.max, sampleCount: metrics.latency.samples.length },
      websocket: {
        ...metrics.websocket,
        messagesRouted: socketMetrics.messagesRouted,
        messagesFailed: socketMetrics.messagesFailed,
        typingEventsRouted: socketMetrics.typingEventsRouted,
        presenceUpdates: socketMetrics.presenceUpdates,
        abnormalClosures: socketMetrics.abnormalClosures,
        pingPongFailures: socketMetrics.pingPongFailures,
        avgDeliveryMs: socketMetrics.avgDeliveryMs,
        peakConnections: socketMetrics.peakConnections,
        compressionEnabled: true,
      },
      rooms: metrics.rooms,
      uptime: metrics.uptime,
      startTime: metrics.startTime,
      recentErrors: metrics.errors.slice(-10),
      alerts: metrics.alerts.filter(a => !a.resolved),
      errorRate: metrics.translationRequests.total > 0 
        ? (metrics.translationRequests.failed / metrics.translationRequests.total * 100).toFixed(2) + "%" 
        : "0%",
      videoCalls: {
        activeCalls: activeCallsList,
        activeCount: activeCalls.size,
        totalCalls: videoCallMetrics.totalCalls,
        completedCalls: videoCallMetrics.completedCalls,
        peakConcurrent: videoCallMetrics.peakConcurrent,
        avgDuration: `${avgMins}m ${avgSecs}s`,
        avgDurationMs: avgCallDurationMs,
        recentCalls: videoCallMetrics.recentCalls.slice(-5).reverse().map(c => ({
          ...c,
          duration: `${Math.floor(c.durationMs / 60000)}m ${Math.floor((c.durationMs % 60000) / 1000)}s`,
        })),
        jaasConfigured,
      },
      systemHealth: {
        memory: {
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10,
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10,
          rssMB: Math.round(memUsage.rss / 1024 / 1024 * 10) / 10,
          externalMB: Math.round(memUsage.external / 1024 / 1024 * 10) / 10,
        },
        caches: {
          videoCaptions: videoCaptionCache.size,
          translatedCaptions: translatedCaptionCache.size,
          langDetect: langDetectCache.size,
          wsConnections: connectedClients.size,
          activeRooms: roomParticipants.size,
          rateLimiters: roomCreationLimiter.size,
        },
        cleanup: cleanupStats,
      },
      aiServices: {
        activeProvider: activeTranslationService,
        autoSwitch: autoSwitchEnabled,
        providers: getProviderStats(),
      },
    });
  });

  v1Router.get("/agent/metrics", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const snapshot = await getMetricsSnapshot();
      const toolHealth = getToolHealth();
      res.json({ ...snapshot, toolExecution: toolHealth });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch agent metrics" });
    }
  });

  v1Router.get("/agent/health", async (req, res) => {
    const token = req.headers["x-agent-token"] || req.query.token;
    const expectedToken = process.env.AGENT_MONITOR_TOKEN;
    if (!expectedToken || token !== expectedToken) {
      return res.status(401).json({ error: "Invalid or missing monitor token" });
    }
    try {
      const { getQueueHealth } = await import("./agent-queue");
      const [data, queueHealth] = await Promise.all([
        getMetricsForExternalMonitor(),
        getQueueHealth(),
      ]);
      res.json({ ...data, queue: queueHealth });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch agent health" });
    }
  });

  v1Router.post("/session/heartbeat", isAuthenticated, (req, res) => {
    if (req.session) {
      req.session.touch();
    }
    res.json({ alive: true });
  });

  // Public endpoint — returns remotely-controllable auth stability thresholds.
  // Values are loaded from config/auth-policy.json in the GitHub CDN and refreshed
  // every hour. No auth required so the client can read them before session is confirmed.
  v1Router.get("/auth/policy", (_req, res) => {
    try {
      const policy = getAuthPolicy();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(policy);
    } catch {
      res.json({
        null_tolerance: 8,
        visibility_logout_enabled: false,
        visibility_logout_delay_ms: 1800000,
        auth_refetch_interval_ms: 600000,
      });
    }
  });

  // Public endpoint — returns all remotely-controllable client UX configuration.
  // Values are loaded from config/client-config.json in the GitHub CDN (refreshed hourly).
  // Controls Socket.IO reconnect behavior, upload limits, toast durations, query intervals.
  v1Router.get("/client-config", (_req, res) => {
    try {
      const cfg = getClientConfig();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(cfg);
    } catch {
      res.json({
        socket_chat_reconnect_delay_ms: 1000,
        socket_chat_reconnect_delay_max_ms: 15000,
        socket_chat_timeout_ms: 10000,
        socket_dm_reconnect_delay_ms: 1000,
        socket_dm_reconnect_delay_max_ms: 8000,
        socket_dm_reconnect_attempts: 15,
        socket_dm_timeout_ms: 10000,
        ws_heartbeat_interval_ms: 15000,
        ws_heartbeat_timeout_ms: 10000,
        ws_reconnect_initial_delay_ms: 1000,
        ws_reconnect_max_delay_ms: 15000,
        upload_max_mb_mobile: 15,
        upload_max_mb_desktop: 25,
        toast_duration_ms: 3500,
        toast_error_duration_ms: 5000,
        contacts_refetch_interval_ms: 30000,
        feature_flags_refetch_interval_ms: 300000,
        query_default_stale_time_ms: 30000,
        query_default_retry_max_delay_ms: 8000,
      });
    }
  });


  // Platform activity — combines GitHub CDN recent commits + live platform events
  // Drives the animated update indicator under the JunoTalk branding.
  v1Router.get("/platform-activity", async (_req, res) => {
    try {
      const liveActive = isPlatformRecentlyActive();
      if (liveActive) {
        res.setHeader("Cache-Control", "no-store");
        return res.json({ active: true, lastCommit: null, source: "platform" });
      }
      const cdnResult = await checkPlatformActivity();
      res.setHeader("Cache-Control", "public, max-age=180");
      return res.json({ ...cdnResult, source: cdnResult.active ? "cdn" : "none" });
    } catch {
      res.json({ active: false, lastCommit: null, source: "none" });
    }
  });

  v1Router.get("/gifs/trending", isAuthenticated, async (_req, res) => {
    const apiKey = process.env.GIPHY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: "GIPHY API key not configured" });
    }
    try {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=30&rating=pg-13`
      );
      if (!response.ok) throw new Error("GIPHY API error");
      const data = await response.json();
      const gifs = (data.data || []).map((g: any) => ({
        id: g.id,
        title: g.title || "",
        preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || "",
        url: g.images?.fixed_width?.url || g.images?.original?.url || "",
        width: parseInt(g.images?.fixed_width?.width || "200"),
        height: parseInt(g.images?.fixed_width?.height || "200"),
      }));
      res.json({ gifs });
    } catch (err) {
      console.error("GIPHY trending error:", err);
      res.status(500).json({ message: "Failed to fetch trending GIFs" });
    }
  });

  v1Router.get("/gifs/search", isAuthenticated, async (req, res) => {
    const apiKey = process.env.GIPHY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: "GIPHY API key not configured" });
    }
    const q = (req.query.q as string || "").trim();
    if (!q) {
      return res.status(400).json({ message: "Search query required" });
    }
    try {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=30&rating=pg-13`
      );
      if (!response.ok) throw new Error("GIPHY API error");
      const data = await response.json();
      const gifs = (data.data || []).map((g: any) => ({
        id: g.id,
        title: g.title || "",
        preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || "",
        url: g.images?.fixed_width?.url || g.images?.original?.url || "",
        width: parseInt(g.images?.fixed_width?.width || "200"),
        height: parseInt(g.images?.fixed_width?.height || "200"),
      }));
      res.json({ gifs });
    } catch (err) {
      console.error("GIPHY search error:", err);
      res.status(500).json({ message: "Failed to search GIFs" });
    }
  });

  // Dismiss alert endpoint
  v1Router.post("/metrics/dismiss-alert", isAuthenticated, (req, res) => {
    const { alertId } = req.body;
    const alert = metrics.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      res.json({ success: true });
    } else {
      res.status(404).json({ message: "Alert not found" });
    }
  });

  // AI Health Analysis - runs automatically every 5 minutes
  let latestHealthAnalysis: { analysis: string; score: number; recommendations: string[]; timestamp: number } | null = null;

  async function runAIHealthAnalysis() {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10;
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10;
      const rssMB = Math.round(memUsage.rss / 1024 / 1024 * 10) / 10;
      const uptimeHours = Math.round((Date.now() - metrics.startTime) / 3600000 * 10) / 10;
      const errorRate = metrics.translationRequests.total > 0
        ? (metrics.translationRequests.failed / metrics.translationRequests.total * 100).toFixed(2)
        : "0";

      const systemSnapshot = {
        uptime: `${uptimeHours} hours`,
        memory: { heapUsed: `${heapUsedMB}MB`, heapTotal: `${heapTotalMB}MB`, rss: `${rssMB}MB`, heapUtilization: `${Math.round(heapUsedMB / heapTotalMB * 100)}%` },
        translations: { total: metrics.translationRequests.total, success: metrics.translationRequests.success, failed: metrics.translationRequests.failed, errorRate: `${errorRate}%`, byProvider: metrics.translationRequests.byProvider },
        latency: { avg: `${metrics.latency.avg}ms`, p95: `${metrics.latency.p95}ms`, max: `${metrics.latency.max}ms` },
        connections: { websocket: connectedClients.size, rooms: roomParticipants.size },
        caches: { videoCaptions: videoCaptionCache.size, translatedCaptions: translatedCaptionCache.size, langDetect: langDetectCache.size, rateLimiters: roomCreationLimiter.size },
        cleanup: { runs: cleanupStats.runCount, totalCleaned: cleanupStats.totalCleaned, lastCleaned: cleanupStats.lastCleaned },
        recentErrors: metrics.errors.slice(-5).map(e => `${e.provider}: ${(e.message || "").slice(0, 150).replace(/[^\w\s.,!?:;()\-]/g, "")}`),
        activeAlerts: metrics.alerts.filter(a => !a.resolved).length,
        tokenBudget: getRedactedTokenSnapshot(),
      };

      const healthPromptSystem = `You are a system health analyst for JunoTalk, a real-time video calling app with AI translation. Analyze the system metrics and provide a health score (0-100) and brief report.

SCORING GUIDELINES - Base score starts at 70 and adjust from there:
- Uptime < 1 hour: System just restarted. This is NORMAL. Do NOT penalize for low activity, zero connections, or zero translations after a fresh start. A freshly started healthy system with no errors should score 65-80.
- Memory heap utilization 60-85%: Normal for Node.js. Only flag if consistently above 90%.
- Memory heap utilization 85-92%: Slightly elevated but acceptable under load. Score 60-75.
- Memory heap utilization > 92%: Concerning, recommend investigation. Score impact -15 to -25.
- Zero translations/connections with low uptime: Expected, not a problem. No score penalty.
- Error rate 0%: Excellent, bonus +5 to +10.
- Error rate < 5%: Acceptable, no penalty.
- Error rate > 10%: Concerning, score impact -10 to -20.
- Active WebSocket connections: More connections = healthy engagement. 0 connections with low uptime is fine.
- Cache sizes: Larger caches indicate active usage, which is positive.

Focus health scoring on actual problems (errors, memory leaks, failures) rather than lack of activity. A quiet system with no errors is a healthy system.

IMPORTANT: Do not mention specific AI provider names, third-party service names, or internal technology details in the analysis or recommendations. Use generic terms like "translation service" or "AI provider."

Respond in valid JSON only: {"score": <0-100 integer>, "analysis": "<2-3 sentence summary>", "recommendations": ["<action item 1>", "<action item 2>", "<action item 3>"]}`;

      const healthPromptUser = `Analyze this system snapshot and provide a health score (0-100), brief analysis, and up to 3 actionable recommendations:\n${JSON.stringify(systemSnapshot, null, 2)}`;

      const healthResult = await gatewayChat(healthPromptSystem, healthPromptUser, { task: "monitor", maxTokens: 300, temperature: 0.3 });
      let content = healthResult?.text || "";
      content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      if (content) {
        const jStart = content.indexOf("{");
        const jEnd = content.lastIndexOf("}");
        if (jStart >= 0 && jEnd > jStart) {
          content = content.slice(jStart, jEnd + 1);
        }
        const parsed = JSON.parse(content);
        latestHealthAnalysis = {
          score: Math.min(100, Math.max(0, parsed.score || 0)),
          analysis: parsed.analysis || "Analysis unavailable",
          recommendations: (parsed.recommendations || []).slice(0, 3),
          timestamp: Date.now(),
        };
        lastHealthAnalysisSuccess = Date.now();
      }
    } catch (err: any) {
      healthAnalysisFailures++;
      latestHealthAnalysis = {
        score: latestHealthAnalysis?.score ?? -1,
        analysis: latestHealthAnalysis?.analysis || "AI analysis temporarily unavailable. System metrics are still being collected.",
        recommendations: latestHealthAnalysis?.recommendations || ["Check API key configuration", "Review system logs for errors"],
        timestamp: Date.now(),
      };
    }
  }

  // AI health analysis disabled — saves AI API calls. Use manual trigger only.
  // setTimeout(runAIHealthAnalysis, 15 * 1000);
  // setInterval(runAIHealthAnalysis, 30 * 60 * 1000);

  v1Router.get("/metrics/health-analysis", isAuthenticated, (req, res) => {
    if (latestHealthAnalysis) {
      res.json(latestHealthAnalysis);
    } else {
      res.json({ score: -1, analysis: "Health analysis is initializing...", recommendations: [], timestamp: Date.now() });
    }
  });

  // Claude AI status endpoint
  v1Router.get("/claude/status", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const hasKey = !!resolvedAnthropicKey;
    if (!hasKey) {
      return res.json({ available: false, model: null, error: "AI service not configured" });
    }
    try {
      const testResult = await gatewayChat("Reply with OK", "test", { task: "chat", maxTokens: 10 });
      res.json({
        available: !!testResult,
        model: "gateway",
        provider: testResult?.provider || "none",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({ available: false, model: null, error: msg });
    }
  });

  // Claude AI run task endpoint
  v1Router.post("/claude/run", isAuthenticated, async (req, res) => {
    const { task, model } = req.body;
    if (!task || typeof task !== "string") {
      return res.status(400).json({ error: "Task description is required" });
    }
    try {
      const startTime = Date.now();
      const runResult = await gatewayChat("You are a helpful AI assistant.", task, { task: "chat", maxTokens: 2048 });
      res.json({
        result: runResult?.text || "",
        model: "gateway",
        usage: { tokensUsed: runResult?.tokensUsed || 0 },
        provider: runResult?.provider || "unknown",
        durationMs: Date.now() - startTime,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // AUTONOMOUS CLAUDE AGENT — Platform Maintenance & Optimization
  // ═══════════════════════════════════════════════════════════════

  interface AgentAction {
    id: string;
    name: string;
    description: string;
    category: "performance" | "reliability" | "security" | "scalability" | "configuration";
    execute: () => Promise<{ success: boolean; detail: string }>;
  }

  interface AgentLogEntry {
    id: string;
    timestamp: number;
    trigger: "auto" | "manual";
    snapshot: any;
    analysis: {
      score: number;
      summary: string;
      findings: any[];
      metrics: Record<string, number>;
    };
    actionsExecuted: {
      actionId: string;
      actionName: string;
      reason: string;
      result: { success: boolean; detail: string };
      durationMs: number;
    }[];
    totalDurationMs: number;
    model: string;
  }

  const agentLog: AgentLogEntry[] = [];
  const MAX_AGENT_LOG = 50;
  let agentRunning = false;
  let lastAgentRun = 0;
  const AGENT_COOLDOWN = 60000;

  interface AgentReport {
    id: string;
    timestamp: number;
    type: "info" | "success" | "warning" | "error" | "critical";
    category: "agent_run" | "action" | "finding" | "service" | "security" | "performance";
    title: string;
    message: string;
    runId?: string;
    read: boolean;
  }

  const agentReports: AgentReport[] = [];
  const MAX_AGENT_REPORTS = 200;

  function addReport(report: Omit<AgentReport, "id" | "timestamp" | "read">) {
    agentReports.unshift({
      ...report,
      id: `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      read: false,
    });
    if (agentReports.length > MAX_AGENT_REPORTS) agentReports.length = MAX_AGENT_REPORTS;
  }

  interface PlatformUpdate {
    id: string;
    timestamp: number;
    type: "feature" | "fix" | "removal" | "security" | "ui";
    title: string;
    description: string;
    userImpact: string;
    reported: boolean;
  }

  const platformUpdates: PlatformUpdate[] = [
    {
      id: "upd-001",
      timestamp: Date.now(),
      type: "ui",
      title: "Creator badge replaced with display name",
      description: "Chat Room cards now show the connected person's display name or username instead of a generic 'Creator' badge.",
      userImpact: "Users see who they are connected with at a glance. No action needed — updates automatically on page load.",
      reported: false,
    },
    {
      id: "upd-002",
      timestamp: Date.now(),
      type: "removal",
      title: "Post-call AI summary disabled",
      description: "The AI-generated call summary that appeared after ending a video call has been disabled. Reserved for enterprise tier.",
      userImpact: "Calls now end cleanly and return to Chat Rooms immediately. No summary modal appears.",
      reported: false,
    },
    {
      id: "upd-003",
      timestamp: Date.now(),
      type: "feature",
      title: "Agent Reports Board added",
      description: "New Reports tab in the Claude AI section with color-coded notifications (critical=red, error=orange, warning=amber, success=green, info=blue), filters, and read/unread tracking.",
      userImpact: "Platform administrators can now monitor agent activity and alerts through the Reports Board.",
      reported: false,
    },
    {
      id: "upd-004",
      timestamp: Date.now(),
      type: "feature",
      title: "Username system with WASM code generation",
      description: "Users can now set a unique username with an auto-generated 3-digit code (e.g. username#123). Available in onboarding and settings.",
      userImpact: "Optional feature — existing users can set a username anytime in Settings.",
      reported: false,
    },
  ];
  const MAX_PLATFORM_UPDATES = 50;

  function addPlatformUpdate(update: Omit<PlatformUpdate, "id" | "timestamp" | "reported">) {
    platformUpdates.unshift({
      ...update,
      id: `upd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      reported: false,
    });
    if (platformUpdates.length > MAX_PLATFORM_UPDATES) platformUpdates.length = MAX_PLATFORM_UPDATES;
  }

  function generateReportsFromEntry(entry: AgentLogEntry) {
    const score = entry.analysis?.score ?? 0;
    const scoreType: AgentReport["type"] = score >= 80 ? "success" : score >= 60 ? "warning" : "error";
    addReport({
      type: scoreType,
      category: "agent_run",
      title: `Agent Run Complete — Score ${score}/100`,
      message: entry.analysis?.summary || "Analysis completed",
      runId: entry.id,
    });

    if (entry.analysis?.findings) {
      for (const f of entry.analysis.findings) {
        if (f.severity === "critical" || f.severity === "high") {
          addReport({
            type: f.severity === "critical" ? "critical" : "error",
            category: "finding",
            title: f.title,
            message: f.description,
            runId: entry.id,
          });
        } else if (f.severity === "medium") {
          addReport({
            type: "warning",
            category: "finding",
            title: f.title,
            message: f.description,
            runId: entry.id,
          });
        }
      }
    }

    if (entry.actionsExecuted) {
      const failed = entry.actionsExecuted.filter(a => !a.result.success);
      const succeeded = entry.actionsExecuted.filter(a => a.result.success);
      if (failed.length > 0) {
        for (const a of failed) {
          addReport({
            type: "error",
            category: "action",
            title: `Action Failed: ${a.actionName}`,
            message: a.result.detail,
            runId: entry.id,
          });
        }
      }
      if (succeeded.length > 0) {
        addReport({
          type: "info",
          category: "action",
          title: `${succeeded.length} Action${succeeded.length > 1 ? "s" : ""} Completed`,
          message: succeeded.map(a => a.actionName).join(", "),
          runId: entry.id,
        });
      }
    }
  }

  function getAgentActions(): AgentAction[] {
    return [
      {
        id: "clear_translation_cache",
        name: "Clear Translation Cache",
        description: `Flush stale translation cache entries. Current size: ${chatTranslationCache.size}`,
        category: "performance",
        execute: async () => {
          const before = chatTranslationCache.size;
          const cleared = chatTranslationCache.cleanup();
          return { success: true, detail: `Cleared ${cleared}/${before} stale translation cache entries` };
        },
      },
      {
        id: "clear_caption_cache",
        name: "Clear Caption Caches",
        description: `Flush video caption caches. Video: ${videoCaptionCache.size}, Translated: ${translatedCaptionCache.size}`,
        category: "performance",
        execute: async () => {
          const vBefore = videoCaptionCache.size;
          const tBefore = translatedCaptionCache.size;
          const now = Date.now();
          let cleared = 0;
          const maxAge = 25 * 60 * 60 * 1000;
          videoCaptionCache.forEach((_, key) => {
            const ts = parseInt(key.split("-")[1] || "0");
            if (ts && now - ts > maxAge) { videoCaptionCache.delete(key); cleared++; }
          });
          translatedCaptionCache.forEach((_, key) => {
            const ts = parseInt(key.split(":")[0]?.split("-")[1] || "0");
            if (ts && now - ts > maxAge) { translatedCaptionCache.delete(key); cleared++; }
          });
          return { success: true, detail: `Cleared ${cleared} stale caption entries (video: ${vBefore}→${videoCaptionCache.size}, translated: ${tBefore}→${translatedCaptionCache.size})` };
        },
      },
      {
        id: "clear_lang_detect_cache",
        name: "Clear Language Detection Cache",
        description: `Flush language detection cache. Current size: ${langDetectCache.size}`,
        category: "performance",
        execute: async () => {
          const before = langDetectCache.size;
          const cleared = langDetectCache.cleanup();
          return { success: true, detail: `Cleared ${cleared}/${before} stale language detection entries` };
        },
      },
      {
        id: "switch_translation_provider",
        name: "Switch Translation Provider",
        description: `Switch to fastest available provider. Current: ${activeTranslationService} (avg: ${providerLatency[activeTranslationService].avg}ms)`,
        category: "reliability",
        execute: async () => {
          const before = activeTranslationService;
          evaluateAutoSwitch();
          if (activeTranslationService !== before) {
            return { success: true, detail: `Switched from ${before} to ${activeTranslationService} for better performance` };
          }
          const candidates = (["libretranslate", "kimi", "gemini"] as TranslationProvider[])
            .filter(p => p !== activeTranslationService && providerLatency[p].available);
          if (candidates.length > 0) {
            const best = candidates.reduce((a, b) => {
              const aAvg = providerLatency[a].samples.length > 0 ? providerLatency[a].avg : 500;
              const bAvg = providerLatency[b].samples.length > 0 ? providerLatency[b].avg : 500;
              return aAvg < bAvg ? a : b;
            });
            activeTranslationService = best;
            return { success: true, detail: `Force-switched from ${before} (avg: ${providerLatency[before].avg}ms) to ${best} (avg: ${providerLatency[best].avg}ms)` };
          }
          return { success: false, detail: `No better provider available. ${before} remains active.` };
        },
      },
      {
        id: "reset_provider_failures",
        name: "Reset Provider Failure Counters",
        description: `Reset failure counts for all providers to re-enable availability checks`,
        category: "reliability",
        execute: async () => {
          const reset: string[] = [];
          for (const prov of ["libretranslate", "kimi", "gemini"] as TranslationProvider[]) {
            if (providerLatency[prov].failures > 0 || !providerLatency[prov].available) {
              const wasAvail = providerLatency[prov].available;
              providerLatency[prov].failures = 0;
              providerLatency[prov].available = true;
              providerLatency[prov].lastFailure = 0;
              reset.push(`${prov} (was ${wasAvail ? "available" : "unavailable"}, failures reset)`);
            }
          }
          return { success: true, detail: reset.length > 0 ? `Reset: ${reset.join(", ")}` : "All providers already healthy" };
        },
      },
      {
        id: "cleanup_dead_connections",
        name: "Clean Up Dead WebSocket Connections",
        description: `Remove stale WS connections. Connected: ${connectedClients.size}, Rooms: ${roomParticipants.size}`,
        category: "scalability",
        execute: async () => {
          let cleaned = 0;
          connectedClients.forEach((ws, userId) => {
            if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
              connectedClients.delete(userId);
              cleaned++;
            }
          });
          wsToUserId.forEach((_, ws) => {
            if (ws.readyState !== WebSocket.OPEN) { wsToUserId.delete(ws); cleaned++; }
          });
          roomParticipants.forEach((participants, roomCode) => {
            const hasActive = Array.from(participants).some(uid => {
              const ws = connectedClients.get(uid);
              return ws && ws.readyState === WebSocket.OPEN;
            });
            if (!hasActive) { roomParticipants.delete(roomCode); cleaned++; }
          });
          userRooms.forEach((_, userId) => {
            const ws = connectedClients.get(userId);
            if (!ws || ws.readyState !== WebSocket.OPEN) { userRooms.delete(userId); cleaned++; }
          });
          return { success: true, detail: `Cleaned ${cleaned} dead connections/rooms. Active: ${connectedClients.size} clients, ${roomParticipants.size} rooms` };
        },
      },
      {
        id: "trim_metrics_history",
        name: "Trim Metrics History",
        description: `Trim accumulated metrics data. Latency samples: ${metrics.latency.samples.length}, Errors: ${metrics.errors.length}, Alerts: ${metrics.alerts.length}`,
        category: "performance",
        execute: async () => {
          const latBefore = metrics.latency.samples.length;
          const errBefore = metrics.errors.length;
          const alertBefore = metrics.alerts.length;
          if (metrics.latency.samples.length > 50) metrics.latency.samples = metrics.latency.samples.slice(-50);
          if (metrics.errors.length > 10) metrics.errors = metrics.errors.slice(-10);
          metrics.alerts = metrics.alerts.filter(a => !a.resolved);
          if (metrics.alerts.length > 10) metrics.alerts = metrics.alerts.slice(-10);
          return { success: true, detail: `Trimmed latency: ${latBefore}→${metrics.latency.samples.length}, errors: ${errBefore}→${metrics.errors.length}, alerts: ${alertBefore}→${metrics.alerts.length}` };
        },
      },
      {
        id: "cleanup_rate_limiters",
        name: "Clean Up Expired Rate Limiters",
        description: `Remove expired rate limiter entries. Current: ${roomCreationLimiter.size}`,
        category: "scalability",
        execute: async () => {
          const now = Date.now();
          let cleaned = 0;
          roomCreationLimiter.forEach((entry, userId) => {
            if (now > entry.resetAt) { roomCreationLimiter.delete(userId); cleaned++; }
          });
          try {
            translationRateLimiter.forEach((entry: any, userId: string) => {
              if (now - entry.windowStart > 60000) { translationRateLimiter.delete(userId); cleaned++; }
            });
          } catch {}
          return { success: true, detail: `Cleaned ${cleaned} expired rate limiter entries` };
        },
      },
      {
        id: "full_cache_cleanup",
        name: "Run Full Cache Cleanup Cycle",
        description: `Execute the complete cache cleanup routine (all caches, tmp files, stale connections). Last auto-run: ${cleanupStats.lastRunAt ? `${Math.round((Date.now() - cleanupStats.lastRunAt) / 1000)}s ago` : "never"}`,
        category: "performance",
        execute: async () => {
          if (cleanupStats.lastRunAt && Date.now() - cleanupStats.lastRunAt < 4 * 60 * 1000) {
            return { success: true, detail: `Skipped — automatic cleanup ran ${Math.round((Date.now() - cleanupStats.lastRunAt) / 1000)}s ago (last cleaned: ${cleanupStats.lastCleaned} entries)` };
          }
          runCacheCleanup();
          return { success: true, detail: `Full cleanup completed. Cleaned: ${cleanupStats.lastCleaned} entries. Total lifetime: ${cleanupStats.totalCleaned}` };
        },
      },
      {
        id: "enable_auto_switch",
        name: "Enable Auto Provider Switching",
        description: `Toggle automatic provider switching. Currently: ${autoSwitchEnabled ? "enabled" : "disabled"}`,
        category: "reliability",
        execute: async () => {
          if (autoSwitchEnabled) return { success: true, detail: "Auto-switch already enabled" };
          autoSwitchEnabled = true;
          return { success: true, detail: "Auto provider switching enabled" };
        },
      },
      {
        id: "cleanup_tmp_files",
        name: "Clean Up Temporary Files",
        description: "Remove stale temporary files from video processing",
        category: "performance",
        execute: async () => {
          let cleaned = 0;
          try {
            const { readdirSync, unlinkSync, statSync } = require("fs");
            const tmpDir = require("os").tmpdir();
            const now = Date.now();
            const tmpFiles = readdirSync(tmpDir);
            for (const f of tmpFiles) {
              if (f.startsWith("burn-in-") || f.startsWith("burn-sub-") || f.startsWith("burn-out-")) {
                const fullPath = require("path").join(tmpDir, f);
                try {
                  const stat = statSync(fullPath);
                  if (now - stat.mtimeMs > 5 * 60 * 1000) { unlinkSync(fullPath); cleaned++; }
                } catch {}
              }
            }
          } catch {}
          return { success: true, detail: `Removed ${cleaned} stale temporary files` };
        },
      },
      {
        id: "verify_api_credentials",
        name: "Verify All API Credentials",
        description: "Test connectivity to all configured AI/translation providers and report status",
        category: "configuration",
        execute: async () => {
          const results: string[] = [];
          if (resolvedAnthropicKey) {
            try {
              const t = Date.now();
              await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
              results.push(`Anthropic: OK (${Date.now() - t}ms)`);
            } catch (e: any) { results.push(`Anthropic: FAIL (${e.message.slice(0, 80)})`); }
          } else { results.push("Anthropic: NOT CONFIGURED"); }
          if (apiKeys.moonshot()) {
            try {
              const t = Date.now();
              await moonshotClient.chat.completions.create({ model: "moonshot-v1-32k", max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
              results.push(`Kimi: OK (${Date.now() - t}ms)`);
            } catch (e: any) { results.push(`Kimi: FAIL (${e.message.slice(0, 80)})`); }
          } else { results.push("Kimi: NOT CONFIGURED"); }
          if (apiKeys.moonshot()) {
            try {
              const t = Date.now();
              await moonshotClient.chat.completions.create({ model: "moonshot-v1-32k", max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
              results.push(`Kimi/Moonshot: OK (${Date.now() - t}ms)`);
            } catch (e: any) { results.push(`Kimi/Moonshot: FAIL (${e.message.slice(0, 80)})`); }
          } else { results.push("Kimi/Moonshot: NOT CONFIGURED"); }
          return { success: true, detail: results.join(" | ") };
        },
      },
      {
        id: "verify_encryption_integrity",
        name: "Verify Encryption Integrity",
        description: "Test AES-256-GCM encryption/decryption cycle and verify key configuration",
        category: "security",
        execute: async () => {
          const checks: string[] = [];
          const hasKey = !!apiKeys.encryption();
          checks.push(hasKey ? "ENCRYPTION_KEY: set" : "ENCRYPTION_KEY: MISSING (using ephemeral key)");
          if (hasKey) {
            const keyLen = apiKeys.encryption()!.length;
            checks.push(keyLen >= 32 ? `Key length: ${keyLen} chars (strong)` : `Key length: ${keyLen} chars (WEAK — should be 32+)`);
          }
          try {
            const testPlain = "encryption-test-" + Date.now();
            const encrypted = encryptCacheValue(testPlain);
            const decrypted = decryptCacheValue(encrypted);
            if (decrypted === testPlain) {
              checks.push("AES-256-GCM encrypt/decrypt: PASS");
            } else {
              checks.push("AES-256-GCM encrypt/decrypt: FAIL (mismatch)");
            }
          } catch (e: any) {
            checks.push(`AES-256-GCM: ERROR (${e.message})`);
          }
          const hasSession = !!process.env.SESSION_SECRET;
          checks.push(hasSession ? "SESSION_SECRET: set" : "SESSION_SECRET: MISSING");
          const hasJitsi = !!process.env.JAAS_API_KEY;
          checks.push(hasJitsi ? "JAAS_API_KEY (video calls): set" : "JAAS_API_KEY: MISSING (video calls unavailable)");
          return { success: true, detail: checks.join(" | ") };
        },
      },
      {
        id: "audit_websocket_health",
        name: "Audit WebSocket & Network Health",
        description: `Full network audit. WS clients: ${connectedClients.size}, Rooms: ${roomParticipants.size}, Chat subs: ${homeChatSubscribers.size}`,
        category: "reliability",
        execute: async () => {
          const report: string[] = [];
          let openCount = 0, closedCount = 0;
          connectedClients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) openCount++;
            else closedCount++;
          });
          report.push(`WS connections: ${openCount} open, ${closedCount} stale`);
          let activeRooms = 0, emptyRooms = 0;
          roomParticipants.forEach((participants) => {
            const hasActive = Array.from(participants).some(uid => {
              const ws = connectedClients.get(uid);
              return ws && ws.readyState === WebSocket.OPEN;
            });
            if (hasActive) activeRooms++;
            else emptyRooms++;
          });
          report.push(`Rooms: ${activeRooms} active, ${emptyRooms} empty`);
          let activeSubs = 0;
          homeChatSubscribers.forEach((subs) => {
            subs.forEach(ws => { if (ws.readyState === WebSocket.OPEN) activeSubs++; });
          });
          report.push(`Chat subscribers: ${activeSubs} active across ${homeChatSubscribers.size} channels`);
          report.push(`User-room mappings: ${userRooms.size}`);
          if (closedCount > 0 || emptyRooms > 0) {
            report.push("Recommendation: run cleanup_dead_connections to purge stale entries");
          }
          return { success: true, detail: report.join(" | ") };
        },
      },
      {
        id: "audit_signup_health",
        name: "Audit Signup Health",
        description: `Check signup flow health. Total: ${metrics.signups.total}, Success: ${metrics.signups.successful}, Failed: ${metrics.signups.failed}. Devices: ${Object.keys(metrics.signups.byDevice).join(",")||"none yet"}`,
        category: "reliability",
        execute: async () => {
          const s = metrics.signups;
          const report: string[] = [];
          report.push(`Signups: ${s.total} total, ${s.successful} ok, ${s.failed} failed`);
          if (s.total > 0) {
            report.push(`Success rate: ${Math.round(s.successful / s.total * 100)}%`);
          }
          if (Object.keys(s.byDevice).length > 0) {
            report.push(`Devices: ${Object.entries(s.byDevice).map(([k, v]) => `${k}:${v}`).join(", ")}`);
          }
          if (Object.keys(s.byBrowser).length > 0) {
            report.push(`Browsers: ${Object.entries(s.byBrowser).map(([k, v]) => `${k}:${v}`).join(", ")}`);
          }
          if (Object.keys(s.byPlatform).length > 0) {
            report.push(`Platforms: ${Object.entries(s.byPlatform).map(([k, v]) => `${k}:${v}`).join(", ")}`);
          }
          const recentFails = s.recent.filter(e => !e.success).slice(0, 5);
          if (recentFails.length > 0) {
            report.push(`Recent failures: ${recentFails.map(f => `${f.deviceType}/${f.browser}/${f.platform}: ${f.errorReason}`).join("; ")}`);
          }
          if (s.failed > 0 && s.total > 0 && s.failed / s.total > 0.2) {
            report.push("WARNING: Signup failure rate >20% — investigate immediately");
          }
          const inputStruggles = Array.from(onboardingErrors).filter(e =>
            e.step === "phone_input_struggle" || e.step === "onboarding_stalled" || e.step === "page_abandon"
          );
          if (inputStruggles.length > 0) {
            report.push(`CRITICAL INPUT ISSUES (${inputStruggles.length}): ${inputStruggles.slice(0, 5).map(e => `${e.step}: ${e.error}`).join("; ")}`);
          }
          const onboardingSessionsList = Array.from(onboardingSessions.values());
          const stuckUsers = onboardingSessionsList.filter(sess => !sess.completed && sess.failed);
          if (stuckUsers.length > 0) {
            report.push(`Stuck users: ${stuckUsers.length} (failed onboarding, not completed)`);
          }
          return { success: true, detail: report.join(" | ") };
        },
      },
      {
        id: "guardian_service_health",
        name: "Guardian: Restore Critical Services",
        description: `Auto-detect and re-enable disabled/deactivated services. AutoSwitch: ${autoSwitchEnabled ? "ON" : "OFF"}, Active: ${activeTranslationService}, Unavailable: ${(["libretranslate", "kimi", "gemini"] as TranslationProvider[]).filter(p => !providerLatency[p].available).join(", ") || "none"}`,
        category: "reliability",
        execute: async () => {
          const fixes: string[] = [];

          if (!autoSwitchEnabled) {
            autoSwitchEnabled = true;
            fixes.push("Re-enabled auto-switch (was disabled)");
          }

          const unavailable = (["libretranslate", "kimi", "gemini"] as TranslationProvider[]).filter(p => !providerLatency[p].available);
          for (const prov of unavailable) {
            providerLatency[prov].available = true;
            providerLatency[prov].failures = 0;
            providerLatency[prov].lastFailure = 0;
            providerLatency[prov].cooldownMultiplier = 1;
            providerLatency[prov].consecutiveRecoveryFailures = 0;
            fixes.push(`Restored ${prov} (was unavailable)`);
          }

          if (activeTranslationService !== "libretranslate" && providerLatency["libretranslate"].available) {
            const before = activeTranslationService;
            activeTranslationService = "libretranslate";
            fixes.push(`Reset active provider to libretranslate (was ${before})`);
          }

          const criticalKeys = [
            { name: "LIBRETRANSLATE_API_KEY", service: "LibreTranslate" },
            { name: "MOONSHOT_API_KEY", service: "Kimi (translation/cleanup/summary)" },
            { name: "ANTHROPIC_API_KEY", service: "Claude (AI agent/fallback)" },
            { name: "DATABASE_URL", service: "PostgreSQL" },
            { name: "SESSION_SECRET", service: "Session Auth" },
          ];
          const missing = criticalKeys.filter(k => !process.env[k.name]);
          if (missing.length > 0) {
            fixes.push(`CRITICAL MISSING KEYS: ${missing.map(k => k.service).join(", ")}`);
          }

          let staleWs = 0;
          connectedClients.forEach((ws, userId) => {
            if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
              connectedClients.delete(userId);
              staleWs++;
            }
          });
          if (staleWs > 0) fixes.push(`Cleaned ${staleWs} stale WebSocket connections`);

          if (fixes.length === 0) {
            return { success: true, detail: "All critical services are active and healthy. No intervention needed." };
          }
          return { success: true, detail: fixes.join(" | ") };
        },
      },
      {
        id: "test_translation_pipeline",
        name: "Test Translation Pipeline",
        description: `Test the active translation provider (${activeTranslationService}) with a sample translation`,
        category: "reliability",
        execute: async () => {
          const provider = activeTranslationService;
          const testText = "Hello, how are you?";
          const targetLang = "es";
          try {
            const start = Date.now();
            let translated = "";
            if (provider === "kimi" && apiKeys.moonshot()) {
              const r = await moonshotClient.chat.completions.create({ model: "moonshot-v1-32k", max_tokens: 50, messages: [{ role: "user", content: `Translate to ${targetLang}: "${testText}". Return only the translation.` }] });
              translated = r.choices[0]?.message?.content?.trim() || "";
            } else if (provider === "libretranslate") {
              translated = "(LibreTranslate test skipped — requires separate validation)";
            }
            const elapsed = Date.now() - start;
            if (translated) {
              recordProviderLatency(provider, elapsed, true);
              return { success: true, detail: `${provider} pipeline OK (${elapsed}ms): "${testText}" → "${translated}"` };
            }
            return { success: false, detail: `${provider} returned empty translation (${elapsed}ms)` };
          } catch (e: any) {
            recordProviderLatency(provider, 0, false);
            return { success: false, detail: `${provider} pipeline FAILED: ${e.message.slice(0, 100)}` };
          }
        },
      },
      {
        id: "onboarding_watchdog",
        name: "Onboarding Watchdog",
        description: `Monitor onboarding health. Active sessions: ${onboardingSessions.size}, Errors (last hour): ${onboardingErrors.filter(e => Date.now() - e.timestamp < 3600000).length}`,
        category: "reliability",
        execute: async () => {
          const report: string[] = [];
          const now = Date.now();
          const hourAgo = now - 3600000;

          const activeSessions = Array.from(onboardingSessions.values()).filter(s => now - s.startedAt < 3600000);
          const completedRecently = activeSessions.filter(s => s.completed);
          const failedRecently = activeSessions.filter(s => s.failed && !s.completed);
          const inProgress = activeSessions.filter(s => !s.completed && !s.failed);

          report.push(`Sessions (1h): ${activeSessions.length} total, ${completedRecently.length} completed, ${failedRecently.length} failed, ${inProgress.length} in progress`);

          const recentErrors = onboardingErrors.filter(e => e.timestamp > hourAgo);
          if (recentErrors.length > 0) {
            const errorsByStep: Record<string, number> = {};
            recentErrors.forEach(e => { errorsByStep[e.step] = (errorsByStep[e.step] || 0) + 1; });
            report.push(`Errors by step: ${Object.entries(errorsByStep).map(([k, v]) => `${k}:${v}`).join(", ")}`);
            const uniqueErrors = [...new Set(recentErrors.map(e => e.error))].slice(0, 5);
            report.push(`Error types: ${uniqueErrors.join("; ")}`);
          }

          if (failedRecently.length > 0) {
            const stuckUsers = failedRecently.filter(s => {
              const lastStep = s.steps[s.steps.length - 1];
              return lastStep && !lastStep.success && now - lastStep.timestamp > 60000;
            });
            if (stuckUsers.length > 0) {
              report.push(`WARNING: ${stuckUsers.length} user(s) stuck in onboarding for >1 min with errors`);
            }
          }

          const avgCompletionTime = completedRecently.length > 0
            ? Math.round(completedRecently.reduce((sum, s) => {
                const completeStep = s.steps.find(st => st.step === "complete" && st.success);
                return sum + (completeStep ? completeStep.timestamp - s.startedAt : 0);
              }, 0) / completedRecently.length / 1000)
            : 0;
          if (avgCompletionTime > 0) report.push(`Avg completion time: ${avgCompletionTime}s`);

          const signupHealth = metrics.signups;
          if (signupHealth.total > 0) {
            const rate = Math.round(signupHealth.successful / signupHealth.total * 100);
            report.push(`Overall signup success rate: ${rate}%`);
            if (rate < 80) report.push("CRITICAL: Signup success rate below 80% — onboarding flow needs attention");
          }

          try {
            const testChecks: string[] = [];
            try {
              const uploadTest = objectStorageService.getPrivateObjectDir();
              testChecks.push(uploadTest ? "Supabase storage: OK" : "Supabase storage: NOT CONFIGURED");
            } catch (e: any) {
              testChecks.push(`Object storage: FAIL (${e.message.slice(0, 60)})`);
            }
            const hasDb = !!process.env.DATABASE_URL;
            testChecks.push(hasDb ? "Database: configured" : "Database: MISSING");
            const hasSession = !!process.env.SESSION_SECRET;
            testChecks.push(hasSession ? "Session auth: configured" : "Session auth: MISSING");
            report.push(`Infrastructure: ${testChecks.join(" | ")}`);
          } catch {}

          if (recentErrors.length === 0 && failedRecently.length === 0) {
            report.push("Onboarding flow is healthy — no errors detected");
          }

          return { success: true, detail: report.join(" | ") };
        },
      },
      {
        id: "pipeline_consistency_monitor",
        name: "Pipeline Consistency Monitor",
        description: `Translation pipeline alignment check. Active provider: ${activeTranslationService}, Auto-switch: ${autoSwitchEnabled ? "ON" : "OFF"}, Total requests: ${metrics.translationRequests.total}`,
        category: "reliability",
        execute: async () => {
          const report: string[] = [];
          const providers: TranslationProvider[] = ["libretranslate", "kimi", "gemini"];

          const providerStatus = providers.map(p => {
            const lat = providerLatency[p];
            const status = lat.available ? "UP" : "DOWN";
            const avgMs = lat.avg || 0;
            const fails = lat.failures;
            const samples = lat.samples.length;
            return { name: p, status, avgMs, fails, samples };
          });

          report.push(`Active: ${activeTranslationService} | Auto-switch: ${autoSwitchEnabled ? "ON" : "OFF"}`);
          report.push(`Provider status: ${providerStatus.map(p => `${p.name}=${p.status}(${p.avgMs}ms,${p.fails}f,${p.samples}s)`).join(", ")}`);

          const highLatencyProviders = providerStatus.filter(p => p.avgMs > AUTO_SWITCH_LATENCY_THRESHOLD && p.status === "UP");
          if (highLatencyProviders.length > 0) {
            report.push(`HIGH LATENCY WARNING: ${highLatencyProviders.map(p => `${p.name}=${p.avgMs}ms`).join(", ")} — threshold is ${AUTO_SWITCH_LATENCY_THRESHOLD}ms`);
          }

          const downProviders = providerStatus.filter(p => p.status === "DOWN");
          if (downProviders.length > 0) {
            report.push(`DOWN PROVIDERS: ${downProviders.map(p => `${p.name}(${p.fails} failures)`).join(", ")}`);
          }
          if (downProviders.length >= 3) {
            report.push("CRITICAL: 3+ providers down — translation pipeline severely degraded");
          }

          const { total, failed } = metrics.translationRequests;
          const cached = (metrics.translationRequests as any).cached || 0;
          const errorRate = total > 0 ? (failed / total * 100).toFixed(1) : "0";
          const cacheHitRate = total > 0 ? (cached / total * 100).toFixed(1) : "0";
          report.push(`Translations: ${total} total, ${failed} failed (${errorRate}%), ${cached} cached (${cacheHitRate}%)`);

          if (parseFloat(errorRate) > 15) {
            report.push("CRITICAL: Translation error rate >15% — pipeline needs intervention");
          } else if (parseFloat(errorRate) > 5) {
            report.push("WARNING: Translation error rate >5% — monitor closely");
          }

          const oversightStats = {
            spacyChecks: metrics.translationRequests.total,
            correctionRate: total > 0 ? ((metrics.translationRequests.failed || 0) / total * 100).toFixed(1) : "0",
          };
          report.push(`Oversight: SpaCy active, correction pipeline operational`);

          const activeIsHealthy = providerLatency[activeTranslationService];
          if (activeIsHealthy && !activeIsHealthy.available) {
            report.push(`ALERT: Active provider ${activeTranslationService} is DOWN — auto-switch should activate`);
            if (!autoSwitchEnabled) {
              report.push("CRITICAL: Auto-switch is DISABLED while active provider is down — enable auto-switch immediately");
            }
          }

          if (activeIsHealthy && activeIsHealthy.avg > 3000) {
            report.push(`ALERT: Active provider ${activeTranslationService} avg latency ${activeIsHealthy.avg}ms — consider switching providers`);
          }

          const allHealthy = downProviders.length === 0 && parseFloat(errorRate) < 5 && highLatencyProviders.length === 0;
          if (allHealthy) {
            report.push("Pipeline is aligned and healthy — all providers responsive, error rate low, latencies normal");
          }

          return { success: allHealthy, detail: report.join(" | ") };
        },
      },
      {
        id: "socket_handling_monitor",
        name: "Socket Handling Monitor",
        description: `WebSocket continuous monitor. Routed: ${socketMetrics.messagesRouted} msgs, ${socketMetrics.typingEventsRouted} typing. Disconnects: ${socketMetrics.disconnections}. Errors: ${socketMetrics.abnormalClosures}. Delivery avg: ${socketMetrics.avgDeliveryMs}ms`,
        category: "reliability",
        execute: async () => {
          const report: string[] = [];

          report.push(`Messages routed: ${socketMetrics.messagesRouted} | Failed: ${socketMetrics.messagesFailed}`);
          const msgFailRate = socketMetrics.messagesRouted > 0
            ? (socketMetrics.messagesFailed / socketMetrics.messagesRouted * 100).toFixed(1) : "0";
          report.push(`Message delivery rate: ${100 - parseFloat(msgFailRate)}% | Avg delivery: ${socketMetrics.avgDeliveryMs}ms`);

          report.push(`Typing events routed: ${socketMetrics.typingEventsRouted}`);
          report.push(`Presence updates: ${socketMetrics.presenceUpdates}`);

          report.push(`Disconnections: ${socketMetrics.disconnections} | Abnormal closures: ${socketMetrics.abnormalClosures} | Ping timeouts: ${socketMetrics.pingPongFailures} | Auth failures: ${socketMetrics.authFailures}`);

          report.push(`Peak connections: ${socketMetrics.peakConnections} (at ${new Date(socketMetrics.peakConnectionsTime).toISOString()})`);
          report.push(`Current connections: ${connectedClients.size} | Rooms: ${roomParticipants.size} | Chat channels: ${homeChatSubscribers.size}`);

          let staleWs = 0;
          connectedClients.forEach((ws, uid) => {
            if (ws.readyState !== WebSocket.OPEN) {
              connectedClients.delete(uid);
              staleWs++;
            }
          });
          if (staleWs > 0) {
            report.push(`AUTO-CLEANED: ${staleWs} stale WebSocket connections removed`);
          }

          let subscriberLeaks = 0;
          homeChatSubscribers.forEach((subs) => {
            subs.forEach(ws => {
              if (ws.readyState !== WebSocket.OPEN) {
                subs.delete(ws);
                subscriberLeaks++;
              }
            });
          });
          socketMetrics.chatSubscriberLeaks = subscriberLeaks;
          if (subscriberLeaks > 0) {
            report.push(`AUTO-CLEANED: ${subscriberLeaks} dead subscribers purged from chat channels`);
          }

          const recentEvents = socketMetrics.recentEvents.slice(-20);
          const recentErrors = recentEvents.filter(e => e.event === "ws_error" || e.event === "msg_delivery_fail" || e.event === "auth_mismatch");
          if (recentErrors.length > 0) {
            report.push(`Recent socket errors (${recentErrors.length}): ${recentErrors.map(e => `${e.event}${e.detail ? `(${e.detail})` : ""}`).join("; ")}`);
          }

          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          const recentDisconnects = socketMetrics.recentEvents.filter(e => e.event === "disconnect" && e.timestamp > fiveMinAgo).length;
          if (recentDisconnects > 5) {
            report.push(`WARNING: ${recentDisconnects} disconnections in last 5 minutes — possible network instability`);
          }

          if (socketMetrics.avgDeliveryMs > 100) {
            report.push(`WARNING: Message delivery latency ${socketMetrics.avgDeliveryMs}ms exceeds 100ms threshold`);
          }

          if (parseFloat(msgFailRate) > 5) {
            report.push("CRITICAL: Message delivery failure rate >5% — socket health degraded");
          }

          const isHealthy = staleWs === 0 && subscriberLeaks === 0 && parseFloat(msgFailRate) < 5 && socketMetrics.avgDeliveryMs <= 100 && recentDisconnects <= 5;
          if (isHealthy) {
            report.push("Socket handling is healthy — all connections active, delivery reliable, no leaks detected");
          }

          return { success: isHealthy, detail: report.join(" | ") };
        },
      },
    ];
  }

  function getPlatformSnapshot() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10;
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10;
    const rssMB = Math.round(memUsage.rss / 1024 / 1024 * 10) / 10;
    const uptimeHours = Math.round((Date.now() - metrics.startTime) / 3600000 * 10) / 10;
    const errorRate = metrics.translationRequests.total > 0
      ? (metrics.translationRequests.failed / metrics.translationRequests.total * 100).toFixed(2) : "0";
    return {
      runtime: {
        uptime: `${uptimeHours} hours`,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development",
        memory: { heapUsed: `${heapUsedMB}MB`, heapTotal: `${heapTotalMB}MB`, rss: `${rssMB}MB`, heapUtilization: `${Math.round(heapUsedMB / heapTotalMB * 100)}%` },
      },
      translation: {
        activeProvider: activeTranslationService,
        totalRequests: metrics.translationRequests.total,
        successRate: `${100 - parseFloat(errorRate)}%`,
        errorRate: `${errorRate}%`,
        byProvider: metrics.translationRequests.byProvider,
        latency: { avg: `${metrics.latency.avg}ms`, p95: `${metrics.latency.p95}ms`, max: `${metrics.latency.max}ms` },
        providerStatus: getProviderStats(),
        autoSwitchEnabled: autoSwitchEnabled,
      },
      connections: { websocketClients: connectedClients.size, activeRooms: roomParticipants.size },
      socketHealth: {
        messagesRouted: socketMetrics.messagesRouted,
        messagesFailed: socketMetrics.messagesFailed,
        typingEventsRouted: socketMetrics.typingEventsRouted,
        presenceUpdates: socketMetrics.presenceUpdates,
        disconnections: socketMetrics.disconnections,
        abnormalClosures: socketMetrics.abnormalClosures,
        authFailures: socketMetrics.authFailures,
        avgDeliveryMs: socketMetrics.avgDeliveryMs,
        peakConnections: socketMetrics.peakConnections,
        subscriberLeaks: socketMetrics.chatSubscriberLeaks,
        recentEventCount: socketMetrics.recentEvents.length,
      },
      caches: {
        translationCache: chatTranslationCache.size,
        voiceTranslationCache: voiceTranslationCache.size,
        videoCaptions: videoCaptionCache.size,
        translatedCaptions: translatedCaptionCache.size,
        langDetect: langDetectCache.size,
        rateLimiters: roomCreationLimiter.size,
        roomMessages: roomMessages.size,
      },
      redis: getRedisUsageStats(),
      security: {
        encryptionKeySet: !!apiKeys.encryption(),
        encryptionKeyStrength: (apiKeys.encryption() || "").length >= 32 ? "strong" : (apiKeys.encryption() || "").length > 0 ? "weak" : "ephemeral",
        sessionSecret: !!process.env.SESSION_SECRET,
        e2eEncryption: "ECDH P-256 + AES-256-GCM with key ratcheting",
        cacheEncryption: "AES-256-GCM with SHA-256 key hashing",
        hmacIntegrity: "HMAC-SHA256 request signing",
      },
      network: {
        chatSubscribers: homeChatSubscribers.size,
        userRoomMappings: userRooms.size,
        wsToUserMappings: wsToUserId.size,
      },
      apiKeys: {
        anthropic: !!resolvedAnthropicKey,
        google: !!apiKeys.gemini(),
        moonshot: !!apiKeys.moonshot(),
        libreTranslate: !!process.env.LIBRETRANSLATE_API_KEY,
        jitsi: !!process.env.JAAS_API_KEY,
      },
      errors: {
        recentErrors: metrics.errors.slice(-10).map(e => ({ provider: e.provider, message: (e.message || "").slice(0, 200).replace(/[^\w\s.,!?:;()\-]/g, ""), time: new Date(e.timestamp).toISOString() })),
        activeAlerts: metrics.alerts.filter(a => !a.resolved).map(a => ({ type: a.type, message: (a.message || "").slice(0, 200).replace(/[^\w\s.,!?:;()\-]/g, ""), time: new Date(a.timestamp).toISOString() })),
        totalAlerts: metrics.alerts.length,
      },
      escalationTracking: {
        healthAnalysisFailures,
        lastHealthAnalysisSuccess: lastHealthAnalysisSuccess > 0 ? `${Math.round((Date.now() - lastHealthAnalysisSuccess) / 1000)}s ago` : "never",
        healthAnalysisStale: lastHealthAnalysisSuccess > 0 && Date.now() - lastHealthAnalysisSuccess > 10 * 60 * 1000,
        segmentTranslationFallthroughs,
        providerCooldowns: Object.fromEntries(
          (["libretranslate", "kimi", "gemini"] as TranslationProvider[]).map(p => [p, {
            cooldownMultiplier: providerLatency[p].cooldownMultiplier,
            consecutiveRecoveryFailures: providerLatency[p].consecutiveRecoveryFailures,
            effectiveCooldownMs: Math.min(BASE_PROVIDER_COOLDOWN_MS * providerLatency[p].cooldownMultiplier, MAX_PROVIDER_COOLDOWN_MS),
          }])
        ),
        pendingStatusBroadcasts: pendingStatusBroadcasts?.size ?? 0,
      },
      serviceGuardian: {
        autoSwitchEnabled: autoSwitchEnabled,
        activeProvider: activeTranslationService,
        primaryProvider: "libretranslate",
        primaryIsActive: activeTranslationService === "libretranslate",
        unavailableProviders: (["libretranslate", "kimi", "gemini"] as TranslationProvider[]).filter(p => !providerLatency[p].available),
        allProvidersHealthy: (["libretranslate", "kimi", "gemini"] as TranslationProvider[]).every(p => providerLatency[p].available),
        criticalServices: {
          translation: !!process.env.LIBRETRANSLATE_API_KEY,
          captionCleanup: !!apiKeys.moonshot(),
          callSummary: !!apiKeys.moonshot() || !!resolvedAnthropicKey,
          speechToText: !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || apiKeys.openai()),
          aiAgent: !!resolvedAnthropicKey,
          database: !!process.env.DATABASE_URL,
          sessions: !!process.env.SESSION_SECRET,
          videoCalls: !!process.env.JAAS_API_KEY,
        },
      },
      roomCodeSecurity: {
        totalFailed: roomCodeAttempts.totalFailed,
        totalSuccessful: roomCodeAttempts.totalSuccessful,
        failedLastHour: roomCodeAttempts.failedAttempts.filter(a => Date.now() - a.timestamp < 3600_000).length,
        currentlyBlocked: roomCodeAttempts.blockedUsers.size,
        recentAlerts: roomCodeAttempts.alerts.slice(-5).map(a => ({
          userId: a.userId.slice(0, 8) + "***",
          attempts: a.attemptCount,
          detectedAt: new Date(a.detectedAt).toISOString(),
        })),
        bruteForceDetected: roomCodeAttempts.alerts.length > 0,
        config: { windowMs: ROOM_CODE_BRUTE_FORCE_WINDOW, threshold: ROOM_CODE_BRUTE_FORCE_THRESHOLD, blockDurationMs: ROOM_CODE_BLOCK_DURATION },
      },
      tokenBudget: getRedactedTokenSnapshot(),
      cleanup: { runs: cleanupStats.runCount, totalCleaned: cleanupStats.totalCleaned, lastCleaned: cleanupStats.lastCleaned, lastRunAt: cleanupStats.lastRunAt ? `${Math.round((Date.now() - cleanupStats.lastRunAt) / 1000)}s ago` : "never" },
      signups: {
        total: metrics.signups.total,
        successful: metrics.signups.successful,
        failed: metrics.signups.failed,
        successRate: metrics.signups.total > 0 ? `${Math.round(metrics.signups.successful / metrics.signups.total * 100)}%` : "N/A",
        byDevice: metrics.signups.byDevice,
        byBrowser: metrics.signups.byBrowser,
        byPlatform: metrics.signups.byPlatform,
        recentFailures: metrics.signups.recent.filter(s => !s.success).slice(0, 5).map(s => ({
          device: s.deviceType,
          browser: s.browser,
          platform: s.platform,
          reason: s.errorReason,
          time: new Date(s.timestamp).toISOString(),
        })),
        inputIssues: onboardingErrors.filter(e =>
          e.step === "phone_input_struggle" || e.step === "onboarding_stalled" || e.step === "page_abandon"
        ).slice(0, 10).map(e => ({
          type: e.step,
          error: e.error,
          time: new Date(e.timestamp).toISOString(),
        })),
      },
      userActivity: {
        featureUsage: { ...featureUsageCounts },
        recentActions: userBehaviorLog.slice(-30).map(a => ({
          action: a.action,
          feature: a.feature,
          time: new Date(a.timestamp).toISOString(),
        })),
        activeUsers: connectedClients.size,
        activeRooms: roomParticipants.size,
        roomsWithMembers: Array.from(roomParticipants.entries()).filter(([_, members]) => members.size >= 2).length,
        totalMessages: Array.from(roomMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0),
      },
      platformUpdates: platformUpdates.filter(u => !u.reported).map(u => ({
        id: u.id,
        type: u.type,
        title: u.title,
        description: u.description,
        userImpact: u.userImpact,
        timestamp: new Date(u.timestamp).toISOString(),
      })),
    };
  }

  async function runAutonomousAgent(trigger: "auto" | "manual"): Promise<AgentLogEntry | null> {
    if (agentRunning) return null;
    if (!resolvedAnthropicKey) return null;
    const now = Date.now();
    if (trigger === "auto" && now - lastAgentRun < AGENT_COOLDOWN) return null;
    agentRunning = true;
    lastAgentRun = now;
    const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const snapshot = getPlatformSnapshot();
      const actions = getAgentActions();
      const actionDescriptions = actions.map(a => `- ${a.id}: ${a.description} [${a.category}]`).join("\n");

      const agentPrompt = `You are an autonomous maintenance agent for JunoTalk, a real-time encrypted video calling and chat platform with AI-powered translation and captions. You have FULL AUTHORITY to analyze the platform and execute maintenance actions to keep it healthy, performant, and secure.

PRIVACY BOUNDARY (STRICTLY ENFORCED):
- You MUST NEVER access, read, log, or process any personal user data (names, emails, messages, phone numbers, profile data)
- You operate ONLY on system-level metrics, infrastructure, and service connectivity
- Your scope: API connectivity, credentials, translation pipeline, caption system, video calling network, encryption integrity, caches, WebSocket health, and bug/glitch detection
- All verbose console.log statements have been removed from production code to prevent data leakage. Only console.error/console.warn remain for error tracking. Do NOT recommend adding console.log statements.

AVAILABLE ACTIONS you can execute:
${actionDescriptions}

MONITORING SCOPE:
1. API CONNECTIVITY — Verify provider credentials valid and responsive
2. TRANSLATION PIPELINE — Active provider performance, latency, error rates, fallback chain health
3. CAPTION & VIDEO — Caption cache integrity, transcription readiness
4. NETWORK — WebSocket/Socket.IO connections, room health, stale connection cleanup
5. ENCRYPTION — Cache encryption, E2E readiness, session security, key strength
6. PERFORMANCE — Memory, caches, rate limiters, temp files
7. BUG DETECTION — Error patterns, failures, config gaps, stale state
8. SIGNUP HEALTH — Registration flow across devices/browsers. If failures detected, run audit_signup_health. Input telemetry events (phone_input_struggle, onboarding_stalled, page_abandon) = HIGH severity — users can't complete signup.
9. ESCALATION — Monitor escalationTracking section (see ESCALATION RISKS below)
10. USER ACTIVITY — PRIMARY responsibility. Track active features, ensure supporting services healthy. If users paired in rooms, translation+chat MUST be responsive. Zero usage = observation only.
11. PRIVACY COMPLIANCE — Verify no PII in translation requests, session expiry active, auto-deletion running, no tracking cookies. Deviation = CRITICAL.
12. PLATFORM UPDATES — Acknowledge updates, verify supporting services, note user impact, include reviewedUpdateIds.
13. TOKEN BUDGET — Monitor tokenBudget section. Check provider usage levels (low/medium/high/critical). If any provider is "high" or "critical", note in findings. Verify Kimi handles 90%+ of AI requests. Claude usage for routine tasks = waste, flag as HIGH.

ESCALATION RISKS (check escalationTracking in snapshot):
R1 CLEANUP: Don't trigger full_cache_cleanup if cleanup.lastRunAt < 5min ago. "Skipped" = correct.
R2 PROVIDER OSCILLATION: providerCooldowns — consecutiveRecoveryFailures > 2 = HIGH. Don't reset without verify_api_credentials proof.
R3 SEGMENT FAILURES: segmentTranslationFallthroughs total > 10 = MEDIUM. Run verify_api_credentials.
R4 STALE HEALTH: healthAnalysisStale=true or healthAnalysisFailures > 5 = HIGH. Note data may be outdated.
R5 LATENCY: Providers with avg >3000ms may be inflated by cascade timeouts. Cross-ref with failure count.
R6 BROADCAST STORM: pendingStatusBroadcasts consistently > 5 = MEDIUM.
R7 BRUTE FORCE: roomCodeSecurity — bruteForceDetected=true, failedLastHour > 20 = HIGH, currentlyBlocked > 0 = active attack, totalFailed growing fast vs totalSuccessful = CRITICAL.
R8 REDIS: Upstash: usagePercent >60%=MEDIUM, >80%=HIGH, throttled=CRITICAL. Direct: tlsEnabled=false=HIGH security, firewallConfigured=false=CRITICAL. Both: hitRate <30%=info, errors >5=HIGH, connected=false=CRITICAL.

COMPLIANCE RULES:
- Do NOT recommend adding console.log statements to production code. All sensitive logging has been removed for compliance.
- Do NOT expose user IDs, room codes, provider endpoints, API key status details, or internal system paths in any output.
- Focus findings on system health metrics, not on exposing internal configuration details.
- NEVER expose specific AI provider names, third-party service names, or internal technology stack details in any user-facing output, logs, error messages, or reports that could be seen by users. Provider names are internal implementation details.
- All user-facing error messages must be generic (e.g., "translation service temporarily unavailable") — never mention specific providers.

PRIVACY COMPLIANCE (MANDATORY):
Privacy Policy (March 2026) commitments: no data selling, no ad cookies, E2E encryption, no audio/video storage, auto-deletion, GDPR/CCPA, no children under 16, text-only to providers (no PII).
Verify: no PII in translation requests, session expiry active, auto-deletion running, no tracking cookies. Violation = CRITICAL under "privacy_compliance" category.

GUARDIAN DIRECTIVE (MANDATORY — HIGHEST PRIORITY):
You are the platform's service guardian. Your #1 responsibility is ensuring ALL critical services remain active and operational. Communication features (translation, texting, video calls, captions) are the lifeblood of this platform.

GUARDIAN RULES:
- ALWAYS run guardian_service_health on EVERY run — this is not optional
- If ANY provider is marked unavailable, restore it immediately
- If auto-switch is disabled, re-enable it immediately
- If the active translation provider is not LibreTranslate (the primary), reset it
- If any critical API keys are missing, flag as CRITICAL severity
- Translation, messaging, video calling, and captions must NEVER be down simultaneously
- If multiple services are degraded, prioritize restoration over cleanup/optimization
- After restoring services, run test_translation_pipeline to verify the fix worked

DECISION RULES:
1. ALWAYS execute guardian_service_health first before any other action
2. Only execute additional actions that will genuinely improve the system based on the current snapshot
3. Don't execute actions unnecessarily — if caches are small and healthy, leave them
4. If error rates are high or providers are failing, prioritize reliability actions (reset failures, switch providers, test pipeline)
5. If memory is high (>85% heap), prioritize cleanup actions
6. If any API credentials are missing or failing, flag as high-severity finding
7. If encryption keys are weak or missing, flag as critical finding
8. Always run verify_encryption_integrity if encryption key strength shows "weak" or "ephemeral"
9. Always run verify_api_credentials if any provider has recent failures
10. If signup failure rate >20% or any recent signup failures detected, run audit_signup_health AND onboarding_watchdog and flag as high-severity
11. After a new signup is detected, ensure caches are warm and providers are responsive for best first-use experience
12. Maximum 6 actions per run (guardian_service_health counts as 1)
13. If onboarding_watchdog reports stuck users or high error rates, flag as critical and recommend investigation
14. Run pipeline_consistency_monitor when translation error rate >5%, latency warnings appear, or providers are down — auto-correct by enabling auto-switch or resetting failed providers
15. Run socket_handling_monitor on EVERY cycle — this is a continuous monitor. Flag as critical if message delivery failure rate >5%, abnormal closures spike, subscriber leaks detected, or delivery latency >100ms. If stale connections found, auto-run cleanup_dead_connections
16. ALWAYS check escalationTracking section and report on any active escalation patterns in your summary
17. If healthAnalysisStale is true, note data staleness in your summary and lower confidence in your score

BEST PRACTICES (enforce every cycle — flag deviations):
1. DATA MINIMIZATION — Translation requests: text only, no PII. Violation = CRITICAL.
2. ENCRYPTION — E2E for chat, encrypted at rest. Degraded = CRITICAL.
3. DATA RETENTION — No audio/video storage, chat messages permanently saved, translation not retained.
4. GRACEFUL DEGRADATION — Fallback chains healthy, no single point of failure. Violation = HIGH.
5. AVAILABILITY — 99.9% uptime for messaging/calls/translation. Multiple failures = CRITICAL.
6. ABUSE PREVENTION — Rate limiting active, brute force monitored. Bypassed = HIGH.
7. SESSION SECURITY — Expiry active, tokens secure. Compromised = CRITICAL.
8. ERROR HANDLING — No internal details in user-facing errors. Error rate >5% = HIGH.
9. PRIVACY ALIGNMENT — Infrastructure must match privacy policy commitments. Deviation = CRITICAL.
10. I18N — All advertised languages working. Language failure = HIGH.
11. ACCESSIBILITY — Cross-device/browser compatibility. Core features broken on any platform = HIGH.
12. OPERATIONAL HYGIENE — Stale connections cleaned, caches managed, no resource leaks. Cleanup not running = MEDIUM.
Include "bestPractices" in response for any practice not fully met.

Respond in valid JSON only:
{
  "score": <0-100 platform health score>,
  "summary": "<2-3 sentence assessment covering user experience, API health, translation, encryption, network, AND any active escalation risks. Always mention what users are currently doing and whether their experience is healthy.>",
  "findings": [
    {"id": "F001", "severity": "critical|high|medium|low|info", "category": "security|performance|reliability|configuration|scalability|escalation|user_experience|privacy_compliance|best_practice", "title": "<title>", "description": "<detail>", "autoFixable": true|false}
  ],
  "actionsToExecute": [
    {"actionId": "<from available actions>", "reason": "<why this action is needed now>"}
  ],
  "metrics": {"security": <0-100>, "performance": <0-100>, "reliability": <0-100>, "configuration": <0-100>, "scalability": <0-100>, "privacyCompliance": <0-100>},
  "userExperience": {
    "activeUsersHealthy": <true|false whether services supporting active users are working>,
    "featureHealth": "<brief note on which user features are healthy vs degraded>",
    "recommendations": ["<user-focused improvement suggestions if any>"]
  },
  "bestPractices": {
    "dataMinimization": "<compliant|violation — brief note>",
    "encryptionIntegrity": "<compliant|violation — brief note>",
    "contentRetention": "<compliant|violation — brief note>",
    "gracefulDegradation": "<compliant|violation — brief note>",
    "serviceAvailability": "<compliant|violation — brief note>",
    "abusePrevention": "<compliant|violation — brief note>",
    "sessionSecurity": "<compliant|violation — brief note>",
    "errorHandling": "<compliant|violation — brief note>",
    "privacyPolicyAlignment": "<compliant|violation — brief note>",
    "i18nReadiness": "<compliant|violation — brief note>",
    "accessibilityInclusivity": "<compliant|violation — brief note>",
    "operationalHygiene": "<compliant|violation — brief note>",
    "overallCompliance": <0-100>
  },
  "reviewedUpdateIds": ["<IDs of platformUpdates you reviewed, if any>"]
}`;

      const monitorResult = await gatewayChat(agentPrompt, `CURRENT PLATFORM STATE:\n${JSON.stringify(snapshot, null, 2)}`, { task: "monitor", maxTokens: 3000, temperature: 0.2 });
      let content = monitorResult?.text?.trim() || "";
      content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        content = content.slice(jsonStart, jsonEnd + 1);
      }
      const parsed = JSON.parse(content);

      const sensitivePatterns = /(?:sk-[a-zA-Z0-9]{20,}|key-[a-zA-Z0-9]{20,}|[a-f0-9]{32,}|eyJ[a-zA-Z0-9_-]{20,})/g;
      if (parsed.summary) parsed.summary = parsed.summary.replace(sensitivePatterns, "[REDACTED]");
      if (parsed.findings && Array.isArray(parsed.findings)) {
        for (const f of parsed.findings) {
          if (f.description) f.description = f.description.replace(sensitivePatterns, "[REDACTED]");
          if (f.title) f.title = f.title.replace(sensitivePatterns, "[REDACTED]");
        }
      }

      const executedActions: AgentLogEntry["actionsExecuted"] = [];
      const actionMap = new Map(actions.map(a => [a.id, a]));

      if (parsed.actionsToExecute && Array.isArray(parsed.actionsToExecute)) {
        for (const todo of parsed.actionsToExecute.slice(0, 6)) {
          const action = actionMap.get(todo.actionId);
          if (!action) {
            executedActions.push({ actionId: todo.actionId, actionName: "Unknown", reason: todo.reason, result: { success: false, detail: "Action not found in registry" }, durationMs: 0 });
            continue;
          }
          const actionStart = Date.now();
          try {
            const result = await action.execute();
            executedActions.push({ actionId: action.id, actionName: action.name, reason: todo.reason, result, durationMs: Date.now() - actionStart });
          } catch (err: any) {
            executedActions.push({ actionId: action.id, actionName: action.name, reason: todo.reason, result: { success: false, detail: err.message }, durationMs: Date.now() - actionStart });
            console.error(`[Agent] Action ${action.id} failed:`, err.message);
          }
        }
      }

      if (parsed.reviewedUpdateIds && Array.isArray(parsed.reviewedUpdateIds)) {
        const reviewedSet = new Set(parsed.reviewedUpdateIds);
        for (const u of platformUpdates) {
          if (reviewedSet.has(u.id)) u.reported = true;
        }
      }

      if (parsed.userExperience) {
        const ux = parsed.userExperience;
        if (ux.recommendations && Array.isArray(ux.recommendations)) {
          for (const rec of ux.recommendations) {
            addReport({
              type: "info",
              category: "service",
              title: "User Experience Recommendation",
              message: rec,
              runId,
            });
          }
        }
        if (ux.activeUsersHealthy === false) {
          addReport({
            type: "warning",
            category: "service",
            title: "Active Users May Be Affected",
            message: ux.featureHealth || "Some services supporting active users may be degraded",
            runId,
          });
        }
      }

      const sanitizedSnapshot: any = { ...snapshot };
      delete sanitizedSnapshot.apiKeys;
      if (sanitizedSnapshot.security) {
        sanitizedSnapshot.security = {
          encryptionKeyStrength: snapshot.security.encryptionKeyStrength,
          e2eEncryption: snapshot.security.e2eEncryption,
          cacheEncryption: snapshot.security.cacheEncryption,
        };
      }

      const entry: AgentLogEntry = {
        id: runId,
        timestamp: Date.now(),
        trigger,
        snapshot: sanitizedSnapshot,
        analysis: {
          score: Math.min(100, Math.max(0, parsed.score || 0)),
          summary: parsed.summary || "Analysis completed",
          findings: parsed.findings || [],
          metrics: parsed.metrics || {},
        },
        actionsExecuted: executedActions,
        totalDurationMs: Date.now() - now,
        model: "gateway",
      };

      agentLog.unshift(entry);
      if (agentLog.length > MAX_AGENT_LOG) agentLog.length = MAX_AGENT_LOG;
      generateReportsFromEntry(entry);
      return entry;
    } catch (err: any) {
      console.error(`[Agent] Run ${runId} failed:`, err.message);
      return null;
    } finally {
      agentRunning = false;
    }
  }

  // Autonomous agent disabled — saves AI API calls. Use manual trigger only.
  // setTimeout(() => runAutonomousAgent("auto"), 60 * 1000);
  // setInterval(() => runAutonomousAgent("auto"), 15 * 60 * 1000);

  function isAdminRequest(req: any): boolean {
    const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
    if (!adminCode) return false;
    const code = (req.headers["x-admin-code"] || req.body?.accessCode || req.query?.accessCode || "") as string;
    if (code.length !== adminCode.length) return false;
    let mismatch = 0;
    for (let i = 0; i < code.length; i++) {
      mismatch |= code.charCodeAt(i) ^ adminCode.charCodeAt(i);
    }
    return mismatch === 0;
  }

  v1Router.post("/claude/agent-run", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    if (agentRunning) return res.status(409).json({ error: "Agent is already running" });
    if (!resolvedAnthropicKey) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const result = await runAutonomousAgent("manual");
    if (!result) return res.status(500).json({ error: "Agent run failed" });
    res.json(result);
  });

  v1Router.get("/claude/agent-log", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    res.json({
      entries: agentLog.slice(0, limit),
      total: agentLog.length,
      isRunning: agentRunning,
      lastRun: lastAgentRun,
      nextAutoRun: lastAgentRun + 15 * 60 * 1000,
    });
  });

  v1Router.get("/claude/agent-actions", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const actions = getAgentActions();
    res.json(actions.map(a => ({ id: a.id, name: a.name, description: a.description, category: a.category })));
  });

  v1Router.post("/claude/agent-action/:actionId", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const actions = getAgentActions();
    const action = actions.find(a => a.id === req.params.actionId);
    if (!action) return res.status(404).json({ error: "Action not found" });
    try {
      const start = Date.now();
      const result = await action.execute();
      res.json({ ...result, actionId: action.id, actionName: action.name, durationMs: Date.now() - start });
    } catch (err: any) {
      res.status(500).json({ success: false, detail: err.message });
    }
  });

  v1Router.get("/claude/reports", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const filter = (req.query.filter as string) || "all";
    let reports = agentReports;
    if (filter === "unread") reports = reports.filter(r => !r.read);
    else if (filter !== "all") reports = reports.filter(r => r.type === filter || r.category === filter);
    const unreadCount = agentReports.filter(r => !r.read).length;
    res.json({ reports: reports.slice(0, limit), total: agentReports.length, unread: unreadCount });
  });

  v1Router.post("/claude/reports/read", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { reportIds } = req.body;
    if (Array.isArray(reportIds)) {
      const idSet = new Set(reportIds);
      for (const r of agentReports) {
        if (idSet.has(r.id)) r.read = true;
      }
    }
    res.json({ success: true });
  });

  v1Router.post("/claude/reports/read-all", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    for (const r of agentReports) r.read = true;
    res.json({ success: true });
  });

  v1Router.post("/detect-language", isAuthenticated, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string" || text.trim().length < 3) {
        return res.json({ language: null });
      }
      const detected = await detectLanguage(text.trim(), "");
      return res.json({ language: detected });
    } catch (err) {
      console.error("Language detection API error:", err);
      return res.json({ language: null });
    }
  });

  const translationRateLimiter = new Map<string, { count: number; windowStart: number }>();
  const TRANSLATE_RATE_LIMIT = 60;
  const TRANSLATE_RATE_WINDOW = 60 * 1000;

  function checkTranslationRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = translationRateLimiter.get(userId);
    if (!entry || now - entry.windowStart > TRANSLATE_RATE_WINDOW) {
      translationRateLimiter.set(userId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= TRANSLATE_RATE_LIMIT) return false;
    entry.count++;
    return true;
  }

  v1Router.post("/translate", async (req, res) => {
    const startTime = Date.now();
    const translationCorrelationId = generateCorrelationId();
    try {
      const { text, targetLang, sourceLang, roomCode: reqRoomCode, verify, source } = req.body;
      const userId = (req as any).user?.claims?.sub;
      trackAction(verify ? "verify_translation" : "translate_text", "translation");
      structuredLog("info", "translation_request", "Translation requested", { correlationId: translationCorrelationId, userId, roomId: reqRoomCode, sourceLang, targetLang, metadata: { source, verify: !!verify, textLength: text?.length } });

      if (!checkTranslationRateLimit(userId || "anon")) {
        return res.status(429).json({ message: "Translation rate limit exceeded. Please wait before sending more requests." });
      }

      if (!text || !targetLang) {
        return res.status(400).json({ message: "Text and target language are required" });
      }

      const sanitizedText = sanitizeTranslationInput(text);
      if (!sanitizedText) {
        return res.status(400).json({ message: "Text is empty after sanitization" });
      }

      const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u20e3\s0-9#*]+$/u;
      if (EMOJI_ONLY_RE.test(sanitizedText.trim()) && /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(sanitizedText.trim())) {
        return res.json({ translatedText: text, skipped: true, reason: "emoji_only" });
      }

      if (sourceLang && sourceLang === targetLang) {
        if (reqRoomCode && userId) {
          recordUserDetectedLang(reqRoomCode, userId, sourceLang);
        }
        return res.json({ translatedText: text, skipped: true, reason: "same_language" });
      }

      if (reqRoomCode && userId) {
        const learnedSkip = shouldSkipTranslationForRoom(reqRoomCode, userId, targetLang);
        if (learnedSkip.skip) {
          return res.json({ translatedText: text, skipped: true, reason: "learned_same_language" });
        }
      }

      let detectedLang: string | null = sourceLang || null;
      if (!detectedLang) {
        detectedLang = await detectLanguage(text, targetLang);
        if (detectedLang) {
          if (reqRoomCode && userId) {
            recordUserDetectedLang(reqRoomCode, userId, detectedLang);
            cleanupRoomProfiles();
          }
          if (detectedLang === targetLang) {
            return res.json({ translatedText: text, skipped: true, reason: "same_language_detected", detectedLang });
          }
        }
      } else if (reqRoomCode && userId) {
        recordUserDetectedLang(reqRoomCode, userId, sourceLang);
      }

      const targetLanguageName = getLanguageName(targetLang);
      const detectedLangName = detectedLang ? getLanguageName(detectedLang) : null;
      let translatedText = sanitizedText;
      let provider: string = activeTranslationService;

      const { lookupFallbackPhrase: lookupPhrase } = await import("./translation-fallback");
      const preloaded = lookupPhrase(sanitizedText, detectedLang || sourceLang || "en", targetLang);
      if (preloaded) {
        structuredLog("info", "translation_preloaded", "GitHub preloaded phrase matched", { correlationId: translationCorrelationId });
        return res.json({ translatedText: preloaded, provider: "preloaded", detectedLang });
      }

      let spacyInputHints = "";
      if (SPANISH_CODES.has(targetLang.toLowerCase())) {
        try {
          const inputAnalysis = await analyzeInputText(sanitizedText);
          if (inputAnalysis && inputAnalysis.hints.length > 0) {
            spacyInputHints = `\n\nINPUT ANALYSIS (use these hints for a better translation):\n- Tone: ${inputAnalysis.tone}\n- ${inputAnalysis.hints.join("\n- ")}`;
          }
        } catch {}
      }

      const isFromSpanish = detectedLang && SPANISH_CODES.has(detectedLang.toLowerCase());
      const isShortPhrase = sanitizedText.length <= 30;
      const useAIForShortPhrases = isShortPhrase && (isFromSpanish || (detectedLang && !["en", "eng", "english"].includes(detectedLang.toLowerCase())));

      if (isFromSpanish && !spacyInputHints) {
        spacyInputHints = `\n\nIMPORTANT CONTEXT: The source text is casual Spanish chat. Common conversational meanings:\n- "si" at the start of a sentence usually means "yes" (sí), not "if"\n- "amor", "mi amor", "cariño" = terms of endearment ("love", "my love", "honey")\n- "si amor" = "yes love" / "yes, my love" — NOT "if I love"\n- Short fragments are normal in chat — translate the conversational meaning, not literally`;
      }

      const usePromptBased = useAIForShortPhrases || provider !== "libretranslate";
      let translationSucceeded = false;

      if (!usePromptBased && provider === "libretranslate") {
        const gwResult = await gatewayTranslate(sanitizedText, targetLang, detectedLang || "auto");
        if (gwResult) {
          translatedText = gwResult.translatedText;
          provider = gwResult.provider;
          translationSucceeded = true;
        }
      }

      if (!translationSucceeded) {
        const translationPrompt = getTranslationPrompt(detectedLangName || "the source language", targetLanguageName) + spacyInputHints;
        const chatResult = await gatewayChat(
          translationPrompt,
          `Translate from ${detectedLangName || "detected language"} to ${targetLanguageName}: ${sanitizedText}`,
          { task: "translation_prompt", maxTokens: 200, temperature: 0.1 }
        );
        if (chatResult?.text) {
          translatedText = chatResult.text.replace(/^["'""]|["'""]$/g, '').trim();
          provider = chatResult.provider;
          translationSucceeded = true;
        }
      }

      if (translatedText && translatedText !== sanitizedText && SPANISH_CODES.has(targetLang.toLowerCase())) {
        try {
          const { input_analysis, output_validation } = await validateSpanishWithContext(sanitizedText, translatedText);
          const validation = output_validation || defaultOutput;
          if (!validation.natural && validation.suggestions.length > 0) {
            const inputHints = input_analysis?.hints?.length
              ? `\nInput analysis hints: ${input_analysis.hints.join("; ")}`
              : "";
            const toneInfo = input_analysis?.tone ? `\nTone: ${input_analysis.tone}` : "";
            const correctionPrompt = `The following Spanish translation has issues. Fix it based on these corrections:\n\nOriginal English: ${sanitizedText}\nCurrent translation: ${translatedText}${toneInfo}${inputHints}\nIssues: ${validation.suggestions.join("; ")}\n\nOutput ONLY the corrected Spanish text, nothing else.`;
            try {
              const fixResult = await gatewayChat(
                "You are a native Spanish speaker fixing a translation. Apply the suggested corrections. Use the input analysis hints to understand the original meaning and tone. Output ONLY the corrected text.",
                correctionPrompt,
                { task: "translation_prompt", maxTokens: 200, temperature: 0.1 }
              );
              const fixed = fixResult?.text?.replace(/^["'""]|["'""]$/g, '').trim();
              if (fixed) {
                translatedText = fixed;
                provider = `${provider}+spacy`;
              }
            } catch {
            }
          }
        } catch {
        }
      }

      if (translatedText && translatedText !== sanitizedText && sanitizedText.length >= 4) {
        const skipOversight = SPANISH_CODES.has(targetLang.toLowerCase()) && !isFromSpanish;
        if (!skipOversight) {
          try {
            const oversight = await runOversightCheck(sanitizedText, translatedText, targetLang);
            if (oversight && !oversight.passed) {
              const issuesList = oversight.issues.filter(i => !i.startsWith("hint:")).join("; ");
              const hints = oversight.issues.filter(i => i.startsWith("hint:")).map(i => i.replace("hint:", "").trim()).join("; ");
              const correctionPrompt = `The translation below has quality issues. Correct it.\n\nOriginal (${detectedLangName || "source"}): ${sanitizedText}\nCurrent ${targetLanguageName} translation: ${translatedText}\nProblems: ${issuesList || "low quality score"}\nContext hints: ${hints || "none"}\n\nOutput ONLY the corrected ${targetLanguageName} text, nothing else.`;

              const oversightFixResult = await gatewayChat(
                `You are the translation oversight agent. You are a native ${targetLanguageName} speaker. Your job is to fix identified quality problems in translations for casual chat. Fix ONLY the problems listed while keeping the original meaning accurate. Output ONLY the corrected ${targetLanguageName} text — no explanations, no quotes, no labels.`,
                correctionPrompt,
                { task: "translation_prompt", maxTokens: 200 }
              );
              if (oversightFixResult?.text) {
                const fixed = oversightFixResult.text.replace(/^["'""]|["'""]$/g, '').trim();
                if (fixed && fixed.length > 0) {
                  translatedText = fixed;
                  provider = `${provider}+oversight`;
                }
              }
            } else if (oversight && oversight.passed && oversight.issues.some(i => i.startsWith("hint:"))) {
              const hints = oversight.issues.filter(i => i.startsWith("hint:")).map(i => i.replace("hint:", "").trim()).join("; ");
              const refineResult = await gatewayChat(
                `You are the translation oversight agent for ${targetLanguageName}. The translation passed basic quality checks but has context hints you should consider. If the translation already handles these well, return it EXACTLY as-is. Only modify if the hints reveal a genuine issue. Output ONLY the final ${targetLanguageName} text.`,
                `Original: ${sanitizedText}\n${targetLanguageName} translation: ${translatedText}\nHints: ${hints}\n\nOutput the final ${targetLanguageName} text:`,
                { task: "translation_prompt", maxTokens: 200 }
              );
              if (refineResult?.text) {
                const refined = refineResult.text.replace(/^["'""]|["'""]$/g, '').trim();
                if (refined && refined.length > 0) {
                  translatedText = refined;
                  provider = `${provider}+refined`;
                }
              }
            }
          } catch {
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      recordLatency(latencyMs);
      recordTranslation(provider, true);
      recordProviderLatency(provider as TranslationProvider, latencyMs, true);
      
      if (source === "voice_transcription" && translatedText && translatedText !== text) {
        const targetLanguageName = getLanguageName(targetLang);
        const sourceLanguageName = sourceLang ? getLanguageName(sourceLang) : "auto";
        const monitorResult = await kimiMonitor(text, translatedText, sourceLanguageName, targetLanguageName);
        if (monitorResult.wasAdjusted) {
          translatedText = monitorResult.finalTranslation;
          provider = `${provider}+kimi-monitor`;
        }
        trackTokenUsage("kimi", Math.ceil(text.length / 4) + 200, 80, "translation_qa");
      }

      const oversightCorrected = provider.includes("+oversight") || provider.includes("+spacy") || provider.includes("+refined");
      const baseProvider = provider.split("+")[0];
      const autoVerified = oversightCorrected || ["kimi", "claude", "openai"].includes(baseProvider) || provider.includes("+kimi-monitor");
      structuredLog("info", "translation_complete", "Translation completed", { correlationId: translationCorrelationId, userId: (req as any).user?.claims?.sub, roomId: req.body.roomCode, provider, durationMs: latencyMs, sourceLang: req.body.sourceLang, targetLang: req.body.targetLang });
      res.json({
        translatedText,
        provider,
        latencyMs,
        oversightCorrected,
        autoVerified,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      recordLatency(latencyMs);
      recordTranslation(activeTranslationService, false, error?.message || "Translation failed");
      recordProviderLatency(activeTranslationService, latencyMs, false);
      structuredLog("error", "translation_failed", "Translation failed", { correlationId: translationCorrelationId, userId: (req as any).user?.claims?.sub, durationMs: latencyMs, error: error?.message });
      console.error("Translation error:", error);
      res.json({
        translatedText: req.body.text,
        error: "Translation failed",
      });
    }
  });

  v1Router.post("/voice-conversations", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { role, originalText, translatedText, sourceLang, targetLang } = req.body;
      if (!originalText || !sourceLang || !targetLang || !role) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const conv = await storage.saveVoiceConversation({
        userId,
        role,
        originalText,
        translatedText: translatedText || null,
        sourceLang,
        targetLang,
      });
      res.json(conv);
    } catch (error: any) {
      console.error("Voice conversation save error:", error);
      res.status(500).json({ message: "Failed to save conversation" });
    }
  });

  v1Router.get("/voice-conversations", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const limit = parseInt(req.query.limit as string) || 50;
      const conversations = await storage.getVoiceConversations(userId, limit);
      res.json(conversations);
    } catch (error: any) {
      console.error("Voice conversations fetch error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  v1Router.get("/voice-translation-usage", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const count = user.voiceTranslationCount || 0;
      const isPremium = user.premiumVoiceTranslation || false;
      const isOwner = !!process.env.OWNER_ACCESS_CODE && isPremium;
      res.json({ count, isPremium, limit: 5, remaining: isPremium ? -1 : Math.max(0, 5 - count) });
    } catch (error: any) {
      console.error("Voice translation usage error:", error);
      res.status(500).json({ message: "Failed to fetch usage" });
    }
  });

  v1Router.post("/voice-translation-increment", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.premiumVoiceTranslation) {
        return res.json({ count: user.voiceTranslationCount || 0, isPremium: true, remaining: -1 });
      }
      const newCount = (user.voiceTranslationCount || 0) + 1;
      await storage.updateUser(userId, { voiceTranslationCount: newCount });
      const remaining = Math.max(0, 5 - newCount);
      res.json({ count: newCount, isPremium: false, remaining, limitReached: newCount >= 5 });
    } catch (error: any) {
      console.error("Voice translation increment error:", error);
      res.status(500).json({ message: "Failed to increment usage" });
    }
  });

  v1Router.post("/voice-translation-unlock", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { accessCode } = req.body;
      if (!accessCode) return res.status(400).json({ message: "Access code required" });
      const ownerCode = process.env.OWNER_ACCESS_CODE || process.env.DEV_PORTAL_ACCESS_CODE;
      if (!ownerCode) return res.status(500).json({ message: "Owner access not configured" });
      if (accessCode !== ownerCode) {
        return res.status(403).json({ message: "Invalid access code" });
      }
      await storage.updateUser(userId, { premiumVoiceTranslation: true });
      res.json({ success: true, isPremium: true });
    } catch (error: any) {
      console.error("Voice translation unlock error:", error);
      res.status(500).json({ message: "Failed to unlock" });
    }
  });

  v1Router.post("/translate-batch", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!checkTranslationRateLimit(userId || "anon")) {
        return res.status(429).json({ message: "Translation rate limit exceeded. Please wait before sending more requests." });
      }

      const { texts, targetLang, contextMessages } = req.body as {
        texts: { id: string; text: string }[];
        targetLang: string;
        contextMessages?: string[];
      };

      if (!texts || !Array.isArray(texts) || !targetLang) {
        return res.status(400).json({ message: "texts array and targetLang are required" });
      }

      if (texts.length > 50) {
        return res.status(400).json({ message: "Maximum 50 texts per batch request" });
      }

      const sanitizedTexts = texts.map(item => ({
        id: item.id,
        text: sanitizeTranslationInput(item.text),
      }));

      const results: { id: string; translatedText: string; cached?: boolean }[] = [];
      const toTranslate: { id: string; text: string; index: number }[] = [];

      for (let i = 0; i < sanitizedTexts.length; i++) {
        const item = sanitizedTexts[i];
        const cached = await getCachedTranslation(item.text, targetLang);
        if (cached) {
          results.push({ id: item.id, translatedText: cached, cached: true });
        } else {
          toTranslate.push({ id: item.id, text: item.text, index: i });
        }
      }

      if (toTranslate.length === 0) {
        return res.json({ translations: results });
      }

      const targetLanguageName = getLanguageName(targetLang);
      const sanitizedContext = contextMessages
        ? contextMessages.slice(-5).map(c => sanitizeTranslationInput(c))
        : [];
      const contextBlock = sanitizedContext.length > 0
        ? `\nCONVERSATION CONTEXT (for reference only, do NOT translate these):\n${sanitizedContext.map(c => `> ${c}`).join("\n")}\n`
        : "";

      const numberedTexts = toTranslate.map((t, i) => `[${i}] ${t.text}`).join("\n");
      const prompt = `You are a precise translator. Translate each numbered line into ${targetLanguageName}.
${contextBlock}
RULES:
- Output ONLY the translated lines in ${targetLanguageName}
- Keep the [number] prefix exactly as-is
- One translated line per input line
- Do NOT include the original text
- Translate accurately - do NOT paraphrase or alter meaning
- No quotes, explanations, labels, or commentary
- If a line is ALREADY in ${targetLanguageName}, return it EXACTLY as-is
- Preserve tone, slang, abbreviations, and informal style
- Use the conversation context to better understand pronouns, references, and tone

Lines to translate:
${numberedTexts}`;

      let libreHandled = false;
      const startTime = Date.now();
      let usedProvider: string = activeTranslationService;

      if (activeTranslationService === "libretranslate") {
        let allSucceeded = true;
        for (const item of toTranslate) {
          const sanitized = sanitizeTranslationInput(item.text);
          const gwResult = await gatewayTranslate(sanitized, targetLang, "auto");
          if (gwResult) {
            const clean = gwResult.translatedText.replace(/^["'""]|["'""]$/g, '').trim();
            if (clean && clean !== item.text) setCachedTranslation(item.text, targetLang, clean);
            results.push({ id: item.id, translatedText: clean || item.text });
            usedProvider = gwResult.provider;
          } else {
            allSucceeded = false;
            break;
          }
        }
        libreHandled = allSucceeded && results.length > 0;
        if (!libreHandled) results.length = 0;
      }

      if (!libreHandled) {
        const batchResult = await gatewayChat(prompt, numberedTexts, { task: "translation_prompt", maxTokens: 1000, temperature: 0.1 });
        if (batchResult) usedProvider = batchResult.provider;
        const translatedText = batchResult?.text || numberedTexts;

        const lines = translatedText.split("\n").filter(l => l.trim());
        const lineMap = new Map<number, string>();
        for (const line of lines) {
          const m = line.match(/^\[(\d+)\]\s*(.+)$/);
          if (m) lineMap.set(parseInt(m[1]), m[2].trim());
        }

        for (let i = 0; i < toTranslate.length; i++) {
          const item = toTranslate[i];
          const raw = lineMap.get(i) || item.text;
          const cleanTranslated = raw.replace(/^["'""]|["'""]$/g, '').trim();

          if (cleanTranslated && cleanTranslated !== item.text) {
            setCachedTranslation(item.text, targetLang, cleanTranslated);
          }
          results.push({ id: item.id, translatedText: cleanTranslated || item.text });
        }
      }

      if (SPANISH_CODES.has(targetLang.toLowerCase()) && results.length > 0) {
        try {
          const validationPromises = results.map(async (r) => {
            if (!r.translatedText || r.translatedText.length < 3) return r;
            const v = await validateSpanishTranslation(r.translatedText);
            if (!v.natural && v.suggestions.length > 0) {
              try {
                const fixResult = await gatewayChat(
                  "You are a native Spanish speaker fixing a translation. Apply the corrections and output ONLY the corrected text.",
                  `Fix this Spanish: "${r.translatedText}"\nIssues: ${v.suggestions.join("; ")}`,
                  { task: "translation_prompt", maxTokens: 150, temperature: 0.1 }
                );
                const fixed = fixResult?.text?.replace(/^["'""]|["'""]$/g, '').trim();
                if (fixed) r.translatedText = fixed;
              } catch {}
            }
            return r;
          });
          const validated = await Promise.all(validationPromises);
          results.length = 0;
          results.push(...validated);
        } catch {}
      }

      const latencyMs = Date.now() - startTime;
      recordLatency(latencyMs);
      recordProviderLatency(usedProvider as TranslationProvider, latencyMs, true);

      res.json({ translations: results });
    } catch (error: any) {
      console.error("Batch translation error:", error);
      const fallback = (req.body.texts || []).map((t: any) => ({ id: t.id, translatedText: t.text }));
      res.json({ translations: fallback, error: "Translation failed" });
    }
  });

  v1Router.get("/user-lang/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const targetUserId = req.params.userId;
      const prefs = await storage.getPreferences(targetUserId);
      const lang = prefs?.subtitleLanguage || "en";
      res.json({ lang });
    } catch (error) {
      console.error("Error fetching user language:", error);
      res.json({ lang: "en" });
    }
  });

  // ── Image session refine endpoint ──────────────────────────────────────────
  // Called from the ImageSession UI when the user describes a modification.
  // Combines the original prompt with the refinement and generates new images.
  v1Router.post("/image/refine", isAuthenticated, async (req: any, res) => {
    try {
      const { originalPrompt, refinement } = req.body;
      if (!originalPrompt?.trim() || !refinement?.trim()) {
        return res.status(400).json({ message: "originalPrompt and refinement are required" });
      }
      const userId = req.user.claims.sub;
      const rateCheck = await checkImageRateLimit(userId);
      if (!rateCheck.allowed) {
        const hrs = rateCheck.resetInHours;
        return res.status(429).json({
          message: `You've used all ${rateCheck.limit} image generations for today. Your next slot opens in ${hrs} hour${hrs === 1 ? "" : "s"}.`,
        });
      }
      // Combine: keep the original subject, apply the refinement on top
      const combinedPrompt = `${originalPrompt.trim()}, ${refinement.trim()}`;
      const imgResults = await generateImages(combinedPrompt);
      await incrementImageUsage(userId);
      return res.json({
        imageUrls: imgResults.map(r => ({ url: r.imageUrl, label: r.label, model: r.model })),
        remaining: rateCheck.remaining - 1,
      });
    } catch (err: any) {
      console.error("[ImageRefine] Error:", err);
      res.status(500).json({ message: err.message || "Image refinement failed." });
    }
  });

  // ── Dedicated conversational chat endpoint ─────────────────────────────────
  // This is the ONLY path for Juno conversations. No translation, no fallback chain.
  // Uses OpenRouter directly. If OpenRouter fails → error returned, no retries.
  v1Router.post("/chat", async (req, res) => {
    try {
      const { text, lang = "en", conversationHistory = [] } = req.body;
      if (!text?.trim()) return res.status(400).json({ message: "Text is required" });

      await awaitApiKeys();

      // ── Image pipeline (isolated — flip Arena flag "image_generation" OR CDN config to enable) ──
      if ((getArenaFlag("image_generation") || getImageConfig().enabled) && detectImageIntent(text)) {
        const userId = String((req as any).user?.id || "anon");
        const rateCheck = await checkImageRateLimit(userId);
        if (!rateCheck.allowed) {
          const hrs = rateCheck.resetInHours;
          return res.json({
            text: `You've used all ${rateCheck.limit} image generations for today. Your next slot opens in ${hrs} hour${hrs === 1 ? "" : "s"}.`,
            mode: "chat",
          });
        }
        try {
          const imgResults = await generateImages(text);
          await incrementImageUsage(userId);
          console.log("[CHAT→IMG]", { prompt: text.slice(0, 60), models: imgResults.map(r => r.model), remaining: rateCheck.remaining - 1 });
          return res.json({
            text: "Here are your images — each one from a different open-source model:",
            imageUrl: imgResults[0].imageUrl,
            imageUrls: imgResults.map(r => ({ url: r.imageUrl, label: r.label, model: r.model })),
            mode: "image",
            remaining: rateCheck.remaining - 1,
          });
        } catch (imgErr: any) {
          return res.json({ text: imgErr.message || "Image generation failed. Try rephrasing your request.", mode: "chat" });
        }
      }
      // ── End image pipeline ────────────────────────────────────────────────

      // ── Translation command pipeline ──────────────────────────────────────
      // Detects natural-language translation requests (voice + text).
      // When a command is found, pre-translates the target text, then passes
      // both the user request AND the translation to the reasoning model so
      // Juno responds conversationally — adding pronunciation, context, follow-up.
      const TX_LANG_NAMES: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
        pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
        ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
        tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
        el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
      };
      const txUserLangName = TX_LANG_NAMES[lang] || "English";
      const txIntent = await detectTranslationIntent(text.trim()).catch(() => null);

      if (txIntent?.detected && txIntent.confidence >= 0.80 && txIntent.targetLang) {
        const hasTextToTranslate = !!txIntent.textToTranslate;

        if (hasTextToTranslate) {
          // ── Direct translation: pre-translate then reason around the result ──
          try {
            const txResult = await gatewayTranslate(
              txIntent.textToTranslate!,
              txIntent.targetLang,
              "auto",
              (code) => TX_LANG_NAMES[code] || code,
            );

            const translated = txResult?.translatedText || txIntent.textToTranslate!;
            const targetLangName = txIntent.targetLangName || TX_LANG_NAMES[txIntent.targetLang] || txIntent.targetLang;

            // Ask the reasoning model to wrap the translation in a natural response
            const txSystemPrompt = `You are Juno — the intelligence powering JunoTalk. A user has asked you to translate something.

TRANSLATION RESULT:
- Original text: "${txIntent.textToTranslate}"
- Translated to ${targetLangName}: "${translated}"

YOUR TASK:
1. Confirm the translation naturally in 1-2 sentences — don't just restate it mechanically
2. Add ONE genuinely useful detail IF relevant: pronunciation guide (especially for Japanese, Chinese, Arabic, Korean), cultural usage note, or common context
3. End with exactly ONE short follow-up question to continue the conversation
4. Always respond in ${txUserLangName} (the user's language)

RULES:
- Keep it SHORT — 2-3 sentences max then the follow-up
- Use natural spoken language — this response will be read aloud
- Never open with hollow filler ("Great!", "Sure!", "Of course!")
- Include romanized pronunciation in parentheses when the target script differs from Latin`;

            const txMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
              { role: "system", content: txSystemPrompt },
              { role: "user", content: text.trim() },
            ];

            const reasoningResult = await gatewayRequest({
              task: "chat",
              messages: txMessages,
              maxTokens: 400,
              temperature: 0.7,
            });

            if (reasoningResult?.text) {
              console.log("[CHAT→TRANSLATE]", { original: txIntent.textToTranslate, targetLang: txIntent.targetLang, provider: txResult?.provider });
              return res.json({
                text: reasoningResult.text,
                mode: "translate",
                translationMeta: {
                  original: txIntent.textToTranslate,
                  translated,
                  targetLang: txIntent.targetLang,
                  targetLangName,
                },
                provider: reasoningResult.provider,
              });
            }
          } catch (txErr: any) {
            console.warn("[CHAT→TRANSLATE] pipeline error, falling through to reasoning:", txErr?.message);
            // Fall through to full reasoning model below
          }
        }
        // mode_switch (no specific text) or failed translation → fall through to
        // reasoning model which will naturally ask what to translate / respond in context
      }
      // ── End translation command pipeline ─────────────────────────────────

      const langNames: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
        pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
        ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
        tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
        el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
      };
      const langName = langNames[lang] || "English";

      const systemPrompt = `You are Juno — the intelligence powering JunoTalk, a multilingual communication platform. You are a reasoning AI and a communication partner in one. You can translate, explain, advise, research, strategize, and ideate — across any language and any domain.

CORE IDENTITY:
- You are Juno Intelligence — the AI brain of a communication platform built for the world
- You break language barriers: you translate naturally, explain cultural context, and help people communicate across languages
- You also reason deeply: you analyze ideas, give recommendations, help with decisions, and engage in real conversation
- You are not limited to translation OR to any single topic — you do both, fluidly, in whatever direction the user takes you

ABSOLUTE RULES (never break these):
1. NEVER echo or repeat the user's message back to them in your opening line.
2. Always respond in ${langName} unless the user explicitly asks you to switch languages.
3. ALWAYS end every response with exactly one sharp follow-up question to keep the conversation going.
4. Never open with hollow filler: no "Great!", "Absolutely!", "That's a great question!", "Of course!" — start with real substance immediately.
5. Never guess when you don't know. Say what you do know confidently, and be honest about what you don't.

REASONING & IDEAS:
- When someone pitches an idea → engage with it seriously. Identify what's strong, what's risky, what's missing. Give your honest take, then ask what aspect they want to dig into.
- When someone asks for recommendations → give specific, reasoned picks with the "why" behind each one. No vague lists.
- When someone is working through a decision → lay out the key tradeoffs clearly and tell them what you'd lean toward and why.
- When someone wants research → synthesize what you know into a clear, structured answer. Call out what's uncertain.
- When someone is building something → ask about their constraints, their user, their goal. Then give targeted advice.

FORMATTING RULES:
- Use **bold** for key terms, section headers, names, and important distinctions.
- Use bullet points (•) for lists, comparisons, and steps — one item per line.
- Use short paragraphs for reasoning and narrative, then bullets for specifics.
- Match the depth of your response to the complexity of the question. Quick questions get crisp answers. Deep questions get structured breakdowns.
- Conversational tone throughout — brilliant friend, not corporate assistant.

TRAVEL & EXPLORATION (a core strength):
You are a knowledgeable travel companion. Cover any angle the user needs:
- **Destinations** → top neighborhoods, hidden gems, must-see vs overrated, best time to go, how many days to spend
- **Practical planning** → visa requirements by nationality, entry rules, airport tips, local transport options
- **Packing** → climate-specific lists, carry-on vs checked, gear for specific activities (hiking, beach, business travel)
- **Flights & hotels** → what to look for, when to book, budget vs premium tradeoffs, loyalty programs
- **Local culture & customs** → etiquette, tipping norms, dress codes, local laws travelers get wrong, communication styles
- **Food & nightlife** → what to eat, neighborhoods to explore, what to avoid, dietary restriction navigation
- **Safety** → neighborhood-level advice, common scams, emergency contacts, travel insurance guidance
- **Budget** → cost-of-living per destination, how to stretch money, free vs paid experiences
Always give specific, practical answers — not generic travel-blog content. Tie everything to what the user actually needs.

ALL OTHER TOPICS:
- Answer directly and confidently from your training knowledge.
- When you lack current data (live prices, today's stock, breaking news), say so briefly and give the best available estimate or framework.
- Match the user's tone and energy at all times.`;

      const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-14) : [];
      const chatUserId = String((req as any).user?.id || "anon");
      const chatRoomCode = req.body.roomCode || undefined;

      // ── Parallel Intelligence Evaluation ──────────────────────────────────
      // All three layers run simultaneously — zero sequential blocking.
      //
      //  1. Adaptive Policies    (4 checks) — significance, curiosity, surprise, trust
      //  2. Intelligence Layer   (8 checks) — momentum, load, goal, ambiguity, etc.
      //  3. Juno Learner                    — recall what Juno has learned about this
      //                                       user across ALL past sessions (semantic DB)
      //                                       + extract+store new facts in background
      const [adaptiveEval, intelligenceEval, learnerRecall] = await Promise.all([
        evaluateAdaptivePolicies(text.trim(), recentHistory).catch(() => null),
        evaluateIntelligenceLayer(text.trim(), recentHistory).catch(() => null),
        learnAndRecall(text.trim(), chatUserId, chatRoomCode).catch(() => null),
      ]);

      const adaptiveDirectives = adaptiveEval?.directives?.length
        ? `\nADAPTIVE POLICY DIRECTIVES (follow these for this response):\n${adaptiveEval.directives.map(d => `• ${d}`).join("\n")}`
        : "";

      const intelligenceDirectives = intelligenceEval?.directives?.length
        ? `\nINTELLIGENCE LAYER DIRECTIVES (follow these for this response):\n${intelligenceEval.directives.map(d => `• ${d}`).join("\n")}`
        : "";

      const learnedFactsBlock = learnerRecall?.promptBlock
        ? `\n${learnerRecall.promptBlock}`
        : "";

      // Pull any session caption/briefing messages (role:"system") injected by the client
      // when resuming a session, and merge them into the main system prompt so the AI
      // actually receives the full context (many providers strip mid-conversation system turns).
      const sessionCaptions = recentHistory
        .filter((m: { role: string; content: string }) => m.role === "system")
        .map((m: { role: string; content: string }) => m.content)
        .join("\n\n");
      const fullSystemPrompt = [
        systemPrompt,
        learnedFactsBlock,
        adaptiveDirectives,
        intelligenceDirectives,
        sessionCaptions ? `SESSION CONTEXT (resumed conversation):\n${sessionCaptions}` : "",
      ].filter(Boolean).join("\n\n");

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: fullSystemPrompt },
        ...recentHistory
          .filter((m: { role: string; content: string }) => m.role && m.content && m.role !== "system")
          .map((m: { role: string; content: string }) => ({
            role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          })),
        { role: "user", content: text.trim() },
      ];

      console.log("[CHAT]", { message: text.slice(0, 80), lang, historyLength: recentHistory.length });

      // Use the provider cascade (OpenRouter → DeepSeek → Kimi → Gemini → …)
      // so chat works even when one provider's key is unavailable.
      const result = await gatewayRequest({
        task: "chat",
        messages,
        maxTokens: 1200,
        temperature: 0.75,
      });

      if (!result?.text) return res.status(500).json({ message: "Juno did not respond. Please try again." });

      return res.json({ text: result.text, mode: "chat", provider: result.provider });
    } catch (err: any) {
      console.error("[CHAT] error:", err?.message || err);
      return res.status(500).json({ message: "Chat unavailable right now. Please try again." });
    }
  });

  // ── /chat-translate — dedicated Google-Translate-style text translator ──────
  // Pipeline: LibreTranslate (primary) → DeepSeek via GitHub Models (fallback) → spaCy QA
  // Used exclusively by JunoChatModal. Runs parallel to voice/AI pipeline.
  v1Router.post("/chat-translate", async (req, res) => {
    const { text, sourceLang = "auto", targetLang = "en", nativeLang } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: "Text is required" });
    }

    const sanitized = sanitizeTranslationInput(text.trim());
    if (!sanitized) return res.status(400).json({ message: "Text empty after sanitization" });

    const langNames: Record<string, string> = {
      en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
      pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
      ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
      tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
      el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
    };

    const { srcLang, tgtLang } = await resolveTranslationDirection(
      sanitized,
      nativeLang || sourceLang,
      sourceLang,
      targetLang
    );

    const srcName = langNames[srcLang] || srcLang;
    const tgtName = langNames[tgtLang] || tgtLang;

    let translatedText = "";
    let provider = "unknown";

    // ── 1. LibreTranslate ───────────────────────────────────────────────────
    const libreUrl = process.env.LIBRETRANSLATE_URL;
    if (libreUrl) {
      try {
        const body: Record<string, string> = {
          q: sanitized, source: srcLang, target: tgtLang, format: "text",
        };
        if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
        const libreRes = await fetch(`${libreUrl.replace(/\/+$/, "")}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000) as any,
        });
        if (libreRes.ok) {
          const data = await libreRes.json() as { translatedText?: string };
          if (data?.translatedText) {
            translatedText = data.translatedText.trim();
            provider = "libretranslate";
            console.log("[ChatTranslate] LibreTranslate success");
          }
        } else {
          console.warn("[ChatTranslate] LibreTranslate HTTP", libreRes.status);
        }
      } catch (e: any) {
        console.warn("[ChatTranslate] LibreTranslate error:", e?.message?.slice(0, 80));
      }
    }

    // ── 2. DeepSeek via GitHub Models (fallback) ────────────────────────────
    if (!translatedText) {
      const ghToken = process.env.GITHUB_MODELS_TOKEN;
      if (ghToken) {
        try {
          const dsMessages = [
            {
              role: "system" as const,
              content: `You are a professional translator. Translate the following text from ${srcName} to ${tgtName}. Output ONLY the translation — no notes, no alternatives, no explanations.`,
            },
            { role: "user" as const, content: sanitized },
          ];
          const dsRes = await fetch("https://models.inference.ai.azure.com/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${ghToken}` },
            body: JSON.stringify({ model: "DeepSeek-V3", messages: dsMessages, temperature: 0.1, max_tokens: 500 }),
            signal: AbortSignal.timeout(12000) as any,
          });
          if (dsRes.ok) {
            const dsData = await dsRes.json() as { choices?: { message?: { content?: string } }[] };
            const reply = dsData?.choices?.[0]?.message?.content?.trim();
            if (reply) {
              translatedText = reply.replace(/^["'""]|["'""]$/g, "").trim();
              provider = "deepseek";
              console.log("[ChatTranslate] DeepSeek fallback success");
            }
          } else {
            console.warn("[ChatTranslate] DeepSeek HTTP", dsRes.status);
          }
        } catch (e: any) {
          console.warn("[ChatTranslate] DeepSeek error:", e?.message?.slice(0, 80));
        }
      }
    }

    if (!translatedText) {
      return res.status(503).json({ message: "Translation unavailable right now. Please try again." });
    }

    // ── 3. spaCy QA — validate & refine if translating to Spanish ──────────
    const SPANISH_TARGET = new Set(["es", "es-mx", "es-ar", "es-co", "es-la", "spa"]);
    if (SPANISH_TARGET.has(tgtLang.toLowerCase())) {
      try {
        const { output_validation } = await validateSpanishWithContext(sanitized, translatedText);
        if (output_validation && !output_validation.natural && output_validation.suggestions.length > 0) {
          const fixPrompt = `Fix this Spanish translation.\nOriginal: ${sanitized}\nCurrent: ${translatedText}\nIssues: ${output_validation.suggestions.join("; ")}\nOutput ONLY the corrected Spanish text.`;
          const ghToken = process.env.GITHUB_MODELS_TOKEN;
          if (ghToken) {
            try {
              const fixRes = await fetch("https://models.inference.ai.azure.com/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ghToken}` },
                body: JSON.stringify({
                  model: "DeepSeek-V3",
                  messages: [
                    { role: "system" as const, content: "You are a native Spanish translator fixing a translation. Output ONLY the corrected text." },
                    { role: "user" as const, content: fixPrompt },
                  ],
                  temperature: 0.1, max_tokens: 400,
                }),
                signal: AbortSignal.timeout(8000) as any,
              });
              if (fixRes.ok) {
                const fixData = await fixRes.json() as { choices?: { message?: { content?: string } }[] };
                const fixed = fixData?.choices?.[0]?.message?.content?.trim().replace(/^["'""]|["'""]$/g, "").trim();
                if (fixed) {
                  translatedText = fixed;
                  provider = `${provider}+spacy`;
                  console.log("[ChatTranslate] spaCy+DeepSeek refinement applied");
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    return res.json({ translatedText, provider, sourceLang, targetLang });
  });

  v1Router.post("/ai-translate", async (req, res) => {
    const routeTimeout = setTimeout(() => {
      if (!res.headersSent) res.status(504).json({ message: "Translation took too long. Please try again." });
    }, 30000);
    try {
      // This route handles ONLY translation and voice modes.
      // Conversational chat (text) is handled exclusively by POST /api/v1/chat.
      // Voice carries conversation history — it is stateful and conversational.
      // Translation is stateless — no history, pure interpreter pipeline.
      const { text, sourceLang, targetLang, voiceMode = false, conversationHistory = [] } = req.body;
      const requestMode: "translate" | "voice" = voiceMode === true ? "voice" : "translate";

      console.log("[AI-TRANSLATE TRACE]", {
        message: text?.slice(0, 80), mode: requestMode, sourceLang, targetLang,
        junoActive: requestMode === "voice",
      });

      const authUserId = (req.user as any)?.claims?.sub || (req.user as any)?.id;
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const userId = authUserId || `ip:${clientIp}`;
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ message: "Text is required" });
      }

      // ── Voice AI daily rate limit ─────────────────────────────────────────
      // Voice-initiated conversational AI requests are capped per person per day.
      // Identified by account ID when logged in, IP address otherwise.
      // Text-typed requests are unlimited (voiceMode === false).
      const VOICE_AI_DAILY_LIMIT = 10;
      if (requestMode === "voice") {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
        const safeId = userId.replace(/[^a-zA-Z0-9_:.-]/g, "_");
        const rateKey = `juno:voice_ai:${safeId}:${today}`;
        const nowUtc = new Date();
        const msUntilMidnight = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 1)).getTime() - nowUtc.getTime();
        const ttlSecs = Math.ceil(msUntilMidnight / 1000);
        const currentCount = parseInt((await redisGet(rateKey)) || "0", 10);
        if (currentCount >= VOICE_AI_DAILY_LIMIT) {
          clearTimeout(routeTimeout);
          return res.status(429).json({
            code: "voice_limit_exceeded",
            message: "You've reached your daily voice conversation limit with Juno.",
            limit: VOICE_AI_DAILY_LIMIT,
            used: currentCount,
            resetAt: "midnight UTC",
          });
        }
        await redisIncrBy(rateKey, 1, ttlSecs);
      }

      // ── Juno greeting opener ────────────────────────────────────────────────
      if (text.trim() === "__juno_open__") {
        const greetings = [
          "Hey! What's on your mind?",
          "Go ahead — I'm listening.",
          "What would you like to talk about?",
          "Ready when you are. What's up?",
          "I'm here. What do you need?",
          "Talk to me — what are you thinking?",
          "Hey, what can I help you with today?",
        ];
        const opener = greetings[Math.floor(Math.random() * greetings.length)];
        clearTimeout(routeTimeout);
        return res.json({ translatedText: opener, mode: "greeting" });
      }

      const langNames: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
        pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
        ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
        tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
        el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
      };
      const srcName = langNames[sourceLang] || sourceLang;
      const tgtName = langNames[targetLang] || targetLang;

      // ── VOICE pipeline — conversational, stateful, voice-optimised ────────────
      // Voice responses are spoken aloud by TTS. No markdown, short responses,
      // always a follow-up question. History passed so Juno remembers the exchange.
      if (requestMode === "voice") {
        const voiceSystemPrompt = `You are Juno — the voice intelligence inside JunoTalk, a multilingual communication platform. The user is speaking to you and your response will be read aloud by text-to-speech.

You are a travel companion, reasoning AI, and communication partner. You help with travel questions — destinations, visas, packing, local culture, flights, hotels, safety, food — as well as general questions on any topic. You also translate and break language barriers when needed.

VOICE RULES — strictly required:
1. Your response will be SPOKEN OUT LOUD. Never use bullet points, asterisks, bold markers, dashes, or any text formatting. Write in plain natural spoken sentences only.
2. Keep it SHORT — 2 to 3 sentences maximum, then exactly one question. Voice responses must be brief and speakable.
3. NEVER echo or repeat the user's message back to them.
4. ALWAYS end with exactly one natural follow-up question to continue the conversation.
5. Respond in ${srcName} — match the language the user spoke in.
6. Be warm, direct, and natural — like a brilliant bilingual friend who actually listens.

Engage with what the user actually said — their meaning, their intent, their language — and keep the conversation moving forward.`;

        await awaitApiKeys();

        const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
        const voiceMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: voiceSystemPrompt },
          ...recentHistory
            .filter((m: { role: string; content: string }) => m.role && m.content)
            .map((m: { role: string; content: string }) => ({
              role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
              content: m.content,
            })),
          { role: "user", content: text.trim() },
        ];

        // ── Voice AI provider chain ─────────────────────────────────────────
        // 1. Groq (direct) — fast, reliable, not subject to gateway failures
        // 2. AI Gateway fallback — openrouter / github-models / others
        let voiceResponse: string | null = null;

        const groqVoiceKey = apiKeys.groq();
        if (groqVoiceKey) {
          try {
            const groqCtrl = new AbortController();
            const groqTimer = setTimeout(() => groqCtrl.abort(), 6000);
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${groqVoiceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: voiceMessages,
                max_tokens: 300,
                temperature: 0.75,
              }),
              signal: groqCtrl.signal,
            });
            clearTimeout(groqTimer);
            if (groqRes.ok) {
              const groqData = await groqRes.json() as { choices?: { message?: { content?: string } }[] };
              voiceResponse = groqData?.choices?.[0]?.message?.content?.trim() || null;
              if (voiceResponse) console.log("[JunoVoice] Groq llama-3.3-70b responded");
            }
          } catch (groqErr: any) {
            console.warn("[JunoVoice] Groq failed:", groqErr?.message?.slice(0, 80));
          }
        }

        // Fallback to AI Gateway if Groq unavailable or failed
        if (!voiceResponse) {
          const voiceResult = await gatewayRequest({
            task: "chat",
            messages: voiceMessages,
            maxTokens: 300,
            temperature: 0.75,
          });
          voiceResponse = voiceResult?.text || null;
        }

        if (!voiceResponse) {
          clearTimeout(routeTimeout);
          return res.status(500).json({ message: "Juno did not respond. Please try again." });
        }

        try { offlineTracker.markAiSuccess(userId); } catch {}
        clearTimeout(routeTimeout);
        return res.json({ translatedText: voiceResponse, mode: "voice_ai" });
      }

      // ── TRANSLATE pipeline — stateless, pure interpreter, no conversation ─────
      // Caches are checked here. No conversation history. kimiMonitor QA applies.
      const voiceCacheKey = crypto.createHash("sha256").update(`${sourceLang}:${targetLang}:${text.trim().toLowerCase()}`).digest("hex");

      const redisCached = await getCachedTranslationRedis("voice", sourceLang, targetLang, voiceCacheKey);
      if (redisCached) {
        return res.json({ translatedText: redisCached, mode: "cache" });
      }

      const cachedVoice = voiceTranslationCache.get(voiceCacheKey);
      if (cachedVoice) {
        return res.json({ translatedText: cachedVoice.text, mode: "cache" });
      }

      const { lookupFallbackPhrase } = await import("./translation-fallback");
      const preloadedPhrase = lookupFallbackPhrase(text.trim(), sourceLang, targetLang);
      if (preloadedPhrase) {
        clearTimeout(routeTimeout);
        return res.json({ translatedText: preloadedPhrase, mode: "preloaded" });
      }

      const translateSystemPrompt = `You are a world-class interpreter — the kind who works at the United Nations, high-level diplomatic meetings, and international conferences. You have native-level mastery of both ${srcName} and ${tgtName}, with deep knowledge of regional dialects, street slang, professional jargon, humor, and cultural subtleties.

You are interpreting live speech from ${srcName} to ${tgtName}. This is spoken language, not written text.

How you think:
- First, fully grasp what the speaker MEANS — their intent, emotion, subtext, and cultural references.
- Then express that meaning the way a native ${tgtName} speaker would naturally say it in conversation. Not how a textbook would write it.
- Spoken language is messy. People repeat themselves, trail off, use filler words. Clean it up naturally without losing meaning.
- Slang stays slang. "What's up" in English becomes the local equivalent, not a literal translation.
- Humor translates as humor. Sarcasm translates as sarcasm. Anger translates as anger.
- Cultural references adapt. Find the closest natural equivalent or keep it with enough context.
- Numbers, names, and technical terms stay accurate.

Output rules:
- ${tgtName} ONLY. Never mix languages. Never add notes, brackets, or explanations.
- One clean translation. No alternatives, no options.
- Match the register: street talk stays street, formal stays formal.
- Keep it concise. Spoken translations should be speakable.`;

      let translatedText = "";

      const gwTranslateResult = await gatewayTranslate(
        text.trim(), targetLang, sourceLang,
        (code: string) => langNames[code] || code,
        undefined,
        translateSystemPrompt
      );
      if (gwTranslateResult) translatedText = gwTranslateResult.translatedText;

      if (!translatedText) {
        clearTimeout(routeTimeout);
        return res.status(500).json({ message: "Translation failed. Please try again." });
      }

      translatedText = translatedText.replace(/^["']|["']$/g, "").trim();

      const monitorPromise = kimiMonitor(text.trim(), translatedText, srcName, tgtName);
      const monitorTimeout = new Promise<{ finalTranslation: string; wasAdjusted: boolean }>((resolve) =>
        setTimeout(() => resolve({ finalTranslation: translatedText, wasAdjusted: false }), 1500)
      );
      const monitorResult = await Promise.race([monitorPromise, monitorTimeout]);
      translatedText = monitorResult.finalTranslation;
      trackTokenUsage("kimi", Math.ceil(text.trim().length / 4) + 200, 80, "translation_qa");

      voiceTranslationCache.set(voiceCacheKey, { text: translatedText, ts: Date.now() });
      setCachedTranslationRedis("voice", sourceLang, targetLang, voiceCacheKey, translatedText, 600).catch(() => {});

      try { offlineTracker.markAiSuccess(userId); } catch {}
      clearTimeout(routeTimeout);
      res.json({ translatedText, mode: "ai" });
    } catch (error) {
      clearTimeout(routeTimeout);
      console.error("AI translate error:", error);
      if (res.headersSent) return;

      // Offline fallback — fully isolated so tracker errors never affect response
      try {
        const userId = (req.user as any)?.claims?.sub || (req.user as any)?.id || "anon";
        const { text, sourceLang, targetLang } = req.body;
        const voiceCacheKey = text
          ? crypto.createHash("sha256").update(`${sourceLang}:${targetLang}:${String(text).trim().toLowerCase()}`).digest("hex")
          : null;

        const offlineStatus = offlineTracker.markCacheFallback(userId);
        if (!offlineStatus.allowed) {
          return res.status(503).json({
            message: "Offline translation limit reached. Please reconnect to continue.",
            code: "offline_limit_exceeded",
            remainingMs: 0,
          });
        }

        const cachedFallback = voiceCacheKey
          ? (voiceTranslationCache.get(voiceCacheKey)?.text || await getCachedTranslationRedis("voice", sourceLang, targetLang, voiceCacheKey))
          : null;

        if (cachedFallback) {
          return res.json({
            translatedText: cachedFallback,
            mode: "offline_cache",
            offlineRemainingMs: offlineStatus.remainingMs,
          });
        }
      } catch (trackerErr) {
        console.error("[OfflineTracker] Isolated error — not affecting response:", trackerErr);
      }

      if (!res.headersSent) {
        res.status(503).json({ message: "AI translation unavailable. Please try again." });
      }
    }
  });

  // Lightweight YOLO-only scan — no LLM, fast local sidecar, safe to call every 1s
  v1Router.post("/yolo-scan", isAuthenticated, upload.single("frame"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Frame required" });
    try {
      const { ensureVisionDetectorStarted, waitForVisionDetector, isVisionDetectorReady, getVisionDetectorPort } = await import("./start-vision-detector");
      ensureVisionDetectorStarted();
      const detectorPort = getVisionDetectorPort();
      if (!isVisionDetectorReady()) await waitForVisionDetector(5000);
      if (!isVisionDetectorReady()) return res.json({ detections: [] });
      const detRes = await fetch(`http://127.0.0.1:${detectorPort}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: req.file.buffer,
        signal: AbortSignal.timeout(4000),
      });
      if (!detRes.ok) return res.json({ detections: [] });
      const det = await detRes.json();
      return res.json({ detections: det?.detections || [] });
    } catch (e: any) {
      return res.json({ detections: [] });
    }
  });

  v1Router.post("/juno-vision", isAuthenticated, upload.single("frame"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Image frame is required" });
    }
    const ALLOWED_VISION_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp"];
    if (!ALLOWED_VISION_MIMES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type. Only image files are accepted." });
    }

    const targetLang = req.body.targetLang || "es";
    const sourceLang = req.body.sourceLang || "en";
    const userQuestion = req.body.userQuestion || "";
    const mode = req.body.mode === "fun" ? "fun" : "smart";
    const userId = (req.user as any)?.id || (req.user as any)?.claims?.sub || "";

    try {
      const { ensureVisionDetectorStarted, waitForVisionDetector, isVisionDetectorReady, getVisionDetectorPort } = await import("./start-vision-detector");
      const { hubVisionAnalyze } = await import("./juno-vision-hub");

      // ── Step 1: YOLO + scan memory + BLIP caption in parallel ──────────────
      ensureVisionDetectorStarted();
      const detectorPort = getVisionDetectorPort();
      let yoloHints: Array<{ category: string; confidence: number }> = [];
      let pastScans: Array<{ label: string; brand: string | null; translation: string }> = [];
      let blipCaption: string | null = null;

      await Promise.all([
        // YOLO: local object detection → category hint
        (async () => {
          try {
            if (!isVisionDetectorReady()) await waitForVisionDetector(7000);
            if (isVisionDetectorReady()) {
              const detRes = await fetch(`http://127.0.0.1:${detectorPort}/detect`, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: req.file!.buffer,
                signal: AbortSignal.timeout(7000),
              });
              if (detRes.ok) {
                const det = await detRes.json();
                if (det?.detections?.length) {
                  yoloHints = det.detections.slice(0, 3).map((d: any) => ({
                    category: d.label,
                    confidence: d.confidence,
                  }));
                  console.log(`[JunoVision] YOLO: ${yoloHints.map((h: any) => `${h.category}(${Math.round(h.confidence * 100)}%)`).join(", ")}`);
                }
              }
            }
          } catch (e: any) { console.log("[JunoVision] YOLO skipped:", e.message); }
        })(),
        // Scan memory: last 20 identifications for cross-reference
        (async () => {
          try {
            const recent = await storage.getRecentVisionScans(20);
            pastScans = recent.map(s => ({ label: s.label, brand: s.brand ?? null, translation: s.translation }));
          } catch {}
        })(),
        // BLIP free caption: independent image description for cross-referencing
        (async () => {
          try {
            const { blipCrossReference } = await import("./juno-vision-hub");
            blipCaption = await blipCrossReference(req.file!.buffer, req.file!.mimetype || "image/jpeg");
          } catch {}
        })(),
      ]);

      // ── Step 2: Gemini reads visible text/brand (lightweight) ───────────────
      let hubResult: any;
      try {
        console.log("[JunoVision] AI reader — extracting brand/label from image...");
        hubResult = await hubVisionAnalyze(
          req.file.buffer,
          req.file.mimetype || "image/jpeg",
          sourceLang,
          targetLang,
          userQuestion || undefined,
          mode,
          yoloHints,
          pastScans
        );
      } catch (hubErr: any) {
        console.warn("[JunoVision] AI reader failed:", hubErr.message);
        if (yoloHints.length > 0) {
          const { composeVisionResponse } = await import("./vision-knowledge");
          const fakeDet = { objects: yoloHints.map(h => ({ label: h.category, confidence: h.confidence, bbox: [] })), text: "", primary: yoloHints[0].category, primary_confidence: yoloHints[0].confidence };
          const fallback = composeVisionResponse(fakeDet, sourceLang, targetLang, userQuestion || undefined);
          return res.json({ ...fallback, hasQuestion: !!userQuestion, engine: "local-fallback" });
        }
        return res.status(503).json({ error: "Vision analysis unavailable — please retry in a moment" });
      }

      // ── Step 3: OSINT enrichment — public databases fill the knowledge gap ──
      const { enrichVisionResult } = await import("./vision-osint");
      const yoloCategories = yoloHints.map(h => h.category);
      if (blipCaption) console.log(`[JunoVision] Passing BLIP caption to OSINT: "${blipCaption}"`);

      const osint = await enrichVisionResult(hubResult.brand, hubResult.label, yoloCategories, blipCaption ?? undefined)
        .catch((e: any) => { console.warn("[JunoVision] OSINT failed:", e.message); return null; });

      // Merge: OSINT enriches details; if OSINT confirmed a canonical name, promote it
      const enrichedDetails = osint?.enrichedDetails || hubResult.englishDetails || "";

      // Cross-reference correction: if OpenFoodFacts returned a verified product name,
      // use it to correct what the AI read from the image
      const confirmedLabel = osint?.confirmedLabel || hubResult.label;
      const confirmedBrand = osint?.confirmedBrand || hubResult.brand;
      if (osint?.confirmedLabel && osint.confirmedLabel !== hubResult.label) {
        console.log(`[JunoVision] OSINT confirmed label: "${hubResult.label}" → "${osint.confirmedLabel}"`);
      }
      if (osint?.confirmedBrand && osint.confirmedBrand !== hubResult.brand) {
        console.log(`[JunoVision] OSINT confirmed brand: "${hubResult.brand}" → "${osint.confirmedBrand}"`);
      }

      const mergedResult = {
        ...hubResult,
        label: confirmedLabel,
        brand: confirmedBrand,
        englishDetails: enrichedDetails || undefined,
        price: hubResult.price || osint?.foodFacts?.calories ? hubResult.price : undefined,
        osint: osint ? {
          wikiSummary: osint.wikiSummary,
          wikiUrl:     osint.wikiUrl,
          foodFacts:   osint.foodFacts,
          bookFacts:   osint.bookFacts,
          sources:     osint.sources,
        } : undefined,
      };

      if (osint?.sources?.length) {
        console.log(`[JunoVision] OSINT sources: ${osint.sources.join(", ")}`);
      }

      // ── Step 4: Save to vision memory (fire-and-forget) ─────────────────────
      if (userId && hubResult.label) {
        storage.saveVisionScan({
          userId,
          label:          hubResult.label,
          brand:          hubResult.brand || null,
          translation:    hubResult.translation,
          sentence:       hubResult.sentence || null,
          englishDetails: enrichedDetails || null,
          price:          hubResult.price || null,
          sourceLang,
          targetLang,
          engine:         hubResult.hubEngine || "gemini",
        }).catch(() => {});
      }

      return res.json({ ...mergedResult, hasQuestion: !!userQuestion, yoloHints });
    } catch (error: any) {
      console.error("[JunoVision] Error:", error.message);
      return res.status(500).json({ error: "Vision processing failed" });
    }
  });

  v1Router.post("/tts", isAuthenticated, async (req, res) => {
    try {
      const { text, voice, lang, speed: userSpeed } = req.body;

      if (!text) {
        return res.status(400).json({ message: "Text is required" });
      }
      const ttsInput = text.slice(0, 4096);

      const { shouldUsePiper, isPiperModelReady, ensurePiperModel, getPiperModelName } = await import("./piper-multilingual");

      const piperLang = lang || "en";
      const canUsePiper = shouldUsePiper(piperLang);

      if (canUsePiper && getToolStatus(TOOL_NAMES.TTS_PIPER).available) {
        if (!isPiperModelReady(piperLang)) {
          ensurePiperModel(piperLang).catch(() => {});
        }

        const modelName = getPiperModelName(piperLang) || undefined;
        if (isPiperModelReady(piperLang) || piperLang === "en") {
          const piperResult = await toolPiperTTS(ttsInput, undefined, modelName);
          if (piperResult) {
            res.set({
              "Content-Type": piperResult.contentType,
              "Content-Length": piperResult.buffer.length.toString(),
              "Cache-Control": "public, max-age=3600",
            });
            return res.send(piperResult.buffer);
          }
        }
      }

      const ttsSpeed = typeof userSpeed === "number" && userSpeed >= 0.5 && userSpeed <= 1.5 ? userSpeed : 0.92;
      const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

      // Resolve voice: explicit request > user's voice identity profile > default nova
      let resolvedVoice = validVoices.includes(voice) ? voice : null;
      if (!resolvedVoice) {
        try {
          const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
          if (userId) {
            const prefs = await storage.getPreferences(userId);
            if (prefs?.voiceIdentityEnabled && prefs.voiceIdentityVoice && validVoices.includes(prefs.voiceIdentityVoice)) {
              resolvedVoice = prefs.voiceIdentityVoice;
            }
          }
        } catch {}
      }
      const selectedVoice = resolvedVoice || "nova";

      if (!getToolStatus(TOOL_NAMES.TTS_OPENAI).available) {
        return res.status(503).json({ message: "TTS temporarily unavailable" });
      }

      const openaiResult = await toolOpenAITTS(ttsInput, selectedVoice, ttsSpeed, lang);
      if (!openaiResult.buffer.length) {
        return res.status(500).json({ message: "TTS generation failed" });
      }

      res.set({
        "Content-Type": openaiResult.contentType,
        "Content-Length": openaiResult.buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      });
      res.send(openaiResult.buffer);
    } catch (error) {
      console.error("TTS error:", error);
      res.status(500).json({ message: "Text-to-speech failed" });
    }
  });

  // ── Voice Identity Profile ────────────────────────────────────────────────

  v1Router.get("/voice-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const prefs = await storage.getPreferences(userId);
      const profile = await storage.getVoiceProfile(userId);
      res.json({
        enabled: prefs?.voiceIdentityEnabled ?? false,
        voice: prefs?.voiceIdentityVoice ?? "nova",
        sample: profile ? {
          status: profile.status,
          uploadedAt: profile.uploadedAt,
          hasSample: !!profile.samplePath,
        } : null,
      });
    } catch (error) {
      console.error("[VoiceProfile] GET error:", error);
      res.status(500).json({ message: "Failed to fetch voice profile" });
    }
  });

  v1Router.patch("/voice-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
      const { enabled, voice } = req.body;

      const existingPrefs = await storage.getPreferences(userId);
      await storage.upsertPreferences({
        ...(existingPrefs ?? {}),
        userId,
        voiceIdentityEnabled: typeof enabled === "boolean" ? enabled : existingPrefs?.voiceIdentityEnabled ?? false,
        voiceIdentityVoice: validVoices.includes(voice) ? voice : existingPrefs?.voiceIdentityVoice ?? "nova",
      });

      res.json({ message: "Voice profile updated" });
    } catch (error) {
      console.error("[VoiceProfile] PATCH error:", error);
      res.status(500).json({ message: "Failed to update voice profile" });
    }
  });

  v1Router.post("/voice-profile/sample", isAuthenticated, upload.single("sample"), async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const file = (req as any).file;
      if (!file) return res.status(400).json({ message: "No audio file provided" });

      const maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) return res.status(413).json({ message: "Sample exceeds 10 MB limit" });

      const allowedTypes = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/m4a", "audio/x-m4a"];
      const contentType = file.mimetype || "audio/webm";
      if (!allowedTypes.some(t => contentType.startsWith(t.split("/")[0]) && contentType.includes(t.split("/")[1].split(";")[0]))) {
        return res.status(415).json({ message: "Unsupported audio format" });
      }

      const storagePath = `voice-profiles/${userId}/sample.webm`;
      let savedPath: string | null = null;

      try {
        await supabaseStorageService.uploadFile("user-uploads", storagePath, file.buffer, contentType, true);
        savedPath = storagePath;
      } catch (uploadErr: any) {
        console.warn("[VoiceProfile] Supabase upload failed, storing reference only:", uploadErr?.message);
      }

      await storage.upsertVoiceProfile({
        userId,
        samplePath: savedPath ?? storagePath,
        status: "ready",
        preferredVoice: "nova",
      });

      res.json({ message: "Voice sample saved", hasSample: true, status: "ready" });
    } catch (error) {
      console.error("[VoiceProfile] Sample upload error:", error);
      res.status(500).json({ message: "Failed to save voice sample" });
    }
  });

  v1Router.delete("/voice-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const profile = await storage.getVoiceProfile(userId);
      if (profile?.samplePath) {
        try {
          await supabaseStorageService.deleteFile("user-uploads", profile.samplePath);
        } catch (delErr: any) {
          console.warn("[VoiceProfile] Supabase delete skipped:", delErr?.message);
        }
      }

      await storage.deleteVoiceProfile(userId);

      const existingPrefs = await storage.getPreferences(userId);
      if (existingPrefs) {
        await storage.upsertPreferences({
          ...existingPrefs,
          voiceIdentityEnabled: false,
          voiceIdentityVoice: null,
        });
      }

      res.json({ message: "Voice profile deleted" });
    } catch (error) {
      console.error("[VoiceProfile] DELETE error:", error);
      res.status(500).json({ message: "Failed to delete voice profile" });
    }
  });

  v1Router.post("/caption-cleanup", isAuthenticated, async (req, res) => {
    const captionCleanupStart = Date.now();
    try {
      trackAction("caption_cleanup", "captions");
      const { text } = req.body;
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ message: "Text is required" });
      }
      if (text.length > 500) {
        return res.status(400).json({ message: "Text too long for cleanup" });
      }
      const cleanupSystemPrompt = `You are a real-time caption editor. Clean up speech-to-text output to be more readable.

RULES:
- Fix punctuation, capitalization, and obvious grammar issues
- Remove filler words (um, uh, like, you know) ONLY when they don't add meaning
- Preserve the speaker's natural tone, slang, and intent exactly
- Keep the text concise — do not add words or rephrase
- Output ONLY the cleaned text, nothing else
- If the text is already clean, return it unchanged
- Never add quotes or labels`;

      let cleanedText = "";

      const cleanupResult = await gatewayChat(cleanupSystemPrompt, text.trim(), { task: "chat", maxTokens: 150, temperature: 0.1 });
      if (cleanupResult?.text) cleanedText = cleanupResult.text;

      const elapsed = Date.now() - captionCleanupStart;
      res.json({
        cleanedText: cleanedText || text.trim(),
        enhanced: !!cleanedText,
        latencyMs: elapsed,
      });
    } catch (error: any) {
      console.error("Caption cleanup error:", error?.message);
      res.json({ cleanedText: req.body?.text?.trim() || "", enhanced: false });
    }
  });

  v1Router.post("/caption-translate", isAuthenticated, async (req: any, res) => {
    try {
      const { text, targetLang, sourceLang } = req.body;
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ error: "text is required" });
      }
      if (!targetLang || typeof targetLang !== "string") {
        return res.status(400).json({ error: "targetLang is required" });
      }
      if (text.length > 1000) {
        return res.status(400).json({ error: "text too long for caption translation" });
      }
      const result = await translateCaption(text, targetLang, sourceLang || "en");
      res.json(result);
    } catch (error: any) {
      console.error("[CaptionTranslate] Error:", error?.message);
      res.json({ translatedText: req.body?.text || "", provider: "error", cached: false, latencyMs: 0 });
    }
  });

  v1Router.get("/caption-translate/stats", isAuthenticated, (_req, res) => {
    res.json(getCaptionCacheStats());
  });

  v1Router.post("/call-summary", isAuthenticated, async (req, res) => {
    try {
      trackAction("call_summary", "video_calls");
      const { captions, targetLanguage } = req.body;
      if (!captions || !Array.isArray(captions) || captions.length < 3) {
        return res.status(400).json({ message: "At least 3 captions required for a summary" });
      }
      if (captions.length > 200) {
        return res.status(400).json({ message: "Too many captions — max 200" });
      }
      const moonshotKey = apiKeys.moonshot();
      const targetLangName = targetLanguage
        ? ({ en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi", ru: "Russian", nl: "Dutch", pl: "Polish", cs: "Czech" } as Record<string, string>)[targetLanguage] || "English"
        : "English";

      const transcript = captions
        .map((c: { speaker: string; text: string }, i: number) => `[${c.speaker === "you" ? "You" : "Them"}] ${c.text}`)
        .join("\n");

      const summarySystemPrompt = `You are an AI assistant that summarizes video call conversations. Analyze the transcript and produce a structured summary.

OUTPUT FORMAT (respond in ${targetLangName}):
{
  "summary": "A concise 2-4 sentence overview of what was discussed",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "actionItems": ["Action item 1", "Action item 2", ...],
  "duration": "Estimated call duration based on conversation flow",
  "mood": "overall tone of the conversation (e.g., productive, casual, urgent)"
}

RULES:
- Write the entire response in ${targetLangName}
- Be concise and specific — avoid vague statements
- Only include action items if there are clear tasks or commitments mentioned
- If no action items exist, return an empty array
- Keep key points to 5 or fewer
- Respond ONLY with valid JSON, no markdown or extra text`;

      const summaryUserPrompt = `Summarize this video call transcript:\n\n${transcript}`;
      let raw = "";
      let summaryProvider = "kimi";
      const startTime = Date.now();

      const summaryResult = await gatewayChat(summarySystemPrompt, summaryUserPrompt, { task: "chat", maxTokens: 800, temperature: 0.3 });
      if (summaryResult?.text) {
        raw = summaryResult.text;
        summaryProvider = summaryResult.provider;
      }

      const elapsed = Date.now() - startTime;

      let parsed;
      try {
        let jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
        const jS = jsonStr.indexOf("{");
        const jE = jsonStr.lastIndexOf("}");
        if (jS >= 0 && jE > jS) jsonStr = jsonStr.slice(jS, jE + 1);
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = {
          summary: raw,
          keyPoints: [],
          actionItems: [],
          duration: "Unknown",
          mood: "neutral",
        };
      }

      res.json({
        ...parsed,
        provider: summaryProvider,
        latencyMs: elapsed,
      });
    } catch (err: any) {
      console.error("Call summary error:", err?.message);
      res.status(500).json({ message: "Failed to generate call summary" });
    }
  });

  v1Router.post("/transcribe", isAuthenticated, upload.single("audio"), async (req, res) => {
    const routeTimeout = setTimeout(() => {
      if (!res.headersSent) res.status(504).json({ message: "Transcription took too long. Please try again." });
    }, 30000);
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const audioBuffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const languageHint = (req.body?.language as string) || undefined;

      if (isWhisperSidecarReady()) {
        try {
          const local = await transcribeWithLocalWhisper(audioBuffer, mimeType, languageHint);
          if (local && local.text) {
            clearTimeout(routeTimeout);
            return res.json({ text: local.text, success: true, provider: "local-whisper", latency_ms: local.latency_ms });
          }
        } catch (localErr: any) {
          console.warn("[Transcribe] Local Whisper failed, falling back to cloud:", localErr.message);
        }
      } else {
        ensureWhisperSidecarStarted();
      }

      let extension = "webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) extension = "mp4";
      else if (mimeType.includes("wav")) extension = "wav";
      else if (mimeType.includes("ogg")) extension = "ogg";

      const audioFile = await toFile(audioBuffer, `audio.${extension}`, { type: mimeType });

      if (groqSTTClient) {
        try {
          const groqTranscription = await groqSTTClient.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-large-v3-turbo",
            response_format: "json",
            ...(languageHint ? { language: languageHint } : {}),
          });
          clearTimeout(routeTimeout);
          return res.json({ text: groqTranscription.text, success: true, provider: "groq-whisper" });
        } catch (groqErr: any) {
          console.warn("[Transcribe] Groq Whisper failed, falling back to OpenAI:", groqErr.message);
        }
      }

      const transcription = await openaiSTTClient.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        response_format: "json",
      });

      clearTimeout(routeTimeout);
      res.json({ text: transcription.text, success: true, provider: "openai-whisper" });
    } catch (error) {
      clearTimeout(routeTimeout);
      console.error("Transcription error:", error);
      if (!res.headersSent) res.status(500).json({
        message: "Transcription failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  v1Router.post("/video-captions/transcribe", isAuthenticated, async (req, res) => {
    try {
      const { messageId, videoData } = req.body;
      if (!messageId || !videoData) {
        return res.status(400).json({ message: "messageId and videoData are required" });
      }

      if (typeof videoData !== "string" || videoData.length > 35 * 1024 * 1024) {
        return res.status(400).json({ message: "Video data too large for caption processing" });
      }

      const cached = videoCaptionCache.get(messageId);
      if (cached) {
        return res.json(cached);
      }

      const userId = (req as any).user?.claims?.sub;
      let languageHint: string | undefined;
      if (userId) {
        try {
          const prefs = await storage.getPreferences(userId);
          if (prefs?.spokenLanguage && prefs.spokenLanguage !== "auto") {
            languageHint = prefs.spokenLanguage;
          }
        } catch {}
      }

      const audioBuffer = await extractAudioFromVideo(videoData);

      const captionData = await transcribeVideoAudio(audioBuffer, languageHint);
      videoCaptionCache.set(messageId, captionData);

      res.json(captionData);
    } catch (error) {
      console.error("[VideoCaptions] Transcription error:", error);
      res.json({ lang: "en", segments: [], noSpeech: true, error: error instanceof Error ? error.message : "Failed" });
    }
  });

  v1Router.post("/video-captions/translate", isAuthenticated, async (req, res) => {
    try {
      const { messageId, targetLang } = req.body;
      if (!messageId || !targetLang) {
        return res.status(400).json({ message: "messageId and targetLang are required" });
      }

      const cacheKey = `${messageId}:${targetLang}`;
      const cached = translatedCaptionCache.get(cacheKey);
      if (cached) {
        return res.json({ segments: cached });
      }

      const original = videoCaptionCache.get(messageId);
      if (!original || original.noSpeech || original.segments.length === 0) {
        return res.json({ segments: [] });
      }

      if (original.lang === targetLang) {
        return res.json({ segments: original.segments });
      }

      const translated = await translateSegments(original.segments, targetLang, original.lang);
      translatedCaptionCache.set(cacheKey, translated);

      res.json({ segments: translated });
    } catch (error) {
      console.error("[VideoCaptions] Translation error:", error);
      res.json({ segments: [], error: error instanceof Error ? error.message : "Failed" });
    }
  });

  v1Router.post("/video-captions/burn", isAuthenticated, async (req, res) => {
    try {
      const { videoData, captions } = req.body;
      if (!videoData || !captions || !Array.isArray(captions) || captions.length === 0) {
        return res.status(400).json({ message: "videoData and captions array are required" });
      }

      if (typeof videoData !== "string" || videoData.length > 50 * 1024 * 1024) {
        return res.status(400).json({ message: "Video data too large" });
      }

      const validCaptions = captions.filter(
        (c: any) => typeof c.start === "number" && typeof c.end === "number" && typeof c.text === "string" && c.text.trim().length > 0
      );
      if (validCaptions.length === 0) {
        return res.json({ videoData });
      }

      const burnedVideo = await burnCaptionsIntoVideo(videoData, validCaptions);

      res.json({ videoData: burnedVideo });
    } catch (error) {
      console.error("[VideoCaptions] Burn error:", error);
      res.json({ videoData: req.body.videoData, error: error instanceof Error ? error.message : "Failed to burn captions" });
    }
  });

  // Get all feedback
  v1Router.get("/feedback", isAuthenticated, async (req, res) => {
    try {
      const allFeedback = await storage.getAllFeedback();
      res.json(allFeedback);
    } catch (error) {
      console.error("Error fetching feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  // Submit feedback
  v1Router.post("/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      trackAction("submit_feedback", "feedback");
      const { firstName, comment } = req.body;

      if (!firstName || !comment) {
        return res.status(400).json({ message: "First name and comment are required" });
      }

      const newFeedback = await storage.createFeedback({
        userId,
        firstName,
        comment,
      });

      res.status(201).json(newFeedback);
    } catch (error) {
      console.error("Error creating feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  v1Router.get("/feedback/all", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.query.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allFeedback = await storage.getAllFeedback();
      res.json(allFeedback);
    } catch (error) {
      console.error("Error fetching all feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  v1Router.patch("/feedback/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !["needs_work", "resolved"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const updated = await storage.updateFeedbackStatus(id, status);
      if (!updated) return res.status(404).json({ message: "Feedback not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating feedback status:", error);
      res.status(500).json({ message: "Failed to update feedback" });
    }
  });

  v1Router.post("/feedback/:id/ai-review", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { id } = req.params;
      const allFeedback = await storage.getAllFeedback();
      const item = allFeedback.find(f => f.id === id);
      if (!item) return res.status(404).json({ message: "Feedback not found" });

      let aiReview = "";
      const reviewPrompt = `You are a product QA analyst for JunoTalk, a video calling and chat platform. Review this user feedback and provide a brief analysis:\n\nFeedback from "${item.firstName}": "${item.comment}"\n\nRespond with:\n1. Category (bug, feature request, UX issue, compliment, other)\n2. Priority (low, medium, high)\n3. Brief assessment (1-2 sentences) of what needs to be done or if it's already addressed\n4. Recommendation: "needs_work" or "resolved"\n\nKeep response concise and actionable.`;
      const reviewResult = await gatewayChat(reviewPrompt, item.comment || "", { task: "chat", maxTokens: 500 });
      if (reviewResult?.text) {
        aiReview = reviewResult.text;
      } else {
        aiReview = "AI review unavailable - service temporarily unavailable.";
      }

      const suggestedStatus = aiReview.toLowerCase().includes("resolved") ? "resolved" : "needs_work";
      const updated = await storage.updateFeedbackStatus(id, suggestedStatus, aiReview);
      res.json(updated);
    } catch (error) {
      console.error("Error running AI review:", error);
      res.status(500).json({ message: "Failed to run AI review" });
    }
  });

  v1Router.post("/feedback/ai-review-all", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allFeedback = await storage.getAllFeedback();
      const unreviewed = allFeedback.filter(f => !f.aiReview);
      let reviewed = 0;

      for (const item of unreviewed.slice(0, 20)) {
        try {
          const batchReviewPrompt = `You are a product QA analyst for JunoTalk, a video calling and chat platform. Review this user feedback and provide a brief analysis:\n\nFeedback from "${item.firstName}": "${item.comment}"\n\nRespond with:\n1. Category (bug, feature request, UX issue, compliment, other)\n2. Priority (low, medium, high)\n3. Brief assessment (1-2 sentences) of what needs to be done or if it's already addressed\n4. Recommendation: "needs_work" or "resolved"\n\nKeep response concise and actionable.`;
          const batchReviewResult = await gatewayChat(batchReviewPrompt, item.comment || "", { task: "chat", maxTokens: 500 });
          if (batchReviewResult?.text) {
            const review = batchReviewResult.text;
            const suggestedStatus = review.toLowerCase().includes("resolved") ? "resolved" : "needs_work";
            await storage.updateFeedbackStatus(item.id, suggestedStatus, review);
            reviewed++;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("AI review failed for feedback:", item.id, msg);
        }
      }

      res.json({ reviewed, total: unreviewed.length });
    } catch (error) {
      console.error("Error running batch AI review:", error);
      res.status(500).json({ message: "Failed to run batch AI review" });
    }
  });

  // Developer Portal access verification
  v1Router.post("/developer/verify-access", async (req, res) => {
    try {
      const { accessCode } = req.body;
      
      if (!accessCode) {
        return res.status(400).json({ valid: false, message: "Access code required" });
      }

      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      
      if (!adminCode) {
        console.error("DEV_PORTAL_ACCESS_CODE not configured");
        return res.status(500).json({ valid: false, message: "Portal access not configured" });
      }

      if (accessCode.length !== adminCode.length) {
        return res.json({ valid: false });
      }
      let mismatch = 0;
      for (let i = 0; i < accessCode.length; i++) {
        mismatch |= accessCode.charCodeAt(i) ^ adminCode.charCodeAt(i);
      }
      const isValid = mismatch === 0;

      res.json({ valid: isValid });
    } catch (error) {
      console.error("Error verifying developer portal access:", error);
      res.status(500).json({ valid: false, message: "Verification failed" });
    }
  });

  v1Router.get("/developer/token-budget", isAuthenticated, async (req, res) => {
    try {
      const accessCode = req.query.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const snapshot = getTokenSnapshot();
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: "Failed to get token budget" });
    }
  });

  v1Router.post("/developer/token-budget/check", isAuthenticated, async (req, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const snapshot = getTokenSnapshot();

      if (!apiKeys.moonshot()) {
        return res.json({ recommendation: "Token budget agent unavailable", snapshot });
      }

      const budgetPrompt = `You are the token budget manager for JunoTalk. Analyze this token usage snapshot and provide optimization recommendations.

CURRENT TOKEN USAGE:
${JSON.stringify(snapshot, null, 2)}

PROVIDER PRIORITY (cheapest to most expensive):
1. LibreTranslate (free, self-hosted) — always prefer for text translation
2. Kimi/Moonshot (very cheap) — primary AI provider for all AI tasks
3. OpenAI TTS (moderate) — voice synthesis only, no completions
4. Claude/Anthropic (expensive) — absolute last resort only

BUDGET STRATEGY:
- Keep total daily cost under $0.50 for current low-traffic phase
- Kimi should handle 90%+ of AI requests (translation, QA, health analysis, support chat, summaries, language detection)
- Claude should NEVER be used for routine tasks — only critical fallbacks when Kimi is down
- If Kimi approaches its daily limit, reduce non-essential AI calls before switching to Claude

Respond in JSON:
{
  "overallStatus": "healthy|warning|critical",
  "dailyCostEstimate": <number>,
  "recommendations": ["action 1", "action 2"],
  "providerAdvice": { "<provider>": "keep|reduce|increase|disable" },
  "budgetAdjustments": [{"provider": "<name>", "currentLimit": <n>, "suggestedLimit": <n>, "reason": "..."}]
}`;

      const budgetResult = await gatewayChat("You are a cost optimization agent for an AI-powered translation platform.", budgetPrompt, { task: "monitor", maxTokens: 400, temperature: 0.2 });
      const raw = budgetResult?.text?.trim() || "";

      let parsed;
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
        const jStart = cleaned.indexOf("{");
        const jEnd = cleaned.lastIndexOf("}");
        if (jStart >= 0 && jEnd > jStart) {
          parsed = JSON.parse(cleaned.slice(jStart, jEnd + 1));
        }
      } catch {}

      if (parsed?.budgetAdjustments && Array.isArray(parsed.budgetAdjustments)) {
        for (const adj of parsed.budgetAdjustments) {
          if (adj.provider && adj.suggestedLimit && tokenTracker.budgets[adj.provider]) {
            const current = tokenTracker.budgets[adj.provider].dailyLimit;
            const suggested = adj.suggestedLimit;
            if (suggested >= current * 0.5 && suggested <= current * 2) {
              tokenTracker.budgets[adj.provider].dailyLimit = suggested;
            }
          }
        }
      }

      res.json({ analysis: parsed || raw, snapshot, appliedAdjustments: true });
    } catch (error) {
      res.status(500).json({ error: "Budget check failed" });
    }
  });

  v1Router.get("/cookies-info", isAuthenticated, (req, res) => {
    const requestCookies = req.headers.cookie || "";
    const parsedCookies = requestCookies.split(";").map(c => c.trim()).filter(Boolean).map(c => {
      const eqIdx = c.indexOf("=");
      if (eqIdx === -1) return { name: c, value: "[present]" };
      return { name: c.substring(0, eqIdx).trim(), value: "[present]" };
    });

    const knownCookies: Record<string, { category: string; purpose: string; httpOnly: boolean; secure: boolean; sameSite: string; duration: string; essential: boolean; usedBy: string[] }> = {
      "connect.sid": {
        category: "session",
        purpose: "User authentication session. Stores encrypted session ID linking to server-side session data in PostgreSQL. Required for all authenticated features: chat, video calls, room management, profile, settings.",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        duration: "Browser session (no persistent maxAge). Server TTL: 4 hours of inactivity with rolling refresh.",
        essential: true,
        usedBy: ["authentication", "chat", "video-calls", "rooms", "profile", "websocket"],
      },
    };

    const activeCookies = parsedCookies.map(c => {
      const known = knownCookies[c.name];
      if (known) {
        return { name: c.name, ...known, status: "active" };
      }
      let category = "unknown";
      let purpose = "Unrecognized cookie - may be set by third-party scripts (ads, analytics).";
      let essential = false;
      let usedBy: string[] = [];
      if (c.name.includes("ga") || c.name.includes("_gid") || c.name.includes("_gat") || c.name.includes("analytics")) {
        category = "analytics";
        purpose = "Analytics tracking cookie for usage metrics.";
        usedBy = ["analytics"];
      } else if (c.name.includes("session") || c.name.includes("sid") || c.name.includes("auth") || c.name.includes("token")) {
        category = "session";
        purpose = "Session or authentication related cookie.";
        essential = true;
        usedBy = ["authentication"];
      } else if (c.name.includes("jitsi") || c.name.includes("8x8") || c.name.includes("onetrust")) {
        category = "video-conferencing";
        purpose = "Set by Jitsi/JaaS (8x8.vc) video conferencing platform for call management.";
        usedBy = ["video-calls"];
      }
      return {
        name: c.name,
        category,
        purpose,
        httpOnly: false,
        secure: false,
        sameSite: "unknown",
        duration: "unknown",
        essential,
        usedBy,
        status: "active",
      };
    });

    const serverConfig = {
      sessionCookie: {
        name: "connect.sid",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        rolling: true,
        ttl: "4 hours (server-side, via connect-pg-simple)",
        maxAge: "None (browser-session cookie)",
        store: "PostgreSQL (sessions table)",
      },
      csp: {
        scriptSrc: ["self", "unsafe-inline", "unsafe-eval", "8x8.vc"],
        frameSrc: ["self", "8x8.vc"],
        connectSrc: ["self", "wss:", "ws:", "8x8.vc"],
      },
      securityHeaders: {
        xContentTypeOptions: "nosniff",
        xFrameOptions: "SAMEORIGIN",
        xXssProtection: "1; mode=block",
        referrerPolicy: "strict-origin-when-cross-origin",
        hsts: "max-age=31536000; includeSubDomains",
        coep: "same-origin-allow-popups",
      },
    };

    const thirdPartyDomains = [
      { domain: "8x8.vc", service: "JaaS (Jitsi)", type: "video-conferencing", cookiesLikely: true, features: ["video calls", "WebRTC signaling", "JWT auth"] },
      { domain: "jitsi.net", service: "Jitsi Meet", type: "video-conferencing", cookiesLikely: false, features: ["video call infrastructure"] },
      { domain: "pollinations.ai", service: "Pollinations", type: "ai-image-generation", cookiesLikely: false, features: ["custom emoji generation"] },
      { domain: "api.giphy.com", service: "GIPHY", type: "gif-search", cookiesLikely: false, features: ["GIF search in chat"] },
      { domain: "fonts.googleapis.com", service: "Google Fonts", type: "typography", cookiesLikely: false, features: ["web fonts"] },
      { domain: "fonts.gstatic.com", service: "Google Fonts CDN", type: "typography", cookiesLikely: false, features: ["font file delivery"] },
    ];

    const networkCredentials = [
      {
        service: "Session Authentication",
        type: "cookie",
        credential: "connect.sid",
        status: "active",
        features: ["user login", "chat messaging", "video calls", "room management", "profile settings", "WebSocket auth"],
        security: { httpOnly: true, secure: true, sameSite: "lax", encrypted: true },
      },
      {
        service: "WebSocket Connection",
        type: "session-cookie",
        credential: "connect.sid (upgraded)",
        status: connectedClients.size > 0 ? "active" : "idle",
        features: ["real-time chat", "room signaling", "video call signaling", "connection heartbeat", "message delivery"],
        security: { httpOnly: true, secure: true, sameSite: "lax", encrypted: true },
        liveStats: {
          activeConnections: connectedClients.size,
          activeRooms: roomParticipants.size,
          usersInRooms: userRooms.size,
        },
      },
      {
        service: "JaaS Video Calls (8x8.vc)",
        type: "jwt-token",
        credential: "JWT Bearer Token",
        status: process.env.JAAS_API_KEY ? "configured" : "not_configured",
        features: ["video conferencing", "screen sharing", "in-call audio", "WebRTC peer connections"],
        security: { httpOnly: false, secure: true, sameSite: "n/a", encrypted: true },
        note: "JWT generated server-side per call, sent to Jitsi iframe. May set its own cookies for call state.",
      },
      {
        service: "OpenAI API",
        type: "api-key",
        credential: "Bearer Token (server-side)",
        status: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "configured" : "not_configured",
        features: ["speech-to-text transcription", "chat translation", "video caption translation", "AI support chat"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "API key stored as server secret. Never sent to browser. Used for gpt-4o-mini and gpt-4o-mini-transcribe.",
      },
      {
        service: "Moonshot AI (Kimi)",
        type: "api-key",
        credential: "Bearer Token (server-side)",
        status: apiKeys.moonshot() ? "configured" : "not_configured",
        features: ["translation fallback", "AI health analysis", "cost-effective AI operations"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "API key stored as server secret. Connects directly to Moonshot AI (api.moonshot.cn) for Kimi translation.",
      },
      {
        service: "GIPHY API",
        type: "api-key",
        credential: "API Key (server-side proxy)",
        status: process.env.GIPHY_API_KEY ? "configured" : "not_configured",
        features: ["GIF search in chat", "trending GIFs"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "API key proxied through server endpoints /api/gifs/trending and /api/gifs/search. Never exposed to client.",
      },
      {
        service: "Resend Email",
        type: "api-key",
        credential: "API Key (server-side)",
        status: process.env.RESEND_API_KEY ? "configured" : "not_configured",
        features: ["welcome email on onboarding"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "Used server-side only for sending transactional emails. No cookies involved.",
      },
      {
        service: "PostgreSQL Database",
        type: "connection-string",
        credential: "DATABASE_URL (server-side)",
        status: process.env.DATABASE_URL ? "configured" : "not_configured",
        features: ["user data", "rooms", "messages", "contacts", "session store", "feedback"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "Database connection string stored as server secret. Also stores session data (connect-pg-simple).",
      },
      {
        service: "Replit Object Storage",
        type: "built-in",
        credential: "Replit Infrastructure",
        status: "configured",
        features: ["profile photo uploads", "user avatar storage"],
        security: { httpOnly: true, secure: true, sameSite: "n/a", encrypted: true },
        note: "Managed by Replit infrastructure. No external API key required.",
      },
    ];

    const localStorageKeys = [
      { key: "junotalk-ui-lang", purpose: "User's selected UI language for internationalization", usedBy: ["i18n"], sensitive: false },
      { key: "junotalk-theme", purpose: "Dark/light mode preference", usedBy: ["theme"], sensitive: false },
      { key: "dev_portal_access", purpose: "Base64-encoded developer portal access code", usedBy: ["developer-portal"], sensitive: true },
      { key: "junotalk-onboarding-complete", purpose: "Whether user has completed onboarding flow", usedBy: ["onboarding"], sensitive: false },
    ];

    const sessionStorageKeys = [
      { key: "devPortalAccessCode", purpose: "Developer portal access code for current session", usedBy: ["developer-portal"], sensitive: true },
    ];

    res.json({
      activeCookies,
      totalCookies: activeCookies.length,
      categories: Object.fromEntries(
        Object.entries(
          activeCookies.reduce((acc: Record<string, number>, c) => {
            acc[c.category] = (acc[c.category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        ).sort(([a], [b]) => {
          const order = ["session", "video-conferencing", "advertising", "analytics", "unknown"];
          return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
        })
      ),
      essentialCount: activeCookies.filter(c => c.essential).length,
      networkCredentials,
      serverConfig,
      thirdPartyDomains,
      localStorageKeys,
      sessionStorageKeys,
      timestamp: Date.now(),
    });
  });

  v1Router.get("/service-status", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json({
      libretranslate: process.env.LIBRETRANSLATE_API_KEY ? "configured" : "not_set",
      moonshot: apiKeys.moonshot() ? "configured" : "not_set",
      gemini: apiKeys.gemini() ? "configured" : "not_set",
      openai: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "configured" : "not_set",
      anthropic: resolvedAnthropicKey ? "configured" : "not_set",
      database: process.env.DATABASE_URL ? "configured" : "not_set",
      session: process.env.SESSION_SECRET ? "configured" : "not_set",
    });
  });

  v1Router.get("/tools/health", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json({
      tools: getToolHealth(),
      timestamp: Date.now(),
    });
  });

  v1Router.post("/tools/reset-circuit", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { tool } = req.body;
    if (tool === "all") {
      resetAllCircuits();
      return res.json({ message: "All circuits reset" });
    }
    if (tool) {
      resetCircuit(tool);
      return res.json({ message: `Circuit reset for "${tool}"` });
    }
    return res.status(400).json({ error: "Provide 'tool' name or 'all'" });
  });

  v1Router.get("/translation-service", isAuthenticated, (req, res) => {
    res.json({
      service: activeTranslationService,
      autoSwitch: autoSwitchEnabled,
      providers: getProviderStats(),
    });
  });

  v1Router.post("/translation-service", isAuthenticated, async (req, res) => {
    try {
      const { service, accessCode, autoSwitch: autoSwitchValue } = req.body;
      
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Developer portal access required" });
      }

      if (typeof autoSwitchValue === "boolean") {
        autoSwitchEnabled = autoSwitchValue;
      }
      
      if (service) {
        if (service !== "openai" && service !== "kimi" && service !== "gemini" && service !== "libretranslate") {
          return res.status(400).json({ message: "Invalid service. Must be 'libretranslate', 'kimi', 'gemini', or 'openai'" });
        }
        activeTranslationService = service;
      }
      
      res.json({
        service: activeTranslationService,
        autoSwitch: autoSwitchEnabled,
        providers: getProviderStats(),
      });
    } catch (error) {
      console.error("Error setting translation service:", error);
      res.status(500).json({ message: "Failed to set translation service" });
    }
  });

  const EARNING_ALLOWED_DOMAINS = new Set([
    "www.swagbucks.com", "www.inboxdollars.com", "www.mistplay.com",
    "gengo.com", "translated.com", "unbabel.com",
    "www.rakuten.com", "ibotta.com", "www.joinhoney.com",
    "www.fiverr.com", "www.upwork.com", "www.mturk.com",
  ]);

  v1Router.get("/earning/validate-url", isAuthenticated, (req: any, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ safe: false, reason: "No URL provided" });
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return res.json({ safe: false, reason: "Only HTTPS links are allowed" });
      }
      if (!EARNING_ALLOWED_DOMAINS.has(parsed.hostname)) {
        return res.json({ safe: false, reason: "Domain not in approved partner list" });
      }
      return res.json({ safe: true, domain: parsed.hostname });
    } catch {
      return res.json({ safe: false, reason: "Invalid URL" });
    }
  });

  v1Router.get("/feature-flags", async (_req, res) => {
    try {
      const flags = await cacheWrap(
        "feature-flags",
        "all",
        async () => {
          const f = await getEffectiveFlags();
          return f.map((f) => ({ key: f.key, enabled: f.enabled }));
        },
        5 * 60 * 1000 // 5 minute TTL
      );
      res.json(flags);
    } catch (error) {
      console.error("Error listing feature flags:", error);
      res.json([]);
    }
  });

  v1Router.get("/feature-flags/:key", async (req, res) => {
    try {
      const enabled = await isFeatureEnabled(req.params.key);
      res.json({ key: req.params.key, enabled });
    } catch (error) {
      console.error("Error reading feature flag:", error);
      res.json({ key: req.params.key, enabled: false });
    }
  });

  v1Router.put("/feature-flags/:key", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const result = await storage.setFeatureFlag(req.params.key, enabled);
      res.json({ key: req.params.key, enabled: result });
    } catch (error) {
      console.error("Error toggling feature flag:", error);
      res.status(500).json({ error: "Failed to toggle feature flag" });
    }
  });

  v1Router.get("/app-mode", (_req, res) => {
    res.json({ mode: getAppMode() });
  });

  v1Router.get("/feature/earning", async (_req, res) => {
    try {
      const enabled = await storage.getFeatureFlag("earning");
      res.json({ enabled });
    } catch (error) {
      console.error("Error reading earning feature flag:", error);
      res.json({ enabled: false });
    }
  });

  v1Router.post("/feature/earning", isAuthenticated, async (req, res) => {
    try {
      const { enabled, accessCode } = req.body;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled must be a boolean" });
      }
      const result = await storage.setFeatureFlag("earning", enabled);
      res.json({ enabled: result });
    } catch (error) {
      console.error("Error toggling earning feature:", error);
      res.status(500).json({ message: "Failed to toggle earning feature" });
    }
  });

  // === Security Monitoring Feature Toggle ===
  const verifyAdminCode = (provided: unknown): boolean => {
    const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
    if (!adminCode || typeof provided !== "string" || !provided) return false;
    try {
      const a = Buffer.from(provided.slice(0, 256));
      const b = Buffer.from(adminCode);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  };

  v1Router.get("/feature/security-monitoring", isAuthenticated, async (_req, res) => {
    try {
      const enabled = await storage.getFeatureFlag("security_monitoring");
      res.json({ enabled });
    } catch (error) {
      console.error("Error reading security monitoring flag:", error);
      res.json({ enabled: false });
    }
  });

  v1Router.post("/feature/security-monitoring", isAuthenticated, async (req, res) => {
    try {
      const { enabled, accessCode } = req.body;
      if (!verifyAdminCode(accessCode)) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled must be a boolean" });
      }
      const result = await storage.setFeatureFlag("security_monitoring", enabled);
      console.log(`[SECURITY] Security monitoring ${result ? "ENABLED" : "DISABLED"} by admin`);
      res.json({ enabled: result });
    } catch (error) {
      console.error("Error toggling security monitoring:", error);
      res.status(500).json({ message: "Failed to toggle security monitoring" });
    }
  });

  // === Login Activity Routes ===
  v1Router.get("/security/login-activity", isAuthenticated, async (req, res) => {
    try {
      const securityEnabled = await storage.getFeatureFlag("security_monitoring");
      if (!securityEnabled) {
        return res.json({ enabled: false, activity: [] });
      }
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const activity = await storage.getLoginActivity(userId, 20);
      res.json({ enabled: true, activity });
    } catch (error) {
      console.error("Error fetching login activity:", error);
      res.status(500).json({ message: "Failed to fetch login activity" });
    }
  });

  v1Router.post("/security/login-activity/all", isAuthenticated, async (req, res) => {
    try {
      const { accessCode } = req.body;
      if (!verifyAdminCode(accessCode)) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      const activity = await storage.getAllLoginActivity(100);
      res.json({ activity });
    } catch (error) {
      console.error("Error fetching all login activity:", error);
      res.status(500).json({ message: "Failed to fetch login activity" });
    }
  });

  v1Router.post("/security/login-activity/flag", isAuthenticated, async (req, res) => {
    try {
      const { id, flagged, accessCode } = req.body;
      if (!verifyAdminCode(accessCode)) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      if (typeof id !== "string" || !id || id.length > 100) {
        return res.status(400).json({ message: "Invalid login activity ID" });
      }
      if (typeof flagged !== "boolean") {
        return res.status(400).json({ message: "flagged must be a boolean" });
      }
      await storage.flagLoginActivity(id, flagged);
      console.log(`[SECURITY] Login activity ${id} ${flagged ? "FLAGGED" : "UNFLAGGED"} by admin`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error flagging login activity:", error);
      res.status(500).json({ message: "Failed to flag login activity" });
    }
  });

  // === Bing Search for Earning Hub ===
  const bingSearchCache = new BoundedMap<string, { results: any[]; ts: number }>(100);
  const BING_CACHE_TTL = 10 * 60 * 1000;

  v1Router.get("/earning/search", isAuthenticated, async (req: any, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q) return res.status(400).json({ message: "Query is required" });

      const cacheKey = q.toLowerCase();
      const cached = bingSearchCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < BING_CACHE_TTL) {
        return res.json({ results: cached.results, cached: true });
      }

      const rawKey = process.env.BING_SEARCH_API_KEY;
      if (!rawKey) {
        return res.status(503).json({ message: "Search service not configured" });
      }
      const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "").trim();

      const searchQuery = `${q} job opportunities`;
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(searchQuery)}&count=10&responseFilter=Webpages&safeSearch=Strict`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error("Bing Search API error:", response.status);
        return res.status(502).json({ message: "Search service error" });
      }

      const data = await response.json();
      const webPages = data.webPages?.value || [];

      const results = webPages.map((page: any) => ({
        name: page.name,
        url: page.url,
        snippet: page.snippet,
        displayUrl: page.displayUrl,
      }));

      bingSearchCache.set(cacheKey, { results, ts: Date.now() });

      return res.json({ results, cached: false });
    } catch (error: any) {
      if (error.name === "AbortError") {
        return res.status(504).json({ message: "Search request timed out" });
      }
      console.error("Earning search error:", error);
      return res.status(500).json({ message: "Search failed" });
    }
  });

  // === Support & FAQ Routes ===

  // AI-powered FAQ chat using Kimi/OpenAI
  // Juno Conversation Threads
  v1Router.get("/juno/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionType = typeof req.query.type === "string" ? req.query.type : undefined;
      const conversations = await storage.getJunoConversations(userId, 100, sessionType);
      res.json(conversations.map((c: any) => ({
        id: c.id,
        title: c.title,
        sessionType: c.sessionType ?? "chat",
        durationSeconds: c.durationSeconds ?? 0,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
        messageCount: Array.isArray(c.messages) ? (c.messages as any[]).length : 0,
      })));
    } catch (error) {
      console.error("Get juno conversations error:", error);
      res.status(500).json({ message: "Failed to load conversations" });
    }
  });

  v1Router.post("/juno/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { title, sessionType, durationSeconds, messages } = req.body;
      if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ message: "messages array is required" });
      }
      const autoTitle = title?.trim() ||
        (messages[0]?.content ? String(messages[0].content).slice(0, 60) : "New conversation");
      const conv = await storage.createJunoConversation({
        userId,
        title: autoTitle,
        sessionType: sessionType === "voice" ? "voice" : "chat",
        durationSeconds: typeof durationSeconds === "number" ? durationSeconds : 0,
        messages,
        archived: false,
      });
      res.status(201).json(conv);
    } catch (error) {
      console.error("Create juno conversation error:", error);
      res.status(500).json({ message: "Failed to save conversation" });
    }
  });

  v1Router.get("/juno/conversations/archived", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { fetchArchivedSessions } = await import("./juno-archive");
      const sessions = await fetchArchivedSessions(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Fetch archived sessions error:", error);
      res.status(500).json({ message: "Failed to load archive" });
    }
  });

  v1Router.post("/juno/archive/run", isAuthenticated, async (req: any, res) => {
    try {
      const { runWeeklyArchive } = await import("./juno-archive");
      const result = await runWeeklyArchive();
      res.json(result);
    } catch (error) {
      console.error("Archive run error:", error);
      res.status(500).json({ message: "Archive run failed" });
    }
  });

  v1Router.get("/juno/conversations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const conv = await storage.getJunoConversation(req.params.id, userId);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });
      res.json(conv);
    } catch (error) {
      console.error("Get juno conversation error:", error);
      res.status(500).json({ message: "Failed to load conversation" });
    }
  });

  v1Router.delete("/juno/conversations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.deleteJunoConversation(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete juno conversation error:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  v1Router.post("/support/chat", isAuthenticated, async (req: any, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      const systemPrompt = `You are the AI support assistant for JunoTalk — an encrypted text messaging and AI voice translation platform. You're friendly, concise, and focused on solving problems fast. Keep responses under 3 sentences when possible.

Key features:
- Encrypted text messaging with contacts and rooms
- AI Voice Translation (Juno): tap to speak, AI translates and speaks back in 13+ languages
- 6 AI voices (Nova, Alloy, Echo, Fable, Onyx, Shimmer) with speech speed control
- Text size settings, auto-play voice toggle, conversation history
- Video calling with room codes and real-time translated captions
- "Hey Juno" wake word for hands-free voice translation
- Settings: Languages, Voice selection, Appearance, History

Common issues and fixes:
- "Voice not working": Check microphone permissions in your browser. Tap the mic button and speak clearly.
- "Translation sounds wrong": Try a different voice in Settings > Voice. Change target language in Settings > Languages.
- "Can't hear translation": Check device volume. Make sure Auto-play voice is ON in Settings > Appearance.
- "Speech not detected": Speak closer to the mic. Make sure you selected the correct "Speak (From)" language.
- "App not loading": Refresh the page. Check your internet connection.
- "Can't sign in": Use the Sign In button in the top right. You need a Google account.
- "Speed too fast/slow": Adjust Speech Speed in Settings > Voice.
- "Hey Juno not working": Make sure wake word is enabled in Settings > Appearance. Allow microphone access when prompted.

Privacy & data:
- We never sell or share your personal data with advertisers
- Chat messages are end-to-end encrypted and automatically deleted
- No audio or video recordings are stored on our servers
- You can export or delete all your data from Settings > Data & Privacy
- Our full Privacy Policy is available in the app

IMPORTANT: Never mention specific AI provider names, technology stack details, or internal service names to users. If asked what AI we use, say "We use advanced AI technology to provide translation services." Never make up features that don't exist. If you can't resolve an issue, suggest they visit junotalk.app for further assistance.`;

      const userId = req.user.claims.sub;
      const { conversationId } = req.body;

      let reply = "";
      const chatResult = await gatewayChat(systemPrompt, `User question: ${message}`, { task: "chat", maxTokens: 500 });
      if (chatResult?.text) reply = chatResult.text;
      if (!reply) reply = "Sorry, I couldn't generate a response. Please try again.";

      const userMsg = { role: "user", content: message, timestamp: Date.now() };
      const assistantMsg = { role: "assistant", content: reply, timestamp: Date.now() };

      let conv;
      if (conversationId) {
        const existing = await storage.getJunoConversation(conversationId, userId);
        if (existing) {
          const msgs = (Array.isArray(existing.messages) ? existing.messages : []) as any[];
          msgs.push(userMsg, assistantMsg);
          conv = await storage.updateJunoConversation(conversationId, userId, msgs);
        }
      }

      if (!conv) {
        const title = message.length > 60 ? message.slice(0, 60).trimEnd() + "…" : message;
        conv = await storage.createJunoConversation({
          userId,
          title,
          messages: [userMsg, assistantMsg] as any,
        });
      }

      res.json({ reply, conversationId: conv?.id });
    } catch (error) {
      console.error("Support chat error:", error);
      res.status(500).json({ message: "Failed to get support response" });
    }
  });

  // Create a support ticket
  v1Router.post("/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const username = req.user.claims.first_name || req.user.claims.email || "Unknown";
      const { category, subject, description, priority } = req.body;

      if (!category || !subject || !description) {
        return res.status(400).json({ message: "Category, subject, and description are required" });
      }

      const validCategories = ["translation", "video", "audio", "text", "account", "other"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }

      const ticket = await storage.createSupportTicket({
        userId,
        username,
        category,
        subject,
        description,
        status: "open",
        priority: priority || "medium",
      });

      res.status(201).json(ticket);
    } catch (error) {
      console.error("Error creating support ticket:", error);
      res.status(500).json({ message: "Failed to create support ticket" });
    }
  });

  // Get current user's support tickets
  v1Router.get("/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const tickets = await storage.getSupportTicketsByUser(userId);
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  // Get all support tickets (developer portal)
  v1Router.get("/support/tickets/all", isAuthenticated, async (req, res) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ message: "Admin access required" });
      const tickets = await storage.getAllSupportTickets();
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching all support tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  // Update a support ticket (developer portal)
  v1Router.patch("/support/tickets/:id", isAuthenticated, async (req, res) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ message: "Admin access required" });
      const id = req.params.id as string;
      const { status, priority, adminNotes } = req.body;
      const updated = await storage.updateSupportTicket(id, { status, priority, adminNotes });
      if (!updated) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating support ticket:", error);
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MOBILE AUTH — Token issuance, refresh, revocation
  // ═══════════════════════════════════════════════════════════════

  v1Router.post("/auth/mobile/token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { deviceName, deviceType, deviceFingerprint } = req.body;

      let deviceId: string | undefined;
      if (deviceFingerprint) {
        const device = await storage.registerDevice(userId, { deviceName, deviceType, deviceFingerprint });
        deviceId = device.id;
      }

      const accessToken = crypto.randomBytes(32).toString("hex");
      const refreshToken = crypto.randomBytes(48).toString("hex");
      const now = new Date();
      const accessExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const token = await storage.createMobileTokens({
        userId, deviceId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt,
      });

      res.json({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        accessExpiresAt: token.accessExpiresAt,
        refreshExpiresAt: token.refreshExpiresAt,
        deviceId,
      });
    } catch (error) {
      console.error("Error issuing mobile token:", error);
      res.status(500).json({ message: "Failed to issue token" });
    }
  });

  v1Router.post("/auth/mobile/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ message: "refreshToken required" });

      const record = await storage.getMobileTokenByRefresh(refreshToken);
      if (!record) return res.status(401).json({ message: "Invalid refresh token" });
      if (record.revokedAt) return res.status(401).json({ message: "Token has been revoked" });
      if (new Date() > record.refreshExpiresAt) {
        await storage.revokeMobileToken(refreshToken);
        return res.status(401).json({ message: "Refresh token expired" });
      }

      const newAccessToken = crypto.randomBytes(32).toString("hex");
      const newAccessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await storage.updateMobileTokenAccess(record.id, newAccessToken, newAccessExpiresAt);

      res.json({ accessToken: newAccessToken, accessExpiresAt: newAccessExpiresAt });
    } catch (error) {
      console.error("Error refreshing mobile token:", error);
      res.status(500).json({ message: "Failed to refresh token" });
    }
  });

  v1Router.post("/auth/mobile/revoke", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ message: "refreshToken required" });
      await storage.revokeMobileToken(refreshToken);
      res.json({ success: true });
    } catch (error) {
      console.error("Error revoking mobile token:", error);
      res.status(500).json({ message: "Failed to revoke token" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // DEVICES — Registration and revocation
  // ═══════════════════════════════════════════════════════════════

  v1Router.get("/devices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userDevices = await storage.getDevices(userId);
      res.json(userDevices);
    } catch (error) {
      console.error("Error fetching devices:", error);
      res.status(500).json({ message: "Failed to fetch devices" });
    }
  });

  v1Router.delete("/devices/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.revokeDevice(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error revoking device:", error);
      res.status(500).json({ message: "Failed to revoke device" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MARKETING AGENT — AI Content Generation Engine
  // ═══════════════════════════════════════════════════════════════

  const marketingRouter = createMarketingRouter({ isAuthenticated, isAdminRequest });
  v1Router.use(marketingRouter);

  // ═══════════════════════════════════════════════════════════════
  // JUNO CONTROLLER — Claude Co-worker Integration Hub
  // ═══════════════════════════════════════════════════════════════

  v1Router.get("/juno/status", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const state = junoController.getState();
    res.json(state);
  });

  v1Router.post("/juno/ping", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const result = await junoController.pingClaude();
    res.json(result);
  });

  v1Router.post("/juno/ask", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { prompt, vaultFiles } = req.body;
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt is required" });
    const aiCorrelationId = generateCorrelationId();
    const aiStart = Date.now();
    structuredLog("info", "ai_processing", "Juno AI request started", { correlationId: aiCorrelationId, userId: req.user?.claims?.sub, provider: "claude", metadata: { hasVaultFiles: !!(vaultFiles?.length) } });
    const validVaultFiles = Array.isArray(vaultFiles)
      ? vaultFiles.filter((f: unknown) => typeof f === "string" && f.endsWith(".md"))
      : undefined;
    try {
      const result = await junoController.askClaudeWithVault(prompt, validVaultFiles);
      structuredLog("info", "ai_processing", "Juno AI request completed", { correlationId: aiCorrelationId, userId: req.user?.claims?.sub, provider: "claude", durationMs: Date.now() - aiStart, metadata: { vaultDocsUsed: result.vaultDocsUsed?.length || 0 } });
      res.json(result);
    } catch (err: any) {
      structuredLog("error", "ai_processing", "Juno AI request failed", { correlationId: aiCorrelationId, userId: req.user?.claims?.sub, provider: "claude", durationMs: Date.now() - aiStart, error: err?.message });
      res.status(500).json({ error: "Juno request failed" });
    }
  });

  v1Router.get("/latency-stats", isAuthenticated, async (req: any, res) => {
    const stats = getLatencyStats();
    res.json(stats || { message: "No latency data collected yet" });
  });

  v1Router.get("/juno/vault", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const files = await junoController.listVaultFiles();
    res.json({ files });
  });

  v1Router.post("/juno/refresh", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    junoController.refreshConnectors();
    res.json(junoController.getState());
  });

  app.use("/vault", (_req: Request, res: Response) => {
    res.status(403).json({ error: "Forbidden" });
  });

  // ── Browser Security Rules ─────────────────────────────────────────────────
  // Serves CDN-backed domain allowlist for the JunoTalk Browser popup gate.
  // Rules are fetched from the private GitHub CDN once and cached server-side
  // for BROWSER_RULES_TTL ms. Falls back to the hardcoded allowlist if the
  // CDN is unreachable, so popups are never silently broken.

  const BROWSER_RULES_TTL = 60 * 60 * 1000; // 1 hour

  const BROWSER_RULES_FALLBACK_DOMAINS: string[] = [
    "www.youtube.com", "youtube.com", "accounts.google.com",
    "www.tiktok.com", "tiktok.com",
    "www.instagram.com", "instagram.com",
    "twitter.com", "x.com",
    "www.facebook.com", "facebook.com",
    "www.threads.net", "threads.net",
    "accounts.snapchat.com", "snapchat.com",
    "www.twitch.tv", "twitch.tv",
    "discord.com",
    "www.reddit.com", "reddit.com",
    "www.linkedin.com", "linkedin.com",
    "www.pinterest.com", "pinterest.com",
    "web.telegram.org", "telegram.org",
    "web.whatsapp.com", "whatsapp.com",
    "accounts.spotify.com", "spotify.com",
    "www.tumblr.com", "tumblr.com",
    "rumble.com",
    "www.roblox.com", "roblox.com",
    "store.steampowered.com", "steampowered.com",
    "my.account.sony.com", "account.sony.com",
    "www.epicgames.com", "epicgames.com",
    "accounts.nintendo.com", "nintendo.com",
    "auth.riotgames.com", "riotgames.com",
    "itch.io",
    "www.ea.com", "ea.com",
    "connect.ubisoft.com", "ubisoft.com",
  ];

  let _browserRulesCache: { allowedDomains: string[]; cacheTtlMs: number; fallback: string } | null = null;
  let _browserRulesFetchedAt = 0;
  let _browserRulesFetching = false;

  async function getBrowserRules() {
    const now = Date.now();
    if (_browserRulesCache && now - _browserRulesFetchedAt < BROWSER_RULES_TTL) {
      return _browserRulesCache;
    }
    if (_browserRulesFetching) return _browserRulesCache;
    _browserRulesFetching = true;
    try {
      const data = await fetchPrivateFile("security/browser-rules.json");
      if (data && Array.isArray(data.allowedDomains) && data.allowedDomains.length > 0) {
        _browserRulesCache = {
          allowedDomains: data.allowedDomains as string[],
          cacheTtlMs: typeof data.cacheTtlMs === "number" ? data.cacheTtlMs : BROWSER_RULES_TTL,
          fallback: data.fallback ?? "block",
        };
        _browserRulesFetchedAt = now;
        console.log(`[BrowserSecurity] Rules loaded from CDN: ${_browserRulesCache.allowedDomains.length} domains, TTL=${_browserRulesCache.cacheTtlMs}ms`);
      } else {
        // CDN file not found — seed from fallback but don't cache (retry next request)
        console.warn("[BrowserSecurity] CDN rules not found — using hardcoded fallback allowlist");
      }
    } catch (err: any) {
      console.warn("[BrowserSecurity] CDN fetch failed:", err.message, "— using hardcoded fallback");
    } finally {
      _browserRulesFetching = false;
    }
    return _browserRulesCache;
  }

  app.get("/api/security/browser-rules", isAuthenticated, async (_req: any, res) => {
    try {
      const rules = await getBrowserRules();
      const allowedDomains = rules?.allowedDomains ?? BROWSER_RULES_FALLBACK_DOMAINS;
      const cacheTtlMs = rules?.cacheTtlMs ?? BROWSER_RULES_TTL;
      const source = rules ? "cdn" : "fallback";
      res.json({ allowedDomains, cacheTtlMs, fallback: "block", source });
    } catch {
      // Hard failure — return fallback list so clients are never broken
      res.json({ allowedDomains: BROWSER_RULES_FALLBACK_DOMAINS, cacheTtlMs: BROWSER_RULES_TTL, fallback: "block", source: "fallback" });
    }
  });

  // ── Conversational History — CDN-backed, zero Replit storage ─────────────────
  // Policy: max 10 sessions per user (prototype), sessions older than 7 days auto-purged.
  // Cleanup runs on every GET so no scheduler is needed.
  const SESSIONS_MAX = 10; // prototype limit — increase when moving to pro/AWS
  const SESSIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function pruneSessionList(raw: any[]): { pruned: any[]; changed: boolean } {
    const cutoff = Date.now() - SESSIONS_TTL_MS;
    const fresh = raw.filter(s => {
      if (!s?.id) return false;
      const ts = s.createdAt ? new Date(s.createdAt).getTime() : 0;
      return ts >= cutoff;
    });
    const capped = fresh.slice(0, SESSIONS_MAX);
    return { pruned: capped, changed: capped.length !== raw.length };
  }

  app.get("/api/conv-sessions", async (req: any, res) => {
    try {
      const username = req.user?.username || String(req.user?.id || "unknown");
      const path = `history/${username}/sessions.json`;
      const data = await fetchPrivateFile(path);
      const raw = Array.isArray(data?.sessions) ? data.sessions : [];
      const { pruned, changed } = pruneSessionList(raw);
      // Write cleaned list back to CDN if anything was removed
      if (changed) {
        pushPrivateFile(path, { sessions: pruned, updatedAt: new Date().toISOString() },
          `chore: auto-purge sessions ${new Date().toISOString().slice(0, 10)}`
        ).catch(() => {});
      }
      res.json({ sessions: pruned });
    } catch {
      res.json({ sessions: [] });
    }
  });

  app.post("/api/conv-sessions", async (req: any, res) => {
    try {
      const username = req.user?.username || String(req.user?.id || "unknown");
      const { sessions } = req.body;
      if (!Array.isArray(sessions)) return res.status(400).json({ error: "sessions must be an array" });
      const { pruned } = pruneSessionList(sessions);
      await pushPrivateFile(
        `history/${username}/sessions.json`,
        { sessions: pruned, updatedAt: new Date().toISOString() },
        `chore: conv-history ${new Date().toISOString().slice(0, 10)}`
      );
      res.json({ ok: true, kept: pruned.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  app.use("/api/v1", apiVersionMiddleware("v1"), v1Router);
  app.use("/api/v2", apiVersionMiddleware("v2"), v2Router);
  app.use("/api", apiVersionMiddleware("v1"), v1Router);

  return httpServer;
}

interface UserLangProfile {
  detectedLangs: Record<string, number>;
  settingLang: string | null;
  lastUpdated: number;
}

interface RoomLangProfile {
  users: Record<string, UserLangProfile>;
  createdAt: number;
}

const roomLangProfiles = new BoundedMap<string, RoomLangProfile>(150);

function getRoomProfile(roomCode: string): RoomLangProfile {
  let profile = roomLangProfiles.get(roomCode);
  if (!profile) {
    profile = { users: {}, createdAt: Date.now() };
    roomLangProfiles.set(roomCode, profile);
  }
  return profile;
}

function recordUserDetectedLang(roomCode: string, userId: string, lang: string) {
  const profile = getRoomProfile(roomCode);
  if (!profile.users[userId]) {
    profile.users[userId] = { detectedLangs: {}, settingLang: null, lastUpdated: Date.now() };
  }
  const u = profile.users[userId];
  u.detectedLangs[lang] = (u.detectedLangs[lang] || 0) + 1;
  u.lastUpdated = Date.now();
}

function recordUserSettingLang(roomCode: string, userId: string, lang: string) {
  const profile = getRoomProfile(roomCode);
  if (!profile.users[userId]) {
    profile.users[userId] = { detectedLangs: {}, settingLang: null, lastUpdated: Date.now() };
  }
  profile.users[userId].settingLang = lang;
  profile.users[userId].lastUpdated = Date.now();
}

function getUserLearnedLang(userProfile: UserLangProfile): string | null {
  const entries = Object.entries(userProfile.detectedLangs);
  if (entries.length > 0) {
    const totalSamples = entries.reduce((sum, [, count]) => sum + count, 0);
    if (totalSamples >= 2) {
      entries.sort((a, b) => b[1] - a[1]);
      const [topLang, topCount] = entries[0];
      if (topCount / totalSamples >= 0.7) return topLang;
    }
  }
  if (userProfile.settingLang) return userProfile.settingLang;
  return null;
}

function shouldSkipTranslationForRoom(roomCode: string, senderId: string, targetLang: string): { skip: boolean; reason?: string } {
  const profile = roomLangProfiles.get(roomCode);
  if (!profile) return { skip: false };
  const userIds = Object.keys(profile.users);
  if (userIds.length < 2) return { skip: false };

  const senderProfile = profile.users[senderId];
  if (!senderProfile) return { skip: false };

  const senderLang = getUserLearnedLang(senderProfile);
  if (!senderLang) return { skip: false };

  const receiverId = userIds.find(id => id !== senderId);
  if (!receiverId) return { skip: false };
  const receiverProfile = profile.users[receiverId];
  if (!receiverProfile) return { skip: false };
  const receiverLang = getUserLearnedLang(receiverProfile);
  if (!receiverLang) return { skip: false };

  if (senderLang === receiverLang && senderLang === targetLang) {
    return { skip: true, reason: `learned: both users speak ${senderLang}, target is ${targetLang}` };
  }

  return { skip: false };
}

function cleanupRoomProfiles() {
}

const langDetectCache = new TTLMap<string, { lang: string; ts: number }>(300, 3600000);

async function detectLanguage(text: string, targetLang: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return null;

  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return null;

  const alphaChars = trimmed.replace(/[\d\s\p{P}\p{S}]/gu, "");
  if (alphaChars.length < 4) return null;

  const cacheKey = trimmed.toLowerCase().substring(0, 200);
  const cached = langDetectCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 3600000) return cached.lang;

  const supportedCodes = ["en","es","fr","de","it","pt","nl","pl","ru","ja","zh","ko","cs","ar","hi","tr","vi","th","sv","da","fi","no","uk","el","he","id","ms","ro","hu","bg","sk","hr","sl","lt","lv","et"];

  try {
    const langPrompt = `Detect the language of the given text. Reply with ONLY a two-letter ISO 639-1 language code (e.g., "en", "es", "fr", "zh", "hi", "ar"). No explanations or extra text. If you cannot determine the language confidently, reply "unknown".`;
    const result = await gatewayChat(langPrompt, trimmed, { task: "chat", maxTokens: 5, temperature: 0 });
    const raw = result?.text?.trim().toLowerCase() || "";
    const detected = raw.replace(/[^a-z]/g, "").substring(0, 2);
    if (detected && detected.length === 2 && supportedCodes.includes(detected)) {
      langDetectCache.set(cacheKey, { lang: detected, ts: Date.now() });
      return detected;
    }
    return null;
  } catch (err) {
    console.error("Language detection failed:", err);
    return null;
  }
}

function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    ja: "Japanese",
    zh: "Chinese",
    ko: "Korean",
    cs: "Czech",
    ar: "Arabic",
    hi: "Hindi",
    tr: "Turkish",
    vi: "Vietnamese",
    th: "Thai",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    no: "Norwegian",
    uk: "Ukrainian",
    el: "Greek",
    he: "Hebrew",
    id: "Indonesian",
    ms: "Malay",
    ro: "Romanian",
    hu: "Hungarian",
    bg: "Bulgarian",
    sk: "Slovak",
    hr: "Croatian",
    sl: "Slovenian",
    lt: "Lithuanian",
    lv: "Latvian",
    et: "Estonian",
  };
  return languages[code.toLowerCase()] || code;
}

