import { Redis as IORedis } from "ioredis";
import { initWorker } from "./agent-queue";
import { buildRedisConnectionOptions } from "./redis-cache";
import { startMetricsFlush, stopMetricsFlush } from "./agent-metrics";

const redisOpts = buildRedisConnectionOptions();

if (!redisOpts) {
  console.error("[AgentWorker] No REDIS_URL or REDIS_HOST configured. Cannot start standalone worker.");
  process.exit(1);
}

const publisherRedis = new IORedis(redisOpts);

startMetricsFlush();

const worker = initWorker(redisOpts, publisherRedis);

console.log("[AgentWorker] Standalone worker process started");

function shutdown(signal: string) {
  console.log(`[AgentWorker] Received ${signal}. Shutting down...`);
  stopMetricsFlush();
  worker.close().then(() => {
    publisherRedis.disconnect();
    console.log("[AgentWorker] Worker closed.");
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
