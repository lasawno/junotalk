/**
 * Juno Adaptive Decision Policies
 *
 * Four behavioral policies that run in parallel with the knowledge base and
 * inject contextual directives into Juno's system prompt before each response:
 *
 *  1. Significance Detector   — scores message importance; adjusts response depth
 *  2. Curiosity Engine        — triggers exploratory follow-up on novel topics
 *  3. Surprise Learning       — detects prediction errors / corrections; adapts tone
 *  4. Dynamic Trust Threshold — governs when Juno acts vs. seeks confirmation
 *
 * Policy parameters are loaded from the GitHub CDN (config/adaptive-policies.json)
 * and cached for 1 hour. The hardcoded defaults below are always the fallback.
 */

import { fetchPrivateFile } from "./github-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdaptivePolicyConfig {
  version: string;
  significance: {
    highKeywords: string[];
    lowKeywords: string[];
    highThreshold: number;
    lowThreshold: number;
  };
  curiosity: {
    enabled: boolean;
    noveltyKeywords: string[];
    minHistoryLength: number;
    cooldownTurns: number;
  };
  surpriseLearning: {
    enabled: boolean;
    correctionSignals: string[];
    shiftSignals: string[];
  };
  trustThreshold: {
    lowTrustTurns: number;
    highTrustTurns: number;
    confirmationActions: string[];
  };
}

export interface PolicyEvaluation {
  significanceLevel: "high" | "medium" | "low";
  curiosityTrigger: boolean;
  surpriseTrigger: boolean;
  surpriseType: "factual" | "tonal" | "context" | null;
  trustLevel: "low" | "medium" | "high";
  directives: string[];
}

type ChatMessage = { role: string; content: string };

// ── Default config (CDN fallback) ─────────────────────────────────────────────

const DEFAULT_CONFIG: AdaptivePolicyConfig = {
  version: "1.0.0",
  significance: {
    highKeywords: [
      "urgent", "emergency", "critical", "important", "serious", "deadline",
      "crisis", "help me", "need help", "dying", "danger", "decision",
      "invest", "money", "legal", "medical", "health", "advice",
      "should i", "what do i do", "how do i fix", "broken", "failed"
    ],
    lowKeywords: [
      "hi", "hello", "hey", "lol", "haha", "ok", "okay", "cool",
      "nice", "great", "thanks", "bye", "later", "yes", "no", "sure",
      "what's up", "how are you", "good morning", "good night"
    ],
    highThreshold: 2,
    lowThreshold: 1,
  },
  curiosity: {
    enabled: true,
    noveltyKeywords: [
      "what if", "imagine", "hypothetically", "idea", "concept", "theory",
      "never heard", "new to", "wondering", "curious", "explore", "discover",
      "could", "might", "would", "possibility", "future", "different"
    ],
    minHistoryLength: 2,
    cooldownTurns: 3,
  },
  surpriseLearning: {
    enabled: true,
    correctionSignals: [
      "actually", "that's wrong", "you're wrong", "incorrect", "no that's",
      "not quite", "not exactly", "that's not right", "wait no", "i meant",
      "correction", "mistake", "wrong", "no no", "that's incorrect"
    ],
    shiftSignals: [
      "anyway", "forget that", "let's change", "different topic", "actually never mind",
      "let me rephrase", "i changed my mind", "switch to", "actually let's"
    ],
  },
  trustThreshold: {
    lowTrustTurns: 3,
    highTrustTurns: 10,
    confirmationActions: [
      "delete", "remove", "reset", "clear", "send to everyone",
      "share my location", "give my number", "reveal", "publish",
      "post publicly", "broadcast"
    ],
  },
};

// ── Cache ─────────────────────────────────────────────────────────────────────

let cachedConfig: AdaptivePolicyConfig = DEFAULT_CONFIG;
let lastConfigLoad = 0;
const CONFIG_TTL = 60 * 60 * 1000;

async function loadConfig(): Promise<AdaptivePolicyConfig> {
  const now = Date.now();
  if (now - lastConfigLoad < CONFIG_TTL) return cachedConfig;
  try {
    const remote = await fetchPrivateFile("config/adaptive-policies.json");
    if (remote?.version && remote?.significance && remote?.curiosity) {
      cachedConfig = remote as AdaptivePolicyConfig;
      lastConfigLoad = now;
      console.log(`[AdaptivePolicy] CDN config loaded — v${remote.version}`);
      return cachedConfig;
    }
  } catch {
    // silent — use cached/default
  }
  if (lastConfigLoad === 0) lastConfigLoad = now;
  return cachedConfig;
}

export async function preloadAdaptivePolicyConfig(): Promise<void> {
  try { await loadConfig(); } catch {}
}

// ── Policy 1: Significance Detector ──────────────────────────────────────────
// Scores the incoming message for importance level.
// High → Juno goes deeper, structures the response more carefully.
// Low  → Juno stays light and conversational.

function detectSignificance(
  text: string,
  cfg: AdaptivePolicyConfig
): "high" | "medium" | "low" {
  const lower = text.toLowerCase();
  const highHits = cfg.significance.highKeywords.filter(kw => lower.includes(kw)).length;
  const lowHits = cfg.significance.lowKeywords.filter(kw => lower.includes(kw)).length;

  if (highHits >= cfg.significance.highThreshold) return "high";
  if (lowHits >= cfg.significance.lowThreshold && highHits === 0) return "low";
  return "medium";
}

// ── Policy 2: Curiosity Engine ────────────────────────────────────────────────
// Triggers when the user introduces a novel or hypothetical topic.
// Juno adds one deeper exploratory follow-up question to push the conversation forward.
// Respects a cooldown so it doesn't fire every single turn.

function detectCuriosity(
  text: string,
  history: ChatMessage[],
  cfg: AdaptivePolicyConfig
): boolean {
  if (!cfg.curiosity.enabled) return false;
  if (history.length < cfg.curiosity.minHistoryLength) return false;

  const lower = text.toLowerCase();
  const hasNovelty = cfg.curiosity.noveltyKeywords.some(kw => lower.includes(kw));
  if (!hasNovelty) return false;

  // Cooldown: check if curiosity fired in the last N assistant turns
  const assistantTurns = history
    .filter(m => m.role === "assistant")
    .slice(-(cfg.curiosity.cooldownTurns));

  const recentlyCurious = assistantTurns.some(m =>
    m.content.includes("[CURIOSITY]") || m.content.includes("I'm curious")
  );

  return !recentlyCurious;
}

// ── Policy 3: Surprise Learning Trigger ───────────────────────────────────────
// Fires when the user corrects Juno or abruptly redirects the conversation.
// Signals Juno to acknowledge the gap and adapt rather than doubling down.

function detectSurprise(
  text: string,
  cfg: AdaptivePolicyConfig
): { triggered: boolean; type: "factual" | "tonal" | "context" | null } {
  if (!cfg.surpriseLearning.enabled) {
    return { triggered: false, type: null };
  }

  const lower = text.toLowerCase();

  const isCorrection = cfg.surpriseLearning.correctionSignals.some(s => lower.includes(s));
  if (isCorrection) return { triggered: true, type: "factual" };

  const isShift = cfg.surpriseLearning.shiftSignals.some(s => lower.includes(s));
  if (isShift) return { triggered: true, type: "context" };

  // Tonal surprise: very short dismissive replies after a long Juno response
  const lastAssistant = [...(cfg as any)._lastAssistantLen ?? []];
  if (text.trim().split(/\s+/).length <= 3 && lower.match(/^(no|nope|wrong|stop|wait|ugh|hmm)/)) {
    return { triggered: true, type: "tonal" };
  }

  return { triggered: false, type: null };
}

// ── Policy 4: Dynamic Trust Threshold ────────────────────────────────────────
// Determines how much Juno trusts the session context before acting.
// Short sessions = lower trust (more confirmation-seeking).
// Established sessions = higher trust (more direct action).
// Certain high-stakes actions always require explicit confirmation.

function evaluateTrust(
  text: string,
  history: ChatMessage[],
  cfg: AdaptivePolicyConfig
): "low" | "medium" | "high" {
  const lower = text.toLowerCase();

  // High-stakes actions always require confirmation regardless of session length
  const isHighStakes = cfg.trustThreshold.confirmationActions.some(a => lower.includes(a));
  if (isHighStakes) return "low";

  const userTurns = history.filter(m => m.role === "user").length;
  if (userTurns <= cfg.trustThreshold.lowTrustTurns) return "low";
  if (userTurns >= cfg.trustThreshold.highTrustTurns) return "high";
  return "medium";
}

// ── Directive Builder ─────────────────────────────────────────────────────────
// Converts policy evaluation results into concrete prompt instructions.

function buildDirectives(evaluation: Omit<PolicyEvaluation, "directives">): string[] {
  const directives: string[] = [];

  // Significance
  if (evaluation.significanceLevel === "high") {
    directives.push(
      "SIGNIFICANCE: HIGH — This message involves something important or decision-worthy. Prioritize clarity and depth over brevity. Structure your response if needed (bullets, steps). Be direct about risks or tradeoffs."
    );
  } else if (evaluation.significanceLevel === "low") {
    directives.push(
      "SIGNIFICANCE: LOW — This is light conversation. Keep your response brief, warm, and natural. No need for structure or depth."
    );
  }

  // Curiosity Engine
  if (evaluation.curiosityTrigger) {
    directives.push(
      "CURIOSITY ENGINE: ACTIVE — The user is exploring something new or hypothetical. After your response, add one genuinely interesting exploratory question that goes deeper — not a generic follow-up, but something that could unlock a new direction in this conversation."
    );
  }

  // Surprise Learning
  if (evaluation.surpriseTrigger) {
    if (evaluation.surpriseType === "factual") {
      directives.push(
        "SURPRISE TRIGGER: CORRECTION — The user has corrected or challenged something. Acknowledge the correction naturally (don't be defensive), update your understanding, and continue from the corrected position."
      );
    } else if (evaluation.surpriseType === "context") {
      directives.push(
        "SURPRISE TRIGGER: CONTEXT SHIFT — The user redirected the conversation. Don't hold on to the previous thread. Follow their new direction without referencing what they moved away from."
      );
    } else if (evaluation.surpriseType === "tonal") {
      directives.push(
        "SURPRISE TRIGGER: TONAL — The user seems dissatisfied or brief. Recalibrate: be shorter, more direct, and ask what they actually need."
      );
    }
  }

  // Trust Threshold
  if (evaluation.trustLevel === "low") {
    directives.push(
      "TRUST THRESHOLD: LOW — Early in this session or high-stakes request. Before acting on ambiguous instructions, briefly confirm intent: 'Just to make sure — are you asking me to X?' Keep confirmation questions short and specific."
    );
  } else if (evaluation.trustLevel === "high") {
    directives.push(
      "TRUST THRESHOLD: HIGH — Established session with clear context. Act directly without over-confirming. The user knows what they want."
    );
  }

  return directives;
}

// ── Main Export ───────────────────────────────────────────────────────────────

export async function evaluateAdaptivePolicies(
  text: string,
  history: ChatMessage[]
): Promise<PolicyEvaluation> {
  const cfg = await loadConfig();

  const significanceLevel = detectSignificance(text, cfg);
  const curiosityTrigger = detectCuriosity(text, history, cfg);
  const surpriseResult = detectSurprise(text, cfg);
  const trustLevel = evaluateTrust(text, history, cfg);

  const base = {
    significanceLevel,
    curiosityTrigger,
    surpriseTrigger: surpriseResult.triggered,
    surpriseType: surpriseResult.type,
    trustLevel,
  };

  const directives = buildDirectives(base);

  return { ...base, directives };
}

export function getAdaptivePolicyConfig(): AdaptivePolicyConfig {
  return cachedConfig;
}
