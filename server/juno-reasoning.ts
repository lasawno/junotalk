/**
   * Juno Intelligence Core — Data Enrichment Client
   *
   * Drop this file into your JunoTalk server/ folder.
   * Import fetchEnrichment in your chat handler to get
   * knowledge, personality, and model data from the Intelligence Core.
   *
   * Intelligence Core is the DATA layer. JunoTalk's own engines
   * (reasoning-engine.ts, personality-engine.ts, juno-intelligence-layer.ts)
   * do the actual reasoning using this data. No logic is duplicated.
   *
   * Usage:
   *   import { fetchEnrichment } from "./juno-reasoning";
   *
   *   const data = await fetchEnrichment(userMessage, history);
   *   if (data) {
   *     // Use data.knowledge, data.personality, data.model, etc.
   *     // Feed into your own reasoning engine
   *   }
   */

  const CORE_URL = () => process.env.JUNO_CORE_URL?.replace(/\/+$/, "") || "";
  const TIMEOUT_MS = 10000;

  export interface EnrichmentKnowledgeResult {
    title: string;
    content: string;
  }

  export interface EnrichmentKnowledgeLayer {
    layer: string;
    confidence: number;
    results: EnrichmentKnowledgeResult[];
  }

  export interface EnrichmentModel {
    id: string;
    provider: string;
    temperature: number;
    max_tokens: number;
    endpoint?: string;
  }

  export interface EnrichmentResponse {
    personality: Record<string, unknown>;
    reasoning: Record<string, unknown>;
    intelligence_layer: Record<string, unknown>;
    persona: { name: string; voice: string; personality: string };
    knowledge: {
      query: string;
      context: EnrichmentKnowledgeLayer[];
      ranked_layers: Array<{ layer: string; confidence: number }>;
    };
    model: EnrichmentModel;
    fallback_chain: string[];
    feature_flags: Record<string, boolean>;
  }

  export async function fetchEnrichment(
    message: string,
    conversationHistory?: Array<{ role: string; content: string }>,
    task?: string,
  ): Promise<EnrichmentResponse | null> {
    const base = CORE_URL();
    if (!base) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(`${base}/api/reasoning/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          message,
          conversation_history: conversationHistory,
          task: task || "chat",
        }),
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      return (await resp.json()) as EnrichmentResponse;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  export function isCoreConfigured(): boolean {
    return !!CORE_URL();
  }
  