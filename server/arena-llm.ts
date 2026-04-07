/**
 * Arena LLM Stack — JunoTalk AI Model Routing CDN
 *
 * Loads LLM configuration from lasawno/Arena-LLM-stack- on GitHub.
 * Controls model selection, temperature, token limits, provider priority,
 * fallback chains, and Juno persona settings across all AI tasks.
 *
 * GitHub repo: lasawno/Arena-LLM-stack-
 * Config file: config/llm-stack.json
 *
 * Refreshes hourly. Falls back to hardcoded defaults if CDN is unreachable.
 */

import { fetchFromRepo, pushToRepo } from "./github-config";

const ARENA_OWNER    = "lasawno";
const ARENA_REPO     = "Arena-LLM-stack-";
const ARENA_BRANCH   = "main";
const CONFIG_PATH    = "config/llm-stack.json";
const MODELS_PATH    = "config/models.json";
const TTL_MS         = 15 * 60 * 1000; // 15 minutes — same cadence as other GitHub-backed configs

export interface ArenaModelConfig {
  model: string;
  provider: string;
  temperature: number;
  max_tokens: number;
}

/** Registry entry from models.json — matches the schema from the LLM CDN spec */
export interface ArenaModelEntry {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  model?: string;
  type: "chat" | "translation" | "monitor" | "fallback" | string;
  priority: number;
  weight: number;   // legacy weighted routing (kept for backwards compat)
  cost: number;     // 1 (free) → 10 (expensive) — lower is better
  quality: number;  // 1 (weak) → 10 (best) — higher is better
  speed: number;    // 1 (slow) → 10 (instant) — informational only
  dailyTokenBudget?: number;
  timeoutMs?: number;
}

/** Gateway-compatible routing config derived from models.json */
export interface ArenaRouteConfig {
  provider: string;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  tasks: string[];
  dailyTokenBudget?: number;
}

export interface ArenaPersona {
  name: string;
  voice: string;
  personality: string;
  greeting_prompts: string[];
}

export interface ArenaProviderLimits {
  dailyTokenBudget?: number;
  timeoutMs?: number;
}

export interface ArenaLLMConfig {
  _meta: string;
  _version: string;
  _updated: string;
  primary_provider: string;
  fallback_chain: string[];
  models: Record<string, ArenaModelConfig>;
  provider_timeouts_ms: Record<string, number>;
  rate_limits: Record<string, ArenaProviderLimits>;
  juno_persona: ArenaPersona;
  feature_flags: Record<string, boolean>;
}

const DEFAULT_CONFIG: ArenaLLMConfig = {
  _meta: "Arena LLM Stack — JunoTalk AI model routing config",
  _version: "1.0.0",
  _updated: new Date().toISOString().split("T")[0],
  primary_provider: "groq",
  fallback_chain: ["groq", "github-models", "deepseek", "openrouter", "gemini", "kimi", "openai", "offline"],
  models: {
    translation: {
      model: "qwen/qwen3-8b:free",
      provider: "openrouter",
      temperature: 0.1,
      max_tokens: 500,
    },
    translation_prompt: {
      model: "qwen/qwen3-8b:free",
      provider: "openrouter",
      temperature: 0.1,
      max_tokens: 1000,
    },
    chat: {
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      temperature: 0.75,
      max_tokens: 1200,
    },
    monitor: {
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      temperature: 0.2,
      max_tokens: 300,
    },
    knowledge: {
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      temperature: 0.3,
      max_tokens: 800,
    },
    general: {
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      temperature: 0.5,
      max_tokens: 500,
    },
  },
  provider_timeouts_ms: {
    groq:            10000,
    "github-models": 18000,
    openai:          20000,
    openrouter:      15000,
    gemini:          15000,
    claude:          25000,
    kimi:            15000,
    deepseek:        12000,
  },
  rate_limits: {
    groq:       { dailyTokenBudget: 500000 },
    openrouter: { dailyTokenBudget: 500000 },
    gemini:     { dailyTokenBudget: 100000 },
    claude:     { dailyTokenBudget: 30000 },
    kimi:       { dailyTokenBudget: 50000 },
    deepseek:   { dailyTokenBudget: 150000 },
  },
  juno_persona: {
    name: "Juno",
    voice: "nova",
    personality: "warm, intelligent, conversational",
    greeting_prompts: [
      "What would you like to translate today?",
      "What language are you working with?",
      "Do you want to speak or type?",
      "You can talk about anything — I'll translate it for you.",
      "Are you translating something for a trip or a conversation?",
      "Say anything in your language and I'll handle the rest.",
      "Need to break a language barrier? Let's go.",
    ],
  },
  feature_flags: {
    conversational_ai: true,
    knowledge_context: true,
    voice_translation: true,
    tts_enabled: true,
    streaming_responses: false,
    arena_routing: true,
    image_generation: true,
  },
};

/** Default model registry (models.json) — JunoTalk's full provider stack */
const DEFAULT_MODEL_REGISTRY: ArenaModelEntry[] = [
  // ── FREE providers: priority < 0 so they always win over paid ──────────────
  {
    id: "groq-llama33",
    name: "Llama 3.3 70B (Groq, Free Tier)",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    type: "chat",
    priority: -10, // first — fastest inference, free, key already configured
    weight: 200,
    cost: 0, quality: 9, speed: 10,
    timeoutMs: 10000,
  },
  {
    id: "github-models-gpt4o",
    name: "GPT-4o (GitHub Models, Free)",
    provider: "github-models",
    endpoint: "https://models.inference.ai.azure.com",
    model: "gpt-4o",
    type: "chat",
    priority: -8, // second — best quality free model (GPT-4o for free via GitHub)
    weight: 100,
    cost: 0, quality: 10, speed: 6,
    dailyTokenBudget: 150000,
    timeoutMs: 18000,
  },
  {
    id: "github-models-llama33",
    name: "Llama 3.3 70B (GitHub Models, Free)",
    provider: "github-models",
    endpoint: "https://models.inference.ai.azure.com",
    model: "Meta-Llama-3.3-70B-Instruct",
    type: "chat",
    priority: -7, // free — 8 models available
    weight: 160,
    cost: 0, quality: 9, speed: 7,
    dailyTokenBudget: 150000,
    timeoutMs: 18000,
  },
  {
    id: "deepseek-v3-chat",
    name: "DeepSeek V3 (GitHub Models, Free) — reasoning",
    provider: "deepseek",
    endpoint: "https://models.inference.ai.azure.com/chat/completions",
    model: "DeepSeek-V3",
    type: "chat",
    priority: -6, // excellent reasoning, free via GitHub token
    weight: 90,
    cost: 0, quality: 10, speed: 7,
    dailyTokenBudget: 150000,
    timeoutMs: 12000,
  },
  {
    id: "pollinations-free",
    name: "Pollinations.ai (No Key, 30+ Models)",
    provider: "pollinations",
    endpoint: "https://text.pollinations.ai/openai",
    model: "openai",
    type: "chat",
    priority: -5, // keyless fallback — reliable but quality varies
    weight: 150,
    cost: 0, quality: 8, speed: 7,
    timeoutMs: 15000,
  },
  {
    id: "github-models-llama405b",
    name: "Llama 3.1 405B (GitHub Models, Free)",
    provider: "github-models",
    endpoint: "https://models.inference.ai.azure.com",
    model: "Meta-Llama-3.1-405B-Instruct",
    type: "chat",
    priority: -4,
    weight: 40,
    cost: 0, quality: 8, speed: 3,
    dailyTokenBudget: 150000,
    timeoutMs: 20000,
  },
  // ── PAID providers: priority ≥ 10 — only reached if ALL free fail ──────────
  {
    id: "openai-gpt4o-mini",
    name: "GPT-4o Mini (Replit Proxy)",
    provider: "openai",
    endpoint: "http://localhost:1106/modelfarm/openai",
    model: "gpt-4o-mini",
    type: "chat",
    priority: 10, // paid — last resort only
    weight: 120,
    cost: 2, quality: 9, speed: 9,
    dailyTokenBudget: 100000,
    timeoutMs: 20000,
  },
  // ── FREE translation providers ─────────────────────────────────────────────
  {
    id: "libretranslate",
    name: "LibreTranslate (local/public)",
    provider: "libretranslate",
    endpoint: "",
    type: "translation",
    priority: -10, // first for translation — no cost, works offline
    weight: 100,
    cost: 0, quality: 5, speed: 10,
    timeoutMs: 8000,
  },
  {
    id: "openrouter-qwen3-8b",
    name: "Qwen3 8B Free (OpenRouter)",
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen3-8b:free",
    type: "translation",
    priority: -4,
    weight: 90,
    cost: 0, quality: 8, speed: 9,
    dailyTokenBudget: 500000,
    timeoutMs: 30000,
  },
  {
    id: "openrouter-qwen3-30b",
    name: "Qwen3 30B A3B Free (OpenRouter)",
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen3-30b-a3b:free",
    type: "chat",
    priority: -3,
    weight: 85,
    cost: 0, quality: 9, speed: 8,
    dailyTokenBudget: 500000,
    timeoutMs: 45000,
  },
  {
    id: "openrouter-gemma-12b",
    name: "Gemma 3 12B Free (OpenRouter)",
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemma-3-12b-it:free",
    type: "translation",
    priority: -3,
    weight: 60,
    cost: 0, quality: 7, speed: 8,
    dailyTokenBudget: 500000,
    timeoutMs: 45000,
  },
  {
    id: "openrouter-gemma-27b",
    name: "Gemma 3 27B Free (OpenRouter)",
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemma-3-27b-it:free",
    type: "chat",
    priority: -2,
    weight: 55,
    cost: 0, quality: 9, speed: 7,
    dailyTokenBudget: 500000,
    timeoutMs: 45000,
  },
  // ── PAID providers: priority ≥ 10 — only reached if ALL free fail ──────────
  {
    id: "gemini-flash",
    name: "Gemini Flash",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    type: "translation",
    priority: 11,
    weight: 30,
    cost: 2, quality: 7, speed: 8,
    dailyTokenBudget: 100000,
    timeoutMs: 10000,
  },
  {
    id: "kimi-chat",
    name: "Kimi Chat",
    provider: "kimi",
    endpoint: "https://api.moonshot.cn/v1",
    type: "chat",
    priority: 12,
    weight: 20,
    cost: 3, quality: 7, speed: 7,
    dailyTokenBudget: 50000,
    timeoutMs: 10000,
  },
  {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    type: "chat",
    priority: 15,
    weight: 5,
    cost: 4, quality: 8, speed: 8,
    dailyTokenBudget: 20000,
    timeoutMs: 25000,
  },
  {
    id: "fallback-basic",
    name: "Offline Fallback",
    provider: "offline",
    endpoint: "",
    type: "fallback",
    priority: 99,
    weight: 0,
    cost: 0, quality: 2, speed: 10,
  },
];

let _config: ArenaLLMConfig = { ...DEFAULT_CONFIG };
let _modelRegistry: ArenaModelEntry[] = [...DEFAULT_MODEL_REGISTRY];
let _loadedAt = 0;
let _modelsLoadedAt = 0;
let _loading: Promise<void> | null = null;
let _bootstrapped = false;

async function loadModelsFromArena(): Promise<void> {
  try {
    const data = await fetchFromRepo(ARENA_OWNER, ARENA_REPO, MODELS_PATH, ARENA_BRANCH);
    if (data && Array.isArray((data as any).models) && (data as any).models.length > 0) {
      const cdnModels = (data as any).models as ArenaModelEntry[];
      // Merge: local DEFAULT_MODEL_REGISTRY entries take precedence; CDN fills the rest
      const localIds = new Set(DEFAULT_MODEL_REGISTRY.map(m => m.id));
      const mergedExtras = cdnModels.filter(m => !localIds.has(m.id));
      _modelRegistry = [...DEFAULT_MODEL_REGISTRY, ...mergedExtras];
      _modelsLoadedAt = Date.now();
      console.log(`[ArenaLLM] Model registry loaded — ${_modelRegistry.length} models: ${_modelRegistry.map((m) => m.id).join(", ")}`);
    } else {
      console.log("[ArenaLLM] models.json not found — bootstrapping model registry...");
      const ok = await pushToRepo(
        ARENA_OWNER, ARENA_REPO, MODELS_PATH,
        { models: DEFAULT_MODEL_REGISTRY },
        "[ArenaLLM] Bootstrap initial model registry",
        ARENA_BRANCH,
      );
      if (ok) console.log("[ArenaLLM] models.json bootstrapped successfully.");
    }
  } catch (err: any) {
    console.warn(`[ArenaLLM] models.json unreachable: ${err.message} — using defaults`);
  }
}

async function loadFromArena(): Promise<void> {
  try {
    const [stackData] = await Promise.allSettled([
      fetchFromRepo(ARENA_OWNER, ARENA_REPO, CONFIG_PATH, ARENA_BRANCH),
      loadModelsFromArena(),
    ]);
    const data = stackData.status === "fulfilled" ? stackData.value : null;
    if (data && typeof data === "object" && (data as any).models) {
      const cdnData = data as any;
      // Deep-merge: local defaults always win for provider routing and model selection
      // to prevent stale CDN config from reinstating failing providers (e.g. openrouter).
      // CDN may still supply feature_flags, persona, rate_limits, and version metadata.
      _config = {
        ...DEFAULT_CONFIG,
        ...cdnData,
        // Core routing — local always wins
        primary_provider: DEFAULT_CONFIG.primary_provider,
        fallback_chain:   DEFAULT_CONFIG.fallback_chain,
        models:           DEFAULT_CONFIG.models,
        provider_timeouts_ms: {
          ...cdnData.provider_timeouts_ms,
          ...DEFAULT_CONFIG.provider_timeouts_ms,
        },
      };
      _loadedAt = Date.now();
      console.log(`[ArenaLLM] Config loaded from CDN — v${_config._version} (${_config._updated}), provider: ${_config.primary_provider}, models: ${Object.keys(_config.models).join(", ")}`);
    } else if (!_bootstrapped) {
      await bootstrapArenaRepo();
    }
  } catch (err: any) {
    console.warn(`[ArenaLLM] CDN unreachable: ${err.message} — using defaults`);
  }
}

async function bootstrapArenaRepo(): Promise<void> {
  console.log("[ArenaLLM] Bootstrapping initial config to Arena repo...");
  const [stackOk, modelsOk] = await Promise.all([
    pushToRepo(
      ARENA_OWNER,
      ARENA_REPO,
      CONFIG_PATH,
      DEFAULT_CONFIG,
      "[ArenaLLM] Bootstrap initial LLM stack config",
      ARENA_BRANCH,
    ),
    pushToRepo(
      ARENA_OWNER,
      ARENA_REPO,
      MODELS_PATH,
      { models: DEFAULT_MODEL_REGISTRY },
      "[ArenaLLM] Bootstrap initial model registry",
      ARENA_BRANCH,
    ),
  ]);
  if (stackOk) {
    _bootstrapped = true;
    _loadedAt = Date.now();
    console.log(`[ArenaLLM] Bootstrap pushed to Arena repo — llm-stack: ${stackOk}, models: ${modelsOk}`);
  } else {
    console.warn("[ArenaLLM] Bootstrap push failed — check GitHub connector permissions.");
  }
}

async function ensureLoaded(): Promise<void> {
  if (_loadedAt && Date.now() - _loadedAt < TTL_MS) return;
  if (_loading) return _loading;
  _loading = loadFromArena().finally(() => { _loading = null; });
  return _loading;
}

/** Initialize on startup — non-blocking */
export function initArenaLLM(): void {
  ensureLoaded().catch(() => {});
  setInterval(() => ensureLoaded().catch(() => {}), TTL_MS);
}

/** Get the full resolved config */
export function getArenaConfig(): ArenaLLMConfig {
  return _config;
}

/** Get model config for a specific task */
export function getArenaModel(task: string): ArenaModelConfig {
  return _config.models[task] || _config.models.general || DEFAULT_CONFIG.models.general;
}

/** Get Juno persona settings */
export function getArenaPersona(): ArenaPersona {
  return _config.juno_persona;
}

/** Check a feature flag */
export function getArenaFlag(flag: string): boolean {
  return _config.feature_flags[flag] ?? true;
}

/** Get provider timeout in ms */
export function getArenaTimeout(provider: string): number {
  return _config.provider_timeouts_ms[provider] ?? 30000;
}

/** Get daily token budget for a provider */
export function getArenaTokenBudget(provider: string): number | undefined {
  return _config.rate_limits[provider]?.dailyTokenBudget;
}

/** Get the full model registry loaded from models.json */
export function getArenaModelRegistry(): ArenaModelEntry[] {
  return _modelRegistry;
}

/**
 * Get models sorted by priority for a given task type.
 * task: "chat" | "translation" | "monitor" | "fallback" | "general"
 */
export function getBestModelsForTask(task: string): ArenaModelEntry[] {
  return _modelRegistry
    .filter((m) => m.type === task || m.type === "chat")
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Cost-aware model scoring: score = (10 - cost) * 0.6 + quality * 0.4
 * Always picks the cheapest model that can handle the task well.
 * No randomness — deterministic, fully controlled by GitHub config.
 */
function scoredModel(m: ArenaModelEntry): number {
  const c = m.cost   ?? 5;
  const q = m.quality ?? 5;
  return (10 - c) * 0.6 + q * 0.4;
}

/**
 * Pick ONE model for a task using cost-aware intelligent scoring.
 * Lowest-cost, highest-quality model always wins.
 * Expensive models (Claude, etc.) only appear as fallbacks.
 */
export function pickWeightedModel(task: string): ArenaModelEntry | null {
  const candidates = _modelRegistry.filter(
    (m) => m.provider !== "offline" && (m.type === task || m.type === "chat")
  );
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const scoreDiff = scoredModel(b) - scoredModel(a);
    // Break score ties using priority — lower number = higher priority
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return a.priority - b.priority;
  })[0];
}

/** Get all models for a task sorted by cost-aware score (best first) */
export function rankModelsForTask(task: string): Array<ArenaModelEntry & { score: number }> {
  return _modelRegistry
    .filter((m) => m.provider !== "offline" && (m.type === task || m.type === "chat"))
    .map((m) => ({ ...m, score: Math.round(scoredModel(m) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Convert the model registry into gateway-compatible ProviderRouteConfig[].
 * Called by ai-gateway.ts to replace hardcoded routing with Arena CDN config.
 */
export function getArenaRoutingConfig(): ArenaRouteConfig[] {
  const providerMap = new Map<string, ArenaRouteConfig>();

  for (const entry of _modelRegistry) {
    if (entry.provider === "offline" || entry.provider === "fallback") continue;

    const existing = providerMap.get(entry.provider);
    const tasks = mapTypeToTasks(entry.type);

    if (existing) {
      for (const t of tasks) {
        if (!existing.tasks.includes(t)) existing.tasks.push(t);
      }
      if (entry.priority < existing.priority) existing.priority = entry.priority;
    } else {
      providerMap.set(entry.provider, {
        provider: entry.provider,
        priority: entry.priority,
        timeoutMs: entry.timeoutMs ?? _config.provider_timeouts_ms[entry.provider] ?? 30000,
        maxRetries: 1,
        tasks,
        dailyTokenBudget: entry.dailyTokenBudget ?? _config.rate_limits[entry.provider]?.dailyTokenBudget,
      });
    }
  }

  return [...providerMap.values()].sort((a, b) => a.priority - b.priority);
}

function mapTypeToTasks(type: string): string[] {
  switch (type) {
    case "translation": return ["translation", "translation_prompt"];
    case "chat":        return ["chat", "translation_prompt", "monitor", "general"];
    case "monitor":     return ["monitor"];
    case "fallback":    return ["translation", "chat", "monitor", "general"];
    case "background":  return ["background"];
    default:            return ["chat", "general"];
  }
}

/** Push updated config back to the Arena repo (admin use) */
export async function pushArenaConfig(updated: Partial<ArenaLLMConfig>, commitMessage?: string): Promise<boolean> {
  const merged: ArenaLLMConfig = {
    ..._config,
    ...updated,
    _updated: new Date().toISOString().split("T")[0],
  };
  const ok = await pushToRepo(
    ARENA_OWNER,
    ARENA_REPO,
    CONFIG_PATH,
    merged,
    commitMessage ?? `[ArenaLLM] Update config — ${merged._updated}`,
    ARENA_BRANCH,
  );
  if (ok) _config = merged;
  return ok;
}

