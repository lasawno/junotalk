/**
 * Juno Knowledge Brain — Orchestrator + Sync
 *
 * Pulls from lasawno/Knowledge-Base-Integration (OSINT, Neo4j, Wikidata folders)
 * and routes each query through all 4 layers in priority order:
 *   vector → neo4j → wikidata → osint
 *
 * Reasoning: keyword pre-filter (fast) → OpenRouter synthesis (smart).
 * Falls back to keyword-only if OpenRouter is unavailable.
 * Brain config is read from brain/config.json in the repo.
 */

import OpenAI from "openai";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { apiKeys } from "./api-keys";
import { pushPrivateFile } from "./github-config";
import { gatewayRequest } from "./ai-gateway";

const KB_REPO   = "lasawno/Knowledge-Base-Integration";
const KB_BRANCH = "main";

// ─── OpenRouter client ────────────────────────────────────────────────────────

function getOpenRouterClient(): OpenAI | null {
  const apiKey  = apiKeys.openrouter();
  const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  q: string;
  a: string;
  category: string;
  tags: string[];
  source?: string;
  confidence?: number;
}

interface StoredEntry extends KnowledgeEntry {
  sourceLayer: "osint" | "neo4j" | "wikidata" | "culture" | "user-context" | "domain"
    | "phrases" | "languages" | "intents" | "personas" | "regulations" | "entities";
}

// ─── Brain configuration (loaded from repo) ───────────────────────────────────

interface BrainConfig {
  priority_order: string[];
  memory: { short_term_cache: boolean; cache_ttl_seconds: number };
  reasoning: { max_context_chunks: number };
  sources: {
    osint: boolean; neo4j: boolean; wikidata: boolean; vector: boolean; culture: boolean;
    "user-context": boolean; domain: boolean;
    phrases: boolean; languages: boolean; intents: boolean;
    personas: boolean; regulations: boolean; entities: boolean;
  };
}

interface VectorConfig {
  min_score_threshold: number;
  top_k: number;
  hybrid_search: { enabled: boolean; keyword_weight: number; semantic_weight: number };
}

const DEFAULT_BRAIN: BrainConfig = {
  priority_order: [
    "intents", "personas", "domain", "entities",
    "phrases", "languages", "regulations",
    "vector", "neo4j", "wikidata", "culture", "user-context", "osint",
  ],
  memory: { short_term_cache: true, cache_ttl_seconds: 300 },
  reasoning: { max_context_chunks: 10 },
  sources: {
    osint: true, neo4j: true, wikidata: true, vector: true, culture: true,
    "user-context": true, domain: true,
    phrases: true, languages: true, intents: true,
    personas: true, regulations: true, entities: true,
  },
};

const DEFAULT_VECTOR: VectorConfig = {
  min_score_threshold: 0.72,
  top_k: 6,
  hybrid_search: { enabled: true, keyword_weight: 0.35, semantic_weight: 0.65 },
};

let brainConfig: BrainConfig = DEFAULT_BRAIN;
let vectorConfig: VectorConfig = DEFAULT_VECTOR;

// ─── Raw repo formats ─────────────────────────────────────────────────────────

interface OsintFact {
  topic?: string; question?: string; q?: string;
  fact?: string; answer?: string; a?: string;
  category?: string; tags?: string[]; confidence?: number;
}

interface Neo4jFact {
  subject?: string; entity?: string; label?: string;
  predicate?: string; relation?: string; object?: string;
  description?: string; category?: string; tags?: string[];
}

interface WikidataFact {
  label?: string; title?: string;
  description?: string; summary?: string;
  instanceOf?: string; category?: string; tags?: string[];
  claims?: Record<string, string>;
}

// ─── Normalisers ─────────────────────────────────────────────────────────────

function normaliseOsint(raw: OsintFact[]): StoredEntry[] {
  return raw.flatMap(f => {
    const q = f.q || f.question || f.topic;
    const a = f.a || f.answer || f.fact;
    if (!q || !a) return [];
    return [{ q, a, category: f.category || "osint", tags: f.tags || [], source: "osint", confidence: f.confidence ?? 0.85, sourceLayer: "osint" as const }];
  });
}

function normaliseNeo4j(raw: Neo4jFact[]): StoredEntry[] {
  return raw.flatMap(f => {
    const subject = f.subject || f.entity || f.label;
    const relation = f.predicate || f.relation;
    const object = f.object || f.description;
    if (!subject || !object) return [];
    const q = relation ? `What is the relationship between ${subject} and ${relation}?` : `What is ${subject}?`;
    const a = relation ? `${subject} ${relation} ${object}.` : object;
    return [{ q, a, category: f.category || "knowledge_graph", tags: f.tags || [subject.toLowerCase()], source: "neo4j", confidence: 0.8, sourceLayer: "neo4j" as const }];
  });
}

function normaliseWikidata(raw: WikidataFact[]): StoredEntry[] {
  return raw.flatMap(f => {
    const label = f.label || f.title;
    const description = f.description || f.summary;
    if (!label || !description) return [];
    const entries: StoredEntry[] = [
      { q: `What is ${label}?`, a: description, category: f.category || f.instanceOf || "wikidata", tags: f.tags || [label.toLowerCase()], source: "wikidata", confidence: 0.9, sourceLayer: "wikidata" as const },
    ];
    if (f.claims) {
      for (const [prop, value] of Object.entries(f.claims)) {
        entries.push({ q: `What is the ${prop} of ${label}?`, a: `The ${prop} of ${label} is ${value}.`, category: f.category || "wikidata", tags: [label.toLowerCase(), prop.toLowerCase()], source: "wikidata", confidence: 0.85, sourceLayer: "wikidata" as const });
      }
    }
    return entries;
  });
}

interface CultureFact {
  topic: string;
  country?: string;
  region?: string;
  description: string;
  customs?: string[];
  food?: string[];
  festivals?: string[];
  greetings?: Record<string, string>;
  tags?: string[];
}

function normaliseCulture(raw: CultureFact[]): StoredEntry[] {
  return raw.flatMap(f => {
    if (!f.topic || !f.description) return [];
    const entries: StoredEntry[] = [
      {
        q: `What is ${f.topic}?`,
        a: f.description,
        category: "culture",
        tags: [f.topic.toLowerCase(), ...(f.country ? [f.country.toLowerCase()] : []), ...(f.tags || [])],
        source: "culture",
        confidence: 0.92,
        sourceLayer: "culture" as const,
      },
    ];
    if (f.customs?.length) {
      entries.push({ q: `What are the customs of ${f.topic}?`, a: `Customs include: ${f.customs.join("; ")}.`, category: "culture", tags: [f.topic.toLowerCase(), "customs"], source: "culture", confidence: 0.88, sourceLayer: "culture" as const });
    }
    if (f.food?.length) {
      entries.push({ q: `What foods are associated with ${f.topic}?`, a: `Traditional foods include: ${f.food.join(", ")}.`, category: "culture", tags: [f.topic.toLowerCase(), "food"], source: "culture", confidence: 0.88, sourceLayer: "culture" as const });
    }
    if (f.festivals?.length) {
      entries.push({ q: `What festivals are celebrated in ${f.topic}?`, a: `Notable festivals: ${f.festivals.join(", ")}.`, category: "culture", tags: [f.topic.toLowerCase(), "festivals"], source: "culture", confidence: 0.88, sourceLayer: "culture" as const });
    }
    if (f.greetings) {
      const greetingLines = Object.entries(f.greetings).map(([lang, phrase]) => `${lang}: "${phrase}"`).join(", ");
      entries.push({ q: `How do you greet someone in ${f.topic}?`, a: `Common greetings — ${greetingLines}.`, category: "culture", tags: [f.topic.toLowerCase(), "greetings", "language"], source: "culture", confidence: 0.9, sourceLayer: "culture" as const });
    }
    return entries;
  });
}

// ─── New source: User context ─────────────────────────────────────────────────
// user-context/ folder — common user intents, conversation patterns, and
// preferences observed across JunoTalk sessions.  Helps Juno personalise
// responses and anticipate what users are really asking.

interface UserContextEntry {
  pattern?: string; intent?: string; question?: string;
  response_hint?: string; suggestion?: string; answer?: string;
  lang?: string; region?: string;
  frequency?: "high" | "medium" | "low";
  tags?: string[]; category?: string;
}

function normaliseUserContext(raw: UserContextEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const pattern = f.pattern || f.intent || f.question;
    const hint    = f.response_hint || f.suggestion || f.answer;
    if (!pattern || !hint) return [];
    const freqBoost: Record<string, number> = { high: 0.95, medium: 0.88, low: 0.80 };
    return [{
      q: pattern,
      a: hint,
      category: f.category || "user-context",
      tags: [...(f.tags || []), ...(f.lang ? [f.lang] : []), ...(f.region ? [f.region.toLowerCase()] : [])],
      source: "user-context",
      confidence: freqBoost[f.frequency || "medium"],
      sourceLayer: "user-context" as const,
    }];
  });
}

// ─── New source: Domain expertise ────────────────────────────────────────────
// domain/ folder — deep specialist knowledge (medical, legal, business,
// travel, technology).  Gives Juno accurate vocabulary and context in
// professional or technical conversations.

interface DomainEntry {
  domain?: string; field?: string;
  term?: string; topic?: string; concept?: string;
  definition?: string; explanation?: string; description?: string;
  examples?: string[]; usage?: string;
  languages?: string[]; synonyms?: string[];
  tags?: string[]; category?: string; confidence?: number;
}

function normaliseDomain(raw: DomainEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const term       = f.term || f.topic || f.concept;
    const definition = f.definition || f.explanation || f.description;
    if (!term || !definition) return [];
    const domain = f.domain || f.field || "general";
    const entries: StoredEntry[] = [{
      q: `What does "${term}" mean in ${domain}?`,
      a: definition,
      category: f.category || domain,
      tags: [
        term.toLowerCase(), domain.toLowerCase(),
        ...(f.tags || []),
        ...(f.synonyms || []).map(s => s.toLowerCase()),
      ],
      source: "domain",
      confidence: f.confidence ?? 0.93,
      sourceLayer: "domain" as const,
    }];
    if (f.usage) {
      entries.push({
        q: `How is "${term}" used in ${domain}?`,
        a: f.usage,
        category: f.category || domain,
        tags: [term.toLowerCase(), domain.toLowerCase(), "usage"],
        source: "domain",
        confidence: 0.88,
        sourceLayer: "domain" as const,
      });
    }
    if (f.examples?.length) {
      entries.push({
        q: `Give an example of "${term}" in ${domain}.`,
        a: f.examples.join(" / "),
        category: f.category || domain,
        tags: [term.toLowerCase(), domain.toLowerCase(), "example"],
        source: "domain",
        confidence: 0.85,
        sourceLayer: "domain" as const,
      });
    }
    return entries;
  });
}

// ─── New source: Phrases ─────────────────────────────────────────────────────
// phrases/ folder — multilingual phrase pairs with context, formality level,
// and language codes. Gives Juno a consistent reference for common expressions
// instead of re-computing the same translations each time.

interface PhraseEntry {
  source?: string; text?: string; phrase?: string;
  target?: string; translation?: string;
  source_lang?: string; from?: string;
  target_lang?: string; to?: string;
  context?: string; usage?: string;
  formality?: string;
  tags?: string[];
}

function normalisePhrase(raw: PhraseEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const src    = f.source || f.text || f.phrase;
    const tgt    = f.target || f.translation;
    const srcL   = f.source_lang || f.from || "unknown";
    const tgtL   = f.target_lang || f.to || "unknown";
    if (!src || !tgt) return [];
    const formalityNote = f.formality ? ` (${f.formality})` : "";
    const contextNote   = f.context   ? ` — ${f.context}`   : "";
    return [{
      q: `How do you say "${src}" in ${tgtL}?`,
      a: `"${tgt}"${formalityNote}${contextNote}`,
      category: "phrases",
      tags: [srcL.toLowerCase(), tgtL.toLowerCase(), ...(f.tags || [])],
      source: "phrases",
      confidence: 0.93,
      sourceLayer: "phrases" as const,
    }];
  });
}

// ─── New source: Languages ───────────────────────────────────────────────────
// languages/ folder — grammar rules, regional variants, formality levels,
// writing direction, and common translation pitfalls per language.

interface LanguageEntry {
  language?: string; name?: string;
  code?: string; iso?: string;
  variants?: string[];
  formality_levels?: string[];
  writing_direction?: string;
  notes?: string; description?: string;
  common_mistakes?: string[];
  tags?: string[];
}

function normaliseLanguage(raw: LanguageEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const lang  = f.language || f.name;
    const notes = f.notes || f.description;
    if (!lang || !notes) return [];
    const entries: StoredEntry[] = [{
      q: `What should I know about the ${lang} language?`,
      a: notes,
      category: "languages",
      tags: [lang.toLowerCase(), ...(f.code ? [f.code.toLowerCase()] : []), ...(f.tags || [])],
      source: "languages",
      confidence: 0.92,
      sourceLayer: "languages" as const,
    }];
    if (f.variants?.length) {
      entries.push({ q: `What are the regional variants of ${lang}?`, a: f.variants.join(", "), category: "languages", tags: [lang.toLowerCase(), "variants"], source: "languages", confidence: 0.88, sourceLayer: "languages" as const });
    }
    if (f.common_mistakes?.length) {
      entries.push({ q: `What are common mistakes when translating ${lang}?`, a: f.common_mistakes.join("; "), category: "languages", tags: [lang.toLowerCase(), "mistakes", "tips"], source: "languages", confidence: 0.87, sourceLayer: "languages" as const });
    }
    return entries;
  });
}

// ─── New source: Intents ─────────────────────────────────────────────────────
// intents/ folder — user intent patterns with trigger phrases and response
// hints. Helps Juno recognise what the user wants before choosing how to reply.

interface IntentEntry {
  intent?: string; name?: string;
  patterns?: string[]; triggers?: string[];
  response_hint?: string; guidance?: string;
  priority?: string;
  tags?: string[];
}

function normaliseIntent(raw: IntentEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const intent  = f.intent || f.name;
    const hint    = f.response_hint || f.guidance;
    if (!intent || !hint) return [];
    const patternNote = f.patterns?.length ? `Triggered by phrases like: "${f.patterns.slice(0, 3).join('", "')}". ` : "";
    const priorityBoost: Record<string, number> = { high: 0.96, medium: 0.90, low: 0.82 };
    return [{
      q: `How should Juno handle the "${intent}" intent?`,
      a: `${patternNote}${hint}`,
      category: "intents",
      tags: [intent.toLowerCase(), ...(f.tags || [])],
      source: "intents",
      confidence: priorityBoost[f.priority || "medium"],
      sourceLayer: "intents" as const,
    }];
  });
}

// ─── New source: Personas ────────────────────────────────────────────────────
// personas/ folder — Juno's tone and behavioural configs per context.
// Tells Juno how to communicate in different situations without code changes.

interface PersonaEntry {
  persona?: string; name?: string;
  tone?: string;
  description?: string; summary?: string;
  traits?: string[];
  avoid?: string[];
  greeting_style?: string;
  tags?: string[];
}

function normalisePersona(raw: PersonaEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const name = f.persona || f.name;
    const desc = f.description || f.summary;
    if (!name || !desc) return [];
    const entries: StoredEntry[] = [{
      q: `How should Juno behave in the "${name}" persona?`,
      a: `Tone: ${f.tone || "neutral"}. ${desc}${f.traits?.length ? ` Key traits: ${f.traits.join(", ")}.` : ""}`,
      category: "personas",
      tags: [name.toLowerCase(), ...(f.tags || [])],
      source: "personas",
      confidence: 0.94,
      sourceLayer: "personas" as const,
    }];
    if (f.avoid?.length) {
      entries.push({ q: `What should Juno avoid in the "${name}" persona?`, a: f.avoid.join("; "), category: "personas", tags: [name.toLowerCase(), "avoid"], source: "personas", confidence: 0.90, sourceLayer: "personas" as const });
    }
    return entries;
  });
}

// ─── New source: Regulations ─────────────────────────────────────────────────
// regulations/ folder — privacy laws, recording consent rules, and compliance
// requirements by region. Lets Juno give legally-informed answers about data
// and call recording without guessing.

interface RegulationEntry {
  regulation?: string; name?: string; law?: string;
  full_name?: string;
  region?: string; country?: string;
  applies_to?: string[];
  key_rules?: string[];
  relevance_to_junotalk?: string; summary?: string;
  tags?: string[];
}

function normaliseRegulation(raw: RegulationEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const name    = f.regulation || f.name || f.law;
    const region  = f.region || f.country || "Global";
    const rules   = f.key_rules || [];
    const summary = f.relevance_to_junotalk || f.summary;
    if (!name || (!rules.length && !summary)) return [];
    const entries: StoredEntry[] = [{
      q: `What is ${name}${region !== "Global" ? ` in ${region}` : ""}?`,
      a: `${f.full_name ? f.full_name + ". " : ""}${summary || rules[0] || ""}`,
      category: "regulations",
      tags: [name.toLowerCase(), region.toLowerCase(), ...(f.tags || [])],
      source: "regulations",
      confidence: 0.95,
      sourceLayer: "regulations" as const,
    }];
    if (rules.length) {
      entries.push({ q: `What are the key rules of ${name}?`, a: rules.join(" | "), category: "regulations", tags: [name.toLowerCase(), "rules", "compliance"], source: "regulations", confidence: 0.93, sourceLayer: "regulations" as const });
    }
    if (f.relevance_to_junotalk) {
      entries.push({ q: `How does ${name} affect JunoTalk?`, a: f.relevance_to_junotalk, category: "regulations", tags: [name.toLowerCase(), "junotalk", "compliance"], source: "regulations", confidence: 0.94, sourceLayer: "regulations" as const });
    }
    return entries;
  });
}

// ─── New source: Entities ────────────────────────────────────────────────────
// entities/ folder — named people, places, products, organisations, and
// services that Juno should recognise and know about.

interface EntityEntry {
  name?: string; label?: string;
  type?: string; category?: string;
  description?: string; summary?: string;
  aliases?: string[];
  attributes?: Record<string, string | string[]>;
  tags?: string[];
}

function normaliseEntity(raw: EntityEntry[]): StoredEntry[] {
  return raw.flatMap(f => {
    const name = f.name || f.label;
    const desc = f.description || f.summary;
    if (!name || !desc) return [];
    const entries: StoredEntry[] = [{
      q: `What is ${name}?`,
      a: desc,
      category: f.category || f.type || "entities",
      tags: [
        name.toLowerCase(),
        ...(f.aliases || []).map(a => a.toLowerCase()),
        ...(f.tags || []),
      ],
      source: "entities",
      confidence: 0.93,
      sourceLayer: "entities" as const,
    }];
    if (f.attributes && Object.keys(f.attributes).length) {
      for (const [attr, value] of Object.entries(f.attributes)) {
        const val = Array.isArray(value) ? value.join(", ") : value;
        entries.push({ q: `What is the ${attr} of ${name}?`, a: val, category: f.category || f.type || "entities", tags: [name.toLowerCase(), attr.toLowerCase()], source: "entities", confidence: 0.88, sourceLayer: "entities" as const });
      }
    }
    return entries;
  });
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

let _connectors: ReplitConnectors | null = null;
function getConnectors(): ReplitConnectors {
  if (!_connectors) _connectors = new ReplitConnectors();
  return _connectors;
}

async function fetchRepoFile(filePath: string): Promise<any | null> {
  try {
    const resp = await getConnectors().proxy("github", `/repos/${KB_REPO}/contents/${filePath}?ref=${KB_BRANCH}`, {
      method: "GET", headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      console.warn(`[KnowledgeSync] fetchRepoFile ${filePath}: HTTP ${resp.status}`);
      return null;
    }
    const meta = await resp.json() as { content?: string; encoding?: string };
    if (!meta.content || meta.encoding !== "base64") return null;
    return JSON.parse(Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString("utf-8"));
  } catch (e: any) {
    console.warn(`[KnowledgeSync] fetchRepoFile error: ${e.message}`);
    return null;
  }
}

async function listFolder(folder: string): Promise<string[]> {
  try {
    const resp = await getConnectors().proxy("github", `/repos/${KB_REPO}/contents/${folder}?ref=${KB_BRANCH}`, {
      method: "GET", headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      if (resp.status !== 404) console.warn(`[KnowledgeSync] listFolder ${folder}: HTTP ${resp.status}`);
      return [];
    }
    const items = await resp.json() as { name: string; type: string; path: string }[];
    return items.filter(i => i.type === "file" && i.name.endsWith(".json")).map(i => i.path);
  } catch (e: any) {
    console.warn(`[KnowledgeSync] listFolder error: ${e.message}`);
    return [];
  }
}

// ─── In-memory brain state ────────────────────────────────────────────────────

let brainEntries: StoredEntry[] = [];
let lastSyncTime = 0;
const SYNC_TTL        = 30 * 60 * 1000;   // 30-minute safety-net poll
export interface SyncStats {
  osint: number; neo4j: number; wikidata: number; culture: number;
  "user-context": number; domain: number;
  phrases: number; languages: number; intents: number;
  personas: number; regulations: number; entities: number;
  deduplicated: number; total: number; timestamp: string;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function dedup(entries: StoredEntry[]): StoredEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = `${e.q.toLowerCase().trim()}|||${e.a.toLowerCase().trim().slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncKnowledgeBase(force = false): Promise<SyncStats> {
  if (!force && Date.now() - lastSyncTime < SYNC_TTL && brainEntries.length > 0) {
    return { osint: 0, neo4j: 0, wikidata: 0, culture: 0, "user-context": 0, domain: 0, phrases: 0, languages: 0, intents: 0, personas: 0, regulations: 0, entities: 0, deduplicated: 0, total: brainEntries.length, timestamp: new Date(lastSyncTime).toISOString() };
  }

  const [remoteBrain, remoteVector] = await Promise.all([
    fetchRepoFile("brain/config.json"),
    fetchRepoFile("vector/index_config.json"),
  ]);
  if (remoteBrain) brainConfig = { ...DEFAULT_BRAIN, ...remoteBrain };
  if (remoteVector) vectorConfig = { ...DEFAULT_VECTOR, ...remoteVector };

  const stats: SyncStats = { osint: 0, neo4j: 0, wikidata: 0, culture: 0, "user-context": 0, domain: 0, phrases: 0, languages: 0, intents: 0, personas: 0, regulations: 0, entities: 0, deduplicated: 0, total: 0, timestamp: new Date().toISOString() };
  let raw: StoredEntry[] = [];

  if (brainConfig.sources.osint) {
    try {
      const files = await listFolder("osint");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseOsint(data); raw.push(...n); stats.osint += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] OSINT sync failed:", e.message); }
  }

  if (brainConfig.sources.neo4j) {
    try {
      const files = await listFolder("neo4j");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseNeo4j(data); raw.push(...n); stats.neo4j += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Neo4j sync failed:", e.message); }
  }

  if (brainConfig.sources.wikidata) {
    try {
      const files = await listFolder("wikidata");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseWikidata(data); raw.push(...n); stats.wikidata += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Wikidata sync failed:", e.message); }
  }

  if (brainConfig.sources.culture !== false) {
    try {
      const files = await listFolder("culture");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseCulture(data); raw.push(...n); stats.culture += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Culture sync failed:", e.message); }
  }

  // ── Three new expansion sources ────────────────────────────────────────────

  if (brainConfig.sources["user-context"] !== false) {
    try {
      const files = await listFolder("user-context");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseUserContext(data); raw.push(...n); stats["user-context"] += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] User-context sync failed:", e.message); }
  }

  if (brainConfig.sources.domain !== false) {
    try {
      const files = await listFolder("domain");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseDomain(data); raw.push(...n); stats.domain += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Domain sync failed:", e.message); }
  }

  if (brainConfig.sources.phrases !== false) {
    try {
      const files = await listFolder("phrases");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normalisePhrase(data); raw.push(...n); stats.phrases += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Phrases sync failed:", e.message); }
  }

  if (brainConfig.sources.languages !== false) {
    try {
      const files = await listFolder("languages");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseLanguage(data); raw.push(...n); stats.languages += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Languages sync failed:", e.message); }
  }

  if (brainConfig.sources.intents !== false) {
    try {
      const files = await listFolder("intents");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseIntent(data); raw.push(...n); stats.intents += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Intents sync failed:", e.message); }
  }

  if (brainConfig.sources.personas !== false) {
    try {
      const files = await listFolder("personas");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normalisePersona(data); raw.push(...n); stats.personas += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Personas sync failed:", e.message); }
  }

  if (brainConfig.sources.regulations !== false) {
    try {
      const files = await listFolder("regulations");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseRegulation(data); raw.push(...n); stats.regulations += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Regulations sync failed:", e.message); }
  }

  if (brainConfig.sources.entities !== false) {
    try {
      const files = await listFolder("entities");
      for (const f of files) {
        const data = await fetchRepoFile(f);
        if (Array.isArray(data)) { const n = normaliseEntity(data); raw.push(...n); stats.entities += n.length; }
      }
    } catch (e: any) { console.warn("[KnowledgeSync] Entities sync failed:", e.message); }
  }

  const deduped = dedup(raw);
  stats.deduplicated = raw.length - deduped.length;
  brainEntries = deduped;
  lastSyncTime = Date.now();
  stats.total = brainEntries.length;

  // Push stats to private CDN telemetry — never exposed in server logs
  const reasoning = !!getOpenRouterClient() ? "openrouter" : "keyword-only";
  pushPrivateFile(
    "telemetry/sync-stats.json",
    { ...stats, syncedAt: new Date().toISOString(), reasoning },
    `chore: sync-stats ${new Date().toISOString().slice(0, 10)}`
  ).catch(() => {});

  return stats;
}

// ─── Keyword pre-filter ───────────────────────────────────────────────────────

function scoreEntry(query: string, entry: StoredEntry): number {
  const nq = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const words = nq.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return 0;

  const qField   = entry.q.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const tagField  = entry.tags.join(" ").toLowerCase();
  const catField  = entry.category.toLowerCase();
  const aField   = entry.a.toLowerCase().replace(/[^a-z0-9\s]/g, "").slice(0, 200);

  if (qField.includes(nq)) return 1.0;

  const qMatches   = words.filter(w => qField.includes(w)).length / words.length;
  const tagMatches = words.filter(w => tagField.includes(w) || catField.includes(w)).length / words.length;
  const aMatches   = words.filter(w => aField.includes(w)).length / words.length;

  return qMatches * 0.65 + tagMatches * 0.25 + aMatches * 0.10;
}

// ─── OpenRouter reasoning synthesis ──────────────────────────────────────────

async function synthesiseWithOpenRouter(query: string, candidates: StoredEntry[], maxChunks: number): Promise<string | null> {
  const client = getOpenRouterClient();
  if (!client) return null;

  const candidateText = candidates
    .slice(0, 12)
    .map((e, i) => `[${i + 1}] (${e.sourceLayer.toUpperCase()}) Q: ${e.q} A: ${e.a}`)
    .join("\n");

  const systemPrompt =
    `You are Juno's knowledge reasoning module. Given a user query and a set of candidate knowledge facts, ` +
    `select the most relevant facts (up to ${maxChunks}) and synthesise them into a concise, grounded context block. ` +
    `Output only the synthesised facts as bullet points. Do not add opinions or facts not in the source material.`;

  const userPrompt =
    `USER QUERY: ${query}\n\nCANDIDATE FACTS:\n${candidateText}\n\n` +
    `Select and synthesise the most relevant facts for this query. Return as bullet points only.`;

  try {
    const resp = await client.chat.completions.create({
      model: process.env.AI_INTEGRATIONS_OPENROUTER_MODEL || "google/gemma-3-12b-it:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });

    const text = resp.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return `[Knowledge base — OpenRouter synthesised]\n${text}`;
  } catch (e: any) {
    console.warn("[KnowledgeSync] OpenRouter synthesis failed:", e.message);
    return null;
  }
}

// ─── Orchestrated reasoning context ──────────────────────────────────────────

// ─── Layer-aware context helpers ──────────────────────────────────────────────

/**
 * Internal: filter brainEntries to the given source layers, score, and return
 * synthesised or keyword context. Handles lazy sync automatically.
 */
async function getContextForLayers(
  query: string,
  layers: string[],
  limit: number,
): Promise<string> {
  if (brainEntries.length === 0) await syncKnowledgeBase().catch(() => {});
  if (brainEntries.length === 0) return "";

  const topK = Math.min(limit, vectorConfig.top_k, brainConfig.reasoning.max_context_chunks);
  const filtered = brainEntries.filter(e => layers.includes(e.sourceLayer));
  if (!filtered.length) return "";

  const candidates = filtered
    .map(e => ({ e, score: scoreEntry(query, e) }))
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .map(s => s.e);

  if (!candidates.length) return "";

  const synthesised = await synthesiseWithOpenRouter(query, candidates, topK);
  if (synthesised) return synthesised;

  const top = candidates.slice(0, topK);
  return top.map(e => `- [${e.sourceLayer}] ${e.q}: ${e.a}`).join("\n");
}

/**
 * OSINT lane — open-source intelligence layer only.
 * Returns context from the `osint` source layer in the knowledge brain.
 */
export async function getOsintContext(query: string, limit = 3): Promise<string> {
  return getContextForLayers(query, ["osint"], limit);
}

/**
 * Graph Knowledge lane — Neo4j graph + Wikidata + cultural context.
 * Returns context from the `neo4j`, `wikidata`, and `culture` layers.
 */
export async function getGraphContext(query: string, limit = 3): Promise<string> {
  return getContextForLayers(query, ["neo4j", "wikidata", "culture"], limit);
}

export async function getReasoningContext(query: string, limit = 4): Promise<string> {
  // Lazy sync: populate brain on first call if the bootstrap delay hasn't fired yet
  if (brainEntries.length === 0) await syncKnowledgeBase().catch(() => {});
  if (brainEntries.length === 0) return "";

  const topK = Math.min(limit, vectorConfig.top_k, brainConfig.reasoning.max_context_chunks);
  const priority = brainConfig.priority_order;

  // Step 1 — keyword pre-filter: score every entry
  const scored = brainEntries.map(e => {
    const score = scoreEntry(query, e);
    const layerRank = priority.indexOf(e.sourceLayer);
    const priorityBoost = layerRank >= 0 ? (priority.length - layerRank) / priority.length * 0.08 : 0;
    const confidenceBoost = (e.confidence || 0.8) * 0.05;
    return { e, score: score + priorityBoost + confidenceBoost };
  });

  const candidates = scored
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .map(s => s.e);

  if (candidates.length === 0) return "";

  // Step 2 — OpenRouter synthesis (when available)
  const synthesised = await synthesiseWithOpenRouter(query, candidates, topK);
  if (synthesised) return synthesised;

  // Step 3 — keyword-only fallback
  const top = candidates.slice(0, topK);
  const lines = top.map(e => `- ${e.q}: ${e.a}`).join("\n");
  return `[Knowledge base — ${top.length} relevant facts]\n${lines}`;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getSyncStats() {
  const byLayer: Record<string, number> = { osint: 0, neo4j: 0, wikidata: 0, culture: 0, "user-context": 0, domain: 0, phrases: 0, languages: 0, intents: 0, personas: 0, regulations: 0, entities: 0 };
  for (const e of brainEntries) byLayer[e.sourceLayer] = (byLayer[e.sourceLayer] || 0) + 1;
  return {
    total: brainEntries.length,
    byLayer,
    reasoningProvider: getOpenRouterClient() ? "openrouter" : "keyword-only",
    lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : null,
    nextSync: lastSyncTime ? new Date(lastSyncTime + SYNC_TTL).toISOString() : null,
    repo: KB_REPO,
    brainVersion: (brainConfig as any).version || "1.0.0",
    priorityOrder: brainConfig.priority_order,
    hybridWeights: vectorConfig.hybrid_search,
  };
}

// ─── KB repo writer ───────────────────────────────────────────────────────────
// Writes a JSON file directly into the Knowledge-Base-Integration repo.
// Mirrors the pushPrivateFile pattern but targets KB_REPO instead of the CDN.

// ─── Bootstrap + 30-min refresh ──────────────────────────────────────────────
setTimeout(() => syncKnowledgeBase().catch(() => {}), 4000);
setInterval(() => syncKnowledgeBase().catch(() => {}), SYNC_TTL);

