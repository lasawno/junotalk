/**
 * JunoTalk Offline Text Responder
 *
 * Handles basic prompts locally when all external AI providers are unreachable.
 * Zero network calls — pure template matching. Covers greetings, JunoTalk help,
 * and common conversational intents so users always get a useful reply.
 */

interface OfflineMatch {
  patterns: RegExp[];
  responses: string[];
}

const OFFLINE_RULES: OfflineMatch[] = [
  {
    patterns: [
      /^(hi|hello|hey|howdy|hiya|greetings|good\s*(morning|afternoon|evening|day))[!?.]*$/i,
      /^(sup|what'?s\s*up|yo)[!?.]*$/i,
    ],
    responses: [
      "Hi there! I'm Juno. It looks like I'm running in offline mode right now, but I'm here for basic questions.",
      "Hello! I'm in limited mode at the moment, but happy to help with what I can.",
      "Hey! Running offline right now, but I can still help with basic JunoTalk questions.",
    ],
  },
  {
    patterns: [
      /how\s*(do\s*i|to|can\s*i).*(translat|speak|voice|language)/i,
      /translat.*(work|use|how)/i,
      /(voice|speak)\s*(translat|mode)/i,
    ],
    responses: [
      "To use voice translation: tap the mic button in a chat, speak your message, and Juno will translate and play it back in the target language. You can change your target language in Settings > Languages.",
      "Voice translation is easy — just tap the microphone, speak naturally, and Juno handles the rest. Set your language pair in Settings first.",
    ],
  },
  {
    patterns: [
      /hey\s*juno.*(work|how|use|not\s*work|respond)/i,
      /(wake\s*word|hands.?free).*(work|how|use)/i,
    ],
    responses: [
      'To use "Hey Juno": enable the wake word in Settings > Appearance, make sure microphone access is allowed, then just say "Hey Juno" followed by your request.',
    ],
  },
  {
    patterns: [
      /mic(rophone)?.*(not\s*work|broken|issue|problem|can'?t\s*hear)/i,
      /can'?t\s*hear.*(mic|speak|voice)/i,
      /(audio|sound).*(not\s*work|issue|problem)/i,
    ],
    responses: [
      "Microphone issues are usually a browser permissions problem. Check that your browser has mic access allowed for this site, then refresh the page and try again.",
      "If the mic isn't working: check browser permissions (look for a mic icon in the address bar), make sure no other app is using it, then refresh.",
    ],
  },
  {
    patterns: [
      /video\s*(call|chat).*(how|use|start)/i,
      /how.*(start|make|do)\s*a?\s*video\s*(call|chat)/i,
      /(jitsi|call).*(how|work|use)/i,
    ],
    responses: [
      "To start a video call: open a chat room, tap the video camera icon at the top. JunoTalk uses secure video calling with real-time translated captions.",
    ],
  },
  {
    patterns: [
      /sign.*(in|up).*(how|issue|problem|not\s*work)/i,
      /can'?t\s*sign\s*(in|up)/i,
      /log.*(in|out).*(how|issue)/i,
    ],
    responses: [
      "To sign in: tap the Sign In button and connect your account. If you're having trouble, make sure cookies are enabled and try refreshing the page.",
    ],
  },
  {
    patterns: [
      /privacy|encrypt|secure|data|store/i,
    ],
    responses: [
      "JunoTalk is built with privacy first. Messages are end-to-end encrypted, no audio or video is stored, and you can delete your data anytime from Settings.",
    ],
  },
  {
    patterns: [
      /setting(s)?|how.*(change|set|configure)/i,
    ],
    responses: [
      "You can find all settings by tapping the gear icon or your profile. From there you can change languages, voices, appearance, and privacy options.",
    ],
  },
  {
    patterns: [
      /thank(s| you)|ty|cheers|appreciate/i,
    ],
    responses: [
      "You're welcome! Let me know if there's anything else I can help with.",
      "Happy to help! Anything else?",
      "Of course! Feel free to ask anytime.",
    ],
  },
  {
    patterns: [
      /bye|goodbye|see\s*ya|take\s*care|later/i,
    ],
    responses: [
      "Take care! Come back anytime.",
      "Goodbye! Hope to chat again soon.",
    ],
  },
  {
    patterns: [
      /what\s*(is|are|can)\s*(juno|junotalk)/i,
      /tell\s*me\s*about\s*(juno|junotalk)/i,
    ],
    responses: [
      "JunoTalk is an encrypted real-time communication platform. It features AI voice translation so you can chat and call across language barriers — I'm Juno, your built-in AI companion.",
    ],
  },
  {
    patterns: [
      /are\s*you\s*(online|working|ok|there|alive)/i,
      /you\s*(work|working|online|available)/i,
    ],
    responses: [
      "I'm here, though running in offline mode right now — which means I can handle basic questions but not complex ones. Try again shortly for full AI responses.",
    ],
  },
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Try to match a basic prompt offline.
 * Returns a response string if matched, or null if the message is too complex.
 */
export function offlineRespond(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 300) return null;

  for (const rule of OFFLINE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return pickRandom(rule.responses);
      }
    }
  }

  return null;
}

/**
 * Generic offline fallback when no pattern matched.
 * Always returns something useful.
 */
export function offlineFallback(): string {
  return "I'm having trouble reaching my AI services right now. For basic questions about JunoTalk, feel free to ask — I can help with those offline. For anything more complex, please try again in a moment.";
}
