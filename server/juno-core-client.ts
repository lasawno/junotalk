/**
 * Juno Intelligence Core — HTTP Client
 *
 * Drop this file into your JunoTalk `server/` folder.
 * Set the JUNO_CORE_URL env var to the published Intelligence Core URL.
 *
 * Provides typed fetch helpers for all Intelligence Core endpoints,
 * used by the patched versions of github-config.ts, knowledge-sync.ts,
 * and arena-llm.ts.
 */

const CORE_URL = () => process.env.JUNO_CORE_URL?.replace(/\/+$/, "") || "";
const TIMEOUT_MS = 8000;

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

export function isCoreConfigured(): boolean {
  return !!CORE_URL();
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
