/**
 * Juno Intelligence Layer
 *
 * Eight behavioral + knowledge capabilities that extend the Adaptive Policy system.
 * Every capability runs entirely offline from hardcoded logic — the CDN config
 * only overrides thresholds and keyword lists for remote tuning without deploys.
 *
 * Capabilities implemented:
 *  3.  Conversation Momentum Tracking    — velocity, stall, and engagement state
 *  5.  Cognitive Load Detection          — complexity and confusion scoring
 *  7.  Goal Persistence Tracking         — extract and carry user intent across turns
 * 10.  Ambiguity Resolution System       — multi-interpretation detection
 * 15.  Redundancy Elimination            — prevent Juno repeating herself
 * 18.  Time Sensitivity Awareness        — urgency and deadline detection
 * 19.  Knowledge Boundary Detection      — Juno knows what she doesn't know
 * 28.  Output Confidence Calibration     — explicit certainty signaling
 *
 * CDN file: config/intelligence-layer.json
 * Fallback: hardcoded DEFAULT_CONFIG below (always active)
 */

import { fetchPrivateFile } from "./github-config";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IntelligenceLayerConfig {
  version: string;
  momentum: {
    stallWordCountThreshold: number;
    stallTurnCount: number;
    accelerationWordCountThreshold: number;
    accelerationTurnCount: number;
  };
  cognitiveLoad: {
    highWordCount: number;
    highQuestionCount: number;
    confusionSignals: string[];
    overwhelmSignals: string[];
  };
  goalPersistence: {
    intentPrefixes: string[];
    completionSignals: string[];
    maxGoalAgeturns: number;
  };
  ambiguity: {
    ambiguousSignals: string[];
    clarificationThreshold: number;
  };
  redundancy: {
    enabled: boolean;
    similarityWindowTurns: number;
    keywordOverlapThreshold: number;
  };
  timeSensitivity: {
    urgentKeywords: string[];
    deadlineKeywords: string[];
    softTimeKeywords: string[];
  };
  knowledgeBoundary: {
    uncertaintyTopics: string[];
    outOfBoundsTopics: string[];
    timeHorizonKeywords: string[];
  };
  confidence: {
    lowConfidenceTopics: string[];
    highConfidenceTopics: string[];
  };
}

export interface IntelligenceEvaluation {
  momentum: "accelerating" | "cruising" | "stalling";
  cognitiveLoad: "high" | "normal" | "low";
  goalState: { goal: string | null; status: "active" | "met" | "none" };
  ambiguityLevel: "high" | "low";
  redundancyRisk: boolean;
  timePressure: "urgent" | "soon" | "none";
  knowledgeBoundary: "in-bounds" | "uncertain" | "out-of-bounds";
  confidenceLevel: "high" | "medium" | "low";
  directives: string[];
}

type ChatMessage = { role: string; content: string };

// ── Default config (offline-first — CDN tunes, never required) ────────────────

const DEFAULT_CONFIG: IntelligenceLayerConfig = {
  version: "1.0.0",
  momentum: {
    stallWordCountThreshold: 5,
    stallTurnCount: 3,
    accelerationWordCountThreshold: 30,
    accelerationTurnCount: 3,
  },
  cognitiveLoad: {
    highWordCount: 60,
    highQuestionCount: 3,
    confusionSignals: [
      "i don't understand", "i'm confused", "what do you mean",
      "can you explain", "not sure what", "lost me", "unclear",
      "don't get it", "help me understand", "what does that mean",
      "i'm not following", "could you clarify", "makes no sense"
    ],
    overwhelmSignals: [
      "too much", "information overload", "slow down", "one at a time",
      "step by step", "that's a lot", "overwhelming", "too many things"
    ],
  },
  goalPersistence: {
    intentPrefixes: [
      "i want to", "i need to", "i'm trying to", "my goal is", "i'm working on",
      "help me", "i'd like to", "can you help me", "i'm building", "i want",
      "trying to figure out", "i need help with", "how do i", "how can i"
    ],
    completionSignals: [
      "that worked", "perfect", "exactly what i needed", "solved it",
      "got it", "thanks that's it", "done", "figured it out", "fixed",
      "that's what i was looking for"
    ],
    maxGoalAgeturns: 12,
  },
  ambiguity: {
    ambiguousSignals: [
      "or", "maybe", "either", "not sure which", "could be",
      "depends", "several ways", "not certain", "various", "multiple options"
    ],
    clarificationThreshold: 2,
  },
  redundancy: {
    enabled: true,
    similarityWindowTurns: 4,
    keywordOverlapThreshold: 0.6,
  },
  timeSensitivity: {
    urgentKeywords: [
      "asap", "urgent", "emergency", "right now", "immediately",
      "as soon as possible", "can't wait", "must be done", "critical", "now"
    ],
    deadlineKeywords: [
      "deadline", "by tomorrow", "by tonight", "due today", "due soon",
      "before", "by monday", "by friday", "end of day", "eod", "this week",
      "by morning", "in an hour", "in 30 minutes", "in a few minutes"
    ],
    softTimeKeywords: [
      "soon", "eventually", "at some point", "when i can", "no rush",
      "whenever", "take your time", "sometime"
    ],
  },
  knowledgeBoundary: {
    uncertaintyTopics: [
      "latest", "recent news", "today's", "this week's", "current stock",
      "real-time", "live data", "today", "right now in the world",
      "predict", "will happen", "forecast"
    ],
    outOfBoundsTopics: [
      "personal medical advice", "legal advice for my case", "diagnose me",
      "my specific tax situation", "hack into", "bypass security",
      "my personal data", "track someone", "classified"
    ],
    timeHorizonKeywords: [
      "after 2024", "in 2025", "this year", "last month", "yesterday",
      "breaking news", "just happened"
    ],
  },
  confidence: {
    lowConfidenceTopics: [
      "predict", "future", "will it", "guarantee", "certain",
      "for sure", "100%", "definitely will", "promise me"
    ],
    highConfidenceTopics: [
      "how does", "what is", "explain", "define", "describe",
      "basics of", "overview of", "history of", "what are"
    ],
  },
};

// ── Cache ──────────────────────────────────────────────────────────────────────

let cachedConfig: IntelligenceLayerConfig = DEFAULT_CONFIG;
let lastConfigLoad = 0;
const CONFIG_TTL = 60 * 60 * 1000;

async function loadConfig(): Promise<IntelligenceLayerConfig> {
  const now = Date.now();
  if (now - lastConfigLoad < CONFIG_TTL) return cachedConfig;
  try {
    const remote = await fetchPrivateFile("config/intelligence-layer.json");
    if (remote?.version && remote?.momentum && remote?.cognitiveLoad) {
      cachedConfig = remote as IntelligenceLayerConfig;
      lastConfigLoad = now;
      console.log(`[IntelligenceLayer] CDN config loaded — v${remote.version}`);
      return cachedConfig;
    }
  } catch {
    // silent — offline fallback active
  }
  if (lastConfigLoad === 0) lastConfigLoad = now;
  return cachedConfig;
}

export async function preloadIntelligenceLayerConfig(): Promise<void> {
  try { await loadConfig(); } catch {}
}

// ── 3. Conversation Momentum Tracking ─────────────────────────────────────────
// Measures how the conversation is flowing — accelerating (engaged, building),
// cruising (normal back-and-forth), or stalling (short unengaged replies).

function trackMomentum(
  history: ChatMessage[],
  cfg: IntelligenceLayerConfig
): "accelerating" | "cruising" | "stalling" {
  const recentUserMessages = history
    .filter(m => m.role === "user")
    .slice(-cfg.momentum.stallTurnCount);

  if (recentUserMessages.length < 2) return "cruising";

  const wordCounts = recentUserMessages.map(m =>
    m.content.trim().split(/\s+/).length
  );
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;

  if (avgWords <= cfg.momentum.stallWordCountThreshold) return "stalling";
  if (avgWords >= cfg.momentum.accelerationWordCountThreshold) return "accelerating";
  return "cruising";
}

// ── 5. Cognitive Load Detection ────────────────────────────────────────────────
// Scores the cognitive demand of the user's message — high complexity means
// Juno breaks things down more carefully; low means the user just needs confirmation.

function detectCognitiveLoad(
  text: string,
  cfg: IntelligenceLayerConfig
): "high" | "normal" | "low" {
  const lower = text.toLowerCase();
  const wordCount = text.trim().split(/\s+/).length;
  const questionCount = (text.match(/\?/g) || []).length;

  const hasConfusion = cfg.cognitiveLoad.confusionSignals.some(s => lower.includes(s));
  const hasOverwhelm = cfg.cognitiveLoad.overwhelmSignals.some(s => lower.includes(s));

  if (
    hasOverwhelm ||
    hasConfusion ||
    wordCount >= cfg.cognitiveLoad.highWordCount ||
    questionCount >= cfg.cognitiveLoad.highQuestionCount
  ) {
    return "high";
  }

  if (wordCount <= 8 && questionCount <= 1 && !hasConfusion) return "low";
  return "normal";
}

// ── 7. Goal Persistence Tracking ──────────────────────────────────────────────
// Extracts the user's underlying goal from the conversation and tracks whether
// it has been achieved. Surfaces the goal to Juno so she stays aligned.

function trackGoalPersistence(
  text: string,
  history: ChatMessage[],
  cfg: IntelligenceLayerConfig
): { goal: string | null; status: "active" | "met" | "none" } {
  const lower = text.toLowerCase();

  // Check if the current message signals completion
  const isComplete = cfg.goalPersistence.completionSignals.some(s => lower.includes(s));
  if (isComplete) {
    return { goal: null, status: "met" };
  }

  // Try to extract a goal from the current message
  for (const prefix of cfg.goalPersistence.intentPrefixes) {
    if (lower.includes(prefix)) {
      const idx = lower.indexOf(prefix);
      const goalFragment = text.slice(idx, idx + 100).trim();
      return { goal: goalFragment, status: "active" };
    }
  }

  // Look back in history for an earlier stated goal
  const windowedHistory = history
    .filter(m => m.role === "user")
    .slice(-cfg.goalPersistence.maxGoalAgeturns);

  for (const msg of [...windowedHistory].reverse()) {
    const msgLower = msg.content.toLowerCase();
    for (const prefix of cfg.goalPersistence.intentPrefixes) {
      if (msgLower.includes(prefix)) {
        const idx = msgLower.indexOf(prefix);
        const goalFragment = msg.content.slice(idx, idx + 100).trim();
        return { goal: goalFragment, status: "active" };
      }
    }
  }

  return { goal: null, status: "none" };
}

// ── 10. Ambiguity Resolution System ───────────────────────────────────────────
// Detects genuinely ambiguous requests where Juno could go down the wrong path
// without a quick clarification. Triggers only when confidence is genuinely low.

function detectAmbiguity(
  text: string,
  cfg: IntelligenceLayerConfig
): "high" | "low" {
  const lower = text.toLowerCase();
  const ambiguousHits = cfg.ambiguity.ambiguousSignals.filter(s => lower.includes(s)).length;

  // Also flag very short messages that could mean many things
  const wordCount = text.trim().split(/\s+/).length;
  const isVeryShort = wordCount <= 4;

  if (ambiguousHits >= cfg.ambiguity.clarificationThreshold || isVeryShort) return "high";
  return "low";
}

// ── 15. Redundancy Elimination ─────────────────────────────────────────────────
// Detects if Juno is at risk of repeating herself — when the current question
// closely mirrors something she already answered in this session.

function detectRedundancyRisk(
  text: string,
  history: ChatMessage[],
  cfg: IntelligenceLayerConfig
): boolean {
  if (!cfg.redundancy.enabled) return false;

  const recentAssistant = history
    .filter(m => m.role === "assistant")
    .slice(-cfg.redundancy.similarityWindowTurns);

  if (recentAssistant.length === 0) return false;

  const currentWords = new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  );

  for (const msg of recentAssistant) {
    const msgWords = new Set(
      msg.content.toLowerCase().split(/\W+/).filter(w => w.length > 4)
    );

    const overlap = [...currentWords].filter(w => msgWords.has(w)).length;
    const overlapRatio = overlap / Math.max(currentWords.size, 1);

    if (overlapRatio >= cfg.redundancy.keywordOverlapThreshold) return true;
  }

  return false;
}

// ── 18. Time Sensitivity Awareness ────────────────────────────────────────────
// Detects whether the user is working under time pressure.
// Urgency → Juno prioritizes speed and directness over thoroughness.
// Deadline → Juno acknowledges time constraint and stays action-focused.

function detectTimePressure(
  text: string,
  cfg: IntelligenceLayerConfig
): "urgent" | "soon" | "none" {
  const lower = text.toLowerCase();

  const isUrgent = cfg.timeSensitivity.urgentKeywords.some(kw => lower.includes(kw));
  if (isUrgent) return "urgent";

  const isDeadline = cfg.timeSensitivity.deadlineKeywords.some(kw => lower.includes(kw));
  if (isDeadline) return "soon";

  return "none";
}

// ── 19. Knowledge Boundary Detection ──────────────────────────────────────────
// Juno knows when she's being asked about things outside her reliable knowledge:
// real-time data, very recent events, personal/legal/medical specifics, or
// things that require prediction rather than knowledge.

function detectKnowledgeBoundary(
  text: string,
  cfg: IntelligenceLayerConfig
): "in-bounds" | "uncertain" | "out-of-bounds" {
  const lower = text.toLowerCase();

  const isOutOfBounds = cfg.knowledgeBoundary.outOfBoundsTopics.some(t => lower.includes(t));
  if (isOutOfBounds) return "out-of-bounds";

  const isUncertain =
    cfg.knowledgeBoundary.uncertaintyTopics.some(t => lower.includes(t)) ||
    cfg.knowledgeBoundary.timeHorizonKeywords.some(t => lower.includes(t));

  if (isUncertain) return "uncertain";
  return "in-bounds";
}

// ── 28. Output Confidence Calibration ─────────────────────────────────────────
// Scores how confident Juno should be in her answer and instructs her to
// explicitly hedge when confidence is medium or low. Prevents overconfident
// responses on topics that require uncertainty acknowledgment.

function calibrateConfidence(
  text: string,
  boundaryResult: "in-bounds" | "uncertain" | "out-of-bounds",
  cfg: IntelligenceLayerConfig
): "high" | "medium" | "low" {
  if (boundaryResult === "out-of-bounds") return "low";
  if (boundaryResult === "uncertain") return "medium";

  const lower = text.toLowerCase();

  const isLowConfidence = cfg.confidence.lowConfidenceTopics.some(t => lower.includes(t));
  if (isLowConfidence) return "medium";

  const isHighConfidence = cfg.confidence.highConfidenceTopics.some(t => lower.includes(t));
  if (isHighConfidence) return "high";

  return "high";
}

// ── Directive Builder ──────────────────────────────────────────────────────────
// Converts intelligence evaluation results into concrete prompt instructions.

function buildIntelligenceDirectives(
  evaluation: Omit<IntelligenceEvaluation, "directives">
): string[] {
  const directives: string[] = [];

  // 3. Momentum
  if (evaluation.momentum === "stalling") {
    directives.push(
      "MOMENTUM: STALLING — The user's replies have been brief and low-engagement. Re-engage naturally: be more concise, shift energy, or ask a single direct question to reconnect. Don't lecture."
    );
  } else if (evaluation.momentum === "accelerating") {
    directives.push(
      "MOMENTUM: ACCELERATING — The conversation is building well. Match the energy, go deeper on the topic, and keep the exchange moving forward."
    );
  }

  // 5. Cognitive Load
  if (evaluation.cognitiveLoad === "high") {
    directives.push(
      "COGNITIVE LOAD: HIGH — The user is dealing with something complex or is confused. Break your response into clear, small steps. Address one thing at a time. Use numbered steps or bullets if helpful. Don't add more information than necessary."
    );
  } else if (evaluation.cognitiveLoad === "low") {
    directives.push(
      "COGNITIVE LOAD: LOW — Simple request. Keep it short and direct. Don't over-explain."
    );
  }

  // 7. Goal Persistence
  if (evaluation.goalState.status === "active" && evaluation.goalState.goal) {
    const truncated = evaluation.goalState.goal.slice(0, 80);
    directives.push(
      `GOAL PERSISTENCE: The user's underlying goal is: "${truncated}". Keep this goal in mind while responding — every part of your answer should move them toward it. Don't drift off topic.`
    );
  } else if (evaluation.goalState.status === "met") {
    directives.push(
      "GOAL PERSISTENCE: The user appears to have achieved their goal. Acknowledge the completion naturally, and check if there's a next step or if they're done."
    );
  }

  // 10. Ambiguity
  if (evaluation.ambiguityLevel === "high") {
    directives.push(
      "AMBIGUITY: HIGH — The request could be interpreted in more than one way. Before answering at length, pick the most likely interpretation and state your assumption clearly upfront: 'I'm assuming you mean X — let me know if that's not right.' Then answer based on that assumption."
    );
  }

  // 15. Redundancy
  if (evaluation.redundancyRisk) {
    directives.push(
      "REDUNDANCY RISK: You've recently covered related content. Don't repeat what was already said. Either build on it ('as I mentioned, X — here's what that means for your situation') or acknowledge it briefly and add something new."
    );
  }

  // 18. Time Sensitivity
  if (evaluation.timePressure === "urgent") {
    directives.push(
      "TIME PRESSURE: URGENT — The user needs help right now. Lead with the most critical action immediately. No preamble. Use a numbered action list if there are multiple steps. Be faster than thorough."
    );
  } else if (evaluation.timePressure === "soon") {
    directives.push(
      "TIME PRESSURE: DEADLINE — The user has a time constraint. Acknowledge it briefly and stay action-focused. Prioritize what moves the needle fastest."
    );
  }

  // 19. Knowledge Boundary
  if (evaluation.knowledgeBoundary === "out-of-bounds") {
    directives.push(
      "KNOWLEDGE BOUNDARY: OUT OF BOUNDS — This request goes beyond what you can reliably answer (personal legal/medical, classified, real-time data, or harmful). Be honest and specific: explain what you can't help with and why, then offer what you CAN do. Don't pretend to know or fabricate."
    );
  } else if (evaluation.knowledgeBoundary === "uncertain") {
    directives.push(
      "KNOWLEDGE BOUNDARY: UNCERTAIN — You may not have current or complete information on this. Flag it honestly ('My knowledge may not include the latest on this') and answer based on what you do know with appropriate caveats."
    );
  }

  // 28. Confidence
  if (evaluation.confidenceLevel === "low") {
    directives.push(
      "CONFIDENCE: LOW — Express appropriate uncertainty in your response. Use language like 'I believe,' 'from what I know,' 'I'm not certain but.' Don't state uncertain things as facts."
    );
  } else if (evaluation.confidenceLevel === "medium") {
    directives.push(
      "CONFIDENCE: MEDIUM — You have partial confidence on this. State what you're sure about clearly, and flag where you're less certain. Don't over-hedge on what you do know well."
    );
  }

  return directives;
}

// ── Main Export ────────────────────────────────────────────────────────────────

export async function evaluateIntelligenceLayer(
  text: string,
  history: ChatMessage[]
): Promise<IntelligenceEvaluation> {
  const cfg = await loadConfig();

  const momentum = trackMomentum(history, cfg);
  const cognitiveLoad = detectCognitiveLoad(text, cfg);
  const goalState = trackGoalPersistence(text, history, cfg);
  const ambiguityLevel = detectAmbiguity(text, cfg);
  const redundancyRisk = detectRedundancyRisk(text, history, cfg);
  const timePressure = detectTimePressure(text, cfg);
  const knowledgeBoundary = detectKnowledgeBoundary(text, cfg);
  const confidenceLevel = calibrateConfidence(text, knowledgeBoundary, cfg);

  const base = {
    momentum,
    cognitiveLoad,
    goalState,
    ambiguityLevel,
    redundancyRisk,
    timePressure,
    knowledgeBoundary,
    confidenceLevel,
  };

  const directives = buildIntelligenceDirectives(base);

  return { ...base, directives };
}

export function getIntelligenceLayerConfig(): IntelligenceLayerConfig {
  return cachedConfig;
}
