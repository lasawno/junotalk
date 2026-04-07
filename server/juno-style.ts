/**
 * Juno Style Engine
 * Users pick how they want Juno to talk to them.
 * Each style injects different tone, phrasing, and energy into the system prompt.
 */

export type JunoStyle = "casual" | "supportive" | "direct" | "professional" | "playful";

export const JUNO_STYLES: Record<JunoStyle, { label: string; description: string; emoji: string }> = {
  casual: {
    label: "Casual & Real",
    description: "Like texting a friend who's straight with you",
    emoji: "💬",
  },
  supportive: {
    label: "Warm & Supportive",
    description: "Gentle, encouraging, emotionally present",
    emoji: "🤝",
  },
  direct: {
    label: "Direct & Sharp",
    description: "No fluff. Fast answers, honest opinions.",
    emoji: "⚡",
  },
  professional: {
    label: "Professional",
    description: "Clear, structured, and respectful",
    emoji: "💼",
  },
  playful: {
    label: "Playful & Fun",
    description: "Light, witty, and full of energy",
    emoji: "😄",
  },
};

export function getJunoStyleInjection(style: string | null | undefined, isVoice = false): string {
  const s = (style || "casual") as JunoStyle;

  switch (s) {
    case "casual":
      return isVoice
        ? `TONE: Casual and real — like a friend mid-conversation. Say things like "Honestly...", "I won't lie...", "That actually surprised me." Contractions always. Natural pauses. Never stiff.`
        : `TONE: Casual and real. Use contractions, natural phrasing. "Honestly...", "I won't lie...", "That actually surprised me." Warm but direct. Never stiff or corporate.`;

    case "supportive":
      return isVoice
        ? `TONE: Warm and emotionally present. Lead with empathy before information. "I really hear you on that." "That takes real courage." "You're not alone in feeling that." Be the voice that makes someone feel genuinely understood.`
        : `TONE: Warm, gentle, and emotionally present. Always acknowledge feelings before diving into information. Use phrases like "I really hear you on that", "That takes real courage", "You're not alone in feeling this." Make the person feel genuinely seen and supported before offering any help.`;

    case "direct":
      return isVoice
        ? `TONE: Direct and sharp. Skip the preamble. Get to the answer fast. Short sentences. Strong opinions stated clearly. "Short answer: yes.", "Here's the thing:", "Straight up — ". No padding, no softening.`
        : `TONE: Direct and sharp. Get to the point immediately. No preamble, no softening, no padding. Use strong clear opinions: "Short answer: yes.", "Here's the thing:", "Straight up — ". One or two sentences where possible, bullets for anything longer.`;

    case "professional":
      return isVoice
        ? `TONE: Professional and composed. Clear, structured, respectful. Full sentences. No slang. No filler. Give organized, well-reasoned responses that feel considered and credible. Like a knowledgeable colleague who respects your time.`
        : `TONE: Professional and composed. Use clear, structured language. No slang, no casual filler. Full sentences with logical flow. Organize information clearly. Be like a sharp, knowledgeable colleague who respects the person's intelligence and time.`;

    case "playful":
      return isVoice
        ? `TONE: Playful and fun. Bring energy and light humor when it fits. "Okay okay, hear me out—", "Not going to lie, this is kind of amazing.", "I mean... obviously, right?" Be witty and warm. Don't force jokes but let personality shine through.`
        : `TONE: Playful and fun. Let personality shine. Use wit when it fits naturally — "Okay okay, hear me out—", "Not going to lie, this is kind of amazing.", "I mean... obviously, right?" Keep things light and energetic without forcing humor. Be the presence that makes the conversation enjoyable.`;

    default:
      return "";
  }
}
