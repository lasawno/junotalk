/**
 * JunoMonitor — Voice Response Quality Agent (CDN-backed)
 *
 * Intercepts every Juno voice response before TTS, checks it against
 * ChatGPT-parity rules loaded from GitHub CDN, and auto-fixes violations.
 *
 * CDN path: config/juno-monitor.json
 * Falls back to hardcoded defaults if CDN is unreachable.
 * Rules can be tuned on GitHub without a code deploy.
 */

import { fetchPrivateFile } from "./github-config";

// ── CDN path ──────────────────────────────────────────────────────────────────

export const JUNO_MONITOR_CDN_PATH = "config/juno-monitor.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JunoMonitorConfig {
  version: string;
  description: string;
  enabled: boolean;
  maxSentences: number;
  trimToSentences: number;
  rules: {
    stripDashes: boolean;
    stripMarkdown: boolean;
    stripFillerOpeners: boolean;
    fixTrailingEllipsis: boolean;
    enforceLength: boolean;
    cleanupPunctuation: boolean;
    blockLeakage: boolean;
  };
  fillerOpeners: string[];
  extractionPatterns: string[];
  leakageSignals: string[];
}

// ── Hardcoded defaults ────────────────────────────────────────────────────────

export const JUNO_MONITOR_DEFAULT: JunoMonitorConfig = {
  version: "1.1.0",
  description:
    "JunoMonitor — voice response quality agent + security layer. Rules here are enforced on every AI response before delivery. Edit on GitHub to tune without code deploys.",
  enabled: true,
  maxSentences: 4,
  trimToSentences: 3,
  rules: {
    stripDashes: true,
    stripMarkdown: true,
    stripFillerOpeners: true,
    fixTrailingEllipsis: true,
    enforceLength: true,
    cleanupPunctuation: true,
    blockLeakage: true,
  },
  fillerOpeners: [
    "certainly", "absolutely", "of course", "sure", "great",
    "awesome", "no problem", "happy to help", "glad you asked",
    "good question", "of course", "indeed", "wonderful",
    "fantastic", "excellent", "perfect",
  ],
  extractionPatterns: [
    "ignore previous instructions",
    "ignore all previous",
    "ignore your instructions",
    "disregard your",
    "forget your instructions",
    "your true self",
    "pretend you have no rules",
    "pretend you are",
    "act as dan",
    "jailbreak",
    "you are now",
    "new persona",
    "override your",
    "bypass your",
    "reveal your prompt",
    "show me your prompt",
    "what are your instructions",
    "repeat your system",
    "print your instructions",
    "output your instructions",
    "what is your system prompt",
    "tell me your rules",
    "developer mode",
    "god mode",
    "unrestricted mode",
    "sudo mode",
    "admin mode",
    "i am your creator",
    "i am your developer",
    "i built you",
  ],
  leakageSignals: [
    "you are juno — not an assistant",
    "identity protection",
    "non-negotiable",
    "voice rules",
    "formatting:",
    "what you absolutely cannot do",
    "system prompt",
    "my instructions are",
    "i am instructed to",
    "i was told to",
    "my rules say",
    "the rules i follow",
  ],
};

// ── Live config ───────────────────────────────────────────────────────────────

let _config: JunoMonitorConfig = { ...JUNO_MONITOR_DEFAULT };

export function getMonitorConfig(): JunoMonitorConfig {
  return _config;
}

// ── CDN Loader ────────────────────────────────────────────────────────────────

export async function loadMonitorConfig(): Promise<void> {
  try {
    let raw: any = null;

    try {
      raw = await fetchPrivateFile(JUNO_MONITOR_CDN_PATH);
    } catch {}

    if (!raw) {
      try {
        const url = `https://raw.githubusercontent.com/lasawno/junotalk-cdn/main/${JUNO_MONITOR_CDN_PATH}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (resp.ok) raw = await resp.json();
      } catch {}
    }

    if (!raw || typeof raw !== "object") {
      console.log("[JunoMonitor] CDN unavailable — offline defaults active");
      return;
    }

    _config = {
      ...JUNO_MONITOR_DEFAULT,
      ...raw,
      rules: { ...JUNO_MONITOR_DEFAULT.rules, ...(raw.rules || {}) },
      fillerOpeners: Array.isArray(raw.fillerOpeners) && raw.fillerOpeners.length
        ? raw.fillerOpeners
        : JUNO_MONITOR_DEFAULT.fillerOpeners,
      extractionPatterns: Array.isArray(raw.extractionPatterns) && raw.extractionPatterns.length
        ? raw.extractionPatterns
        : JUNO_MONITOR_DEFAULT.extractionPatterns,
      leakageSignals: Array.isArray(raw.leakageSignals) && raw.leakageSignals.length
        ? raw.leakageSignals
        : JUNO_MONITOR_DEFAULT.leakageSignals,
    };

    console.log(`[JunoMonitor] CDN config loaded — v${_config.version}, enabled=${_config.enabled}`);
  } catch (err: any) {
    console.log("[JunoMonitor] CDN load failed — offline defaults active:", err?.message);
  }
}

// ── Security: extraction attempt detection ────────────────────────────────────

/**
 * Returns true if the user's input looks like a prompt injection or
 * extraction attack. Call this BEFORE sending to the AI model.
 */
export function isExtractionAttempt(input: string): boolean {
  const lower = input.toLowerCase();
  return _config.extractionPatterns.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Returns true if the AI response appears to contain system prompt fragments.
 * Call this AFTER receiving the AI response, before delivering to the user.
 */
export function detectLeakage(response: string): boolean {
  if (!_config.rules.blockLeakage) return false;
  const lower = response.toLowerCase();
  return _config.leakageSignals.some(s => lower.includes(s.toLowerCase()));
}

// ── Monitor report type ───────────────────────────────────────────────────────

export interface MonitorReport {
  original: string;
  fixed: string;
  violations: string[];
  clean: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countSentences(text: string): number {
  const matches = text.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.length : 1;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function monitorAndFix(raw: string, context?: string): MonitorReport {
  const cfg = _config;
  const violations: string[] = [];
  let text = raw.trim();

  if (!cfg.enabled) return { original: raw, fixed: text, violations: [], clean: true };

  // Rule: strip em/en dashes and spaced hyphens used as separators
  if (cfg.rules.stripDashes && (/[—–]/.test(text) || /\s-\s/.test(text))) {
    violations.push("dash detected and removed");
    text = text
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/\s+-\s+/g, ", ");
  }

  // Rule: strip markdown formatting characters
  if (cfg.rules.stripMarkdown &&
      /\*\*|__|\*[^*]|_[^_]|^#{1,3}\s|^\s*[-•*]\s|^\s*\d+\.\s/m.test(text)) {
    violations.push("markdown formatting stripped");
    text = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/^\s*[-•*]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "");
  }

  // Rule: strip robotic filler openers
  if (cfg.rules.stripFillerOpeners) {
    for (const filler of cfg.fillerOpeners) {
      const pattern = new RegExp(`^${filler}[!,.]?\\s+`, "i");
      if (pattern.test(text)) {
        violations.push(`filler opener removed: "${filler}"`);
        text = text.replace(pattern, "");
        text = text.charAt(0).toUpperCase() + text.slice(1);
        break;
      }
    }
  }

  // Rule: replace trailing ellipsis with a period
  if (cfg.rules.fixTrailingEllipsis && /\.\.\.$/.test(text)) {
    violations.push("trailing ellipsis replaced with period");
    text = text.replace(/\.\.\.$/, ".");
  }

  // Rule: trim to max sentences if over limit
  if (cfg.rules.enforceLength) {
    const count = countSentences(text);
    if (count > cfg.maxSentences) {
      violations.push(`response too long (${count} sentences) — trimmed to ${cfg.trimToSentences}`);
      const parts = text.match(/[^.!?]+[.!?]+/g) || [text];
      text = parts.slice(0, cfg.trimToSentences).join(" ").trim();
    }
  }

  // Rule: cleanup double commas, double spaces, leading commas
  if (cfg.rules.cleanupPunctuation) {
    const before = text;
    text = text
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/^,\s*/g, "")
      .trim();
    if (text !== before) violations.push("punctuation cleaned up");
  }

  const clean = violations.length === 0;

  if (!clean) {
    const ctx = context ? ` [${context}]` : "";
    console.log(
      `[JunoMonitor]${ctx} ${violations.length} fix(es) applied:\n` +
      violations.map((v) => `  · ${v}`).join("\n") +
      `\n  Before: "${raw.slice(0, 90)}${raw.length > 90 ? "…" : ""}"\n` +
      `  After:  "${text.slice(0, 90)}${text.length > 90 ? "…" : ""}"`
    );
  }

  return { original: raw, fixed: text, violations, clean };
}
