import { fetchPrivateFile } from "./github-config";

export const COMMON_PHRASES: Record<string, Record<string, Record<string, string>>> = {
  en: {
    es: {
      "Hello": "Hola",
      "Hi": "Hola",
      "Good morning": "Buenos dias",
      "Good afternoon": "Buenas tardes",
      "Good evening": "Buenas noches",
      "Good night": "Buenas noches",
      "How are you?": "Como estas?",
      "I'm fine": "Estoy bien",
      "Thank you": "Gracias",
      "Thanks": "Gracias",
      "Please": "Por favor",
      "Yes": "Si",
      "No": "No",
      "Sorry": "Lo siento",
      "Excuse me": "Disculpe",
      "Goodbye": "Adios",
      "Bye": "Adios",
      "See you later": "Hasta luego",
      "Nice to meet you": "Mucho gusto",
      "What's your name?": "Como te llamas?",
      "My name is": "Me llamo",
      "I don't understand": "No entiendo",
      "Can you help me?": "Puedes ayudarme?",
      "Where is": "Donde esta",
      "How much?": "Cuanto cuesta?",
      "I love you": "Te amo",
      "I miss you": "Te extrano",
      "Good luck": "Buena suerte",
      "Happy birthday": "Feliz cumpleanos",
      "Congratulations": "Felicitaciones",
      "Take care": "Cuidate",
      "What time is it?": "Que hora es?",
      "I agree": "Estoy de acuerdo",
      "OK": "OK",
      "Of course": "Por supuesto",
      "No problem": "No hay problema",
      "I'm on my way": "Estoy en camino",
      "Call me": "Llamame",
      "Talk to you later": "Hablamos luego",
      "Be right back": "Vuelvo enseguida",
    },
    fr: {
      "Hello": "Bonjour",
      "Hi": "Salut",
      "Good morning": "Bonjour",
      "Good evening": "Bonsoir",
      "Good night": "Bonne nuit",
      "How are you?": "Comment allez-vous?",
      "I'm fine": "Je vais bien",
      "Thank you": "Merci",
      "Thanks": "Merci",
      "Please": "S'il vous plait",
      "Yes": "Oui",
      "No": "Non",
      "Sorry": "Desolee",
      "Goodbye": "Au revoir",
      "Bye": "Salut",
      "See you later": "A plus tard",
      "Nice to meet you": "Enchante",
      "I don't understand": "Je ne comprends pas",
      "Can you help me?": "Pouvez-vous m'aider?",
      "I love you": "Je t'aime",
      "I miss you": "Tu me manques",
      "Happy birthday": "Joyeux anniversaire",
      "Congratulations": "Felicitations",
      "Take care": "Prenez soin de vous",
      "No problem": "Pas de probleme",
      "OK": "D'accord",
      "Of course": "Bien sur",
      "Call me": "Appelez-moi",
      "Talk to you later": "On se parle plus tard",
      "Be right back": "Je reviens tout de suite",
    },
    zh: {
      "Hello": "你好",
      "Hi": "嗨",
      "Good morning": "早上好",
      "Good afternoon": "下午好",
      "Good evening": "晚上好",
      "Good night": "晚安",
      "How are you?": "你好吗?",
      "I'm fine": "我很好",
      "Thank you": "谢谢",
      "Thanks": "谢谢",
      "Please": "请",
      "Yes": "是",
      "No": "不是",
      "Sorry": "对不起",
      "Goodbye": "再见",
      "Bye": "拜拜",
      "See you later": "回头见",
      "Nice to meet you": "很高兴认识你",
      "I don't understand": "我不明白",
      "Can you help me?": "你能帮我吗?",
      "I love you": "我爱你",
      "I miss you": "我想你",
      "Happy birthday": "生日快乐",
      "Congratulations": "恭喜",
      "Take care": "保重",
      "No problem": "没问题",
      "OK": "好的",
      "Of course": "当然",
      "Call me": "打电话给我",
      "Be right back": "马上回来",
    },
    hi: {
      "Hello": "नमस्ते",
      "Hi": "नमस्ते",
      "Good morning": "सुप्रभात",
      "Good night": "शुभ रात्रि",
      "How are you?": "आप कैसे हैं?",
      "I'm fine": "मैं ठीक हूँ",
      "Thank you": "धन्यवाद",
      "Thanks": "शुक्रिया",
      "Please": "कृपया",
      "Yes": "हाँ",
      "No": "नहीं",
      "Sorry": "माफ़ कीजिए",
      "Goodbye": "अलविदा",
      "I don't understand": "मुझे समझ नहीं आया",
      "I love you": "मैं तुमसे प्यार करता हूँ",
      "Happy birthday": "जन्मदिन मुबारक",
      "No problem": "कोई बात नहीं",
      "OK": "ठीक है",
    },
    ar: {
      "Hello": "مرحبا",
      "Hi": "أهلا",
      "Good morning": "صباح الخير",
      "Good evening": "مساء الخير",
      "Good night": "تصبح على خير",
      "How are you?": "كيف حالك؟",
      "I'm fine": "أنا بخير",
      "Thank you": "شكرا لك",
      "Thanks": "شكرا",
      "Please": "من فضلك",
      "Yes": "نعم",
      "No": "لا",
      "Sorry": "آسف",
      "Goodbye": "مع السلامة",
      "I don't understand": "لا أفهم",
      "I love you": "أحبك",
      "Happy birthday": "عيد ميلاد سعيد",
      "No problem": "لا مشكلة",
      "OK": "حسنا",
    },
    de: {
      "Hello": "Hallo",
      "Hi": "Hi",
      "Good morning": "Guten Morgen",
      "Good evening": "Guten Abend",
      "Good night": "Gute Nacht",
      "How are you?": "Wie geht es Ihnen?",
      "I'm fine": "Mir geht es gut",
      "Thank you": "Danke",
      "Thanks": "Danke",
      "Please": "Bitte",
      "Yes": "Ja",
      "No": "Nein",
      "Sorry": "Entschuldigung",
      "Goodbye": "Auf Wiedersehen",
      "Bye": "Tschuess",
      "I don't understand": "Ich verstehe nicht",
      "I love you": "Ich liebe dich",
      "Happy birthday": "Alles Gute zum Geburtstag",
      "No problem": "Kein Problem",
      "OK": "OK",
    },
    ja: {
      "Hello": "こんにちは",
      "Hi": "やあ",
      "Good morning": "おはようございます",
      "Good evening": "こんばんは",
      "Good night": "おやすみなさい",
      "How are you?": "お元気ですか?",
      "I'm fine": "元気です",
      "Thank you": "ありがとうございます",
      "Thanks": "ありがとう",
      "Please": "お願いします",
      "Yes": "はい",
      "No": "いいえ",
      "Sorry": "すみません",
      "Goodbye": "さようなら",
      "Bye": "じゃあね",
      "I don't understand": "わかりません",
      "I love you": "愛しています",
      "Happy birthday": "お誕生日おめでとう",
      "No problem": "問題ありません",
    },
    ko: {
      "Hello": "안녕하세요",
      "Hi": "안녕",
      "Good morning": "좋은 아침이에요",
      "Good night": "잘 자요",
      "How are you?": "어떻게 지내세요?",
      "I'm fine": "잘 지내요",
      "Thank you": "감사합니다",
      "Thanks": "고마워요",
      "Please": "부탁합니다",
      "Yes": "네",
      "No": "아니요",
      "Sorry": "죄송합니다",
      "Goodbye": "안녕히 가세요",
      "I don't understand": "이해하지 못했어요",
      "I love you": "사랑해요",
      "Happy birthday": "생일 축하해요",
      "No problem": "괜찮아요",
    },
    pt: {
      "Hello": "Ola",
      "Hi": "Oi",
      "Good morning": "Bom dia",
      "Good afternoon": "Boa tarde",
      "Good evening": "Boa noite",
      "How are you?": "Como voce esta?",
      "I'm fine": "Estou bem",
      "Thank you": "Obrigado",
      "Thanks": "Obrigado",
      "Please": "Por favor",
      "Yes": "Sim",
      "No": "Nao",
      "Sorry": "Desculpe",
      "Goodbye": "Adeus",
      "Bye": "Tchau",
      "I don't understand": "Eu nao entendo",
      "I love you": "Eu te amo",
      "Happy birthday": "Feliz aniversario",
      "No problem": "Sem problema",
    },
    ru: {
      "Hello": "Здравствуйте",
      "Hi": "Привет",
      "Good morning": "Доброе утро",
      "Good evening": "Добрый вечер",
      "Good night": "Спокойной ночи",
      "How are you?": "Как дела?",
      "I'm fine": "Я в порядке",
      "Thank you": "Спасибо",
      "Thanks": "Спасибо",
      "Please": "Пожалуйста",
      "Yes": "Да",
      "No": "Нет",
      "Sorry": "Извините",
      "Goodbye": "До свидания",
      "Bye": "Пока",
      "I don't understand": "Я не понимаю",
      "I love you": "Я тебя люблю",
      "Happy birthday": "С днём рождения",
      "No problem": "Нет проблем",
    },
    it: {
      "Hello": "Ciao",
      "Hi": "Ciao",
      "Good morning": "Buongiorno",
      "Good evening": "Buonasera",
      "Good night": "Buonanotte",
      "How are you?": "Come stai?",
      "I'm fine": "Sto bene",
      "Thank you": "Grazie",
      "Thanks": "Grazie",
      "Please": "Per favore",
      "Yes": "Si",
      "No": "No",
      "Sorry": "Mi dispiace",
      "Goodbye": "Arrivederci",
      "Bye": "Ciao",
      "I don't understand": "Non capisco",
      "I love you": "Ti amo",
      "Happy birthday": "Buon compleanno",
      "No problem": "Nessun problema",
    },
    tr: {
      "Hello": "Merhaba",
      "Hi": "Selam",
      "Good morning": "Gunaydin",
      "Good night": "Iyi geceler",
      "How are you?": "Nasilsiniz?",
      "I'm fine": "Iyiyim",
      "Thank you": "Tesekkur ederim",
      "Thanks": "Sagol",
      "Yes": "Evet",
      "No": "Hayir",
      "Sorry": "Ozur dilerim",
      "Goodbye": "Hosca kalin",
      "I love you": "Seni seviyorum",
      "Happy birthday": "Dogum gunun kutlu olsun",
      "No problem": "Sorun yok",
    },
  },
  es: {
    en: {
      "Hola": "Hello",
      "Buenos dias": "Good morning",
      "Buenas tardes": "Good afternoon",
      "Buenas noches": "Good evening",
      "Como estas?": "How are you?",
      "Estoy bien": "I'm fine",
      "Gracias": "Thank you",
      "Por favor": "Please",
      "Si": "Yes",
      "No": "No",
      "Lo siento": "Sorry",
      "Adios": "Goodbye",
      "Hasta luego": "See you later",
      "Te amo": "I love you",
      "Te extrano": "I miss you",
      "Feliz cumpleanos": "Happy birthday",
      "No hay problema": "No problem",
      "Estoy en camino": "I'm on my way",
      "Llamame": "Call me",
    },
  },
  fr: {
    en: {
      "Bonjour": "Hello",
      "Salut": "Hi",
      "Bonsoir": "Good evening",
      "Bonne nuit": "Good night",
      "Comment allez-vous?": "How are you?",
      "Je vais bien": "I'm fine",
      "Merci": "Thank you",
      "S'il vous plait": "Please",
      "Oui": "Yes",
      "Non": "No",
      "Desolee": "Sorry",
      "Au revoir": "Goodbye",
      "Je t'aime": "I love you",
      "Tu me manques": "I miss you",
      "Joyeux anniversaire": "Happy birthday",
      "Pas de probleme": "No problem",
      "D'accord": "OK",
    },
  },
  zh: {
    en: {
      "你好": "Hello",
      "嗨": "Hi",
      "早上好": "Good morning",
      "下午好": "Good afternoon",
      "晚上好": "Good evening",
      "晚安": "Good night",
      "你好吗?": "How are you?",
      "我很好": "I'm fine",
      "谢谢": "Thank you",
      "请": "Please",
      "是": "Yes",
      "不是": "No",
      "对不起": "Sorry",
      "再见": "Goodbye",
      "拜拜": "Bye",
      "我不明白": "I don't understand",
      "我爱你": "I love you",
      "我想你": "I miss you",
      "生日快乐": "Happy birthday",
      "没问题": "No problem",
      "好的": "OK",
      "马上回来": "Be right back",
    },
  },
  ar: {
    en: {
      "مرحبا": "Hello",
      "أهلا": "Hi",
      "صباح الخير": "Good morning",
      "مساء الخير": "Good evening",
      "كيف حالك؟": "How are you?",
      "أنا بخير": "I'm fine",
      "شكرا": "Thanks",
      "شكرا لك": "Thank you",
      "نعم": "Yes",
      "لا": "No",
      "آسف": "Sorry",
      "مع السلامة": "Goodbye",
      "أحبك": "I love you",
      "عيد ميلاد سعيد": "Happy birthday",
      "لا مشكلة": "No problem",
    },
  },
  hi: {
    en: {
      "नमस्ते": "Hello",
      "सुप्रभात": "Good morning",
      "आप कैसे हैं?": "How are you?",
      "मैं ठीक हूँ": "I'm fine",
      "धन्यवाद": "Thank you",
      "शुक्रिया": "Thanks",
      "कृपया": "Please",
      "हाँ": "Yes",
      "नहीं": "No",
      "माफ़ कीजिए": "Sorry",
      "अलविदा": "Goodbye",
      "मैं तुमसे प्यार करता हूँ": "I love you",
      "जन्मदिन मुबारक": "Happy birthday",
      "कोई बात नहीं": "No problem",
      "ठीक है": "OK",
    },
  },
  de: {
    en: {
      "Hallo": "Hello",
      "Guten Morgen": "Good morning",
      "Guten Abend": "Good evening",
      "Gute Nacht": "Good night",
      "Wie geht es Ihnen?": "How are you?",
      "Mir geht es gut": "I'm fine",
      "Danke": "Thank you",
      "Bitte": "Please",
      "Ja": "Yes",
      "Nein": "No",
      "Entschuldigung": "Sorry",
      "Auf Wiedersehen": "Goodbye",
      "Tschuess": "Bye",
      "Ich verstehe nicht": "I don't understand",
      "Ich liebe dich": "I love you",
      "Alles Gute zum Geburtstag": "Happy birthday",
      "Kein Problem": "No problem",
    },
  },
  pt: {
    en: {
      "Ola": "Hello",
      "Oi": "Hi",
      "Bom dia": "Good morning",
      "Boa tarde": "Good afternoon",
      "Boa noite": "Good evening",
      "Como voce esta?": "How are you?",
      "Estou bem": "I'm fine",
      "Obrigado": "Thank you",
      "Por favor": "Please",
      "Sim": "Yes",
      "Nao": "No",
      "Desculpe": "Sorry",
      "Adeus": "Goodbye",
      "Tchau": "Bye",
      "Eu nao entendo": "I don't understand",
      "Eu te amo": "I love you",
      "Feliz aniversario": "Happy birthday",
      "Sem problema": "No problem",
    },
  },
  ru: {
    en: {
      "Здравствуйте": "Hello",
      "Привет": "Hi",
      "Доброе утро": "Good morning",
      "Добрый вечер": "Good evening",
      "Спокойной ночи": "Good night",
      "Как дела?": "How are you?",
      "Я в порядке": "I'm fine",
      "Спасибо": "Thank you",
      "Пожалуйста": "Please",
      "Да": "Yes",
      "Нет": "No",
      "Извините": "Sorry",
      "До свидания": "Goodbye",
      "Пока": "Bye",
      "Я не понимаю": "I don't understand",
      "Я тебя люблю": "I love you",
      "С днём рождения": "Happy birthday",
      "Нет проблем": "No problem",
    },
  },
  ja: {
    en: {
      "こんにちは": "Hello",
      "おはようございます": "Good morning",
      "こんばんは": "Good evening",
      "おやすみなさい": "Good night",
      "お元気ですか?": "How are you?",
      "元気です": "I'm fine",
      "ありがとうございます": "Thank you",
      "ありがとう": "Thanks",
      "お願いします": "Please",
      "はい": "Yes",
      "いいえ": "No",
      "すみません": "Sorry",
      "さようなら": "Goodbye",
      "じゃあね": "Bye",
      "わかりません": "I don't understand",
      "愛しています": "I love you",
      "お誕生日おめでとう": "Happy birthday",
      "問題ありません": "No problem",
    },
  },
  ko: {
    en: {
      "안녕하세요": "Hello",
      "안녕": "Hi",
      "좋은 아침이에요": "Good morning",
      "잘 자요": "Good night",
      "어떻게 지내세요?": "How are you?",
      "잘 지내요": "I'm fine",
      "감사합니다": "Thank you",
      "고마워요": "Thanks",
      "부탁합니다": "Please",
      "네": "Yes",
      "아니요": "No",
      "죄송합니다": "Sorry",
      "안녕히 가세요": "Goodbye",
      "이해하지 못했어요": "I don't understand",
      "사랑해요": "I love you",
      "생일 축하해요": "Happy birthday",
      "괜찮아요": "No problem",
    },
  },
  it: {
    en: {
      "Ciao": "Hello",
      "Buongiorno": "Good morning",
      "Buonasera": "Good evening",
      "Buonanotte": "Good night",
      "Come stai?": "How are you?",
      "Sto bene": "I'm fine",
      "Grazie": "Thank you",
      "Per favore": "Please",
      "Si": "Yes",
      "No": "No",
      "Mi dispiace": "Sorry",
      "Arrivederci": "Goodbye",
      "Non capisco": "I don't understand",
      "Ti amo": "I love you",
      "Buon compleanno": "Happy birthday",
      "Nessun problema": "No problem",
    },
  },
  tr: {
    en: {
      "Merhaba": "Hello",
      "Selam": "Hi",
      "Gunaydin": "Good morning",
      "Iyi geceler": "Good night",
      "Nasilsiniz?": "How are you?",
      "Iyiyim": "I'm fine",
      "Tesekkur ederim": "Thank you",
      "Sagol": "Thanks",
      "Evet": "Yes",
      "Hayir": "No",
      "Ozur dilerim": "Sorry",
      "Hosca kalin": "Goodbye",
      "Seni seviyorum": "I love you",
      "Dogum gunun kutlu olsun": "Happy birthday",
      "Sorun yok": "No problem",
    },
  },
};

export let githubFallbackCache: Record<string, Record<string, Record<string, string>>> = {};
let githubLastFetch = 0;
const GITHUB_CACHE_TTL = 60 * 60 * 1000;
let githubFetchInProgress = false;

function stripPunctuation(s: string): string {
  return s.replace(/[?!.,;:]+$/g, "").trim();
}

export function lookupFallbackPhrase(text: string, sourceLang: string, targetLang: string): string | null {
  const normalized = text.trim();

  const local = COMMON_PHRASES[sourceLang]?.[targetLang]?.[normalized];
  if (local) return local;

  const github = githubFallbackCache[sourceLang]?.[targetLang]?.[normalized];
  if (github) return github;

  const lowerNormalized = normalized.toLowerCase();
  const stripped = stripPunctuation(lowerNormalized);

  const allSources = [
    COMMON_PHRASES[sourceLang]?.[targetLang],
    githubFallbackCache[sourceLang]?.[targetLang],
  ];

  for (const pairs of allSources) {
    if (!pairs) continue;
    for (const [key, val] of Object.entries(pairs)) {
      const keyLower = key.toLowerCase();
      if (keyLower === lowerNormalized) return val;
      if (stripPunctuation(keyLower) === stripped) return val;
    }
  }

  return null;
}

interface GithubManifestPair {
  src: string;
  tgt: string;
  file: string;
  count?: number;
}

interface GithubManifest {
  version?: number;
  updated?: string;
  pairs?: GithubManifestPair[];
}

export async function refreshGithubFallback(): Promise<boolean> {
  if (githubFetchInProgress) return false;
  if (Date.now() - githubLastFetch < GITHUB_CACHE_TTL && Object.keys(githubFallbackCache).length > 0) return true;

  githubFetchInProgress = true;
  try {
    const manifest = await fetchPrivateFile("data/index.json") as GithubManifest;

    if (!manifest || !Array.isArray(manifest.pairs) || manifest.pairs.length === 0) {
      console.warn("[TranslationFallback] GitHub manifest missing or empty");
      return false;
    }

    const built: Record<string, Record<string, Record<string, string>>> = {};
    let totalPhrases = 0;
    let loadedPairs = 0;

    await Promise.all(
      manifest.pairs.map(async (pair) => {
        try {
          const phrases = await fetchPrivateFile(`data/${pair.file}`) as Record<string, string>;
          if (!phrases || typeof phrases !== "object") return;

          if (!built[pair.src]) built[pair.src] = {};
          if (!built[pair.src][pair.tgt]) built[pair.src][pair.tgt] = {};
          Object.assign(built[pair.src][pair.tgt], phrases);

          totalPhrases += Object.keys(phrases).length;
          loadedPairs++;
        } catch {
          console.warn(`[TranslationFallback] Failed to load ${pair.file}`);
        }
      })
    );

    if (loadedPairs > 0) {
      githubFallbackCache = built;
      githubLastFetch = Date.now();
      const srcLangs = Object.keys(built).length;
      console.log(`[TranslationFallback] GitHub data loaded: ${srcLangs} source languages, ${loadedPairs} language pairs, ${totalPhrases} phrases`);
      return true;
    }

    return false;
  } catch (err) {
    console.warn("[TranslationFallback] GitHub fetch failed, using local data only");
    return false;
  } finally {
    githubFetchInProgress = false;
  }
}

export function getFallbackStats() {
  const localPairCount = Object.entries(COMMON_PHRASES).reduce((sum, [, targets]) => {
    return sum + Object.entries(targets).reduce((s, [, phrases]) => s + Object.keys(phrases).length, 0);
  }, 0);
  const githubPairCount = Object.entries(githubFallbackCache).reduce((sum, [, targets]) => {
    return sum + Object.entries(targets).reduce((s, [, phrases]) => s + Object.keys(phrases).length, 0);
  }, 0);
  return {
    localLanguages: Object.keys(COMMON_PHRASES).length,
    localPhrases: localPairCount,
    githubLanguages: Object.keys(githubFallbackCache).length,
    githubPhrases: githubPairCount,
    githubLastFetch: githubLastFetch ? new Date(githubLastFetch).toISOString() : null,
  };
}

refreshGithubFallback().catch(() => {});
setInterval(() => refreshGithubFallback().catch(() => {}), GITHUB_CACHE_TTL);
