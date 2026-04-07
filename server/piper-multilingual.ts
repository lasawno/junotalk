import { existsSync, mkdirSync, createWriteStream } from "fs";
import { readdir, unlink } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

// Store models in /tmp — ephemeral, excluded from deployment images.
// Downloaded from Hugging Face on first use per language.
const MODELS_DIR = process.env.PIPER_MODELS_DIR || "/tmp/piper-models";
const PIPER_GITHUB = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0";

export interface PiperVoiceConfig {
  lang: string;
  model: string;
  quality: string;
  files: { onnx: string; json: string };
}

const VOICE_REGISTRY: Record<string, PiperVoiceConfig> = {
  en: { lang: "en", model: "en_US-amy-medium", quality: "medium", files: { onnx: "en/en_US/amy/medium/en_US-amy-medium.onnx", json: "en/en_US/amy/medium/en_US-amy-medium.onnx.json" } },
  es: { lang: "es", model: "es_ES-davefx-medium", quality: "medium", files: { onnx: "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx", json: "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json" } },
  fr: { lang: "fr", model: "fr_FR-siwis-medium", quality: "medium", files: { onnx: "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx", json: "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json" } },
  de: { lang: "de", model: "de_DE-thorsten-medium", quality: "medium", files: { onnx: "de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx", json: "de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json" } },
  it: { lang: "it", model: "it_IT-riccardo-x_low", quality: "x_low", files: { onnx: "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx", json: "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json" } },
  pt: { lang: "pt", model: "pt_BR-faber-medium", quality: "medium", files: { onnx: "pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx", json: "pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json" } },
  ru: { lang: "ru", model: "ru_RU-irina-medium", quality: "medium", files: { onnx: "ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx", json: "ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json" } },
  nl: { lang: "nl", model: "nl_NL-mls-medium", quality: "medium", files: { onnx: "nl/nl_NL/mls/medium/nl_NL-mls-medium.onnx", json: "nl/nl_NL/mls/medium/nl_NL-mls-medium.onnx.json" } },
  pl: { lang: "pl", model: "pl_PL-darkman-medium", quality: "medium", files: { onnx: "pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx", json: "pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json" } },
  tr: { lang: "tr", model: "tr_TR-dfki-medium", quality: "medium", files: { onnx: "tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx", json: "tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json" } },
  cs: { lang: "cs", model: "cs_CZ-jirka-medium", quality: "medium", files: { onnx: "cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx", json: "cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx.json" } },
  uk: { lang: "uk", model: "uk_UA-ukrainian_tts-medium", quality: "medium", files: { onnx: "uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx", json: "uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx.json" } },
  el: { lang: "el", model: "el_GR-rapunzelina-low", quality: "low", files: { onnx: "el/el_GR/rapunzelina/low/el_GR-rapunzelina-low.onnx", json: "el/el_GR/rapunzelina/low/el_GR-rapunzelina-low.onnx.json" } },
  fi: { lang: "fi", model: "fi_FI-harri-medium", quality: "medium", files: { onnx: "fi/fi_FI/harri/medium/fi_FI-harri-medium.onnx", json: "fi/fi_FI/harri/medium/fi_FI-harri-medium.onnx.json" } },
  sv: { lang: "sv", model: "sv_SE-nst-medium", quality: "medium", files: { onnx: "sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx", json: "sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx.json" } },
  da: { lang: "da", model: "da_DK-talesyntese-medium", quality: "medium", files: { onnx: "da/da_DK/talesyntese/medium/da_DK-talesyntese-medium.onnx", json: "da/da_DK/talesyntese/medium/da_DK-talesyntese-medium.onnx.json" } },
  no: { lang: "no", model: "no_NO-talesyntese-medium", quality: "medium", files: { onnx: "no/no_NO/talesyntese/medium/no_NO-talesyntese-medium.onnx", json: "no/no_NO/talesyntese/medium/no_NO-talesyntese-medium.onnx.json" } },
  ro: { lang: "ro", model: "ro_RO-mihai-medium", quality: "medium", files: { onnx: "ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx", json: "ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx.json" } },
  hu: { lang: "hu", model: "hu_HU-anna-medium", quality: "medium", files: { onnx: "hu/hu_HU/anna/medium/hu_HU-anna-medium.onnx", json: "hu/hu_HU/anna/medium/hu_HU-anna-medium.onnx.json" } },
  vi: { lang: "vi", model: "vi_VN-vivos-x_low", quality: "x_low", files: { onnx: "vi/vi_VN/vivos/x_low/vi_VN-vivos-x_low.onnx", json: "vi/vi_VN/vivos/x_low/vi_VN-vivos-x_low.onnx.json" } },
};

// All languages use OpenAI TTS exclusively — Piper is disabled system-wide.
// OpenAI TTS is natural and non-robotic; Piper is kept here only for reference
// but shouldUsePiper() always returns false.
const OPENAI_ONLY_LANGS = new Set(Object.keys(VOICE_REGISTRY).concat(["en", "zh", "ja", "ko", "ar", "hi", "th", "he", "fa", "bn", "ta", "ur"]));

const downloadInProgress = new Set<string>();
const availableModels = new Set<string>();

function isModelAvailable(lang: string): boolean {
  const config = VOICE_REGISTRY[lang];
  if (!config) return false;
  if (availableModels.has(lang)) return true;

  const modelPath = path.join(MODELS_DIR, config.model);
  const configPath = path.join(MODELS_DIR, `${config.model}.json`);
  const exists = existsSync(modelPath) && existsSync(configPath);
  if (exists) availableModels.add(lang);
  return exists;
}

async function downloadModel(lang: string): Promise<boolean> {
  const config = VOICE_REGISTRY[lang];
  if (!config) return false;
  if (isModelAvailable(lang)) return true;
  if (downloadInProgress.has(lang)) return false;

  downloadInProgress.add(lang);
  console.log(`[PiperMulti] Downloading voice model for ${lang}: ${config.model}...`);

  try {
    if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });

    const onnxUrl = `${PIPER_GITHUB}/${config.files.onnx}`;
    const jsonUrl = `${PIPER_GITHUB}/${config.files.json}`;

    const modelPath = path.join(MODELS_DIR, config.model);
    const configPath = path.join(MODELS_DIR, `${config.model}.json`);

    const [onnxResp, jsonResp] = await Promise.all([
      fetch(onnxUrl, { signal: AbortSignal.timeout(120000) }),
      fetch(jsonUrl, { signal: AbortSignal.timeout(30000) }),
    ]);

    if (!onnxResp.ok || !jsonResp.ok) {
      console.error(`[PiperMulti] Download failed for ${lang}: onnx=${onnxResp.status}, json=${jsonResp.status}`);
      return false;
    }

    const onnxBody = onnxResp.body;
    const jsonBody = jsonResp.body;
    if (!onnxBody || !jsonBody) return false;

    await Promise.all([
      pipeline(Readable.fromWeb(onnxBody as any), createWriteStream(modelPath)),
      pipeline(Readable.fromWeb(jsonBody as any), createWriteStream(configPath)),
    ]);

    availableModels.add(lang);
    console.log(`[PiperMulti] Voice model ready: ${config.model}`);
    return true;
  } catch (err: any) {
    console.error(`[PiperMulti] Download failed for ${lang}:`, err.message);
    try {
      const modelPath = path.join(MODELS_DIR, config.model);
      const configPath = path.join(MODELS_DIR, `${config.model}.json`);
      if (existsSync(modelPath)) await unlink(modelPath);
      if (existsSync(configPath)) await unlink(configPath);
    } catch {}
    return false;
  } finally {
    downloadInProgress.delete(lang);
  }
}

export function shouldUsePiper(_lang: string): boolean {
  // Piper disabled system-wide — all TTS goes through OpenAI
  return false;
}

export function isPiperModelReady(lang: string): boolean {
  return isModelAvailable(lang);
}

export async function ensurePiperModel(lang: string): Promise<boolean> {
  if (isModelAvailable(lang)) return true;
  if (!VOICE_REGISTRY[lang]) return false;
  return downloadModel(lang);
}

export function getPiperModelName(lang: string): string | null {
  return VOICE_REGISTRY[lang]?.model || null;
}

export function getPiperStats(): {
  registered: number;
  available: number;
  openaiOnly: number;
  languages: Record<string, { model: string; ready: boolean; quality: string }>;
} {
  const languages: Record<string, { model: string; ready: boolean; quality: string }> = {};

  for (const [lang, config] of Object.entries(VOICE_REGISTRY)) {
    languages[lang] = {
      model: config.model,
      ready: isModelAvailable(lang),
      quality: config.quality,
    };
  }

  return {
    registered: Object.keys(VOICE_REGISTRY).length,
    available: availableModels.size,
    openaiOnly: OPENAI_ONLY_LANGS.size,
    languages,
  };
}

export function getSupportedPiperLangs(): string[] {
  return Object.keys(VOICE_REGISTRY);
}

export function getOpenAIOnlyLangs(): string[] {
  return [...OPENAI_ONLY_LANGS];
}
