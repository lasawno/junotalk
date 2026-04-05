import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { isRedisAvailable, getRedisUsageStats } from "./redis-cache";
import { getIO } from "./socket-io";
import { junoController } from "./juno-controller";
import { connectedClients, roomParticipants, socketMetrics, getInMemoryCacheStats } from "./routes";
import { getLogStats, getRecentLogs, type LogAction } from "./structured-logger";
import { getMetricsSnapshot } from "./agent-metrics";
import { isAuthenticated } from "./replit_integrations/auth";
import { getSecretsGuardStatus } from "./secrets-guard";
import { getGatewayHealth, getGatewayUsageStats, resetProviderCircuit } from "./ai-gateway";
import { getProjectState, getProjectStateStatus, pushProjectState, recordDecision } from "./project-state";

const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const startedAt = Date.now();
const DB_CHECK_TIMEOUT_MS = 400;
const rawMemLimit = parseInt(process.env.CONTAINER_MEMORY_LIMIT_MB || "512", 10);
const CONTAINER_MEMORY_LIMIT_MB = (isNaN(rawMemLimit) || rawMemLimit <= 0) ? 512 : rawMemLimit;
const MEMORY_WARNING_THRESHOLD = 0.8;
let memoryMonitorInterval: ReturnType<typeof setInterval> | null = null;

type ServiceStatus = "healthy" | "degraded" | "unhealthy";

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  details?: Record<string, unknown>;
}

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DB check timeout")), DB_CHECK_TIMEOUT_MS)),
    ]);
    return {
      name: "database",
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      name: "database",
      status: err.message === "DB check timeout" ? "degraded" : "unhealthy",
      latencyMs: Date.now() - start,
      details: { error: err.message },
    };
  }
}

function checkRedis(): ServiceCheck {
  const available = isRedisAvailable();
  const stats = getRedisUsageStats();
  return {
    name: "redis",
    status: available ? (stats.throttled ? "degraded" : "healthy") : "unhealthy",
    latencyMs: 0,
    details: {
      connected: available,
      mode: stats.mode,
      throttled: stats.throttled,
    },
  };
}

function checkSocketIO(): ServiceCheck {
  const io = getIO();
  if (!io) {
    return { name: "socketio", status: "unhealthy", latencyMs: 0, details: { error: "Not initialized" } };
  }

  const chatNs = io.of("/chat");
  const connectedSockets = chatNs.sockets.size;
  return {
    name: "socketio",
    status: "healthy",
    latencyMs: 0,
    details: {
      connectedSockets,
      wsClients: connectedClients.size,
      activeRooms: roomParticipants.size,
    },
  };
}

function checkMemory(): ServiceCheck {
  const memUsage = process.memoryUsage();
  const rssMB = memUsage.rss / (1024 * 1024);
  const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
  const heapTotalMB = memUsage.heapTotal / (1024 * 1024);
  const usageRatio = rssMB / CONTAINER_MEMORY_LIMIT_MB;

  let status: ServiceStatus = "healthy";
  if (usageRatio > 0.9) status = "unhealthy";
  else if (usageRatio > MEMORY_WARNING_THRESHOLD) status = "degraded";

  return {
    name: "memory",
    status,
    latencyMs: 0,
    details: {
      rss: `${rssMB.toFixed(1)} MB`,
      heapUsed: `${heapUsedMB.toFixed(1)} MB`,
      heapTotal: `${heapTotalMB.toFixed(1)} MB`,
      external: `${(memUsage.external / (1024 * 1024)).toFixed(1)} MB`,
      containerLimitMB: CONTAINER_MEMORY_LIMIT_MB,
      usagePercent: `${(usageRatio * 100).toFixed(1)}%`,
    },
  };
}

function checkAIServices(): ServiceCheck {
  const state = junoController.getState();
  const connectors = state.connectors;

  const configured = Object.values(connectors).filter(c => c.connected).length;
  const total = Object.values(connectors).length;

  let status: ServiceStatus = "healthy";
  if (configured === 0) status = "unhealthy";
  else if (configured < total) status = "degraded";

  return {
    name: "ai_services",
    status,
    latencyMs: 0,
    details: {
      configured,
      total,
      services: Object.fromEntries(
        Object.entries(connectors).map(([k, v]) => [k, v.connected ? "connected" : "disconnected"])
      ),
    },
  };
}

const CRITICAL_SERVICES = new Set(["database", "memory"]);

function deriveOverallStatus(checks: ServiceCheck[]): ServiceStatus {
  if (checks.some(c => CRITICAL_SERVICES.has(c.name) && c.status === "unhealthy")) return "unhealthy";
  if (checks.some(c => c.status === "unhealthy")) return "degraded";
  if (checks.some(c => c.status === "degraded")) return "degraded";
  return "healthy";
}

function isAdminRequest(req: any): boolean {
  const userId = req.user?.claims?.sub;
  const adminIds = (process.env.ADMIN_USER_IDS || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  return adminIds.includes(userId);
}

export function registerHealthRoutes(app: Express) {
  app.get("/api/system/health", async (_req: Request, res: Response) => {
    const startTime = Date.now();

    const [dbCheck] = await Promise.all([checkDatabase()]);
    const redisCheck = checkRedis();
    const socketCheck = checkSocketIO();
    const aiCheck = checkAIServices();
    const memoryCheck = checkMemory();

    const secretsStatus = getSecretsGuardStatus();
    const secretsCheck: ServiceCheck = {
      name: "secrets_guard",
      status: secretsStatus.initialized ? "healthy" : "unhealthy",
      latencyMs: 0,
      details: {
        trackedSecrets: secretsStatus.trackedSecrets,
        scrubbedResponses: secretsStatus.scrubbedResponses,
        scrubbedLogs: secretsStatus.scrubbedLogs,
      },
    };

    const checks = [dbCheck, redisCheck, socketCheck, aiCheck, memoryCheck, secretsCheck];
    const overall = deriveOverallStatus(checks);

    const responseTime = Date.now() - startTime;

    const statusCode = overall === "unhealthy" ? 503 : 200;

    res.status(statusCode).json({
      status: overall,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      checks: checks.reduce((acc, c) => {
        acc[c.name] = { status: c.status, latencyMs: c.latencyMs, ...(c.details || {}) };
        return acc;
      }, {} as Record<string, any>),
    });
  });

  app.get("/api/system/status", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

    const [dbCheck] = await Promise.all([checkDatabase()]);
    const redisCheck = checkRedis();
    const socketIOCheck = checkSocketIO();
    const aiCheck = checkAIServices();
    const memoryCheck = checkMemory();

    const checks = [dbCheck, redisCheck, socketIOCheck, aiCheck, memoryCheck];
    const overall = deriveOverallStatus(checks);

    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const memUsage = process.memoryUsage();
    const redisStats = getRedisUsageStats();

    let metricsSnapshot = null;
    try {
      metricsSnapshot = await getMetricsSnapshot();
    } catch {}

    const logStats = getLogStats();

    res.json({
      status: overall,
      version: SERVICE_VERSION,
      uptime: {
        seconds: uptimeSeconds,
        human: formatUptime(uptimeSeconds),
        startedAt: new Date(startedAt).toISOString(),
      },
      memory: {
        rss: formatBytes(memUsage.rss),
        heapUsed: formatBytes(memUsage.heapUsed),
        heapTotal: formatBytes(memUsage.heapTotal),
        external: formatBytes(memUsage.external),
      },
      connections: {
        websocketClients: connectedClients.size,
        socketioSockets: socketIOCheck.details?.connectedSockets || 0,
        activeRooms: roomParticipants.size,
        socketMetrics: {
          messagesRouted: socketMetrics.messagesRouted,
          messagesFailed: socketMetrics.messagesFailed,
          typingEventsRouted: socketMetrics.typingEventsRouted,
          peakConnections: socketMetrics.peakConnections,
          avgDeliveryMs: socketMetrics.avgDeliveryMs,
        },
      },
      services: checks.reduce((acc, c) => {
        acc[c.name] = { status: c.status, latencyMs: c.latencyMs, ...(c.details || {}) };
        return acc;
      }, {} as Record<string, any>),
      redis: redisStats,
      inMemoryCaches: getInMemoryCacheStats(),
      metrics: metricsSnapshot ? {
        health: metricsSnapshot.health,
        current: metricsSnapshot.current,
      } : null,
      security: getSecretsGuardStatus(),
      logging: logStats,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/system/logs", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

    const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), 200);
    const action = req.query.action as LogAction | undefined;
    const logs = getRecentLogs(limit, action);
    const stats = getLogStats();
    res.json({ logs, stats });
  });

  app.get("/api/system/gateway/health", async (_req: Request, res: Response) => {
    const health = getGatewayHealth();
    const summary = {
      totalProviders: health.providers.length,
      availableProviders: health.providers.filter(p => p.available && !p.circuitOpen).length,
      degradedProviders: health.providers.filter(p => p.available && p.circuitOpen).length,
      unavailableProviders: health.providers.filter(p => !p.available).length,
    };
    const overallStatus = summary.availableProviders > 0 ? "healthy" : "unhealthy";

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      summary,
      providers: health.providers,
      routing: health.routing,
    });
  });

  app.get("/api/system/gateway/usage", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

    const usage = await getGatewayUsageStats();
    res.json({
      timestamp: new Date().toISOString(),
      usage,
    });
  });

  app.get("/api/system/gateway/requests", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

    const health = getGatewayHealth();
    res.json({
      timestamp: new Date().toISOString(),
      recentRequests: health.recentRequests,
    });
  });

  if (!memoryMonitorInterval) {
    memoryMonitorInterval = setInterval(() => {
      const memCheck = checkMemory();
      if (memCheck.status === "degraded") {
        console.warn(`[MemoryMonitor] WARNING — Memory usage at ${memCheck.details?.usagePercent} (${memCheck.details?.rss} RSS). Limit: ${CONTAINER_MEMORY_LIMIT_MB} MB`);
      } else if (memCheck.status === "unhealthy") {
        console.error(`[MemoryMonitor] CRITICAL — Memory usage at ${memCheck.details?.usagePercent} (${memCheck.details?.rss} RSS). Limit: ${CONTAINER_MEMORY_LIMIT_MB} MB`);
      }
    }, 60_000);
  }

  app.post("/api/system/gateway/reset-circuit/:provider", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

    const provider = req.params.provider as string;
    const success = resetProviderCircuit(provider);
    if (success) {
      res.json({ message: `Circuit reset for ${provider}`, provider });
    } else {
      res.status(404).json({ error: `Provider '${provider}' not found` });
    }
  });

  app.get("/api/system/project-state", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json({ status: getProjectStateStatus(), state: getProjectState() });
  });

  app.post("/api/system/project-state/push", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const ok = await pushProjectState("[ProjectState] Manual push via admin endpoint");
    if (ok) {
      res.json({ success: true, message: "Project state pushed to GitHub CDN." });
    } else {
      res.status(500).json({ success: false, message: "Push failed — check GITHUB_TOKEN secret." });
    }
  });

  app.post("/api/system/project-state/record", isAuthenticated, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { type, description, rationale, files, cdnKeysAdded } = req.body;
    if (!type || !description) return res.status(400).json({ error: "type and description are required" });
    if (type !== "migration" && type !== "decision") return res.status(400).json({ error: "type must be 'migration' or 'decision'" });
    const ok = await recordDecision({ type, description, rationale, files, cdnKeysAdded });
    res.json({ success: ok, message: ok ? "Recorded and pushed to CDN." : "Recorded locally but CDN push failed." });
  });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
