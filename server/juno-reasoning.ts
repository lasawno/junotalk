/**
 * Juno Reasoning Engine — Intelligence Core Integration
 *
 * Drop this file into your JunoTalk `server/` folder.
 * Import `prepareReasoningPrompt` in your chat handler
 * to get ChatGPT-like reasoning from the Intelligence Core.
 *
 * How it works:
 * 1. Your chat handler receives a user message
 * 2. Call prepareReasoningPrompt(message, history)
 * 3. It returns ready-to-use messages array + model config
 * 4. Send that to your LLM provider (Groq, OpenAI, etc.)
 * 5. Return the response to the user
 *
 * The Intelligence Core builds a full system prompt with:
 * - Juno's personality and tone
 * - Reasoning engine (step-by-step thinking, decomposition)
 * - Intelligence layer (cognitive load, ambiguity, urgency detection)
 * - Grounded knowledge from 4 sources (vector, neo4j, wikidata, osint)
 * - Conversation awareness (engagement tracking)
 */

const CORE_URL = () => process.env.JUNO_CORE_URL?.replace(/\/+$/, "") || "";
const TIMEOUT_MS = 10000;

interface ReasoningMessage {
  role: string;
  content: string;
}

interface ReasoningModel {
  id: string;
  provider: string;
  temperature: number;
  max_tokens: number;
  endpoint?: string;
}

interface ReasoningResponse {
  messages: ReasoningMessage[];
  model: ReasoningModel;
  fallback_chain: string[];
  feature_flags: Record<string, boolean>;
  detected_intents: string[];
  personality_profile: string;
  knowledge_layers: Array<{ layer: string; confidence: number }>;
}

export async function prepareReasoningPrompt(
  message: string,
  conversationHistory?: Array<{ role: string; content: string }>,
  task?: string,
): Promise<ReasoningResponse | null> {
  const base = CORE_URL();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${base}/api/reasoning/prepare`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message,
        conversation_history: conversationHistory,
        task: task || "chat",
      }),
    });

    if (!resp.ok) return null;
    return (await resp.json()) as ReasoningResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getReasoningCapabilities(): Promise<Record<string, unknown> | null> {
  const base = CORE_URL();
  if (!base) return null;

  try {
    const resp = await fetch(`${base}/api/reasoning/capabilities`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * EXAMPLE USAGE IN YOUR CHAT HANDLER:
 *
 * import { prepareReasoningPrompt } from './juno-reasoning';
 * import Groq from 'groq-sdk';
 *
 * const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
 *
 * async function handleChat(userMessage: string, history: Array<{role: string, content: string}>) {
 *   // 1. Get reasoning prompt from Intelligence Core
 *   const reasoning = await prepareReasoningPrompt(userMessage, history);
 *
 *   if (reasoning) {
 *     // 2. Send to LLM with full reasoning context
 *     const completion = await groq.chat.completions.create({
 *       model: reasoning.model.id,
 *       messages: reasoning.messages as any,
 *       temperature: reasoning.model.temperature,
 *       max_tokens: reasoning.model.max_tokens,
 *     });
 *
 *     return completion.choices[0]?.message?.content;
 *   }
 *
 *   // Fallback: basic completion without reasoning
 *   const completion = await groq.chat.completions.create({
 *     model: 'llama-3.3-70b-versatile',
 *     messages: [{ role: 'user', content: userMessage }],
 *   });
 *
 *   return completion.choices[0]?.message?.content;
 * }
 */
