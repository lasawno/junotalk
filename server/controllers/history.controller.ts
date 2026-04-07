/**
 * Conversation History Controller
 * Isolated module — owns all CRUD for persisted chat and voice sessions.
 * Backed by PostgreSQL via the storage layer. No GitHub CDN dependency.
 */

import type { Request, Response } from "express";
import { storage } from "../storage";

function getUserId(req: Request): string | null {
  return (req as any).user?.claims?.sub || (req as any).user?.id || null;
}

/** GET /api/v1/history — list all sessions for the authenticated user */
export async function listHistory(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const sessions = await storage.getHistory(userId);
    return res.json({ sessions });
  } catch (err: any) {
    console.error("[History] listHistory error:", err.message);
    return res.status(500).json({ error: "Failed to load history" });
  }
}

/** PUT /api/v1/history/:sessionId — create or update a session */
export async function upsertSession(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { sessionId } = req.params;
  const { title, mode, messages } = req.body;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }
  if (messages.length < 2) {
    return res.status(400).json({ error: "Session must have at least 2 messages" });
  }
  try {
    const session = await storage.upsertSession(userId, {
      sessionId,
      title: String(title || "Conversation").slice(0, 200),
      mode: mode === "voice" ? "voice" : "chat",
      messages,
    });
    return res.json({ session });
  } catch (err: any) {
    console.error("[History] upsertSession error:", err.message);
    return res.status(500).json({ error: "Failed to save session" });
  }
}

/** DELETE /api/v1/history/:sessionId — delete one session */
export async function deleteSession(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const sessionId = req.params.sessionId as string;
  try {
    await storage.deleteSession(userId, sessionId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[History] deleteSession error:", err.message);
    return res.status(500).json({ error: "Failed to delete session" });
  }
}

/** DELETE /api/v1/history — clear all sessions for the user */
export async function clearHistory(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    await storage.clearHistory(userId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[History] clearHistory error:", err.message);
    return res.status(500).json({ error: "Failed to clear history" });
  }
}
