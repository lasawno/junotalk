import { gatewayChat } from "./ai-gateway";

const langDetectCache = new Map<string, { lang: string; ts: number }>();

const SUPPORTED_CODES = [
  "en","es","fr","de","it","pt","nl","pl","ru","ja","zh","ko",
  "cs","ar","hi","tr","vi","th","sv","da","fi","no","uk","el",
  "he","id","ms","ro","hu","bg","sk","hr","sl","lt","lv","et",
  "tl","sw","bn","ur","fa",
];

export async function detectLanguageIntelligence(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return null;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return null;
  const alphaChars = trimmed.replace(/[\d\s\p{P}\p{S}]/gu, "");
  if (alphaChars.length < 4) return null;

  const cacheKey = trimmed.toLowerCase().substring(0, 200);
  const cached = langDetectCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 3_600_000) return cached.lang;

  try {
    const result = await gatewayChat(
      `Detect the language of the given text. Reply with ONLY a two-letter ISO 639-1 code (e.g. "en", "es", "fr"). No explanation. If unsure reply "unknown".`,
      trimmed,
      { task: "chat", maxTokens: 5, temperature: 0 }
    );
    const raw = result?.text?.trim().toLowerCase() || "";
    const detected = raw.replace(/[^a-z]/g, "").substring(0, 2);
    if (detected.length === 2 && SUPPORTED_CODES.includes(detected)) {
      langDetectCache.set(cacheKey, { lang: detected, ts: Date.now() });
      return detected;
    }
    return null;
  } catch {
    return null;
  }
}

export interface TranslationDirection {
  srcLang: string;
  tgtLang: string;
  detectedLang: string | null;
}

export async function resolveTranslationDirection(
  text: string,
  nativeLang: string,
  hintSrcLang: string,
  hintTgtLang: string
): Promise<TranslationDirection> {
  const native = nativeLang || hintSrcLang || "en";
  const otherLang = hintTgtLang || "es";

  const detectedLang = await detectLanguageIntelligence(text);
  const resolved = detectedLang || hintSrcLang || native;

  const srcLang = resolved;
  const tgtLang = resolved === native ? otherLang : native;

  return { srcLang, tgtLang, detectedLang };
}
