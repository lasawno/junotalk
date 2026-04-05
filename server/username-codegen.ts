import path from "path";
import fs from "fs";

let wasmModule: any = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  try {
    const wasmPath = path.resolve(__dirname, "wasm-codegen", "codegen.js");
    if (fs.existsSync(wasmPath)) {
      wasmModule = require(wasmPath);
      return wasmModule;
    }
    const altPath = path.resolve(process.cwd(), "server", "wasm-codegen", "codegen.js");
    if (fs.existsSync(altPath)) {
      wasmModule = require(altPath);
      return wasmModule;
    }
  } catch {}
  return null;
}

function jsFallbackHash(username: string): number {
  let hash = 5381;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash * 33) + username.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function jsFallbackCode(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h, 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h % 900) + 100;
}

export async function generateUsernameCode(username: string, attempt: number = 0): Promise<string> {
  const wasm = await loadWasm();
  let code: number;

  if (wasm) {
    const bytes = new TextEncoder().encode(username.toLowerCase());
    const baseHash = wasm.hash_username(bytes);
    code = wasm.generate_code((baseHash + attempt) >>> 0);
  } else {
    const baseHash = jsFallbackHash(username.toLowerCase());
    code = jsFallbackCode((baseHash + attempt) >>> 0);
  }

  const raw = Math.abs(code) % 900 + 100;
  return raw.toString();
}

export async function isWasmLoaded(): Promise<boolean> {
  const wasm = await loadWasm();
  return wasm !== null;
}
