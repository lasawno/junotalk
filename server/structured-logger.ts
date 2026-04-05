import crypto from "crypto";

const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const SERVICE_NAME = "junotalk";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogAction =
  | "message_send"
  | "translation_request"
  | "translation_complete"
  | "translation_failed"
  | "video_session_start"
  | "video_session_end"
  | "camera_stream_open"
  | "camera_stream_close"
  | "ai_processing"
  | "auth_login"
  | "auth_logout"
  | "room_create"
  | "room_join"
  | "socket_connect"
  | "socket_disconnect"
  | "health_check"
  | "cache_hit"
  | "cache_miss"
  | "security_alert"
  | "translation_preloaded";

export interface LogContext {
  userId?: string;
  roomId?: string;
  correlationId?: string;
  provider?: string;
  sourceLang?: string;
  targetLang?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  action: LogAction;
  service: string;
  version: string;
  correlationId: string;
  userId?: string;
  roomId?: string;
  message: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

const recentLogs: StructuredLogEntry[] = [];
const MAX_RECENT_LOGS = 500;

const actionCounters: Record<string, number> = {};

export function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function structuredLog(
  level: LogLevel,
  action: LogAction,
  message: string,
  context: LogContext = {}
): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    action,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    correlationId: context.correlationId || generateCorrelationId(),
    message,
  };

  if (context.userId) entry.userId = context.userId;
  if (context.roomId) entry.roomId = context.roomId;
  if (context.durationMs !== undefined) entry.durationMs = context.durationMs;

  const meta: Record<string, unknown> = {};
  if (context.provider) meta.provider = context.provider;
  if (context.sourceLang) meta.sourceLang = context.sourceLang;
  if (context.targetLang) meta.targetLang = context.targetLang;
  if (context.error) meta.error = context.error;
  if (context.metadata) Object.assign(meta, context.metadata);
  if (Object.keys(meta).length > 0) entry.metadata = meta;

  actionCounters[action] = (actionCounters[action] || 0) + 1;

  recentLogs.push(entry);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
  }

  const logLine = JSON.stringify(entry);
  switch (level) {
    case "error":
      console.error(`[SLOG] ${logLine}`);
      break;
    case "warn":
      console.warn(`[SLOG] ${logLine}`);
      break;
    case "debug":
      if (process.env.LOG_LEVEL === "debug") {
        console.log(`[SLOG] ${logLine}`);
      }
      break;
    default:
      console.log(`[SLOG] ${logLine}`);
  }

  return entry;
}

export function getRecentLogs(limit = 50, action?: LogAction): StructuredLogEntry[] {
  let filtered = recentLogs;
  if (action) {
    filtered = recentLogs.filter(l => l.action === action);
  }
  return filtered.slice(-limit);
}

export function getLogStats(): {
  totalLogged: number;
  actionCounts: Record<string, number>;
  recentCount: number;
} {
  return {
    totalLogged: Object.values(actionCounters).reduce((a, b) => a + b, 0),
    actionCounts: { ...actionCounters },
    recentCount: recentLogs.length,
  };
}
