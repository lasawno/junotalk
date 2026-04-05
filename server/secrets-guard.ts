import { structuredLog } from "./structured-logger";

const REDACTED = "[REDACTED]";

const SECRET_ENV_KEYS = [
  "JAAS_API_KEY",
  "JAAS_KEY_ID",
  "MOONSHOT_API_KEY",
  "GOOGLE_API_KEY",
  "RESEND_API_KEY",
  "LIBRETRANSLATE_API_KEY",
  "ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "GIPHY_API_KEY",
  "DEV_PORTAL_ACCESS_CODE",
  "OWNER_ACCESS_CODE",
  "REDIS_URL",
  "DATABASE_URL",
];

const PEM_PATTERN = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g;
const GENERIC_KEY_PATTERN = /(?:sk|pk|rk|ak|key|token|secret|password|apikey)[_-]?[A-Za-z0-9]{20,}/gi;
const BASE64_LONG_PATTERN = /[A-Za-z0-9+/]{40,}={0,2}/g;

let secretValues: string[] = [];
let initialized = false;
let interceptsBlocked = 0;
let scrubbedResponses = 0;
let scrubbedLogs = 0;
let lastEventAt: string | null = null;
let pendingSecurityFlush: ReturnType<typeof setTimeout> | null = null;

function scheduleSecurityFlush() {
  if (pendingSecurityFlush) return;
  pendingSecurityFlush = setTimeout(async () => {
    pendingSecurityFlush = null;
    try {
      const { pushPrivateFile } = await import("./github-config");
      await pushPrivateFile(
        "telemetry/security-events.json",
        {
          interceptsBlocked,
          scrubbedResponses,
          scrubbedLogs,
          lastEventAt,
          reportedAt: new Date().toISOString(),
        },
        `chore: security-events ${new Date().toISOString().slice(0, 10)}`
      );
    } catch {}
  }, 60_000);
}

function collectSecretValues() {
  secretValues = [];
  for (const key of SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (val && val.length >= 8) {
      secretValues.push(val);
      if (val.length > 20) {
        secretValues.push(val.substring(0, 20));
      }
    }
  }
}

function containsSecret(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  for (const secret of secretValues) {
    if (text.includes(secret)) return true;
  }
  if (PEM_PATTERN.test(text)) return true;
  if (BEARER_PATTERN.test(text)) return true;
  return false;
}

function redactString(text: string): string {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const secret of secretValues) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }
  result = result.replace(PEM_PATTERN, REDACTED);
  result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  return result;
}

function redactValue(val: unknown, depth = 0): unknown {
  if (depth > 10) return val;
  if (typeof val === "string") {
    return containsSecret(val) ? redactString(val) : val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactValue(item, depth + 1));
  }
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      const keyLower = k.toLowerCase();
      if (
        keyLower.includes("key") ||
        keyLower.includes("secret") ||
        keyLower.includes("token") ||
        keyLower.includes("password") ||
        keyLower.includes("authorization") ||
        keyLower.includes("credential") ||
        keyLower.includes("private")
      ) {
        if (typeof v === "string" && v.length > 4) {
          out[k] = REDACTED;
          continue;
        }
      }
      out[k] = redactValue(v, depth + 1);
    }
    return out;
  }
  return val;
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

function scrubArg(arg: unknown): unknown {
  if (typeof arg === "string") {
    if (containsSecret(arg)) {
      scrubbedLogs++;
      lastEventAt = new Date().toISOString();
      scheduleSecurityFlush();
      return redactString(arg);
    }
    return arg;
  }
  if (arg && typeof arg === "object") {
    try {
      const str = JSON.stringify(arg);
      if (containsSecret(str)) {
        scrubbedLogs++;
        lastEventAt = new Date().toISOString();
        scheduleSecurityFlush();
        return JSON.parse(JSON.stringify(redactValue(arg)));
      }
    } catch {}
  }
  return arg;
}

function wrapConsole() {
  console.log = (...args: unknown[]) => {
    originalConsoleLog(...args.map(scrubArg));
  };
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args.map(scrubArg));
  };
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args.map(scrubArg));
  };
}

export function scrubResponseBody(body: unknown): unknown {
  if (!initialized) return body;
  if (typeof body === "string") {
    if (containsSecret(body)) {
      scrubbedResponses++;
      lastEventAt = new Date().toISOString();
      scheduleSecurityFlush();
      return redactString(body);
    }
    return body;
  }
  if (body && typeof body === "object") {
    try {
      const str = JSON.stringify(body);
      if (containsSecret(str)) {
        scrubbedResponses++;
        lastEventAt = new Date().toISOString();
        scheduleSecurityFlush();
        return redactValue(body);
      }
    } catch {}
  }
  return body;
}

export function secretsGuardMiddleware(req: any, res: any, next: () => void) {
  if (!initialized) return next();

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const scrubbed = scrubResponseBody(body);
    if (scrubbed !== body) {
      structuredLog("warn", "security_alert", "Secrets scrubbed from API response", {
        metadata: { path: req.path, method: req.method },
      });
    }
    return originalJson(scrubbed);
  };

  next();
}

export function getSecretsGuardStatus(): {
  status: "healthy" | "degraded" | "unhealthy";
  initialized: boolean;
  trackedSecrets: number;
  interceptsBlocked: number;
  scrubbedResponses: number;
  scrubbedLogs: number;
  lastEventAt: string | null;
} {
  return {
    status: initialized ? "healthy" : "unhealthy",
    initialized,
    trackedSecrets: secretValues.length,
    interceptsBlocked,
    scrubbedResponses,
    scrubbedLogs,
    lastEventAt,
  };
}

export function initSecretsGuard() {
  if (initialized) return;
  collectSecretValues();
  wrapConsole();
  initialized = true;
  originalConsoleLog(`[SecretsGuard] Initialized — tracking ${secretValues.length} secret patterns`);
}
