/**
 * Translation Intent Detector
 *
 * Detects when a user is issuing a translation command to Juno (voice or text).
 * Command patterns and language mappings are loaded from the GitHub CDN
 * (config/translation-commands.json) and refreshed every hour.
 *
 * When detected, the /api/v1/chat route bypasses the reasoning model and routes
 * directly to the translation pipeline — no wasted LLM tokens.
 */

import { fetchPrivateFile } from "./github-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TranslationCommandConfig {
  version: string;
  updated?: string;
  triggerKeywords: string[];
  languageMap: Record<string, string>;
}

export type TranslationIntentType =
  | "direct"      // translate specific quoted/named text to a language
  | "question"    // "how do you say X in Y"
  | "mode_switch" // "translate for me" / "respond in Spanish" — no specific text
  | null;

export interface TranslationIntent {
  detected: boolean;
  type: TranslationIntentType;
  textToTranslate: string | null;
  targetLang: string | null;
  targetLangName: string | null;
  confidence: number;
}

// ── Defaults (fallback when CDN is unavailable) ───────────────────────────────

const DEFAULT_LANG_MAP: Record<string, string> = {
  // English
  "english": "en", "inglés": "en", "anglais": "en", "englisch": "en",
  // Spanish
  "spanish": "es", "español": "es", "espanol": "es", "castellano": "es",
  "espagnol": "es", "spanisch": "es", "spagnolo": "es",
  // French
  "french": "fr", "français": "fr", "francais": "fr", "franzosisch": "fr",
  "francese": "fr", "francés": "fr",
  // German
  "german": "de", "deutsch": "de", "allemand": "de", "alemán": "de",
  "aleman": "de", "tedesco": "de",
  // Italian
  "italian": "it", "italiano": "it", "italien": "it", "italianisch": "it",
  // Portuguese
  "portuguese": "pt", "português": "pt", "portugues": "pt",
  "brésilien": "pt", "brazilian": "pt",
  // Dutch
  "dutch": "nl", "nederlands": "nl", "hollandais": "nl",
  // Russian
  "russian": "ru", "русский": "ru", "russe": "ru", "russisch": "ru",
  // Japanese
  "japanese": "ja", "日本語": "ja", "japonais": "ja", "japanisch": "ja",
  // Chinese
  "chinese": "zh", "中文": "zh", "mandarin": "zh", "chinois": "zh",
  "chinesisch": "zh", "mandarín": "zh",
  // Korean
  "korean": "ko", "한국어": "ko", "coréen": "ko", "koreanisch": "ko",
  // Arabic
  "arabic": "ar", "عربي": "ar", "arabe": "ar", "arabisch": "ar",
  // Hindi
  "hindi": "hi", "हिंदी": "hi",
  // Turkish
  "turkish": "tr", "türkçe": "tr", "turc": "tr", "türkisch": "tr",
  // Polish
  "polish": "pl", "polski": "pl", "polonais": "pl", "polnisch": "pl",
  // Swedish
  "swedish": "sv", "svenska": "sv", "suédois": "sv",
  // Danish
  "danish": "da", "dansk": "da", "danois": "da",
  // Norwegian
  "norwegian": "no", "norsk": "no", "norvégien": "no",
  // Finnish
  "finnish": "fi", "suomi": "fi", "finlandais": "fi",
  // Greek
  "greek": "el", "ελληνικά": "el", "grec": "el",
  // Hebrew
  "hebrew": "he", "עברית": "he", "hébreu": "he",
  // Thai
  "thai": "th", "ภาษาไทย": "th", "thaï": "th",
  // Vietnamese
  "vietnamese": "vi", "tiếng việt": "vi", "vietnamien": "vi",
};

const DEFAULT_TRIGGER_KEYWORDS = [
  "translate", "translation", "traduire", "traducir", "übersetzen",
  "翻译", "翻訳", "번역", "перевести", "traduzione", "tradução", "vertalen",
  "traduzir", "tłumaczyć", "çevirmek",
];

const DEFAULT_CONFIG: TranslationCommandConfig = {
  version: "default",
  triggerKeywords: DEFAULT_TRIGGER_KEYWORDS,
  languageMap: DEFAULT_LANG_MAP,
};

// ── Cache ─────────────────────────────────────────────────────────────────────

let cachedConfig: TranslationCommandConfig = DEFAULT_CONFIG;
let lastLoaded = 0;
const CONFIG_TTL = 60 * 60 * 1000;

async function loadConfig(): Promise<TranslationCommandConfig> {
  const now = Date.now();
  if (now - lastLoaded < CONFIG_TTL) return cachedConfig;
  try {
    const remote = await fetchPrivateFile("config/translation-commands.json");
    if (remote?.languageMap && remote?.triggerKeywords) {
      cachedConfig = remote as TranslationCommandConfig;
      lastLoaded = now;
      console.log(`[TranslationIntent] CDN config loaded — v${remote.version}`);
      return cachedConfig;
    }
  } catch {
    // silent — use whatever is cached
  }
  if (lastLoaded === 0) {
    cachedConfig = DEFAULT_CONFIG;
    lastLoaded = now;
  }
  return cachedConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_CODE_TO_NAME: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
  ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
  tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
  el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
};

function findTargetLang(
  text: string,
  langMap: Record<string, string>
): { code: string; name: string } | null {
  const lower = text.toLowerCase();
  // Sort by keyword length descending to prefer longest match
  const sorted = Object.entries(langMap).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, code] of sorted) {
    if (lower.includes(keyword.toLowerCase())) {
      return { code, name: LANG_CODE_TO_NAME[code] || keyword };
    }
  }
  return null;
}

/**
 * Try to extract explicit text the user wants translated.
 * Returns null when the user said "translate this" (no specific text given).
 */
function extractSourceText(text: string): string | null {
  // Quoted text: translate "hello world" to French
  const quotedMatch = text.match(/["""''`](.+?)["""''`]/);
  if (quotedMatch) return quotedMatch[1].trim();

  // translate: <text> / translate — <text>
  const colonDash = text.match(/translate[:\-–—]\s*(.+)/i);
  if (colonDash) return colonDash[1].split(/\s+(?:to|into|in)\s+\w/i)[0].trim();

  // how do you say <text> in <lang>
  const sayMatch = text.match(
    /(?:how (?:do you|would you|can you|do i) say|what (?:is|does|'s)|how to say)\s+(.+?)\s+in\s+\w/i
  );
  if (sayMatch) return sayMatch[1].trim();

  // translate <text> to/into/in <lang> — only when text is not a pronoun
  const toMatch = text.match(/translate\s+(.+?)\s+(?:to|into|in)\s+\w/i);
  if (toMatch) {
    const candidate = toMatch[1].trim().toLowerCase();
    const proxies = new Set(["this", "it", "that", "the following", "everything", "for me", "please", "my message"]);
    if (!proxies.has(candidate)) return toMatch[1].trim();
  }

  return null;
}

function hasTriggerKeyword(lower: string, keywords: string[]): boolean {
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function detectTranslationIntent(text: string): Promise<TranslationIntent> {
  const none: TranslationIntent = {
    detected: false, type: null, textToTranslate: null,
    targetLang: null, targetLangName: null, confidence: 0,
  };

  const cfg = await loadConfig();
  const lower = text.toLowerCase().trim();

  // Fast path: must contain at least one trigger keyword
  if (!hasTriggerKeyword(lower, cfg.triggerKeywords)) return none;

  const langMatch = findTargetLang(text, cfg.languageMap);
  const sourceText = extractSourceText(text);

  // "how do you say X in Y" / "what is X in Y"
  const isQuestion = /(?:how (?:do you|would you|can you|do i) say|what (?:is|does|'s)|how to say)/i.test(lower);
  if (isQuestion && langMatch) {
    return {
      detected: true,
      type: "question",
      textToTranslate: sourceText,
      targetLang: langMatch.code,
      targetLangName: langMatch.name,
      confidence: 0.95,
    };
  }

  // translate [text] to [lang]
  if (/\btranslate\b/i.test(lower) && langMatch) {
    return {
      detected: true,
      type: sourceText ? "direct" : "mode_switch",
      textToTranslate: sourceText,
      targetLang: langMatch.code,
      targetLangName: langMatch.name,
      confidence: 0.90,
    };
  }

  // "respond in Spanish" / "answer in French" / "reply in German"
  const respondIn = lower.match(/(?:respond|answer|reply|speak|write|talk)\s+in\s+(\w[\w\s]{1,20})/i);
  if (respondIn && langMatch) {
    return {
      detected: true,
      type: "mode_switch",
      textToTranslate: null,
      targetLang: langMatch.code,
      targetLangName: langMatch.name,
      confidence: 0.85,
    };
  }

  // "translate for me" / "can you translate" / "please translate" — no language given
  if (/\btranslate\b/i.test(lower)) {
    return {
      detected: true,
      type: "mode_switch",
      textToTranslate: sourceText,
      targetLang: null,
      targetLangName: null,
      confidence: 0.65,
    };
  }

  return none;
}

/** Pre-warm the CDN config cache on server startup. */
export async function preloadTranslationIntentConfig(): Promise<void> {
  try {
    await loadConfig();
  } catch {}
}

/** Expose the CDN config (for admin/debug routes). */
export function getTranslationIntentConfig(): TranslationCommandConfig {
  return cachedConfig;
}
