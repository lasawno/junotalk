import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fetchPrivateFile } from "./github-config";

const KNOWLEDGE_DIR = path.resolve(process.cwd(), "vault/knowledge");
const GITHUB_OWNER = "lasawno";
const GITHUB_REPO = "junotalk-cdn";

export interface KnowledgeEntry {
  q: string;
  a: string;
  category: string;
  tags: string[];
  lang?: string;
}

interface KnowledgeIndex {
  categories: string[];
  totalEntries: number;
  lastUpdated: string;
}

let knowledgeCache: KnowledgeEntry[] = [];
let knowledgeLastLoad = 0;
const KNOWLEDGE_CACHE_TTL = 60 * 60 * 1000;

// Scraped data from juno-data-engine → junotalk-cdn/knowledge/scraped-data.json
let scrapedCache: KnowledgeEntry[] = [];
let scrapedLastLoad = 0;
let scrapedTimestamp: string | null = null;
let scrapedSourceCount = 0;
const SCRAPED_CACHE_TTL = 30 * 60 * 1000; // refresh every 30 min

const GENERAL_KNOWLEDGE: KnowledgeEntry[] = [
  { q: "What is the capital of France?", a: "Paris is the capital of France. It's located in northern France along the Seine River and has a population of about 2.1 million in the city proper.", category: "geography", tags: ["capital", "france", "europe"] },
  { q: "What is the capital of Spain?", a: "Madrid is the capital of Spain, located in the center of the Iberian Peninsula. It's the largest city in Spain with about 3.3 million people.", category: "geography", tags: ["capital", "spain", "europe"] },
  { q: "What is the capital of Japan?", a: "Tokyo is the capital of Japan. It's the most populous metropolitan area in the world with about 14 million people in the city proper.", category: "geography", tags: ["capital", "japan", "asia"] },
  { q: "What is the capital of China?", a: "Beijing is the capital of China. It has served as the political center of China for most of the last eight centuries.", category: "geography", tags: ["capital", "china", "asia"] },
  { q: "What is the capital of Germany?", a: "Berlin is the capital of Germany and its largest city, with about 3.7 million residents.", category: "geography", tags: ["capital", "germany", "europe"] },
  { q: "What is the capital of Brazil?", a: "Brasilia is the capital of Brazil. It was purpose-built and inaugurated in 1960 to serve as the new national capital.", category: "geography", tags: ["capital", "brazil", "south america"] },
  { q: "What is the capital of Italy?", a: "Rome is the capital of Italy. It's one of the oldest continuously occupied cities in Europe, founded in 753 BC.", category: "geography", tags: ["capital", "italy", "europe"] },
  { q: "What is the capital of the United States?", a: "Washington, D.C. is the capital of the United States. It was founded in 1790 and named after George Washington.", category: "geography", tags: ["capital", "usa", "north america"] },
  { q: "What is the capital of Russia?", a: "Moscow is the capital of Russia and the largest city in Europe by population, with about 13 million people.", category: "geography", tags: ["capital", "russia", "europe", "asia"] },
  { q: "What is the capital of South Korea?", a: "Seoul is the capital of South Korea, home to about 9.7 million people and a major global technology hub.", category: "geography", tags: ["capital", "south korea", "asia"] },
  { q: "What is the capital of India?", a: "New Delhi is the capital of India, serving as the seat of the government of India.", category: "geography", tags: ["capital", "india", "asia"] },
  { q: "What is the capital of Mexico?", a: "Mexico City is the capital of Mexico and the most populous city in North America.", category: "geography", tags: ["capital", "mexico", "north america"] },
  { q: "What is the capital of Australia?", a: "Canberra is the capital of Australia. It was selected as the capital in 1908 as a compromise between Sydney and Melbourne.", category: "geography", tags: ["capital", "australia", "oceania"] },
  { q: "What is the capital of Canada?", a: "Ottawa is the capital of Canada, located in Ontario on the southern bank of the Ottawa River.", category: "geography", tags: ["capital", "canada", "north america"] },
  { q: "What is the capital of the United Kingdom?", a: "London is the capital of the United Kingdom and England. It's one of the world's most important financial centers.", category: "geography", tags: ["capital", "uk", "europe"] },

  { q: "How many continents are there?", a: "There are 7 continents: Africa, Antarctica, Asia, Australia/Oceania, Europe, North America, and South America. Asia is the largest and Australia is the smallest.", category: "geography", tags: ["continents", "world"] },
  { q: "What is the largest ocean?", a: "The Pacific Ocean is the largest ocean, covering about 63 million square miles — more than all the land area on Earth combined.", category: "geography", tags: ["ocean", "pacific"] },
  { q: "What is the longest river?", a: "The Nile River in Africa is traditionally considered the longest river at about 4,130 miles, though some measurements suggest the Amazon may be longer.", category: "geography", tags: ["river", "nile", "africa"] },
  { q: "What is the tallest mountain?", a: "Mount Everest is the tallest mountain above sea level at 29,032 feet (8,849 meters), located in the Himalayas on the border of Nepal and Tibet.", category: "geography", tags: ["mountain", "everest"] },

  { q: "Who invented the telephone?", a: "Alexander Graham Bell is credited with inventing the telephone in 1876, though Antonio Meucci and others also contributed to its development.", category: "science", tags: ["invention", "telephone", "history"] },
  { q: "Who invented the internet?", a: "The internet was developed through contributions from many people. Key milestones include ARPANET (1969), TCP/IP by Vint Cerf and Bob Kahn (1974), and the World Wide Web by Tim Berners-Lee (1989).", category: "science", tags: ["invention", "internet", "technology"] },
  { q: "What is the speed of light?", a: "The speed of light in a vacuum is approximately 299,792,458 meters per second, or about 186,282 miles per second. It takes light about 8 minutes to travel from the Sun to Earth.", category: "science", tags: ["physics", "light", "speed"] },
  { q: "What is photosynthesis?", a: "Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen. It's the primary way plants produce food and is essential for life on Earth.", category: "science", tags: ["biology", "plants"] },
  { q: "What is DNA?", a: "DNA (deoxyribonucleic acid) is a molecule that carries genetic instructions for life. It has a double helix structure and contains the code that determines traits in all living organisms.", category: "science", tags: ["biology", "genetics"] },
  { q: "What is gravity?", a: "Gravity is a fundamental force that attracts objects with mass toward each other. On Earth, it gives objects weight and causes them to fall at about 9.8 meters per second squared.", category: "science", tags: ["physics", "gravity"] },
  { q: "How far is the moon?", a: "The Moon is about 238,855 miles (384,400 kilometers) from Earth on average. Light takes about 1.3 seconds to travel from the Moon to Earth.", category: "science", tags: ["space", "moon", "distance"] },
  { q: "How far is the sun?", a: "The Sun is about 93 million miles (150 million kilometers) from Earth. This distance is called an Astronomical Unit (AU).", category: "science", tags: ["space", "sun", "distance"] },
  { q: "What is the solar system?", a: "The solar system consists of the Sun and everything that orbits it: 8 planets (Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune), dwarf planets, moons, asteroids, and comets.", category: "science", tags: ["space", "planets", "solar system"] },
  { q: "What causes earthquakes?", a: "Earthquakes are caused by the sudden release of energy in Earth's crust, usually from tectonic plates moving, colliding, or sliding past each other along fault lines.", category: "science", tags: ["geology", "earthquakes"] },

  { q: "What is AI?", a: "Artificial Intelligence (AI) is technology that enables computers to simulate human intelligence — learning from data, recognizing patterns, making decisions, and understanding language. It powers things like voice assistants, translation, and recommendation systems.", category: "technology", tags: ["ai", "artificial intelligence"] },
  { q: "What is machine learning?", a: "Machine learning is a type of AI where computers learn from data without being explicitly programmed. They find patterns in large datasets and improve their performance over time.", category: "technology", tags: ["ai", "machine learning"] },
  { q: "What is blockchain?", a: "Blockchain is a distributed digital ledger technology that records transactions across many computers. It's the technology behind cryptocurrencies like Bitcoin and is known for being transparent and tamper-resistant.", category: "technology", tags: ["blockchain", "cryptocurrency"] },
  { q: "What is cloud computing?", a: "Cloud computing is delivering computing services (servers, storage, databases, software) over the internet instead of using local hardware. Major providers include AWS, Google Cloud, and Microsoft Azure.", category: "technology", tags: ["cloud", "computing"] },
  { q: "What is 5G?", a: "5G is the fifth generation of mobile network technology. It offers faster speeds (up to 10 Gbps), lower latency, and supports more connected devices than 4G.", category: "technology", tags: ["5g", "mobile", "network"] },
  { q: "What is an eSIM?", a: "An eSIM (embedded SIM) is a digital SIM built into your device. Instead of inserting a physical card, you download a carrier profile. It allows switching carriers without changing cards and supports multiple numbers on one device.", category: "technology", tags: ["esim", "mobile", "sim"] },
  { q: "What is end-to-end encryption?", a: "End-to-end encryption (E2EE) means only the sender and receiver can read messages. Even the service provider cannot access the content. It protects privacy in messaging apps like Signal and JunoTalk.", category: "technology", tags: ["encryption", "privacy", "security"] },
  { q: "What is WebRTC?", a: "WebRTC (Web Real-Time Communication) is a free, open technology that enables real-time audio, video, and data communication directly between browsers without plugins.", category: "technology", tags: ["webrtc", "video", "communication"] },

  { q: "What is the population of the world?", a: "As of 2024, the world population is approximately 8.1 billion people. The most populous countries are India, China, the United States, Indonesia, and Pakistan.", category: "general", tags: ["population", "world"] },
  { q: "How many languages are there?", a: "There are approximately 7,000 languages spoken worldwide. About 40% are endangered. The most spoken languages by total speakers are English, Mandarin Chinese, Hindi, Spanish, and French.", category: "general", tags: ["languages", "world"] },
  { q: "What is the most spoken language?", a: "English is the most widely spoken language by total speakers (about 1.5 billion including non-native). Mandarin Chinese has the most native speakers (about 920 million).", category: "general", tags: ["languages", "most spoken"] },
  { q: "How many countries are there?", a: "There are 195 countries in the world: 193 member states of the United Nations plus Vatican City and Palestine as observer states.", category: "general", tags: ["countries", "world"] },
  { q: "What are the most visited countries?", a: "The most visited countries by international tourists include France, Spain, the United States, China, Italy, Turkey, Mexico, Germany, Thailand, and the United Kingdom.", category: "general", tags: ["travel", "tourism"] },
  { q: "What is the largest country?", a: "Russia is the largest country by land area at 17.1 million square kilometers, spanning 11 time zones across Europe and Asia.", category: "geography", tags: ["largest", "russia", "country"] },
  { q: "What is the smallest country?", a: "Vatican City is the smallest country in the world at just 0.17 square miles (0.44 square kilometers), located within Rome, Italy.", category: "geography", tags: ["smallest", "vatican", "country"] },

  { q: "What is the United Nations?", a: "The United Nations (UN) is an international organization founded in 1945 with 193 member states. Its goals include maintaining peace, protecting human rights, and promoting international cooperation.", category: "general", tags: ["un", "united nations", "international"] },
  { q: "What is climate change?", a: "Climate change refers to long-term shifts in global temperatures and weather patterns, primarily driven by human activities like burning fossil fuels, which release greenhouse gases into the atmosphere.", category: "science", tags: ["climate", "environment"] },
  { q: "What is renewable energy?", a: "Renewable energy comes from sources that naturally replenish: solar, wind, hydroelectric, geothermal, and biomass. Unlike fossil fuels, they produce little to no greenhouse gas emissions.", category: "science", tags: ["energy", "renewable", "environment"] },

  { q: "What time is it?", a: "I can't check the current time for you, but you can see the time on your device. Time zones vary around the world — there are 24 standard time zones.", category: "general", tags: ["time"] },
  { q: "What day is it?", a: "I can't check today's date, but you can see it on your device. Fun fact: the international date line in the Pacific Ocean is where each new calendar day begins.", category: "general", tags: ["date", "day"] },
  { q: "What is the meaning of life?", a: "That's one of humanity's oldest questions! Philosophers, religions, and individuals have offered many answers. Some say it's about happiness, others about purpose or connection. What matters most is what gives your life meaning.", category: "philosophy", tags: ["meaning", "life", "philosophy"] },
  { q: "Who are you?", a: "I'm Juno, your AI communication assistant. I help people communicate across languages with real-time translation, encrypted messaging, and video calls. I'm always learning and growing my knowledge to serve you better.", category: "about", tags: ["juno", "identity", "about"] },
  { q: "What can you do?", a: "I can help with real-time translation across 50+ languages, answer general knowledge questions, assist with travel phrases, and support secure communication through encrypted calls and messaging. I'm continuously expanding my capabilities through my OSINT intelligence system.", category: "about", tags: ["juno", "capabilities", "features"] },
  { q: "What is JunoTalk?", a: "JunoTalk is an all-in-one communication platform featuring AI-powered voice translation in 50+ languages, end-to-end encrypted messaging, HD video and voice calls, and travel eSIM data worldwide. No phone number required to get started.", category: "about", tags: ["junotalk", "platform", "about"] },

  { q: "How do I say hello in Spanish?", a: "Hello in Spanish is 'Hola'. For a more formal greeting, you can say 'Buenos dias' (good morning), 'Buenas tardes' (good afternoon), or 'Buenas noches' (good evening).", category: "language", tags: ["hello", "spanish", "greeting"] },
  { q: "How do I say hello in French?", a: "Hello in French is 'Bonjour' (formal/daytime) or 'Salut' (casual). In the evening you can say 'Bonsoir'.", category: "language", tags: ["hello", "french", "greeting"] },
  { q: "How do I say hello in Japanese?", a: "Hello in Japanese is 'Konnichiwa' (こんにちは). In the morning say 'Ohayou gozaimasu' (おはようございます), and in the evening 'Konbanwa' (こんばんは).", category: "language", tags: ["hello", "japanese", "greeting"] },
  { q: "How do I say hello in Chinese?", a: "Hello in Mandarin Chinese is 'Ni hao' (你好). For a more polite version, say 'Nin hao' (您好).", category: "language", tags: ["hello", "chinese", "greeting"] },
  { q: "How do I say hello in Korean?", a: "Hello in Korean is 'Annyeonghaseyo' (안녕하세요) for polite/formal. Casually, you can say 'Annyeong' (안녕).", category: "language", tags: ["hello", "korean", "greeting"] },
  { q: "How do I say hello in Arabic?", a: "Hello in Arabic is 'Marhaba' (مرحبا) or the more traditional 'As-salamu alaykum' (السلام عليكم), meaning 'peace be upon you'.", category: "language", tags: ["hello", "arabic", "greeting"] },
  { q: "How do I say hello in German?", a: "Hello in German is 'Hallo'. More formally, 'Guten Tag' (good day), 'Guten Morgen' (good morning), or 'Guten Abend' (good evening).", category: "language", tags: ["hello", "german", "greeting"] },
  { q: "How do I say hello in Portuguese?", a: "Hello in Portuguese is 'Ola'. You can also say 'Bom dia' (good morning), 'Boa tarde' (good afternoon), or 'Boa noite' (good evening).", category: "language", tags: ["hello", "portuguese", "greeting"] },
  { q: "How do I say hello in Italian?", a: "Hello in Italian is 'Ciao' (casual) or 'Buongiorno' (formal/morning). In the afternoon say 'Buon pomeriggio' and in the evening 'Buonasera'.", category: "language", tags: ["hello", "italian", "greeting"] },
  { q: "How do I say hello in Russian?", a: "Hello in Russian is 'Privet' (Привет, casual) or 'Zdravstvuyte' (Здравствуйте, formal).", category: "language", tags: ["hello", "russian", "greeting"] },
  { q: "How do I say thank you in different languages?", a: "Thank you in various languages: Spanish 'Gracias', French 'Merci', German 'Danke', Italian 'Grazie', Portuguese 'Obrigado/Obrigada', Japanese 'Arigatou', Chinese 'Xie xie', Korean 'Gamsahamnida', Arabic 'Shukran', Russian 'Spasibo', Hindi 'Dhanyavaad'.", category: "language", tags: ["thank you", "multilingual"] },

  { q: "What should I know before traveling to Japan?", a: "Key tips for Japan: Bow as a greeting, remove shoes indoors, carry cash (many places don't accept cards), trains run exactly on time, tipping is not customary and can be considered rude, learn basic phrases like 'Sumimasen' (excuse me) and 'Arigatou' (thank you).", category: "travel", tags: ["japan", "travel", "culture"] },
  { q: "What should I know before traveling to China?", a: "Key tips for China: Download WeChat for payments and communication, carry a VPN for accessing Western apps, learn basic Mandarin phrases, bargaining is common in markets, tap water is not drinkable, and respect local customs around food sharing.", category: "travel", tags: ["china", "travel", "culture"] },
  { q: "What should I know before traveling to France?", a: "Key tips for France: Greet shopkeepers with 'Bonjour', learn basic French phrases (it's appreciated), tipping is included in bills but small tips are welcome, shops may close for lunch, and dress somewhat formally for restaurants.", category: "travel", tags: ["france", "travel", "culture"] },
  { q: "What should I know before traveling to Spain?", a: "Key tips for Spain: Lunch is the main meal (2-4 PM), dinner is late (9-11 PM), siesta time means some shops close in the afternoon, learn basic Spanish, tipping is not expected but appreciated, and public transportation is excellent.", category: "travel", tags: ["spain", "travel", "culture"] },
  { q: "What should I know before traveling to Germany?", a: "Key tips for Germany: Punctuality is important, many places are cash-only, recycling is taken seriously, shops are closed on Sundays, learn basic German phrases, and public transportation is reliable and efficient.", category: "travel", tags: ["germany", "travel", "culture"] },
  { q: "What should I know before traveling to South Korea?", a: "Key tips for South Korea: Download KakaoTalk (main messaging app), the subway system is excellent, tipping is not customary, age hierarchy is important in social interactions, try street food, and T-money cards work for all public transit.", category: "travel", tags: ["south korea", "travel", "culture"] },
  { q: "What should I know before traveling to Brazil?", a: "Key tips for Brazil: Learn basic Portuguese (not Spanish), be aware of safety in big cities, try local foods like feijoada and acai, Brazilians are warm and friendly, tipping 10% is standard, and Carnival season is February/March.", category: "travel", tags: ["brazil", "travel", "culture"] },

  { q: "What are common currencies?", a: "Major world currencies: US Dollar (USD), Euro (EUR), British Pound (GBP), Japanese Yen (JPY), Chinese Yuan (CNY), Swiss Franc (CHF), Canadian Dollar (CAD), Australian Dollar (AUD), Indian Rupee (INR), South Korean Won (KRW), Brazilian Real (BRL), Mexican Peso (MXN).", category: "general", tags: ["currency", "money", "finance"] },
  { q: "What is the European Union?", a: "The European Union (EU) is a political and economic union of 27 European countries. It enables free movement of people, goods, and services between member states. 20 EU countries use the Euro as their currency.", category: "general", tags: ["eu", "europe", "politics"] },

  { q: "How does translation work?", a: "Modern AI translation uses neural networks trained on billions of sentence pairs. The AI learns patterns between languages rather than using word-by-word substitution. This allows it to handle context, idioms, and grammar differences between languages.", category: "technology", tags: ["translation", "ai", "how it works"] },
  { q: "What is real-time translation?", a: "Real-time translation converts speech or text from one language to another almost instantly. It combines speech recognition, natural language processing, and text-to-speech to enable live cross-language communication.", category: "technology", tags: ["translation", "real-time"] },
  { q: "Is translation accurate?", a: "Modern AI translation is highly accurate for common languages and everyday conversation (90-95%+). Accuracy can vary with specialized terminology, slang, cultural expressions, and less common language pairs. JunoTalk uses multiple AI providers and quality checks to maximize accuracy.", category: "technology", tags: ["translation", "accuracy"] },
];

function normalizeForSearch(text: string): string {
  return text.toLowerCase()
    .replace(/[?!.,;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text).split(" ").filter(w => w.length > 2);
}

function calculateRelevance(query: string, entry: KnowledgeEntry): number {
  const normalizedQuery = normalizeForSearch(query);
  const normalizedQ = normalizeForSearch(entry.q);

  if (normalizedQuery === normalizedQ) return 1.0;

  if (normalizedQ.includes(normalizedQuery) || normalizedQuery.includes(normalizedQ)) return 0.9;

  const queryTokens = tokenize(query);
  const entryTokens = [...tokenize(entry.q), ...entry.tags];
  const matchCount = queryTokens.filter(qt => entryTokens.some(et => et.includes(qt) || qt.includes(et))).length;
  const score = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

  return Math.min(score * 0.8, 0.85);
}

export function searchKnowledge(query: string, limit = 5, minRelevance = 0.3): { entry: KnowledgeEntry; relevance: number }[] {
  const allEntries = [...GENERAL_KNOWLEDGE, ...knowledgeCache, ...scrapedCache];

  const scored = allEntries.map(entry => ({
    entry,
    relevance: calculateRelevance(query, entry),
  }));

  return scored
    .filter(s => s.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

export function answerQuestion(query: string): { answer: string; confidence: number; category: string; source: string } | null {
  const results = searchKnowledge(query, 1, 0.4);
  if (results.length === 0) return null;

  const best = results[0];
  return {
    answer: best.entry.a,
    confidence: best.relevance,
    category: best.entry.category,
    source: best.relevance > 0.85 ? "knowledge_base" : "knowledge_base_fuzzy",
  };
}

export async function loadGitHubKnowledge(): Promise<number> {
  if (Date.now() - knowledgeLastLoad < KNOWLEDGE_CACHE_TTL && knowledgeCache.length > 0) {
    return knowledgeCache.length;
  }

  try {
    const data = await fetchPrivateFile("knowledge/index.json") as KnowledgeEntry[];
    if (Array.isArray(data)) {
      knowledgeCache = data;
      knowledgeLastLoad = Date.now();
      console.log(`[JunoKnowledge] Loaded ${data.length} entries from GitHub`);
      return data.length;
    }
  } catch {
    console.warn("[JunoKnowledge] GitHub knowledge fetch failed, using built-in only");
  }

  return 0;
}

export async function pushKnowledgeToGitHub(entries?: KnowledgeEntry[]): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("[JunoKnowledge] No GITHUB_TOKEN, skipping push");
    return 0;
  }

  const allEntries = entries || GENERAL_KNOWLEDGE;

  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });

    const content = Buffer.from(JSON.stringify(allEntries, null, 2)).toString("base64");
    const filePath = "knowledge/index.json";

    let sha: string | undefined;
    try {
      const { data } = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
      });
      if ("sha" in data) sha = data.sha;
    } catch {}

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: `[Knowledge] Update Q&A base: ${allEntries.length} entries`,
      content,
      ...(sha ? { sha } : {}),
    });

    return allEntries.length;
  } catch (err: any) {
    console.error("[JunoKnowledge] GitHub push failed:", err.message);
    return 0;
  }
}

export async function loadScrapedKnowledge(): Promise<number> {
  if (Date.now() - scrapedLastLoad < SCRAPED_CACHE_TTL && scrapedCache.length > 0) {
    return scrapedCache.length;
  }

  try {
    const raw = await fetchPrivateFile("knowledge/scraped-data.json") as {
      timestamp: string;
      count: number;
      items: { title: string; body: string; link: string; source: string; category: string }[];
    };

    if (!raw || !Array.isArray(raw.items)) return 0;

    const sources = new Set<string>();
    scrapedCache = raw.items
      .filter(item => item.title || item.body)
      .map(item => {
        sources.add(item.source);
        const answer = item.body
          ? item.link ? `${item.body} [Source: ${item.link}]` : item.body
          : item.link;
        return {
          q: item.title || item.body.slice(0, 80),
          a: answer,
          category: item.category || item.source || "scraped",
          tags: [item.source, "scraped", item.category].filter(Boolean),
        } as KnowledgeEntry;
      });

    scrapedLastLoad = Date.now();
    scrapedTimestamp = raw.timestamp;
    scrapedSourceCount = sources.size;
    console.log(`[JunoKnowledge] Scraped data loaded: ${scrapedCache.length} items from ${scrapedSourceCount} source(s) (${raw.timestamp})`);
    return scrapedCache.length;
  } catch {
    // File not yet pushed from juno-data-engine — silently wait
    return 0;
  }
}

export function getKnowledgeStats() {
  const categories = new Map<string, number>();
  const allEntries = [...GENERAL_KNOWLEDGE, ...knowledgeCache, ...scrapedCache];

  for (const entry of allEntries) {
    categories.set(entry.category, (categories.get(entry.category) || 0) + 1);
  }

  return {
    builtIn: GENERAL_KNOWLEDGE.length,
    fromGitHub: knowledgeCache.length,
    fromScraper: scrapedCache.length,
    scraperSources: scrapedSourceCount,
    scraperLastPush: scrapedTimestamp,
    scraperLastLoad: scrapedLastLoad ? new Date(scrapedLastLoad).toISOString() : null,
    total: allEntries.length,
    categories: Object.fromEntries(categories),
    lastGitHubLoad: knowledgeLastLoad ? new Date(knowledgeLastLoad).toISOString() : null,
  };
}

export function getAllKnowledge(): KnowledgeEntry[] {
  return [...GENERAL_KNOWLEDGE, ...knowledgeCache, ...scrapedCache];
}

loadGitHubKnowledge().catch(() => {});
loadScrapedKnowledge().catch(() => {});
setInterval(() => loadGitHubKnowledge().catch(() => {}), KNOWLEDGE_CACHE_TTL);
setInterval(() => loadScrapedKnowledge().catch(() => {}), SCRAPED_CACHE_TTL);
