import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fetchPrivateFile } from "./github-config";

const RECALL_DIR = path.resolve(process.cwd(), "vault/recall");

let userBehaviorContext: string = "";

async function loadUserBehaviorRecall(): Promise<void> {
  try {
    const filePath = path.join(RECALL_DIR, "user-behavior.md");
    const raw = await readFile(filePath, "utf-8");

    const lines = raw.split("\n");
    const sections: string[] = [];
    let current: string[] = [];
    let inBehaviorSection = false;

    for (const line of lines) {
      if (line.startsWith("## 7.") || line.startsWith("## 8.")) {
        inBehaviorSection = true;
        current.push(line);
      } else if (inBehaviorSection && line.startsWith("## ") && !line.startsWith("## 7.") && !line.startsWith("## 8.")) {
        break;
      } else if (inBehaviorSection) {
        current.push(line);
      }

      if (line.startsWith("## ") && (line.includes("Consent") || line.includes("Call Behavior") || line.includes("Privacy") || line.includes("Browser"))) {
        sections.push(line.trim());
      }
    }

    const guidelines = current.filter(l => l.startsWith("- ")).map(l => l.replace(/^- /, "").trim());

    userBehaviorContext = [
      "[User Behavior Recall Loaded]",
      "Consent: all users completing onboarding have agreed to calls, messages, and AI-powered translation.",
      "iOS note: iOS Safari re-requests camera/mic permissions every session — this is expected, not a bug.",
      "Call failures on corporate WiFi: usually TURN routing needed, ask 'WiFi or mobile data?' first.",
      ...guidelines.slice(0, 8),
    ].join(" | ");

    console.log(`[AgentRecall] User behavior recall loaded (${guidelines.length} guidelines)`);
  } catch {
    userBehaviorContext = "[User Behavior Recall] Consent model: onboarding completion = full consent. iOS camera/mic: re-prompted per session by OS design.";
  }
}

export function getUserBehaviorContext(): string {
  return userBehaviorContext;
}

export interface RecallEntry {
  text: string;
  lang: string;
  category: string;
  tags: string[];
  context?: string;
  confidence: number;
  source: string;
}

export interface RecallPattern {
  pattern: string;
  intent: string;
  responseHint: string;
  lang: string;
  examples: string[];
}

export interface CulturalNote {
  region: string;
  langs: string[];
  topic: string;
  note: string;
  tags: string[];
}

interface RecallModule {
  name: string;
  entries: RecallEntry[];
  patterns: RecallPattern[];
  culturalNotes: CulturalNote[];
  lastLoaded: number;
}

const REFRESH_TTL = 60 * 60 * 1000;

const modules: Map<string, RecallModule> = new Map();

let initialized = false;
let initPromise: Promise<void> | null = null;

const INTENT_PATTERNS: RecallPattern[] = [
  { pattern: "(?:where|how).*(?:get|go|find|reach)", intent: "navigation", responseHint: "Provide directional context with local terminology", lang: "en", examples: ["Where can I find a taxi?", "How do I get to the airport?"] },
  { pattern: "(?:help|emergency|urgent|danger|police|ambulance|hospital)", intent: "emergency", responseHint: "Respond urgently with relevant emergency phrases", lang: "en", examples: ["I need help!", "Call an ambulance", "Where is the nearest hospital?"] },
  { pattern: "(?:how much|price|cost|pay|money|exchange|currency|bill|tip)", intent: "transaction", responseHint: "Include local currency context and transaction phrases", lang: "en", examples: ["How much does this cost?", "Can I pay with credit card?"] },
  { pattern: "(?:hello|hi|hey|good morning|good evening|greetings)", intent: "greeting", responseHint: "Mirror cultural greeting conventions for the target language", lang: "en", examples: ["Hello", "Good morning", "Nice to meet you"] },
  { pattern: "(?:thank|thanks|grateful|appreciate)", intent: "gratitude", responseHint: "Use culturally appropriate gratitude expressions", lang: "en", examples: ["Thank you so much", "I really appreciate it"] },
  { pattern: "(?:sorry|apologize|excuse me|pardon|forgive)", intent: "apology", responseHint: "Match formality level of the apology in translation", lang: "en", examples: ["I'm sorry", "Excuse me", "Pardon me"] },
  { pattern: "(?:goodbye|bye|see you|farewell|take care|later)", intent: "farewell", responseHint: "Use appropriate farewell register for the context", lang: "en", examples: ["Goodbye", "See you later", "Take care"] },
  { pattern: "(?:eat|food|restaurant|menu|hungry|dish|meal|cuisine)", intent: "dining", responseHint: "Include local dining customs and food terminology", lang: "en", examples: ["Can I see the menu?", "What do you recommend?"] },
  { pattern: "(?:hotel|room|check.?in|check.?out|reservation|book|stay)", intent: "accommodation", responseHint: "Use hospitality industry terminology for the target language", lang: "en", examples: ["I have a reservation", "I'd like to check in"] },
  { pattern: "(?:sick|ill|doctor|medicine|pharmacy|pain|fever|allergy)", intent: "medical", responseHint: "Prioritize clarity and medical terminology accuracy", lang: "en", examples: ["I don't feel well", "I'm allergic to penicillin"] },
  { pattern: "(?:love|miss|heart|dear|darling|sweetheart|baby)", intent: "affection", responseHint: "Preserve emotional tone and intimacy level", lang: "en", examples: ["I love you", "I miss you so much"] },
  { pattern: "(?:work|meeting|office|project|deadline|colleague|boss)", intent: "business", responseHint: "Use formal register appropriate for professional settings", lang: "en", examples: ["Let's schedule a meeting", "Can we discuss the project?"] },
  { pattern: "(?:weather|rain|sun|cold|hot|temperature|forecast)", intent: "weather", responseHint: "Use local weather expressions and temperature conventions", lang: "en", examples: ["The weather is nice today", "Is it going to rain?"] },
  { pattern: "(?:teach|learn|study|school|class|student|lesson)", intent: "education", responseHint: "Use educational context terminology", lang: "en", examples: ["I'm learning Spanish", "Can you teach me?"] },
  { pattern: "(?:connect|link|sign.?in|login|social|youtube|tiktok|instagram|twitter|x\\.com|facebook|threads|snapchat|twitch|discord|reddit|linkedin|pinterest|telegram|whatsapp|spotify|tumblr|rumble|roblox|steam|playstation|epic.?games|nintendo|riot|itch\\.io|\\bea\\b|ubisoft)", intent: "social_connect", responseHint: "Social sign-in uses JunoTalk Browser. Desktop opens a detached popup window (not an iframe); mobile uses a deep-link redirect that returns the user automatically. If the user reports a setup prompt, guide them to tap 'Always Allow' in JunoTalk Browser settings. Never suggest navigating away from JunoTalk or using a different browser.", lang: "en", examples: ["Connect my YouTube", "Sign in with Instagram", "Link my TikTok", "Connect Discord", "Link LinkedIn"] },
];

const CULTURAL_NOTES: CulturalNote[] = [
  { region: "Japan", langs: ["ja"], topic: "formality", note: "Japanese has distinct formality levels (keigo). Casual speech with strangers is considered rude. Default to polite forms (-masu, -desu).", tags: ["formality", "politeness", "keigo"] },
  { region: "Japan", langs: ["ja"], topic: "greeting", note: "Bowing is the standard greeting. The depth of bow indicates respect level. 'Sumimasen' serves as both 'excuse me' and 'thank you' in casual contexts.", tags: ["greeting", "bow", "custom"] },
  { region: "Korea", langs: ["ko"], topic: "formality", note: "Korean speech levels (존댓말/반말) are crucial. Using informal speech with elders or strangers is very rude. Age hierarchy is important.", tags: ["formality", "hierarchy", "age"] },
  { region: "Arab World", langs: ["ar"], topic: "greeting", note: "'As-salamu alaykum' is the standard greeting, with the response 'Wa alaykumu as-salam'. Extended pleasantries are expected before business.", tags: ["greeting", "islam", "custom"] },
  { region: "China", langs: ["zh"], topic: "formality", note: "Chinese uses 您 (nin) as a formal 'you' vs 你 (ni). Gift-giving etiquette: avoid sets of four (associated with death). Red envelopes for special occasions.", tags: ["formality", "gift", "custom"] },
  { region: "Latin America", langs: ["es", "pt"], topic: "greeting", note: "Personal space is smaller. Greetings often include a kiss on the cheek (or two in Brazil). 'Usted' is formal, 'tu' is casual in Spanish.", tags: ["greeting", "personal space", "custom"] },
  { region: "Germany", langs: ["de"], topic: "formality", note: "Germans use 'Sie' (formal you) with strangers and in professional settings. Punctuality is highly valued. Direct communication is normal, not rude.", tags: ["formality", "punctuality", "directness"] },
  { region: "France", langs: ["fr"], topic: "greeting", note: "Always greet shopkeepers with 'Bonjour'. 'Tu' vs 'Vous' distinction is important. La bise (cheek kissing) varies by region.", tags: ["greeting", "formality", "custom"] },
  { region: "India", langs: ["hi"], topic: "greeting", note: "'Namaste' with palms together is the standard greeting. Head wobble can mean yes, acknowledgment, or understanding. Remove shoes before entering homes.", tags: ["greeting", "namaste", "custom"] },
  { region: "Turkey", langs: ["tr"], topic: "hospitality", note: "Turkish hospitality is legendary. Refusing tea or food can be seen as impolite. 'Buyurun' is a versatile word meaning 'please go ahead/help yourself'.", tags: ["hospitality", "tea", "custom"] },
  { region: "Russia", langs: ["ru"], topic: "formality", note: "Russians use patronymics (name + father's name) in formal settings. Smiling at strangers is uncommon. Firm handshakes are standard greetings.", tags: ["formality", "patronymic", "custom"] },
  { region: "Italy", langs: ["it"], topic: "greeting", note: "'Ciao' is casual, 'Buongiorno' is formal. Italians are expressive with gestures. Meals are social events — rushing is frowned upon.", tags: ["greeting", "gesture", "dining"] },
];

const IDIOM_MAP: Record<string, { meaning: string; langs: Record<string, string> }> = {
  "break a leg": { meaning: "Good luck", langs: { es: "Mucha mierda", fr: "Merde", de: "Toi toi toi", it: "In bocca al lupo", ja: "頑張って", ko: "파이팅" } },
  "piece of cake": { meaning: "Very easy", langs: { es: "Pan comido", fr: "C'est du gâteau", de: "Ein Kinderspiel", it: "Un gioco da ragazzi", ja: "朝飯前", ko: "누워서 떡 먹기" } },
  "hit the nail on the head": { meaning: "Exactly right", langs: { es: "Dar en el clavo", fr: "Mettre le doigt dessus", de: "Den Nagel auf den Kopf treffen", it: "Colpire nel segno" } },
  "it's raining cats and dogs": { meaning: "Heavy rain", langs: { es: "Llueve a cántaros", fr: "Il pleut des cordes", de: "Es regnet in Strömen", it: "Piove a catinelle", ja: "土砂降りだ" } },
  "beat around the bush": { meaning: "Avoid the main point", langs: { es: "Andarse por las ramas", fr: "Tourner autour du pot", de: "Um den heißen Brei herumreden", it: "Menare il can per l'aia" } },
  "costs an arm and a leg": { meaning: "Very expensive", langs: { es: "Costar un ojo de la cara", fr: "Coûter les yeux de la tête", de: "Ein Vermögen kosten", it: "Costare un occhio della testa", ja: "目が飛び出るほど高い" } },
  "let the cat out of the bag": { meaning: "Reveal a secret", langs: { es: "Descubrir el pastel", fr: "Vendre la mèche", de: "Die Katze aus dem Sack lassen", it: "Vuotare il sacco" } },
  "once in a blue moon": { meaning: "Very rarely", langs: { es: "De vez en cuando", fr: "Tous les trente-six du mois", de: "Alle Jubeljahre", it: "Una volta ogni morte di papa" } },
  "the ball is in your court": { meaning: "It's your decision", langs: { es: "La pelota está en tu tejado", fr: "La balle est dans ton camp", de: "Du bist am Zug", it: "La palla è nel tuo campo" } },
  "burn the midnight oil": { meaning: "Work late into the night", langs: { es: "Quemarse las pestañas", fr: "Brûler la chandelle par les deux bouts", de: "Die Nacht durcharbeiten", it: "Fare le ore piccole" } },
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[?!.,;:'"]/g, "").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(w => w.length > 1);
}

function detectIntent(text: string): { intent: string; confidence: number; hint: string } | null {
  const normalized = normalizeText(text);
  let best: { intent: string; confidence: number; hint: string } | null = null;

  for (const p of INTENT_PATTERNS) {
    const regex = new RegExp(p.pattern, "i");
    if (regex.test(normalized)) {
      const tokens = tokenize(text);
      const matchStrength = tokens.filter(t => regex.test(t)).length / Math.max(tokens.length, 1);
      const confidence = Math.min(0.5 + matchStrength * 0.5, 0.95);

      if (!best || confidence > best.confidence) {
        best = { intent: p.intent, confidence, hint: p.responseHint };
      }
    }
  }

  return best;
}

function lookupIdiom(text: string, targetLang: string): { original: string; equivalent: string; meaning: string } | null {
  const normalized = normalizeText(text);

  for (const [idiom, data] of Object.entries(IDIOM_MAP)) {
    if (normalized.includes(normalizeText(idiom))) {
      const equivalent = data.langs[targetLang];
      if (equivalent) {
        return { original: idiom, equivalent, meaning: data.meaning };
      }
    }
  }

  return null;
}

function findCulturalContext(targetLang: string, intent?: string): CulturalNote[] {
  const allNotes = [...CULTURAL_NOTES, ...getGitHubCulturalNotes()];
  const langNotes = allNotes.filter(n => n.langs.includes(targetLang));

  if (!intent) return langNotes.slice(0, 3);

  const scored = langNotes.map(n => {
    let score = 0;
    if (n.topic === intent) score += 2;
    if (n.tags.some(t => t === intent)) score += 1;
    return { note: n, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.note);
}

let githubRecallCache: {
  phrases: Record<string, Record<string, Record<string, string>>>;
  patterns: RecallPattern[];
  culturalNotes: CulturalNote[];
  idioms: Record<string, { meaning: string; langs: Record<string, string> }>;
} = { phrases: {}, patterns: [], culturalNotes: [], idioms: {} };
let githubRecallLastFetch = 0;
let fetchInProgress = false;

function getGitHubCulturalNotes(): CulturalNote[] {
  return githubRecallCache.culturalNotes;
}

async function loadGitHubRecallData(): Promise<void> {
  if (fetchInProgress) return;
  if (Date.now() - githubRecallLastFetch < REFRESH_TTL && Object.keys(githubRecallCache.phrases).length > 0) return;

  fetchInProgress = true;
  try {
    const endpoints = [
      { key: "phrases", path: "data/index.json" },
      { key: "patterns", path: "recall/patterns.json" },
      { key: "cultural", path: "recall/cultural.json" },
      { key: "idioms", path: "recall/idioms.json" },
    ];

    for (const ep of endpoints) {
      try {
        const data = await fetchPrivateFile(ep.path);
        if (!data) continue;

        switch (ep.key) {
          case "phrases":
            if (data && typeof data === "object") githubRecallCache.phrases = data as any;
            break;
          case "patterns":
            if (Array.isArray(data)) githubRecallCache.patterns = data;
            break;
          case "cultural":
            if (Array.isArray(data)) githubRecallCache.culturalNotes = data;
            break;
          case "idioms":
            if (data && typeof data === "object") githubRecallCache.idioms = data as any;
            break;
        }
      } catch {}
    }

    githubRecallLastFetch = Date.now();
    const phraseCount = Object.values(githubRecallCache.phrases).reduce((sum, targets) =>
      sum + Object.values(targets).reduce((s, pairs) => s + Object.keys(pairs).length, 0), 0);
    console.log(`[AgentRecall] GitHub data loaded: ${phraseCount} phrases, ${githubRecallCache.patterns.length} patterns, ${githubRecallCache.culturalNotes.length} cultural notes`);
  } catch (err: any) {
    console.warn("[AgentRecall] GitHub recall fetch failed:", err.message);
  } finally {
    fetchInProgress = false;
  }
}

async function saveRecallSnapshot(): Promise<void> {
  try {
    await mkdir(RECALL_DIR, { recursive: true });

    const stats = getRecallStats();
    const snapshot = `# Agent Recall Snapshot
Updated: ${new Date().toISOString()}

## Modules
- Intent patterns: ${stats.intentPatterns} (built-in) + ${stats.githubPatterns} (GitHub)
- Cultural notes: ${stats.culturalNotes} (built-in) + ${stats.githubCulturalNotes} (GitHub)
- Idiom mappings: ${stats.idiomEntries} (built-in) + ${stats.githubIdioms} (GitHub)
- GitHub phrases: ${stats.githubPhrases}

## Coverage
Languages with cultural context: ${[...new Set(CULTURAL_NOTES.flatMap(n => n.langs))].join(", ")}
Intent categories: ${INTENT_PATTERNS.map(p => p.intent).join(", ")}
`;
    await writeFile(path.join(RECALL_DIR, "snapshot.md"), snapshot, "utf-8");
  } catch {}
}

export interface RecallContext {
  intent: { intent: string; confidence: number; hint: string } | null;
  idiom: { original: string; equivalent: string; meaning: string } | null;
  culturalNotes: CulturalNote[];
  githubPhrase: string | null;
  recallSource: string;
}

export function recallForTranslation(text: string, sourceLang: string, targetLang: string): RecallContext {
  const intent = detectIntent(text);

  const idiom = lookupIdiom(text, targetLang);

  const culturalNotes = findCulturalContext(targetLang, intent?.intent);

  let githubPhrase: string | null = null;
  const normalized = text.trim();
  const ghResult = githubRecallCache.phrases[sourceLang]?.[targetLang]?.[normalized];
  if (ghResult) {
    githubPhrase = ghResult;
  } else {
    const lowerNormalized = normalized.toLowerCase();
    const pairs = githubRecallCache.phrases[sourceLang]?.[targetLang];
    if (pairs) {
      for (const [key, val] of Object.entries(pairs)) {
        if (key.toLowerCase() === lowerNormalized) {
          githubPhrase = val;
          break;
        }
      }
    }
  }

  const allIdioms = { ...IDIOM_MAP, ...githubRecallCache.idioms };
  let extendedIdiom = idiom;
  if (!extendedIdiom) {
    const normalizedText = normalizeText(text);
    for (const [phrase, data] of Object.entries(allIdioms)) {
      if (normalizedText.includes(normalizeText(phrase))) {
        const equiv = data.langs[targetLang];
        if (equiv) {
          extendedIdiom = { original: phrase, equivalent: equiv, meaning: data.meaning };
          break;
        }
      }
    }
  }

  const sources: string[] = [];
  if (intent) sources.push("intent");
  if (extendedIdiom) sources.push("idiom");
  if (culturalNotes.length > 0) sources.push("cultural");
  if (githubPhrase) sources.push("github-osint");

  return {
    intent,
    idiom: extendedIdiom,
    culturalNotes,
    githubPhrase,
    recallSource: sources.length > 0 ? sources.join("+") : "none",
  };
}

export function buildRecallPromptContext(recall: RecallContext): string {
  const parts: string[] = [];

  if (recall.idiom) {
    parts.push(`[Idiom detected] "${recall.idiom.original}" means "${recall.idiom.meaning}". Use the equivalent expression: "${recall.idiom.equivalent}" instead of translating literally.`);
  }

  if (recall.intent) {
    parts.push(`[Intent: ${recall.intent.intent}] ${recall.intent.hint}`);
  }

  if (recall.culturalNotes.length > 0) {
    const noteTexts = recall.culturalNotes
      .slice(0, 2)
      .map(n => `${n.topic}: ${n.note}`)
      .join(" ");
    parts.push(`[Cultural context] ${noteTexts}`);
  }

  if (recall.githubPhrase) {
    parts.push(`[OSINT memory] A curated translation exists: "${recall.githubPhrase}". Prefer this if it fits naturally.`);
  }

  return parts.join("\n");
}

export function getRecallStats() {
  const githubPhraseCount = Object.values(githubRecallCache.phrases).reduce((sum, targets) =>
    sum + Object.values(targets).reduce((s, pairs) => s + Object.keys(pairs).length, 0), 0);

  return {
    intentPatterns: INTENT_PATTERNS.length,
    culturalNotes: CULTURAL_NOTES.length,
    idiomEntries: Object.keys(IDIOM_MAP).length,
    githubPatterns: githubRecallCache.patterns.length,
    githubCulturalNotes: githubRecallCache.culturalNotes.length,
    githubIdioms: Object.keys(githubRecallCache.idioms).length,
    githubPhrases: githubPhraseCount,
    lastGitHubFetch: githubRecallLastFetch ? new Date(githubRecallLastFetch).toISOString() : null,
    initialized,
  };
}

export async function initRecallSystem(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await Promise.all([loadGitHubRecallData(), loadUserBehaviorRecall()]);
      await saveRecallSnapshot();
      initialized = true;
      const stats = getRecallStats();
      console.log(`[AgentRecall] Initialized: ${stats.intentPatterns} intents, ${stats.culturalNotes} cultural notes, ${stats.idiomEntries} idioms, ${stats.githubPhrases} GitHub phrases`);
    } catch (err: any) {
      console.warn("[AgentRecall] Init failed (using built-in data only):", err.message);
      initialized = true;
    }
  })();

  return initPromise;
}

export async function pushRecallToGitHub(): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return 0;

  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    let pushed = 0;

    const files: { path: string; data: any }[] = [
      { path: "recall/patterns.json", data: INTENT_PATTERNS },
      { path: "recall/cultural.json", data: CULTURAL_NOTES },
      { path: "recall/idioms.json", data: IDIOM_MAP },
    ];

    for (const file of files) {
      const content = Buffer.from(JSON.stringify(file.data, null, 2)).toString("base64");
      let sha: string | undefined;
      try {
        const { data } = await octokit.repos.getContent({ owner: "lasawno", repo: "junotalk-cdn", path: file.path });
        if ("sha" in data) sha = data.sha;
      } catch {}

      await octokit.repos.createOrUpdateFileContents({
        owner: "lasawno",
        repo: "junotalk-cdn",
        path: file.path,
        message: `[AgentRecall] Update ${file.path}`,
        content,
        ...(sha ? { sha } : {}),
      });
      pushed++;
    }

    return pushed;
  } catch (err: any) {
    console.error("[AgentRecall] GitHub push failed:", err.message);
    return 0;
  }
}

initRecallSystem().catch(() => {});
setInterval(() => loadGitHubRecallData().catch(() => {}), REFRESH_TTL);
