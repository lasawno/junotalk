/**
 * start-whisper-sidecar.ts
 *
 * Manages the lifecycle of the self-hosted Whisper transcription sidecar.
 * Same pattern as start-vision-detector.ts — isolated Python process,
 * health-checked before use, auto-restart on crash.
 *
 * Hardening:
 *  - Port killer uses /proc/net/tcp (pure Node — no lsof/fuser dependency).
 *  - Watchdog auto-restarts the sidecar on crash with capped exponential backoff.
 *  - Crash counter resets to zero when the sidecar passes the health check.
 */

import { spawn, ChildProcess, spawnSync } from "child_process";
import path from "path";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "fs";

/**
 * Kill any process already bound to `port` using /proc/net/tcp so we never
 * depend on lsof / fuser / ss (none of which are guaranteed on NixOS).
 *
 * Algorithm:
 *   1. Read /proc/net/tcp (IPv4) — one row per socket.
 *   2. Find the row whose local_address column matches the port.
 *   3. Extract the socket inode from that row.
 *   4. Scan /proc/<pid>/fd symlinks for a link that names that inode.
 *   5. kill -9 the matching PID.
 */
function killPortProcess(port: number): void {
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
    const tcp = readFileSync("/proc/net/tcp", "utf8");

    let targetInode: string | null = null;
    for (const line of tcp.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (!cols[1]) continue;
      const localHexPort = cols[1].split(":")[1];
      if (localHexPort?.toUpperCase() === hexPort) {
        targetInode = cols[9];
        break;
      }
    }
    if (!targetInode) return;

    // Scan /proc/<pid>/fd for the matching socket inode
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try {
            const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (link === `socket:[${targetInode}]`) {
              console.log(`[SidecarGuard] Killing stale process ${pid} on port ${port}`);
              spawnSync("kill", ["-9", pid]);
              // Brief pause so the OS reclaims the port
              spawnSync("sleep", ["0.5"]);
              return;
            }
          } catch {}
        }
      } catch {}
    }
  } catch {
    // /proc not available or permission denied — silently skip
  }
}


let whisperProcess: ChildProcess | null = null;
let starting = false;
let ready = false;
let readyPromise: Promise<boolean> | null = null;
let crashCount = 0;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

const WHISPER_PORT = parseInt(process.env.WHISPER_SIDECAR_PORT || "5099", 10);
const MAX_RESTART_DELAY_MS = 30_000;

/** Schedule an automatic restart after a crash, with capped exponential backoff. */
function scheduleRestart(): void {
  if (watchdogTimer) return;
  const delayMs = Math.min(1000 * 2 ** crashCount, MAX_RESTART_DELAY_MS);
  console.log(`[WhisperSidecar] Watchdog: restarting in ${delayMs / 1000}s (crash #${crashCount + 1})`);
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    crashCount++;
    ensureWhisperSidecarStarted();
  }, delayMs);
}

function findScript(): string {
  const dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const candidates = [
    path.join(dir, "whisper-sidecar.py"),
    path.resolve(process.cwd(), "server/whisper-sidecar.py"),
    path.resolve(process.cwd(), "dist/whisper-sidecar.py"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[1];
}

async function waitForReady(timeoutMs = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.model_loaded) {
          ready = true;
          crashCount = 0;
          console.log(`[WhisperSidecar] Ready — model: ${data.model_size}`);
          return true;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

export function ensureWhisperSidecarStarted(): void {
  if (whisperProcess || starting) return;
  starting = true;

  const scriptPath = findScript();
  console.log("[WhisperSidecar] Starting sidecar on port", WHISPER_PORT, "script:", scriptPath);

  killPortProcess(WHISPER_PORT);

  whisperProcess = spawn("python3", [scriptPath], {
    env: {
      ...process.env,
      WHISPER_SIDECAR_PORT: String(WHISPER_PORT),
      WHISPER_MODEL_SIZE: process.env.WHISPER_MODEL_SIZE || "base",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  whisperProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(msg);
  });

  whisperProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(msg);
  });

  whisperProcess.on("exit", (code) => {
    console.log(`[WhisperSidecar] Process exited with code ${code}`);
    whisperProcess = null;
    starting = false;
    ready = false;
    readyPromise = null;
    scheduleRestart();
  });

  whisperProcess.on("error", (err) => {
    console.error("[WhisperSidecar] Failed to start:", err.message);
    whisperProcess = null;
    starting = false;
    ready = false;
    readyPromise = null;
    scheduleRestart();
  });

  starting = false;
  readyPromise = waitForReady();
}

export async function waitForWhisperSidecar(timeoutMs = 60000): Promise<boolean> {
  if (ready) return true;
  if (!whisperProcess && !starting) {
    ensureWhisperSidecarStarted();
  }
  if (readyPromise) {
    const timeout = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs));
    return Promise.race([readyPromise, timeout]);
  }
  return false;
}

export function isWhisperSidecarReady(): boolean {
  return ready;
}

export function getWhisperSidecarPort(): string {
  return String(WHISPER_PORT);
}

export async function transcribeWithLocalWhisper(
  audioBuffer: Buffer,
  mimeType: string,
  language?: string
): Promise<{ text: string; language?: string; latency_ms: number } | null> {
  if (!ready) return null;

  let extension = "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) extension = "mp4";
  else if (mimeType.includes("wav")) extension = "wav";
  else if (mimeType.includes("ogg")) extension = "ogg";
  else if (mimeType.includes("mp3")) extension = "mp3";

  try {
    const form = new FormData();
    form.append("audio", new Blob([audioBuffer], { type: mimeType }), `audio.${extension}`);
    if (language) form.append("language", language);

    const response = await fetch(`http://127.0.0.1:${WHISPER_PORT}/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) return null;

    const data = await response.json() as any;
    return {
      text: data.text || "",
      language: data.language,
      latency_ms: data.latency_ms || 0,
    };
  } catch (e: any) {
    console.warn("[WhisperSidecar] Transcription failed:", e.message);
    return null;
  }
}
