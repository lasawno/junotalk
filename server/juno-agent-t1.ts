/**
 * PROPRIETARY AND CONFIDENTIAL
 * JunoAgent-T1 — Dedicated Text Messaging Translation Sub-Agent
 * Copyright (c) 2024-2026 JunoTalk. All rights reserved.
 *
 * JunoAgent-T1 is a self-contained translation agent decoupled from the
 * shared AI Gateway. It connects directly to Groq's multilingual models
 * and handles text message translation independently as part of the
 * messaging system.
 *
 * ─── DESIGN PRINCIPLES ───────────────────────────────────────────────────────
 *  • Single responsibility — text chat translation only, no voice/caption path
 *  • Direct Groq connection — not routed through the shared AI Gateway
 *  • Fast by default — primary model llama-3.3-70b-versatile (~200ms p50)
 *  • Speed fallback — llama-3.1-8b-instant if primary times out or errors
 *  • Writes to shared translation_memory — cache benefits shared across system
 *  • Graceful null return on failure — caller falls back to AI Gateway
 *
 * ─── MODEL CHAIN ─────────────────────────────────────────────────────────────
 *  1. llama-3.3-70b-versatile  — high quality, multilingual, 5 s timeout
 *  2. llama-3.1-8b-instant     — ultra-fast fallback, 3 s timeout
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Unauthorized copying, distribution, or reverse engineering is strictly prohibited.
 */

import { apiKeys } from "./api-keys";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

const MODELS: { id: string; timeoutMs: number }[] = [
  { id: "llama-3.3-70b-versatile", timeoutMs: 5000 },
  { id: "llama-3.1-8b-instant",    timeoutMs: 3000 },
];

const LANG_NAMES: Record<string, string> = {
  en: "English",  es: "Spanish",   fr: "French",    de: "German",
  it: "Italian",  pt: "Portuguese", nl: "Dutch",    pl: "Polish",
  cs: "Czech",    ru: "Russian",   ja: "Japanese",  zh: "Chinese",
  ko: "Korean",   ar: "Arabic",    hi: "Hindi",     tr: "Turkish",
  vi: "Vietnamese", th: "Thai",    sv: "Swedish",   da: "Danish",
  fi: "Finnish",  no: "Norwegian", uk: "Ukrainian", el: "Greek",
  he: "Hebrew",   id: "Indonesian", ms: "Malay",    ro: "Romanian",
  hu: "Hungarian", bg: "Bulgarian",
};

function langName(code: string): string {
  return LANG_NAMES[code.toLowerCase()] || code;
}

function buildPrompt(
  text: string,
  sourceLang: string,
  targetLang: string,
  examples: { sourceText: string; translatedText: string }[]
): string {
  const src = langName(sourceLang);
  const tgt = langName(targetLang);

  let exampleBlock = "";
  if (examples.length > 0) {
    const pairs = examples
      .slice(0, 3)
      .map(e => `  "${e.sourceText}" → "${e.translatedText}"`)
      .join("\n");
    exampleBlock = `\nReference translations for style and consistency:\n${pairs}\n`;
  }

  return (
    `You are a precise chat message translator. Translate the following ${src} chat message into natural ${tgt}.\n` +
    `Rules:\n` +
    `- Output ONLY the translated text, nothing else.\n` +
    `- Preserve tone (casual/formal) and any emoji exactly.\n` +
    `- Do not explain or add commentary.\n` +
    `- If the text is already in ${tgt}, output it unchanged.\n` +
    `- Never use em dashes (—) or en dashes (–); use commas or colons instead.\n` +
    exampleBlock +
    `\nMessage: ${text}`
  );
}

async function callGroq(
  model: string,
  prompt: string,
  timeoutMs: number,
  apiKey: string
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_BASE, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.warn(`[JunoAgent-T1] ${model} HTTP ${res.status}: ${err.slice(0, 120)}`);
      return null;
    }

    const data = await res.json() as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data?.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timed out")) {
      console.warn(`[JunoAgent-T1] ${model} timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`[JunoAgent-T1] ${model} error: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a chat message using Groq's multilingual models.
 *
 * @returns `{ translatedText, provider }` on success, or `null` if all
 *          Groq models fail (caller should fall back to the AI Gateway).
 */
export async function t1Translate(
  text: string,
  sourceLang: string,
  targetLang: string,
  vectorContext: { sourceText: string; translatedText: string }[] = []
): Promise<{ translatedText: string; provider: string } | null> {
  const apiKey = apiKeys.groq();
  if (!apiKey) {
    console.warn("[JunoAgent-T1] No Groq API key — skipping T1 path");
    return null;
  }

  const prompt = buildPrompt(text, sourceLang, targetLang, vectorContext);

  for (const { id, timeoutMs } of MODELS) {
    const result = await callGroq(id, prompt, timeoutMs, apiKey);
    if (result) {
      console.log(`[JunoAgent-T1] ${id} → ${sourceLang}→${targetLang} (${text.length} chars)`);
      return { translatedText: result, provider: `groq-t1:${id}` };
    }
  }

  console.warn("[JunoAgent-T1] All Groq models failed — handing off to AI Gateway");
  return null;
}

/** Quick health-check: verifies the Groq key is present and the endpoint is reachable. */
export async function t1HealthCheck(): Promise<{ ok: boolean; model?: string; latencyMs?: number }> {
  const apiKey = apiKeys.groq();
  if (!apiKey) return { ok: false };

  const start = Date.now();
  const result = await callGroq(
    MODELS[1].id,
    "Translate 'hello' from English to Spanish. Output only the translation.",
    3000,
    apiKey
  );

  if (result) {
    return { ok: true, model: MODELS[1].id, latencyMs: Date.now() - start };
  }
  return { ok: false };
}
