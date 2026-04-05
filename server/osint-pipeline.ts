import { db } from "./db";
import { translationMemory } from "@shared/schema";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const GITHUB_OWNER = "lasawno";
const GITHUB_REPO = "junotalk-cdn";
const TATOEBA_API = "https://tatoeba.org/en/api_v0";
const WIKTIONARY_API = "https://en.wiktionary.org/api/rest_v1";
const OSINT_DATA_DIR = path.resolve(process.cwd(), "vault/osint");

interface OSINTSource {
  name: string;
  type: "phrases" | "slang" | "idioms" | "context";
  collect: () => Promise<CollectedData[]>;
}

interface CollectedData {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  source: string;
  category?: string;
  confidence?: number;
}

interface PipelineStats {
  collected: number;
  processed: number;
  seeded: number;
  skipped: number;
  failed: number;
  pushed: number;
  sources: Record<string, { collected: number; errors: number }>;
  timestamp: string;
  durationMs: number;
}

const SUPPORTED_LANGS = ["en", "es", "fr", "de", "zh", "ja", "ko", "pt", "it", "ru", "ar", "hi", "tr", "nl"];

const LANG_MAP_TATOEBA: Record<string, string> = {
  en: "eng", es: "spa", fr: "fra", de: "deu", zh: "cmn", ja: "jpn",
  ko: "kor", pt: "por", it: "ita", ru: "rus", ar: "ara", hi: "hin",
  tr: "tur", nl: "nld",
};

const TRAVEL_PHRASES: Record<string, string[]> = {
  en: [
    "Where is the nearest hospital?",
    "I need a taxi",
    "How do I get to the airport?",
    "Can I have the bill please?",
    "I'm allergic to",
    "Where is the bathroom?",
    "I'm lost",
    "Can you speak slower?",
    "How much does this cost?",
    "Is there WiFi here?",
    "I need help",
    "Call the police",
    "I don't feel well",
    "Where can I exchange money?",
    "What time does it open?",
    "What time does it close?",
    "Is this seat taken?",
    "I have a reservation",
    "Can you recommend a restaurant?",
    "Where is the train station?",
    "I'd like to check in",
    "I'd like to check out",
    "Do you accept credit cards?",
    "Where can I buy a SIM card?",
    "I need a doctor",
    "Is there a pharmacy nearby?",
    "Can I see the menu?",
    "Water please",
    "No spicy food please",
    "I'm vegetarian",
    "One ticket please",
    "Round trip",
    "What platform?",
    "Is this the right bus?",
    "Stop here please",
    "Keep the change",
    "Could you take a photo?",
    "I lost my passport",
    "Where is the embassy?",
    "Emergency",
  ],
};

const BUSINESS_PHRASES: Record<string, string[]> = {
  en: [
    "Nice to meet you",
    "Let's schedule a meeting",
    "Could you send me the details?",
    "I'll follow up on that",
    "What's your email address?",
    "Let me check my calendar",
    "Can we discuss this further?",
    "I agree with your proposal",
    "We need more time",
    "The deadline is",
    "Please find attached",
    "Looking forward to hearing from you",
    "Best regards",
    "Thank you for your time",
    "Can you repeat that?",
    "I have a question",
    "What do you think?",
    "Let's move forward",
    "We'll get back to you",
    "That sounds good",
  ],
};

const SOCIAL_PHRASES: Record<string, string[]> = {
  en: [
    "What do you do for fun?",
    "Have you been here before?",
    "The weather is nice today",
    "What's your favorite food?",
    "Do you like music?",
    "Where are you from?",
    "How long have you been here?",
    "That's really interesting",
    "I love this place",
    "Let's take a selfie",
    "Can I add you on social media?",
    "What are you doing this weekend?",
    "Happy birthday",
    "Congratulations",
    "I miss you",
    "Take care",
    "Have a great day",
    "It was nice talking to you",
    "Let's keep in touch",
    "See you soon",
  ],
};

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

const SEARCH_SEEDS = ["hello", "help", "where", "how", "please", "want", "need", "like", "go", "come", "eat", "drink", "work", "live", "speak"];

async function collectTatoebaPairs(sourceLang: string, targetLang: string, limit = 20): Promise<CollectedData[]> {
  const results: CollectedData[] = [];
  const srcCode = LANG_MAP_TATOEBA[sourceLang];
  const tgtCode = LANG_MAP_TATOEBA[targetLang];
  if (!srcCode || !tgtCode) return results;

  const perQuery = Math.ceil(limit / SEARCH_SEEDS.length);
  const seeds = SEARCH_SEEDS.slice(0, Math.min(SEARCH_SEEDS.length, Math.ceil(limit / perQuery)));

  for (const seed of seeds) {
    if (results.length >= limit) break;
    try {
      const url = `${TATOEBA_API}/search?from=${srcCode}&to=${tgtCode}&query=${encodeURIComponent(seed)}&limit=${perQuery}`;
      const resp = await fetchWithTimeout(url, 12000);
      if (!resp.ok) continue;

      const data = await resp.json() as any;
      const sentences = data?.results || [];

      for (const sentence of sentences) {
        if (results.length >= limit) break;
        const sourceText = sentence?.text?.trim();
        if (!sourceText || sourceText.length < 3 || sourceText.length > 200) continue;

        const translationGroups = sentence?.translations || [];
        const firstGroup = Array.isArray(translationGroups[0]) ? translationGroups[0] : [];

        for (const trans of firstGroup) {
          if (trans?.text?.trim()) {
            results.push({
              sourceText,
              translatedText: trans.text.trim(),
              sourceLang,
              targetLang,
              source: "tatoeba",
              category: "sentence",
              confidence: 0.9,
            });
            break;
          }
        }
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.warn(`[OSINT] Tatoeba ${sourceLang}->${targetLang} (${seed}) failed:`, err.message);
    }
  }

  return results;
}

async function collectWiktionaryWords(word: string, lang: string): Promise<CollectedData[]> {
  const results: CollectedData[] = [];
  try {
    const url = `${WIKTIONARY_API}/page/definition/${encodeURIComponent(word)}`;
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) return results;

    const data = await resp.json() as any;
    const entries = data?.[lang] || data?.en || [];

    for (const entry of entries) {
      const definitions = entry?.definitions || [];
      for (const def of definitions) {
        if (def?.definition) {
          const cleanDef = def.definition.replace(/<[^>]+>/g, "").trim();
          if (cleanDef.length > 2 && cleanDef.length < 300) {
            results.push({
              sourceText: word,
              translatedText: cleanDef,
              sourceLang: lang,
              targetLang: "en",
              source: "wiktionary",
              category: "definition",
              confidence: 0.85,
            });
          }
        }
      }
    }
  } catch {}
  return results;
}

function buildContextualPhrases(): CollectedData[] {
  const results: CollectedData[] = [];
  const phraseSets = [
    { phrases: TRAVEL_PHRASES, category: "travel" },
    { phrases: BUSINESS_PHRASES, category: "business" },
    { phrases: SOCIAL_PHRASES, category: "social" },
  ];

  const knownTranslations: Record<string, Record<string, Record<string, string>>> = {
    en: {
      es: {
        "Where is the nearest hospital?": "Donde esta el hospital mas cercano?",
        "I need a taxi": "Necesito un taxi",
        "How do I get to the airport?": "Como llego al aeropuerto?",
        "Can I have the bill please?": "La cuenta por favor",
        "I'm allergic to": "Soy alergico a",
        "Where is the bathroom?": "Donde esta el bano?",
        "I'm lost": "Estoy perdido",
        "Can you speak slower?": "Puedes hablar mas lento?",
        "How much does this cost?": "Cuanto cuesta esto?",
        "Is there WiFi here?": "Hay WiFi aqui?",
        "I need help": "Necesito ayuda",
        "Call the police": "Llame a la policia",
        "I don't feel well": "No me siento bien",
        "Where can I exchange money?": "Donde puedo cambiar dinero?",
        "What time does it open?": "A que hora abre?",
        "What time does it close?": "A que hora cierra?",
        "Is this seat taken?": "Esta ocupado este asiento?",
        "I have a reservation": "Tengo una reservacion",
        "Can you recommend a restaurant?": "Puede recomendar un restaurante?",
        "Where is the train station?": "Donde esta la estacion de tren?",
        "I'd like to check in": "Me gustaria registrarme",
        "I'd like to check out": "Me gustaria hacer el checkout",
        "Do you accept credit cards?": "Aceptan tarjetas de credito?",
        "Where can I buy a SIM card?": "Donde puedo comprar una tarjeta SIM?",
        "I need a doctor": "Necesito un doctor",
        "Is there a pharmacy nearby?": "Hay una farmacia cerca?",
        "Can I see the menu?": "Puedo ver el menu?",
        "Water please": "Agua por favor",
        "No spicy food please": "Sin comida picante por favor",
        "I'm vegetarian": "Soy vegetariano",
        "One ticket please": "Un boleto por favor",
        "Round trip": "Viaje de ida y vuelta",
        "What platform?": "Que plataforma?",
        "Is this the right bus?": "Es este el autobus correcto?",
        "Stop here please": "Pare aqui por favor",
        "Keep the change": "Quedese con el cambio",
        "Could you take a photo?": "Podria tomar una foto?",
        "I lost my passport": "Perdi mi pasaporte",
        "Where is the embassy?": "Donde esta la embajada?",
        "Emergency": "Emergencia",
        "Let's schedule a meeting": "Programemos una reunion",
        "Could you send me the details?": "Podria enviarme los detalles?",
        "I'll follow up on that": "Le dare seguimiento a eso",
        "What's your email address?": "Cual es tu correo electronico?",
        "Let me check my calendar": "Dejame revisar mi calendario",
        "Can we discuss this further?": "Podemos discutir esto mas?",
        "I agree with your proposal": "Estoy de acuerdo con tu propuesta",
        "We need more time": "Necesitamos mas tiempo",
        "The deadline is": "La fecha limite es",
        "Looking forward to hearing from you": "Espero tener noticias tuyas",
        "Thank you for your time": "Gracias por su tiempo",
        "What do you think?": "Que piensas?",
        "Let's move forward": "Avancemos",
        "That sounds good": "Eso suena bien",
        "What do you do for fun?": "Que haces para divertirte?",
        "Have you been here before?": "Has estado aqui antes?",
        "The weather is nice today": "El clima esta bonito hoy",
        "What's your favorite food?": "Cual es tu comida favorita?",
        "Do you like music?": "Te gusta la musica?",
        "Where are you from?": "De donde eres?",
        "How long have you been here?": "Cuanto tiempo llevas aqui?",
        "That's really interesting": "Eso es muy interesante",
        "I love this place": "Me encanta este lugar",
        "Let's take a selfie": "Tomemos una selfie",
        "What are you doing this weekend?": "Que haces este fin de semana?",
        "Happy birthday": "Feliz cumpleanos",
        "Congratulations": "Felicidades",
        "I miss you": "Te extrano",
        "Take care": "Cuidate",
        "Have a great day": "Que tengas un gran dia",
        "It was nice talking to you": "Fue un gusto hablar contigo",
        "Let's keep in touch": "Mantengamos el contacto",
        "See you soon": "Nos vemos pronto",
      },
      fr: {
        "Where is the nearest hospital?": "Ou est l'hopital le plus proche?",
        "I need a taxi": "J'ai besoin d'un taxi",
        "How do I get to the airport?": "Comment aller a l'aeroport?",
        "Can I have the bill please?": "L'addition s'il vous plait",
        "Where is the bathroom?": "Ou sont les toilettes?",
        "I'm lost": "Je suis perdu",
        "Can you speak slower?": "Pouvez-vous parler plus lentement?",
        "How much does this cost?": "Combien ca coute?",
        "Is there WiFi here?": "Y a-t-il du WiFi ici?",
        "I need help": "J'ai besoin d'aide",
        "Call the police": "Appelez la police",
        "I don't feel well": "Je ne me sens pas bien",
        "I have a reservation": "J'ai une reservation",
        "Can you recommend a restaurant?": "Pouvez-vous recommander un restaurant?",
        "Where is the train station?": "Ou est la gare?",
        "Do you accept credit cards?": "Acceptez-vous les cartes de credit?",
        "I need a doctor": "J'ai besoin d'un medecin",
        "Water please": "De l'eau s'il vous plait",
        "I'm vegetarian": "Je suis vegetarien",
        "One ticket please": "Un billet s'il vous plait",
        "Emergency": "Urgence",
        "Happy birthday": "Joyeux anniversaire",
        "Congratulations": "Felicitations",
        "I miss you": "Tu me manques",
        "Take care": "Prends soin de toi",
        "Have a great day": "Bonne journee",
        "See you soon": "A bientot",
        "Where are you from?": "D'ou venez-vous?",
        "The weather is nice today": "Il fait beau aujourd'hui",
        "That's really interesting": "C'est vraiment interessant",
        "Thank you for your time": "Merci pour votre temps",
        "What do you think?": "Qu'en pensez-vous?",
      },
      zh: {
        "Where is the nearest hospital?": "最近的医院在哪里?",
        "I need a taxi": "我需要一辆出租车",
        "How do I get to the airport?": "怎么去机场?",
        "Can I have the bill please?": "请结账",
        "Where is the bathroom?": "洗手间在哪里?",
        "I'm lost": "我迷路了",
        "How much does this cost?": "这个多少钱?",
        "Is there WiFi here?": "这里有WiFi吗?",
        "I need help": "我需要帮助",
        "Call the police": "报警",
        "I don't feel well": "我不舒服",
        "I have a reservation": "我有预约",
        "I need a doctor": "我需要看医生",
        "Water please": "请给我水",
        "I'm vegetarian": "我是素食者",
        "One ticket please": "请给我一张票",
        "Emergency": "紧急情况",
        "Happy birthday": "生日快乐",
        "Congratulations": "恭喜",
        "I miss you": "我想你",
        "Take care": "保重",
        "Have a great day": "祝你有美好的一天",
        "See you soon": "再见",
        "Where are you from?": "你从哪里来?",
        "Thank you for your time": "谢谢你的时间",
        "The weather is nice today": "今天天气很好",
      },
    },
  };

  for (const [srcLang, targets] of Object.entries(knownTranslations)) {
    for (const [tgtLang, pairs] of Object.entries(targets)) {
      for (const [src, tgt] of Object.entries(pairs)) {
        const matchingCategory = phraseSets.find(ps =>
          ps.phrases[srcLang]?.includes(src)
        )?.category || "general";
        results.push({
          sourceText: src,
          translatedText: tgt,
          sourceLang: srcLang,
          targetLang: tgtLang,
          source: "curated",
          category: matchingCategory,
          confidence: 1.0,
        });
      }
    }
  }

  return results;
}

function deduplicateData(data: CollectedData[]): CollectedData[] {
  const seen = new Set<string>();
  return data.filter(d => {
    const key = `${d.sourceLang}|${d.targetLang}|${d.sourceText.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function seedToDatabase(data: CollectedData[]): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0, skipped = 0;

  for (const item of data) {
    try {
      await db.insert(translationMemory)
        .values({
          sourceLang: item.sourceLang,
          targetLang: item.targetLang,
          sourceText: item.sourceText,
          translatedText: item.translatedText,
          provider: `osint:${item.source}`,
        })
        .onConflictDoNothing();
      seeded++;
    } catch {
      skipped++;
    }
  }

  return { seeded, skipped };
}

async function pushToGitHub(data: CollectedData[]): Promise<number> {
  const grouped: Record<string, Record<string, Record<string, string>>> = {};

  for (const item of data) {
    if (!grouped[item.sourceLang]) grouped[item.sourceLang] = {};
    if (!grouped[item.sourceLang][item.targetLang]) grouped[item.sourceLang][item.targetLang] = {};
    grouped[item.sourceLang][item.targetLang][item.sourceText] = item.translatedText;
  }

  let pushed = 0;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("[OSINT] No GITHUB_TOKEN, skipping CDN push (data seeded to DB only)");
    return 0;
  }

  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });

    for (const [srcLang, targets] of Object.entries(grouped)) {
      for (const [tgtLang, pairs] of Object.entries(targets)) {
        const filename = `${srcLang}-${tgtLang}.json`;
        const filePath = `data/${filename}`;

        let existingData: Record<string, string> = {};
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
          });
          if ("content" in fileData) {
            existingData = JSON.parse(Buffer.from(fileData.content, "base64").toString());
          }
        } catch {}

        const merged = { ...existingData, ...pairs };
        const newCount = Object.keys(merged).length - Object.keys(existingData).length;
        if (newCount === 0) continue;

        const content = Buffer.from(JSON.stringify(merged, null, 2)).toString("base64");

        let sha: string | undefined;
        try {
          const { data: existing } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
          });
          if ("sha" in existing) sha = existing.sha;
        } catch {}

        await octokit.repos.createOrUpdateFileContents({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          path: filePath,
          message: `[OSINT] Update ${filename}: +${newCount} phrases`,
          content,
          ...(sha ? { sha } : {}),
        });

        pushed += newCount;
      }
    }

    if (pushed > 0) {
      try {
        const { data: indexFile } = await octokit.repos.getContent({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          path: "data/index.json",
        });

        let indexData: Record<string, Record<string, Record<string, string>>> = {};
        if ("content" in indexFile) {
          indexData = JSON.parse(Buffer.from(indexFile.content, "base64").toString());
        }

        for (const [srcLang, targets] of Object.entries(grouped)) {
          if (!indexData[srcLang]) indexData[srcLang] = {};
          for (const [tgtLang, pairs] of Object.entries(targets)) {
            if (!indexData[srcLang][tgtLang]) indexData[srcLang][tgtLang] = {};
            Object.assign(indexData[srcLang][tgtLang], pairs);
          }
        }

        const indexContent = Buffer.from(JSON.stringify(indexData, null, 2)).toString("base64");
        await octokit.repos.createOrUpdateFileContents({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          path: "data/index.json",
          message: `[OSINT] Update index: +${pushed} total phrases`,
          content: indexContent,
          sha: "sha" in indexFile ? indexFile.sha : undefined,
        });
      } catch (err: any) {
        console.warn("[OSINT] Index update failed:", err.message);
      }
    }
  } catch (err: any) {
    console.error("[OSINT] GitHub push failed:", err.message);
  }

  return pushed;
}

async function saveOSINTReport(stats: PipelineStats): Promise<void> {
  try {
    await mkdir(OSINT_DATA_DIR, { recursive: true });
    const reportPath = path.join(OSINT_DATA_DIR, "last-run.md");
    const report = `# OSINT Pipeline Report
Generated: ${stats.timestamp}
Duration: ${stats.durationMs}ms

## Collection Summary
- Total collected: ${stats.collected}
- Processed (deduplicated): ${stats.processed}
- Seeded to DB: ${stats.seeded}
- Pushed to GitHub CDN: ${stats.pushed}
- Skipped (duplicates): ${stats.skipped}
- Failed: ${stats.failed}

## Sources
${Object.entries(stats.sources).map(([name, s]) =>
  `- **${name}**: ${s.collected} collected, ${s.errors} errors`
).join("\n")}

## Data Categories
- Travel phrases (emergency, navigation, accommodation)
- Business phrases (meetings, emails, proposals)
- Social phrases (greetings, small talk, celebrations)
- Sentence pairs (Tatoeba open corpus)

## Coverage
Target language pairs: en→es, en→fr, en→zh (primary)
Additional pairs added via Tatoeba when available.
`;
    await writeFile(reportPath, report, "utf-8");
  } catch (err: any) {
    console.warn("[OSINT] Report save failed:", err.message);
  }
}

export async function runOSINTPipeline(options?: {
  skipGitHub?: boolean;
  langPairs?: [string, string][];
  maxTatoeba?: number;
}): Promise<PipelineStats> {
  const startTime = Date.now();
  const stats: PipelineStats = {
    collected: 0,
    processed: 0,
    seeded: 0,
    skipped: 0,
    failed: 0,
    pushed: 0,
    sources: {},
    timestamp: new Date().toISOString(),
    durationMs: 0,
  };

  console.log("[OSINT] Pipeline starting...");

  const allData: CollectedData[] = [];

  const curated = buildContextualPhrases();
  allData.push(...curated);
  stats.sources.curated = { collected: curated.length, errors: 0 };
  console.log(`[OSINT] Curated phrases: ${curated.length}`);

  const langPairs = options?.langPairs || [
    ["en", "es"], ["en", "fr"], ["en", "zh"],
    ["en", "de"], ["en", "ja"], ["en", "ko"],
    ["en", "pt"], ["en", "it"], ["en", "ru"],
  ];

  let tatoebaTotal = 0;
  let tatoebaErrors = 0;
  for (const [src, tgt] of langPairs) {
    try {
      const pairs = await collectTatoebaPairs(src, tgt, options?.maxTatoeba || 20);
      allData.push(...pairs);
      tatoebaTotal += pairs.length;
      await new Promise(r => setTimeout(r, 1000));
    } catch {
      tatoebaErrors++;
    }
  }
  stats.sources.tatoeba = { collected: tatoebaTotal, errors: tatoebaErrors };
  console.log(`[OSINT] Tatoeba pairs: ${tatoebaTotal}`);

  stats.collected = allData.length;
  const deduplicated = deduplicateData(allData);
  stats.processed = deduplicated.length;
  console.log(`[OSINT] After dedup: ${deduplicated.length} unique pairs`);

  const dbResult = await seedToDatabase(deduplicated);
  stats.seeded = dbResult.seeded;
  stats.skipped = dbResult.skipped;
  console.log(`[OSINT] DB seeded: ${dbResult.seeded}, skipped: ${dbResult.skipped}`);

  if (!options?.skipGitHub) {
    const pushed = await pushToGitHub(deduplicated);
    stats.pushed = pushed;
    console.log(`[OSINT] GitHub CDN pushed: ${pushed} new phrases`);
  }

  stats.durationMs = Date.now() - startTime;
  await saveOSINTReport(stats);

  console.log(`[OSINT] Pipeline complete in ${stats.durationMs}ms: ${stats.seeded} seeded, ${stats.pushed} pushed`);
  return stats;
}

export function getOSINTSources(): { name: string; type: string; description: string }[] {
  return [
    { name: "curated", type: "phrases", description: "Hand-curated travel, business, and social phrases with verified translations" },
    { name: "tatoeba", type: "phrases", description: "Open-source sentence pairs from the Tatoeba project (CC-BY 2.0)" },
    { name: "wiktionary", type: "definitions", description: "Word definitions and translations from Wiktionary (CC-BY-SA)" },
  ];
}
