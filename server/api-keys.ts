/**
 * Centralized API Key Resolver
 *
 * Loads ALL API keys from the private GitHub repository (lasawno/junotalk-cdn)
 * at startup and refreshes every hour. Falls back to process.env only if the
 * GitHub CDN is unreachable.
 *
 * Usage:
 *   import { apiKeys } from "./api-keys";
 *   const key = apiKeys.gemini();   // Gemini / Google
 *   const key = apiKeys.anthropic(); // Claude
 *   const key = apiKeys.openai();    // OpenAI
 *
 * GitHub CDN file: config/api-keys.json
 * {
 *   "GEMINI_API_KEY":    "AIza...",
 *   "ANTHROPIC_API_KEY": "sk-ant-...",
 *   "OPENAI_API_KEY":    "sk-...",
 *   "MOONSHOT_API_KEY":  "...",
 *   "HF_TOKEN":          "hf_...",
 *   "ENCRYPTION_KEY":    "...",
 *   "RECAPTCHA_SECRET_KEY": "..."
 * }
 *
 * Replit integration keys (AI_INTEGRATIONS_*) are injected by the Replit OAuth
 * system and are intentionally left as env-only — they cannot be moved to GitHub.
 */

import { fetchPrivateFile } from "./github-config";

let _cdnKeys: Record<string, string> = {};
let _loadedAt = 0;
let _loading: Promise<void> | null = null;
const TTL_MS = 60 * 60 * 1000; // refresh every hour

async function loadFromGitHub(): Promise<void> {
  try {
    const data = await fetchPrivateFile("config/api-keys.json");
    if (data && typeof data === "object") {
      // Strip any comments/metadata keys that start with _
      const keys: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!k.startsWith("_") && typeof v === "string" && v.trim()) {
          keys[k] = v.trim();
        }
      }
      _cdnKeys = keys;
      _loadedAt = Date.now();
      const count = Object.keys(_cdnKeys).length;
      console.log(`[ApiKeys] ${count} key(s) loaded from GitHub CDN`);
    }
  } catch (err: any) {
    console.warn(`[ApiKeys] GitHub CDN unavailable: ${err.message} — using env fallback`);
  }
}

async function ensureLoaded(): Promise<void> {
  if (_loadedAt && Date.now() - _loadedAt < TTL_MS) return;
  if (_loading) return _loading;
  _loading = loadFromGitHub().finally(() => { _loading = null; });
  return _loading;
}

/** True if a key value is a dummy/placeholder that should be skipped */
function isDummy(v: string | undefined): boolean {
  return !v || v.startsWith("_DUMMY_") || v === "placeholder" || v.trim() === "";
}

/**
 * Resolve a key: GitHub CDN first, then process.env.
 * Replit integration keys (AI_INTEGRATIONS_*) always come from env only.
 * Dummy/placeholder values are treated as absent and skipped.
 */
export function getKey(name: string): string {
  if (name.startsWith("AI_INTEGRATIONS_")) {
    const v = process.env[name];
    return isDummy(v) ? "" : (v as string);
  }
  const cdnVal = _cdnKeys[name];
  if (!isDummy(cdnVal)) return cdnVal as string;
  const envVal = process.env[name];
  return isDummy(envVal) ? "" : (envVal as string);
}

/**
 * Named convenience getters — call as functions so they always
 * return the latest value after a CDN refresh.
 */
export const apiKeys = {
  /** Gemini / Google AI */
  gemini:     () => getKey("GEMINI_API_KEY") || getKey("GOOGLE_AI_API_KEY") || getKey("GOOGLE_API_KEY"),
  /** Google API (Maps, Vision, etc.) */
  google:     () => getKey("GOOGLE_API_KEY") || getKey("GEMINI_API_KEY"),
  /** Anthropic Claude */
  anthropic:  () => getKey("ANTHROPIC_API_KEY") || getKey("AI_INTEGRATIONS_ANTHROPIC_API_KEY"),
  /** OpenAI */
  openai:     () => getKey("OPENAI_API_KEY") || getKey("AI_INTEGRATIONS_OPENAI_API_KEY"),
  /** Moonshot / Kimi */
  moonshot:   () => getKey("MOONSHOT_API_KEY"),
  /** HuggingFace */
  hf:         () => getKey("HF_TOKEN") || getKey("HUGGINGFACE_API_KEY"),
  /** AES-256-GCM encryption key (translation cache) */
  encryption: () => getKey("ENCRYPTION_KEY"),
  /** reCAPTCHA server secret */
  recaptcha:  () => getKey("RECAPTCHA_SECRET_KEY"),
  /** OpenRouter — uses Replit integration proxy when available, otherwise direct key */
  openrouter: () => process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || getKey("OPENROUTER_API_KEY") || "",
  /** DeepSeek */
  deepseek:   () => getKey("DEEPSEEK_API_KEY"),
  /** GitHub Models API — PAT with models:read permission */
  githubModels: () => getKey("GITHUB_MODELS_TOKEN") || process.env.GITHUB_MODELS_TOKEN || "",
  /** Groq — free ultra-fast inference (Llama, Mixtral, Gemma) */
  groq:      () => getKey("GROQ_API_KEY"),
  /** Cerebras — ultra-fast Llama inference, free tier */
  cerebras:  () => getKey("CEREBRAS_API_KEY"),
  /** Mistral AI — free open-weight models (open-mistral-nemo, open-mistral-7b) */
  mistral:   () => getKey("MISTRAL_API_KEY"),
  /** NVIDIA NIM — free credits, large open models via Azure-compatible API */
  nvidia:    () => getKey("NVIDIA_API_KEY"),
} as const;

/** Call at startup — non-blocking warm-up */
export function initApiKeys(): void {
  ensureLoaded().catch(() => {});
  setInterval(() => ensureLoaded().catch(() => {}), TTL_MS);
}

/** Await fresh keys (useful before the first API call in a request) */
export async function awaitApiKeys(): Promise<void> {
  return ensureLoaded();
}

// Auto-init when imported
initApiKeys();
