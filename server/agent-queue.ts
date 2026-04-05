import nodeCrypto from "crypto";
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import { Redis as IORedis, type RedisOptions as IORedisOptions } from "ioredis";
import {
  processMessageTranslationWithOutcome,
  processEditedMessageTranslationWithOutcome,
} from "./juno-bridge";
import type { TranslationOutcome } from "./juno-bridge";
import {
  recordQueueJobStarted,
  recordQueueJobCompleted,
  recordQueueJobFailed,
  recordQueueJobRetried,
  recordQueueJobSkipped,
} from "./agent-metrics";
import {
  buildRedisConnectionOptions,
  createRawIoredis,
  isDirectRedisAvailable,
  getRedisMode,
} from "./redis-cache";
import type { RoomChatMsg } from "./routes";
import { REDIS_KEYS } from "./brand-keys";

const QUEUE_NAME = REDIS_KEYS.agentQueueName;
const RESULTS_CHANNEL = REDIS_KEYS.agentResultsChannel;
const IDEMPOTENCY_PREFIX = REDIS_KEYS.agentIdempotency;
const IDEMPOTENCY_TTL = 86400;

// ─── In-Memory Job Queue (always-on, no Redis required) ──────────────────────
// This is the primary queue backbone. Redis/BullMQ is an optional enhancement
// for persistence in production. The in-memory queue guarantees ordering,
// concurrency control, retry with exponential backoff, and idempotency — with
// zero external dependencies.

interface InMemoryJob {
  id: string;
  data: AgentJobData;
  attempts: number;
  maxAttempts: number;
}

type ResultCallback = (result: TranslationResult) => void;

class InMemoryJobQueue {
  private queue: InMemoryJob[] = [];
  private activeCount = 0;
  private readonly concurrency: number;
  private paused = false;
  private onResult: ResultCallback;
  private idempotencyMap = new Map<string, number>(); // key → expiry timestamp
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  readonly stats = {
    enqueued: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    duplicatesSkipped: 0,
  };

  constructor(concurrency: number, onResult: ResultCallback) {
    this.concurrency = concurrency;
    this.onResult = onResult;
    this.cleanupTimer = setInterval(() => this.cleanupIdempotency(), 60_000);
  }

  private idempotencyKey(data: AgentJobData): string {
    if (data.type === "translate") return `translate:${data.msg.id}`;
    return `translate-edit:${data.messageId}:${data.editHash}`;
  }

  private isAlreadyDone(key: string): boolean {
    const expiry = this.idempotencyMap.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) { this.idempotencyMap.delete(key); return false; }
    return true;
  }

  private markDone(key: string): void {
    this.idempotencyMap.set(key, Date.now() + IDEMPOTENCY_TTL * 1000);
  }

  private cleanupIdempotency(): void {
    const now = Date.now();
    for (const [key, expiry] of this.idempotencyMap) {
      if (now > expiry) this.idempotencyMap.delete(key);
    }
  }

  enqueue(data: AgentJobData): boolean {
    const key = this.idempotencyKey(data);
    if (this.isAlreadyDone(key)) {
      this.stats.duplicatesSkipped++;
      return false;
    }
    const jobId = `imq:${key}:${Date.now()}`;
    this.queue.push({ id: jobId, data, attempts: 0, maxAttempts: 3 });
    this.stats.enqueued++;
    this.drain();
    return true;
  }

  private drain(): void {
    while (!this.paused && this.activeCount < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.activeCount++;
      this.runJob(job);
    }
  }

  private async runJob(job: InMemoryJob): Promise<void> {
    const key = this.idempotencyKey(job.data);
    if (this.isAlreadyDone(key)) {
      this.stats.duplicatesSkipped++;
      this.activeCount--;
      this.drain();
      return;
    }

    recordQueueJobStarted();
    if (job.attempts > 0) {
      this.stats.retried++;
      recordQueueJobRetried();
    }

    try {
      let outcome: TranslationOutcome;
      if (job.data.type === "translate") {
        outcome = await processMessageTranslationWithOutcome(
          job.data.roomCode, job.data.msg, job.data.senderId
        );
      } else {
        outcome = await processEditedMessageTranslationWithOutcome(
          job.data.roomCode, job.data.messageId, job.data.newText, job.data.senderId
        );
      }

      if (outcome.status === "translated") {
        const msgId = job.data.type === "translate" ? job.data.msg.id : job.data.messageId;
        this.onResult({
          messageId: msgId,
          roomCode: job.data.roomCode,
          translatedText: outcome.translatedText,
          targetLang: outcome.targetLang,
          senderSocketId: job.data.senderSocketId,
        });
        this.markDone(key);
        this.stats.completed++;
        recordQueueJobCompleted();
      } else if (outcome.status === "skipped") {
        this.markDone(key);
        this.stats.skipped++;
        recordQueueJobSkipped();
      } else {
        throw new Error(outcome.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.attempts++;
      if (job.attempts < job.maxAttempts) {
        const delay = Math.min(2000 * Math.pow(2, job.attempts - 1), 30_000);
        console.warn(`[AgentQueue] Job ${job.id} failed (attempt ${job.attempts}), retry in ${delay}ms: ${msg}`);
        setTimeout(() => {
          this.queue.unshift(job);
          this.activeCount--;
          this.drain();
        }, delay);
        return;
      } else {
        console.error(`[AgentQueue] Job ${job.id} permanently failed after ${job.attempts} attempts: ${msg}`);
        this.stats.failed++;
        recordQueueJobFailed();
      }
    }

    this.activeCount--;
    this.drain();
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; this.drain(); }

  get depth(): number { return this.queue.length; }
  get active(): number { return this.activeCount; }

  destroy(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.queue = [];
  }
}

let inMemoryQueue: InMemoryJobQueue | null = null;
let inMemoryQueueReady = false;

class TranslationRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationRetryError";
  }
}

interface TranslateJobData {
  type: "translate";
  roomCode: string;
  msg: RoomChatMsg;
  senderId: string;
  senderSocketId: string;
}

interface TranslateEditJobData {
  type: "translate-edit";
  roomCode: string;
  messageId: string;
  newText: string;
  senderId: string;
  senderSocketId: string;
  editHash: string;
}

type AgentJobData = TranslateJobData | TranslateEditJobData;

interface TranslationResult {
  messageId: string;
  roomCode: string;
  translatedText: string;
  targetLang: string;
  senderSocketId: string;
}

let queue: Queue | null = null;
let inProcessWorker: Worker | null = null;
let inProcessPublisher: IORedis | null = null;
let subscriberConnection: IORedis | null = null;
let queueReady = false;

const queueStats = {
  enqueued: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  duplicatesSkipped: 0,
  skipped: 0,
};

export { buildRedisConnectionOptions as buildRedisOptions };

async function isAlreadyCompleted(redis: IORedis, key: string): Promise<boolean> {
  try {
    const val = await redis.get(`${IDEMPOTENCY_PREFIX}:${key}`);
    return val === "1";
  } catch {
    return false;
  }
}

async function markCompleted(redis: IORedis, key: string): Promise<void> {
  try {
    await redis.set(`${IDEMPOTENCY_PREFIX}:${key}`, "1", "EX", IDEMPOTENCY_TTL);
  } catch {}
}

function contentHash(text: string): string {
  return nodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function handleOutcome(
  outcome: TranslationOutcome,
  idempotencyKey: string,
  publisherRedis: IORedis,
  senderSocketId: string,
  messageId: string,
  roomCode: string
): Promise<void> {
  switch (outcome.status) {
    case "translated":
      return (async () => {
        const payload: TranslationResult = {
          messageId,
          roomCode,
          translatedText: outcome.translatedText,
          targetLang: outcome.targetLang,
          senderSocketId,
        };
        await publisherRedis.publish(RESULTS_CHANNEL, JSON.stringify(payload));
        await markCompleted(publisherRedis, idempotencyKey);
        queueStats.completed++;
        recordQueueJobCompleted();
      })();
    case "skipped":
      return (async () => {
        await markCompleted(publisherRedis, idempotencyKey);
        queueStats.skipped++;
        recordQueueJobSkipped();
      })();
    case "failed":
      throw new TranslationRetryError(outcome.error);
  }
}

function createProcessJob(publisherRedis: IORedis) {
  return async function processJob(job: Job): Promise<void> {
    const data = job.data as AgentJobData;
    const isRetry = (job.attemptsMade || 0) > 0;

    recordQueueJobStarted();

    if (isRetry) {
      queueStats.retried++;
      recordQueueJobRetried();
      console.log(`[AgentQueue] Retrying job ${job.id} (attempt ${job.attemptsMade + 1})`);
    }

    if (data.type === "translate") {
      const idempotencyKey = `translate:${data.msg.id}`;
      if (await isAlreadyCompleted(publisherRedis, idempotencyKey)) {
        queueStats.duplicatesSkipped++;
        return;
      }

      const outcome = await processMessageTranslationWithOutcome(data.roomCode, data.msg, data.senderId);
      await handleOutcome(outcome, idempotencyKey, publisherRedis, data.senderSocketId, data.msg.id, data.roomCode);
    } else if (data.type === "translate-edit") {
      const idempotencyKey = `translate-edit:${data.messageId}:${data.editHash}`;
      if (await isAlreadyCompleted(publisherRedis, idempotencyKey)) {
        queueStats.duplicatesSkipped++;
        return;
      }

      const outcome = await processEditedMessageTranslationWithOutcome(
        data.roomCode,
        data.messageId,
        data.newText,
        data.senderId
      );
      await handleOutcome(outcome, idempotencyKey, publisherRedis, data.senderSocketId, data.messageId, data.roomCode);
    }
  };
}

const RATE_LIMIT_MSG = "max requests limit exceeded";
let workerBackoffMs = 5_000;
const WORKER_BACKOFF_MAX_MS = 5 * 60_000;
let workerInBackoff = false;

export function initWorker(
  redisOpts: IORedisOptions,
  publisherRedis: IORedis
): Worker {
  const w = new Worker(QUEUE_NAME, createProcessJob(publisherRedis), {
    connection: redisOpts,
    concurrency: 3,
    limiter: { max: 10, duration: 1000 },
  });

  w.on("failed", (job, err) => {
    queueStats.failed++;
    recordQueueJobFailed();
    console.error(`[AgentQueue] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });

  w.on("error", (err) => {
    if (err.message.includes(RATE_LIMIT_MSG)) {
      if (!workerInBackoff) {
        workerInBackoff = true;
        console.warn(`[AgentQueue] Redis rate limit hit — pausing worker for ${workerBackoffMs / 1000}s`);
        try { const p = w.pause(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch {}
        setTimeout(() => {
          workerBackoffMs = Math.min(workerBackoffMs * 2, WORKER_BACKOFF_MAX_MS);
          workerInBackoff = false;
          try { w.resume(); } catch {}
          console.log("[AgentQueue] Worker resumed after backoff");
        }, workerBackoffMs);
      }
    } else {
      console.error("[AgentQueue] Worker error:", err.message);
    }
  });

  w.on("completed", () => {
    if (workerBackoffMs > 5_000) {
      workerBackoffMs = 5_000;
    }
  });

  return w;
}

export async function startAgentQueue(
  onTranslationResult: (result: TranslationResult) => void
): Promise<boolean> {
  // ── Layer 1: In-memory queue — always-on primary backbone ────────────────
  inMemoryQueue = new InMemoryJobQueue(5, onTranslationResult);
  inMemoryQueueReady = true;
  console.log("[AgentQueue] In-memory queue online (primary backbone)");

  // ── Layer 2: BullMQ + Redis — runs in parallel for durable persistence ───
  const redisOpts = buildRedisConnectionOptions();
  if (!redisOpts) {
    console.log("[AgentQueue] Queue system ready (in-memory + Redis connecting)");
    return true;
  }

  try {
    queue = new Queue(QUEUE_NAME, {
      connection: redisOpts,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });

    subscriberConnection = createRawIoredis();
    if (subscriberConnection) {
      await subscriberConnection.connect();
      await subscriberConnection.subscribe(RESULTS_CHANNEL);
      subscriberConnection.on("message", (_channel: string, message: string) => {
        try {
          const result: TranslationResult = JSON.parse(message);
          onTranslationResult(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[AgentQueue] Failed to parse result message:", msg);
        }
      });
    }

    const isDevMode = process.env.NODE_ENV !== "production";
    if (isDevMode) {
      const workerOpts = buildRedisConnectionOptions();
      if (workerOpts) {
        inProcessPublisher = createRawIoredis();
        if (inProcessPublisher) {
          await inProcessPublisher.connect();
          inProcessWorker = initWorker(workerOpts, inProcessPublisher);
          console.log("[AgentQueue] BullMQ in-process worker started (Redis-backed, dev mode)");
        }
      }
    }

    queueReady = true;
    console.log("[AgentQueue] BullMQ + Redis layer online (dual-queue system active)");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AgentQueue] BullMQ layer skipped:", msg);
    queueReady = false;
  }

  return true;
}

export async function stopAgentQueue(): Promise<void> {
  try {
    if (inMemoryQueue) {
      inMemoryQueue.destroy();
      inMemoryQueue = null;
      inMemoryQueueReady = false;
    }
    if (inProcessWorker) {
      await inProcessWorker.close();
      inProcessWorker = null;
    }
    if (inProcessPublisher) {
      inProcessPublisher.disconnect();
      inProcessPublisher = null;
    }
    if (subscriberConnection) {
      await subscriberConnection.unsubscribe(RESULTS_CHANNEL);
      subscriberConnection.disconnect();
      subscriberConnection = null;
    }
    if (queue) {
      await queue.close();
      queue = null;
    }
    queueReady = false;
    console.log("[AgentQueue] Stopped");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AgentQueue] Error during shutdown:", msg);
  }
}

export function isQueueAvailable(): boolean {
  return inMemoryQueueReady && inMemoryQueue !== null;
}

export async function enqueueTranslation(
  roomCode: string,
  msg: RoomChatMsg,
  senderId: string,
  senderSocketId: string
): Promise<boolean> {
  if (!inMemoryQueue) return false;

  const jobData: AgentJobData = { type: "translate", roomCode, msg, senderId, senderSocketId };

  // Primary: in-memory queue (always runs)
  inMemoryQueue.enqueue(jobData);

  // Secondary: BullMQ for Redis-backed durability (runs in parallel when online)
  if (queueReady && queue) {
    try {
      await queue.add("translate", jobData, { jobId: `translate:${msg.id}` });
      queueStats.enqueued++;
    } catch { /* BullMQ failure never blocks in-memory processing */ }
  }

  return true;
}

export async function enqueueEditTranslation(
  roomCode: string,
  messageId: string,
  newText: string,
  senderId: string,
  senderSocketId: string
): Promise<boolean> {
  if (!inMemoryQueue) return false;

  const editHash = contentHash(newText);
  const jobData: AgentJobData = { type: "translate-edit", roomCode, messageId, newText, senderId, senderSocketId, editHash };

  // Primary: in-memory queue (always runs)
  inMemoryQueue.enqueue(jobData);

  // Secondary: BullMQ for Redis-backed durability (runs in parallel when online)
  if (queueReady && queue) {
    try {
      await queue.add("translate-edit", jobData, { jobId: `translate-edit:${messageId}:${editHash}` });
      queueStats.enqueued++;
    } catch { /* BullMQ failure never blocks in-memory processing */ }
  }

  return true;
}

export async function getQueueHealth(): Promise<{
  available: boolean;
  redisMode: string;
  directRedisConnected: boolean;
  inMemory: { active: boolean; depth: number; activeJobs: number; stats: Record<string, number> };
  bullmq: { active: boolean; counts: { waiting: number; active: number; completed: number; failed: number; delayed: number } | null };
  stats: typeof queueStats;
}> {
  const directConnected = isDirectRedisAvailable();
  const redisMode = getRedisMode();

  const inMemoryHealth = {
    active: inMemoryQueueReady && inMemoryQueue !== null,
    depth: inMemoryQueue?.depth ?? 0,
    activeJobs: inMemoryQueue?.active ?? 0,
    stats: inMemoryQueue ? { ...inMemoryQueue.stats } : {},
  };

  let bullmqCounts = null;
  if (queue && queueReady) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      bullmqCounts = {
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
      };
    } catch { /* Redis may be rate-limited; in-memory is primary */ }
  }

  return {
    available: inMemoryQueueReady,
    redisMode,
    directRedisConnected: directConnected,
    inMemory: inMemoryHealth,
    bullmq: { active: queueReady && queue !== null, counts: bullmqCounts },
    stats: { ...queueStats },
  };
}
