import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupSocketIO } from "./socket-io";
import { serveStatic } from "./static";
import { crawlerPrerender } from "./crawler-prerender";
import { startMetricsFlush } from "./agent-metrics";
import { startAgentQueue, stopAgentQueue } from "./agent-queue";
import { getIO } from "./socket-io";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { startPiperTTS, stopPiperTTS } from "./start-piper";
import { initEmbeddingService } from "./embedding-service";
import { supabaseStorageService } from "./supabase-storage";
import { initProjectState } from "./project-state";
import { initArenaLLM } from "./arena-llm";

// ── Resilience: catch ALL unhandled errors so the server never fully crashes ──
// Categorise: truly fatal errors (corrupted state) exit; recoverable ones log.
const FATAL_CODES = new Set(["ERR_IPC_CHANNEL_CLOSED", "ERR_USE_AFTER_CLOSE", "ENOSPC"]);

process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  const fatal = FATAL_CODES.has(err.code ?? "") || /out of memory/i.test(err.message ?? "");
  console.error(`[Server] Uncaught exception (${fatal ? "FATAL" : "recovered"}):`, err?.message);
  if (fatal) {
    console.error(err.stack);
    process.exit(1);
  }
  // Non-fatal: log and keep running — one bad request/module shouldn't take
  // down every other user's connection.
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("[Server] Unhandled rejection (recovered):", message);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const jsonParser = express.json({
  limit: "50mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

const urlencodedParser = express.urlencoded({ extended: false });

// Per-IP rate limiting (#5) — 200 API requests per minute per IP
app.use("/api/", (req, res, next) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (ip === "unknown" || ip.startsWith("127.") || ip === "::1") return next();
  const now = Date.now();
  if (!(app as any).__ipRates) (app as any).__ipRates = new Map();
  const rates = (app as any).__ipRates as Map<string, { count: number; windowStart: number }>;
  const entry = rates.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    rates.set(ip, { count: 1, windowStart: now });
    return next();
  }
  if (entry.count >= 200) {
    return res.status(429).json({ message: "Too many requests. Please slow down." });
  }
  entry.count++;
  next();
});

app.use(compression({ level: 6, threshold: 1024 }));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  jsonParser(req, res, (err) => {
    if (err) return next(err);
    urlencodedParser(req, res, next);
  });
});

// Real health check — measures actual event loop lag and memory.
// If the event loop is stuck (e.g., runaway CPU), this returns 503.
app.get("/health", (_req, res) => {
  const start = process.hrtime.bigint();
  setImmediate(() => {
    const lagMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const mem = process.memoryUsage();
    const healthy = lagMs < 2000;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      eventLoopLagMs: Math.round(lagMs),
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
});

const CSP_HEADER = "default-src 'self' https: http:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; " +
  "style-src 'self' 'unsafe-inline' https: http:; " +
  "font-src 'self' https: http: data:; " +
  "img-src 'self' data: blob: https: http:; " +
  "media-src 'self' blob:; " +
  "connect-src 'self' wss: ws: https: http:; " +
  "frame-src 'self' https: http:; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "base-uri 'self';";

app.use((req, res, next) => {
  if (req.path.startsWith("/assets/")) return next();

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Content-Security-Policy", CSP_HEADER);

  if (req.path.startsWith("/api/")) {
    const isLongRunning = req.path.startsWith("/api/transcribe") || req.path.startsWith("/api/tts") || req.path.startsWith("/api/video-captions");
    const isStreaming = req.path.includes("/messages") && req.method === "POST";
    if (!isStreaming) {
      const timeout = isLongRunning ? 60000 : 30000;
      res.setTimeout(timeout, () => {
        if (!res.headersSent) {
          res.status(408).json({ message: "Request timeout" });
        }
      });
      res.on("finish", () => { res.setTimeout(0); });
    }
  }
  next();
});

app.use(crawlerPrerender);

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /chat/

Sitemap: https://junotalk.app/sitemap.xml
`);
});

app.get("/sitemap.xml", (_req, res) => {
  const now = new Date().toISOString().split("T")[0];
  const pages = [
    { loc: "/", priority: "1.0", freq: "weekly" },
    { loc: "/voice-translate", priority: "0.9", freq: "weekly" },
    { loc: "/travel-esim", priority: "0.9", freq: "weekly" },
    { loc: "/earning", priority: "0.7", freq: "monthly" },
    { loc: "/privacy", priority: "0.5", freq: "monthly" },
    { loc: "/support", priority: "0.5", freq: "monthly" },
    { loc: "/feedback", priority: "0.4", freq: "monthly" },
  ];
  const urls = pages.map(p => `  <url>
    <loc>https://junotalk.app${p.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
  });

  next();
});

(async () => {
  startPiperTTS();

  initProjectState().catch((err: any) => {
    console.warn("[Startup] ProjectState init failed (non-fatal):", err?.message);
  });

  initArenaLLM();

  await seedDatabase();

  initEmbeddingService().then(async () => {
    // Delay seeding to 90 s so the cold-boot DB load (auth, migrations, GitHub
    // CDN fetches) has settled before we write 472 phrase pairs.
    // Previously 30 s — moved out to prevent the startup DB pressure from
    // stalling dashboard queries (rooms list) and showing infinite skeletons.
    setTimeout(async () => {
      try {
        const { precomputeTranslationEmbeddings, isVectorReady } = await import("./embedding-service");
        const { COMMON_PHRASES, githubFallbackCache } = await import("./translation-fallback");
        if (!isVectorReady()) return;
        const merged: Record<string, Record<string, Record<string, string>>> = {};
        for (const source of [COMMON_PHRASES, githubFallbackCache]) {
          for (const [src, targets] of Object.entries(source)) {
            if (!merged[src]) merged[src] = {};
            for (const [tgt, pairs] of Object.entries(targets)) {
              if (!merged[src][tgt]) merged[src][tgt] = {};
              Object.assign(merged[src][tgt], pairs);
            }
          }
        }
        await precomputeTranslationEmbeddings(merged);
      } catch (err: any) {
        console.warn("[Server] Auto-precompute skipped:", err.message);
      }
    }, 90000);
  }).catch(err => {
    console.warn("[Server] Embedding service init failed (non-fatal):", err);
  });

  supabaseStorageService.ensureBuckets().catch((err) => {
    console.warn("[Startup] Supabase bucket init:", err?.message);
  });

  await registerRoutes(httpServer, app);

  setupSocketIO(httpServer);

  startMetricsFlush();

  import("./juno-archive").then(({ startWeeklyArchiveScheduler }) => {
    startWeeklyArchiveScheduler();
  }).catch(() => {});

  // ── CDN Bootstrap — runs once at startup ──────────────────────────────────
  // Autonomously creates any missing config files on the CDN using default values.
  // If files already exist, leaves them untouched. Falls back to hardcoded
  // defaults silently if the CDN is unreachable. No manual pushes ever needed.
  import("./cdn-bootstrap").then(({ bootstrapCdnConfigs }) => {
    bootstrapCdnConfigs().catch(() => {});
  }).catch(() => {});

  // Load image generation config from CDN (ai-images/config.json).
  import("./image-config").then(({ loadImageConfig }) => {
    loadImageConfig().catch(() => {});
  }).catch(() => {});

  // Autonomous learner — pulls from open-source AI repos every 24h.
  // First cycle fires 2 minutes after startup, then repeats daily.
  import("./open-source-learner").then(({ startAutonomousLearner }) => {
    startAutonomousLearner();
  }).catch(() => {});

  // Pre-warm all CDN configs so first Juno request has zero latency.
  import("./translation-intent").then(({ preloadTranslationIntentConfig }) => {
    preloadTranslationIntentConfig().catch(() => {});
  }).catch(() => {});

  import("./juno-adaptive-policy").then(({ preloadAdaptivePolicyConfig }) => {
    preloadAdaptivePolicyConfig().catch(() => {});
  }).catch(() => {});

  import("./juno-intelligence-layer").then(({ preloadIntelligenceLayerConfig }) => {
    preloadIntelligenceLayerConfig().catch(() => {});
  }).catch(() => {});

  import("./juno-learner").then(({ preloadLearnerConfig }) => {
    preloadLearnerConfig().catch(() => {});
  }).catch(() => {});


  startAgentQueue((result) => {
    const io = getIO();
    if (!io) return;
    const chatNs = io.of("/chat");
    const senderSocket = chatNs.sockets.get(result.senderSocketId);
    if (senderSocket) {
      senderSocket.to(result.roomCode).emit("message-translated", {
        messageId: result.messageId,
        roomCode: result.roomCode,
        translatedText: result.translatedText,
        targetLang: result.targetLang,
      });
    } else {
      chatNs.to(result.roomCode).emit("message-translated", {
        messageId: result.messageId,
        roomCode: result.roomCode,
        translatedText: result.translatedText,
        targetLang: result.targetLang,
      });
    }
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AgentQueue] Init failed, using inline fallback:", msg);
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  import("./juno-safety").then(({ getSafetyStats }) => {
    const s = getSafetyStats();
    console.log(`[JunoSafety] Behavioral alignment loaded: ${s.totalRules} rules, ${s.categories.length} categories, ${s.promptInjectionPatterns} injection guards`);
  }).catch(() => {});

  import("./start-vision-detector").then(({ ensureVisionDetectorStarted }) => {
    ensureVisionDetectorStarted();
    console.log("[Startup] Vision detector warm-up initiated");
  }).catch((err: any) => {
    console.warn("[Startup] Vision detector warm-up skipped:", err?.message);
  });

  import("./start-whisper-sidecar").then(({ ensureWhisperSidecarStarted }) => {
    ensureWhisperSidecarStarted();
    console.log("[Startup] Whisper sidecar warm-up initiated");
  }).catch((err: any) => {
    console.warn("[Startup] Whisper sidecar warm-up skipped:", err?.message);
  });

  // Start Redis memory guard — loads limits from GitHub CDN, checks every N minutes
  setTimeout(() => {
    import("./redis-cache").then(({ startRedisMemoryGuard }) => {
      startRedisMemoryGuard().catch((err: any) => {
        console.warn("[Startup] Redis memory guard skipped:", err?.message);
      });
    }).catch(() => {});
  }, 5000); // give Redis 5s to fully connect first

  const port = parseInt(process.env.PORT || "5000", 10);

  // Pre-emptively release the port if an old process is still holding it.
  // This prevents EADDRINUSE crashes during rapid workflow restarts.
  try {
    const { execSync } = await import("child_process");
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 300));
  } catch { /* non-fatal */ }

  function startListening() {
    httpServer.listen({ port, host: "0.0.0.0" }, () => {
      log(`serving on port ${port}`);
    });
  }

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${port} still busy — retrying in 1s...`);
      setTimeout(async () => {
        try {
          const { execSync } = await import("child_process");
          execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: "ignore" });
          await new Promise((r) => setTimeout(r, 300));
        } catch { /* non-fatal */ }
        httpServer.removeAllListeners("error");
        startListening();
      }, 1000);
    } else {
      throw err;
    }
  });

  startListening();

  // Tune keep-alive so connections don't outlive a load-balancer's idle timeout
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout   = 66_000;

  function shutdown(signal: string) {
    log(`[Resilience] ${signal} received — graceful shutdown starting`);

    // 1. Warn all connected Socket.IO clients so they start reconnecting NOW
    //    rather than waiting for the TCP drop to be detected (saves ~5-10s).
    try {
      const ioInstance = getIO();
      if (ioInstance) {
        ioInstance.emit("server:restarting");
        log("[Resilience] Notified all Socket.IO clients to reconnect");
      }
    } catch { /* non-fatal */ }

    // 2. Stop accepting new HTTP connections
    httpServer.close(() => {
      log("[Resilience] All connections drained. Exiting cleanly.");
      process.exit(0);
    });

    // 3. Immediately close all idle keep-alive connections (Node 18.2+).
    //    Active in-flight requests are allowed to finish naturally.
    try { (httpServer as any).closeIdleConnections?.(); } catch { /* non-fatal */ }

    // 4. Stop background workers
    stopPiperTTS();
    stopAgentQueue().catch(() => {});

    // 5. Force-exit after 8s — never leave a zombie process
    setTimeout(() => {
      log("[Resilience] Force exit after 8s timeout.");
      process.exit(1);
    }, 8_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
})();
