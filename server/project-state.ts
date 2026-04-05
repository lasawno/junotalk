/**
 * Project State — Authoritative Architecture Memory
 *
 * Loads `config/project-state.json` from the private GitHub CDN repo
 * (lasawno/junotalk-cdn) at startup and refreshes every hour.
 *
 * Purpose:
 *   - Gives every agent session an authoritative record of architectural
 *     decisions, completed migrations, and which keys live in the CDN.
 *   - Prevents regressions like re-introducing hardcoded values for keys
 *     that were already moved to the CDN.
 *
 * Flow:
 *   1. On startup, `initProjectState()` loads the state from GitHub CDN.
 *   2. `getProjectState()` returns the current in-memory state at any time.
 *   3. `recordDecision()` adds a new entry and immediately pushes back to CDN.
 *   4. Hourly refresh keeps the in-memory state in sync with CDN edits.
 *
 * CDN file: config/project-state.json
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fetchPrivateFile, pushPrivateFile } from "./github-config";

const SNAPSHOT_DIR = path.resolve(process.cwd(), "vault/project-state");
const REFRESH_TTL = 60 * 60 * 1000;
const CDN_PATH = "config/project-state.json";

export interface MigrationRecord {
  date: string;
  description: string;
  files?: string[];
}

export interface ArchitectureDecision {
  date: string;
  decision: string;
  rationale?: string;
}

export interface ProjectState {
  _version: string;
  _lastUpdated: string;
  _updatedBy: string;
  cdnKeys: string[];
  neverHardcode: string;
  securityRules: string[];
  migrations: MigrationRecord[];
  architectureDecisions: ArchitectureDecision[];
}

const DEFAULT_STATE: ProjectState = {
  _version: "1.0.0",
  _lastUpdated: new Date().toISOString(),
  _updatedBy: "project-state init",
  cdnKeys: [
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "MOONSHOT_API_KEY",
    "HF_TOKEN",
    "ENCRYPTION_KEY",
    "RECAPTCHA_SECRET_KEY",
    "YOUTUBE_INTERNAL_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ],
  neverHardcode: "No API key values should ever be hardcoded in source code. All keys load exclusively from the GitHub CDN (config/api-keys.json) with Replit secret as fallback. Never add inline literal key values to server/api-keys.ts.",
  securityRules: [
    "No hardcoded API key literals anywhere in the codebase.",
    "All keys in cdnKeys[] are stored in config/api-keys.json on the CDN — do not add fallback literals for them.",
    "GITHUB_TOKEN and Replit integration keys (AI_INTEGRATIONS_*) remain env-only and are never moved to the CDN.",
    "SecretsGuard scrubs all keys from logs and API responses at runtime.",
  ],
  migrations: [
    {
      date: "2026-03-26T00:00:00.000Z",
      description: "YOUTUBE_INTERNAL_KEY moved to GitHub CDN. Hardcoded fallback removed from server/api-keys.ts.",
      files: ["server/api-keys.ts"],
    },
  ],
  architectureDecisions: [
    {
      date: "2026-03-26T00:00:00.000Z",
      decision: "All API keys are loaded exclusively from the GitHub CDN with no hardcoded fallback values.",
      rationale: "Prevents static analysis false positives, keeps secrets out of source code, and centralises key rotation.",
    },
  ],
};

let _state: ProjectState = { ...DEFAULT_STATE };
let _lastFetch = 0;
let _initialized = false;
let _initPromise: Promise<void> | null = null;

async function loadFromCDN(): Promise<void> {
  if (Date.now() - _lastFetch < REFRESH_TTL && _initialized) return;
  try {
    const remote = await fetchPrivateFile(CDN_PATH);
    if (remote && typeof remote === "object") {
      _state = { ...DEFAULT_STATE, ...remote };
      _lastFetch = Date.now();
      console.log(`[ProjectState] Loaded from CDN: ${_state.cdnKeys.length} CDN keys, ${_state.migrations.length} migrations, ${_state.architectureDecisions.length} decisions`);
    } else {
      console.log("[ProjectState] config/project-state.json not found in CDN — scheduling bootstrap push in 10s...");
      setTimeout(async () => {
        const ok = await pushPrivateFile(CDN_PATH, DEFAULT_STATE, "[ProjectState] Bootstrap initial project state");
        if (ok) {
          _lastFetch = Date.now();
          console.log("[ProjectState] Initial project-state.json created in GitHub CDN successfully.");
        } else {
          console.warn("[ProjectState] Bootstrap push failed — check GitHub connector permissions.");
        }
      }, 10_000);
    }
  } catch (err: any) {
    console.warn("[ProjectState] CDN load failed (using defaults):", err.message);
  }
}

async function saveSnapshot(): Promise<void> {
  try {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const lines = [
      `# Project State Snapshot`,
      `Updated: ${new Date().toISOString()}`,
      ``,
      `## CDN Keys (${_state.cdnKeys.length})`,
      _state.cdnKeys.map(k => `- ${k}`).join("\n"),
      ``,
      `## Security Rules`,
      _state.securityRules.map(r => `- ${r}`).join("\n"),
      ``,
      `## Migrations (${_state.migrations.length})`,
      ..._state.migrations.map(m => `### ${m.date}\n${m.description}${m.files ? `\nFiles: ${m.files.join(", ")}` : ""}`),
      ``,
      `## Architecture Decisions (${_state.architectureDecisions.length})`,
      ..._state.architectureDecisions.map(d => `### ${d.date}\n**Decision:** ${d.decision}${d.rationale ? `\n**Rationale:** ${d.rationale}` : ""}`),
    ];
    await writeFile(path.join(SNAPSHOT_DIR, "snapshot.md"), lines.join("\n"), "utf-8");
  } catch {}
}

/** Returns the current in-memory project state. */
export function getProjectState(): ProjectState {
  return _state;
}

/** Returns true if a given key name is tracked in the CDN (and must never be hardcoded). */
export function isKeyInCDN(keyName: string): boolean {
  return _state.cdnKeys.includes(keyName);
}

/**
 * Record a migration or architecture decision and push it immediately to the CDN.
 * Use this whenever a key is moved, a feature is migrated, or a rule is established.
 */
export async function recordDecision(opts: {
  type: "migration" | "decision";
  description: string;
  rationale?: string;
  files?: string[];
  cdnKeysAdded?: string[];
}): Promise<boolean> {
  const now = new Date().toISOString();

  if (opts.type === "migration") {
    _state.migrations.push({ date: now, description: opts.description, files: opts.files });
  } else {
    _state.architectureDecisions.push({ date: now, decision: opts.description, rationale: opts.rationale });
  }

  if (opts.cdnKeysAdded) {
    for (const key of opts.cdnKeysAdded) {
      if (!_state.cdnKeys.includes(key)) _state.cdnKeys.push(key);
    }
  }

  _state._lastUpdated = now;
  _state._updatedBy = "recordDecision() auto-push";

  const ok = await pushProjectState(`[ProjectState] ${opts.type}: ${opts.description.slice(0, 80)}`);
  if (ok) console.log(`[ProjectState] Decision recorded and pushed to CDN.`);
  return ok;
}

/** Push the current in-memory state to the GitHub CDN. */
export async function pushProjectState(commitMessage = "[ProjectState] Update project state"): Promise<boolean> {
  _state._lastUpdated = new Date().toISOString();
  const ok = await pushPrivateFile(CDN_PATH, _state, commitMessage);
  if (ok) await saveSnapshot();
  return ok;
}

export function getProjectStateStatus() {
  return {
    initialized: _initialized,
    lastFetch: _lastFetch ? new Date(_lastFetch).toISOString() : null,
    cdnKeyCount: _state.cdnKeys.length,
    migrationCount: _state.migrations.length,
    decisionCount: _state.architectureDecisions.length,
    lastUpdated: _state._lastUpdated,
    version: _state._version,
  };
}

export async function initProjectState(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      await loadFromCDN();
      await saveSnapshot();
      _initialized = true;
      const s = getProjectStateStatus();
      console.log(`[ProjectState] Initialized: ${s.cdnKeyCount} CDN keys, ${s.migrationCount} migrations, ${s.decisionCount} decisions`);
    } catch (err: any) {
      console.warn("[ProjectState] Init failed (using defaults):", err.message);
      _initialized = true;
    }
  })();

  return _initPromise;
}

initProjectState().catch(() => {});
setInterval(() => loadFromCDN().then(() => saveSnapshot()).catch(() => {}), REFRESH_TTL);
