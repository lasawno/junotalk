/**
 * Juno Learner — Persistent Cross-Session Learning Engine
 *
 * Juno learns from every conversation and remembers across sessions.
 * Three operations run on every user message:
 *
 *  1. EXTRACT  — pattern-match the message for learnable facts
 *  2. STORE    — write new facts to the vector DB (deduplicated, tagged)
 *  3. RECALL   — semantic search pulls the most relevant facts for the
 *                current message and injects them into the system prompt
 *
 * Fact categories:
 *  • personal   — name, location, age, job, family ("my name is", "I live in")
 *  • preference — likes, dislikes, habits ("I prefer", "I hate", "I always")
 *  • expertise  — skills, profession, background ("I'm a doctor", "I build")
 *  • correction — things Juno got wrong ("actually", "that's wrong", "no,")
 *  • goal       — stated intentions ("I want to", "I'm trying to build")
 *  • context    — situational facts ("I'm at work", "my team uses", "we use")
 *
 * Storage: Supabase PostgreSQL via the existing conversation_embeddings table
 *   content_type = "learned_fact"
 * Recall:  pgvector cosine similarity search, top-N per turn (CDN-tunable)
 * Dedup:   skip storing if similarity >= dedupThreshold to an existing fact
 *
 * Offline-first — hardcoded defaults always active.
 * CDN file: config/learner.json — overrides thresholds & trigger lists remotely.
 */

import {
  storeConversationEmbedding,
  searchSimilarConversations,
} from "./embedding-service";
import { fetchPrivateFile } from "./github-config";

// ── Config Interface ───────────────────────────────────────────────────────────

export interface LearnerConfig {
  version: string;
  enabled: boolean;
  extraction: {
    minWordCount: number;
    maxFactTextLength: number;
    questionPrefixes: string[];
    patterns: Array<{
      category: string;
      triggers: string[];
      confidence: number;
    }>;
  };
  storage: {
    dedupSimilarityThreshold: number;
    dedupSearchLimit: number;
  };
  recall: {
    limit: number;
    minSimilarity: number;
  };
  labels: Record<string, string>;
}

// ── Default config (offline-first — CDN tunes, never required) ────────────────

const DEFAULT_CONFIG: LearnerConfig = {
  version: "1.0.0",
  enabled: true,
  extraction: {
    minWordCount: 4,
    maxFactTextLength: 200,
    questionPrefixes: [
      "what", "who", "where", "when", "why", "how",
      "is", "are", "can", "could", "would", "should",
      "did", "do", "does", "will"
    ],
    patterns: [
      {
        category: "personal",
        confidence: 0.85,
        triggers: [
          "my name is", "i am called", "call me", "i'm called",
          "i live in", "i'm from", "i am from", "i'm based in", "i work at",
          "my age is", "my birthday", "i have a",
          "my wife", "my husband", "my partner", "my kids", "my child",
          "my family", "my mom", "my dad", "my brother", "my sister"
        ],
      },
      {
        category: "preference",
        confidence: 0.88,
        triggers: [
          "i prefer", "i like", "i love", "i enjoy", "i hate",
          "i don't like", "i dislike", "i can't stand", "i always",
          "i never", "i usually", "i tend to", "my favorite", "my favourite",
          "i'm a fan of", "i'm not a fan", "i avoid", "i use", "i don't use"
        ],
      },
      {
        category: "expertise",
        confidence: 0.90,
        triggers: [
          "i'm a", "i am a", "i work as", "i'm an", "i am an",
          "i specialize in", "i specialise in", "my background is",
          "i studied", "i have a degree", "i'm experienced in",
          "i know how to", "i've been working on", "i build",
          "i develop", "i design", "i manage", "i lead", "i run",
          "my expertise", "professionally i"
        ],
      },
      {
        category: "correction",
        confidence: 0.80,
        triggers: [
          "actually", "that's not right", "you're wrong", "that's wrong",
          "no,", "incorrect", "not exactly", "not quite", "i meant",
          "what i meant", "to clarify", "let me correct", "the correct",
          "it's actually", "the real", "in fact", "correction:"
        ],
      },
      {
        category: "goal",
        confidence: 0.82,
        triggers: [
          "i want to", "i need to", "i'm trying to", "my goal is",
          "i'm working on", "i'm building", "i'm creating", "i'm developing",
          "i'm planning to", "i'd like to", "my plan is", "i hope to",
          "i'm aiming to", "i want", "i need", "i'm looking to"
        ],
      },
      {
        category: "context",
        confidence: 0.83,
        triggers: [
          "my team", "my company", "my project", "we use", "our stack",
          "our team", "at my job", "at work", "my app", "my website",
          "my product", "my startup", "my business", "in my industry",
          "we're building", "my codebase", "our platform"
        ],
      },
    ],
  },
  storage: {
    dedupSimilarityThreshold: 0.92,
    dedupSearchLimit: 3,
  },
  recall: {
    limit: 5,
    minSimilarity: 0.72,
  },
  labels: {
    personal:   "About this user",
    preference: "Their preferences",
    expertise:  "Their background & expertise",
    correction: "Things they've corrected me on",
    goal:       "Their stated goals",
    context:    "Their context & environment",
  },
};

// ── CDN Cache ──────────────────────────────────────────────────────────────────

let cachedConfig: LearnerConfig = DEFAULT_CONFIG;
let lastConfigLoad = 0;
const CONFIG_TTL = 60 * 60 * 1000; // 1 hour

async function loadConfig(): Promise<LearnerConfig> {
  const now = Date.now();
  if (now - lastConfigLoad < CONFIG_TTL) return cachedConfig;
  try {
    const remote = await fetchPrivateFile("config/learner.json");
    if (remote?.version && remote?.extraction && remote?.storage && remote?.recall) {
      cachedConfig = remote as LearnerConfig;
      lastConfigLoad = now;
      console.log(`[JunoLearner] CDN config loaded — v${remote.version}`);
      return cachedConfig;
    }
  } catch {
    // silent — offline fallback active
  }
  if (lastConfigLoad === 0) lastConfigLoad = now;
  return cachedConfig;
}

export async function preloadLearnerConfig(): Promise<void> {
  try { await loadConfig(); } catch {}
}

export function getLearnerConfig(): LearnerConfig {
  return cachedConfig;
}

// ── Fact Types ─────────────────────────────────────────────────────────────────

export type FactCategory =
  | "personal"
  | "preference"
  | "expertise"
  | "correction"
  | "goal"
  | "context";

export interface LearnedFact {
  text: string;
  category: FactCategory;
  confidence: number;
  extractedAt: string;
}

export interface LearnerRecall {
  facts: LearnedFact[];
  promptBlock: string;
}

// ── 1. Extract ─────────────────────────────────────────────────────────────────
// Pull learnable facts from a user message using CDN-tunable patterns.

export async function extractFacts(text: string): Promise<LearnedFact[]> {
  const cfg = await loadConfig();
  if (!cfg.enabled) return [];

  const lower = text.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  if (wordCount < cfg.extraction.minWordCount) return [];

  // Skip questions — they're requests, not statements of fact
  const questionPattern = new RegExp(
    `^\\s*(${cfg.extraction.questionPrefixes.join("|")})\\b`,
    "i"
  );
  if (questionPattern.test(lower)) return [];

  const seen = new Set<string>();
  const facts: LearnedFact[] = [];

  for (const group of cfg.extraction.patterns) {
    if (seen.has(group.category)) continue;

    const matched = group.triggers.some((trigger: string) => lower.includes(trigger));
    if (!matched) continue;

    // Trim to sentence boundaries for cleaner storage
    const sentences = text.split(/[.!?]+/).map((s: string) => s.trim()).filter(Boolean);
    const relevantSentences = sentences.filter((s: string) => {
      const sl = s.toLowerCase();
      return group.triggers.some((trigger: string) => sl.includes(trigger));
    });

    const factText = (
      relevantSentences.length > 0
        ? relevantSentences.join(". ")
        : text
    ).slice(0, cfg.extraction.maxFactTextLength);

    facts.push({
      text: factText,
      category: group.category as FactCategory,
      confidence: group.confidence,
      extractedAt: new Date().toISOString(),
    });

    seen.add(group.category);
  }

  return facts;
}

// ── 2. Store ───────────────────────────────────────────────────────────────────
// Persist extracted facts to the vector DB. Deduplicates before writing.

export async function storeFacts(
  facts: LearnedFact[],
  userId: string,
  roomCode?: string
): Promise<void> {
  if (facts.length === 0) return;
  const cfg = await loadConfig();
  if (!cfg.enabled) return;

  for (const fact of facts) {
    try {
      const existing = await searchSimilarConversations(
        fact.text,
        userId,
        undefined,
        "learned_fact",
        cfg.storage.dedupSearchLimit,
        cfg.storage.dedupSimilarityThreshold
      );

      if (existing.length > 0) continue; // Already know this — skip

      await storeConversationEmbedding(
        fact.text,
        userId,
        "learned_fact",
        roomCode,
        {
          category: fact.category,
          confidence: fact.confidence,
          extractedAt: fact.extractedAt,
        }
      );

      console.log(
        `[JunoLearner] Stored ${fact.category} fact for user ${userId.slice(0, 8)}: "${fact.text.slice(0, 60)}"`
      );
    } catch {
      // Silent — learning is non-critical, never blocks the response
    }
  }
}

// ── 3. Recall ──────────────────────────────────────────────────────────────────
// Semantic search for the most relevant facts Juno has learned about this user.

export async function recallFacts(
  currentMessage: string,
  userId: string
): Promise<LearnerRecall> {
  const cfg = await loadConfig();
  if (!cfg.enabled) return { facts: [], promptBlock: "" };

  try {
    const results = await searchSimilarConversations(
      currentMessage,
      userId,
      undefined,
      "learned_fact",
      cfg.recall.limit,
      cfg.recall.minSimilarity
    );

    if (results.length === 0) return { facts: [], promptBlock: "" };

    const facts: LearnedFact[] = results.map(r => ({
      text: r.content,
      category: (r.metadata?.category ?? "context") as FactCategory,
      confidence: r.metadata?.confidence ?? 0.8,
      extractedAt: r.metadata?.extractedAt ?? r.createdAt?.toISOString() ?? "",
    }));

    const promptBlock = buildRecallPromptBlock(facts, cfg.labels);
    return { facts, promptBlock };
  } catch {
    return { facts: [], promptBlock: "" };
  }
}

// ── Recall Prompt Builder ──────────────────────────────────────────────────────

function buildRecallPromptBlock(
  facts: LearnedFact[],
  labels: Record<string, string>
): string {
  if (facts.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact.text);
  }

  const lines: string[] = [
    "WHAT JUNO KNOWS ABOUT THIS USER (learned from past conversations — use naturally, don't announce it):",
  ];

  for (const [category, items] of Object.entries(grouped)) {
    const label = labels[category] ?? category;
    for (const item of items) {
      lines.push(`  [${label}] ${item}`);
    }
  }

  return lines.join("\n");
}

// ── Main entry: learn + recall in one call ────────────────────────────────────
// Recall runs first (for the current response).
// Extract+store runs after as fire-and-forget — never blocks latency.

export async function learnAndRecall(
  userMessage: string,
  userId: string,
  roomCode?: string
): Promise<LearnerRecall> {
  const recall = await recallFacts(userMessage, userId);

  extractFacts(userMessage).then(facts => {
    if (facts.length > 0) {
      storeFacts(facts, userId, roomCode).catch(() => {});
    }
  }).catch(() => {});

  return recall;
}
