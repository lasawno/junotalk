import { spawn } from "child_process";
import path from "path";

let piperProcess: ReturnType<typeof spawn> | null = null;
let restartAttempts = 0;
let lazyStarted = false;
const MAX_RESTART_ATTEMPTS = 5;

function doStartPiper(): void {
  if (piperProcess) {
    return;
  }

  const serverPath = path.join(import.meta.dirname || __dirname, "piper-tts-server.py");
  const port = process.env.PIPER_TTS_PORT || "5097";

  console.log(`[Piper TTS] Starting server on port ${port}...`);

  piperProcess = spawn("python3", [serverPath], {
    env: { ...process.env, PIPER_TTS_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });

  piperProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(msg);
      if (msg.includes("Server running")) {
        restartAttempts = 0;
      }
    }
  });

  piperProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[Piper TTS] ${msg}`);
  });

  piperProcess.on("exit", (code: number | null) => {
    console.warn(`[Piper TTS] Process exited with code ${code}`);
    piperProcess = null;
    if (code !== 0 && code !== null) {
      restartAttempts++;
      if (restartAttempts <= MAX_RESTART_ATTEMPTS) {
        const delay = Math.min(10000 * restartAttempts, 60000);
        console.log(`[Piper TTS] Retry ${restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay / 1000}s...`);
        setTimeout(doStartPiper, delay);
      } else {
        console.error("[Piper TTS] Max restart attempts reached, giving up. OpenAI TTS fallback active.");
      }
    }
  });

  piperProcess.on("error", (err: Error) => {
    console.error("[Piper TTS] Failed to start:", err.message);
    piperProcess = null;
    lazyStarted = false;
  });
}

export function startPiperTTS(): void {
  console.log("[Piper TTS] Registered for lazy start on first TTS request");
}

export function ensurePiperStarted(): void {
  if (!lazyStarted) {
    lazyStarted = true;
    doStartPiper();
  }
}

export function stopPiperTTS(): void {
  if (piperProcess) {
    piperProcess.kill("SIGTERM");
    piperProcess = null;
  }
}
