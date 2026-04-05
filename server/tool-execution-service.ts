import { recordProviderUsage } from "./agent-metrics";

export interface ToolResult<T = any> {
  status: "success" | "fallback" | "error";
  data: T;
  tool: string;
  attempts: number;
  latencyMs: number;
  error?: string;
}

interface ToolConfig {
  maxRetries: number;
  timeoutMs: number;
  fallback: () => any;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
  halfOpenAt: number;
}

const DEFAULT_CONFIG: ToolConfig = {
  maxRetries: 3,
  timeoutMs: 8000,
  fallback: () => ({ message: "Tool execution failed" }),
};

const circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30000;

const toolMetrics = new Map<string, { calls: number; failures: number; totalMs: number; lastCall: number; lastError: string }>();

function getCircuit(toolName: string): CircuitState {
  if (!circuits.has(toolName)) {
    circuits.set(toolName, { failures: 0, lastFailure: 0, open: false, halfOpenAt: 0 });
  }
  return circuits.get(toolName)!;
}

function isCircuitOpen(toolName: string): boolean {
  const circuit = getCircuit(toolName);
  if (!circuit.open) return false;
  if (Date.now() >= circuit.halfOpenAt) {
    circuit.open = false;
    return false;
  }
  return true;
}

function recordCircuitSuccess(toolName: string) {
  const circuit = getCircuit(toolName);
  circuit.failures = Math.max(0, circuit.failures - 1);
  circuit.open = false;
}

function recordCircuitFailure(toolName: string, error: string) {
  const circuit = getCircuit(toolName);
  circuit.failures++;
  circuit.lastFailure = Date.now();
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.open = true;
    circuit.halfOpenAt = Date.now() + CIRCUIT_RESET_MS;
    console.warn(`[ToolExec] Circuit OPEN for "${toolName}" — cooling down ${CIRCUIT_RESET_MS / 1000}s`);
  }
}

const TOOL_TO_PROVIDER: Record<string, string> = {
  "libre-translate": "libretranslate",
  "claude-translate": "claude",
  "claude-general": "claude",
  "claude-oversight": "claude",
  "kimi-translate": "kimi",
  "kimi-general": "kimi",
  "kimi-cleanup": "kimi",
  "caption-cleanup": "kimi",
  "call-summary": "kimi",
  "vision-detect": "gemini",
  "tts-piper": "piper",
  "tts-openai": "openai",
  "spacy-validate": "spacy",
  "lang-detect": "kimi",
};

function trackMetric(toolName: string, latencyMs: number, failed: boolean, error?: string) {
  if (!toolMetrics.has(toolName)) {
    toolMetrics.set(toolName, { calls: 0, failures: 0, totalMs: 0, lastCall: 0, lastError: "" });
  }
  const m = toolMetrics.get(toolName)!;
  m.calls++;
  m.totalMs += latencyMs;
  m.lastCall = Date.now();
  if (failed) {
    m.failures++;
    m.lastError = error || "unknown";
  }
  const provider = TOOL_TO_PROVIDER[toolName];
  if (provider) {
    try { recordProviderUsage(provider); } catch {}
  }
}

export async function executeTool<T>(
  toolName: string,
  toolFn: () => Promise<T>,
  config: Partial<ToolConfig> = {}
): Promise<ToolResult<T>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const start = Date.now();

  if (isCircuitOpen(toolName)) {
    const latency = Date.now() - start;
    trackMetric(toolName, latency, true, "circuit_open");
    return {
      status: "fallback",
      data: cfg.fallback() as T,
      tool: toolName,
      attempts: 0,
      latencyMs: latency,
      error: "Circuit breaker open — tool temporarily disabled",
    };
  }

  let lastError = "";

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        toolFn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${cfg.timeoutMs}ms`)), cfg.timeoutMs)
        ),
      ]);

      const latency = Date.now() - start;
      recordCircuitSuccess(toolName);
      trackMetric(toolName, latency, false);

      return {
        status: "success",
        data: result,
        tool: toolName,
        attempts: attempt,
        latencyMs: latency,
      };
    } catch (err: any) {
      lastError = err?.message || "Unknown error";
      console.error(`[ToolExec] "${toolName}" attempt ${attempt}/${cfg.maxRetries}: ${lastError}`);

      if (attempt < cfg.maxRetries) {
        await new Promise(r => setTimeout(r, Math.min(300 * attempt, 1500)));
      }
    }
  }

  const latency = Date.now() - start;
  recordCircuitFailure(toolName, lastError);
  trackMetric(toolName, latency, true, lastError);

  return {
    status: "fallback",
    data: cfg.fallback() as T,
    tool: toolName,
    attempts: cfg.maxRetries,
    latencyMs: latency,
    error: lastError,
  };
}

export function validateInput(rules: Record<string, (v: any) => boolean>, input: Record<string, any>): string | null {
  for (const [field, check] of Object.entries(rules)) {
    if (!check(input[field])) {
      return `Invalid input: "${field}" failed validation`;
    }
  }
  return null;
}

export function getToolHealth(): Record<string, {
  status: "healthy" | "degraded" | "down";
  calls: number;
  failures: number;
  avgLatencyMs: number;
  circuitOpen: boolean;
  lastError: string;
}> {
  const health: Record<string, any> = {};
  for (const [name, m] of toolMetrics) {
    const circuit = getCircuit(name);
    const failRate = m.calls > 0 ? m.failures / m.calls : 0;
    health[name] = {
      status: circuit.open ? "down" : failRate > 0.3 ? "degraded" : "healthy",
      calls: m.calls,
      failures: m.failures,
      avgLatencyMs: m.calls > 0 ? Math.round(m.totalMs / m.calls) : 0,
      circuitOpen: circuit.open,
      lastError: m.lastError,
    };
  }
  return health;
}

export function getToolStatus(toolName: string): { available: boolean; circuitOpen: boolean; failures: number } {
  const open = isCircuitOpen(toolName);
  const circuit = getCircuit(toolName);
  return {
    available: !open,
    circuitOpen: open,
    failures: circuit.failures,
  };
}

export function resetCircuit(toolName: string) {
  const circuit = getCircuit(toolName);
  circuit.failures = 0;
  circuit.open = false;
  circuit.halfOpenAt = 0;
}

export function resetAllCircuits() {
  for (const [name] of circuits) {
    resetCircuit(name);
  }
}

export const TOOL_NAMES = {
  LIBRE_TRANSLATE: "libre-translate",
  CLAUDE_TRANSLATE: "claude-translate",
  CLAUDE_GENERAL: "claude-general",
  CLAUDE_OVERSIGHT: "claude-oversight",
  KIMI_TRANSLATE: "kimi-translate",
  KIMI_GENERAL: "kimi-general",
  KIMI_CLEANUP: "kimi-cleanup",
  OPENAI_TRANSLATE: "openai-translate",
  VISION_DETECT: "vision-detect",
  TTS_PIPER: "tts-piper",
  TTS_OPENAI: "tts-openai",
  CAPTION_CLEANUP: "caption-cleanup",
  CALL_SUMMARY: "call-summary",
  LANG_DETECT: "lang-detect",
  SPACY_VALIDATE: "spacy-validate",
  EMAIL_SEND: "email-send",
} as const;
