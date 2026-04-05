/**
 * Juno Conversation Archive Service
 *
 * Two-tier storage strategy:
 *   Tier 1 — PostgreSQL (hot):  live sessions, fast reads, last 7 days
 *   Tier 2 — GitHub (cold):     weekly snapshots, long-term history, per-user JSON files
 *
 * Weekly job flow:
 *   1. Fetch all non-archived conversations older than 7 days
 *   2. Group by userId, push each user's file to GitHub (with retries)
 *   3. Mark DB rows as archived=true immediately after a confirmed GitHub write
 *   4. Delete those rows to keep the DB lean
 *
 * Restart-safe:
 *   - Last-run timestamp is persisted to disk so the scheduler catches up after restarts
 *   - Conversations are marked archived=true in the DB before deletion, so a crash
 *     between the two steps won't cause double-archiving or data loss
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import * as path from "path";
import { storage } from "./storage";
import { pushPrivateFile, fetchPrivateFile } from "./github-config";

const ARCHIVE_DAYS = 30;
const ARCHIVE_PATH_PREFIX = "archives/juno-conversations";
const LAST_RUN_FILE = path.resolve(process.cwd(), "vault/archive-last-run.json");
const WEEK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PUSH_RETRIES = 3;

interface ArchivedSession {
  id: string;
  title: string;
  sessionType: string;
  durationSeconds: number;
  messages: any[];
  createdAt: string;
  updatedAt: string;
}

interface UserArchiveFile {
  userId: string;
  lastUpdated: string;
  sessions: ArchivedSession[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry a GitHub push up to MAX_PUSH_RETRIES times with exponential backoff. */
async function pushWithRetry(filePath: string, file: UserArchiveFile): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    const ok = await pushPrivateFile(
      filePath,
      file,
      `[archive] juno sessions for user ${file.userId.slice(0, 8)}`
    );
    if (ok) return true;
    if (attempt < MAX_PUSH_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
      console.warn(`[JunoArchive] Push attempt ${attempt} failed — retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
  return false;
}

/**
 * Fetch a user's existing archive file from GitHub.
 * Falls back to an empty archive if not found or on error.
 */
async function getUserArchiveFile(userId: string): Promise<UserArchiveFile> {
  const filePath = `${ARCHIVE_PATH_PREFIX}/${userId}.json`;
  try {
    const existing = await fetchPrivateFile(filePath);
    if (existing && Array.isArray(existing.sessions)) return existing as UserArchiveFile;
  } catch (err: any) {
    console.warn(`[JunoArchive] Could not fetch archive for user ${userId.slice(0, 8)}: ${err.message}`);
  }
  return { userId, lastUpdated: new Date().toISOString(), sessions: [] };
}

// ─── Last-run tracking ────────────────────────────────────────────────────────

async function readLastRunTime(): Promise<number> {
  try {
    const raw = await readFile(LAST_RUN_FILE, "utf-8");
    const obj = JSON.parse(raw);
    return typeof obj.lastRun === "number" ? obj.lastRun : 0;
  } catch {
    return 0;
  }
}

async function writeLastRunTime(): Promise<void> {
  try {
    await mkdir(path.dirname(LAST_RUN_FILE), { recursive: true });
    await writeFile(LAST_RUN_FILE, JSON.stringify({ lastRun: Date.now() }), "utf-8");
  } catch (err: any) {
    console.warn("[JunoArchive] Could not persist last-run timestamp:", err.message);
  }
}

// ─── Main archive job ─────────────────────────────────────────────────────────

export async function runWeeklyArchive(): Promise<{ archived: number; deleted: number; users: number }> {
  console.log("[JunoArchive] Starting archive job...");

  const oldConvs = await storage.getConversationsOlderThan(ARCHIVE_DAYS);
  if (!oldConvs.length) {
    console.log("[JunoArchive] No conversations to archive.");
    await writeLastRunTime();
    return { archived: 0, deleted: 0, users: 0 };
  }

  const byUser = new Map<string, typeof oldConvs>();
  for (const conv of oldConvs) {
    const list = byUser.get(conv.userId) ?? [];
    list.push(conv);
    byUser.set(conv.userId, list);
  }

  const confirmedIds: string[] = [];
  let usersProcessed = 0;

  for (const [userId, convs] of byUser) {
    try {
      const archiveFile = await getUserArchiveFile(userId);
      archiveFile.lastUpdated = new Date().toISOString();

      const existingIds = new Set(archiveFile.sessions.map((s) => s.id));
      for (const conv of convs) {
        if (!existingIds.has(conv.id)) {
          archiveFile.sessions.push({
            id: conv.id,
            title: conv.title ?? "Untitled",
            sessionType: conv.sessionType ?? "chat",
            durationSeconds: conv.durationSeconds ?? 0,
            messages: Array.isArray(conv.messages) ? (conv.messages as any[]) : [],
            createdAt: conv.createdAt?.toISOString() ?? "",
            updatedAt: conv.updatedAt?.toISOString() ?? "",
          });
        }
      }

      archiveFile.sessions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const ok = await pushWithRetry(`${ARCHIVE_PATH_PREFIX}/${userId}.json`, archiveFile);

      if (ok) {
        const ids = convs.map((c) => c.id);
        // Mark archived in the DB immediately — this is the safety checkpoint.
        // If the server crashes before the delete, these rows won't be re-processed
        // next time because getConversationsOlderThan filters for archived=false.
        await storage.markConversationsArchived(ids);
        confirmedIds.push(...ids);
        usersProcessed++;
        console.log(`[JunoArchive] Archived ${ids.length} session(s) for user ${userId.slice(0, 8)}`);
      } else {
        console.warn(
          `[JunoArchive] All push attempts failed for user ${userId.slice(0, 8)} — data kept in DB.`
        );
      }
    } catch (err: any) {
      console.error(
        `[JunoArchive] Unexpected error for user ${userId.slice(0, 8)}: ${err.message} — data kept in DB.`
      );
    }
  }

  // Hard-delete only rows that are confirmed archived to GitHub.
  if (confirmedIds.length > 0) {
    await storage.bulkDeleteJunoConversations(confirmedIds);
  }

  await writeLastRunTime();

  console.log(
    `[JunoArchive] Done — ${confirmedIds.length} session(s) archived across ${usersProcessed} user(s), removed from DB.`
  );
  return { archived: confirmedIds.length, deleted: confirmedIds.length, users: usersProcessed };
}

// ─── Fetch archived sessions (for history UI) ─────────────────────────────────

export async function fetchArchivedSessions(userId: string): Promise<ArchivedSession[]> {
  try {
    const file = await fetchPrivateFile(`${ARCHIVE_PATH_PREFIX}/${userId}.json`);
    if (file && Array.isArray(file.sessions)) return file.sessions as ArchivedSession[];
  } catch {}
  return [];
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let archiveTimer: NodeJS.Timeout | null = null;

/**
 * Start the archive scheduler.
 *
 * On startup, check when the archive last ran. If it is overdue (7+ days ago or
 * never), run immediately so restarts don't silently skip weeks. Then schedule
 * a recurring check every hour — the check is cheap (reads one small file) and
 * only triggers a full archive when actually overdue.
 */
export function startWeeklyArchiveScheduler(): void {
  if (archiveTimer) return;

  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour

  const maybeRun = async () => {
    try {
      const lastRun = await readLastRunTime();
      const overdue = Date.now() - lastRun >= WEEK_MS;
      if (overdue) {
        console.log("[JunoArchive] Overdue — running archive now.");
        await runWeeklyArchive();
      }
    } catch (err: any) {
      console.error("[JunoArchive] Scheduler check failed:", err.message);
    }
  };

  // Run the first check shortly after startup (give the DB time to initialize).
  setTimeout(maybeRun, 30 * 1000);

  // Then check every hour.
  archiveTimer = setInterval(maybeRun, CHECK_INTERVAL_MS);

  console.log("[JunoArchive] Weekly archive scheduler started (checks hourly, runs when overdue).");
}
