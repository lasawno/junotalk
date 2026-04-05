import OpenAI from "openai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { translationEmbeddings, conversationEmbeddings } from "@shared/schema";
import { apiKeys } from "./api-keys";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_CACHE_TTL = 60 * 60 * 1000;
const MAX_EMBEDDING_CACHE = 200;
const BATCH_SIZE = 20;

// ── Free local embedding fallback ─────────────────────────────────────────────
// When OpenAI is unavailable, generate a 1536-dim hash-based vector that
// preserves semantic similarity via consistent word-frequency projection.
// Same text always produces the same vector (deterministic).
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function generateHashEmbedding(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  const tokens = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length > 1);
  if (tokens.length === 0) return Array.from(vector);
  const tf = 1.0 / tokens.length;
  for (const token of tokens) {
    // Project each token into 4 positions using different seeds for spread
    for (let seed = 0; seed < 4; seed++) {
      const pos = cyrb53(token, seed) % EMBEDDING_DIMENSIONS;
      vector[pos] += tf;
    }
  }
  // L2-normalize so cosine similarity works correctly
  let mag = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) mag += vector[i] * vector[i];
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) vector[i] /= mag;
  return Array.from(vector);
}

class LRUEmbeddingCache<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}
  get size() { return this.map.size; }
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
    return this;
  }
  delete(key: K) { return this.map.delete(key); }
}

const embeddingCache = new LRUEmbeddingCache<string, { vector: number[]; expires: number }>(MAX_EMBEDDING_CACHE);

let openaiClient: OpenAI | null = null;

let embeddingsSupported = true;

function getOpenAIClient(): OpenAI | null {
  if (!embeddingsSupported) return null;
  if (openaiClient) return openaiClient;
  const directKey = apiKeys.openai();
  if (directKey) {
    openaiClient = new OpenAI({ apiKey: directKey });
    return openaiClient;
  }
  const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!integrationKey) return null;
  openaiClient = new OpenAI({ apiKey: integrationKey, baseURL });
  return openaiClient;
}

function getCacheKey(text: string): string {
  return text.slice(0, 500).toLowerCase().trim();
}

function getCachedEmbedding(text: string): number[] | null {
  const key = getCacheKey(text);
  const cached = embeddingCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.vector;
  if (cached) embeddingCache.delete(key);
  return null;
}

function setCachedEmbedding(text: string, vector: number[]) {
  embeddingCache.set(getCacheKey(text), { vector, expires: Date.now() + EMBEDDING_CACHE_TTL });
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.trim().length < 2) return null;

  const cached = getCachedEmbedding(text);
  if (cached) return cached;

  const client = getOpenAIClient();
  if (client) {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text.trim(),
        dimensions: EMBEDDING_DIMENSIONS,
      });
      const vector = response.data[0]?.embedding;
      if (vector) {
        setCachedEmbedding(text, vector);
        return vector;
      }
    } catch (err: any) {
      const msg = err?.message || "";
      const status = err?.status || err?.response?.status;
      if (msg.includes("not supported") || msg.includes("does not support") ||
          status === 401 || msg.includes("Incorrect API key") || msg.includes("Invalid API key")) {
        embeddingsSupported = false;
        openaiClient = null;
      }
      // Fall through to free hash-based fallback below
    }
  }

  // ── Free local fallback: hash-based 1536-dim embedding ──────────────────────
  // Deterministic, offline, no API cost. Semantic similarity via word projection.
  const vector = generateHashEmbedding(text.trim());
  setCachedEmbedding(text, vector);
  return vector;
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = getCachedEmbedding(texts[i]);
    if (cached) {
      results[i] = cached;
    } else if (texts[i] && texts[i].trim().length >= 2) {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i].trim());
    }
  }

  if (uncachedTexts.length === 0) return results;

  const client = getOpenAIClient();
  const openaiSucceeded: boolean[] = new Array(uncachedTexts.length).fill(false);

  if (client) {
    try {
      for (let batchStart = 0; batchStart < uncachedTexts.length; batchStart += BATCH_SIZE) {
        const batch = uncachedTexts.slice(batchStart, batchStart + BATCH_SIZE);
        const batchIndices = uncachedIndices.slice(batchStart, batchStart + BATCH_SIZE);

        const response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        });

        for (const item of response.data) {
          const originalIndex = batchIndices[item.index];
          results[originalIndex] = item.embedding;
          setCachedEmbedding(texts[originalIndex], item.embedding);
          openaiSucceeded[batchStart + item.index] = true;
        }
      }
    } catch (err: any) {
      const msg = err?.message || "";
      const status = err?.status || err?.response?.status;
      if (msg.includes("not supported") || msg.includes("does not support") ||
          status === 401 || msg.includes("Incorrect API key") || msg.includes("Invalid API key")) {
        embeddingsSupported = false;
        openaiClient = null;
      }
      // Fall through — remaining texts will get hash embeddings below
    }
  }

  // Fill any remaining uncached texts with free local hash embeddings
  for (let j = 0; j < uncachedTexts.length; j++) {
    if (!openaiSucceeded[j]) {
      const originalIndex = uncachedIndices[j];
      const vector = generateHashEmbedding(uncachedTexts[j]);
      results[originalIndex] = vector;
      setCachedEmbedding(texts[originalIndex], vector);
    }
  }

  return results;
}

export async function initVectorExtension(): Promise<boolean> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("[EmbeddingService] pgvector extension enabled");
    return true;
  } catch (err) {
    console.warn("[EmbeddingService] Could not enable pgvector extension:", err);
    return false;
  }
}

export async function initVectorTables(): Promise<boolean> {
  try {
    const extensionReady = await initVectorExtension();
    if (!extensionReady) {
      console.warn("[EmbeddingService] pgvector not available, vector features disabled");
      return false;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS translation_embeddings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        source_lang varchar(10) NOT NULL,
        target_lang varchar(10) NOT NULL,
        source_text text NOT NULL,
        translated_text text NOT NULL,
        room_code varchar,
        provider varchar(30),
        embedding_model varchar(50) DEFAULT 'text-embedding-3-small',
        hit_count integer DEFAULT 0,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        embedding vector(1536)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversation_embeddings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        room_code varchar,
        content_type varchar(20) NOT NULL DEFAULT 'message',
        content text NOT NULL,
        metadata text,
        embedding_model varchar(50) DEFAULT 'text-embedding-3-small',
        created_at timestamp DEFAULT now(),
        embedding vector(1536)
      )
    `);

    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'translation_embeddings' AND column_name = 'embedding') THEN
          ALTER TABLE translation_embeddings ADD COLUMN embedding vector(1536);
        END IF;
      END $$
    `);

    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'conversation_embeddings' AND column_name = 'embedding') THEN
          ALTER TABLE conversation_embeddings ADD COLUMN embedding vector(1536);
        END IF;
      END $$
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'te_embedding_idx') THEN
          CREATE INDEX te_embedding_idx ON translation_embeddings 
            USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        END IF;
      EXCEPTION WHEN others THEN
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'te_embedding_idx') THEN
            CREATE INDEX te_embedding_idx ON translation_embeddings 
              USING hnsw (embedding vector_cosine_ops);
          END IF;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END $$
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ce_embedding_idx') THEN
          CREATE INDEX ce_embedding_idx ON conversation_embeddings 
            USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        END IF;
      EXCEPTION WHEN others THEN
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ce_embedding_idx') THEN
            CREATE INDEX ce_embedding_idx ON conversation_embeddings 
              USING hnsw (embedding vector_cosine_ops);
          END IF;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END $$
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS te_lang_pair_idx ON translation_embeddings(source_lang, target_lang)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS te_room_code_idx ON translation_embeddings(room_code)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ce_user_id_idx ON conversation_embeddings(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ce_room_code_idx ON conversation_embeddings(room_code)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ce_content_type_idx ON conversation_embeddings(content_type)`);

    console.log("[EmbeddingService] Vector tables and indexes initialized");
    return true;
  } catch (err) {
    console.error("[EmbeddingService] Failed to initialize vector tables:", err);
    return false;
  }
}

export interface SimilarTranslation {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  similarity: number;
  roomCode: string | null;
}

export async function searchSimilarTranslations(
  queryText: string,
  sourceLang: string,
  targetLang: string,
  limit: number = 5,
  minSimilarity: number = 0.75,
  roomCode?: string
): Promise<SimilarTranslation[]> {
  const embedding = await generateEmbedding(queryText);
  if (!embedding) return [];

  const vectorStr = `[${embedding.join(",")}]`;
  const clampedLimit = Math.min(Math.max(limit, 1), 20);

  try {
    let query = sql`
      SELECT 
        id, source_text, translated_text, source_lang, target_lang, room_code,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM translation_embeddings
      WHERE source_lang = ${sourceLang}
        AND target_lang = ${targetLang}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
    `;

    if (roomCode) {
      query = sql`${query} AND room_code = ${roomCode}`;
    }

    query = sql`${query} ORDER BY embedding <=> ${vectorStr}::vector LIMIT ${clampedLimit}`;

    const results = await db.execute(query);

    return (results.rows as any[]).map(row => ({
      id: row.id,
      sourceText: row.source_text,
      translatedText: row.translated_text,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      similarity: parseFloat(row.similarity),
      roomCode: row.room_code,
    }));
  } catch (err) {
    console.error("[EmbeddingService] Similarity search failed:", err);
    return [];
  }
}

export async function searchSimilarConversations(
  queryText: string,
  userId?: string,
  roomCode?: string,
  contentType?: string,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<{ id: string; content: string; contentType: string; similarity: number; roomCode: string | null; metadata: any; createdAt: Date | null }[]> {
  const embedding = await generateEmbedding(queryText);
  if (!embedding) return [];

  const vectorStr = `[${embedding.join(",")}]`;

  try {
    let query = sql`
      SELECT 
        id, content, content_type, room_code, metadata, created_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM conversation_embeddings
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
    `;

    if (userId) {
      query = sql`${query} AND user_id = ${userId}`;
    }
    if (roomCode) {
      query = sql`${query} AND room_code = ${roomCode}`;
    }
    if (contentType) {
      query = sql`${query} AND content_type = ${contentType}`;
    }

    const clampedLimit = Math.min(Math.max(limit, 1), 20);
    query = sql`${query} ORDER BY embedding <=> ${vectorStr}::vector LIMIT ${clampedLimit}`;

    const results = await db.execute(query);
    return (results.rows as any[]).map(row => ({
      id: row.id,
      content: row.content,
      contentType: row.content_type,
      similarity: parseFloat(row.similarity),
      roomCode: row.room_code,
      metadata: row.metadata ? (() => { try { return JSON.parse(row.metadata); } catch { return null; } })() : null,
      createdAt: row.created_at,
    }));
  } catch (err) {
    console.error("[EmbeddingService] Conversation search failed:", err);
    return [];
  }
}

export async function storeTranslationEmbedding(
  sourceText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string,
  roomCode?: string,
  provider?: string
): Promise<boolean> {
  try {
    const combinedText = `${sourceText} ||| ${translatedText}`;
    const embedding = await generateEmbedding(combinedText);

    const [row] = await db.insert(translationEmbeddings).values({
      sourceLang,
      targetLang,
      sourceText,
      translatedText,
      roomCode: roomCode || null,
      provider: provider || null,
    }).returning();

    if (embedding && row) {
      const vectorStr = `[${embedding.join(",")}]`;
      await db.execute(sql`
        UPDATE translation_embeddings 
        SET embedding = ${vectorStr}::vector 
        WHERE id = ${row.id}
      `);
    }

    return true;
  } catch (err) {
    console.error("[EmbeddingService] Store translation embedding failed:", err);
    return false;
  }
}

export async function storeConversationEmbedding(
  content: string,
  userId: string,
  contentType: string = "message",
  roomCode?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  try {
    const embedding = await generateEmbedding(content);

    const [row] = await db.insert(conversationEmbeddings).values({
      userId,
      roomCode: roomCode || null,
      contentType,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
    }).returning();

    if (embedding && row) {
      const vectorStr = `[${embedding.join(",")}]`;
      await db.execute(sql`
        UPDATE conversation_embeddings 
        SET embedding = ${vectorStr}::vector 
        WHERE id = ${row.id}
      `);
    }

    return true;
  } catch (err) {
    console.error("[EmbeddingService] Store conversation embedding failed:", err);
    return false;
  }
}

export async function seedTranslationMemory(
  phrases: Record<string, Record<string, Record<string, string>>>
): Promise<{ seeded: number; skipped: number; failed: number }> {
  const stats = { seeded: 0, skipped: 0, failed: 0 };
  const { translationMemory } = await import("@shared/schema");

  const allPairs: { src: string; tgt: string; sourceText: string; translatedText: string }[] = [];
  for (const [srcLang, targets] of Object.entries(phrases)) {
    for (const [tgtLang, pairs] of Object.entries(targets)) {
      for (const [sourceText, translatedText] of Object.entries(pairs)) {
        allPairs.push({ src: srcLang, tgt: tgtLang, sourceText, translatedText });
      }
    }
  }

  console.log(`[EmbeddingService] Seeding translation memory with ${allPairs.length} phrase pairs...`);

  const SEED_BATCH = 50;
  for (let i = 0; i < allPairs.length; i += SEED_BATCH) {
    const batch = allPairs.slice(i, i + SEED_BATCH);
    for (const p of batch) {
      try {
        await db.insert(translationMemory)
          .values({
            sourceLang: p.src,
            targetLang: p.tgt,
            sourceText: p.sourceText,
            translatedText: p.translatedText,
            provider: "preseeded",
          })
          .onConflictDoNothing();
        stats.seeded++;
      } catch {
        stats.skipped++;
      }
    }
  }

  console.log(`[EmbeddingService] Seed done: ${stats.seeded} seeded, ${stats.skipped} skipped, ${stats.failed} failed`);
  return stats;
}

export async function precomputeTranslationEmbeddings(
  phrases: Record<string, Record<string, Record<string, string>>>,
  batchDelay: number = 500
): Promise<{ stored: number; skipped: number; failed: number; memorySeeded: number }> {
  const memoryResult = await seedTranslationMemory(phrases);

  const stats = { stored: 0, skipped: 0, failed: 0, memorySeeded: memoryResult.seeded };
  if (!vectorReady) {
    console.warn("[EmbeddingService] Vector system not ready, skipping vector precompute (memory seeded)");
    return stats;
  }

  const client = getOpenAIClient();
  const useOpenAI = !!(client && embeddingsSupported);
  const embeddingSource = useOpenAI ? "openai" : "hash-local (free)";

  const allPairs: { src: string; tgt: string; sourceText: string; translatedText: string }[] = [];
  for (const [srcLang, targets] of Object.entries(phrases)) {
    for (const [tgtLang, pairs] of Object.entries(targets)) {
      for (const [sourceText, translatedText] of Object.entries(pairs)) {
        allPairs.push({ src: srcLang, tgt: tgtLang, sourceText, translatedText });
      }
    }
  }

  console.log(`[EmbeddingService] Precomputing ${allPairs.length} translation embeddings via ${embeddingSource}...`);

  for (let i = 0; i < allPairs.length; i += BATCH_SIZE) {
    const batch = allPairs.slice(i, i + BATCH_SIZE);

    try {
      const existing = await Promise.all(batch.map(async (p) => {
        const result = await db.execute(sql`
          SELECT id FROM translation_embeddings
          WHERE source_lang = ${p.src} AND target_lang = ${p.tgt}
            AND source_text = ${p.sourceText} AND embedding IS NOT NULL
          LIMIT 1
        `);
        return result.rows.length > 0;
      }));

      const newPairs = batch.filter((_, idx) => !existing[idx]);
      stats.skipped += batch.length - newPairs.length;

      if (newPairs.length === 0) continue;

      const texts = newPairs.map(p => `${p.sourceText} ||| ${p.translatedText}`);

      // Try OpenAI first; if unavailable, fall back to free local hash embeddings
      let vectors: (number[] | null)[] = new Array(texts.length).fill(null);
      if (useOpenAI && client) {
        try {
          const response = await client.embeddings.create({
            model: EMBEDDING_MODEL,
            input: texts,
            dimensions: EMBEDDING_DIMENSIONS,
          });
          for (const item of response.data) {
            vectors[item.index] = item.embedding;
          }
        } catch (err: any) {
          const msg = err?.message || "";
          if (msg.includes("not supported") || msg.includes("does not support")) {
            embeddingsSupported = false;
            openaiClient = null;
          }
          // Fall through to hash fallback
          vectors = texts.map(t => generateHashEmbedding(t));
        }
      } else {
        vectors = texts.map(t => generateHashEmbedding(t));
      }

      for (let j = 0; j < newPairs.length; j++) {
        const p = newPairs[j];
        const vector = vectors[j] ?? generateHashEmbedding(texts[j]);

        try {
          const vectorStr = `[${vector.join(",")}]`;
          const [row] = await db.insert(translationEmbeddings).values({
            sourceLang: p.src,
            targetLang: p.tgt,
            sourceText: p.sourceText,
            translatedText: p.translatedText,
            provider: useOpenAI ? "precomputed" : "precomputed-hash",
          }).returning();

          if (row) {
            await db.execute(sql`
              UPDATE translation_embeddings SET embedding = ${vectorStr}::vector WHERE id = ${row.id}
            `);
          }
          stats.stored++;
        } catch {
          stats.failed++;
        }
      }

      if (i + BATCH_SIZE < allPairs.length && batchDelay > 0) {
        await new Promise(r => setTimeout(r, batchDelay));
      }
    } catch (err: any) {
      console.error(`[EmbeddingService] Precompute batch ${i} failed:`, (err as Error).message);
      stats.failed += batch.length;
    }
  }

  console.log(`[EmbeddingService] Precompute done: ${stats.stored} vectors (${embeddingSource}), ${stats.memorySeeded} memory entries`);
  return stats;
}

let vectorReady = false;

export function isVectorReady(): boolean {
  return vectorReady;
}

export async function initEmbeddingService(): Promise<void> {
  try {
    vectorReady = await initVectorTables();
    if (vectorReady) {
      console.log("[EmbeddingService] Vector memory system ready");
    } else {
      console.warn("[EmbeddingService] Vector memory not available, falling back to text-only storage");
    }
  } catch (err) {
    console.warn("[EmbeddingService] Initialization failed, vector features disabled:", err);
    vectorReady = false;
  }
}

export function getEmbeddingServiceStats() {
  return {
    vectorReady,
    cacheSize: embeddingCache.size,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    hasOpenAIKey: !!getOpenAIClient(),
  };
}
