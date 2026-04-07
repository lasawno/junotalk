import { spawn, spawnSync } from "child_process";
import path from "path";

let edgeProcess: ReturnType<typeof spawn> | null = null;
let restartAttempts = 0;
let lazyStarted = false;
let isReady = false;
const MAX_RESTART_ATTEMPTS = 5;
const PORT = process.env.EDGE_TTS_PORT || "5096";

function killStaleOnPort(port: string): void {
  if (!/^\d+$/.test(port)) {
    console.warn(`[EdgeTTS] Refusing to kill stale process: invalid port "${port}"`);
    return;
  }
  try {
    const result = spawnSync("lsof", ["-ti", `:${port}`], { stdio: ["ignore", "pipe", "ignore"] });
    const pids = (result.stdout?.toString() ?? "").trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 9);
      } catch {
        // process already gone
      }
    }
  } catch {
    // nothing to kill
  }
}

function doStartEdgeTTS(): void {
  if (edgeProcess) return;

  killStaleOnPort(PORT);

  const serverPath = path.join(
    (import.meta as any).dirname || __dirname,
    "edge-tts-sidecar.py"
  );

  console.log(`[EdgeTTS] Starting sidecar on port ${PORT}...`);
  isReady = false;

  edgeProcess = spawn("python3", [serverPath], {
    env: { ...process.env, EDGE_TTS_PORT: PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });

  edgeProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(msg);
      if (msg.includes("Server running")) {
        isReady = true;
        restartAttempts = 0;
      }
    }
  });

  edgeProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[EdgeTTS] ${msg}`);
  });

  edgeProcess.on("exit", (code: number | null) => {
    console.warn(`[EdgeTTS] Process exited with code ${code}`);
    edgeProcess = null;
    isReady = false;
    if (code !== 0 && code !== null) {
      restartAttempts++;
      if (restartAttempts <= MAX_RESTART_ATTEMPTS) {
        const delay = Math.min(5000 * restartAttempts, 30000);
        console.log(`[EdgeTTS] Retry ${restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay / 1000}s...`);
        setTimeout(doStartEdgeTTS, delay);
      } else {
        console.error("[EdgeTTS] Max restart attempts reached.");
      }
    }
  });

  edgeProcess.on("error", (err: Error) => {
    console.error("[EdgeTTS] Failed to start:", err.message);
    edgeProcess = null;
    lazyStarted = false;
    isReady = false;
  });
}

export function startEdgeTTS(): void {
  console.log("[EdgeTTS] Registered for lazy start on first TTS request");
}

export function ensureEdgeTTSStarted(): void {
  if (!lazyStarted) {
    lazyStarted = true;
    doStartEdgeTTS();
  }
}

export function isEdgeTTSReady(): boolean {
  return isReady;
}

export function getEdgeTTSPort(): string {
  return PORT;
}

export function stopEdgeTTS(): void {
  if (edgeProcess) {
    edgeProcess.kill("SIGTERM");
    edgeProcess = null;
    isReady = false;
  }
}
