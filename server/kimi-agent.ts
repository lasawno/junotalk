import { gatewayRequest } from "./ai-gateway";

interface MonitorResult {
  finalTranslation: string;
  wasAdjusted: boolean;
  issues: string[];
}

const MONITOR_PROMPT = `You are a silent quality-control monitor for a live voice translation system. You receive:
- The original spoken text
- The source language
- The target language
- The translation produced by another AI

Your job: evaluate whether the translation is accurate, natural, and preserves the speaker's intent.

Check for:
1. MEANING: Does the translation convey the same meaning? Any omissions or additions?
2. TONE: Does it match the speaker's register — casual, formal, emotional, sarcastic, etc.?
3. NATURALNESS: Would a native speaker actually say this? Or does it sound robotic/textbook?
4. CULTURAL: Are idioms, slang, and cultural references adapted properly?
5. COMPLETENESS: Is any part of the original left untranslated or lost?

Respond in this exact JSON format:
{"pass": true}
OR
{"pass": false, "issues": ["brief issue 1", "brief issue 2"], "corrected": "your improved translation here"}

Rules:
- If the translation is good enough (even if imperfect), pass it. Don't nitpick.
- Only fail it if there's a real problem a native speaker would notice.
- Your corrected translation must follow the same rules: target language only, no notes, no quotes, speakable length.
- Respond with ONLY the JSON. Nothing else.`;

export async function kimiMonitor(
  originalText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string
): Promise<MonitorResult> {
  if (!originalText?.trim() || !translatedText?.trim()) {
    return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
  }

  if (originalText.trim().length < 3) {
    return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
  }

  try {
    const userMessage = `Source language: ${sourceLang}
Target language: ${targetLang}
Original: ${originalText.trim()}
Translation: ${translatedText.trim()}`;

    const response = await gatewayRequest({
      task: "monitor",
      messages: [
        { role: "system", content: MONITOR_PROMPT },
        { role: "user", content: userMessage },
      ],
      maxTokens: 300,
      temperature: 0.2,
    });

    const raw = response.text?.trim();
    if (!raw) {
      return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[KimiAgent] Could not parse response, passing through");
      return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
    }

    const result = JSON.parse(jsonMatch[0]) as { pass?: boolean; corrected?: string; issues?: string[] };

    if (result.pass) {
      console.log("[KimiAgent] PASS — translation approved");
      return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
    }

    if (result.corrected && typeof result.corrected === "string" && result.corrected.trim()) {
      const corrected = result.corrected.replace(/^["']|["']$/g, "").trim();
      const issues = Array.isArray(result.issues) ? result.issues : [];
      console.log(`[KimiAgent] ADJUSTED — issues: ${issues.join(", ")}`);
      return { finalTranslation: corrected, wasAdjusted: true, issues };
    }

    return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("[KimiAgent] Monitor error (passing through):", errMsg);
    return { finalTranslation: translatedText, wasAdjusted: false, issues: [] };
  }
}
