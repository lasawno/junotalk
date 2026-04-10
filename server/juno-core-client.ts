/**
 * Juno Intelligence Core — Full Client
 *
 * Drop this file into your JunoTalk `server/` folder.
 *
 * Required env vars on JunoTalk:
 *   JUNO_CORE_URL=https://junointelligencecore.replit.app
 *   JUNO_CORE_API_KEY=<your API key from Intelligence Core>
 *
 * Two-way connection:
 *   1. JunoTalk connects and reports what it's running (modules, engines, providers)
 *   2. Intelligence Core returns enrichment data (personality, knowledge, models)
 *
 * Usage in JunoTalk startup:
 *   import { connectToCore, startHeartbeat, fetchEnrichment } from './juno-core-client';
 *   await connectToCore();
 *   startHeartbeat();
 */

const CORE_URL = () => process.env.JUNO_CORE_URL?.replace(/\/+$/, "") || "";
const API_KEY = () => process.env.JUNO_CORE_API_KEY || "";
const APP_URL = process.env.APP_URL || "https://junotalk.app";
const TIMEOUT_MS = 8000;

function authHeaders(): Record<string, string> {
  const key = API_KEY();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

async function coreFetch<T>(path: string): Promise<T | null> {
  const base = CORE_URL();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${base}/api${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function corePost<T>(path: string, body: unknown): Promise<T | null> {
  const base = CORE_URL();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${base}/api${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(`[JunoCore] POST ${path} failed: ${resp.status} ${resp.statusText}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    console.error(`[JunoCore] POST ${path} error:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isCoreConfigured(): boolean {
  return !!CORE_URL();
}

// ── Connection & Heartbeat ──

export async function connectToCore(options?: {
  version?: string;
  activeModules?: string[];
  activeEngines?: Record<string, boolean>;
  voiceAi?: Record<string, unknown>;
  llmProviders?: string[];
  featureFlags?: Record<string, boolean>;
}): Promise<void> {
  const result = await corePost<{ status: string; availableEndpoints?: Record<string, string> }>("/junotalk/connect", {
    appUrl: APP_URL,
    version: options?.version || process.env.APP_VERSION || "3.2.0",
    activeModules: options?.activeModules || [
      "reasoning-engine",
      "personality-engine",
      "intelligence-layer",
      "ai-gateway",
      "voice-ai",
      "translation",
      "juno-agent-t1",
    ],
    activeEngines: options?.activeEngines || {
      reasoning: true,
      personality: true,
      intelligenceLayer: true,
      voiceAi: true,
    },
    voiceAi: options?.voiceAi || { whisper: true, edgeTts: true, piperTts: true },
    llmProviders: options?.llmProviders || ["groq", "openai", "gemini"],
    featureFlags: options?.featureFlags || {
      conversational_ai: true,
      voice_translation: true,
      tts_enabled: true,
    },
  });

  if (result) {
    console.log(`[JunoCore] Connected: ${result.status}`);
    if (result.availableEndpoints) {
      console.log(`[JunoCore] Endpoints: ${Object.keys(result.availableEndpoints).join(", ")}`);
    }
  }
}

export async function sendHeartbeat(stats?: Record<string, unknown>): Promise<void> {
  await corePost("/junotalk/heartbeat", { stats: stats || {} });
}

export async function syncState(update: {
  activeModules?: string[];
  activeEngines?: Record<string, boolean>;
  voiceAi?: Record<string, unknown>;
  llmProviders?: string[];
  featureFlags?: Record<string, boolean>;
  stats?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}): Promise<void> {
  await corePost("/junotalk/sync", update);
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(intervalMs = 120_000): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => sendHeartbeat(), intervalMs);
  console.log(`[JunoCore] Heartbeat started (every ${intervalMs / 1000}s)`);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ── Data Fetch (read-only, no auth required) ──

export async function fetchEnrichment(
  message: string,
  conversationHistory?: Array<{ role: string; content: string }>,
  task?: string,
): Promise<Record<string, unknown> | null> {
  return corePost<Record<string, unknown>>("/reasoning/enrich", {
    message,
    conversation_history: conversationHistory || [],
    task: task || "chat",
  });
}

export async function fetchConfig<T = unknown>(name: string): Promise<T | null> {
  return coreFetch<T>(`/config/${name}`);
}

export async function fetchModelStack<T = unknown>(): Promise<T | null> {
  return coreFetch<T>("/models/stack");
}

export async function fetchModelRegistry<T = unknown>(): Promise<T | null> {
  return coreFetch<T>("/models/registry");
}

export async function fetchModelSelect<T = unknown>(task: string): Promise<T | null> {
  return coreFetch<T>(`/models/select?task=${encodeURIComponent(task)}`);
}

export async function fetchKnowledgeCollection<T = unknown>(collection: string): Promise<T | null> {
  return coreFetch<T>(`/knowledge/${collection}`);
}

export async function fetchKnowledgeQuery<T = unknown>(query: string): Promise<T | null> {
  return coreFetch<T>(`/knowledge/query?q=${encodeURIComponent(query)}`);
}

export async function fetchKnowledgeBrain<T = unknown>(): Promise<T | null> {
  return coreFetch<T>("/knowledge/brain");
}

export async function fetchKnowledgeVector<T = unknown>(): Promise<T | null> {
  return coreFetch<T>("/knowledge/vector");
}

export async function fetchKnowledgeSummary(): Promise<Record<string, number> | null> {
  const resp = await coreFetch<{ collections: Record<string, number> }>("/knowledge");
  return resp?.collections ?? null;
}
