import OpenAI from "openai";
import { apiKeys } from "./api-keys";
import { recordProviderUsage } from "./agent-metrics";
import { redisGet, redisSet, redisIncrBy, isRedisAvailable } from "./redis-cache";
import { REDIS_KEYS } from "./brand-keys";
import { recallForTranslation, buildRecallPromptContext } from "./agent-recall";
import { orchestrateRecall } from "./recall-orchestrator";
import { analyzeQuery, buildReasoningContext } from "./reasoning-engine";
import { getPersonalityForContext, buildPersonalityPrompt } from "./personality-engine";
import { githubFallbackCache, COMMON_PHRASES } from "./translation-fallback";
import { getArenaRoutingConfig, getArenaFlag, pickWeightedModel } from "./arena-llm";
import { decideCaching, junoGet, junoSet } from "./juno-cache-intelligence";

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// Node 18+ ships global fetch — no need for node-fetch package
function getFetch(): FetchFn {
  return globalThis.fetch as unknown as FetchFn;
}

interface LibreTranslateResponse {
  translatedText?: string;
}

interface KimiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export interface AIGatewayRequest {
  task: "translation" | "translation_prompt" | "chat" | "monitor" | "general" | "background";
  model?: string;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  /** User/session identifier — required for chat caching. Without it, chat
   *  responses are never cached (privacy boundary). */
  sessionId?: string;
}

export interface AIGatewayResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  fromFallback: boolean;
}

export interface ProviderAdapter {
  name: string;
  isAvailable(): boolean;
  execute(req: AIGatewayRequest): Promise<AIGatewayResponse>;
}

export interface ProviderRouteConfig {
  provider: string;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  tasks: string[];
  dailyTokenBudget?: number;
}

export interface ProviderHealthData {
  name: string;
  available: boolean;
  circuitOpen: boolean;
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  tokensUsedToday: number;
}

interface CircuitState {
  failures: number;
  consecutiveFailures: number;
  successes: number;
  totalRequests: number;
  totalFailures: number;
  isOpen: boolean;
  halfOpenProbeInFlight: boolean;
  lastFailureAt: number;
  lastSuccessAt: number;
  cooldownUntil: number;
  latencySamples: number[];
  avgLatencyMs: number;
  tokensUsedToday: number;
  tokensUsedThisHour: number;
  tokensHourKey: string;
  tokensResetDate: string;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_BASE_MS = 30_000;
const CIRCUIT_COOLDOWN_MAX_MS = 300_000;
const LATENCY_SAMPLE_LIMIT = 30;
const USAGE_REDIS_PREFIX = REDIS_KEYS.gatewayUsagePrefix;
const USAGE_TTL = 7 * 24 * 60 * 60;

function getTodayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function getHourKey(): string {
  const now = new Date();
  return `${getTodayKey()}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

function createCircuitState(): CircuitState {
  return {
    failures: 0,
    consecutiveFailures: 0,
    successes: 0,
    totalRequests: 0,
    totalFailures: 0,
    isOpen: false,
    halfOpenProbeInFlight: false,
    lastFailureAt: 0,
    lastSuccessAt: 0,
    cooldownUntil: 0,
    latencySamples: [],
    avgLatencyMs: 0,
    tokensUsedToday: 0,
    tokensUsedThisHour: 0,
    tokensHourKey: getHourKey(),
    tokensResetDate: getTodayKey(),
  };
}

const circuitStates = new Map<string, CircuitState>();
const adapters = new Map<string, ProviderAdapter>();

function getCircuit(provider: string): CircuitState {
  let state = circuitStates.get(provider);
  if (!state) {
    state = createCircuitState();
    circuitStates.set(provider, state);
  }
  const today = getTodayKey();
  if (state.tokensResetDate !== today) {
    state.tokensUsedToday = 0;
    state.tokensResetDate = today;
  }
  const hour = getHourKey();
  if (state.tokensHourKey !== hour) {
    state.tokensUsedThisHour = 0;
    state.tokensHourKey = hour;
  }
  return state;
}

function recordSuccess(provider: string, latencyMs: number, tokensUsed: number) {
  const circuit = getCircuit(provider);
  circuit.totalRequests++;
  circuit.successes++;
  circuit.consecutiveFailures = 0;
  circuit.lastSuccessAt = Date.now();
  circuit.tokensUsedToday += tokensUsed;
  circuit.tokensUsedThisHour += tokensUsed;

  circuit.latencySamples.push(latencyMs);
  if (circuit.latencySamples.length > LATENCY_SAMPLE_LIMIT) {
    circuit.latencySamples = circuit.latencySamples.slice(-LATENCY_SAMPLE_LIMIT);
  }
  circuit.avgLatencyMs = Math.round(
    circuit.latencySamples.reduce((a, b) => a + b, 0) / circuit.latencySamples.length
  );

  if (circuit.isOpen) {
    circuit.isOpen = false;
    circuit.halfOpenProbeInFlight = false;
    circuit.failures = 0;
    console.log(`[AIGateway] Circuit CLOSED for ${provider} after successful recovery`);
  }
}

function recordFailure(provider: string) {
  const circuit = getCircuit(provider);
  circuit.totalRequests++;
  circuit.totalFailures++;
  circuit.failures++;
  circuit.consecutiveFailures++;
  circuit.lastFailureAt = Date.now();
  circuit.halfOpenProbeInFlight = false;

  if (circuit.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.isOpen = true;
    const backoff = Math.min(
      CIRCUIT_COOLDOWN_BASE_MS * Math.pow(2, Math.floor(circuit.consecutiveFailures / CIRCUIT_FAILURE_THRESHOLD) - 1),
      CIRCUIT_COOLDOWN_MAX_MS
    );
    circuit.cooldownUntil = Date.now() + backoff;
    console.warn(`[AIGateway] Circuit OPEN for ${provider}, cooldown ${backoff}ms`);
  }
}

function isCircuitAllowing(provider: string): boolean {
  const circuit = getCircuit(provider);
  if (!circuit.isOpen) return true;
  if (Date.now() >= circuit.cooldownUntil) {
    if (circuit.halfOpenProbeInFlight) return false;
    circuit.halfOpenProbeInFlight = true;
    console.log(`[AIGateway] Circuit HALF-OPEN for ${provider}, allowing single probe request`);
    return true;
  }
  return false;
}

function createLibreTranslateAdapter(): ProviderAdapter {
  const DEFAULT_LT_URL = "https://libretranslate.com";
  return {
    name: "libretranslate",
    isAvailable() {
      // Always attempt — uses configured URL or falls back to public endpoint
      return true;
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      if (!req.metadata?.targetLang) throw new Error("LibreTranslate requires metadata.targetLang");
      const url = (process.env.LIBRETRANSLATE_URL || DEFAULT_LT_URL).replace(/\/+$/, "");
      const apiKey = process.env.LIBRETRANSLATE_API_KEY;
      const sourceLang = (req.metadata?.sourceLang as string) || "auto";
      const targetLang = req.metadata.targetLang as string;
      const text = req.prompt || req.messages?.[req.messages.length - 1]?.content || "";

      const fetch = await getFetch();
      const body: Record<string, string> = { q: text, source: sourceLang, target: targetLang, format: "text" };
      if (apiKey) body.api_key = apiKey;

      const startMs = Date.now();
      const resp = await fetch(`${url}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) throw new Error(`LibreTranslate HTTP ${resp.status}`);
      const data = await resp.json() as LibreTranslateResponse;
      const result = data.translatedText;
      if (!result) throw new Error("LibreTranslate returned empty result");

      return {
        text: result,
        provider: "libretranslate",
        model: "libretranslate",
        tokensUsed: Math.ceil(text.length / 4),
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

function createDeepSeekAdapter(): ProviderAdapter {
  return {
    name: "deepseek",
    isAvailable() {
      return !!process.env.GITHUB_MODELS_TOKEN;
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const token = process.env.GITHUB_MODELS_TOKEN!;
      const messages = req.messages || [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: req.prompt || "" },
      ];
      const model = "DeepSeek-V3";

      const fetch = await getFetch();
      const startMs = Date.now();
      const resp = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.temperature ?? 0.1,
          max_tokens: req.maxTokens ?? 500,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!resp.ok) throw new Error(`DeepSeek/GitHub HTTP ${resp.status}`);
      const data = await resp.json() as KimiChatResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("DeepSeek returned empty result");

      const tokensUsed = data.usage?.total_tokens || Math.ceil((req.prompt || "").length / 4);

      return {
        text,
        provider: "deepseek",
        model,
        tokensUsed,
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

function createOpenRouterAdapter(): ProviderAdapter {
  return {
    name: "openrouter",
    isAvailable() {
      return !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || apiKeys.openrouter());
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const replitBase = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
      const replitKey  = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
      const directKey  = apiKeys.openrouter();

      const baseURL = replitBase || "https://openrouter.ai/api/v1";
      const apiKey  = replitKey  || directKey;
      if (!apiKey) throw new Error("OpenRouter API key not available");

      const client = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders: {
          "HTTP-Referer": "https://junotalk.app",
          "X-Title": "JunoTalk",
        },
      });

      const messages = req.messages || [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: req.prompt || "" },
      ];

      // Free models — Qwen3 preferred (119-language native support, free, fast)
      // Gemma kept as fallback. Updated March 2026.
      const chatModels = [
        "qwen/qwen3-30b-a3b:free",              // MoE, 3B active, 131K ctx — best free chat
        "qwen/qwen3-8b:free",                   // dense 8B, fast, strong multilingual
        "google/gemma-3-27b-it:free",           // fallback — good quality but EN-centric
        "google/gemma-3-12b-it:free",           // fallback
        "meta-llama/llama-3.3-70b-instruct:free", // 429 sometimes, best quality EN
      ];
      const modelList = req.task === "translation"
        ? [
            "qwen/qwen3-8b:free",               // best free multilingual translation
            "qwen/qwen3-30b-a3b:free",          // higher quality fallback
            "google/gemma-3-12b-it:free",       // EN-centric fallback
            "google/gemma-3-27b-it:free",
          ]
        : chatModels;

      const startMs = Date.now();

      // ── Juno's Cache Intelligence — L1 → L2 → L3 check ───────────────────
      // A cache hit means zero API calls — directly protects Qwen3 rate limits.
      const cacheDecision = decideCaching(req);
      const cached = await junoGet(cacheDecision);
      if (cached) {
        return {
          text: cached,
          provider: "openrouter",
          model: "cached",
          tokensUsed: 0,
          latencyMs: Date.now() - startMs,
          fromFallback: false,
        };
      }

      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const response = await client.chat.completions.create({
            model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 500,
          });
          const text = response.choices?.[0]?.message?.content?.trim();
          if (!text) throw new Error("OpenRouter returned empty result");
          // Write back through the intelligence layer — non-blocking
          junoSet(cacheDecision, text);
          return {
            text,
            provider: "openrouter",
            model,
            tokensUsed: response.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          // Continue to next model on rate-limit (429) or not-found (404) errors
          const msg = lastError.message || "";
          const isSkippable = msg.includes("429") || msg.includes("404") || msg.includes("No endpoints");
          if (!isSkippable) throw lastError;
        }
      }
      throw lastError || new Error("All OpenRouter models unavailable or rate-limited");
    },
  };
}

function createKimiAdapter(): ProviderAdapter {
  return {
    name: "kimi",
    isAvailable() {
      return !!apiKeys.moonshot();
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const apiKey = apiKeys.moonshot();
      const messages = req.messages || [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: req.prompt || "" },
      ];
      const model = req.model || "moonshot-v1-32k";

      const fetch = getFetch();
      const startMs = Date.now();
      const resp = await fetch("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.temperature ?? 0.1,
          max_tokens: req.maxTokens ?? 500,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) throw new Error(`Kimi HTTP ${resp.status}`);
      const data = await resp.json() as KimiChatResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("Kimi returned empty result");

      const tokensUsed = data.usage?.total_tokens || Math.ceil((req.prompt || "").length / 4);

      return {
        text,
        provider: "kimi",
        model,
        tokensUsed,
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

function createGeminiAdapter(): ProviderAdapter {
  return {
    name: "gemini",
    isAvailable() {
      return !!apiKeys.gemini();
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const apiKey = apiKeys.gemini();
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelName = req.model || "gemini-2.0-flash";
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = req.prompt || req.messages?.map(m => m.content).join("\n") || "";

      const startMs = Date.now();
      const result = await model.generateContent(prompt);
      const text = result.response?.text()?.trim();
      if (!text) throw new Error("Gemini returned empty result");

      const tokensUsed = result.response?.usageMetadata?.totalTokenCount || Math.ceil(prompt.length / 4);

      return {
        text,
        provider: "gemini",
        model: modelName,
        tokensUsed,
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

function createGitHubModelsAdapter(): ProviderAdapter {
  const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com";

  // Open-source chat models — tried in order, first success wins
  const CHAT_MODELS = [
    "Meta-Llama-3.3-70B-Instruct",          // open-source, free, strong quality
    "Meta-Llama-3.1-70B-Instruct",          // fallback open-source
    "Phi-4",                                 // Microsoft, strong reasoning + multilingual
    "Mistral-small",                         // fast multilingual, great for chat
    "Mistral-large-2411",                    // high quality, strong instruction following
    "Cohere-command-r-plus-08-2024",         // excellent at conversation & RAG
    "DeepSeek-R1",                           // reasoning model, strong at complex tasks
    "gpt-4o",                                // closed but free via GitHub — last fallback
  ];

  // Background/extraction tasks — GPT-4o gives best structured output
  const BACKGROUND_MODELS = [
    "gpt-4o",
    "Meta-Llama-3.3-70B-Instruct",
    "Phi-4",
    "Mistral-large-2411",
  ];

  return {
    name: "github-models",
    isAvailable() {
      return !!apiKeys.githubModels();
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const token = apiKeys.githubModels();
      const client = new OpenAI({
        apiKey: token,
        baseURL: GITHUB_MODELS_ENDPOINT,
      });

      const modelList = req.model
        ? [req.model]
        : req.task === "background"
          ? BACKGROUND_MODELS
          : CHAT_MODELS;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];

      const startMs = Date.now();
      let lastError: Error | null = null;

      for (const model of modelList) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            max_tokens: req.maxTokens ?? 600,
            temperature: req.temperature ?? 0.7,
          });
          const text = completion.choices[0]?.message?.content?.trim();
          if (!text) throw new Error("empty response");
          return {
            text,
            provider: "github-models",
            model,
            tokensUsed: completion.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      throw lastError ?? new Error("GitHub Models: all models failed");
    },
  };
}

function createOpenAIAdapter(): ProviderAdapter {
  return {
    name: "openai",
    isAvailable() {
      // Works via Replit's modelfarm proxy even with dummy key
      return !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || apiKeys.openai());
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      // Use dummy key when routing through Replit proxy — it handles auth internally
      const apiKey = baseURL ? (process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "replit-proxy") : apiKeys.openai();
      const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

      const model = req.model || "gpt-4o-mini";
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];

      const startMs = Date.now();
      const completion = await client.chat.completions.create({
        model,
        messages,
        max_tokens: req.maxTokens ?? 600,
        temperature: req.temperature ?? 0.7,
      });

      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) throw new Error("OpenAI returned empty result");

      const tokensUsed = (completion.usage?.total_tokens) || 0;
      return {
        text,
        provider: "openai",
        model,
        tokensUsed,
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

// ── Groq: ultra-fast free-tier inference (Llama, Mixtral, Gemma) ──────────────
function createGroqAdapter(): ProviderAdapter {
  const GROQ_ENDPOINT = "https://api.groq.com/openai/v1";
  const MODELS = [
    "llama-3.3-70b-versatile",   // best quality, free tier
    "llama-3.1-8b-instant",      // fastest, very low latency
    "mixtral-8x7b-32768",        // good reasoning, large context
    "gemma2-9b-it",              // Google Gemma, efficient
  ];
  return {
    name: "groq",
    isAvailable() { return !!apiKeys.groq(); },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const client = new OpenAI({ apiKey: apiKeys.groq(), baseURL: GROQ_ENDPOINT });
      const modelList = req.model ? [req.model] : MODELS;
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];
      const startMs = Date.now();
      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            max_tokens: req.maxTokens ?? 600,
            temperature: req.temperature ?? 0.7,
          });
          const text = completion.choices[0]?.message?.content?.trim();
          if (!text) throw new Error("Empty response");
          return {
            text,
            provider: "groq",
            model,
            tokensUsed: completion.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastError || new Error("Groq: all models failed");
    },
  };
}

// ── HuggingFace Serverless Inference: free OpenAI-compatible endpoint ─────────
function createHuggingFaceAdapter(): ProviderAdapter {
  const HF_ENDPOINT = "https://api-inference.huggingface.co/v1";
  const MODELS = [
    "Qwen/Qwen2.5-72B-Instruct",          // top open-weight, free serverless
    "meta-llama/Llama-3.2-3B-Instruct",   // small but fast, free
    "mistralai/Mistral-7B-Instruct-v0.3", // strong multilingual
  ];
  return {
    name: "huggingface",
    isAvailable() { return !!apiKeys.hf(); },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const client = new OpenAI({ apiKey: apiKeys.hf(), baseURL: HF_ENDPOINT });
      const modelList = req.model ? [req.model] : MODELS;
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];
      const startMs = Date.now();
      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            max_tokens: req.maxTokens ?? 600,
            temperature: req.temperature ?? 0.7,
          });
          const text = completion.choices[0]?.message?.content?.trim();
          if (!text) throw new Error("Empty response");
          return {
            text,
            provider: "huggingface",
            model,
            tokensUsed: completion.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastError || new Error("HuggingFace: all models failed");
    },
  };
}

// ── Pollinations.ai: completely free, no key, 30+ models ─────────────────────
function createPollinationsAdapter(): ProviderAdapter {
  const POLLINATIONS_ENDPOINT = "https://text.pollinations.ai/openai";
  // Models available free on Pollinations (as of 2026)
  const MODELS = [
    "openai",         // routes to GPT-4o free
    "mistral",        // Mistral large
    "llama",          // Meta Llama
    "qwen",           // Qwen 72B
    "deepseek",       // DeepSeek V3
  ];
  return {
    name: "pollinations",
    isAvailable() { return true; }, // no key needed — always available
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const modelList = req.model ? [req.model] : MODELS;
      const messages: Array<{ role: string; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];
      const startMs = Date.now();
      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const resp = await fetch(POLLINATIONS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              max_tokens: req.maxTokens ?? 600,
              temperature: req.temperature ?? 0.7,
              private: true,  // prevent logging by Pollinations
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) throw new Error(`Pollinations HTTP ${resp.status}`);
          const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
          const text = data.choices?.[0]?.message?.content?.trim();
          if (!text) throw new Error("Empty response");
          return {
            text,
            provider: "pollinations",
            model,
            tokensUsed: data.usage?.total_tokens || Math.ceil((req.prompt?.length || 200) / 4),
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastError || new Error("Pollinations: all models failed");
    },
  };
}

// ── Cerebras: ultra-fast Llama inference, free tier ───────────────────────────
function createCerebrasAdapter(): ProviderAdapter {
  const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1";
  const MODELS = [
    "llama3.3-70b", // Llama 3.3 70B — blazing fast on Cerebras wafer chip
    "llama3.1-8b",  // tiny, sub-100ms responses
  ];
  return {
    name: "cerebras",
    isAvailable() { return !!apiKeys.cerebras(); },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const client = new OpenAI({ apiKey: apiKeys.cerebras(), baseURL: CEREBRAS_ENDPOINT });
      const modelList = req.model ? [req.model] : MODELS;
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];
      const startMs = Date.now();
      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            max_tokens: req.maxTokens ?? 600,
            temperature: req.temperature ?? 0.7,
          });
          const text = completion.choices[0]?.message?.content?.trim();
          if (!text) throw new Error("Empty response");
          return {
            text,
            provider: "cerebras",
            model,
            tokensUsed: completion.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastError || new Error("Cerebras: all models failed");
    },
  };
}

// ── Mistral AI: free open-weight models via official API ──────────────────────
function createMistralAdapter(): ProviderAdapter {
  const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1";
  const MODELS = [
    "open-mistral-nemo",  // free, 128k context, great multilingual
    "open-mistral-7b",    // free, fast and reliable
  ];
  return {
    name: "mistral",
    isAvailable() { return !!apiKeys.mistral(); },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const client = new OpenAI({ apiKey: apiKeys.mistral(), baseURL: MISTRAL_ENDPOINT });
      const modelList = req.model ? [req.model] : MODELS;
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
        req.messages || [{ role: "user", content: req.prompt || "" }];
      const startMs = Date.now();
      let lastError: Error | null = null;
      for (const model of modelList) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            max_tokens: req.maxTokens ?? 600,
            temperature: req.temperature ?? 0.7,
          });
          const text = completion.choices[0]?.message?.content?.trim();
          if (!text) throw new Error("Empty response");
          return {
            text,
            provider: "mistral",
            model,
            tokensUsed: completion.usage?.total_tokens || 0,
            latencyMs: Date.now() - startMs,
            fromFallback: false,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw lastError || new Error("Mistral: all models failed");
    },
  };
}

function createClaudeAdapter(): ProviderAdapter {
  return {
    name: "claude",
    isAvailable() {
      return !!apiKeys.anthropic();
    },
    async execute(req: AIGatewayRequest): Promise<AIGatewayResponse> {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = apiKeys.anthropic();
      const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
      const client = new Anthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });

      const model = req.model || "claude-3-5-sonnet-20241022";
      const systemMsg = req.messages?.find(m => m.role === "system")?.content;
      const userMessages = (req.messages || [{ role: "user" as const, content: req.prompt || "" }])
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      const startMs = Date.now();
      const response = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 500,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: userMessages,
      });

      const textBlock = response.content.find((b: AnthropicContentBlock) => b.type === "text") as AnthropicContentBlock | undefined;
      const text = textBlock?.text?.trim();
      if (!text) throw new Error("Claude returned empty result");

      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return {
        text,
        provider: "claude",
        model,
        tokensUsed,
        latencyMs: Date.now() - startMs,
        fromFallback: false,
      };
    },
  };
}

const defaultRoutingConfig: ProviderRouteConfig[] = [
  // ── TRANSLATION — free & offline-capable first, OpenAI only as last resort ─
  // 1. LibreTranslate: self-hosted or public, no per-token cost, works offline
  { provider: "libretranslate", priority: 0, timeoutMs: 8000,  maxRetries: 1, tasks: ["translation"] },
  // 2. DeepSeek via GitHub Models: free with GitHub token, excellent multilingual
  { provider: "deepseek",       priority: 1, timeoutMs: 15000, maxRetries: 1, tasks: ["translation", "translation_prompt"], dailyTokenBudget: 150000 },
  // 3. GitHub Models (Llama/GPT-4o): free, strong multilingual support
  { provider: "github-models",  priority: 2, timeoutMs: 18000, maxRetries: 1, tasks: ["translation", "translation_prompt"] },
  // 4. Gemini: limited free quota
  { provider: "gemini",         priority: 3, timeoutMs: 15000, maxRetries: 1, tasks: ["translation", "translation_prompt"] },
  // 5. Kimi: cheap with budget cap
  { provider: "kimi",           priority: 4, timeoutMs: 15000, maxRetries: 1, tasks: ["translation", "translation_prompt"], dailyTokenBudget: 50000 },
  // 6. OpenRouter: free models if connected
  { provider: "openrouter",     priority: 5, timeoutMs: 15000, maxRetries: 1, tasks: ["translation", "translation_prompt"] },
  // 7. OpenAI: LAST RESORT only — hard 20k/day cap to protect quota
  { provider: "openai",         priority: 9, timeoutMs: 20000, maxRetries: 0, tasks: ["translation", "translation_prompt"], dailyTokenBudget: 20000 },

  // ── USER CHAT — keyless/already-keyed free providers first ───────────────────
  { provider: "pollinations",   priority: -10, timeoutMs: 15000, maxRetries: 1, tasks: ["chat", "monitor"] },           // no key needed, 30+ models
  { provider: "groq",           priority: -9,  timeoutMs: 10000, maxRetries: 1, tasks: ["chat", "translation_prompt"] }, // key already configured, ultra-fast
  { provider: "github-models",  priority: -7,  timeoutMs: 18000, maxRetries: 1, tasks: ["chat", "monitor"] },           // 8 free models, token already set
  { provider: "deepseek",       priority: -4,  timeoutMs: 20000, maxRetries: 1, tasks: ["chat", "monitor", "general"], dailyTokenBudget: 150000 },
  { provider: "openrouter",     priority: -3,  timeoutMs: 15000, maxRetries: 1, tasks: ["chat", "general"] },
  // ── paid fallbacks (only reached if ALL free providers fail) ──────────────
  { provider: "openai",         priority: 0,   timeoutMs: 20000, maxRetries: 1, tasks: ["chat", "monitor", "general"], dailyTokenBudget: 100000 },
  { provider: "gemini",         priority: 1,   timeoutMs: 15000, maxRetries: 1, tasks: ["chat"] },
  { provider: "kimi",           priority: 3,   timeoutMs: 15000, maxRetries: 1, tasks: ["chat"], dailyTokenBudget: 50000 },
  { provider: "claude",         priority: 5,   timeoutMs: 25000, maxRetries: 1, tasks: ["chat"], dailyTokenBudget: 20000 },

  // ── BACKGROUND AUTOMATION — keyless/already-keyed free first ─────────────
  { provider: "groq",           priority: -2,  timeoutMs: 10000, maxRetries: 1, tasks: ["background"] },
  { provider: "pollinations",   priority: -1,  timeoutMs: 15000, maxRetries: 1, tasks: ["background"] },
  { provider: "github-models",  priority: 0,   timeoutMs: 12000, maxRetries: 1, tasks: ["background"] },
  { provider: "openrouter",     priority: 2,   timeoutMs: 15000, maxRetries: 1, tasks: ["background"] },
  { provider: "deepseek",       priority: 3,   timeoutMs: 20000, maxRetries: 1, tasks: ["background"], dailyTokenBudget: 50000 },
  { provider: "openai",         priority: 8,   timeoutMs: 20000, maxRetries: 0, tasks: ["background"], dailyTokenBudget: 15000 },
];

let routingConfig: ProviderRouteConfig[] = [...defaultRoutingConfig];

const requestLog: Array<{
  ts: number;
  provider: string;
  task: string;
  latencyMs: number;
  success: boolean;
  tokensUsed: number;
  error?: string;
}> = [];

const MAX_REQUEST_LOG = 200;

function logRequest(entry: typeof requestLog[0]) {
  requestLog.push(entry);
  if (requestLog.length > MAX_REQUEST_LOG) {
    requestLog.splice(0, requestLog.length - MAX_REQUEST_LOG);
  }
}

function initAdapters() {
  if (adapters.size > 0) return;
  const allAdapters = [
    createGitHubModelsAdapter(),
    createOpenAIAdapter(),
    createOpenRouterAdapter(),
    createLibreTranslateAdapter(),
    createDeepSeekAdapter(),
    createKimiAdapter(),
    createGeminiAdapter(),
    createClaudeAdapter(),
    // ── New free platforms ──
    createGroqAdapter(),
    createHuggingFaceAdapter(),
    createPollinationsAdapter(),
    createCerebrasAdapter(),
    createMistralAdapter(),
  ];
  for (const adapter of allAdapters) {
    adapters.set(adapter.name, adapter);
  }
}

function isBudgetAllowing(config: ProviderRouteConfig): boolean {
  if (!config.dailyTokenBudget) return true;
  const circuit = getCircuit(config.provider);
  if (circuit.tokensUsedToday >= config.dailyTokenBudget) {
    console.log(`[AIGateway] ${config.provider} daily token budget reached — skipping provider`);
    return false;
  }
  return true;
}

function getProvidersForTask(task: string): ProviderRouteConfig[] {
  const useArena = getArenaFlag("arena_routing");

  if (useArena) {
    const allArena = (getArenaRoutingConfig() as ProviderRouteConfig[])
      .filter(r => r.tasks.includes(task))
      .sort((a, b) => a.priority - b.priority);

    // Pick ONE model via weighted selection — cheapest/free models win most often
    const weighted = pickWeightedModel(task);
    if (weighted) {
      const primary = allArena.find(r => r.provider === weighted.provider);
      if (primary) {
        // Put the weighted pick first; keep the rest as hard-failure fallbacks only
        const fallbacks = allArena.filter(r => r.provider !== weighted.provider);
        return [primary, ...fallbacks];
      }
    }
    if (allArena.length > 0) return allArena;
  }

  return routingConfig
    .filter(r => r.tasks.includes(task))
    .sort((a, b) => a.priority - b.priority);
}

async function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeoutPromise]);
}

export async function gatewayRequest(req: AIGatewayRequest): Promise<AIGatewayResponse> {
  initAdapters();

  const task = req.task || "general";
  const candidates = getProvidersForTask(task);

  if (candidates.length === 0) {
    throw new Error(`[AIGateway] No providers configured for task: ${task}`);
  }

  const errors: string[] = [];

  for (const config of candidates) {
    const adapter = adapters.get(config.provider);
    if (!adapter || !adapter.isAvailable()) continue;
    if (!isCircuitAllowing(config.provider)) {
      errors.push(`${config.provider}: circuit open`);
      continue;
    }
    if (!isBudgetAllowing(config)) {
      errors.push(`${config.provider}: daily budget reached`);
      continue;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await executeWithTimeout(
          adapter.execute(req),
          config.timeoutMs,
          config.provider
        );

        recordSuccess(config.provider, response.latencyMs, response.tokensUsed);
        recordProviderUsage(config.provider);
        logRequest({
          ts: Date.now(),
          provider: config.provider,
          task,
          latencyMs: response.latencyMs,
          success: true,
          tokensUsed: response.tokensUsed,
        });

        if (errors.length > 0) {
          response.fromFallback = true;
        }

        persistUsageAsync(config.provider, response.tokensUsed);

        return response;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < config.maxRetries) {
          console.warn(`[AIGateway] ${config.provider} attempt ${attempt + 1} failed, retrying...`);
        }
      }
    }

    recordFailure(config.provider);
    const errorMsg = lastError?.message || "Unknown error";
    errors.push(`${config.provider}: ${errorMsg}`);
    logRequest({
      ts: Date.now(),
      provider: config.provider,
      task,
      latencyMs: 0,
      success: false,
      tokensUsed: 0,
      error: errorMsg,
    });
    console.warn(`[AIGateway] Provider ${config.provider} failed: ${errorMsg}`);
  }

  throw new Error(`[AIGateway] All providers failed for task '${task}': ${errors.join("; ")}`);
}

function buildVectorContextPrompt(vectorContext?: { sourceText: string; translatedText: string }[]): string {
  if (!vectorContext || vectorContext.length === 0) return "";
  const examples = vectorContext.slice(0, 3).map((c, i) =>
    `Example ${i + 1}: "${c.sourceText}" → "${c.translatedText}"`
  ).join("\n");
  return `\nHere are similar past translations for consistency:\n${examples}\n`;
}

export async function gatewayTranslate(
  text: string,
  targetLang: string,
  sourceLang: string,
  langNameFn?: (code: string) => string,
  vectorContext?: { sourceText: string; translatedText: string }[],
  systemPrompt?: string
): Promise<{ translatedText: string; provider: string } | null> {
  const getLangName = langNameFn || ((code: string) => code);
  const targetLangName = getLangName(targetLang);
  const sourceLangName = getLangName(sourceLang);
  const contextStr = buildVectorContextPrompt(vectorContext);

  const req: AIGatewayRequest = {
    task: "translation",
    prompt: text,
    metadata: { sourceLang, targetLang },
  };

  const candidates = getProvidersForTask("translation");
  initAdapters();
  const errors: string[] = [];

  for (const config of candidates) {
    const adapter = adapters.get(config.provider);
    if (!adapter || !adapter.isAvailable()) continue;
    if (!isCircuitAllowing(config.provider)) {
      errors.push(`${config.provider}: circuit open`);
      continue;
    }
    if (!isBudgetAllowing(config)) {
      errors.push(`${config.provider}: daily budget reached`);
      continue;
    }

    let translationReq: AIGatewayRequest;

    if (config.provider === "libretranslate") {
      translationReq = { ...req };
    } else {
      const recall = recallForTranslation(text, sourceLang, targetLang);
      const recallContext = buildRecallPromptContext(recall);

      const reasoning = analyzeQuery(text);
      const reasoningStr = buildReasoningContext(reasoning);

      const personality = getPersonalityForContext(recall.intent?.intent);
      const personalityStr = buildPersonalityPrompt(personality);

      // Orchestrated recall — activates semantic (System 2) + keyword (System 4)
      // in parallel alongside the existing System 1 recall above.
      const orchestrated = await orchestrateRecall(
        { text, sourceLang, targetLang },
        "translation",
      );

      const recallLines: string[] = [];
      if (recall.intent) recallLines.push(`Detected intent: ${recall.intent.intent} (confidence: ${(recall.intent.confidence * 100).toFixed(0)}%)`);
      if (recall.idiom) recallLines.push(`Idiom detected: "${recall.idiom.original}" → "${recall.idiom.equivalent}" (${recall.idiom.meaning})`);
      if (recall.culturalNotes.length > 0) recallLines.push(`Cultural context: ${recall.culturalNotes.map(n => n.note).join("; ")}`);
      if (recallContext) recallLines.push(recallContext);
      if (orchestrated.context) recallLines.push(orchestrated.context);

      const baseRole = systemPrompt ||
        `You are a world-class interpreter with native-level mastery of both ${sourceLangName} and ${targetLangName}. You interpret live spoken language — not written text. You understand intent, emotion, slang, humor, and cultural nuance.`;

      const reasoningChain = `
REASONING FRAMEWORK — work through each step internally before producing your translation:

STEP 1 — INTENT & EMOTION
What does the speaker actually mean? Look beyond the literal words — consider implied meaning, emotional state, urgency, sarcasm, or subtext.${reasoning.isComplex ? `\nComplexity signals detected: ${reasoningStr}` : ""}

STEP 2 — REGISTER & TONE
Is this formal, casual, slang, technical, emotional, or playful? Match the register exactly. Spoken language is often messier than written — clean it up without losing the voice.${personalityStr ? `\nTone directive: ${personalityStr}` : ""}

STEP 3 — CULTURAL ADAPTATION
Are there idioms, expressions, or cultural references that need adaptation rather than literal translation? Find the closest natural equivalent in ${targetLangName}.${recallLines.length > 0 ? `\nKnowledge base:\n${recallLines.map(l => `  • ${l}`).join("\n")}` : ""}

STEP 4 — LANGUAGE PAIR KNOWLEDGE
Use these preloaded ${sourceLangName}→${targetLangName} reference examples to match vocabulary, phrasing style, and natural expression. These are curated translation samples — let them inform your word choices.${(() => {
        const ghPairs = githubFallbackCache[sourceLang]?.[targetLang] || {};
        const localPairs = COMMON_PHRASES[sourceLang]?.[targetLang] || {};
        const combined = { ...localPairs, ...ghPairs };
        const entries = Object.entries(combined);
        if (entries.length === 0) return "\nNo reference pairs available for this language combination.";
        const sampled = entries.length <= 8 ? entries : entries.sort(() => Math.random() - 0.5).slice(0, 8);
        return `\nReference examples:\n${sampled.map(([src, tgt]) => `  "${src}" → "${tgt}"`).join("\n")}`;
      })()}${contextStr ? `\nTranslation memory context:\n${contextStr}` : ""}

OUTPUT RULE
After reasoning through the above, output ONLY the final ${targetLangName} translation. One clean, speakable utterance. No notes, no brackets, no alternatives, no explanations.`;

      translationReq = {
        ...req,
        messages: [
          {
            role: "system",
            content: `${baseRole}\n${reasoningChain}`,
          },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        maxTokens: 500,
      };
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await executeWithTimeout(
          adapter.execute(translationReq),
          config.timeoutMs,
          config.provider
        );

        recordSuccess(config.provider, response.latencyMs, response.tokensUsed);
        recordProviderUsage(config.provider);
        logRequest({
          ts: Date.now(),
          provider: config.provider,
          task: "translation",
          latencyMs: response.latencyMs,
          success: true,
          tokensUsed: response.tokensUsed,
        });

        persistUsageAsync(config.provider, response.tokensUsed);

        return { translatedText: response.text, provider: config.provider };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < config.maxRetries) {
          console.warn(`[AIGateway] ${config.provider} translation attempt ${attempt + 1} failed, retrying...`);
        }
      }
    }

    recordFailure(config.provider);
    const errorMsg = lastError?.message || "Unknown error";
    errors.push(`${config.provider}: ${errorMsg}`);
    logRequest({
      ts: Date.now(),
      provider: config.provider,
      task: "translation",
      latencyMs: 0,
      success: false,
      tokensUsed: 0,
      error: errorMsg,
    });
    console.warn(`[AIGateway] Translation provider ${config.provider} failed: ${errorMsg}`);
  }

  console.error(`[AIGateway] All translation providers failed: ${errors.join("; ")}`);
  return null;
}

export async function gatewayChat(
  systemPrompt: string,
  userContent: string,
  options?: { task?: AIGatewayRequest["task"]; model?: string; maxTokens?: number; temperature?: number }
): Promise<{ text: string; provider: string; tokensUsed: number } | null> {
  try {
    const personality = getPersonalityForContext();
    const personalityPrompt = buildPersonalityPrompt(personality);
    const enrichedSystemPrompt = personalityPrompt
      ? `${systemPrompt}\n\n${personalityPrompt}`
      : systemPrompt;

    const reasoning = analyzeQuery(userContent);
    const reasoningContext = buildReasoningContext(reasoning);
    const finalSystemPrompt = reasoningContext
      ? `${enrichedSystemPrompt}\n\n${reasoningContext}`
      : enrichedSystemPrompt;

    const response = await gatewayRequest({
      task: options?.task || "chat",
      model: options?.model,
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: userContent },
      ],
      maxTokens: options?.maxTokens ?? 500,
      temperature: options?.temperature ?? 0.3,
    });
    return { text: response.text, provider: response.provider, tokensUsed: response.tokensUsed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AIGateway] gatewayChat failed: ${msg}`);
    return null;
  }
}

function persistUsageAsync(provider: string, tokensUsed: number) {
  if (!isRedisAvailable() || tokensUsed <= 0) return;
  const dayKey = getTodayKey();
  const hourKey = getHourKey();
  const dailyRedisKey = `${USAGE_REDIS_PREFIX}:daily:${dayKey}:${provider}`;
  const hourlyRedisKey = `${USAGE_REDIS_PREFIX}:hourly:${hourKey}:${provider}`;

  redisIncrBy(dailyRedisKey, tokensUsed, USAGE_TTL).catch(() => {});
  redisIncrBy(hourlyRedisKey, tokensUsed, 24 * 60 * 60).catch(() => {});
}

export function getGatewayHealth(): {
  providers: ProviderHealthData[];
  routing: ProviderRouteConfig[];
  recentRequests: typeof requestLog;
} {
  initAdapters();

  const providers: ProviderHealthData[] = [];
  for (const [name, adapter] of adapters) {
    const circuit = getCircuit(name);
    providers.push({
      name,
      available: adapter.isAvailable(),
      circuitOpen: circuit.isOpen,
      totalRequests: circuit.totalRequests,
      totalFailures: circuit.totalFailures,
      consecutiveFailures: circuit.consecutiveFailures,
      avgLatencyMs: circuit.avgLatencyMs,
      lastFailureAt: circuit.lastFailureAt || null,
      lastSuccessAt: circuit.lastSuccessAt || null,
      tokensUsedToday: circuit.tokensUsedToday,
    });
  }

  return {
    providers,
    routing: routingConfig,
    recentRequests: requestLog.slice(-50),
  };
}

export async function getGatewayUsageStats(): Promise<Record<string, { tokensToday: number; tokensThisHour: number }>> {
  initAdapters();
  const stats: Record<string, { tokensToday: number; tokensThisHour: number }> = {};
  const dayKey = getTodayKey();
  const hourKey = getHourKey();

  for (const [name] of adapters) {
    const circuit = getCircuit(name);
    let redisDailyTokens = 0;
    let redisHourlyTokens = 0;
    if (isRedisAvailable()) {
      try {
        const dailyRaw = await redisGet(`${USAGE_REDIS_PREFIX}:daily:${dayKey}:${name}`);
        if (dailyRaw) redisDailyTokens = parseInt(dailyRaw, 10) || 0;
        const hourlyRaw = await redisGet(`${USAGE_REDIS_PREFIX}:hourly:${hourKey}:${name}`);
        if (hourlyRaw) redisHourlyTokens = parseInt(hourlyRaw, 10) || 0;
      } catch {}
    }
    stats[name] = {
      tokensToday: Math.max(circuit.tokensUsedToday, redisDailyTokens),
      tokensThisHour: Math.max(circuit.tokensUsedThisHour, redisHourlyTokens),
    };
  }

  return stats;
}

export function resetProviderCircuit(provider: string): boolean {
  const state = circuitStates.get(provider);
  if (!state) return false;
  state.isOpen = false;
  state.failures = 0;
  state.consecutiveFailures = 0;
  state.cooldownUntil = 0;
  console.log(`[AIGateway] Circuit manually reset for ${provider}`);
  return true;
}

export function updateRoutingConfig(config: ProviderRouteConfig[]) {
  routingConfig = config;
  console.log(`[AIGateway] Routing config updated with ${config.length} entries`);
}

export function getRoutingConfig(): ProviderRouteConfig[] {
  return [...routingConfig];
}

export function getConfiguredProviders(task?: string): string[] {
  initAdapters();
  const available = Array.from(adapters.entries())
    .filter(([_, adapter]) => adapter.isAvailable())
    .map(([name]) => name);

  if (!task) return available;

  const taskProviders = getProvidersForTask(task).map(r => r.provider);
  return available.filter(name => taskProviders.includes(name));
}
