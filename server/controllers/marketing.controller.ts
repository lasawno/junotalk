import { Router } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { apiKeys } from "../api-keys";

const CONTENT_TYPES = [
  "social_post",
  "ad_copy",
  "email_campaign",
  "blog_post",
  "app_store",
  "press_release",
  "seo_meta",
  "push_notification",
  "landing_copy",
  "sms_blast",
] as const;

type ContentType = (typeof CONTENT_TYPES)[number];

interface MarketingRequest {
  type: ContentType;
  topic?: string;
  tone?: string;
  targetAudience?: string;
  language?: string;
  platform?: string;
  keywords?: string[];
  maxLength?: number;
  variants?: number;
}

function validateMarketingRequest(body: any): { valid: true; data: MarketingRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") return { valid: false, error: "Request body is required" };
  if (!body.type || typeof body.type !== "string" || !CONTENT_TYPES.includes(body.type)) {
    return { valid: false, error: "Invalid content type" };
  }
  if (body.topic !== undefined && (typeof body.topic !== "string" || body.topic.length > 500)) {
    return { valid: false, error: "topic must be a string under 500 characters" };
  }
  if (body.tone !== undefined && (typeof body.tone !== "string" || body.tone.length > 100)) {
    return { valid: false, error: "tone must be a string under 100 characters" };
  }
  if (body.targetAudience !== undefined && (typeof body.targetAudience !== "string" || body.targetAudience.length > 300)) {
    return { valid: false, error: "targetAudience must be a string under 300 characters" };
  }
  if (body.language !== undefined && (typeof body.language !== "string" || body.language.length > 50)) {
    return { valid: false, error: "language must be a string under 50 characters" };
  }
  if (body.platform !== undefined && (typeof body.platform !== "string" || body.platform.length > 50)) {
    return { valid: false, error: "platform must be a string under 50 characters" };
  }
  if (body.keywords !== undefined) {
    if (!Array.isArray(body.keywords) || body.keywords.length > 20 || !body.keywords.every((k: any) => typeof k === "string" && k.length <= 100)) {
      return { valid: false, error: "keywords must be an array of up to 20 strings (each under 100 chars)" };
    }
  }
  if (body.maxLength !== undefined && (typeof body.maxLength !== "number" || body.maxLength < 10 || body.maxLength > 10000)) {
    return { valid: false, error: "maxLength must be a number between 10 and 10000" };
  }
  if (body.variants !== undefined && (typeof body.variants !== "number" || body.variants < 1 || body.variants > 10 || !Number.isInteger(body.variants))) {
    return { valid: false, error: "variants must be an integer between 1 and 10" };
  }
  return { valid: true, data: body as MarketingRequest };
}

const SYSTEM_PROMPT = `You are the JunoTalk Marketing Agent, an expert digital marketer for JunoTalk, a mobile-first encrypted communication platform. 

About JunoTalk:
- AI-powered voice translation supporting 40+ languages
- End-to-end encrypted text messaging
- HD video and voice calls with live translated captions
- Travel eSIM for instant mobile data worldwide
- No phone number or social media required, just a 6-digit code
- Free to use
- Privacy-first: AES-256 encryption, no recordings, auto-delete data

Your job is to generate compelling, professional marketing content. Always highlight the unique value propositions. Never use dashes (em dash or en dash). Use colons or commas instead. Never make up statistics or claim specific user counts unless told to. Say "thousands of users" or "users worldwide" instead.

When generating content, follow these rules:
- Be concise and impactful
- Use active voice
- Include clear calls to action
- Adapt tone to the specified audience
- For social posts, include relevant hashtags
- For SEO content, naturally incorporate keywords
- Never use placeholder text or lorem ipsum
- Output only the final content, no explanations unless asked`;

const TYPE_INSTRUCTIONS: Record<ContentType, string> = {
  social_post: "Generate a social media post. Include relevant hashtags. Keep it engaging and shareable. If platform is specified, optimize for that platform's format and character limits.",
  ad_copy: "Generate advertising copy. Include a headline, body text, and call to action. Make it compelling and conversion-focused.",
  email_campaign: "Generate an email with subject line, preview text, body, and CTA button text. Make it personal and engaging.",
  blog_post: "Generate a blog post with title, meta description, introduction, body sections with subheadings, and conclusion. SEO-optimized.",
  app_store: "Generate app store listing content: title (30 chars), subtitle (30 chars), description (up to 4000 chars), and 3 keyword phrases. Optimize for App Store and Google Play.",
  press_release: "Generate a professional press release with headline, dateline, lead paragraph, body, boilerplate, and contact section.",
  seo_meta: "Generate SEO metadata: page title (60 chars), meta description (160 chars), 10 target keywords, and Open Graph text.",
  push_notification: "Generate 5 push notification variants. Each should have a title (50 chars max) and body (100 chars max). Make them urgent and actionable.",
  landing_copy: "Generate landing page copy: hero headline, subheadline, 3 feature blocks with titles and descriptions, social proof section, and CTA.",
  sms_blast: "Generate 5 SMS marketing message variants. Each must be under 160 characters. Include a short CTA.",
};

async function generateWithKimi(prompt: string): Promise<string | null> {
  const apiKey = apiKeys.moonshot();
  if (!apiKey) return null;
  try {
    const client = new OpenAI({ apiKey, baseURL: "https://api.moonshot.cn/v1" });
    const res = await client.chat.completions.create({
      model: "moonshot-v1-8k",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    });
    return res.choices[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function generateWithClaude(prompt: string): Promise<string | null> {
  const apiKey = apiKeys.anthropic();
  if (!apiKey) return null;
  try {
    const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    const res = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content[0];
    return block.type === "text" ? block.text : null;
  } catch {
    return null;
  }
}

async function generateContent(prompt: string): Promise<{ content: string; provider: string }> {
  let result = await generateWithKimi(prompt);
  if (result) return { content: result, provider: "kimi" };

  result = await generateWithClaude(prompt);
  if (result) return { content: result, provider: "claude" };

  throw new Error("All AI providers failed");
}

function buildPrompt(req: MarketingRequest): string {
  const instructions = TYPE_INSTRUCTIONS[req.type];
  let prompt = `${instructions}\n\n`;

  if (req.topic) prompt += `Topic/Focus: ${req.topic}\n`;
  if (req.tone) prompt += `Tone: ${req.tone}\n`;
  if (req.targetAudience) prompt += `Target Audience: ${req.targetAudience}\n`;
  if (req.language && req.language !== "en") prompt += `Language: Write in ${req.language}\n`;
  if (req.platform) prompt += `Platform: ${req.platform}\n`;
  if (req.keywords?.length) prompt += `Keywords to include: ${req.keywords.join(", ")}\n`;
  if (req.maxLength) prompt += `Maximum length: ${req.maxLength} characters\n`;
  if (req.variants && req.variants > 1) prompt += `Generate ${req.variants} distinct variants, clearly separated.\n`;

  return prompt;
}

const generationHistory: Array<{
  id: string;
  type: ContentType;
  prompt: string;
  content: string;
  provider: string;
  timestamp: string;
  metadata: Partial<MarketingRequest>;
}> = [];

export function createMarketingRouter(deps: {
  isAuthenticated: any;
  isAdminRequest: (req: any) => boolean;
}) {
  const router = Router();
  const { isAuthenticated, isAdminRequest } = deps;

  const adminGuard = (req: any, res: any, next: any) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    next();
  };

  router.get("/marketing/types", isAuthenticated, adminGuard, (_req: any, res) => {
    res.json({
      types: CONTENT_TYPES.map((t) => ({
        id: t,
        label: t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    });
  });

  router.post("/marketing/generate", isAuthenticated, adminGuard, async (req: any, res) => {
    const validation = validateMarketingRequest(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    try {
      const prompt = buildPrompt(validation.data);
      const { content, provider } = await generateContent(prompt);

      const entry = {
        id: `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: validation.data.type,
        prompt,
        content,
        provider,
        timestamp: new Date().toISOString(),
        metadata: {
          topic: validation.data.topic,
          tone: validation.data.tone,
          targetAudience: validation.data.targetAudience,
          language: validation.data.language,
          platform: validation.data.platform,
        },
      };

      generationHistory.unshift(entry);
      if (generationHistory.length > 100) generationHistory.length = 100;

      res.json({
        id: entry.id,
        type: validation.data.type,
        content,
        provider,
        timestamp: entry.timestamp,
      });
    } catch {
      res.status(500).json({ error: "Content generation failed" });
    }
  });

  router.post("/marketing/refine", isAuthenticated, adminGuard, async (req: any, res) => {
    const { content, instructions } = req.body;
    if (!content || typeof content !== "string" || content.length > 10000) {
      return res.status(400).json({ error: "content is required (string, max 10000 chars)" });
    }
    if (!instructions || typeof instructions !== "string" || instructions.length > 1000) {
      return res.status(400).json({ error: "instructions is required (string, max 1000 chars)" });
    }

    try {
      const prompt = `Here is existing marketing content:\n\n${content}\n\nRefine it with these instructions: ${instructions}\n\nOutput only the refined content.`;
      const { content: refined, provider } = await generateContent(prompt);
      res.json({ content: refined, provider });
    } catch {
      res.status(500).json({ error: "Refinement failed" });
    }
  });

  router.post("/marketing/translate", isAuthenticated, adminGuard, async (req: any, res) => {
    const { content, targetLanguage } = req.body;
    if (!content || typeof content !== "string" || content.length > 10000) {
      return res.status(400).json({ error: "content is required (string, max 10000 chars)" });
    }
    if (!targetLanguage || typeof targetLanguage !== "string" || targetLanguage.length > 50) {
      return res.status(400).json({ error: "targetLanguage is required (string, max 50 chars)" });
    }

    try {
      const prompt = `Translate the following marketing content to ${targetLanguage}. Maintain the same tone, formatting, and marketing impact. Adapt cultural references as needed. Do not translate brand names (JunoTalk, Juno).\n\n${content}`;
      const { content: translated, provider } = await generateContent(prompt);
      res.json({ content: translated, provider, language: targetLanguage });
    } catch {
      res.status(500).json({ error: "Translation failed" });
    }
  });

  router.get("/marketing/history", isAuthenticated, adminGuard, async (req: any, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20") || 20, 1), 100);
    const type = req.query.type as ContentType | undefined;
    let items = generationHistory;
    if (type && CONTENT_TYPES.includes(type)) {
      items = items.filter((i) => i.type === type);
    }
    res.json({ items: items.slice(0, limit), total: items.length });
  });

  router.post("/marketing/bulk", isAuthenticated, adminGuard, async (req: any, res) => {
    const { requests } = req.body;
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) {
      return res.status(400).json({ error: "Provide 1 to 5 generation requests" });
    }

    const results = [];
    for (const r of requests) {
      const validation = validateMarketingRequest(r);
      if (!validation.valid) {
        results.push({ type: r?.type, error: validation.error });
        continue;
      }
      try {
        const prompt = buildPrompt(validation.data);
        const { content, provider } = await generateContent(prompt);
        results.push({ type: validation.data.type, content, provider });
      } catch {
        results.push({ type: validation.data.type, error: "Generation failed" });
      }
    }

    res.json({ results });
  });

  return router;
}
