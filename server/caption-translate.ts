/**
 * caption-translate.ts
 *
 * Isolated, lightweight translation engine exclusively for live video call captions.
 * Runs completely independently from Juno Bridge and /api/v1/translate.
 * No shared caches, no shared queues, no shared workers.
 *
 * Pipeline (fast-fail at each layer):
 *   L0 — same-language skip
 *   L1 — emoji/media skip
 *   L2 — in-memory LRU cache (1,000 entries, 30 min TTL)
 *   L3 — common phrase dictionary (instant, zero network)
 *   L4 — AI gateway (OpenAI gpt-4o-mini → Anthropic claude-haiku fallback)
 *
 * Hard timeout: 2,500ms — captions fall back to original text, never block the call.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { apiKeys } from "./api-keys";

const CACHE_MAX = 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CAPTION_TIMEOUT_MS = 2500;

interface CacheEntry {
  translated: string;
  ts: number;
}

const captionCache = new Map<string, CacheEntry>();

const PHRASE_DICT: Record<string, Record<string, string>> = {
  hello: { es: "hola", fr: "bonjour", de: "hallo", pt: "olá", zh: "你好", ja: "こんにちは", ko: "안녕하세요", ar: "مرحبا", ru: "привет", it: "ciao", hi: "नमस्ते", tr: "merhaba", nl: "hallo", pl: "cześć" },
  hi: { es: "hola", fr: "salut", de: "hi", pt: "oi", zh: "嗨", ja: "やあ", ko: "안녕", ar: "مرحبا", ru: "привет", it: "ciao", hi: "हाय", tr: "merhaba", nl: "hoi", pl: "cześć" },
  yes: { es: "sí", fr: "oui", de: "ja", pt: "sim", zh: "是", ja: "はい", ko: "예", ar: "نعم", ru: "да", it: "sì", hi: "हाँ", tr: "evet", nl: "ja", pl: "tak" },
  no: { es: "no", fr: "non", de: "nein", pt: "não", zh: "不", ja: "いいえ", ko: "아니요", ar: "لا", ru: "нет", it: "no", hi: "नहीं", tr: "hayır", nl: "nee", pl: "nie" },
  ok: { es: "de acuerdo", fr: "d'accord", de: "okay", pt: "ok", zh: "好的", ja: "わかりました", ko: "알겠습니다", ar: "حسنا", ru: "хорошо", it: "va bene", hi: "ठीक है", tr: "tamam", nl: "oké", pl: "okej" },
  okay: { es: "de acuerdo", fr: "d'accord", de: "okay", pt: "ok", zh: "好的", ja: "わかりました", ko: "알겠습니다", ar: "حسنا", ru: "хорошо", it: "va bene", hi: "ठीक है", tr: "tamam", nl: "oké", pl: "okej" },
  "thank you": { es: "gracias", fr: "merci", de: "danke", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ko: "감사합니다", ar: "شكراً", ru: "спасибо", it: "grazie", hi: "धन्यवाद", tr: "teşekkürler", nl: "dank je", pl: "dziękuję" },
  thanks: { es: "gracias", fr: "merci", de: "danke", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ko: "감사합니다", ar: "شكراً", ru: "спасибо", it: "grazie", hi: "धन्यवाद", tr: "teşekkürler", nl: "bedankt", pl: "dzięki" },
  goodbye: { es: "adiós", fr: "au revoir", de: "auf wiedersehen", pt: "adeus", zh: "再见", ja: "さようなら", ko: "안녕히 가세요", ar: "وداعاً", ru: "до свидания", it: "arrivederci", hi: "अलविदा", tr: "hoşçakal", nl: "dag", pl: "do widzenia" },
  bye: { es: "adiós", fr: "au revoir", de: "tschüss", pt: "tchau", zh: "拜拜", ja: "じゃあね", ko: "잘 가", ar: "وداعاً", ru: "пока", it: "ciao", hi: "अलविदा", tr: "hoşçakal", nl: "doei", pl: "pa" },
  please: { es: "por favor", fr: "s'il vous plaît", de: "bitte", pt: "por favor", zh: "请", ja: "お願いします", ko: "부탁합니다", ar: "من فضلك", ru: "пожалуйста", it: "per favore", hi: "कृपया", tr: "lütfen", nl: "alsjeblieft", pl: "proszę" },
  "how are you": { es: "¿cómo estás?", fr: "comment allez-vous?", de: "wie geht es dir?", pt: "como vai você?", zh: "你好吗?", ja: "お元気ですか?", ko: "어떻게 지내세요?", ar: "كيف حالك?", ru: "как дела?", it: "come stai?", hi: "आप कैसे हैं?", tr: "nasılsın?", nl: "hoe gaat het?", pl: "jak się masz?" },
  "i understand": { es: "entiendo", fr: "je comprends", de: "ich verstehe", pt: "eu entendo", zh: "我明白", ja: "わかります", ko: "이해합니다", ar: "أفهم", ru: "я понимаю", it: "capisco", hi: "मैं समझता हूं", tr: "anlıyorum", nl: "ik begrijp het", pl: "rozumiem" },
  "i see": { es: "ya veo", fr: "je vois", de: "ich verstehe", pt: "já vejo", zh: "我明白了", ja: "なるほど", ko: "알겠어요", ar: "أرى", ru: "понятно", it: "capisco", hi: "मैं देखता हूं", tr: "anlıyorum", nl: "ik begrijp", pl: "rozumiem" },
  wait: { es: "espera", fr: "attendez", de: "warten", pt: "espere", zh: "等等", ja: "待ってください", ko: "잠깐요", ar: "انتظر", ru: "подождите", it: "aspetta", hi: "रुकिए", tr: "bekle", nl: "wacht", pl: "czekaj" },
  "one moment": { es: "un momento", fr: "un instant", de: "einen Moment", pt: "um momento", zh: "稍等一下", ja: "少々お待ちください", ko: "잠시만요", ar: "لحظة", ru: "одну минуту", it: "un momento", hi: "एक पल", tr: "bir dakika", nl: "één moment", pl: "chwilę" },
  "can you hear me": { es: "¿me escuchas?", fr: "tu m'entends?", de: "kannst du mich hören?", pt: "você pode me ouvir?", zh: "你能听到我吗?", ja: "聞こえますか?", ko: "들리시나요?", ar: "هل يمكنك سماعي؟", ru: "вы меня слышите?", it: "mi senti?", hi: "क्या आप मुझे सुन सकते हैं?", tr: "beni duyabiliyor musun?", nl: "kun je me horen?", pl: "słyszysz mnie?" },
  "i can hear you": { es: "te escucho", fr: "je t'entends", de: "ich höre dich", pt: "posso te ouvir", zh: "我能听到你", ja: "聞こえます", ko: "들립니다", ar: "أستطيع سماعك", ru: "я вас слышу", it: "ti sento", hi: "मैं आपको सुन सकता हूं", tr: "seni duyabiliyorum", nl: "ik kan je horen", pl: "słyszę cię" },
  sorry: { es: "lo siento", fr: "désolé", de: "entschuldigung", pt: "desculpe", zh: "对不起", ja: "すみません", ko: "죄송합니다", ar: "آسف", ru: "извините", it: "mi dispiace", hi: "माफ करें", tr: "özür dilerim", nl: "sorry", pl: "przepraszam" },
  "of course": { es: "por supuesto", fr: "bien sûr", de: "natürlich", pt: "claro", zh: "当然", ja: "もちろん", ko: "물론이죠", ar: "بالطبع", ru: "конечно", it: "certo", hi: "बिल्कुल", tr: "tabii ki", nl: "natuurlijk", pl: "oczywiście" },
  "no problem": { es: "no hay problema", fr: "pas de problème", de: "kein problem", pt: "sem problema", zh: "没问题", ja: "問題ありません", ko: "문제없어요", ar: "لا مشكلة", ru: "нет проблем", it: "nessun problema", hi: "कोई समस्या नहीं", tr: "sorun değil", nl: "geen probleem", pl: "nie ma problemu" },
};

function cacheKey(text: string, targetLang: string): string {
  return `${targetLang}:${text.toLowerCase().trim()}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [k, v] of captionCache.entries()) {
    if (now - v.ts > CACHE_TTL_MS) captionCache.delete(k);
  }
  if (captionCache.size > CACHE_MAX) {
    const sorted = [...captionCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    sorted.slice(0, captionCache.size - CACHE_MAX).forEach(([k]) => captionCache.delete(k));
  }
}

function lookupPhrase(text: string, targetLang: string): string | null {
  const normalized = text.toLowerCase().trim().replace(/[?.!,]+$/, "");
  const langBase = targetLang.split("-")[0].toLowerCase();
  return PHRASE_DICT[normalized]?.[langBase] ?? null;
}

function isSameLang(source: string, target: string): boolean {
  const s = source.split("-")[0].toLowerCase();
  const t = target.split("-")[0].toLowerCase();
  return s === t;
}

function isSkippable(text: string): boolean {
  return /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\s]+$/u.test(text.trim());
}

async function aiTranslate(text: string, targetLang: string): Promise<{ text: string; provider: string }> {
  const prompt = `Translate the following spoken caption to ${targetLang}. Return only the translation, preserve natural spoken tone:\n${text}`;

  const _openaiKey = apiKeys.openai();
  if (_openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: _openaiKey });
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are a real-time caption translator. Translate spoken captions accurately and naturally. Return only the translated text. Never use em dashes (—) or en dashes (–); use commas or colons instead.` },
          { role: "user", content: `Translate to ${targetLang}:\n${text}` },
        ],
        max_tokens: 300,
        temperature: 0.1,
      });
      const result = resp.choices[0]?.message?.content?.trim();
      if (result) return { text: result, provider: "openai" };
    } catch (_) {}
  }

  const _anthropicKey = apiKeys.anthropic();
  if (_anthropicKey) {
    const anthropic = new Anthropic({ apiKey: _anthropicKey });
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const block = resp.content[0];
    const result = block.type === "text" ? block.text.trim() : null;
    if (result) return { text: result, provider: "anthropic" };
  }

  throw new Error("No AI provider available for caption translation");
}

export interface CaptionTranslateResult {
  translatedText: string;
  provider: string;
  cached: boolean;
  latencyMs: number;
}

export async function translateCaption(
  text: string,
  targetLang: string,
  sourceLang = "en"
): Promise<CaptionTranslateResult> {
  const start = Date.now();
  const elapsed = () => Date.now() - start;

  const trimmed = text.trim();
  if (!trimmed) return { translatedText: text, provider: "empty-skip", cached: true, latencyMs: elapsed() };

  if (isSameLang(sourceLang, targetLang)) {
    return { translatedText: text, provider: "same-lang", cached: true, latencyMs: elapsed() };
  }

  if (isSkippable(trimmed)) {
    return { translatedText: text, provider: "emoji-skip", cached: true, latencyMs: elapsed() };
  }

  const key = cacheKey(trimmed, targetLang);

  const cached = captionCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { translatedText: cached.translated, provider: "cache", cached: true, latencyMs: elapsed() };
  }

  const dictHit = lookupPhrase(trimmed, targetLang);
  if (dictHit) {
    captionCache.set(key, { translated: dictHit, ts: Date.now() });
    return { translatedText: dictHit, provider: "dictionary", cached: false, latencyMs: elapsed() };
  }

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Caption translate timeout")), CAPTION_TIMEOUT_MS)
    );
    const { text: translated, provider } = await Promise.race([aiTranslate(trimmed, targetLang), timeout]);
    pruneCache();
    captionCache.set(key, { translated, ts: Date.now() });
    return { translatedText: translated, provider, cached: false, latencyMs: elapsed() };
  } catch (_) {
    return { translatedText: text, provider: "failed", cached: false, latencyMs: elapsed() };
  }
}

export function getCaptionCacheStats() {
  return { size: captionCache.size, maxSize: CACHE_MAX, ttlMs: CACHE_TTL_MS };
}
