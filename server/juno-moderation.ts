/**
 * JUNO MODERATION SYSTEM
 * Covers: risk scoring (#11), ban enforcement (#12), impersonation detection (#4),
 * per-user WebSocket rate limiting (#5), TURN token auth (#13), audit logging (#14)
 */

import { db } from "./db";
import { userBans, userRiskScores, auditLogs, userBlocks, userReports } from "@shared/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import crypto from "crypto";

// ─── In-memory WS rate limiter (#5) ──────────────────────────────────────────
const wsMessageRates = new Map<string, { count: number; windowStart: number }>();
const WS_LIMIT = 30;
const WS_WINDOW_MS = 10_000;

export function checkWsMessageRate(userId: string): boolean {
  const now = Date.now();
  const entry = wsMessageRates.get(userId);
  if (!entry || now - entry.windowStart > WS_WINDOW_MS) {
    wsMessageRates.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= WS_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── In-memory IP rate limiter (#5) ──────────────────────────────────────────
const ipRates = new Map<string, { count: number; windowStart: number }>();
const IP_LIMIT = 200;
const IP_WINDOW_MS = 60_000;

export function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const entry = ipRates.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipRates.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= IP_LIMIT) return false;
  entry.count++;
  return true;
}

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of wsMessageRates) if (now - v.windowStart > WS_WINDOW_MS * 2) wsMessageRates.delete(k);
  for (const [k, v] of ipRates) if (now - v.windowStart > IP_WINDOW_MS * 2) ipRates.delete(k);
}, 300_000);

// ─── Impersonation detection (#4) ────────────────────────────────────────────
const IMPERSONATION_PATTERNS = [
  /\b(i\s+am|i'm|this\s+is)\s+(juno|junotalk\s+support|junotalk\s+team|junotalk\s+admin|official\s+junotalk)\b/i,
  /\b(junotalk\s+staff|junotalk\s+mod|platform\s+admin|system\s+admin)\b/i,
  /\b(verify\s+your\s+(account|identity|payment)\s+(by\s+)?(clicking|sending|providing))\b/i,
  /\b(your\s+account\s+(will\s+be\s+)?(suspended|deleted|banned)\s+(unless|if\s+you\s+don't))\b/i,
];

export function detectImpersonation(text: string, username?: string): boolean {
  return IMPERSONATION_PATTERNS.some(p => p.test(text));
}

// ─── Risk scoring (#11) ───────────────────────────────────────────────────────
export type RiskFlag =
  | "safety_violation"
  | "spam"
  | "impersonation"
  | "rate_limit_exceeded"
  | "report_received"
  | "translation_violation";

const RISK_WEIGHTS: Record<RiskFlag, number> = {
  safety_violation: 25,
  spam: 15,
  impersonation: 35,
  rate_limit_exceeded: 5,
  report_received: 10,
  translation_violation: 20,
};

const inMemoryRiskScores = new Map<string, { score: number; violations: number; flags: string[] }>();

export async function addRiskFlag(userId: string, flag: RiskFlag): Promise<number> {
  const weight = RISK_WEIGHTS[flag] ?? 10;
  const existing = inMemoryRiskScores.get(userId) ?? { score: 0, violations: 0, flags: [] };
  const newScore = Math.min(existing.score + weight, 100);
  const updated = {
    score: newScore,
    violations: existing.violations + 1,
    flags: [...new Set([...existing.flags, flag])],
  };
  inMemoryRiskScores.set(userId, updated);

  try {
    await db.insert(userRiskScores).values({
      userId,
      score: updated.score,
      flags: updated.flags,
      lastViolation: flag,
      violations: updated.violations,
    }).onConflictDoUpdate({
      target: userRiskScores.userId,
      set: {
        score: updated.score,
        flags: updated.flags,
        lastViolation: flag,
        violations: updated.violations,
        updatedAt: new Date(),
      },
    });
  } catch {}

  return newScore;
}

export function getRiskScore(userId: string): number {
  return inMemoryRiskScores.get(userId)?.score ?? 0;
}

// ─── Ban system (#12) ────────────────────────────────────────────────────────
const banCache = new Map<string, { active: boolean; expiresAt: Date | null }>();

export async function isUserBanned(userId: string): Promise<boolean> {
  const cached = banCache.get(userId);
  if (cached) {
    if (!cached.active) return false;
    if (cached.expiresAt && new Date() > cached.expiresAt) {
      banCache.set(userId, { active: false, expiresAt: null });
      return false;
    }
    return true;
  }

  try {
    const bans = await db.select().from(userBans)
      .where(and(eq(userBans.userId, userId), eq(userBans.active, true)))
      .limit(1);

    if (bans.length === 0) {
      banCache.set(userId, { active: false, expiresAt: null });
      return false;
    }

    const ban = bans[0];
    if (ban.type === "temporary" && ban.expiresAt && new Date() > ban.expiresAt) {
      banCache.set(userId, { active: false, expiresAt: null });
      await db.update(userBans).set({ active: false }).where(eq(userBans.id, ban.id));
      return false;
    }

    banCache.set(userId, { active: true, expiresAt: ban.expiresAt ?? null });
    return true;
  } catch {
    return false;
  }
}

export async function banUser(
  userId: string,
  reason: string,
  bannedBy: string,
  type: "temporary" | "permanent" = "temporary",
  durationHours = 24
): Promise<void> {
  const expiresAt = type === "temporary" ? new Date(Date.now() + durationHours * 3_600_000) : null;
  try {
    await db.insert(userBans).values({ userId, reason, bannedBy, type, expiresAt, active: true });
    banCache.set(userId, { active: true, expiresAt });
    await writeAuditLog({
      actorId: bannedBy,
      targetId: userId,
      action: `user_ban_${type}`,
      category: "moderation",
      detail: reason,
      severity: "high",
    });
  } catch (err: any) {
    console.error("[JunoModeration] Ban failed:", err.message);
  }
}

// Auto-ban when risk score exceeds threshold
export async function checkRiskAutoban(userId: string): Promise<boolean> {
  const score = getRiskScore(userId);
  if (score >= 75) {
    const already = await isUserBanned(userId);
    if (!already) {
      await banUser(userId, "Automated: risk score exceeded threshold", "system", "temporary", 48);
      console.log(`[JunoModeration] Auto-ban triggered for user ${userId} (risk score: ${score})`);
      return true;
    }
  }
  return false;
}

// ─── Audit logging (#14) ─────────────────────────────────────────────────────
interface AuditEntry {
  actorId?: string;
  targetId?: string;
  action: string;
  category: string;
  detail?: string;
  ipAddress?: string;
  severity?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      targetId: entry.targetId ?? null,
      action: entry.action,
      category: entry.category,
      detail: entry.detail ?? null,
      ipAddress: entry.ipAddress ?? null,
      severity: entry.severity ?? "info",
    });
  } catch {}
}

// ─── TURN token auth (#13) ───────────────────────────────────────────────────
// Generates time-limited TURN credentials using HMAC-SHA1 (standard WebRTC pattern)
const TURN_SECRET = process.env.TURN_SECRET || crypto.randomBytes(32).toString("hex");
const TURN_TTL_SECONDS = 3600;

export function generateTurnCredentials(userId: string): { username: string; credential: string; ttl: number } {
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
  return { username, credential, ttl: TURN_TTL_SECONDS };
}

// ─── Block check helper ───────────────────────────────────────────────────────
const blockCache = new Map<string, Set<string>>();

export async function isBlocked(blockerId: string, targetId: string): Promise<boolean> {
  const cached = blockCache.get(blockerId);
  if (cached) return cached.has(targetId);

  try {
    const blocks = await db.select().from(userBlocks).where(eq(userBlocks.blockerId, blockerId));
    const ids = new Set(blocks.map(b => b.blockedId));
    blockCache.set(blockerId, ids);
    return ids.has(targetId);
  } catch {
    return false;
  }
}

export function invalidateBlockCache(userId: string): void {
  blockCache.delete(userId);
}

// ─── Report / Block CRUD (called from API routes) ─────────────────────────────
export async function submitReport(
  reporterId: string,
  reportedId: string,
  reason: string,
  detail?: string
): Promise<void> {
  await db.insert(userReports).values({ reporterId, reportedId, reason, detail: detail ?? null });
  await addRiskFlag(reportedId, "report_received");
  await writeAuditLog({ actorId: reporterId, targetId: reportedId, action: "user_reported", category: "moderation", detail: reason, severity: "medium" });
}

export async function blockUser(blockerId: string, blockedId: string, type: "block" | "mute" = "block"): Promise<void> {
  await db.insert(userBlocks).values({ blockerId, blockedId, type }).onConflictDoNothing();
  invalidateBlockCache(blockerId);
  await writeAuditLog({ actorId: blockerId, targetId: blockedId, action: `user_${type}ed`, category: "moderation", severity: "info" });
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await db.delete(userBlocks).where(
    and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId))
  );
  invalidateBlockCache(blockerId);
}

export async function getBlockList(blockerId: string): Promise<string[]> {
  const rows = await db.select({ blockedId: userBlocks.blockedId })
    .from(userBlocks).where(eq(userBlocks.blockerId, blockerId));
  return rows.map(r => r.blockedId);
}

export async function getActiveBan(userId: string) {
  const rows = await db.select().from(userBans)
    .where(and(eq(userBans.userId, userId), eq(userBans.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Module stats ─────────────────────────────────────────────────────────────
export function getModerationStats() {
  return {
    wsRateLimitEntries: wsMessageRates.size,
    ipRateLimitEntries: ipRates.size,
    banCacheEntries: banCache.size,
    riskScoreEntries: inMemoryRiskScores.size,
    blockCacheEntries: blockCache.size,
  };
}
