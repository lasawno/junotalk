/**
 * TTS Controller — isolated voice synthesis pipeline
 *
 * Priority chain (never change order without testing each step):
 *   1. Edge TTS  — Microsoft neural voices via local sidecar (port 5096, no API key)
 *   2. OpenAI TTS — only if a real key is configured (not the Replit dummy)
 *   3. 503        — client falls back to browser SpeechSynthesis automatically
 *
 * Client flow that feeds this:
 *   VoiceSession.ts → vsFetchAudio() → POST /api/v1/tts
 *   → _playBuffer() → <audio> element (iOS safe)
 *
 * Voice Tuning Agent:
 *   Every synthesis attempt (success or error) is recorded via voiceTuningAgent.recordResult().
 *   The agent adjusts styledegree + break timings every 30 minutes and persists the
 *   winning config to GitHub CDN. This works transparently across ALL voice surfaces
 *   (Juno overlay, voice-translate, any future surface) because every voice request
 *   goes through this single endpoint.
 *
 * DO NOT move this logic back into routes.ts.
 * This file exists to protect a hard-won working pipeline.
 */

import type { Request, Response } from "express";
import { storage } from "../storage";
import { toolEdgeTTS, toolOpenAITTS } from "../tools";
import { getToolStatus, TOOL_NAMES } from "../tool-execution-service";
import { voiceTuningAgent } from "../voice-tuning-agent";

const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

async function resolveVoice(req: Request, requested: string | undefined): Promise<string> {
  if (requested && VALID_VOICES.includes(requested as any)) return requested;
  try {
    const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
    if (userId) {
      const prefs = await storage.getPreferences(userId);
      if (prefs?.voiceIdentityEnabled && prefs.voiceIdentityVoice && VALID_VOICES.includes(prefs.voiceIdentityVoice as any)) {
        return prefs.voiceIdentityVoice;
      }
    }
  } catch {}
  return "nova";
}

export async function handleTTS(req: Request, res: Response) {
  try {
    const { text, voice, lang, speed: userSpeed } = req.body;

    if (!text) {
      return res.status(400).json({ message: "Text is required" });
    }

    const ttsInput = (text as string).slice(0, 4096);
    const ttsSpeed = typeof userSpeed === "number" && userSpeed >= 0.5 && userSpeed <= 1.5 ? userSpeed : 0.95;
    const selectedVoice = await resolveVoice(req, voice);
    const ttsLang = lang || "en";

    // Get current tuned params from the voice-tuning agent (live-updated every 30 min)
    const { styledegree } = voiceTuningAgent.getCurrentParams();

    // ── 1. Edge TTS (Microsoft neural — primary, no API key needed) ────────────
    if (getToolStatus(TOOL_NAMES.TTS_EDGE).available) {
      const t0 = Date.now();
      let edgeResult: Awaited<ReturnType<typeof toolEdgeTTS>> = null;
      let edgeError = false;

      try {
        edgeResult = await toolEdgeTTS(ttsInput, selectedVoice, ttsLang, ttsSpeed, styledegree);
      } catch {
        edgeError = true;
      }

      const latencyMs = Date.now() - t0;

      if (edgeResult && edgeResult.buffer.length > 0) {
        voiceTuningAgent.recordResult(latencyMs, true, "edge");
        res.set({
          "Content-Type": edgeResult.contentType,
          "Content-Length": edgeResult.buffer.length.toString(),
          "Cache-Control": "public, max-age=3600",
          "X-TTS-Engine": "edge",
          "X-Voice-Styledegree": String(styledegree),
        });
        return res.send(edgeResult.buffer);
      }

      // Edge failed — record the error
      voiceTuningAgent.recordResult(latencyMs, false, "edge");
    }

    // ── 2. OpenAI TTS (only when a real key is present) ───────────────────────
    const { apiKeys } = await import("../api-keys");
    const openaiKey = apiKeys.openai();
    const hasRealKey = !!openaiKey && !openaiKey.startsWith("_DUMMY_");
    if (!hasRealKey || !getToolStatus(TOOL_NAMES.TTS_OPENAI).available) {
      // ── 3. Signal client to fall back to browser SpeechSynthesis ───────────
      return res.status(503).json({ message: "TTS unavailable — use browser speech" });
    }

    const t0 = Date.now();
    let openaiResult: Awaited<ReturnType<typeof toolOpenAITTS>>;
    try {
      openaiResult = await toolOpenAITTS(ttsInput, selectedVoice, ttsSpeed, ttsLang);
    } catch {
      voiceTuningAgent.recordResult(Date.now() - t0, false, "openai");
      return res.status(500).json({ message: "TTS generation failed" });
    }

    if (!openaiResult.buffer.length) {
      voiceTuningAgent.recordResult(Date.now() - t0, false, "openai");
      return res.status(500).json({ message: "TTS generation failed" });
    }

    voiceTuningAgent.recordResult(Date.now() - t0, true, "openai");
    res.set({
      "Content-Type": openaiResult.contentType,
      "Content-Length": openaiResult.buffer.length.toString(),
      "Cache-Control": "public, max-age=3600",
      "X-TTS-Engine": "openai",
    });
    return res.send(openaiResult.buffer);

  } catch (err) {
    console.error("[TTS] Error:", err);
    return res.status(500).json({ message: "Text-to-speech failed" });
  }
}
