import { Router } from "express";
import { junoController } from "../juno-controller";
import { runOSINTPipeline, getOSINTSources } from "../osint-pipeline";
import { searchKnowledge, answerQuestion, getKnowledgeStats, pushKnowledgeToGitHub } from "../juno-knowledge";
import { readFile } from "fs/promises";
import path from "path";

export function createJunoRouter(deps: {
  isAuthenticated: any;
  isAdminRequest: (req: any) => boolean;
}) {
  const router = Router();
  const { isAuthenticated, isAdminRequest } = deps;

  router.get("/juno/status", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const state = junoController.getState();
    res.json(state);
  });

  router.post("/juno/ping", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const result = await junoController.pingClaude();
    res.json(result);
  });

  router.post("/juno/ask", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { prompt, vaultFiles } = req.body;
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt is required" });
    const validVaultFiles = Array.isArray(vaultFiles)
      ? vaultFiles.filter((f: unknown) => typeof f === "string" && f.endsWith(".md"))
      : undefined;
    try {
      const result = await junoController.askClaudeWithVault(prompt, validVaultFiles);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: "Juno request failed" });
    }
  });

  router.get("/juno/vault", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const files = await junoController.listVaultFiles();
    res.json({ files });
  });

  router.post("/juno/refresh", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    junoController.refreshConnectors();
    res.json(junoController.getState());
  });

  router.post("/juno/osint/run", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const { skipGitHub, langPairs, maxTatoeba } = req.body || {};
    try {
      const stats = await runOSINTPipeline({ skipGitHub, langPairs, maxTatoeba });
      res.json({ success: true, stats });
    } catch (err: any) {
      res.status(500).json({ error: "OSINT pipeline failed", message: err.message });
    }
  });

  router.get("/juno/osint/sources", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json({ sources: getOSINTSources() });
  });

  router.post("/juno/ask-knowledge", isAuthenticated, async (req: any, res) => {
    const { question } = req.body;
    if (!question || typeof question !== "string") return res.status(400).json({ error: "question is required" });

    const result = answerQuestion(question);
    if (result) {
      res.json({ answered: true, ...result });
    } else {
      res.json({ answered: false, message: "No matching knowledge found. Try asking Juno directly." });
    }
  });

  router.get("/juno/knowledge/search", isAuthenticated, async (req: any, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "q parameter required" });
    const limit = parseInt(req.query.limit as string) || 5;
    const results = searchKnowledge(query, limit);
    res.json({ results: results.map(r => ({ question: r.entry.q, answer: r.entry.a, category: r.entry.category, relevance: r.relevance })) });
  });

  router.get("/juno/knowledge/stats", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    res.json(getKnowledgeStats());
  });

  router.post("/juno/knowledge/push", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const pushed = await pushKnowledgeToGitHub();
      res.json({ success: true, pushed });
    } catch (err: any) {
      res.status(500).json({ error: "Push failed", message: err.message });
    }
  });

  router.get("/juno/osint/stats", isAuthenticated, async (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const reportPath = path.resolve(process.cwd(), "vault/osint/last-run.md");
      const report = await readFile(reportPath, "utf-8");
      res.json({ report });
    } catch {
      res.json({ report: null, message: "No OSINT runs recorded yet" });
    }
  });

  return router;
}
