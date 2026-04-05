import { readFileSync, existsSync } from "fs";
import path from "path";

function resolveDataDir(): string {
  const dir = typeof __dirname !== "undefined" ? __dirname : (import.meta.dirname || process.cwd());
  const candidates = [
    path.join(dir, "vision-data"),
    path.resolve(process.cwd(), "server/vision-data"),
    path.resolve(process.cwd(), "dist/vision-data"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[1];
}

const DATA_DIR = resolveDataDir();

interface ObjectEntry {
  category: string;
  [lang: string]: string;
}

interface DetectionResult {
  objects: Array<{ label: string; confidence: number; bbox: number[] }>;
  text: string;
  primary: string | null;
  primary_confidence: number;
}

interface VisionResponse {
  label: string;
  translation: string;
  sentence: string;
  answer?: string;
  sourceLang: string;
  targetLang: string;
  confidence: number;
  method: "yolo" | "ocr" | "combined";
}

const LANG_NAMES: Record<string, Record<string, string>> = {
  en: { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi", ru: "Russian" },
  es: { en: "inglés", es: "español", fr: "francés", de: "alemán", it: "italiano", pt: "portugués", zh: "chino", ja: "japonés", ko: "coreano", ar: "árabe", hi: "hindi", ru: "ruso" },
  fr: { en: "anglais", es: "espagnol", fr: "français", de: "allemand", it: "italien", pt: "portugais", zh: "chinois", ja: "japonais", ko: "coréen", ar: "arabe", hi: "hindi", ru: "russe" },
  de: { en: "Englisch", es: "Spanisch", fr: "Französisch", de: "Deutsch", it: "Italienisch", pt: "Portugiesisch", zh: "Chinesisch", ja: "Japanisch", ko: "Koreanisch", ar: "Arabisch", hi: "Hindi", ru: "Russisch" },
};

let objectsDict: Record<string, ObjectEntry> = {};
let categoriesDict: Record<string, Record<string, string>> = {};
let templatesDict: Record<string, Record<string, string>> = {};
let loaded = false;

function loadData() {
  if (loaded) return;
  try {
    objectsDict = JSON.parse(readFileSync(path.join(DATA_DIR, "objects.json"), "utf-8"));
    categoriesDict = JSON.parse(readFileSync(path.join(DATA_DIR, "categories.json"), "utf-8"));
    templatesDict = JSON.parse(readFileSync(path.join(DATA_DIR, "templates.json"), "utf-8"));
    loaded = true;
    console.log(`[VisionKnowledge] Loaded ${Object.keys(objectsDict).length} objects, ${Object.keys(categoriesDict).length} categories, ${Object.keys(templatesDict).length} templates`);
  } catch (err: any) {
    console.error("[VisionKnowledge] Failed to load data:", err.message);
  }
}

function getLangName(targetLang: string, inLang: string): string {
  const names = LANG_NAMES[inLang] || LANG_NAMES["en"];
  return names?.[targetLang] || targetLang;
}

function lookupObject(key: string, lang: string): { word: string; category: string } | null {
  loadData();
  const entry = objectsDict[key];
  if (!entry) return null;
  const word = entry[lang] || entry["en"] || key;
  return { word, category: entry.category };
}

function getCategorySentence(category: string, lang: string): string {
  loadData();
  const cat = categoriesDict[category];
  if (!cat) return "";
  return cat[lang] || cat["en"] || "";
}

function getTemplate(templateKey: string, lang: string): string {
  loadData();
  const tmpl = templatesDict[templateKey];
  if (!tmpl) return "";
  return tmpl[lang] || tmpl["en"] || "";
}

function detectIntent(question: string): "what_is_this" | "translate" | "how_do_you_say" | "category" | "unknown" {
  const q = question.toLowerCase().trim();
  if (/what\s*(is|are)\s*(this|that|these|those)/i.test(q) || /qu[ée]\s*es\s*(esto|eso)/i.test(q) || /qu'est[- ]ce/i.test(q)) {
    return "what_is_this";
  }
  if (/how\s*do\s*you\s*say/i.test(q) || /c[oó]mo\s*se\s*dice/i.test(q) || /comment\s*dit[- ]on/i.test(q)) {
    return "how_do_you_say";
  }
  if (/translat/i.test(q) || /traduc/i.test(q)) {
    return "translate";
  }
  if (/categor/i.test(q) || /type|kind|sort/i.test(q)) {
    return "category";
  }
  return "unknown";
}

export function composeVisionResponse(
  detection: DetectionResult,
  sourceLang: string,
  targetLang: string,
  userQuestion?: string
): VisionResponse {
  loadData();

  const primaryLabel = detection.primary;

  if (!primaryLabel) {
    const template = getTemplate("unknown_object", targetLang);
    return {
      label: "unknown",
      translation: "unknown",
      sentence: template || "Object not recognized.",
      sourceLang,
      targetLang,
      confidence: 0,
      method: "yolo",
    };
  }

  const srcObj = lookupObject(primaryLabel, sourceLang);
  const tgtObj = lookupObject(primaryLabel, targetLang);

  const srcWord = srcObj?.word || primaryLabel;
  const tgtWord = tgtObj?.word || primaryLabel;
  const category = srcObj?.category || tgtObj?.category || "object";
  const confidence = detection.primary_confidence;

  if (userQuestion) {
    const intent = detectIntent(userQuestion);

    if (intent === "what_is_this") {
      const catSentenceTgt = getCategorySentence(category, targetLang);
      const catSentenceSrc = getCategorySentence(category, sourceLang);
      let sentenceTgt = getTemplate("what_is_this", targetLang);
      sentenceTgt = sentenceTgt.replace("{word}", tgtWord).replace("{category_sentence}", catSentenceTgt);
      let answerSrc = getTemplate("what_is_this", sourceLang);
      answerSrc = answerSrc.replace("{word}", srcWord).replace("{category_sentence}", catSentenceSrc);
      return {
        label: srcWord,
        translation: tgtWord,
        sentence: sentenceTgt,
        answer: answerSrc,
        sourceLang,
        targetLang,
        confidence,
        method: "yolo",
      };
    }

    if (intent === "how_do_you_say" || intent === "translate") {
      const langNameTgt = getLangName(targetLang, targetLang);
      const langNameSrc = getLangName(targetLang, sourceLang);
      let sentenceTgt = getTemplate("how_do_you_say", targetLang);
      sentenceTgt = sentenceTgt.replace("{lang_name}", langNameTgt).replace("{src_word}", srcWord).replace("{word}", tgtWord);
      let answerSrc = getTemplate("how_do_you_say", sourceLang);
      answerSrc = answerSrc.replace("{lang_name}", langNameSrc).replace("{src_word}", srcWord).replace("{word}", tgtWord);
      return {
        label: srcWord,
        translation: tgtWord,
        sentence: sentenceTgt,
        answer: answerSrc,
        sourceLang,
        targetLang,
        confidence,
        method: "yolo",
      };
    }

    if (intent === "category") {
      const catSentence = getCategorySentence(category, targetLang);
      return {
        label: srcWord,
        translation: tgtWord,
        sentence: catSentence,
        answer: getCategorySentence(category, sourceLang),
        sourceLang,
        targetLang,
        confidence,
        method: "yolo",
      };
    }

    const pointSentenceTgt = getTemplate("point_translate", targetLang).replace("{word}", tgtWord);
    const pointSentenceSrc = getTemplate("point_translate", sourceLang).replace("{word}", srcWord);
    const langNameSrc = getLangName(targetLang, sourceLang);
    return {
      label: srcWord,
      translation: tgtWord,
      sentence: pointSentenceTgt,
      answer: `${pointSentenceSrc} ${getTemplate("how_do_you_say", sourceLang).replace("{lang_name}", langNameSrc).replace("{src_word}", srcWord).replace("{word}", tgtWord)}`,
      sourceLang,
      targetLang,
      confidence,
      method: "yolo",
    };
  }

  if (detection.text && detection.text.length > 2) {
    const langName = getLangName(targetLang, targetLang);
    let template = getTemplate("text_detected", targetLang);
    template = template
      .replace("{text}", detection.text.slice(0, 100))
      .replace("{word}", tgtWord)
      .replace("{lang_name}", langName);
    return {
      label: srcWord,
      translation: tgtWord,
      sentence: template,
      sourceLang,
      targetLang,
      confidence,
      method: "combined",
    };
  }

  let sentence = getTemplate("point_translate", targetLang).replace("{word}", tgtWord);

  return {
    label: srcWord,
    translation: tgtWord,
    sentence,
    sourceLang,
    targetLang,
    confidence,
    method: "yolo",
  };
}

export function getVisionStats(): { objects: number; categories: number; templates: number; languages: string[] } {
  loadData();
  const langs = new Set<string>();
  for (const obj of Object.values(objectsDict)) {
    for (const key of Object.keys(obj)) {
      if (key !== "category" && key.length === 2) langs.add(key);
    }
  }
  return {
    objects: Object.keys(objectsDict).length,
    categories: Object.keys(categoriesDict).length,
    templates: Object.keys(templatesDict).length,
    languages: Array.from(langs).sort(),
  };
}
