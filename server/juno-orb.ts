/**
 * PROPRIETARY AND CONFIDENTIAL
 * JunoTalk V1 — The Orb Conversational Reasoning Engine
 * Copyright (c) 2024-2026 JunoTalk. All rights reserved.
 *
 * The Orb is the conversational AI layer that users interact with directly.
 * Users always see "Hi, I'm Juno." — versioning is backend-only.
 *
 * ─── ARCHITECTURE ────────────────────────────────────────────────────────────
 *
 *  WHAT MAKES V1 DIFFERENT FROM THE OLD SINGLE-TURN HANDLER
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Multi-turn memory  — conversation history per user (20 msg cap)    │
 *  │  Recall wired in    — intent, cultural notes, idioms feed every turn │
 *  │  Vault personality  — personality.md + greeting-rules.md at startup  │
 *  │  GitHub CDN         — live phrase + pattern data from CDN            │
 *  │  Provider chain     — Knowledge → Kimi → Claude with fallover        │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  SESSION MEMORY
 *  • Keyed by userId — each user has their own conversation thread
 *  • Max 20 messages per session (10 full exchanges)
 *  • Sessions expire after 2 hours of inactivity
 *  • Memory is in-process (server restart clears it — V2 will persist)
 *
 *  RECALL PIPELINE (runs every turn)
 *  1. Intent detection  — what does the user actually want?
 *  2. Cultural context  — which cultural norms apply?
 *  3. Idiom detection   — is there a non-literal expression?
 *  4. GitHub CDN data   — live reference phrases loaded hourly
 *
 *  PROVIDER CHAIN (short-circuits on first success)
 *  L0   Knowledge base   — static Q&A with confidence threshold (≥ 0.6)
 *  L0.5 Lite model       — CDN-configured Gemma 3 1B via OpenRouter (default 25% of requests)
 *  L1   Gemma 4 (27B)    — primary AI responder via Gemini API free tier (open-source)
 *  L2   Kimi / Moonshot  — fallback if Gemma 4 unavailable
 *  L3   Claude Haiku     — fallback if Kimi fails or is throttled
 *  L4   Offline responder — zero-network pattern-based handler for basic prompts
 *  L5   Hardcoded reply  — last-resort graceful degradation
 *
 *  UPGRADE PATH
 *  V1 → V2: Add persistent session storage (Redis/DB)
 *  V2 → V3: Swap model to reasoning-class (Claude Sonnet / GPT-4o)
 *  V3 → V4: Add tool use (search, translate on demand, lookup)
 *  All upgrades happen here — zero changes to the routes or frontend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Unauthorized copying, distribution, or reverse engineering is strictly prohibited.
 * Protected under applicable intellectual property laws.
 */

import { readFile } from "fs/promises";
import path from "path";
import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import { apiKeys } from "./api-keys";
import { answerQuestion } from "./juno-knowledge";
import { getRecallStats } from "./agent-recall";
import { orchestrateRecall } from "./recall-orchestrator";
import {
  checkContent,
  buildSafetySystemPrompt,
  getSafetyStats,
  checkInformationBoundary,
  buildBoundarySystemPrompt,
} from "./juno-safety";
import { getLiteModelConfig } from "./github-config";
import { offlineRespond, offlineFallback } from "./juno-offline";

const ORB_VERSION = "JunoTalk V1";
const SESSION_MAX_MESSAGES = 20;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const VAULT_DIR = path.resolve(process.cwd(), "vault");
const VAULT_CACHE_TTL = 60 * 60 * 1000;

export interface OrbMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface OrbSession {
  userId: string;
  messages: OrbMessage[];
  lastActivity: number;
  turnCount: number;
}

export interface OrbResponse {
  reply: string;
  version: string;
  provider: string;
  sessionTurns: number;
  recallSource: string;
  fromKnowledge: boolean;
}

export interface OrbStats {
  version: string;
  activeSessions: number;
  totalTurnsServed: number;
  vaultLoaded: boolean;
  recallStats: ReturnType<typeof getRecallStats>;
}

export interface OrbDeps {
  moonshotClient: OpenAI;
  anthropic: Anthropic;
  shouldThrottleProvider: (provider: string) => boolean;
  trackTokenUsage: (provider: string, input: number, output: number, feature: string) => void;
}

const sessionStore = new Map<string, OrbSession>();

function getOpenRouterClient(): OpenAI | null {
  const apiKey = apiKeys.openrouter();
  const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL });
}

let vaultPersonality = "";
let vaultGreetingRules = "";
let vaultProgrammatic = "";
let vaultCacheTime = 0;
let totalTurnsServed = 0;

async function loadVaultDocs(): Promise<void> {
  if (Date.now() - vaultCacheTime < VAULT_CACHE_TTL) return;
  try {
    const [personality, greetings, programmatic] = await Promise.allSettled([
      readFile(path.join(VAULT_DIR, "juno/personality.md"), "utf-8"),
      readFile(path.join(VAULT_DIR, "juno/greeting-rules.md"), "utf-8"),
      readFile(path.join(VAULT_DIR, "juno/junotalk-programmatic.md"), "utf-8"),
    ]);
    if (personality.status === "fulfilled") vaultPersonality = personality.value;
    if (greetings.status === "fulfilled") vaultGreetingRules = greetings.value;
    if (programmatic.status === "fulfilled") vaultProgrammatic = programmatic.value;
    vaultCacheTime = Date.now();
    console.log(`[${ORB_VERSION}] Vault docs loaded (personality: ${vaultPersonality.length}c, greetings: ${vaultGreetingRules.length}c, programmatic: ${vaultProgrammatic.length}c)`);
  } catch (err: any) {
    console.warn(`[${ORB_VERSION}] Vault load failed (using defaults):`, err.message);
  }
}

function getSession(userId: string): OrbSession {
  const existing = sessionStore.get(userId);
  if (existing && Date.now() - existing.lastActivity < SESSION_TTL_MS) {
    return existing;
  }
  const fresh: OrbSession = { userId, messages: [], lastActivity: Date.now(), turnCount: 0 };
  sessionStore.set(userId, fresh);
  return fresh;
}

function appendToSession(session: OrbSession, role: "user" | "assistant", content: string): void {
  session.messages.push({ role, content, timestamp: Date.now() });
  session.lastActivity = Date.now();

  if (session.messages.length > SESSION_MAX_MESSAGES) {
    session.messages = session.messages.slice(session.messages.length - SESSION_MAX_MESSAGES);
  }
}

function buildSystemPrompt(recallContext: string): string {
  const programmaticSection = vaultProgrammatic
    ? `JUNOTALK BEHAVIORAL SPECIFICATION\n${vaultProgrammatic}`
    : "";

  const personalitySection = `WHO YOU ARE
You are Juno — JunoTalk's AI companion. You speak to users the way a knowledgeable, warm friend would: naturally, directly, and with genuine interest in what they're saying. You are not a support ticket system. You are a conversational AI.

Your voice:
- Warm and natural — never robotic, never overly formal
- Engaged — you follow the thread of the conversation and respond to what was actually said
- Honest — if you don't know something, you say so simply and helpfully
- Adaptive — you match the user's energy: casual when they're casual, clear when they need clarity
- You never pretend to be human, but you don't remind people of that either
${vaultPersonality ? `\nAdditional personality context:\n${vaultPersonality}` : ""}`;

  const conversationStyle = `HOW YOU SPEAK
Respond the way a thoughtful person would in a real conversation — not a FAQ page.
- If someone asks a simple question, give a clean direct answer. No need to pad it.
- If someone is frustrated, acknowledge that first before jumping to solutions.
- If the conversation has history, reference it naturally when it's relevant — the way any person would.
- Ask a follow-up question when it would genuinely help clarify what they need.
- Let your response be as long as it naturally needs to be — not artificially short, not padded out.
- Never use unnecessary filler phrases like "Great question!" or "Certainly!" — just respond.
${vaultGreetingRules ? `\nGreeting guidance:\n${vaultGreetingRules}` : ""}`;

  const platformSection = `WHAT YOU KNOW ABOUT JUNOTALK
JunoTalk is an encrypted communication platform built around AI-powered real-time translation.
- Encrypted text messaging and chat rooms
- AI voice translation — tap to speak, Juno translates and speaks back in the target language
- Video calling with real-time translated captions
- "Hey Juno" wake word for hands-free voice translation
- Multiple AI voices to choose from in Settings
- Full privacy — messages are end-to-end encrypted, no audio or video stored, data deletable from Settings

Common things users run into:
- Microphone not working → check browser permissions, speak clearly into mic
- Translation off → change voice or target language in Settings > Languages
- Can't hear response → check volume, ensure Auto-play is on in Settings > Appearance
- Hey Juno not responding → enable wake word in Settings > Appearance, allow mic access
- Sign-in issues → use Sign In button, requires a connected account

Never mention internal service names, technical providers, or implementation details.
If asked what AI powers Juno, say: "We use advanced AI built specifically for real-time communication."
Never invent features. If something doesn't exist, say so honestly.`;

  const recallSection = recallContext
    ? `CONVERSATION SIGNALS & RECALL\n${recallContext}`
    : "";

  const safetySection = buildSafetySystemPrompt();
  const boundarySection = buildBoundarySystemPrompt();

  return [programmaticSection, safetySection, boundarySection, personalitySection, conversationStyle, platformSection, recallSection]
    .filter(Boolean)
    .join("\n\n");
}

// AI output filter (#2) — screen AI replies before delivering to user
const SYSTEM_PROMPT_LEAK_MARKERS = [
  "WHO YOU ARE",
  "HOW YOU SPEAK",
  "WHAT YOU KNOW ABOUT JUNOTALK",
  "INFORMATION BOUNDARIES",
  "JUNOTALK BEHAVIORAL SPECIFICATION",
  "CONVERSATION SIGNALS",
  "REASONING FRAMEWORK",
  "OUTPUT RULE",
  "STEP 1 — INTENT",
  "STEP 2 — REGISTER",
  "STEP 3 — CULTURAL",
  "STEP 4 — LANGUAGE PAIR",
  "You are Juno — JunoTalk's AI companion",
  "buildBoundarySystemPrompt",
  "checkInformationBoundary",
];

function filterOrbOutput(reply: string): string {
  if (!reply) return reply;

  const upper = reply.toUpperCase();
  for (const marker of SYSTEM_PROMPT_LEAK_MARKERS) {
    if (upper.includes(marker.toUpperCase())) {
      console.warn(`[${ORB_VERSION}] Output filter caught system prompt leak marker: "${marker}"`);
      return "I'm not able to share that. Is there something I can help you with?";
    }
  }

  const check = checkContent(reply, true);
  if (!check.safe) {
    console.warn(`[${ORB_VERSION}] Output filter caught violation (${check.category}) in AI reply`);
    return "I'm not able to share that response. Please try asking something else.";
  }
  return reply;
}

function buildMessageHistory(session: OrbSession, currentMessage: string): Array<{ role: "user" | "assistant"; content: string }> {
  const history = session.messages.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: currentMessage });
  return history;
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [userId, session] of sessionStore.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessionStore.delete(userId);
    }
  }
}

export async function askOrb(
  userId: string,
  message: string,
  deps: OrbDeps
): Promise<OrbResponse> {
  await loadVaultDocs();
  pruneExpiredSessions();

  const session = getSession(userId);
  session.turnCount++;
  totalTurnsServed++;

  // ── Behavioral alignment pre-check ───────────────────────────────────────
  const safety = checkContent(message);
  if (!safety.safe && safety.response) {
    console.log(`[${ORB_VERSION}] Safety gate triggered (${safety.category}/${safety.severity}) for user ${userId}`);
    appendToSession(session, "user", message);
    appendToSession(session, "assistant", safety.response);
    return {
      reply: safety.response,
      version: ORB_VERSION,
      provider: "safety",
      sessionTurns: session.turnCount,
      recallSource: "safety-gate",
      fromKnowledge: false,
    };
  }

  // ── Information boundary pre-check ───────────────────────────────────────
  const boundary = checkInformationBoundary(message);
  if (!boundary.inBounds && boundary.response) {
    console.log(`[${ORB_VERSION}] Boundary gate triggered (${boundary.category}) for user ${userId}`);
    appendToSession(session, "user", message);
    appendToSession(session, "assistant", boundary.response);
    return {
      reply: boundary.response,
      version: ORB_VERSION,
      provider: "boundary",
      sessionTurns: session.turnCount,
      recallSource: "boundary-gate",
      fromKnowledge: false,
    };
  }

  // High-confidence factual knowledge — early return bypasses AI entirely
  const knowledgeResult = answerQuestion(message);
  if (knowledgeResult && knowledgeResult.confidence >= 0.6) {
    const reply = knowledgeResult.answer;
    appendToSession(session, "user", message);
    appendToSession(session, "assistant", reply);
    console.log(`[${ORB_VERSION}] Knowledge hit (${knowledgeResult.category}, ${knowledgeResult.confidence.toFixed(2)}) for user ${userId}`);
    return {
      reply,
      version: ORB_VERSION,
      provider: "knowledge",
      sessionTurns: session.turnCount,
      recallSource: "juno-knowledge",
      fromKnowledge: true,
    };
  }

  // Orchestrated recall — System 1 (behavior) + System 2 (semantic memory)
  // + System 3 (factual knowledge) + System 4 (keyword context) in parallel
  const orchestrated = await orchestrateRecall(
    { text: message, sourceLang: "en", targetLang: "en", userId },
    "juno",
  );

  const systemPrompt = buildSystemPrompt(orchestrated.context);
  const messageHistory = buildMessageHistory(session, message);

  // L0.5 — Lite model via OpenRouter (CDN-configured; default: Gemma 3 1B at 25%)
  const liteModelCfg = getLiteModelConfig();
  if (
    liteModelCfg.enabled &&
    Math.random() < liteModelCfg.sample_rate &&
    !deps.shouldThrottleProvider("openrouter")
  ) {
    const orClient = getOpenRouterClient();
    if (orClient) {
      try {
        const orMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          ...messageHistory,
        ];
        const orRes = await orClient.chat.completions.create({
          model: liteModelCfg.model,
          max_tokens: liteModelCfg.max_tokens,
          messages: orMessages,
        });
        const rawOrReply = orRes.choices[0]?.message?.content?.trim() || "";
        const reply = filterOrbOutput(rawOrReply);
        if (reply) {
          const usage = (orRes as any).usage;
          if (usage) deps.trackTokenUsage("openrouter", usage.prompt_tokens || 0, usage.completion_tokens || 0, "orb_chat_lite");
          appendToSession(session, "user", message);
          appendToSession(session, "assistant", reply);
          console.log(`[${ORB_VERSION}] Lite model response (turn ${session.turnCount}, model: ${liteModelCfg.model}) for user ${userId}`);
          return {
            reply,
            version: ORB_VERSION,
            provider: "openrouter-lite",
            sessionTurns: session.turnCount,
            recallSource: orchestrated.systemsHit.join(","),
            fromKnowledge: false,
          };
        }
      } catch (err: any) {
        console.warn(`[${ORB_VERSION}] Lite model failed, falling through to Kimi:`, err.message);
      }
    }
  }

  // L1 — Gemma 4 (primary — open-source, free via Gemini API)
  const geminiKey = apiKeys.gemini();
  if (geminiKey && !deps.shouldThrottleProvider("gemini")) {
    try {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(geminiKey);
      const gemmaModel = genAI.getGenerativeModel({
        model: "gemma-4-27b-it",
        systemInstruction: systemPrompt,
      });
      const gemmaHistory = messageHistory.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const chat = gemmaModel.startChat({ history: gemmaHistory });
      const lastMsg = messageHistory[messageHistory.length - 1]?.content || message;
      const gemmaRes = await chat.sendMessage(lastMsg);
      const rawGemmaReply = gemmaRes.response?.text()?.trim() || "";
      const reply = filterOrbOutput(rawGemmaReply);
      if (reply) {
        const usage = gemmaRes.response?.usageMetadata;
        if (usage) deps.trackTokenUsage("gemini", usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, "orb_chat_gemma4");
        appendToSession(session, "user", message);
        appendToSession(session, "assistant", reply);
        console.log(`[${ORB_VERSION}] Gemma 4 response (turn ${session.turnCount}, systems: ${orchestrated.systemsHit.join(",")}) for user ${userId}`);
        return {
          reply,
          version: ORB_VERSION,
          provider: "gemma4",
          sessionTurns: session.turnCount,
          recallSource: orchestrated.systemsHit.join(","),
          fromKnowledge: false,
        };
      }
    } catch (err: any) {
      console.warn(`[${ORB_VERSION}] Gemma 4 failed, falling through to Kimi:`, err.message);
    }
  }

  // L2 — Kimi / Moonshot (fallback if Gemma 4 unavailable)
  if (apiKeys.moonshot() && !deps.shouldThrottleProvider("kimi")) {
    try {
      const kimiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...messageHistory,
      ];
      const kimiRes = await deps.moonshotClient.chat.completions.create({
        model: "moonshot-v1-32k",
        max_tokens: 500,
        messages: kimiMessages,
      });
      const rawKimiReply = kimiRes.choices[0]?.message?.content?.trim() || "";
      const reply = filterOrbOutput(rawKimiReply);
      if (reply) {
        if (kimiRes.usage) deps.trackTokenUsage("kimi", kimiRes.usage.prompt_tokens || 0, kimiRes.usage.completion_tokens || 0, "orb_chat");
        appendToSession(session, "user", message);
        appendToSession(session, "assistant", reply);
        console.log(`[${ORB_VERSION}] Kimi response (turn ${session.turnCount}, systems: ${orchestrated.systemsHit.join(",")}) for user ${userId}`);
        return {
          reply,
          version: ORB_VERSION,
          provider: "kimi",
          sessionTurns: session.turnCount,
          recallSource: orchestrated.systemsHit.join(","),
          fromKnowledge: false,
        };
      }
    } catch (err: any) {
      console.warn(`[${ORB_VERSION}] Kimi failed:`, err.message);
    }
  }

  const anthropicKey = apiKeys.anthropic();
  if (anthropicKey && !deps.shouldThrottleProvider("claude")) {
    try {
      const claudeRes = await deps.anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 500,
        system: systemPrompt,
        messages: messageHistory,
      });
      const block = claudeRes.content[0];
      const rawClaudeReply = block && block.type === "text" ? block.text.trim() : "";
      const reply = filterOrbOutput(rawClaudeReply);
      if (reply) {
        deps.trackTokenUsage("claude", claudeRes.usage?.input_tokens || 0, claudeRes.usage?.output_tokens || 0, "orb_chat");
        appendToSession(session, "user", message);
        appendToSession(session, "assistant", reply);
        console.log(`[${ORB_VERSION}] Claude response (turn ${session.turnCount}, systems: ${orchestrated.systemsHit.join(",")}) for user ${userId}`);
        return {
          reply,
          version: ORB_VERSION,
          provider: "claude",
          sessionTurns: session.turnCount,
          recallSource: orchestrated.systemsHit.join(","),
          fromKnowledge: false,
        };
      }
    } catch (err: any) {
      console.warn(`[${ORB_VERSION}] Claude failed:`, err.message);
    }
  }

  // L3 — Offline text responder (no network, pattern-based, handles basic prompts)
  const offlineCfg = getLiteModelConfig();
  if (offlineCfg.offline_fallback) {
    const offlineReply = offlineRespond(message) ?? offlineFallback();
    appendToSession(session, "user", message);
    appendToSession(session, "assistant", offlineReply);
    console.log(`[${ORB_VERSION}] Offline text responder used for user ${userId}`);
    return {
      reply: offlineReply,
      version: ORB_VERSION,
      provider: "offline",
      sessionTurns: session.turnCount,
      recallSource: orchestrated.systemsHit.join(","),
      fromKnowledge: false,
    };
  }

  const fallbackReply = "I'm having trouble connecting right now. Please try again in a moment, or visit junotalk.app for help.";
  appendToSession(session, "user", message);
  appendToSession(session, "assistant", fallbackReply);
  return {
    reply: fallbackReply,
    version: ORB_VERSION,
    provider: "fallback",
    sessionTurns: session.turnCount,
    recallSource: orchestrated.systemsHit.join(","),
    fromKnowledge: false,
  };
}

export function clearOrbSession(userId: string): void {
  sessionStore.delete(userId);
  console.log(`[${ORB_VERSION}] Session cleared for user ${userId}`);
}

export function getOrbSession(userId: string): OrbSession | null {
  const session = sessionStore.get(userId);
  if (!session || Date.now() - session.lastActivity > SESSION_TTL_MS) return null;
  return session;
}

export function getOrbStats(): OrbStats {
  pruneExpiredSessions();
  return {
    version: ORB_VERSION,
    activeSessions: sessionStore.size,
    totalTurnsServed,
    vaultLoaded: vaultCacheTime > 0,
    recallStats: getRecallStats(),
  };
}

loadVaultDocs().catch(() => {});
