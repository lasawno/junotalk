/**
 * Image Config — CDN-controlled image generation settings
 *
 * Reads `ai-images/config.json` from the GitHub CDN on startup.
 * Falls back to hardcoded defaults if CDN is unreachable.
 * All image pipeline behavior (models, limits, style, on/off) is
 * controlled from the CDN file — zero code deploys needed.
 */

import { fetchPrivateFile } from "./github-config";

// ── CDN path ──────────────────────────────────────────────────────────────────
export const IMAGE_CONFIG_CDN_PATH = "ai-images/config.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageModelDef {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ImageGenConfig {
  version: string;
  description: string;
  enabled: boolean;
  dailyLimit: number;
  safeMode: boolean;
  enhancePrompt: boolean;
  styleAppend: string;
  imageWidth: number;
  imageHeight: number;
  models: ImageModelDef[];
  rateLimitMessage: string;
}

// ── Hardcoded defaults (identical to what gets written to CDN) ────────────────
export const IMAGE_CONFIG_DEFAULT: ImageGenConfig = {
  version: "1.0.0",
  description:
    "Juno AI Image Generation — remote config. Edit this file on GitHub to change models, limits, and style without code deploys.",
  enabled: true,
  dailyLimit: 10,
  safeMode: true,
  enhancePrompt: true,
  styleAppend: "high quality, detailed, cinematic",
  imageWidth: 1024,
  imageHeight: 1024,
  models: [
    { id: "flux",              label: "Flux",           enabled: true  },
    { id: "turbo",             label: "Turbo",           enabled: true  },
    { id: "flux-realism",      label: "Realism",         enabled: true  },
    { id: "dreamshaper",       label: "DreamShaper",     enabled: true  },
    { id: "flux-anime",        label: "Anime",           enabled: true  },
    { id: "flux-3d",           label: "3D Render",       enabled: true  },
    { id: "any-dark",          label: "Dark",            enabled: true  },
    { id: "stable-diffusion",  label: "Stable Diffusion",enabled: true  },
  ],
  rateLimitMessage:
    "You've used all {limit} image generations for today. Your next slot opens in {hours} hour(s).",
};

// ── Live config (loaded once at startup, hot-reloadable) ──────────────────────
let _liveConfig: ImageGenConfig = { ...IMAGE_CONFIG_DEFAULT };

export function getImageConfig(): ImageGenConfig {
  return _liveConfig;
}

export function getEnabledModels(): ImageModelDef[] {
  return _liveConfig.models.filter((m) => m.enabled);
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadImageConfig(): Promise<void> {
  try {
    let raw: any = null;

    // Primary: Replit GitHub connector (proven read path)
    try {
      raw = await fetchPrivateFile(IMAGE_CONFIG_CDN_PATH);
    } catch (connErr: any) {
      console.log("[ImageConfig] Connector fetch threw:", connErr?.message || connErr);
    }

    // Fallback: direct GitHub raw URL (public read, no auth required)
    if (!raw) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/lasawno/junotalk-cdn/main/${IMAGE_CONFIG_CDN_PATH}`;
        const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          const text = await resp.text();
          raw = JSON.parse(text);
          console.log("[ImageConfig] Loaded via raw.githubusercontent.com fallback");
        } else {
          console.log("[ImageConfig] Raw URL returned", resp.status, "— offline defaults active");
        }
      } catch (rawErr: any) {
        console.log("[ImageConfig] Raw URL fetch failed:", rawErr?.message || rawErr);
      }
    }

    if (!raw || typeof raw !== "object") {
      console.log("[ImageConfig] CDN returned null — offline defaults active");
      return;
    }

    // Merge CDN values over defaults so new fields added later don't break
    _liveConfig = {
      ...IMAGE_CONFIG_DEFAULT,
      ...raw,
      models: Array.isArray(raw.models) && raw.models.length
        ? raw.models
        : IMAGE_CONFIG_DEFAULT.models,
    };

    const enabled = getEnabledModels();
    console.log(
      `[ImageConfig] Loaded from CDN — v${_liveConfig.version}, ` +
      `enabled=${_liveConfig.enabled}, limit=${_liveConfig.dailyLimit}/day, ` +
      `models: ${enabled.map((m) => m.id).join(", ")}`
    );
  } catch (err: any) {
    console.log("[ImageConfig] CDN load failed — offline defaults active:", err?.message || err);
  }
}
