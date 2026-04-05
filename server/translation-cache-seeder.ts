/**
 * Translation Cache Seeder
 *
 * Pre-seeds the L3 / L1 translation cache with a curated set of high-frequency
 * phrase pairs at startup so the first users never hit a cold cache.
 *
 * All translations are hardcoded and verified — zero API calls needed.
 * Cache key matches the format used in routes.ts:
 *   sha256(`${targetLang}:${sourceText}`) → translated text
 *   stored under namespace "translations"
 */

import crypto from "crypto";
import { cacheSet, cacheGet } from "./cache-layer";

const TTL_7D = 7 * 24 * 60 * 60 * 1000;

// Curated phrase translations: [sourceText, targetLang, translatedText]
const SEED_PHRASES: [string, string, string][] = [
  // Spanish
  ["Hello", "es", "Hola"],
  ["Hi", "es", "Hola"],
  ["Goodbye", "es", "Adiós"],
  ["Good morning", "es", "Buenos días"],
  ["Good night", "es", "Buenas noches"],
  ["Thank you", "es", "Gracias"],
  ["Thank you very much", "es", "Muchas gracias"],
  ["You're welcome", "es", "De nada"],
  ["Please", "es", "Por favor"],
  ["Sorry", "es", "Lo siento"],
  ["Excuse me", "es", "Perdona"],
  ["How are you?", "es", "¿Cómo estás?"],
  ["I'm fine, thanks", "es", "Estoy bien, gracias"],
  ["What's your name?", "es", "¿Cómo te llamas?"],
  ["My name is", "es", "Me llamo"],
  ["Yes", "es", "Sí"],
  ["No", "es", "No"],
  ["Help", "es", "Ayuda"],
  ["I don't understand", "es", "No entiendo"],
  ["Do you speak English?", "es", "¿Hablas inglés?"],

  // French
  ["Hello", "fr", "Bonjour"],
  ["Hi", "fr", "Salut"],
  ["Goodbye", "fr", "Au revoir"],
  ["Good morning", "fr", "Bonjour"],
  ["Good night", "fr", "Bonne nuit"],
  ["Thank you", "fr", "Merci"],
  ["Thank you very much", "fr", "Merci beaucoup"],
  ["You're welcome", "fr", "De rien"],
  ["Please", "fr", "S'il vous plaît"],
  ["Sorry", "fr", "Désolé"],
  ["Excuse me", "fr", "Excusez-moi"],
  ["How are you?", "fr", "Comment allez-vous ?"],
  ["I'm fine, thanks", "fr", "Je vais bien, merci"],
  ["Yes", "fr", "Oui"],
  ["No", "fr", "Non"],
  ["Help", "fr", "Aide"],
  ["I don't understand", "fr", "Je ne comprends pas"],

  // German
  ["Hello", "de", "Hallo"],
  ["Hi", "de", "Hallo"],
  ["Goodbye", "de", "Auf Wiedersehen"],
  ["Good morning", "de", "Guten Morgen"],
  ["Good night", "de", "Gute Nacht"],
  ["Thank you", "de", "Danke"],
  ["Thank you very much", "de", "Vielen Dank"],
  ["You're welcome", "de", "Bitte"],
  ["Please", "de", "Bitte"],
  ["Sorry", "de", "Es tut mir leid"],
  ["Excuse me", "de", "Entschuldigung"],
  ["How are you?", "de", "Wie geht es Ihnen?"],
  ["Yes", "de", "Ja"],
  ["No", "de", "Nein"],
  ["Help", "de", "Hilfe"],
  ["I don't understand", "de", "Ich verstehe nicht"],

  // Portuguese
  ["Hello", "pt", "Olá"],
  ["Hi", "pt", "Oi"],
  ["Goodbye", "pt", "Adeus"],
  ["Good morning", "pt", "Bom dia"],
  ["Good night", "pt", "Boa noite"],
  ["Thank you", "pt", "Obrigado"],
  ["Thank you very much", "pt", "Muito obrigado"],
  ["You're welcome", "pt", "De nada"],
  ["Please", "pt", "Por favor"],
  ["Sorry", "pt", "Desculpe"],
  ["How are you?", "pt", "Como você está?"],
  ["Yes", "pt", "Sim"],
  ["No", "pt", "Não"],
  ["Help", "pt", "Ajuda"],
  ["I don't understand", "pt", "Não entendo"],

  // Japanese
  ["Hello", "ja", "こんにちは"],
  ["Hi", "ja", "やあ"],
  ["Goodbye", "ja", "さようなら"],
  ["Good morning", "ja", "おはようございます"],
  ["Good night", "ja", "おやすみなさい"],
  ["Thank you", "ja", "ありがとう"],
  ["Thank you very much", "ja", "ありがとうございます"],
  ["You're welcome", "ja", "どういたしまして"],
  ["Please", "ja", "お願いします"],
  ["Sorry", "ja", "すみません"],
  ["How are you?", "ja", "お元気ですか？"],
  ["Yes", "ja", "はい"],
  ["No", "ja", "いいえ"],
  ["Help", "ja", "ヘルプ"],
  ["I don't understand", "ja", "わかりません"],

  // Chinese (Simplified)
  ["Hello", "zh", "你好"],
  ["Hi", "zh", "嗨"],
  ["Goodbye", "zh", "再见"],
  ["Good morning", "zh", "早上好"],
  ["Good night", "zh", "晚安"],
  ["Thank you", "zh", "谢谢"],
  ["Thank you very much", "zh", "非常感谢"],
  ["You're welcome", "zh", "不客气"],
  ["Please", "zh", "请"],
  ["Sorry", "zh", "对不起"],
  ["How are you?", "zh", "你好吗？"],
  ["Yes", "zh", "是的"],
  ["No", "zh", "不"],
  ["Help", "zh", "帮助"],
  ["I don't understand", "zh", "我不明白"],

  // Arabic
  ["Hello", "ar", "مرحبا"],
  ["Goodbye", "ar", "وداعا"],
  ["Good morning", "ar", "صباح الخير"],
  ["Good night", "ar", "تصبح على خير"],
  ["Thank you", "ar", "شكراً"],
  ["Thank you very much", "ar", "شكراً جزيلاً"],
  ["You're welcome", "ar", "على الرحب والسعة"],
  ["Please", "ar", "من فضلك"],
  ["Sorry", "ar", "آسف"],
  ["Yes", "ar", "نعم"],
  ["No", "ar", "لا"],
  ["Help", "ar", "مساعدة"],

  // Italian
  ["Hello", "it", "Ciao"],
  ["Goodbye", "it", "Arrivederci"],
  ["Good morning", "it", "Buongiorno"],
  ["Good night", "it", "Buonanotte"],
  ["Thank you", "it", "Grazie"],
  ["Thank you very much", "it", "Grazie mille"],
  ["You're welcome", "it", "Prego"],
  ["Please", "it", "Per favore"],
  ["Sorry", "it", "Mi dispiace"],
  ["Yes", "it", "Sì"],
  ["No", "it", "No"],
  ["Help", "it", "Aiuto"],
  ["I don't understand", "it", "Non capisco"],

  // Russian
  ["Hello", "ru", "Привет"],
  ["Goodbye", "ru", "До свидания"],
  ["Good morning", "ru", "Доброе утро"],
  ["Good night", "ru", "Спокойной ночи"],
  ["Thank you", "ru", "Спасибо"],
  ["Thank you very much", "ru", "Большое спасибо"],
  ["You're welcome", "ru", "Пожалуйста"],
  ["Please", "ru", "Пожалуйста"],
  ["Sorry", "ru", "Извините"],
  ["Yes", "ru", "Да"],
  ["No", "ru", "Нет"],
  ["Help", "ru", "Помощь"],
  ["I don't understand", "ru", "Я не понимаю"],

  // Korean
  ["Hello", "ko", "안녕하세요"],
  ["Goodbye", "ko", "안녕히 가세요"],
  ["Good morning", "ko", "좋은 아침"],
  ["Good night", "ko", "잘 자요"],
  ["Thank you", "ko", "감사합니다"],
  ["Thank you very much", "ko", "정말 감사합니다"],
  ["You're welcome", "ko", "천만에요"],
  ["Please", "ko", "부탁드립니다"],
  ["Sorry", "ko", "죄송합니다"],
  ["Yes", "ko", "네"],
  ["No", "ko", "아니요"],
  ["Help", "ko", "도움"],
  ["I don't understand", "ko", "이해하지 못합니다"],
];

export async function seedTranslationCache(): Promise<void> {
  let seeded = 0;
  let skipped = 0;

  for (const [sourceText, targetLang, translation] of SEED_PHRASES) {
    try {
      const keyHash = crypto.createHash("sha256")
        .update(`${targetLang}:${sourceText}`)
        .digest("hex");
      const cacheKey = `${targetLang}:${keyHash}`;

      const existing = await cacheGet("translations", cacheKey);
      if (existing) { skipped++; continue; }

      await cacheSet("translations", cacheKey, translation, TTL_7D);
      seeded++;
    } catch {
      // Non-fatal — skip this entry
    }
  }

  if (seeded > 0) {
    console.log(`[TranslationSeeder] Seeded ${seeded} curated phrase translations into cache (${skipped} already cached)`);
  }
}
