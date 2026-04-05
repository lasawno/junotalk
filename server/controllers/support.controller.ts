import { Router } from "express";
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import { answerQuestion } from "../juno-knowledge";
import { askOrb, clearOrbSession, getOrbStats } from "../juno-orb";

export function createSupportRouter(deps: {
  isAuthenticated: any;
  storage: any;
  moonshotClient: OpenAI;
  anthropic: Anthropic;
  resolvedAnthropicKey: string | undefined;
  shouldThrottleProvider: (provider: string) => boolean;
  trackTokenUsage: (provider: string, input: number, output: number, feature: string) => void;
}) {
  const router = Router();
  const { isAuthenticated, storage, moonshotClient, anthropic, shouldThrottleProvider, trackTokenUsage } = deps;

  router.post("/support/chat", isAuthenticated, async (req: any, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      const userId = req.user?.claims?.sub || req.user?.id || "anonymous";

      const result = await askOrb(userId, message, {
        moonshotClient,
        anthropic,
        shouldThrottleProvider,
        trackTokenUsage,
      });

      res.json({ reply: result.reply });
    } catch (error) {
      console.error("Support chat error:", error);
      res.status(500).json({ message: "Failed to get support response" });
    }
  });

  router.post("/support/session/clear", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || "anonymous";
      clearOrbSession(userId);
      res.json({ cleared: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear session" });
    }
  });

  router.get("/support/orb/stats", isAuthenticated, async (req: any, res) => {
    try {
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      const provided = req.headers["x-dev-portal-code"] || req.query.accessCode;
      if (!adminCode || provided !== adminCode) {
        return res.status(403).json({ message: "Admin access required" });
      }
      res.json(getOrbStats());
    } catch (error) {
      res.status(500).json({ message: "Failed to get orb stats" });
    }
  });

  router.post("/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const username = req.user.claims.first_name || req.user.claims.email || "Unknown";
      const { category, subject, description, priority } = req.body;

      if (!category || !subject || !description) {
        return res.status(400).json({ message: "Category, subject, and description are required" });
      }

      const validCategories = ["translation", "video", "audio", "text", "account", "other"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }

      const ticket = await storage.createSupportTicket({
        userId,
        username,
        category,
        subject,
        description,
        status: "open",
        priority: priority || "medium",
      });

      res.status(201).json(ticket);
    } catch (error) {
      console.error("Error creating support ticket:", error);
      res.status(500).json({ message: "Failed to create support ticket" });
    }
  });

  router.get("/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const tickets = await storage.getSupportTicketsByUser(userId);
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  router.get("/support/tickets/all", async (req, res) => {
    try {
      const { accessCode } = req.query;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      const tickets = await storage.getAllSupportTickets();
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching all support tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  router.patch("/support/tickets/:id", async (req, res) => {
    try {
      const { accessCode } = req.body;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Developer portal access required" });
      }
      const { id } = req.params;
      const { status, priority, adminNotes } = req.body;
      const updated = await storage.updateSupportTicket(id, { status, priority, adminNotes });
      if (!updated) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating support ticket:", error);
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  return router;
}
