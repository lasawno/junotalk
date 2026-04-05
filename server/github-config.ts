import { readFile, writeFile, mkdir } from "fs/promises";
import * as path from "path";
// GitHub integration — uses @replit/connectors-sdk with OAuth proxy (no token in code)
import { ReplitConnectors } from "@replit/connectors-sdk";

const GITHUB_REPO = "lasawno/junotalk-cdn";
const GITHUB_BRANCH = "main";
const CONFIG_DIR = path.resolve(process.cwd(), "vault/config");
const REFRESH_TTL = 60 * 60 * 1000;

// Fetch a file from the private repo via the authenticated GitHub connector.
// Uses GitHub Contents API — returns base64 encoded content for all file sizes.
// Exported so all server modules share one authenticated fetch path.
export async function fetchPrivateFile(filePath: string): Promise<any> {
  // Primary path: Replit connector proxy
  try {
    const connectors = new ReplitConnectors();
    const endpoint = `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    const resp = await connectors.proxy("github", endpoint, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.ok) {
      const meta = await resp.json() as { content?: string; encoding?: string };
      if (meta.content && meta.encoding === "base64") {
        const raw = Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString("utf-8");
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fall through to GITHUB_TOKEN fallback
  }

  // Fallback: direct Octokit with GITHUB_TOKEN (same pattern as pushPrivateFile)
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.getContent({
      owner: "lasawno", repo: "junotalk-cdn", path: filePath,
    });
    if ("content" in data && data.encoding === "base64") {
      const raw = Buffer.from((data as any).content.replace(/\n/g, ""), "base64").toString("utf-8");
      return JSON.parse(raw);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Write or update a JSON file in the private GitHub CDN repo.
 * Uses the Replit GitHub connector (same auth path as reads) for the PUT request.
 * Falls back to GITHUB_TOKEN via Octokit if the connector write fails.
 * Returns true on success, false on failure.
 */
/** Fetch only the SHA of a file in the CDN repo (used before updates). */
async function getFileSha(filePath: string): Promise<string | undefined> {
  // Reuse fetchPrivateFile's raw GET — same proven connector path — but capture sha too.
  try {
    const connectors = new ReplitConnectors();
    const resp = await connectors.proxy("github", `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return undefined;
    // GitHub Contents API returns both .sha AND .content in the same response body
    const meta = await resp.json() as { sha?: string; content?: string; encoding?: string };
    return meta?.sha || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check whether a file exists in the CDN repo.
 * Returns true if it exists (any status other than 404), false if 404.
 */
export async function cdnFileExists(filePath: string): Promise<boolean> {
  try {
    const connectors = new ReplitConnectors();
    const resp = await connectors.proxy("github", `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    return resp.ok;
  } catch {
    // Fallback via GITHUB_TOKEN
    const token = process.env.GITHUB_TOKEN;
    if (!token) return false;
    try {
      const { Octokit } = await import("@octokit/rest");
      const octokit = new Octokit({ auth: token });
      await octokit.repos.getContent({ owner: "lasawno", repo: "junotalk-cdn", path: filePath });
      return true;
    } catch {
      return false;
    }
  }
}

export async function pushPrivateFile(filePath: string, data: unknown, commitMessage: string): Promise<boolean> {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

  // First attempt: use the Replit connector proxy (same OAuth that powers reads)
  try {
    const connectors = new ReplitConnectors();

    // Use dedicated SHA fetch (same proven code path as fetchPrivateFile)
    const sha = await getFileSha(filePath);

    const body: Record<string, unknown> = { message: commitMessage, content, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;

    const attemptPut = async () => connectors.proxy("github", `/repos/${GITHUB_REPO}/contents/${filePath}`, {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let putResp = await attemptPut();

    // Retry once after a short delay if rate-limited
    if (putResp.status === 429) {
      const retryAfterMs = parseInt(putResp.headers.get?.("retry-after") || "2", 10) * 1000;
      await new Promise(r => setTimeout(r, retryAfterMs + 500));
      putResp = await attemptPut();
    }

    if (putResp.ok) {
      console.log(`[GitHubConfig] pushPrivateFile: ${filePath} written via connector.`);
      return true;
    }
    const errText = await putResp.text().catch(() => String(putResp.status));
    console.warn(`[GitHubConfig] Connector write failed for ${filePath} (${putResp.status}): ${errText.slice(0, 120)} — trying GITHUB_TOKEN fallback...`);
  } catch (connErr: any) {
    console.warn(`[GitHubConfig] Connector write error for ${filePath}: ${connErr.message} — trying GITHUB_TOKEN fallback...`);
  }

  // Fallback: direct Octokit with GITHUB_TOKEN
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(`[GitHubConfig] pushPrivateFile: no GITHUB_TOKEN set — cannot write ${filePath}`);
    return false;
  }
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    let sha: string | undefined;
    try {
      const { data: existing } = await octokit.repos.getContent({
        owner: "lasawno", repo: "junotalk-cdn", path: filePath,
      });
      if ("sha" in existing) sha = (existing as any).sha;
    } catch {}
    await octokit.repos.createOrUpdateFileContents({
      owner: "lasawno", repo: "junotalk-cdn", path: filePath,
      message: commitMessage, content, ...(sha ? { sha } : {}),
    });
    console.log(`[GitHubConfig] pushPrivateFile: ${filePath} written via GITHUB_TOKEN fallback.`);
    return true;
  } catch (err: any) {
    console.error(`[GitHubConfig] pushPrivateFile failed for ${filePath}:`, err.message);
    return false;
  }
}

/**
 * Generic fetch from ANY GitHub repo (public or accessible via connector).
 * Used by Arena LLM stack and other multi-repo CDN patterns.
 */
export async function fetchFromRepo(owner: string, repo: string, filePath: string, branch = "main"): Promise<any> {
  const fullRepo = `${owner}/${repo}`;
  try {
    const connectors = new ReplitConnectors();
    const endpoint = `/repos/${fullRepo}/contents/${filePath}?ref=${branch}`;
    const resp = await connectors.proxy("github", endpoint, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.ok) {
      const meta = await resp.json() as { content?: string; encoding?: string };
      if (meta.content && meta.encoding === "base64") {
        const raw = Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString("utf-8");
        return JSON.parse(raw);
      }
    }
  } catch {}

  // Fallback: GITHUB_TOKEN via Octokit
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
    if ("content" in data && (data as any).encoding === "base64") {
      const raw = Buffer.from((data as any).content.replace(/\n/g, ""), "base64").toString("utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

/**
 * Generic push to ANY GitHub repo.
 */
export async function pushToRepo(owner: string, repo: string, filePath: string, data: unknown, commitMessage: string, branch = "main"): Promise<boolean> {
  const fullRepo = `${owner}/${repo}`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

  try {
    const connectors = new ReplitConnectors();
    let sha: string | undefined;
    try {
      const getResp = await connectors.proxy("github", `/repos/${fullRepo}/contents/${filePath}?ref=${branch}`, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (getResp.ok) {
        const meta = await getResp.json() as { sha?: string };
        if (meta.sha) sha = meta.sha;
      }
    } catch {}

    const body: Record<string, unknown> = { message: commitMessage, content, branch };
    if (sha) body.sha = sha;

    const putResp = await connectors.proxy("github", `/repos/${fullRepo}/contents/${filePath}`, {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (putResp.ok) {
      console.log(`[GitHubConfig] pushToRepo: ${fullRepo}/${filePath} written via connector.`);
      return true;
    }
  } catch {}

  // Fallback: GITHUB_TOKEN
  const token = process.env.GITHUB_TOKEN;
  if (!token) return false;
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    let sha: string | undefined;
    try {
      const { data: existing } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
      if ("sha" in existing) sha = (existing as any).sha;
    } catch {}
    await octokit.repos.createOrUpdateFileContents({
      owner, repo, path: filePath, branch,
      message: commitMessage, content, ...(sha ? { sha } : {}),
    });
    console.log(`[GitHubConfig] pushToRepo: ${fullRepo}/${filePath} written via GITHUB_TOKEN.`);
    return true;
  } catch (err: any) {
    console.error(`[GitHubConfig] pushToRepo failed for ${fullRepo}/${filePath}:`, err.message);
    return false;
  }
}

export interface ReasoningConfig {
  enabled: boolean;
  complexityThreshold: number;
  maxDecompositionSteps: number;
  intentsRequiringReasoning: string[];
  decompositionRules: DecompositionRule[];
  confidenceFloor: number;
}

export interface DecompositionRule {
  pattern: string;
  splitStrategy: "sequential" | "parallel" | "conditional";
  description: string;
}

export interface PersonalityProfile {
  id: string;
  name: string;
  tone: string[];
  humorLevel: number;
  responseStyle: string;
  guidelines: string[];
  examplePhrases: string[];
}

export interface PersonalityConfig {
  enabled: boolean;
  activeProfile: string;
  profiles: PersonalityProfile[];
  overrideIntents: Record<string, string>;
  humorCooldownMs: number;
}

export interface ModulesConfig {
  reasoning: { enabled: boolean; version: string };
  personality: { enabled: boolean; version: string };
  recall: { enabled: boolean; version: string };
  safety?: { enabled: boolean; version: string };
  boundary?: { enabled: boolean; version: string };
}

export type SafetyResponseMap = Record<string, string[]>;
export type BoundaryResponseMap = Record<string, string[]>;

export interface LiteModelConfig {
  enabled: boolean;
  model: string;
  provider: "openrouter";
  sample_rate: number;
  max_tokens: number;
  offline_fallback: boolean;
}

export interface AuthPolicyConfig {
  // How many consecutive null-auth responses from the server before the client
  // considers the session truly expired and redirects to login.
  // Higher values = more resilient to deployment cold-starts.
  null_tolerance: number;
  // Whether client-side visibility-based logout is active (tab hidden N ms → logout).
  visibility_logout_enabled: boolean;
  // Milliseconds the tab must be hidden before triggering logout.
  // Only relevant when visibility_logout_enabled = true.
  visibility_logout_delay_ms: number;
  // How often (ms) the client re-checks /api/auth/user in the background.
  auth_refetch_interval_ms: number;
}

export interface ClientConfig {
  // ── Socket.IO — /chat namespace (group rooms) ───────────────────────────────
  socket_chat_reconnect_delay_ms: number;
  socket_chat_reconnect_delay_max_ms: number;
  socket_chat_timeout_ms: number;
  // ── Socket.IO — /dm namespace (direct messages) ─────────────────────────────
  socket_dm_reconnect_delay_ms: number;
  socket_dm_reconnect_delay_max_ms: number;
  socket_dm_reconnect_attempts: number;
  socket_dm_timeout_ms: number;
  // ── Raw WebSocket (Jitsi signaling / misc) ───────────────────────────────────
  ws_heartbeat_interval_ms: number;
  ws_heartbeat_timeout_ms: number;
  ws_reconnect_initial_delay_ms: number;
  ws_reconnect_max_delay_ms: number;
  // ── File upload limits ───────────────────────────────────────────────────────
  upload_max_mb_mobile: number;
  upload_max_mb_desktop: number;
  // ── Notification/toast durations ─────────────────────────────────────────────
  toast_duration_ms: number;
  toast_error_duration_ms: number;
  // ── Data refresh intervals ───────────────────────────────────────────────────
  contacts_refetch_interval_ms: number;
  feature_flags_refetch_interval_ms: number;
  // ── TanStack Query global defaults ───────────────────────────────────────────
  query_default_stale_time_ms: number;
  query_default_retry_max_delay_ms: number;
}

interface ConfigCache {
  reasoning: ReasoningConfig;
  personality: PersonalityConfig;
  modules: ModulesConfig;
  safetyResponses: SafetyResponseMap | null;
  boundaryResponses: BoundaryResponseMap | null;
  liteModel: LiteModelConfig;
  authPolicy: AuthPolicyConfig;
  clientConfig: ClientConfig;
}

const DEFAULT_REASONING: ReasoningConfig = {
  enabled: true,
  complexityThreshold: 0.6,
  maxDecompositionSteps: 4,
  intentsRequiringReasoning: ["multi-request", "conditional", "comparison", "explanation"],
  decompositionRules: [
    {
      pattern: "(?:and also|and then|but first|after that|plus|additionally)",
      splitStrategy: "sequential",
      description: "Sequential multi-part requests",
    },
    {
      pattern: "(?:if.*then|whether.*or|depending on|in case)",
      splitStrategy: "conditional",
      description: "Conditional logic in queries",
    },
    {
      pattern: "(?:compare|difference between|versus|vs\\.?|better than)",
      splitStrategy: "parallel",
      description: "Comparison requests requiring parallel analysis",
    },
  ],
  confidenceFloor: 0.4,
};

const DEFAULT_PERSONALITY: PersonalityConfig = {
  enabled: true,
  activeProfile: "professional-friendly",
  profiles: [
    {
      id: "professional-friendly",
      name: "Professional & Friendly",
      tone: ["warm", "clear", "respectful", "approachable"],
      humorLevel: 0.2,
      responseStyle: "Communicate with warmth and clarity. Be helpful without being overly casual. Use natural language that feels human, not robotic.",
      guidelines: [
        "Prioritize accuracy and clarity in all responses",
        "Use a warm but professional tone",
        "Avoid slang unless the user initiates it",
        "Show genuine interest in helping the user",
        "Keep responses concise but thorough",
      ],
      examplePhrases: [
        "Here's what I found for you",
        "That's a great question",
        "Let me help you with that",
      ],
    },
    {
      id: "casual",
      name: "Casual & Relaxed",
      tone: ["friendly", "relaxed", "conversational", "upbeat"],
      humorLevel: 0.5,
      responseStyle: "Be conversational and easygoing. Use natural, everyday language. Feel free to be lighthearted when appropriate.",
      guidelines: [
        "Use everyday conversational language",
        "Light humor is welcome when context allows",
        "Keep things simple and direct",
        "Match the user's energy level",
        "Be genuinely enthusiastic when helping",
      ],
      examplePhrases: [
        "Got it!",
        "No worries, here you go",
        "Nice choice!",
      ],
    },
    {
      id: "formal",
      name: "Formal & Precise",
      tone: ["formal", "precise", "authoritative", "measured"],
      humorLevel: 0.0,
      responseStyle: "Maintain a professional and formal register. Prioritize precision and completeness. Avoid colloquialisms.",
      guidelines: [
        "Use formal language consistently",
        "Provide thorough and precise responses",
        "Avoid contractions and informal expressions",
        "Maintain a respectful distance",
        "Structure responses clearly",
      ],
      examplePhrases: [
        "Please find the requested information below",
        "I would be pleased to assist you",
        "The following details may be of relevance",
      ],
    },
    {
      id: "playful",
      name: "Playful & Witty",
      tone: ["playful", "witty", "energetic", "creative"],
      humorLevel: 0.7,
      responseStyle: "Be creative and engaging. Use wordplay and humor when it fits naturally. Keep the energy up while staying helpful.",
      guidelines: [
        "Inject personality and warmth into responses",
        "Use clever wordplay when it fits naturally",
        "Stay helpful — humor should enhance, not replace, usefulness",
        "Read the room — dial it back for serious topics",
        "Be creative with language while staying clear",
      ],
      examplePhrases: [
        "Let's dive in!",
        "You've come to the right place",
        "Consider it done!",
      ],
    },
  ],
  overrideIntents: {
    emergency: "formal",
    medical: "formal",
    transaction: "professional-friendly",
    business: "professional-friendly",
  },
  humorCooldownMs: 30000,
};

const DEFAULT_MODULES: ModulesConfig = {
  reasoning: { enabled: true, version: "1.0.0" },
  personality: { enabled: true, version: "1.0.0" },
  recall: { enabled: true, version: "1.0.0" },
  safety: { enabled: true, version: "1.0.0" },
  boundary: { enabled: true, version: "1.0.0" },
};

const DEFAULT_LITE_MODEL: LiteModelConfig = {
  enabled: true,
  model: "google/gemma-3-12b-it:free",
  provider: "openrouter",
  sample_rate: 0.25,
  max_tokens: 200,
  offline_fallback: true,
};

const DEFAULT_AUTH_POLICY: AuthPolicyConfig = {
  null_tolerance: 8,
  visibility_logout_enabled: false,
  visibility_logout_delay_ms: 1_800_000, // 30 minutes (if ever re-enabled)
  auth_refetch_interval_ms: 600_000,     // 10 minutes
};

const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  // Socket.IO — /chat
  socket_chat_reconnect_delay_ms: 1_000,
  socket_chat_reconnect_delay_max_ms: 15_000,
  socket_chat_timeout_ms: 10_000,
  // Socket.IO — /dm
  socket_dm_reconnect_delay_ms: 1_000,
  socket_dm_reconnect_delay_max_ms: 8_000,
  socket_dm_reconnect_attempts: 15,
  socket_dm_timeout_ms: 10_000,
  // Raw WebSocket
  ws_heartbeat_interval_ms: 15_000,
  ws_heartbeat_timeout_ms: 10_000,
  ws_reconnect_initial_delay_ms: 1_000,
  ws_reconnect_max_delay_ms: 15_000,
  // Uploads
  upload_max_mb_mobile: 15,
  upload_max_mb_desktop: 25,
  // Toasts
  toast_duration_ms: 3_500,
  toast_error_duration_ms: 5_000,
  // Refresh intervals
  contacts_refetch_interval_ms: 30_000,
  feature_flags_refetch_interval_ms: 300_000,
  // Query defaults
  query_default_stale_time_ms: 30_000,
  query_default_retry_max_delay_ms: 8_000,
};

let configCache: ConfigCache = {
  reasoning: { ...DEFAULT_REASONING },
  personality: { ...DEFAULT_PERSONALITY },
  modules: { ...DEFAULT_MODULES },
  safetyResponses: null,
  boundaryResponses: null,
  liteModel: { ...DEFAULT_LITE_MODEL },
  authPolicy: { ...DEFAULT_AUTH_POLICY },
  clientConfig: { ...DEFAULT_CLIENT_CONFIG },
};

let lastFetch = 0;
let fetchInProgress = false;
let initialized = false;
let initPromise: Promise<void> | null = null;

function mergeWithDefaults<T extends Record<string, any>>(remote: Partial<T>, defaults: T): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key in remote && remote[key] !== undefined && remote[key] !== null) {
      (result as any)[key] = remote[key];
    }
  }
  return result;
}

async function loadRemoteConfig(): Promise<void> {
  if (fetchInProgress) return;
  if (Date.now() - lastFetch < REFRESH_TTL && initialized) return;

  fetchInProgress = true;
  const configFiles = [
    { key: "reasoning", path: "config/reasoning.json", defaults: DEFAULT_REASONING },
    { key: "personality", path: "config/personality.json", defaults: DEFAULT_PERSONALITY },
    { key: "modules", path: "config/modules.json", defaults: DEFAULT_MODULES },
    { key: "authPolicy", path: "config/auth-policy.json", defaults: DEFAULT_AUTH_POLICY },
    { key: "clientConfig", path: "config/client-config.json", defaults: DEFAULT_CLIENT_CONFIG },
  ];

  let loadedCount = 0;

  // Lite model config — load separately and merge with defaults
  try {
    const lmData = await fetchPrivateFile("config/lite-model.json");
    if (lmData && typeof lmData === "object") {
      configCache.liteModel = mergeWithDefaults(lmData, DEFAULT_LITE_MODEL);
      loadedCount++;
      console.log(`[GitHubConfig] Lite model loaded: ${configCache.liteModel.model} @ ${Math.round(configCache.liteModel.sample_rate * 100)}% (offline_fallback=${configCache.liteModel.offline_fallback})`);
    } else {
      console.log("[GitHubConfig] lite-model.json not found in CDN — using defaults (gemma-3-1b-it:free @ 25%)");
    }
  } catch (e: any) {
    console.warn("[GitHubConfig] lite-model.json fetch error:", e.message);
  }

  const freeformFiles = [
    { key: "safetyResponses", path: "config/safety-responses.json" },
    { key: "boundaryResponses", path: "config/boundary-responses.json" },
  ];

  try {
    for (const cf of configFiles) {
      try {
        const data = await fetchPrivateFile(cf.path);
        if (data && typeof data === "object") {
          (configCache as any)[cf.key] = mergeWithDefaults(data, cf.defaults);
          loadedCount++;
        }
      } catch {}
    }

    for (const ff of freeformFiles) {
      try {
        const data = await fetchPrivateFile(ff.path);
        if (data && typeof data === "object") {
          const { _comment, ...responses } = data as any;
          (configCache as any)[ff.key] = responses;
          loadedCount++;
        }
      } catch {}
    }

    lastFetch = Date.now();
    if (loadedCount > 0) {
      console.log(`[GitHubConfig] Loaded ${loadedCount} config(s) from GitHub CDN`);
    } else {
      console.log(`[GitHubConfig] Using local defaults (no remote configs found)`);
    }
  } catch (err: any) {
    console.warn("[GitHubConfig] Config fetch failed:", err.message);
  } finally {
    fetchInProgress = false;
  }
}

async function saveConfigSnapshot(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });

    const snapshot = `# GitHub Config Snapshot
Updated: ${new Date().toISOString()}

## Modules Status
- Reasoning: ${configCache.modules.reasoning.enabled ? "enabled" : "disabled"} (v${configCache.modules.reasoning.version})
- Personality: ${configCache.modules.personality.enabled ? "enabled" : "disabled"} (v${configCache.modules.personality.version})
- Recall: ${configCache.modules.recall.enabled ? "enabled" : "disabled"} (v${configCache.modules.recall.version})

## Reasoning Config
- Complexity threshold: ${configCache.reasoning.complexityThreshold}
- Max decomposition steps: ${configCache.reasoning.maxDecompositionSteps}
- Confidence floor: ${configCache.reasoning.confidenceFloor}
- Decomposition rules: ${configCache.reasoning.decompositionRules.length}

## Personality Config
- Active profile: ${configCache.personality.activeProfile}
- Available profiles: ${configCache.personality.profiles.map(p => p.id).join(", ")}
- Humor cooldown: ${configCache.personality.humorCooldownMs}ms
- Intent overrides: ${Object.entries(configCache.personality.overrideIntents).map(([k, v]) => `${k}->${v}`).join(", ")}

## Safety Responses (GitHub-driven)
- Loaded: ${configCache.safetyResponses ? "yes" : "no (using hardcoded defaults)"}
- Categories: ${configCache.safetyResponses ? Object.keys(configCache.safetyResponses).join(", ") : "n/a"}

## Boundary Responses (GitHub-driven)
- Loaded: ${configCache.boundaryResponses ? "yes" : "no (using hardcoded defaults)"}
- Categories: ${configCache.boundaryResponses ? Object.keys(configCache.boundaryResponses).join(", ") : "n/a"}
`;
    await writeFile(path.join(CONFIG_DIR, "snapshot.md"), snapshot, "utf-8");
  } catch {}
}

export function getReasoningConfig(): ReasoningConfig {
  return configCache.reasoning;
}

export function getPersonalityConfig(): PersonalityConfig {
  return configCache.personality;
}

export function getModulesConfig(): ModulesConfig {
  return configCache.modules;
}

export function getActivePersonalityProfile(intentOverride?: string): PersonalityProfile {
  const config = configCache.personality;

  let profileId = config.activeProfile;
  if (intentOverride && config.overrideIntents[intentOverride]) {
    profileId = config.overrideIntents[intentOverride];
  }

  const profile = config.profiles.find(p => p.id === profileId);
  return profile || config.profiles[0] || DEFAULT_PERSONALITY.profiles[0];
}

export function getLiteModelConfig(): LiteModelConfig {
  return configCache.liteModel;
}

export function getAuthPolicy(): AuthPolicyConfig {
  return configCache.authPolicy;
}

export function getClientConfig(): ClientConfig {
  return configCache.clientConfig;
}

export function getSafetyResponses(): SafetyResponseMap | null {
  return configCache.safetyResponses;
}

export function getBoundaryResponses(): BoundaryResponseMap | null {
  return configCache.boundaryResponses;
}

export function getConfigStats() {
  return {
    initialized,
    lastFetch: lastFetch ? new Date(lastFetch).toISOString() : null,
    reasoning: {
      enabled: configCache.reasoning.enabled,
      complexityThreshold: configCache.reasoning.complexityThreshold,
      decompositionRules: configCache.reasoning.decompositionRules.length,
    },
    personality: {
      enabled: configCache.personality.enabled,
      activeProfile: configCache.personality.activeProfile,
      profileCount: configCache.personality.profiles.length,
    },
    modules: configCache.modules,
  };
}

export async function initGitHubConfig(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await loadRemoteConfig();
      await saveConfigSnapshot();
      initialized = true;

      const stats = getConfigStats();
      console.log(
        `[GitHubConfig] Initialized: reasoning=${stats.reasoning.enabled}, ` +
        `personality=${stats.personality.enabled} (${stats.personality.activeProfile}), ` +
        `${stats.personality.profileCount} profiles, ` +
        `${stats.reasoning.decompositionRules} decomposition rules`
      );
    } catch (err: any) {
      console.warn("[GitHubConfig] Init failed (using defaults):", err.message);
      initialized = true;
    }
  })();

  return initPromise;
}

initGitHubConfig().catch(() => {});
setInterval(() => loadRemoteConfig().then(() => saveConfigSnapshot()).catch(() => {}), REFRESH_TTL);

// ── Translation Commands Config Seed ─────────────────────────────────────────
// Pushes config/translation-commands.json to the CDN if it doesn't exist
// or if the server version is newer than what's stored.

const TRANSLATION_COMMANDS_VERSION = "1.2.0";

const TRANSLATION_COMMANDS_CONFIG = {
  version: TRANSLATION_COMMANDS_VERSION,
  updated: new Date().toISOString().split("T")[0],
  description: "JunoTalk translation intent configuration — loaded by server/translation-intent.ts",
  triggerKeywords: [
    "translate", "translation", "traduire", "traducir", "übersetzen",
    "翻译", "翻訳", "번역", "перевести", "traduzione", "tradução", "vertalen",
    "traduzir", "tłumaczyć", "çevirmek",
    "how do you say", "how to say", "how would you say", "how can you say", "how do i say",
    "what is in", "what does mean", "say it in",
    "respond in", "answer in", "reply in", "write in", "speak in", "talk in"
  ],
  patterns: {
    question: [
      "how do you say",
      "how would you say",
      "how can you say",
      "how do i say",
      "what is .+ in",
      "what does .+ mean",
      "how to say"
    ],
    mode_switch: [
      "respond in",
      "answer in",
      "reply in",
      "speak in",
      "write in",
      "talk in",
      "translate for me",
      "can you translate",
      "please translate",
      "start translating",
      "switch to",
      "use .+ language"
    ]
  },
  confidenceThresholds: {
    direct: 0.80,
    question: 0.80,
    mode_switch: 0.80
  },
  languageMap: {
    "english": "en", "inglés": "en", "anglais": "en", "englisch": "en",
    "spanish": "es", "español": "es", "espanol": "es", "castellano": "es", "espagnol": "es", "spanisch": "es", "spagnolo": "es",
    "french": "fr", "français": "fr", "francais": "fr", "franzosisch": "fr", "francese": "fr", "francés": "fr",
    "german": "de", "deutsch": "de", "allemand": "de", "alemán": "de", "aleman": "de", "tedesco": "de",
    "italian": "it", "italiano": "it", "italien": "it",
    "portuguese": "pt", "português": "pt", "portugues": "pt", "brésilien": "pt", "brazilian": "pt",
    "dutch": "nl", "nederlands": "nl", "hollandais": "nl", "flemish": "nl",
    "russian": "ru", "русский": "ru", "russe": "ru", "russisch": "ru",
    "japanese": "ja", "日本語": "ja", "japonais": "ja", "japanisch": "ja",
    "chinese": "zh", "中文": "zh", "mandarin": "zh", "chinois": "zh", "chinesisch": "zh", "mandarín": "zh", "cantonese": "zh",
    "korean": "ko", "한국어": "ko", "coréen": "ko", "koreanisch": "ko",
    "arabic": "ar", "عربي": "ar", "arabe": "ar", "arabisch": "ar",
    "hindi": "hi", "हिंदी": "hi", "hindi language": "hi",
    "turkish": "tr", "türkçe": "tr", "turc": "tr", "türkisch": "tr",
    "polish": "pl", "polski": "pl", "polonais": "pl", "polnisch": "pl",
    "swedish": "sv", "svenska": "sv", "suédois": "sv", "schwedisch": "sv",
    "danish": "da", "dansk": "da", "danois": "da",
    "norwegian": "no", "norsk": "no", "norvégien": "no",
    "finnish": "fi", "suomi": "fi", "finlandais": "fi",
    "greek": "el", "ελληνικά": "el", "grec": "el", "griechisch": "el",
    "hebrew": "he", "עברית": "he", "hébreu": "he", "hebräisch": "he",
    "thai": "th", "ภาษาไทย": "th", "thaï": "th",
    "vietnamese": "vi", "tiếng việt": "vi", "vietnamien": "vi",
    "indonesian": "id", "bahasa indonesia": "id", "indonésien": "id",
    "malay": "ms", "bahasa melayu": "ms", "malais": "ms",
    "czech": "cs", "čeština": "cs", "tchèque": "cs", "tschechisch": "cs",
    "romanian": "ro", "română": "ro", "roumain": "ro",
    "hungarian": "hu", "magyar": "hu", "hongrois": "hu",
    "ukrainian": "uk", "українська": "uk", "ukrainien": "uk",
    "catalan": "ca", "català": "ca", "catalan language": "ca",
    "tagalog": "tl", "filipino": "tl", "pilipino": "tl",
    "swahili": "sw", "kiswahili": "sw",
    "bengali": "bn", "বাংলা": "bn", "bangla": "bn",
    "urdu": "ur", "اردو": "ur",
    "persian": "fa", "farsi": "fa", "فارسی": "fa",
    "punjabi": "pa", "ਪੰਜਾਬੀ": "pa",
    "tamil": "ta", "தமிழ்": "ta",
    "telugu": "te", "తెలుగు": "te"
  }
};

export async function seedTranslationCommandsConfig(): Promise<void> {
  try {
    const existing = await fetchPrivateFile("config/translation-commands.json").catch(() => null);
    if (existing?.version === TRANSLATION_COMMANDS_VERSION) {
      console.log(`[GitHubConfig] translation-commands.json already at v${TRANSLATION_COMMANDS_VERSION} — skipping seed`);
      return;
    }
    const ok = await pushPrivateFile(
      "config/translation-commands.json",
      TRANSLATION_COMMANDS_CONFIG,
      `chore: seed translation-commands config v${TRANSLATION_COMMANDS_VERSION}`
    );
    if (ok) {
      console.log(`[GitHubConfig] translation-commands.json seeded to CDN — v${TRANSLATION_COMMANDS_VERSION}`);
    } else {
      console.warn("[GitHubConfig] translation-commands.json seed failed");
    }
  } catch (err: any) {
    console.warn("[GitHubConfig] seedTranslationCommandsConfig error:", err?.message);
  }
}

// ── Platform Activity Check ─────────────────────────────────────────────────
// Checks the CDN repo for recent commits (within 24h) to drive the
// animated update indicator on the frontend. Cached for 3 minutes.

const ACTIVITY_TTL = 3 * 60 * 1000;
let activityCache: { active: boolean; lastCommit: string | null; checkedAt: number } | null = null;

export async function checkPlatformActivity(): Promise<{ active: boolean; lastCommit: string | null }> {
  const now = Date.now();
  if (activityCache && now - activityCache.checkedAt < ACTIVITY_TTL) {
    return { active: activityCache.active, lastCommit: activityCache.lastCommit };
  }

  try {
    const connectors = new ReplitConnectors();
    const resp = await connectors.proxy("github", `/repos/${GITHUB_REPO}/commits?sha=${GITHUB_BRANCH}&per_page=1`, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!resp.ok) throw new Error(`GitHub commits API ${resp.status}`);

    const commits = await resp.json() as Array<{ commit: { author: { date: string } }; sha: string }>;
    if (!commits.length) {
      activityCache = { active: false, lastCommit: null, checkedAt: now };
      return { active: false, lastCommit: null };
    }

    const latestDate = new Date(commits[0].commit.author.date).getTime();
    const active = now - latestDate < 60 * 60 * 1000; // within 1h
    const lastCommit = commits[0].commit.author.date;
    activityCache = { active, lastCommit, checkedAt: now };
    return { active, lastCommit };
  } catch {
    // On error, fall back to cached value or inactive
    if (activityCache) return { active: activityCache.active, lastCommit: activityCache.lastCommit };
    return { active: false, lastCommit: null };
  }
}
