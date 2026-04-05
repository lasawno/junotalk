import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { apiKeys } from "./api-keys";

export interface JunoConnectorStatus {
  name: string;
  connected: boolean;
  error?: string;
  lastChecked: number;
}

export interface JunoControllerState {
  ready: boolean;
  connectors: Record<string, JunoConnectorStatus>;
  lastActivity: number;
}

interface DeepgramConfig {
  apiKey: string;
  model?: string;
  language?: string;
}

interface VaultDocument {
  filename: string;
  content: string;
  path: string;
}

const VAULT_DIR = path.resolve(process.cwd(), "vault");

class JunoController {
  private anthropic: Anthropic | null = null;
  private deepgramConfig: DeepgramConfig | null = null;
  private connectorStatus: Record<string, JunoConnectorStatus> = {};
  private lastActivity = 0;

  constructor() {
    this.initConnectors();
  }

  private initConnectors() {
    this.anthropic = null;
    this.deepgramConfig = null;
    const anthropicKey = apiKeys.anthropic();
    const anthropicBaseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    if (anthropicKey) {
      this.anthropic = new Anthropic({
        apiKey: anthropicKey,
        ...(anthropicBaseURL ? { baseURL: anthropicBaseURL } : {}),
      });
      this.connectorStatus.claude = { name: "Claude", connected: true, lastChecked: Date.now() };
    } else {
      this.connectorStatus.claude = { name: "Claude", connected: false, error: "Anthropic API key not set", lastChecked: Date.now() };
    }

    if (process.env.DEEPGRAM_API_KEY) {
      this.deepgramConfig = {
        apiKey: process.env.DEEPGRAM_API_KEY,
        model: process.env.DEEPGRAM_MODEL || "nova-2",
        language: process.env.DEEPGRAM_LANGUAGE || "en",
      };
      this.connectorStatus.deepgram = { name: "Deepgram", connected: true, lastChecked: Date.now() };
    } else {
      this.connectorStatus.deepgram = { name: "Deepgram", connected: false, error: "DEEPGRAM_API_KEY not set", lastChecked: Date.now() };
    }

    this.connectorStatus.vault = { name: "Obsidian Vault", connected: true, lastChecked: Date.now() };
  }

  getState(): JunoControllerState {
    return {
      ready: !!this.anthropic,
      connectors: { ...this.connectorStatus },
      lastActivity: this.lastActivity,
    };
  }

  async pingClaude(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.anthropic) return { ok: false, error: "Claude not configured" };
    try {
      const resp = await this.anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "Reply OK" }],
      });
      this.connectorStatus.claude = { name: "Claude", connected: true, lastChecked: Date.now() };
      this.lastActivity = Date.now();
      return { ok: true, model: resp.model };
    } catch (err: any) {
      this.connectorStatus.claude = { name: "Claude", connected: false, error: err.message, lastChecked: Date.now() };
      return { ok: false, error: err.message };
    }
  }

  async askClaude(prompt: string, context?: string): Promise<{ response: string; usage?: any; error?: string }> {
    if (!this.anthropic) return { response: "", error: "Claude not configured" };
    try {
      const systemPrompt = context
        ? `You are Juno, an AI co-worker for JunoTalk. You have access to the following context from the knowledge vault:\n\n${context}\n\nUse this context to inform your responses.`
        : "You are Juno, an AI co-worker for JunoTalk — a real-time translation and communication platform. You assist with platform analysis, translation quality, and system optimization.";

      const resp = await this.anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
      const block = resp.content[0];
      const text = block && block.type === "text" ? block.text : "";
      this.lastActivity = Date.now();
      return { response: text, usage: resp.usage };
    } catch (err: any) {
      return { response: "", error: err.message };
    }
  }

  async askClaudeWithVault(prompt: string, vaultFiles?: string[]): Promise<{ response: string; vaultDocsUsed: string[]; usage?: any; error?: string }> {
    const docs = await this.loadVaultDocuments(vaultFiles);
    const context = docs.map(d => `--- ${d.filename} ---\n${d.content}`).join("\n\n");
    const result = await this.askClaude(prompt, context || undefined);
    return { ...result, vaultDocsUsed: docs.map(d => d.filename) };
  }

  private async scanVaultDir(dir: string, prefix = ""): Promise<{ relativePath: string; fullPath: string }[]> {
    const results: { relativePath: string; fullPath: string }[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const s = await stat(fullPath);
          const relative = prefix ? `${prefix}/${entry}` : entry;
          if (s.isDirectory()) {
            const sub = await this.scanVaultDir(fullPath, relative);
            results.push(...sub);
          } else if (entry.endsWith(".md")) {
            results.push({ relativePath: relative, fullPath });
          }
        } catch {}
      }
    } catch {}
    return results;
  }

  async loadVaultDocuments(filenames?: string[]): Promise<VaultDocument[]> {
    const docs: VaultDocument[] = [];
    const allFiles = await this.scanVaultDir(VAULT_DIR);
    const targets = filenames
      ? allFiles.filter(f => filenames.some(name => f.relativePath === name || f.relativePath.endsWith(`/${name}`) || f.relativePath === `${name}`))
      : allFiles;

    for (const file of targets) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        docs.push({ filename: file.relativePath, content, path: file.fullPath });
      } catch {}
    }
    return docs;
  }

  async listVaultFiles(): Promise<string[]> {
    const allFiles = await this.scanVaultDir(VAULT_DIR);
    return allFiles.map(f => f.relativePath);
  }

  getDeepgramStatus(): JunoConnectorStatus {
    return this.connectorStatus.deepgram;
  }

  async transcribeWithDeepgram(_audioBuffer: Buffer, _mimetype: string): Promise<{ transcript: string; error?: string }> {
    if (!this.deepgramConfig) return { transcript: "", error: "Deepgram not configured — add DEEPGRAM_API_KEY" };
    return { transcript: "", error: "Deepgram SDK not yet installed — run: npm install @deepgram/sdk" };
  }

  refreshConnectors() {
    this.initConnectors();
  }
}

export const junoController = new JunoController();
