import { Router } from "express";
import { toFile } from "openai/uploads";
import jwt from "jsonwebtoken";
import { getToolStatus, TOOL_NAMES } from "../tool-execution-service";
import { apiKeys } from "../api-keys";
import { toolKimiChat, toolClaudeChat, toolPiperTTS, toolOpenAITTS } from "../tools";

export function createVideoRouter(deps: {
  isAuthenticated: any;
  upload: any;
  storage: any;
  openaiSTTClient: any;
  anthropic: any;
  resolvedAnthropicKey: string | undefined;
  trackAction: (action: string, feature: string) => void;
  trackTokenUsage: (provider: string, input: number, output: number, feature: string) => void;
  recordProviderLatency: (provider: any, ms: number, success: boolean) => void;
  videoCaptionCache: any;
  translatedCaptionCache: any;
  extractAudioFromVideo: (videoBase64: string) => Promise<Buffer>;
  transcribeVideoAudio: (audioBuffer: Buffer, languageHint?: string) => Promise<any>;
  translateSegments: (segments: any[], targetLang: string, sourceLang: string) => Promise<any[]>;
  burnCaptionsIntoVideo: (videoBase64: string, captions: any[]) => Promise<string>;
}) {
  const router = Router();
  const {
    isAuthenticated, upload, storage, openaiSTTClient, anthropic, resolvedAnthropicKey,
    trackAction, trackTokenUsage, recordProviderLatency, videoCaptionCache, translatedCaptionCache,
    extractAudioFromVideo, transcribeVideoAudio, translateSegments, burnCaptionsIntoVideo,
  } = deps;

  router.get("/jitsi/config", isAuthenticated, (_req: any, res) => {
    const appId = process.env.JAAS_APP_ID;
    const rawKey = process.env.JAAS_API_KEY;
    const keyId = process.env.JAAS_KEY_ID;
    if (!appId || !rawKey || !keyId) {
      return res.status(500).json({ message: "JaaS not configured" });
    }
    res.json({ appId });
  });

  router.get("/jaas/token", isAuthenticated, (req: any, res) => {
    const appId = process.env.JAAS_APP_ID;
    const rawKey = process.env.JAAS_API_KEY;
    const keyId = process.env.JAAS_KEY_ID;
    if (!appId || !rawKey || !keyId) {
      return res.status(500).json({ message: "JaaS not configured" });
    }
    try {
      const userId = req.user?.claims?.sub || "anonymous";
      const userName = req.user?.claims?.first_name || "Guest";
      const roomCode = (req.query.room as string || "default").toUpperCase();
      const pemHeader = ["-----", "BEGIN RSA PRIVATE KEY", "-----"].join("");
      const pemFooter = ["-----", "END RSA PRIVATE KEY", "-----"].join("");
      const pemKey = rawKey.includes("BEGIN") ? rawKey : `${pemHeader}\n${rawKey}\n${pemFooter}`;
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        aud: "jitsi",
        iss: "chat",
        sub: appId,
        room: roomCode,
        iat: now,
        nbf: now - 10,
        exp: now + 7200,
        context: {
          user: { id: userId, name: userName, avatar: "", email: "", moderator: "true" },
          features: { livestreaming: "false", recording: "false", "outbound-call": "false", transcription: "false" },
        },
      };
      const token = jwt.sign(payload, pemKey, { algorithm: "RS256", header: { alg: "RS256", kid: keyId, typ: "JWT" } });
      res.json({ token });
    } catch (err: any) {
      console.error("JaaS token generation failed:", err?.message);
      res.status(500).json({ message: "Token generation failed" });
    }
  });

  router.post("/tts", isAuthenticated, async (req, res) => {
    try {
      const { text, voice = "nova", lang, speed: userSpeed } = req.body;

      if (!text) {
        return res.status(400).json({ message: "Text is required" });
      }
      const ttsInput = text.slice(0, 4096);

      const piperSupportedLangs = ["en"];
      const usePiper = !lang || lang === "en" || piperSupportedLangs.includes(lang);

      if (usePiper && getToolStatus(TOOL_NAMES.TTS_PIPER).available) {
        const piperResult = await toolPiperTTS(ttsInput);
        if (piperResult) {
          res.set({
            "Content-Type": piperResult.contentType,
            "Content-Length": piperResult.buffer.length.toString(),
            "Cache-Control": "public, max-age=3600",
          });
          return res.send(piperResult.buffer);
        }
      }

      const ttsSpeed = typeof userSpeed === "number" && userSpeed >= 0.5 && userSpeed <= 1.5 ? userSpeed : 0.92;
      const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
      const selectedVoice = validVoices.includes(voice) ? voice : "nova";

      if (!getToolStatus(TOOL_NAMES.TTS_OPENAI).available) {
        return res.status(503).json({ message: "TTS temporarily unavailable" });
      }

      const openaiResult = await toolOpenAITTS(ttsInput, selectedVoice, ttsSpeed, lang);
      if (!openaiResult.buffer.length) {
        return res.status(500).json({ message: "TTS generation failed" });
      }

      res.set({
        "Content-Type": openaiResult.contentType,
        "Content-Length": openaiResult.buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      });
      res.send(openaiResult.buffer);
    } catch (error) {
      console.error("TTS error:", error);
      res.status(500).json({ message: "Text-to-speech failed" });
    }
  });

  router.post("/caption-cleanup", isAuthenticated, async (req, res) => {
    const captionCleanupStart = Date.now();
    try {
      trackAction("caption_cleanup", "captions");
      const { text } = req.body;
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ message: "Text is required" });
      }
      if (text.length > 500) {
        return res.status(400).json({ message: "Text too long for cleanup" });
      }
      const cleanupSystemPrompt = `You are a real-time caption editor. Clean up speech-to-text output to be more readable.

RULES:
- Fix punctuation, capitalization, and obvious grammar issues
- Remove filler words (um, uh, like, you know) ONLY when they don't add meaning
- Preserve the speaker's natural tone, slang, and intent exactly
- Keep the text concise — do not add words or rephrase
- Output ONLY the cleaned text, nothing else
- If the text is already clean, return it unchanged
- Never add quotes or labels`;

      let cleanedText = "";

      if (apiKeys.moonshot() && getToolStatus(TOOL_NAMES.CAPTION_CLEANUP).available) {
        const kimiResult = await toolKimiChat(
          [{ role: "system", content: cleanupSystemPrompt }, { role: "user", content: text.trim() }],
          { maxTokens: 150, temperature: 0.1, toolName: TOOL_NAMES.CAPTION_CLEANUP }
        );
        cleanedText = kimiResult.text;
        recordProviderLatency("kimi", Date.now() - captionCleanupStart, !!cleanedText);
      }

      if (!cleanedText && resolvedAnthropicKey && getToolStatus(TOOL_NAMES.CAPTION_CLEANUP).available) {
        const claudeResult = await toolClaudeChat(
          [{ role: "user", content: `Clean up this speech-to-text caption to be more readable. Fix punctuation, capitalization, grammar. Remove filler words only when they don't add meaning. Preserve tone and intent. Output ONLY the cleaned text.\n\n${text.trim()}` }],
          { maxTokens: 150, toolName: TOOL_NAMES.CAPTION_CLEANUP }
        );
        cleanedText = claudeResult.text;
        recordProviderLatency("claude", Date.now() - captionCleanupStart, !!cleanedText);
      }

      const elapsed = Date.now() - captionCleanupStart;
      res.json({
        cleanedText: cleanedText || text.trim(),
        enhanced: !!cleanedText,
        latencyMs: elapsed,
      });
    } catch (error: any) {
      console.error("Caption cleanup error:", error?.message);
      res.json({ cleanedText: req.body?.text?.trim() || "", enhanced: false });
    }
  });

  router.post("/call-summary", isAuthenticated, async (req, res) => {
    try {
      trackAction("call_summary", "video_calls");
      const { captions, targetLanguage } = req.body;
      if (!captions || !Array.isArray(captions) || captions.length < 3) {
        return res.status(400).json({ message: "At least 3 captions required for a summary" });
      }
      if (captions.length > 200) {
        return res.status(400).json({ message: "Too many captions — max 200" });
      }
      const targetLangName = targetLanguage
        ? ({ en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi", ru: "Russian", nl: "Dutch", pl: "Polish", cs: "Czech" } as Record<string, string>)[targetLanguage] || "English"
        : "English";

      const transcript = captions
        .map((c: { speaker: string; text: string }) => `[${c.speaker === "you" ? "You" : "Them"}] ${c.text}`)
        .join("\n");

      const summarySystemPrompt = `You are an AI assistant that summarizes video call conversations. Analyze the transcript and produce a structured summary.

OUTPUT FORMAT (respond in ${targetLangName}):
{
  "summary": "A concise 2-4 sentence overview of what was discussed",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "actionItems": ["Action item 1", "Action item 2", ...],
  "duration": "Estimated call duration based on conversation flow",
  "mood": "overall tone of the conversation (e.g., productive, casual, urgent)"
}

RULES:
- Write the entire response in ${targetLangName}
- Be concise and specific — avoid vague statements
- Only include action items if there are clear tasks or commitments mentioned
- If no action items exist, return an empty array
- Keep key points to 5 or fewer
- Respond ONLY with valid JSON, no markdown or extra text`;

      const summaryUserPrompt = `Summarize this video call transcript:\n\n${transcript}`;
      let raw = "";
      let summaryProvider = "kimi";
      const startTime = Date.now();

      if (apiKeys.moonshot() && getToolStatus(TOOL_NAMES.CALL_SUMMARY).available) {
        const kimiResult = await toolKimiChat(
          [{ role: "system", content: summarySystemPrompt }, { role: "user", content: summaryUserPrompt }],
          { maxTokens: 800, temperature: 0.3, toolName: TOOL_NAMES.CALL_SUMMARY }
        );
        raw = kimiResult.text;
        recordProviderLatency("kimi", Date.now() - startTime, !!raw);
        if (kimiResult.promptTokens) trackTokenUsage("kimi", kimiResult.promptTokens, kimiResult.completionTokens, "call_summary");
      }

      if (!raw && resolvedAnthropicKey && getToolStatus(TOOL_NAMES.CLAUDE_GENERAL).available) {
        summaryProvider = "claude";
        const claudeResult = await toolClaudeChat(
          [{ role: "user", content: `${summarySystemPrompt}\n\n${summaryUserPrompt}` }],
          { maxTokens: 800, toolName: TOOL_NAMES.CLAUDE_GENERAL }
        );
        raw = claudeResult.text;
        recordProviderLatency("claude", Date.now() - startTime, !!raw);
      }

      const elapsed = Date.now() - startTime;

      let parsed;
      try {
        let jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
        const jS = jsonStr.indexOf("{");
        const jE = jsonStr.lastIndexOf("}");
        if (jS >= 0 && jE > jS) jsonStr = jsonStr.slice(jS, jE + 1);
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = {
          summary: raw,
          keyPoints: [],
          actionItems: [],
          duration: "Unknown",
          mood: "neutral",
        };
      }

      res.json({
        ...parsed,
        provider: summaryProvider,
        latencyMs: elapsed,
      });
    } catch (err: any) {
      console.error("Call summary error:", err?.message);
      res.status(500).json({ message: "Failed to generate call summary" });
    }
  });

  router.post("/transcribe", isAuthenticated, upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const audioBuffer = req.file.buffer;
      const mimeType = req.file.mimetype;

      let extension = "webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
        extension = "mp4";
      } else if (mimeType.includes("wav")) {
        extension = "wav";
      } else if (mimeType.includes("ogg")) {
        extension = "ogg";
      }

      const audioFile = await toFile(audioBuffer, `audio.${extension}`, {
        type: mimeType,
      });

      const transcription = await openaiSTTClient.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        response_format: "json",
      });

      res.json({
        text: transcription.text,
        success: true,
      });
    } catch (error) {
      console.error("Transcription error:", error);
      res.status(500).json({
        message: "Transcription failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.post("/video-captions/transcribe", isAuthenticated, async (req, res) => {
    try {
      const { messageId, videoData } = req.body;
      if (!messageId || !videoData) {
        return res.status(400).json({ message: "messageId and videoData are required" });
      }

      if (typeof videoData !== "string" || videoData.length > 35 * 1024 * 1024) {
        return res.status(400).json({ message: "Video data too large for caption processing" });
      }

      const cached = videoCaptionCache.get(messageId);
      if (cached) {
        return res.json(cached);
      }

      const userId = (req as any).user?.claims?.sub;
      let languageHint: string | undefined;
      if (userId) {
        try {
          const prefs = await storage.getPreferences(userId);
          if (prefs?.spokenLanguage && prefs.spokenLanguage !== "auto") {
            languageHint = prefs.spokenLanguage;
          }
        } catch {}
      }

      const audioBuffer = await extractAudioFromVideo(videoData);

      const captionData = await transcribeVideoAudio(audioBuffer, languageHint);
      videoCaptionCache.set(messageId, captionData);

      res.json(captionData);
    } catch (error) {
      console.error("[VideoCaptions] Transcription error:", error);
      res.json({ lang: "en", segments: [], noSpeech: true, error: error instanceof Error ? error.message : "Failed" });
    }
  });

  router.post("/video-captions/translate", isAuthenticated, async (req, res) => {
    try {
      const { messageId, targetLang } = req.body;
      if (!messageId || !targetLang) {
        return res.status(400).json({ message: "messageId and targetLang are required" });
      }

      const cacheKey = `${messageId}:${targetLang}`;
      const cached = translatedCaptionCache.get(cacheKey);
      if (cached) {
        return res.json({ segments: cached });
      }

      const original = videoCaptionCache.get(messageId);
      if (!original || original.segments.length === 0) {
        return res.status(404).json({ message: "No captions found for this message — transcribe first" });
      }

      if (original.lang === targetLang) {
        return res.json({ segments: original.segments });
      }

      const translated = await translateSegments(original.segments, targetLang, original.lang);
      translatedCaptionCache.set(cacheKey, translated);

      res.json({ segments: translated });
    } catch (error) {
      console.error("[VideoCaptions] Translation error:", error);
      res.status(500).json({ message: "Caption translation failed" });
    }
  });

  router.post("/video-captions/burn", isAuthenticated, async (req, res) => {
    try {
      const { videoData, captions } = req.body;
      if (!videoData || !captions || !Array.isArray(captions)) {
        return res.status(400).json({ message: "videoData and captions array are required" });
      }

      if (typeof videoData !== "string" || videoData.length > 35 * 1024 * 1024) {
        return res.status(400).json({ message: "Video data too large" });
      }

      const result = await burnCaptionsIntoVideo(videoData, captions);
      res.json({ videoData: result });
    } catch (error) {
      console.error("[VideoCaptions] Burn error:", error);
      res.status(500).json({ message: "Failed to burn captions into video" });
    }
  });

  return router;
}
