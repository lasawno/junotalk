import { executeTool, TOOL_NAMES } from "./tool-execution-service";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { apiKeys } from "./api-keys";

const resolvedAnthropicKey = apiKeys.anthropic();
const resolvedAnthropicBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;

let anthropicClient: Anthropic | null = null;
if (resolvedAnthropicKey) {
  anthropicClient = new Anthropic({
    apiKey: resolvedAnthropicKey,
    ...(resolvedAnthropicBaseUrl ? { baseURL: resolvedAnthropicBaseUrl } : {}),
  });
}

let moonshotClientInstance: OpenAI | null = null;
const _moonshotKey = apiKeys.moonshot();
if (_moonshotKey) {
  moonshotClientInstance = new OpenAI({
    apiKey: _moonshotKey,
    baseURL: "https://api.moonshot.cn/v1",
  });
}

const geminiApiKey = apiKeys.google();
const genAIClient = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

export interface TranslationResult {
  translatedText: string;
  provider: string;
}

export async function toolLibreTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  url: string,
  apiKey?: string,
  hmacFn?: (payload: string) => string
): Promise<TranslationResult> {
  const result = await executeTool<TranslationResult>(
    TOOL_NAMES.LIBRE_TRANSLATE,
    async () => {
      const body: Record<string, string> = {
        q: text,
        source: sourceLang || "auto",
        target: targetLang,
        format: "text",
      };
      if (apiKey) body.api_key = apiKey;
      const payload = JSON.stringify(body);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (hmacFn) headers["X-Request-Integrity"] = hmacFn(payload);

      const res = await fetch(`${url}/translate`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`LibreTranslate returned ${res.status}`);
      const data = await res.json() as { translatedText: string };
      const translated = data.translatedText?.trim();
      if (!translated) throw new Error("LibreTranslate returned empty");
      return { translatedText: translated, provider: "libre" };
    },
    {
      maxRetries: 2,
      timeoutMs: 8000,
      fallback: () => ({ translatedText: "", provider: "libre-fallback" }),
    }
  );
  return result.data;
}

export async function toolClaudeChat(
  messages: { role: string; content: string }[],
  options: { model?: string; maxTokens?: number; system?: string; toolName?: string } = {}
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const toolName = options.toolName || TOOL_NAMES.CLAUDE_GENERAL;
  const result = await executeTool(
    toolName,
    async () => {
      if (!anthropicClient) throw new Error("Anthropic not configured");
      const model = options.model || "claude-haiku-4-5";
      const maxTokens = options.maxTokens || 200;

      const apiMessages = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      const systemContent = options.system || messages.find(m => m.role === "system")?.content;

      const res = await anthropicClient.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemContent ? { system: systemContent } : {}),
        messages: apiMessages,
      });

      const block = res.content[0];
      const text = block && block.type === "text" ? block.text.trim() : "";
      return {
        text,
        inputTokens: res.usage?.input_tokens || 0,
        outputTokens: res.usage?.output_tokens || 0,
      };
    },
    {
      maxRetries: 2,
      timeoutMs: 10000,
      fallback: () => ({ text: "", inputTokens: 0, outputTokens: 0 }),
    }
  );
  return result.data;
}

export async function toolKimiChat(
  messages: { role: string; content: string }[],
  options: { model?: string; maxTokens?: number; temperature?: number; toolName?: string } = {}
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const toolName = options.toolName || TOOL_NAMES.KIMI_GENERAL;
  const result = await executeTool(
    toolName,
    async () => {
      if (!moonshotClientInstance) throw new Error("Moonshot not configured");
      const res = await moonshotClientInstance.chat.completions.create({
        model: options.model || "moonshot-v1-8k",
        messages: messages as any,
        max_tokens: options.maxTokens || 150,
        temperature: options.temperature ?? 0.3,
      });
      const text = res.choices?.[0]?.message?.content?.trim() || "";
      return {
        text,
        promptTokens: res.usage?.prompt_tokens || 0,
        completionTokens: res.usage?.completion_tokens || 0,
      };
    },
    {
      maxRetries: 2,
      timeoutMs: 10000,
      fallback: () => ({ text: "", promptTokens: 0, completionTokens: 0 }),
    }
  );
  return result.data;
}

export async function toolVisionDetect(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<{ text: string; promptTokens: number; outputTokens: number }> {
  const result = await executeTool(
    TOOL_NAMES.VISION_DETECT,
    async () => {
      if (!genAIClient) throw new Error("Google AI not configured");
      const model = genAIClient.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const res = await model.generateContent([
        { inlineData: { mimeType, data: imageBase64 } },
        prompt,
      ]);
      const text = res.response.text().trim();
      const usage = res.response.usageMetadata;
      return {
        text,
        promptTokens: usage?.promptTokenCount || 0,
        outputTokens: usage?.candidatesTokenCount || 0,
      };
    },
    {
      maxRetries: 2,
      timeoutMs: 10000,
      fallback: () => ({ text: "", promptTokens: 0, outputTokens: 0 }),
    }
  );
  return result.data;
}

export async function toolPiperTTS(
  text: string,
  port?: string,
  modelName?: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const { ensurePiperStarted } = await import("./start-piper");
  ensurePiperStarted();
  const piperPort = port || process.env.PIPER_TTS_PORT || "5097";
  const result = await executeTool(
    TOOL_NAMES.TTS_PIPER,
    async () => {
      const body: Record<string, string> = { text };
      if (modelName) body.model = modelName;
      const res = await fetch(`http://127.0.0.1:${piperPort}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Piper returned ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) throw new Error("Piper returned empty audio");
      return { buffer, contentType: "audio/wav" };
    },
    {
      maxRetries: 1,
      timeoutMs: 35000,
      fallback: () => null,
    }
  );
  return result.data;
}

export async function toolOpenAITTS(
  text: string,
  voice: string,
  speed: number,
  lang?: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const result = await executeTool(
    TOOL_NAMES.TTS_OPENAI,
    async () => {
      const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const openaiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
      if (!openaiKey) throw new Error("OpenAI TTS not configured");

      const langHints: Record<string, string> = {
        es: "[Spanish]", fr: "[French]", de: "[German]", it: "[Italian]",
        pt: "[Portuguese]", nl: "[Dutch]", pl: "[Polish]", cs: "[Czech]",
        ru: "[Russian]", ja: "[Japanese]", zh: "[Chinese]", ko: "[Korean]",
        ar: "[Arabic]", hi: "[Hindi]", tr: "[Turkish]", sv: "[Swedish]",
        da: "[Danish]", fi: "[Finnish]", no: "[Norwegian]", el: "[Greek]",
        he: "[Hebrew]", th: "[Thai]", vi: "[Vietnamese]",
      };
      const hint = lang && lang !== "en" && langHints[lang] ? langHints[lang] + " " : "";

      const ttsClient = new OpenAI({ apiKey: openaiKey, baseURL: openaiBase });
      const mp3 = await ttsClient.audio.speech.create({
        model: "tts-1",
        voice: voice as any,
        input: hint + text,
        speed,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      return { buffer, contentType: "audio/mpeg" };
    },
    {
      maxRetries: 2,
      timeoutMs: 15000,
      fallback: () => ({ buffer: Buffer.alloc(0), contentType: "audio/mpeg" }),
    }
  );
  return result.data;
}

export async function toolSpacyValidate(
  text: string,
  execFileFn: Function
): Promise<{ isValid: boolean; score: number; issues: string[] }> {
  const result = await executeTool(
    TOOL_NAMES.SPACY_VALIDATE,
    async () => {
      return new Promise<{ isValid: boolean; score: number; issues: string[] }>((resolve, reject) => {
        execFileFn("python3", ["server/spacy_validator.py", text], { timeout: 5000 }, (err: any, stdout: string) => {
          if (err) return reject(err);
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ isValid: true, score: 1, issues: [] });
          }
        });
      });
    },
    {
      maxRetries: 1,
      timeoutMs: 8000,
      fallback: () => ({ isValid: true, score: 1, issues: [] }),
    }
  );
  return result.data;
}

export { anthropicClient, moonshotClientInstance, genAIClient, resolvedAnthropicKey };
