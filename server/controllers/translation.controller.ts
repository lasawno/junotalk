import { Router } from "express";
import crypto from "crypto";
import { getToolStatus, TOOL_NAMES } from "../tool-execution-service";
import { apiKeys } from "../api-keys";
import { toolLibreTranslate, toolClaudeChat, toolKimiChat } from "../tools";
import { getCachedTranslationRedis, setCachedTranslationRedis } from "../redis-cache";
import { resolveTranslationDirection } from "../lang-intelligence";
import { kimiMonitor } from "../kimi-agent";

export function createTranslationRouter(deps: {
  isAuthenticated: any;
  storage: any;
  moonshotClient: any;
  anthropic: any;
  resolvedAnthropicKey: string | undefined;
  activeTranslationService: string;
  getActiveTranslationService: () => string;
  trackAction: (action: string, feature: string) => void;
  trackTokenUsage: (provider: string, input: number, output: number, feature: string) => void;
  recordProviderLatency: (provider: any, ms: number, success: boolean) => void;
  recordLatency: (ms: number) => void;
  getCachedTranslation: (text: string, targetLang: string) => Promise<string | null>;
  setCachedTranslation: (text: string, targetLang: string, translated: string) => void;
  sanitizeTranslationInput: (text: string) => string;
  computeRequestHmac: (payload: string) => string;
  getLanguageName: (code: string) => string;
  getTranslationPromptShort: (sourceLang: string, targetLang: string) => string;
  validateSpanishTranslation: (text: string) => Promise<any>;
  detectLanguage: (text: string, targetLang: string) => Promise<string | null>;
  checkTranslationRateLimit: (userId: string) => boolean;
  voiceTranslationCache: any;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  SPANISH_CODES: Set<string>;
}) {
  const router = Router();
  const {
    isAuthenticated, storage, moonshotClient, anthropic, resolvedAnthropicKey,
    getActiveTranslationService, trackTokenUsage, recordProviderLatency, recordLatency,
    getCachedTranslation, setCachedTranslation, sanitizeTranslationInput, computeRequestHmac,
    getLanguageName, getTranslationPromptShort, validateSpanishTranslation,
    detectLanguage, checkTranslationRateLimit, voiceTranslationCache, libreTranslateUrl,
    libreTranslateApiKey, SPANISH_CODES,
  } = deps;

  router.get("/voice-translation-usage", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const count = user.voiceTranslationCount || 0;
      const isPremium = user.premiumVoiceTranslation || false;
      res.json({ count, isPremium, limit: 5, remaining: isPremium ? -1 : Math.max(0, 5 - count) });
    } catch (error: any) {
      console.error("Voice translation usage error:", error);
      res.status(500).json({ message: "Failed to fetch usage" });
    }
  });

  router.post("/voice-translation-increment", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.premiumVoiceTranslation) {
        return res.json({ count: user.voiceTranslationCount || 0, isPremium: true, remaining: -1 });
      }
      const newCount = (user.voiceTranslationCount || 0) + 1;
      await storage.updateUser(userId, { voiceTranslationCount: newCount });
      const remaining = Math.max(0, 5 - newCount);
      res.json({ count: newCount, isPremium: false, remaining, limitReached: newCount >= 5 });
    } catch (error: any) {
      console.error("Voice translation increment error:", error);
      res.status(500).json({ message: "Failed to increment usage" });
    }
  });

  router.post("/voice-translation-unlock", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { accessCode } = req.body;
      if (!accessCode) return res.status(400).json({ message: "Access code required" });
      const ownerCode = process.env.OWNER_ACCESS_CODE || process.env.DEV_PORTAL_ACCESS_CODE;
      if (!ownerCode) return res.status(500).json({ message: "Owner access not configured" });
      if (accessCode !== ownerCode) {
        return res.status(403).json({ message: "Invalid access code" });
      }
      await storage.updateUser(userId, { premiumVoiceTranslation: true });
      res.json({ success: true, isPremium: true });
    } catch (error: any) {
      console.error("Voice translation unlock error:", error);
      res.status(500).json({ message: "Failed to unlock" });
    }
  });

  router.post("/detect-language", isAuthenticated, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string" || text.trim().length < 3) {
        return res.status(400).json({ message: "Text too short for detection" });
      }
      const detected = await detectLanguage(text.trim(), "en");
      res.json({ lang: detected || "unknown" });
    } catch (error) {
      console.error("Language detection error:", error);
      res.status(500).json({ message: "Language detection failed" });
    }
  });

  router.post("/translate", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!checkTranslationRateLimit(userId || "anon")) {
        return res.status(429).json({ message: "Translation rate limit exceeded" });
      }
      const { text, targetLang } = req.body;
      if (!text || !targetLang) {
        return res.status(400).json({ message: "text and targetLang are required" });
      }
      const sanitized = sanitizeTranslationInput(text);
      const cached = await getCachedTranslation(sanitized, targetLang);
      if (cached) {
        return res.json({ translatedText: cached, cached: true });
      }

      const targetLanguageName = getLanguageName(targetLang);
      let translatedText = "";
      const provider = getActiveTranslationService();
      const startTime = Date.now();

      if (getToolStatus(TOOL_NAMES.LIBRE_TRANSLATE).available) {
        const libreResult = await toolLibreTranslate(
          sanitized, "auto", targetLang, libreTranslateUrl,
          libreTranslateApiKey || undefined, computeRequestHmac
        );
        translatedText = libreResult.translatedText;
      }

      if (!translatedText && resolvedAnthropicKey && getToolStatus(TOOL_NAMES.CLAUDE_TRANSLATE).available) {
        const claudeResult = await toolClaudeChat(
          [{ role: "user", content: `Translate this text to ${targetLanguageName}. Output ONLY the translation:\n\n${sanitized}` }],
          { maxTokens: 200, toolName: TOOL_NAMES.CLAUDE_TRANSLATE }
        );
        translatedText = claudeResult.text;
      }

      if (!translatedText && apiKeys.moonshot() && getToolStatus(TOOL_NAMES.KIMI_TRANSLATE).available) {
        const kimiResult = await toolKimiChat(
          [{ role: "user", content: `Translate this text to ${targetLanguageName}. Output ONLY the translation:\n\n${sanitized}` }],
          { maxTokens: 150, temperature: 0.5, toolName: TOOL_NAMES.KIMI_TRANSLATE }
        );
        translatedText = kimiResult.text;
      }

      if (!translatedText) {
        return res.status(500).json({ message: "Translation failed" });
      }

      translatedText = translatedText.replace(/^["']|["']$/g, "").trim();
      if (translatedText && translatedText !== sanitized) {
        setCachedTranslation(sanitized, targetLang, translatedText);
      }

      const latencyMs = Date.now() - startTime;
      recordLatency(latencyMs);

      res.json({ translatedText });
    } catch (error) {
      console.error("Translation error:", error);
      res.status(500).json({ message: "Translation failed" });
    }
  });

  router.post("/translate-batch", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!checkTranslationRateLimit(userId || "anon")) {
        return res.status(429).json({ message: "Translation rate limit exceeded. Please wait before sending more requests." });
      }

      const { texts, targetLang, contextMessages } = req.body as {
        texts: { id: string; text: string }[];
        targetLang: string;
        contextMessages?: string[];
      };

      if (!texts || !Array.isArray(texts) || !targetLang) {
        return res.status(400).json({ message: "texts array and targetLang are required" });
      }

      if (texts.length > 50) {
        return res.status(400).json({ message: "Maximum 50 texts per batch request" });
      }

      const sanitizedTexts = texts.map(item => ({
        id: item.id,
        text: sanitizeTranslationInput(item.text),
      }));

      const results: { id: string; translatedText: string; cached?: boolean }[] = [];
      const toTranslate: { id: string; text: string; index: number }[] = [];

      for (let i = 0; i < sanitizedTexts.length; i++) {
        const item = sanitizedTexts[i];
        const cached = await getCachedTranslation(item.text, targetLang);
        if (cached) {
          results.push({ id: item.id, translatedText: cached, cached: true });
        } else {
          toTranslate.push({ id: item.id, text: item.text, index: i });
        }
      }

      if (toTranslate.length === 0) {
        return res.json({ translations: results });
      }

      const targetLanguageName = getLanguageName(targetLang);
      const sanitizedContext = contextMessages
        ? contextMessages.slice(-5).map(c => sanitizeTranslationInput(c))
        : [];
      const contextBlock = sanitizedContext.length > 0
        ? `\nCONVERSATION CONTEXT (for reference only, do NOT translate these):\n${sanitizedContext.map(c => `> ${c}`).join("\n")}\n`
        : "";

      const numberedTexts = toTranslate.map((t, i) => `[${i}] ${t.text}`).join("\n");
      const prompt = `You are a precise translator. Translate each numbered line into ${targetLanguageName}.
${contextBlock}
RULES:
- Output ONLY the translated lines in ${targetLanguageName}
- Keep the [number] prefix exactly as-is
- One translated line per input line
- Do NOT include the original text
- Translate accurately - do NOT paraphrase or alter meaning
- No quotes, explanations, labels, or commentary
- If a line is ALREADY in ${targetLanguageName}, return it EXACTLY as-is
- Preserve tone, slang, abbreviations, and informal style
- Use the conversation context to better understand pronouns, references, and tone
- Never use em dashes (—) or en dashes (–) in output; use commas or colons instead

Lines to translate:
${numberedTexts}`;

      let translatedText = numberedTexts;
      let provider: string = getActiveTranslationService();
      const startTime = Date.now();
      let libreHandled = false;

      if (provider === "libretranslate") {
        try {
          const libreResults = await Promise.all(
            toTranslate.map(async (item) => {
              const sanitized = sanitizeTranslationInput(item.text);
              const body: Record<string, string> = {
                q: sanitized,
                source: "auto",
                target: targetLang,
                format: "text",
              };
              if (libreTranslateApiKey) body.api_key = libreTranslateApiKey;
              const payload = JSON.stringify(body);
              const hmac = computeRequestHmac(payload);
              const resp = await fetch(`${libreTranslateUrl}/translate`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Request-Integrity": hmac,
                },
                body: payload,
                signal: AbortSignal.timeout(5000),
              });
              if (!resp.ok) throw new Error(`LibreTranslate batch item failed: ${resp.status}`);
              const data = await resp.json() as { translatedText: string };
              return { id: item.id, text: item.text, translated: data.translatedText || item.text };
            })
          );
          for (const r of libreResults) {
            const clean = r.translated.replace(/^["'""]|["'""]$/g, '').trim();
            if (clean && clean !== r.text) {
              setCachedTranslation(r.text, targetLang, clean);
            }
            results.push({ id: r.id, translatedText: clean || r.text });
          }
          libreHandled = true;
        } catch (e: any) {
          console.error("LibreTranslate batch error, falling back:", e?.message);
          provider = apiKeys.moonshot() ? "kimi" : "claude";
        }
      }

      if (!libreHandled && provider === "kimi" && apiKeys.moonshot()) {
        try {
          const completion = await moonshotClient.chat.completions.create({
            model: "moonshot-v1-8k",
            messages: [
              { role: "system", content: prompt },
              { role: "user", content: numberedTexts },
            ],
            max_tokens: 1000,
            temperature: 0.1,
          });
          translatedText = completion.choices[0]?.message?.content || numberedTexts;
        } catch (e: any) {
          console.error("Batch translate Kimi error, falling back to Claude:", e?.message);
          provider = "claude";
        }
      }

      if (!libreHandled && provider === "claude" && resolvedAnthropicKey) {
        try {
          const claudeBatchPromise = anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 1000,
            messages: [{ role: "user", content: `${prompt}\n\n${numberedTexts}` }],
          });
          const claudeBatchTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Claude batch translation timeout")), 10000));
          const claudeRes = await Promise.race([claudeBatchPromise, claudeBatchTimeout]);
          const block = claudeRes.content[0];
          if (block && block.type === "text") {
            translatedText = block.text.trim();
          }
        } catch (e: any) {
          console.error("Batch translate Claude error:", e?.message);
          recordProviderLatency("claude", Date.now() - startTime, false);
        }
      }

      if (!libreHandled) {
        const lines = translatedText.split("\n").filter(l => l.trim());
        const lineMap = new Map<number, string>();
        for (const line of lines) {
          const m = line.match(/^\[(\d+)\]\s*(.+)$/);
          if (m) lineMap.set(parseInt(m[1]), m[2].trim());
        }

        for (let i = 0; i < toTranslate.length; i++) {
          const item = toTranslate[i];
          const raw = lineMap.get(i) || item.text;
          const cleanTranslated = raw.replace(/^["'""]|["'""]$/g, '').trim();

          if (cleanTranslated && cleanTranslated !== item.text) {
            setCachedTranslation(item.text, targetLang, cleanTranslated);
          }
          results.push({ id: item.id, translatedText: cleanTranslated || item.text });
        }
      }

      if (SPANISH_CODES.has(targetLang.toLowerCase()) && results.length > 0) {
        try {
          const validationPromises = results.map(async (r) => {
            if (!r.translatedText || r.translatedText.length < 3) return r;
            const v = await validateSpanishTranslation(r.translatedText);
            if (!v.natural && v.suggestions.length > 0) {
              try {
                if (moonshotClient) {
                  const fixPromise = moonshotClient.chat.completions.create({
                    model: "moonshot-v1-8k",
                    messages: [
                      { role: "system", content: "You are a native Spanish speaker fixing a translation. Apply the corrections and output ONLY the corrected text." },
                      { role: "user", content: `Fix this Spanish: "${r.translatedText}"\nIssues: ${v.suggestions.join("; ")}` },
                    ],
                    max_tokens: 150,
                    temperature: 0.1,
                  });
                  const fixTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Fix timeout")), 6000));
                  const fixResult = await Promise.race([fixPromise, fixTimeout]);
                  const fixed = fixResult.choices[0]?.message?.content?.replace(/^["'""]|["'""]$/g, '').trim();
                  if (fixed) r.translatedText = fixed;
                }
              } catch {}
            }
            return r;
          });
          const validated = await Promise.all(validationPromises);
          results.length = 0;
          results.push(...validated);
        } catch {}
      }

      const latencyMs = Date.now() - startTime;
      recordLatency(latencyMs);
      recordProviderLatency(provider as any, latencyMs, true);

      res.json({ translations: results });
    } catch (error: any) {
      console.error("Batch translation error:", error);
      const fallback = (req.body.texts || []).map((t: any) => ({ id: t.id, translatedText: t.text }));
      res.json({ translations: fallback, error: "Translation failed" });
    }
  });

  router.get("/user-lang/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const targetUserId = req.params.userId;
      const prefs = await storage.getPreferences(targetUserId);
      const lang = prefs?.subtitleLanguage || "en";
      res.json({ lang });
    } catch (error) {
      console.error("Error fetching user language:", error);
      res.json({ lang: "en" });
    }
  });

  router.post("/ai-translate", isAuthenticated, async (req, res) => {
    try {
      const { text, sourceLang, targetLang, nativeLang, conversationHistory = [] } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ message: "Text is required" });
      }

      const { srcLang, tgtLang } = await resolveTranslationDirection(
        text.trim(),
        nativeLang || sourceLang || "en",
        sourceLang || "auto",
        targetLang || "en"
      );

      const voiceCacheKey = crypto.createHash("sha256").update(`${srcLang}:${tgtLang}:${text.trim().toLowerCase()}`).digest("hex");

      const redisCached = await getCachedTranslationRedis("voice", srcLang, tgtLang, voiceCacheKey);
      if (redisCached) {
        return res.json({ translatedText: redisCached, mode: "cache" });
      }

      const cachedVoice = voiceTranslationCache.get(voiceCacheKey);
      if (cachedVoice) {
        return res.json({ translatedText: cachedVoice.text, mode: "cache" });
      }

      const langNames: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
        pt: "Portuguese", nl: "Dutch", pl: "Polish", cs: "Czech", ru: "Russian",
        ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", hi: "Hindi",
        tr: "Turkish", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
        el: "Greek", he: "Hebrew", th: "Thai", vi: "Vietnamese",
      };
      const srcName = langNames[srcLang] || srcLang;
      const tgtName = langNames[tgtLang] || tgtLang;

      const systemPrompt = `You are a world-class interpreter — the kind who works at the United Nations, high-level diplomatic meetings, and international conferences. You have native-level mastery of both ${srcName} and ${tgtName}, with deep knowledge of regional dialects, street slang, professional jargon, humor, and cultural subtleties.

You are interpreting live speech from ${srcName} to ${tgtName}. This is spoken language, not written text.

How you think:
- First, fully grasp what the speaker MEANS — their intent, emotion, subtext, and cultural references.
- Then express that meaning the way a native ${tgtName} speaker would naturally say it in conversation. Not how a textbook would write it.
- Spoken language is messy. People repeat themselves, trail off, use filler words. Clean it up naturally without losing meaning.
- Slang stays slang. "What's up" in English becomes the local equivalent, not a literal translation.
- Humor translates as humor. Sarcasm translates as sarcasm. Anger translates as anger.
- Cultural references adapt. If someone mentions something culture-specific, find the closest natural equivalent or keep it with enough context baked in.
- Numbers, names, and technical terms stay accurate.

Output rules:
- ${tgtName} ONLY. Never mix languages. Never add notes, brackets, or explanations.
- One clean translation. No alternatives, no options, no "or you could say..."
- Match the register: street talk stays street, formal stays formal, romantic stays romantic.
- Keep it concise. Spoken translations should be speakable — not essay-length.`;

      const messages: { role: string; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
      for (const msg of recentHistory) {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
        }
      }

      messages.push({ role: "user", content: text.trim() });

      let translatedText = "";

      const voiceStart = Date.now();

      if (getToolStatus(TOOL_NAMES.LIBRE_TRANSLATE).available) {
        const libreResult = await toolLibreTranslate(
          text.trim(), srcLang, tgtLang, libreTranslateUrl,
          libreTranslateApiKey || undefined, computeRequestHmac
        );
        translatedText = libreResult.translatedText;
        if (!translatedText) recordProviderLatency("libretranslate", Date.now() - voiceStart, false);
      }

      if (!translatedText && resolvedAnthropicKey && getToolStatus(TOOL_NAMES.CLAUDE_TRANSLATE).available) {
        const claudeResult = await toolClaudeChat(messages, {
          model: "claude-haiku-4-5", maxTokens: 200, system: messages[0].content,
          toolName: TOOL_NAMES.CLAUDE_TRANSLATE,
        });
        translatedText = claudeResult.text;
        if (claudeResult.inputTokens) trackTokenUsage("claude", claudeResult.inputTokens, claudeResult.outputTokens, "voice_translation_claude_fallback");
        if (!translatedText) recordProviderLatency("claude", Date.now() - voiceStart, false);
      }

      if (!translatedText && apiKeys.moonshot() && getToolStatus(TOOL_NAMES.KIMI_TRANSLATE).available) {
        const kimiResult = await toolKimiChat(messages, {
          maxTokens: 150, temperature: 0.5,
          toolName: TOOL_NAMES.KIMI_TRANSLATE,
        });
        translatedText = kimiResult.text;
        if (kimiResult.promptTokens) trackTokenUsage("kimi", kimiResult.promptTokens, kimiResult.completionTokens, "voice_translation_kimi");
        if (!translatedText) recordProviderLatency("kimi", Date.now() - voiceStart, false);
      }

      if (!translatedText) {
        return res.status(500).json({ message: "AI translation failed" });
      }

      translatedText = translatedText.replace(/^["']|["']$/g, "").trim();

      const monitorPromise = kimiMonitor(text.trim(), translatedText, srcName, tgtName);
      const monitorTimeout = new Promise<{ finalTranslation: string; wasAdjusted: boolean }>((resolve) =>
        setTimeout(() => resolve({ finalTranslation: translatedText, wasAdjusted: false }), 1500)
      );
      const monitorResult = await Promise.race([monitorPromise, monitorTimeout]);
      translatedText = monitorResult.finalTranslation;
      trackTokenUsage("kimi", Math.ceil(text.trim().length / 4) + 200, 80, "translation_qa");

      voiceTranslationCache.set(voiceCacheKey, { text: translatedText, ts: Date.now() });
      setCachedTranslationRedis("voice", srcLang, tgtLang, voiceCacheKey, translatedText, 600).catch(() => {});

      res.json({ translatedText, mode: "ai" });
    } catch (error) {
      console.error("AI translate error:", error);
      res.status(500).json({ message: "AI translation failed" });
    }
  });

  router.get("/translation-service", isAuthenticated, (req, res) => {
    res.json({ service: getActiveTranslationService() });
  });

  router.post("/translation-service", isAuthenticated, async (req, res) => {
    const { service } = req.body;
    const validServices = ["openai", "kimi", "gemini", "libretranslate", "claude"];
    if (!service || !validServices.includes(service)) {
      return res.status(400).json({ message: "Invalid translation service" });
    }
    res.json({ service, message: `Translation service preference updated to ${service}` });
  });

  return router;
}
