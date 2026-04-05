/**
 * Recall Orchestrator — single integration point for all five recall systems.
 *
 * Routes each query to the right systems based on a named profile, runs
 * independent lookups in parallel, then merges results into a single
 * context string for AI prompt injection.
 *
 * Weights are derived from the usage audit (March 2026) and reflect each
 * system's real contribution value per profile — not arbitrary percentages.
 *
 *   translation: System1(40%) + System2(35%) + System4(25%)
 *   juno:        System1(30%) + System2(20%) + System3(35%) + System4(15%)
 *   vision:      System5(100%)
 *
 * GraphQL integration point: any external graph query can be wrapped in a
 * RecallLayer and appended to the profile config. The orchestrator will
 * handle weighting, timeout, and context merging automatically.
 */

import {
  recallForTranslation,
  buildRecallPromptContext,
  getUserBehaviorContext,
} from "./agent-recall";

import { getOsintContext, getGraphContext } from "./knowledge-sync";
import { answerQuestion } from "./juno-knowledge";
import {
  searchSimilarTranslations,
  searchSimilarConversations,
  isVectorReady,
} from "./embedding-service";
import { githubFallbackCache } from "./translation-fallback";

export type RecallProfile = "translation" | "juno" | "vision";

export interface RecallQuery {
  text: string;
  sourceLang: string;
  targetLang: string;
  userId?: string;
  roomCode?: string;
}

export interface OrchestratedRecall {
  profile: RecallProfile;
  context: string;           // single string ready to inject into system prompt
  systemsQueried: string[];  // which systems ran (for observability)
  systemsHit: string[];      // which returned non-empty results
  durationMs: number;
}

/** Character budget for combined context — keeps prompts from bloating. */
const CONTEXT_BUDGET = 1800;

/**
 * Per-lane character allocation derived from weight × budget.
 *
 * Four named lanes for translation and juno profiles:
 *   Obsidian      — behavioral vault (user preferences, consent, style)
 *   OSINT         — open-source intelligence (public knowledge brain layer)
 *   VectorMemory  — semantic embedding search (pgvector similarity)
 *   GraphKnowledge— Neo4j graph + Wikidata + cultural knowledge
 */
const WEIGHTS = {
  translation: { obsidian: 0.25, osint: 0.25, vector: 0.35, graph: 0.15 },
  juno:        { obsidian: 0.20, osint: 0.20, vector: 0.25, graph: 0.35 },
  vision:      { vision: 1.00 },
} as const;

// ── GitHub fallback load tracking ────────────────────────────────────────────
// GitHub CDN is a safety net only — it should never become the primary source.
// If it carries more than 30% of requests, something upstream is broken.

let _totalRecallRequests = 0;
let _githubFallbackHits  = 0;
const GITHUB_LOAD_WARN_THRESHOLD = 0.30;

export function getGithubFallbackLoad() {
  const ratio = _totalRecallRequests > 0
    ? _githubFallbackHits / _totalRecallRequests
    : 0;
  return {
    total: _totalRecallRequests,
    githubFallbackHits: _githubFallbackHits,
    loadRatio: Math.round(ratio * 1000) / 1000,
    healthy: ratio <= GITHUB_LOAD_WARN_THRESHOLD,
  };
}

/**
 * GitHub CDN fallback — only fires when all primary systems return empty.
 *
 * Translation: searches `githubFallbackCache[sourceLang][targetLang]` for
 * any curated phrase that appears in the query text.
 *
 * Juno: searches all phrase pairs for keyword matches (language-agnostic).
 */
function tryGithubFallback(q: RecallQuery, profile: RecallProfile): string {
  const words = q.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return "";

  const matches: string[] = [];

  if (profile === "translation") {
    const pairs = githubFallbackCache[q.sourceLang]?.[q.targetLang] ?? {};
    for (const [phrase, translation] of Object.entries(pairs)) {
      const lc = phrase.toLowerCase();
      if (words.some(w => lc.includes(w))) {
        matches.push(`"${phrase}" → "${translation}"`);
        if (matches.length >= 3) break;
      }
    }
  } else {
    outer: for (const targets of Object.values(githubFallbackCache)) {
      for (const pairs of Object.values(targets)) {
        for (const [phrase, translation] of Object.entries(pairs)) {
          const lc = phrase.toLowerCase();
          if (words.some(w => lc.includes(w))) {
            matches.push(`"${phrase}" → "${translation}"`);
            if (matches.length >= 3) break outer;
          }
        }
      }
    }
  }

  return matches.length ? matches.join("\n") : "";
}

function trim(text: string, chars: number): string {
  if (!text || text.length <= chars) return text;
  return text.slice(0, chars).trimEnd() + "…";
}

function section(label: string, content: string, budget: number): string {
  const trimmed = trim(content, budget);
  if (!trimmed) return "";
  return `[${label}]\n${trimmed}\n`;
}

// ── Translation profile ──────────────────────────────────────────────────────
// Four parallel lanes:
//   Obsidian (25%)      — behavioral vault: user preferences, style, consent
//   OSINT (25%)         — open-source intelligence: public knowledge brain
//   VectorMemory (35%)  — semantic embedding search: similar past translations
//   GraphKnowledge (15%)— Neo4j + Wikidata + cultural knowledge graph

async function runTranslationRecall(q: RecallQuery): Promise<OrchestratedRecall> {
  const t0 = Date.now();
  const queried: string[] = [];
  const hit: string[] = [];
  const w = WEIGHTS.translation;

  // Obsidian — synchronous, always runs first (zero network cost)
  queried.push("obsidian");
  const recall = recallForTranslation(q.text, q.sourceLang, q.targetLang);
  const obsidianRaw = buildRecallPromptContext(recall);
  if (obsidianRaw) hit.push("obsidian");

  // Three async lanes in parallel
  const [osintResult, vectorResult, graphResult] = await Promise.allSettled([
    (async () => {
      queried.push("osint");
      return await getOsintContext(q.text, 2);
    })(),
    (async () => {
      queried.push("vector-memory");
      if (!isVectorReady()) return "";
      const matches = await searchSimilarTranslations(
        q.text, q.sourceLang, q.targetLang, 3, undefined, q.roomCode,
      );
      if (!matches?.length) return "";
      return matches
        .map((m: any) => `"${m.sourceText}" → "${m.translatedText}"`)
        .join("\n");
    })(),
    (async () => {
      queried.push("graph-knowledge");
      return await getGraphContext(q.text, 2);
    })(),
  ]);

  const osintRaw  = osintResult.status  === "fulfilled" ? osintResult.value  : "";
  const vectorRaw = vectorResult.status === "fulfilled" ? vectorResult.value : "";
  const graphRaw  = graphResult.status  === "fulfilled" ? graphResult.value  : "";

  if (osintRaw)  hit.push("osint");
  if (vectorRaw) hit.push("vector-memory");
  if (graphRaw)  hit.push("graph-knowledge");

  const parts = [
    section("Obsidian",       obsidianRaw, Math.floor(CONTEXT_BUDGET * w.obsidian)),
    section("OSINT",          osintRaw,    Math.floor(CONTEXT_BUDGET * w.osint)),
    section("VectorMemory",   vectorRaw,   Math.floor(CONTEXT_BUDGET * w.vector)),
    section("GraphKnowledge", graphRaw,    Math.floor(CONTEXT_BUDGET * w.graph)),
  ].filter(Boolean);

  return {
    profile: "translation",
    context: parts.join("\n"),
    systemsQueried: queried,
    systemsHit: hit,
    durationMs: Date.now() - t0,
  };
}

// ── Juno profile ─────────────────────────────────────────────────────────────
// Four parallel lanes:
//   Obsidian (20%)       — behavioral vault: personality grounding, safety framing
//   OSINT (20%)          — open-source intelligence: public knowledge for enrichment
//   VectorMemory (25%)   — past conversation embeddings: semantic memory
//   GraphKnowledge (35%) — Neo4j + Wikidata + juno-knowledge: factual foundation

async function runJunoRecall(q: RecallQuery): Promise<OrchestratedRecall> {
  const t0 = Date.now();
  const queried: string[] = [];
  const hit: string[] = [];
  const w = WEIGHTS.juno;

  // Obsidian — synchronous, always runs first
  queried.push("obsidian");
  const obsidianRaw = getUserBehaviorContext();
  if (obsidianRaw) hit.push("obsidian");

  // Three async lanes in parallel
  const [osintResult, vectorResult, graphResult] = await Promise.allSettled([
    (async () => {
      queried.push("osint");
      return await getOsintContext(q.text, 2);
    })(),
    (async () => {
      queried.push("vector-memory");
      if (!isVectorReady()) return "";
      const matches = await searchSimilarConversations(
        q.text, q.userId || "anon", q.roomCode, undefined, 3,
      );
      if (!matches?.length) return "";
      return matches
        .map((m: any) => `${m.contentType === "message" ? "User" : "Juno"}: ${m.content}`)
        .join("\n");
    })(),
    (async () => {
      queried.push("graph-knowledge");
      // Juno-knowledge (platform Q&A) + graph facts merged into one lane
      const [junoRaw, graphRaw] = await Promise.all([
        (async () => {
          queried.push("juno-knowledge");
          const result = answerQuestion(q.text);
          if (!result?.answer) return "";
          return `${result.answer} (confidence: ${Math.round(result.confidence * 100)}%, source: ${result.source})`;
        })(),
        getGraphContext(q.text, 2),
      ]);
      return [junoRaw, graphRaw].filter(Boolean).join("\n");
    })(),
  ]);

  const osintRaw  = osintResult.status  === "fulfilled" ? osintResult.value  : "";
  const vectorRaw = vectorResult.status === "fulfilled" ? vectorResult.value : "";
  const graphRaw  = graphResult.status  === "fulfilled" ? graphResult.value  : "";

  if (osintRaw)  hit.push("osint");
  if (vectorRaw) hit.push("vector-memory");
  if (graphRaw)  hit.push("graph-knowledge");

  const parts = [
    section("Obsidian",       obsidianRaw, Math.floor(CONTEXT_BUDGET * w.obsidian)),
    section("OSINT",          osintRaw,    Math.floor(CONTEXT_BUDGET * w.osint)),
    section("VectorMemory",   vectorRaw,   Math.floor(CONTEXT_BUDGET * w.vector)),
    section("GraphKnowledge", graphRaw,    Math.floor(CONTEXT_BUDGET * w.graph)),
  ].filter(Boolean);

  return {
    profile: "juno",
    context: parts.join("\n"),
    systemsQueried: queried,
    systemsHit: hit,
    durationMs: Date.now() - t0,
  };
}

// ── Vision profile ───────────────────────────────────────────────────────────
// System 5 (100%): static vision lookup — no other system is relevant here.
// Vision responses are composed by vision-knowledge directly; this profile
// exists so the orchestrator is the sole recall entry point for all code paths.

async function runVisionRecall(_q: RecallQuery): Promise<OrchestratedRecall> {
  return {
    profile: "vision",
    context: "",
    systemsQueried: ["vision-knowledge"],
    systemsHit: ["vision-knowledge"],
    durationMs: 0,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Route a recall query through the appropriate profile.
 * Always resolves — individual system failures are caught and logged without
 * crashing the caller.
 */
export async function orchestrateRecall(
  query: RecallQuery,
  profile: RecallProfile,
): Promise<OrchestratedRecall> {
  _totalRecallRequests++;

  let result: OrchestratedRecall | null = null;
  try {
    switch (profile) {
      case "translation": result = await runTranslationRecall(query); break;
      case "juno":        result = await runJunoRecall(query);        break;
      case "vision":      result = await runVisionRecall(query);      break;
    }
  } catch (err) {
    console.error(`[RecallOrchestrator] ${profile} recall failed:`, err);
  }

  if (!result) {
    result = { profile, context: "", systemsQueried: [], systemsHit: [], durationMs: 0 };
  }

  // GitHub safety net — fires only when all primary systems returned empty.
  // Keeps GitHub as a backup, never the lead.
  if (!result.context) {
    const ghRaw = tryGithubFallback(query, profile);
    if (ghRaw) {
      _githubFallbackHits++;
      result.context = `[Recall: github-fallback]\n${trim(ghRaw, 400)}\n`;
      result.systemsQueried.push("github-fallback");
      result.systemsHit.push("github-fallback");

      const load = getGithubFallbackLoad();
      if (!load.healthy) {
        console.warn(
          `[RecallOrchestrator] GitHub fallback load ${(load.loadRatio * 100).toFixed(1)}% ` +
          `exceeds ${GITHUB_LOAD_WARN_THRESHOLD * 100}% threshold — ` +
          `primary recall systems may be degraded (${load.githubFallbackHits}/${load.total} requests).`
        );
      }
    }
  }

  return result;
}

/** Diagnostic snapshot — safe to expose via an admin endpoint. */
export function getOrchestratorConfig() {
  return {
    profiles: Object.keys(WEIGHTS),
    weights: WEIGHTS,
    contextBudget: CONTEXT_BUDGET,
    lanes: [
      {
        name: "Obsidian",
        role: "Behavioral vault — user preferences, consent, style, intent signals",
        source: "agent-recall (getUserBehaviorContext / recallForTranslation)",
        profiles: ["translation", "juno"],
        execution: "synchronous",
      },
      {
        name: "OSINT",
        role: "Open-source intelligence — public knowledge brain (osint layer)",
        source: "knowledge-sync → lasawno/Knowledge-Base-Integration/osint/",
        profiles: ["translation", "juno"],
        execution: "async-parallel",
      },
      {
        name: "VectorMemory",
        role: "Semantic embedding search — similar past translations / conversations",
        source: "embedding-service (pgvector similarity search)",
        profiles: ["translation", "juno"],
        execution: "async-parallel",
      },
      {
        name: "GraphKnowledge",
        role: "Factual knowledge graph — Neo4j + Wikidata + cultural + juno-knowledge",
        source: "knowledge-sync (neo4j/wikidata/culture layers) + juno-knowledge",
        profiles: ["translation", "juno"],
        execution: "async-parallel",
      },
      {
        name: "Vision",
        role: "Visual identification — static vision lookup",
        source: "vision-knowledge",
        profiles: ["vision"],
        execution: "passthrough",
      },
      {
        name: "GitHubFallback",
        role: "Safety net — GitHub CDN phrase cache (fires only when all lanes miss)",
        source: "translation-fallback (githubFallbackCache)",
        profiles: ["translation", "juno"],
        execution: "sync-conditional",
      },
    ],
    githubFallback: {
      ...getGithubFallbackLoad(),
      threshold: GITHUB_LOAD_WARN_THRESHOLD,
    },
  };
}
