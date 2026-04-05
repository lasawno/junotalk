import { getReasoningConfig, getModulesConfig, type DecompositionRule } from "./github-config";

export interface ReasoningStep {
  id: number;
  content: string;
  intent: string | null;
  dependsOn: number[];
  strategy: "sequential" | "parallel" | "conditional";
}

export interface ReasoningResult {
  isComplex: boolean;
  complexityScore: number;
  steps: ReasoningStep[];
  originalQuery: string;
  decomposed: boolean;
  reasoning: string;
}

interface ComplexitySignal {
  name: string;
  weight: number;
  matched: boolean;
  detail?: string;
}

const CONJUNCTION_SPLITTERS = [
  { pattern: /\band\s+(?:also|then)\b/gi, strategy: "sequential" as const },
  { pattern: /\bbut\s+first\b/gi, strategy: "sequential" as const },
  { pattern: /\bafter\s+that\b/gi, strategy: "sequential" as const },
  { pattern: /\badditionally\b/gi, strategy: "sequential" as const },
  { pattern: /\bplus\b/gi, strategy: "sequential" as const },
  { pattern: /\balso\b/gi, strategy: "sequential" as const },
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[?!.,;:'"]/g, "").replace(/\s+/g, " ").trim();
}

function countClauses(text: string): number {
  const clauseMarkers = /[,;]|\band\b|\bbut\b|\bor\b|\bthen\b|\balso\b|\bplus\b|\bwhile\b|\bwhereas\b/gi;
  const matches = text.match(clauseMarkers);
  return (matches?.length || 0) + 1;
}

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) || []).length;
}

function countVerbs(text: string): number {
  const verbIndicators = /\b(?:translate|explain|compare|tell|show|find|help|give|make|do|say|write|read|check|look|search|ask|know|think|want|need|can|could|would|should|will|please)\b/gi;
  const matches = text.match(verbIndicators);
  return matches?.length || 0;
}

function hasConditionalLogic(text: string): boolean {
  return /\b(?:if|whether|depending|in case|unless|provided that|assuming)\b/i.test(text);
}

function hasComparisonRequest(text: string): boolean {
  return /\b(?:compare|difference|versus|vs\.?|better|worse|prefer|between.*and|which.*(?:is|are))\b/i.test(text);
}

function hasExplanationRequest(text: string): boolean {
  return /\b(?:explain|why|how does|what does.*mean|clarify|elaborate|break down|walk me through)\b/i.test(text);
}

function analyzeComplexity(text: string): { score: number; signals: ComplexitySignal[] } {
  const config = getReasoningConfig();
  const signals: ComplexitySignal[] = [];
  const normalized = normalizeText(text);
  const wordCount = normalized.split(" ").length;

  const clauseCount = countClauses(text);
  signals.push({
    name: "clause-count",
    weight: Math.min(clauseCount * 0.1, 0.3),
    matched: clauseCount > 2,
    detail: `${clauseCount} clauses detected`,
  });

  const questionCount = countQuestionMarks(text);
  signals.push({
    name: "multi-question",
    weight: questionCount > 1 ? 0.25 : 0,
    matched: questionCount > 1,
    detail: `${questionCount} questions`,
  });

  const verbCount = countVerbs(text);
  signals.push({
    name: "multi-verb",
    weight: verbCount > 2 ? Math.min((verbCount - 2) * 0.08, 0.2) : 0,
    matched: verbCount > 2,
    detail: `${verbCount} action verbs`,
  });

  const hasConditional = hasConditionalLogic(text);
  signals.push({
    name: "conditional-logic",
    weight: hasConditional ? 0.2 : 0,
    matched: hasConditional,
  });

  const hasComparison = hasComparisonRequest(text);
  signals.push({
    name: "comparison-request",
    weight: hasComparison ? 0.2 : 0,
    matched: hasComparison,
  });

  const hasExplanation = hasExplanationRequest(text);
  signals.push({
    name: "explanation-request",
    weight: hasExplanation ? 0.15 : 0,
    matched: hasExplanation,
  });

  signals.push({
    name: "length-factor",
    weight: wordCount > 25 ? Math.min((wordCount - 25) * 0.005, 0.15) : 0,
    matched: wordCount > 25,
    detail: `${wordCount} words`,
  });

  for (const rule of config.decompositionRules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      const ruleMatched = regex.test(normalized);
      signals.push({
        name: `rule:${rule.splitStrategy}`,
        weight: ruleMatched ? 0.15 : 0,
        matched: ruleMatched,
        detail: rule.description,
      });
    } catch {}
  }

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(totalWeight, 1.0);

  return { score, signals };
}

function decomposeQuery(text: string, signals: ComplexitySignal[]): ReasoningStep[] {
  const config = getReasoningConfig();
  const steps: ReasoningStep[] = [];

  const hasSequential = signals.some(s => s.name === "rule:sequential" && s.matched);
  const hasConditional = signals.some(s => s.name === "conditional-logic" && s.matched);
  const hasComparison = signals.some(s => s.name === "comparison-request" && s.matched);

  if (hasConditional) {
    const parts = text.split(/\b(?:if|whether)\b/i).filter(p => p.trim().length > 3);
    if (parts.length >= 2) {
      steps.push({
        id: 1,
        content: `Evaluate condition: ${parts[0].trim()}`,
        intent: "evaluate",
        dependsOn: [],
        strategy: "conditional",
      });
      for (let i = 1; i < Math.min(parts.length, config.maxDecompositionSteps); i++) {
        steps.push({
          id: i + 1,
          content: parts[i].trim(),
          intent: "process",
          dependsOn: [1],
          strategy: "conditional",
        });
      }
      return steps;
    }
  }

  if (hasComparison) {
    const betweenMatch = text.match(/(?:between|compare)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+?)(?:\?|$)/i);
    if (betweenMatch) {
      steps.push({
        id: 1,
        content: `Analyze: ${betweenMatch[1].trim()}`,
        intent: "analyze",
        dependsOn: [],
        strategy: "parallel",
      });
      steps.push({
        id: 2,
        content: `Analyze: ${betweenMatch[2].trim()}`,
        intent: "analyze",
        dependsOn: [],
        strategy: "parallel",
      });
      steps.push({
        id: 3,
        content: `Compare findings from step 1 and step 2`,
        intent: "compare",
        dependsOn: [1, 2],
        strategy: "parallel",
      });
      return steps;
    }
  }

  if (hasSequential) {
    let segments: string[] = [text];
    for (const splitter of CONJUNCTION_SPLITTERS) {
      const newSegments: string[] = [];
      for (const seg of segments) {
        const parts = seg.split(splitter.pattern).filter(p => p.trim().length > 5);
        newSegments.push(...parts);
      }
      if (newSegments.length > segments.length) {
        segments = newSegments;
      }
    }

    if (segments.length > 1) {
      for (let i = 0; i < Math.min(segments.length, config.maxDecompositionSteps); i++) {
        steps.push({
          id: i + 1,
          content: segments[i].trim(),
          intent: "process",
          dependsOn: i > 0 ? [i] : [],
          strategy: "sequential",
        });
      }
      return steps;
    }
  }

  const questionParts = text.split(/\?\s*/g).filter(p => p.trim().length > 5);
  if (questionParts.length > 1) {
    for (let i = 0; i < Math.min(questionParts.length, config.maxDecompositionSteps); i++) {
      steps.push({
        id: i + 1,
        content: questionParts[i].trim() + "?",
        intent: "answer",
        dependsOn: [],
        strategy: "parallel",
      });
    }
    return steps;
  }

  steps.push({
    id: 1,
    content: text,
    intent: "process",
    dependsOn: [],
    strategy: "sequential",
  });

  return steps;
}

export function analyzeQuery(text: string): ReasoningResult {
  const modulesConfig = getModulesConfig();
  const reasoningConfig = getReasoningConfig();

  if (!modulesConfig.reasoning.enabled || !reasoningConfig.enabled) {
    return {
      isComplex: false,
      complexityScore: 0,
      steps: [{ id: 1, content: text, intent: null, dependsOn: [], strategy: "sequential" }],
      originalQuery: text,
      decomposed: false,
      reasoning: "Reasoning module disabled",
    };
  }

  const { score, signals } = analyzeComplexity(text);
  const isComplex = score >= reasoningConfig.complexityThreshold;
  const activeSignals = signals.filter(s => s.matched);

  let steps: ReasoningStep[];
  let decomposed = false;

  if (isComplex) {
    steps = decomposeQuery(text, signals);
    decomposed = steps.length > 1;
  } else {
    steps = [{ id: 1, content: text, intent: null, dependsOn: [], strategy: "sequential" }];
  }

  const reasoning = isComplex
    ? `Complex query (score: ${score.toFixed(2)}). Signals: ${activeSignals.map(s => s.name).join(", ")}. Decomposed into ${steps.length} step(s).`
    : `Simple query (score: ${score.toFixed(2)}). Processing directly.`;

  return {
    isComplex,
    complexityScore: score,
    steps,
    originalQuery: text,
    decomposed,
    reasoning,
  };
}

export function buildReasoningContext(result: ReasoningResult): string {
  if (!result.isComplex || !result.decomposed) return "";

  const parts: string[] = [
    `[Reasoning] Query decomposed into ${result.steps.length} steps:`,
  ];

  for (const step of result.steps) {
    const deps = step.dependsOn.length > 0 ? ` (depends on step ${step.dependsOn.join(", ")})` : "";
    parts.push(`  Step ${step.id} [${step.strategy}]: ${step.content}${deps}`);
  }

  return parts.join("\n");
}

export function getReasoningStats() {
  const config = getReasoningConfig();
  return {
    enabled: config.enabled,
    complexityThreshold: config.complexityThreshold,
    maxSteps: config.maxDecompositionSteps,
    decompositionRules: config.decompositionRules.length,
    confidenceFloor: config.confidenceFloor,
  };
}

let engineInitialized = false;

export function initReasoningEngine(): void {
  if (engineInitialized) return;
  engineInitialized = true;

  const stats = getReasoningStats();
  console.log(
    `[ReasoningEngine] Initialized: threshold=${stats.complexityThreshold}, ` +
    `maxSteps=${stats.maxSteps}, rules=${stats.decompositionRules}`
  );
}
