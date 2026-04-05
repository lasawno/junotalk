import { Router } from "express";
import type Anthropic from "@anthropic-ai/sdk";

export function createFeedbackRouter(deps: {
  isAuthenticated: any;
  storage: any;
  trackAction: (action: string, feature: string) => void;
  anthropic: Anthropic;
  resolvedAnthropicKey: string | undefined;
}) {
  const router = Router();
  const { isAuthenticated, storage, trackAction, anthropic, resolvedAnthropicKey } = deps;

  router.get("/feedback", isAuthenticated, async (req, res) => {
    try {
      const allFeedback = await storage.getAllFeedback();
      res.json(allFeedback);
    } catch (error) {
      console.error("Error fetching feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  router.post("/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      trackAction("submit_feedback", "feedback");
      const { firstName, comment } = req.body;

      if (!firstName || !comment) {
        return res.status(400).json({ message: "First name and comment are required" });
      }

      const newFeedback = await storage.createFeedback({
        userId,
        firstName,
        comment,
      });

      res.status(201).json(newFeedback);
    } catch (error) {
      console.error("Error creating feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  router.get("/feedback/all", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.query.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allFeedback = await storage.getAllFeedback();
      res.json(allFeedback);
    } catch (error) {
      console.error("Error fetching all feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  router.patch("/feedback/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !["needs_work", "resolved"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const updated = await storage.updateFeedbackStatus(id, status);
      if (!updated) return res.status(404).json({ message: "Feedback not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating feedback status:", error);
      res.status(500).json({ message: "Failed to update feedback" });
    }
  });

  router.post("/feedback/:id/ai-review", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { id } = req.params;
      const allFeedback = await storage.getAllFeedback();
      const item = allFeedback.find((f: any) => f.id === id);
      if (!item) return res.status(404).json({ message: "Feedback not found" });

      let aiReview = "";
      if (resolvedAnthropicKey) {
        try {
          const claudeRes = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 500,
            messages: [{
              role: "user",
              content: `You are a product QA analyst for JunoTalk, a video calling and chat platform. Review this user feedback and provide a brief analysis:\n\nFeedback from "${item.firstName}": "${item.comment}"\n\nRespond with:\n1. Category (bug, feature request, UX issue, compliment, other)\n2. Priority (low, medium, high)\n3. Brief assessment (1-2 sentences) of what needs to be done or if it's already addressed\n4. Recommendation: "needs_work" or "resolved"\n\nKeep response concise and actionable.`,
            }],
          });
          const block = claudeRes.content[0];
          if (block.type === "text") aiReview = block.text;
        } catch (err: any) {
          console.warn("Claude AI review failed:", err?.message);
          aiReview = "AI review unavailable - manual review required.";
        }
      } else {
        aiReview = "AI review unavailable - no API key configured.";
      }

      const suggestedStatus = aiReview.toLowerCase().includes("resolved") ? "resolved" : "needs_work";
      const updated = await storage.updateFeedbackStatus(id, suggestedStatus, aiReview);
      res.json(updated);
    } catch (error) {
      console.error("Error running AI review:", error);
      res.status(500).json({ message: "Failed to run AI review" });
    }
  });

  router.post("/feedback/ai-review-all", isAuthenticated, async (req: any, res) => {
    try {
      const accessCode = req.body.accessCode as string;
      const adminCode = process.env.DEV_PORTAL_ACCESS_CODE;
      if (!adminCode || accessCode !== adminCode) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allFeedback = await storage.getAllFeedback();
      const unreviewed = allFeedback.filter((f: any) => !f.aiReview);
      let reviewed = 0;

      for (const item of unreviewed.slice(0, 20)) {
        if (resolvedAnthropicKey) {
          try {
            const claudeRes = await anthropic.messages.create({
              model: "claude-haiku-4-5",
              max_tokens: 500,
              messages: [{
                role: "user",
                content: `You are a product QA analyst for JunoTalk, a video calling and chat platform. Review this user feedback and provide a brief analysis:\n\nFeedback from "${item.firstName}": "${item.comment}"\n\nRespond with:\n1. Category (bug, feature request, UX issue, compliment, other)\n2. Priority (low, medium, high)\n3. Brief assessment (1-2 sentences) of what needs to be done or if it's already addressed\n4. Recommendation: "needs_work" or "resolved"\n\nKeep response concise and actionable.`,
              }],
            });
            const block = claudeRes.content[0];
            if (block.type === "text") {
              const review = block.text;
              const suggestedStatus = review.toLowerCase().includes("resolved") ? "resolved" : "needs_work";
              await storage.updateFeedbackStatus(item.id, suggestedStatus, review);
              reviewed++;
            }
          } catch (err: any) {
            console.warn("Claude AI review failed for feedback:", item.id, err?.message);
          }
        }
      }

      res.json({ reviewed, total: unreviewed.length });
    } catch (error) {
      console.error("Error running batch AI review:", error);
      res.status(500).json({ message: "Failed to run batch AI review" });
    }
  });

  return router;
}
