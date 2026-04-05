/**
 * start-vision-detector.ts
 *
 * Manages the lifecycle of the vision/OCR detector sidecar.
 * Same pattern as start-whisper-sidecar.ts — isolated Python process,
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
import net from "net";

/**
 * Kill any process already bound to `port` using /proc/net/tcp so we never
 * depend on lsof / fuser / ss (none of which are guaranteed on NixOS).
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

    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try {
            const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (link === `socket:[${targetInode}]`) {
              console.log(`[SidecarGuard] Killing stale process ${pid} on port ${port}`);
              spawnSync("kill", ["-9", pid]);
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

let visionProcess: ChildProcess | null = null;
let starting = false;
let ready = false;
let readyPromise: Promise<boolean> | null = null;
let crashCount = 0;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

const VISION_PORT = parseInt(process.env.VISION_DETECTOR_PORT || "5098", 10);
const MAX_RESTART_DELAY_MS = 30_000;

/** Schedule an automatic restart after a crash, with capped exponential backoff. */
function scheduleRestart(): void {
  if (watchdogTimer) return;
  const delayMs = Math.min(1000 * 2 ** crashCount, MAX_RESTART_DELAY_MS);
  console.log(`[VisionDetector] Watchdog: restarting in ${delayMs / 1000}s (crash #${crashCount + 1})`);
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    crashCount++;
    ensureVisionDetectorStarted();
  }, delayMs);
}

function findScript(): string {
  const dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const candidates = [
    path.join(dir, "vision-detector.py"),
    path.resolve(process.cwd(), "server/vision-detector.py"),
    path.resolve(process.cwd(), "dist/vision-detector.py"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[1];
}

async function waitForReady(timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${VISION_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.yolo_loaded) {
          ready = true;
          crashCount = 0;
          console.log(`[VisionDetector] Ready — port ${VISION_PORT}`);
          return true;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export function ensureVisionDetectorStarted(): void {
  if (visionProcess || starting) return;
  starting = true;

  const scriptPath = findScript();
  console.log("[VisionDetector] Starting sidecar on port", VISION_PORT, "script:", scriptPath);

  killPortProcess(VISION_PORT);

  visionProcess = spawn("python3", [scriptPath], {
    env: { ...process.env, VISION_DETECTOR_PORT: String(VISION_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  visionProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(msg);
  });

  visionProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(msg);
  });

  visionProcess.on("exit", (code) => {
    console.log(`[VisionDetector] Process exited with code ${code}`);
    visionProcess = null;
    starting = false;
    ready = false;
    readyPromise = null;
    scheduleRestart();
  });

  visionProcess.on("error", (err) => {
    console.error("[VisionDetector] Failed to start:", err.message);
    visionProcess = null;
    starting = false;
    ready = false;
    readyPromise = null;
    scheduleRestart();
  });

  starting = false;
  readyPromise = waitForReady();
}

export async function waitForVisionDetector(timeoutMs = 30000): Promise<boolean> {
  if (ready) return true;
  if (!visionProcess && !starting) {
    ensureVisionDetectorStarted();
  }
  if (readyPromise) {
    const timeout = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs));
    return Promise.race([readyPromise, timeout]);
  }
  return false;
}

export function isVisionDetectorReady(): boolean {
  return ready;
}

export function getVisionDetectorPort(): string {
  return String(VISION_PORT);
}
