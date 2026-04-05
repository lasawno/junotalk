/**
 * Juno Open-Source Learner — Autonomous Knowledge Acquisition
 *
 * Runs on a 24-hour cycle. Pulls from public GitHub repos where people
 * have compiled real factual knowledge using ChatGPT, Perplexity AI,
 * and other AI tools — then stores what it learns in Juno's KB and
 * vector memory so Juno recalls it in future conversations.
 *
 * Sources mined:
 *   • f/awesome-chatgpt-prompts        — real ChatGPT usage patterns
 *   • dair-ai/Prompt-Engineering-Guide — AI reasoning techniques (factual)
 *   • openai/openai-cookbook           — practical AI knowledge
 *   • ItzCrazyKns/Perplexica           — Perplexity-style search patterns
 *   • anthropics/anthropic-cookbook    — Claude AI techniques
 *   • brexhq/prompt-engineering        — real-world AI prompt patterns
 *   • trimstray/the-book-of-secret-knowledge — factual tech knowledge base
 *
 * Storage:
 *   • Knowledge-Base-Integration repo  (domain/ai-learnings-<date>.json)
 *   • Vector DB via EmbeddingService   (semantic recall during chat)
 *   • Redis                            (dedup + last-synced tracking)
 */

import { gatewayRequest } from "./ai-gateway";
import { storeConversationEmbedding } from "./embedding-service";
import { redisGet, redisSet, isRedisAvailable } from "./redis-cache";
import { ReplitConnectors } from "@replit/connectors-sdk";

const KB_REPO   = "lasawno/Knowledge-Base-Integration";
const KB_BRANCH = "main";
const LEARNER_USER_ID = "juno-autonomous-learner";
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REDIS_PREFIX = "juno:learner:synced:";

// ── Learning sources ──────────────────────────────────────────────────────────
// All public repos — raw content fetched directly, no auth required.

interface LearningSource {
  id: string;
  repo: string;
  file: string;
  category: string;
  topic: string;
}

const LEARNING_SOURCES: LearningSource[] = [
  {
    id: "awesome-chatgpt-prompts",
    repo: "f/awesome-chatgpt-prompts",
    file: "README.md",
    category: "conversation_patterns",
    topic: "ChatGPT prompting strategies and real-world use cases",
  },
  {
    id: "prompt-engineering-guide",
    repo: "dair-ai/Prompt-Engineering-Guide",
    file: "README.md",
    category: "reasoning_techniques",
    topic: "AI reasoning techniques, chain-of-thought, factual AI knowledge",
  },
  {
    id: "openai-cookbook",
    repo: "openai/openai-cookbook",
    file: "README.md",
    category: "domain",
    topic: "Practical OpenAI and ChatGPT usage patterns, real use cases",
  },
  {
    id: "perplexica",
    repo: "ItzCrazyKns/Perplexica",
    file: "README.md",
    category: "domain",
    topic: "Perplexity AI search methodology, answer synthesis patterns",
  },
  {
    id: "anthropic-cookbook",
    repo: "anthropics/anthropic-cookbook",
    file: "README.md",
    category: "reasoning_techniques",
    topic: "Claude AI reasoning patterns and factual response techniques",
  },
  {
    id: "brex-prompt-engineering",
    repo: "brexhq/prompt-engineering",
    file: "README.md",
    category: "conversation_patterns",
    topic: "Real-world prompt engineering patterns used by engineers",
  },
  {
    id: "secret-knowledge",
    repo: "trimstray/the-book-of-secret-knowledge",
    file: "README.md",
    category: "domain",
    topic: "Curated factual technical knowledge compiled by the community",
  },
];

// ── Fetch raw content from GitHub ─────────────────────────────────────────────

async function fetchRawContent(repo: string, file: string): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${repo}/main/${file}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (resp.ok) {
      const text = await resp.text();
      return text.slice(0, 12000); // cap at 12k chars per source
    }
    // Try master branch
    const url2 = `https://raw.githubusercontent.com/${repo}/master/${file}`;
    const resp2 = await fetch(url2, { signal: AbortSignal.timeout(12000) });
    if (resp2.ok) return (await resp2.text()).slice(0, 12000);
    return null;
  } catch {
    return null;
  }
}

// ── LLM extraction ────────────────────────────────────────────────────────────
// Sends raw content to the LLM, asks it to extract 5–10 high-quality
// knowledge entries as structured JSON.

interface ExtractedEntry {
  question: string;
  answer: string;
  tags: string[];
}

async function extractKnowledge(
  rawContent: string,
  topic: string,
  category: string
): Promise<ExtractedEntry[]> {
  const prompt = `You are Juno's knowledge extraction agent. Read the content below and extract 6-8 high-quality factual Q&A entries that Juno can recall during real conversations.

Topic: ${topic}
Category: ${category}

Rules:
- Each entry must be factually accurate and self-contained
- Do NOT reference "this document", "the above", or "as mentioned"
- Cover the most important, useful concepts in the content

Return ONLY a valid JSON array — no markdown, no extra text:
[{"question":"...","answer":"...","tags":["tag1","tag2"]},...]

Content to extract from:
${rawContent.slice(0, 7000)}`;

  try {
    const result = await gatewayRequest({
      task: "background",
      prompt,
      temperature: 0.3,
      maxTokens: 700,
    });

    const raw = (result.text || "").trim();
    const arrayMatch = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: any) => e?.question && e?.answer && typeof e.question === "string"
    );
  } catch {
    return [];
  }
}

// ── KB repo writer ─────────────────────────────────────────────────────────────

async function pushToKBRepo(
  filePath: string,
  data: unknown,
  commitMessage: string
): Promise<boolean> {
  try {
    const connectors = new ReplitConnectors();
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

    let sha: string | undefined;
    const getResp = await connectors.proxy("github", `/repos/${KB_REPO}/contents/${filePath}?ref=${KB_BRANCH}`, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (getResp.ok) {
      const meta = await getResp.json() as { sha?: string };
      if (meta.sha) sha = meta.sha;
    }

    const body: Record<string, unknown> = { message: commitMessage, content, branch: KB_BRANCH };
    if (sha) body.sha = sha;

    const putResp = await connectors.proxy("github", `/repos/${KB_REPO}/contents/${filePath}`, {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return putResp.ok;
  } catch {
    return false;
  }
}

// ── Dedup check ───────────────────────────────────────────────────────────────

async function wasLearnedToday(sourceId: string): Promise<boolean> {
  if (!isRedisAvailable()) return false;
  const today = new Date().toISOString().slice(0, 10);
  const key   = `${REDIS_PREFIX}${sourceId}:${today}`;
  const val   = await redisGet(key);
  return val === "1";
}

async function markLearned(sourceId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const today = new Date().toISOString().slice(0, 10);
  const key   = `${REDIS_PREFIX}${sourceId}:${today}`;
  await redisSet(key, "1", 25 * 60 * 60); // 25h TTL
}

// ── Core learning loop ────────────────────────────────────────────────────────

async function learnFromSource(source: LearningSource): Promise<number> {
  const already = await wasLearnedToday(source.id);
  if (already) {
    console.log(`[OpenSourceLearner] ${source.id} — already learned today, skipping`);
    return 0;
  }

  console.log(`[OpenSourceLearner] Fetching ${source.repo}/${source.file}...`);
  const raw = await fetchRawContent(source.repo, source.file);
  if (!raw) {
    console.log(`[OpenSourceLearner] ${source.id} — content unavailable`);
    return 0;
  }

  const entries = await extractKnowledge(raw, source.topic, source.category);
  if (!entries.length) {
    console.log(`[OpenSourceLearner] ${source.id} — no entries extracted`);
    return 0;
  }

  const today = new Date().toISOString().slice(0, 10);
  const kbPayload = {
    source: source.id,
    repo: source.repo,
    category: source.category,
    topic: source.topic,
    learnedAt: new Date().toISOString(),
    entries: entries.map(e => ({
      q: e.question,
      a: e.answer,
      category: source.category,
      tags: e.tags || [],
      source: source.repo,
      confidence: 0.82,
    })),
  };

  // 1. Push to KB repo for persistent storage
  const filePath = `domain/ai-learnings-${source.id}-${today}.json`;
  const pushed = await pushToKBRepo(
    filePath,
    kbPayload,
    `[Juno Learner] ${source.id} — ${entries.length} entries (${today})`
  );
  if (pushed) {
    console.log(`[OpenSourceLearner] ${source.id} — pushed ${entries.length} entries to KB repo`);
  }

  // 2. Store each entry in vector DB for semantic recall
  let vectorized = 0;
  for (const e of entries) {
    const content = `Q: ${e.question}\nA: ${e.answer}`;
    const ok = await storeConversationEmbedding(
      content,
      LEARNER_USER_ID,
      "knowledge",
      undefined,
      { source: source.repo, category: source.category, tags: e.tags, learnedAt: today }
    );
    if (ok) vectorized++;
  }

  console.log(
    `[OpenSourceLearner] ${source.id} — ${vectorized}/${entries.length} entries in vector DB`
  );

  await markLearned(source.id);
  return entries.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runLearningCycle(): Promise<void> {
  console.log(`[OpenSourceLearner] Starting learning cycle — ${LEARNING_SOURCES.length} sources`);
  let totalLearned = 0;

  for (const source of LEARNING_SOURCES) {
    try {
      const n = await learnFromSource(source);
      totalLearned += n;
      // Small delay between sources to avoid hammering GitHub
      await new Promise(r => setTimeout(r, 2500));
    } catch (err: any) {
      console.log(`[OpenSourceLearner] ${source.id} failed:`, err?.message || err);
    }
  }

  console.log(`[OpenSourceLearner] Cycle complete — ${totalLearned} total entries learned`);
}

/** Start the 24-hour autonomous learning scheduler */
export function startAutonomousLearner(): void {
  console.log("[OpenSourceLearner] Autonomous scheduler started — first cycle in 2 minutes");

  // First run: delay 2 minutes after startup (let everything else init first)
  setTimeout(async () => {
    await runLearningCycle().catch(err =>
      console.log("[OpenSourceLearner] Cycle error:", err?.message || err)
    );
  }, 2 * 60 * 1000);

  // Then repeat every 24 hours
  setInterval(async () => {
    await runLearningCycle().catch(err =>
      console.log("[OpenSourceLearner] Cycle error:", err?.message || err)
    );
  }, INTERVAL_MS);
}
