/**
 * Image Pipeline — JunoTalk AI Image Generation
 *
 * Fully isolated from all other AI pipelines. No imports from
 * routes, ai-gateway, or arena-llm. Zero side effects on text chat.
 *
 * All behavior (models, daily limit, style, on/off) is controlled
 * remotely via ai-images/config.json on the GitHub CDN.
 * Call loadImageConfig() on server startup to activate CDN control.
 *
 * Primary: Pollinations.AI (free, no API key, open-source models)
 * URLs are built server-side and returned to the browser, which
 * loads each image directly. Zero backend HTTP calls to image providers.
 *
 * Rate limit: configured via CDN (default 10/day, midnight UTC reset)
 * Feature gate: Arena flag "image_generation" must be true.
 */

import { redisGet, redisSet, isRedisAvailable } from "./redis-cache";
import { getImageConfig, getEnabledModels } from "./image-config";

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

// ── Intent Detection ──────────────────────────────────────────────────────────

const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|render|design|illustrate|produce)\b.{0,50}\b(image|picture|photo|pic|illustration|artwork|drawing|painting|visual|graphic)\b/i,
  /\b(image|picture|photo|pic|illustration|artwork|drawing|painting|visual|graphic)\b.{0,30}\b(of|showing|depicting|with|that shows)\b/i,
  /\bshow me (a |an )?(picture|image|photo|illustration|drawing|visual)\b/i,
  /\bcan you (draw|paint|illustrate|generate|create|make|render)\b/i,
  /\b(draw|paint|illustrate)\b.{0,60}\b(me|us|for me)\b/i,
  /\bvisualize\b/i,
  /\bdepict\b/i,
  /\b(a|an) (photo|image|picture|illustration|drawing|painting) of\b/i,
];

export function detectImageIntent(text: string): boolean {
  return IMAGE_INTENT_PATTERNS.some(p => p.test(text.trim()));
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────

function imageDailyKey(userId: string): { key: string; ttlSecs: number } {
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10);
  const safeId = userId.replace(/[^a-zA-Z0-9_:.-]/g, "_");
  const key    = `juno:img:${safeId}:${date}`;
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
  ));
  const ttlSecs = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  return { key, ttlSecs };
}

export interface ImageRateCheck {
  allowed: boolean;
  used: number;
  remaining: number;
  resetInHours: number;
  limit: number;
}

export async function checkImageRateLimit(userId: string): Promise<ImageRateCheck> {
  const cfg  = getImageConfig();
  const limit = cfg.dailyLimit;
  const now  = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
  ));
  const resetInHours = Math.ceil((midnight.getTime() - now.getTime()) / 3_600_000);

  if (!isRedisAvailable()) {
    return { allowed: true, used: 0, remaining: limit, resetInHours, limit };
  }

  const { key } = imageDailyKey(userId);
  const raw  = await redisGet(key);
  const used = parseInt(raw || "0", 10);

  return {
    allowed: used < limit,
    used,
    remaining: Math.max(0, limit - used),
    resetInHours,
    limit,
  };
}

export async function incrementImageUsage(userId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const { key, ttlSecs } = imageDailyKey(userId);
  const raw     = await redisGet(key);
  const current = parseInt(raw || "0", 10);
  await redisSet(key, String(current + 1), ttlSecs);
}

// ── Prompt Cleanup ────────────────────────────────────────────────────────────

function extractImageSubject(text: string): string {
  return text
    .replace(/^(hey\s+juno[,!]?\s*)/i, "")
    .replace(/\b(generate|create|make|draw|paint|render|design|illustrate|produce)\s+(me\s+)?(a\s+|an\s+)?/i, "")
    .replace(/\b(show me|can you|could you|please|for me|for us)\b/gi, "")
    .replace(/\b(image|picture|photo|pic|illustration|artwork|drawing|painting|visual|graphic)\s+(of\s+|showing\s+|depicting\s+)?/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImageResult {
  imageUrl: string;
  provider: "pollinations";
  model: string;
  label: string;
}

/** Single image — backwards compat */
export async function generateImage(userPrompt: string): Promise<ImageResult> {
  const results = await generateImages(userPrompt);
  return results[0];
}

/**
 * Parallel: one URL per enabled CDN-configured model, returned instantly.
 * Browser loads each image directly from Pollinations — zero backend HTTP.
 */
export async function generateImages(userPrompt: string): Promise<ImageResult[]> {
  const cfg     = getImageConfig();
  const models  = getEnabledModels();
  const subject = extractImageSubject(userPrompt) || userPrompt;
  const style   = cfg.styleAppend ? `, ${cfg.styleAppend}` : "";
  const prompt  = `${subject}${style}`;
  const encoded = encodeURIComponent(prompt);
  const seed    = Math.floor(Math.random() * 999999);
  const w       = cfg.imageWidth  || 1024;
  const h       = cfg.imageHeight || 1024;
  const safe    = cfg.safeMode ? "&safe=true" : "";
  const enhance = cfg.enhancePrompt ? "&enhance=true" : "";

  const results: ImageResult[] = models.map(({ id, label }) => ({
    imageUrl: `${POLLINATIONS_BASE}/${encoded}?width=${w}&height=${h}&model=${id}&nologo=true${safe}${enhance}&seed=${seed}`,
    provider: "pollinations" as const,
    model: id,
    label,
  }));

  console.log(
    "[ImagePipeline] URLs built for:", subject.slice(0, 80),
    "— models:", models.map(m => m.id).join(", "),
    `(limit=${cfg.dailyLimit}/day, CDN-controlled)`
  );
  return results;
}
