/**
 * Juno Vision Hub — Lightweight image reader
 *
 * Gemini's ONLY job here: read visible text/logos in the photo, output brand name
 * + product label + translation + one sentence. That's it — ~80% fewer tokens.
 *
 * All rich knowledge (descriptions, food facts, history, ingredients, prices)
 * is supplied by the OSINT layer (Wikipedia, DDG, Open Food Facts, Open Library)
 * which runs entirely for free with no API key.
 *
 * Priority:
 *   1. Gemini 1.5 Flash (primary image reader)
 *   2. Gemini via CDN backup key
 *   3. Claude direct vision (fallback image reader)
 *   4. HuggingFace BLIP caption + Claude structure (last resort)
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetchPrivateFile } from "./github-config";
import { apiKeys } from "./api-keys";

const HF_TOKEN = apiKeys.hf();

/* ── Circuit breaker for Gemini ── */
let _geminiFailCount = 0;
let _geminiCooldownUntil = 0;
const GEMINI_COOLDOWN_MS = 5 * 60 * 1000;
const GEMINI_FAIL_THRESHOLD = 2;
let _cdnGeminiKey: string | null = null;
let _cdnKeyFetchedAt = 0;
const CDN_KEY_TTL = 60 * 60 * 1000;

function geminiCircuitOpen(): boolean {
  if (_geminiCooldownUntil && Date.now() < _geminiCooldownUntil) return true;
  if (_geminiCooldownUntil && Date.now() >= _geminiCooldownUntil) {
    _geminiFailCount = 0; _geminiCooldownUntil = 0;
  }
  return false;
}
function recordGeminiSuccess() { _geminiFailCount = 0; _geminiCooldownUntil = 0; }
function recordGeminiFailure() {
  _geminiFailCount++;
  if (_geminiFailCount >= GEMINI_FAIL_THRESHOLD) {
    _geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
    console.warn(`[JunoVisionHub] Gemini circuit open for ${GEMINI_COOLDOWN_MS / 60000} min`);
  }
}
async function getCdnGeminiKey(): Promise<string> {
  if (_cdnGeminiKey && Date.now() - _cdnKeyFetchedAt < CDN_KEY_TTL) return _cdnGeminiKey;
  try {
    const data = await fetchPrivateFile("config/api-keys.json");
    const key = data?.geminiKey || data?.googleKey || data?.GEMINI_API_KEY || data?.GOOGLE_API_KEY || "";
    if (key) { _cdnGeminiKey = key; _cdnKeyFetchedAt = Date.now(); }
    return key;
  } catch { return ""; }
}

/* ── Timeout helper ── */
const AI_TIMEOUT_MS = 18_000;
const HF_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function parseJSON(raw: string): Record<string, any> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in: "${raw.slice(0, 120)}"`);
  return JSON.parse(match[0]);
}

/* ── Types ── */
export interface Insight { emoji: string; text: string; }

export interface HubVisionResult {
  label: string;
  brand?: string;
  translation: string;
  sentence: string;
  answer?: string;
  insights?: Insight[];
  price?: string;
  englishDetails?: string;
  sourceLang: string;
  targetLang: string;
  engine: "hub";
  hubEngine: "gemini" | "claude-direct" | "huggingface";
  caption?: string;
}

export interface YoloHint {
  category: string;
  confidence: number;
}

export interface PastScan {
  label: string;
  brand?: string | null;
  translation: string;
}

const LANG_NAMES: Record<string, string> = {
  en: "English",    es: "Spanish",    fr: "French",     de: "German",
  it: "Italian",    pt: "Portuguese", nl: "Dutch",       pl: "Polish",
  cs: "Czech",      ru: "Russian",    ja: "Japanese",    zh: "Chinese",
  ko: "Korean",     ar: "Arabic",     hi: "Hindi",       tr: "Turkish",
  sv: "Swedish",    da: "Danish",     fi: "Finnish",     no: "Norwegian",
  el: "Greek",      he: "Hebrew",     th: "Thai",        vi: "Vietnamese",
  id: "Indonesian", ms: "Malay",      uk: "Ukrainian",   ro: "Romanian",
  hu: "Hungarian",
};
function langName(code: string): string { return LANG_NAMES[code] || code; }

/**
 * Build the lightweight reader prompt — Gemini only identifies what it SEES.
 * OSINT handles all background knowledge separately.
 */
function buildReaderPrompt(
  src: string,
  tgt: string,
  mode: "smart" | "fun",
  userQuestion: string | undefined,
  yoloHints: YoloHint[],
  pastScans: PastScan[]
): string {
  const yoloCtx = yoloHints.length > 0
    ? `Object type hint (from local detector): "${yoloHints[0].category}" (${Math.round(yoloHints[0].confidence * 100)}% confidence). Use as a category hint only.\n`
    : "";

  const memCtx = pastScans.length > 0
    ? `Previously identified items for cross-reference:\n` +
      pastScans.slice(0, 5).map(s => `  - "${s.label}"${s.brand ? ` [brand: ${s.brand}]` : ""}`).join("\n") + "\n"
    : "";

  const taskLine = userQuestion
    ? `The user asks: "${userQuestion}". Answer based only on what you can see.`
    : `Identify what you see. Focus on any text, logos, or labels visible in the image.`;

  const outputFields =
    `{"brand":"<brand name only (read from image), or null>",` +
    `"label":"<full product name in ${src}, include brand if visible>",` +
    `"translation":"<product name in ${tgt}>",` +
    (userQuestion ? `"answer":"<direct answer in ${src}, max 2 sentences>",` : "") +
    `"sentence":"<${userQuestion ? "concise answer in " + tgt : (mode === "fun" ? "fun one-liner in " + tgt : "one helpful sentence in " + tgt)}>",` +
    `"price":"<retail price in USD if you know it, else null>"}`;

  return (
    yoloCtx +
    memCtx +
    `\nYour task: ${taskLine}\n` +
    `Read ALL visible text on the product character by character — do not guess or infer.\n` +
    `For beverages (cans, bottles, pouches): the BRAND is usually the largest or most prominent text on the front; the LABEL is the full product name including flavor or variant (e.g. "PRIME Hydration Lemon Lime" or "Ghost Energy Warheads Sour Watermelon").\n` +
    `Do not confuse flavor names with brand names. If you see multiple text elements, the brand is the company/maker name, not the flavor descriptor.\n` +
    `Extract the EXACT spelling as printed — including capitalization, hyphens, and punctuation.\n` +
    `Do NOT describe what you know about the product — only report what is physically visible in the image.\n` +
    `Respond with ONLY this JSON (no markdown, no extra text):\n` +
    outputFields
  );
}

/* ── Gemini lightweight reader ── */
async function geminiRead(
  imageBuffer: Buffer,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  userQuestion?: string,
  mode: "smart" | "fun" = "smart",
  keyOverride?: string,
  yoloHints: YoloHint[] = [],
  pastScans: PastScan[] = []
): Promise<HubVisionResult> {
  const apiKey = keyOverride || apiKeys.gemini();
  if (!apiKey) throw new Error("No Google/Gemini API key");

  const src = langName(sourceLang);
  const tgt = langName(targetLang);
  const validMime = ["image/jpeg","image/png","image/gif","image/webp"].includes(mimeType) ? mimeType : "image/jpeg";
  const prompt = buildReaderPrompt(src, tgt, mode, userQuestion, yoloHints, pastScans);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const result = await withTimeout(
    model.generateContent([prompt, { inlineData: { data: imageBuffer.toString("base64"), mimeType: validMime } }]),
    AI_TIMEOUT_MS,
    "Gemini reader"
  );

  const raw = result.response.text();
  const parsed = parseJSON(raw);
  return {
    label:          parsed.label        || "",
    brand:          parsed.brand        || undefined,
    translation:    parsed.translation  || "",
    sentence:       parsed.sentence     || "",
    answer:         parsed.answer,
    price:          parsed.price && parsed.price !== "null" ? parsed.price : undefined,
    sourceLang, targetLang,
    engine: "hub", hubEngine: "gemini",
  };
}

/* ── Claude lightweight reader (fallback) ── */
async function claudeRead(
  imageBuffer: Buffer,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  userQuestion?: string,
  mode: "smart" | "fun" = "smart",
  yoloHints: YoloHint[] = [],
  pastScans: PastScan[] = []
): Promise<HubVisionResult> {
  const apiKey = apiKeys.anthropic();
  if (!apiKey) throw new Error("Anthropic API key not set");

  const src = langName(sourceLang);
  const tgt = langName(targetLang);
  const validMime = (["image/jpeg","image/png","image/gif","image/webp"].includes(mimeType)
    ? mimeType : "image/jpeg") as "image/jpeg"|"image/png"|"image/gif"|"image/webp";
  const prompt = buildReaderPrompt(src, tgt, mode, userQuestion, yoloHints, pastScans);

  const anthropic = new Anthropic({ apiKey });
  const msg = await withTimeout(
    anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: validMime, data: imageBuffer.toString("base64") } },
        { type: "text", text: prompt },
      ]}],
    }),
    AI_TIMEOUT_MS,
    "Claude reader"
  );
  const raw = (msg.content[0] as any)?.text || "";
  const parsed = parseJSON(raw);
  return {
    label:         parsed.label        || "",
    brand:         parsed.brand        || undefined,
    translation:   parsed.translation  || "",
    sentence:      parsed.sentence     || "",
    answer:        parsed.answer,
    price:         parsed.price && parsed.price !== "null" ? parsed.price : undefined,
    sourceLang, targetLang,
    engine: "hub", hubEngine: "claude-direct",
  };
}

/* ── HuggingFace BLIP caption ── */
// Works with or without a token; unauthenticated calls are allowed but rate-limited.
async function hfCaption(imageBuffer: Buffer, mimeType: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": mimeType || "image/jpeg" };
  if (HF_TOKEN) headers["Authorization"] = `Bearer ${HF_TOKEN}`;
  const res = await fetch("https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large", {
    method: "POST",
    headers,
    body: imageBuffer,
    signal: AbortSignal.timeout(HF_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body.includes("loading") || res.status === 503 ? "HF model loading — retry" : `HF HTTP ${res.status}`);
  }
  const data = await res.json() as Array<{ generated_text?: string }>;
  return data?.[0]?.generated_text || "";
}

/**
 * Free parallel caption — runs alongside the primary AI reader.
 * Returns quickly (capped at 10 s). Used to cross-reference and confirm
 * what the primary reader reports, NOT as a fallback.
 */
export async function blipCrossReference(imageBuffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const caption = await Promise.race([
      hfCaption(imageBuffer, mimeType),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (caption) console.log(`[JunoVisionHub] BLIP cross-reference: "${caption}"`);
    return caption;
  } catch (e: any) {
    console.log(`[JunoVisionHub] BLIP cross-reference skipped: ${e.message}`);
    return null;
  }
}

async function hfPlusClaude(
  imageBuffer: Buffer,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  userQuestion?: string,
  mode: "smart" | "fun" = "smart",
  yoloHints: YoloHint[] = [],
  pastScans: PastScan[] = []
): Promise<HubVisionResult> {
  const caption = await withTimeout(hfCaption(imageBuffer, mimeType), HF_TIMEOUT_MS, "HF caption");
  const src = langName(sourceLang);
  const tgt = langName(targetLang);
  const prompt =
    `Image caption: "${caption}"\n` +
    buildReaderPrompt(src, tgt, mode, userQuestion, yoloHints, pastScans);

  const apiKey = apiKeys.anthropic();
  if (!apiKey) throw new Error("Anthropic API key not set");
  const anthropic = new Anthropic({ apiKey });
  const msg = await withTimeout(
    anthropic.messages.create({ model: "claude-3-haiku-20240307", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    AI_TIMEOUT_MS,
    "Claude structure"
  );
  const raw = (msg.content[0] as any)?.text || "";
  const parsed = parseJSON(raw);
  return {
    label:         parsed.label        || "",
    brand:         parsed.brand        || undefined,
    translation:   parsed.translation  || "",
    sentence:      parsed.sentence     || "",
    answer:        parsed.answer,
    price:         parsed.price && parsed.price !== "null" ? parsed.price : undefined,
    sourceLang, targetLang,
    engine: "hub", hubEngine: "huggingface", caption,
  };
}

/* ── Public entry point ── */
export async function hubVisionAnalyze(
  imageBuffer: Buffer,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  userQuestion?: string,
  mode: "smart" | "fun" = "smart",
  yoloHints: YoloHint[] = [],
  pastScans: PastScan[] = []
): Promise<HubVisionResult> {
  if (!imageBuffer?.length) throw new Error("Image buffer is empty");

  const geminiKey = apiKeys.gemini();

  if (geminiKey && !geminiCircuitOpen()) {
    try {
      console.log("[JunoVisionHub] Gemini — reading image labels/text...");
      const result = await geminiRead(imageBuffer, mimeType, sourceLang, targetLang, userQuestion, mode, undefined, yoloHints, pastScans);
      recordGeminiSuccess();
      return result;
    } catch (err: any) {
      recordGeminiFailure();
      if (/quota|rate.?limit|429|resource.?exhausted/i.test(err.message || "")) {
        console.warn("[JunoVisionHub] Gemini quota — trying CDN backup key...");
        try {
          const cdnKey = await getCdnGeminiKey();
          if (cdnKey && cdnKey !== geminiKey) {
            const r = await geminiRead(imageBuffer, mimeType, sourceLang, targetLang, userQuestion, mode, cdnKey, yoloHints, pastScans);
            recordGeminiSuccess();
            return r;
          }
        } catch {}
      }
      console.warn(`[JunoVisionHub] Gemini failed: ${err.message} — trying Claude...`);
    }
  } else if (geminiCircuitOpen()) {
    const secsLeft = Math.ceil((_geminiCooldownUntil - Date.now()) / 1000);
    console.log(`[JunoVisionHub] Gemini circuit open (${secsLeft}s) — using Claude`);
  }

  if (apiKeys.anthropic()) {
    try {
      console.log("[JunoVisionHub] Claude — reading image labels/text...");
      return await claudeRead(imageBuffer, mimeType, sourceLang, targetLang, userQuestion, mode, yoloHints, pastScans);
    } catch (err: any) {
      console.warn(`[JunoVisionHub] Claude failed: ${err.message}`);
    }
  }

  if (HF_TOKEN) {
    console.log("[JunoVisionHub] HuggingFace BLIP + Claude — last resort...");
    return hfPlusClaude(imageBuffer, mimeType, sourceLang, targetLang, userQuestion, mode, yoloHints, pastScans);
  }

  throw new Error("No vision engine available — configure GEMINI_API_KEY, ANTHROPIC_API_KEY, or HF_TOKEN");
}
