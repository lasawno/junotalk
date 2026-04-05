/**
 * CDN Bootstrap — Autonomous Config Sync
 *
 * Runs once at server startup. For each intelligence config file:
 *   1. Checks if the file already exists on the CDN
 *   2. If missing → auto-creates it with the current default config
 *   3. If present → leaves it alone (preload functions handle reading)
 *
 * This means the system is fully self-configuring:
 *   - First deploy: all three config files are created automatically on the CDN
 *   - Every deploy after: CDN files are left untouched (your edits are preserved)
 *   - CDN unreachable: hardcoded defaults keep everything running silently
 *
 * No manual GitHub pushes needed. Ever.
 *
 * CDN files managed:
 *   config/adaptive-policies.json
 *   config/intelligence-layer.json
 *   config/learner.json
 *   ai-images/config.json
 */

import { fetchPrivateFile, pushPrivateFile } from "./github-config";
import { IMAGE_CONFIG_CDN_PATH, IMAGE_CONFIG_DEFAULT } from "./image-config";

// ── Default payloads (mirrors each module's DEFAULT_CONFIG) ────────────────────
// Kept here so bootstrap doesn't need to import the full modules.

const BOOTSTRAP_CONFIGS: Array<{
  path: string;
  label: string;
  payload: Record<string, unknown>;
}> = [
  {
    path: "config/adaptive-policies.json",
    label: "Adaptive Policies",
    payload: {
      version: "1.0.0",
      description: "Juno Adaptive Policies — 4 behavioral modules. All thresholds and keyword lists tunable here without code deploys.",
      significance: {
        highKeywords: [
          "urgent","emergency","critical","important","serious","deadline",
          "crisis","help me","need help","dying","danger","decision",
          "invest","money","legal","medical","health","advice",
          "should i","what do i do","how do i fix","broken","failed"
        ],
        lowKeywords: [
          "hi","hello","hey","lol","haha","ok","okay","cool",
          "nice","great","thanks","bye","later","yes","no","sure",
          "what's up","how are you","good morning","good night"
        ],
        highThreshold: 2,
        lowThreshold: 1,
      },
      curiosity: {
        enabled: true,
        noveltyKeywords: [
          "what if","imagine","hypothetically","idea","concept","theory",
          "never heard","new to","wondering","curious","explore","discover",
          "could","might","would","possibility","future","different"
        ],
        minHistoryLength: 2,
        cooldownTurns: 3,
      },
      surpriseLearning: {
        enabled: true,
        correctionSignals: [
          "actually","that's wrong","you're wrong","incorrect","no that's",
          "not quite","not exactly","that's not right","wait no","i meant",
          "correction","mistake","wrong","no no","that's incorrect"
        ],
        shiftSignals: [
          "anyway","forget that","let's change","different topic","actually never mind",
          "let me rephrase","i changed my mind","switch to","actually let's"
        ],
      },
      trustThreshold: {
        lowTrustTurns: 3,
        highTrustTurns: 10,
        confirmationActions: [
          "delete","remove","reset","clear","send to everyone",
          "share my location","give my number","reveal","publish",
          "post publicly","broadcast"
        ],
      },
    },
  },
  {
    path: "config/intelligence-layer.json",
    label: "Intelligence Layer",
    payload: {
      version: "1.0.0",
      description: "Juno Intelligence Layer — 8 capability modules. All thresholds and keyword lists tunable here without code deploys.",
      momentum: {
        stallWordCountThreshold: 5,
        stallTurnCount: 3,
        accelerationWordCountThreshold: 30,
        accelerationTurnCount: 3,
      },
      cognitiveLoad: {
        highWordCount: 60,
        highQuestionCount: 3,
        confusionSignals: [
          "i don't understand","i'm confused","what do you mean",
          "can you explain","not sure what","lost me","unclear",
          "don't get it","help me understand","what does that mean",
          "i'm not following","could you clarify","makes no sense"
        ],
        overwhelmSignals: [
          "too much","information overload","slow down","one at a time",
          "step by step","that's a lot","overwhelming","too many things"
        ],
      },
      goalPersistence: {
        intentPrefixes: [
          "i want to","i need to","i'm trying to","my goal is","i'm working on",
          "help me","i'd like to","can you help me","i'm building","i want",
          "trying to figure out","i need help with","how do i","how can i"
        ],
        completionSignals: [
          "that worked","perfect","exactly what i needed","solved it",
          "got it","thanks that's it","done","figured it out","fixed",
          "that's what i was looking for"
        ],
        maxGoalAgeturns: 12,
      },
      ambiguity: {
        ambiguousSignals: [
          "or","maybe","either","not sure which","could be",
          "depends","several ways","not certain","various","multiple options"
        ],
        clarificationThreshold: 2,
      },
      redundancy: {
        enabled: true,
        similarityWindowTurns: 4,
        keywordOverlapThreshold: 0.6,
      },
      timeSensitivity: {
        urgentKeywords: [
          "asap","urgent","emergency","right now","immediately",
          "as soon as possible","can't wait","must be done","critical","now"
        ],
        deadlineKeywords: [
          "deadline","by tomorrow","by tonight","due today","due soon",
          "before","by monday","by friday","end of day","eod","this week",
          "by morning","in an hour","in 30 minutes","in a few minutes"
        ],
        softTimeKeywords: [
          "soon","eventually","at some point","when i can","no rush",
          "whenever","take your time","sometime"
        ],
      },
      knowledgeBoundary: {
        uncertaintyTopics: [
          "latest","recent news","today's","this week's","current stock",
          "real-time","live data","today","right now in the world",
          "predict","will happen","forecast"
        ],
        outOfBoundsTopics: [
          "personal medical advice","legal advice for my case","diagnose me",
          "my specific tax situation","hack into","bypass security",
          "my personal data","track someone","classified"
        ],
        timeHorizonKeywords: [
          "after 2024","in 2025","this year","last month","yesterday",
          "breaking news","just happened"
        ],
      },
      confidence: {
        lowConfidenceTopics: [
          "predict","future","will it","guarantee","certain",
          "for sure","100%","definitely will","promise me"
        ],
        highConfidenceTopics: [
          "how does","what is","explain","define","describe",
          "basics of","overview of","history of","what are"
        ],
      },
    },
  },
  {
    path: "config/learner.json",
    label: "Learner",
    payload: {
      version: "1.0.0",
      description: "Juno Learner — persistent cross-session learning engine. Controls what Juno extracts, stores, and recalls from conversations.",
      enabled: true,
      extraction: {
        minWordCount: 4,
        maxFactTextLength: 200,
        questionPrefixes: [
          "what","who","where","when","why","how",
          "is","are","can","could","would","should",
          "did","do","does","will"
        ],
        patterns: [
          {
            category: "personal", confidence: 0.85,
            triggers: [
              "my name is","i am called","call me","i'm called",
              "i live in","i'm from","i am from","i'm based in","i work at",
              "my age is","my birthday","i have a",
              "my wife","my husband","my partner","my kids","my child",
              "my family","my mom","my dad","my brother","my sister"
            ],
          },
          {
            category: "preference", confidence: 0.88,
            triggers: [
              "i prefer","i like","i love","i enjoy","i hate",
              "i don't like","i dislike","i can't stand","i always",
              "i never","i usually","i tend to","my favorite","my favourite",
              "i'm a fan of","i'm not a fan","i avoid","i use","i don't use"
            ],
          },
          {
            category: "expertise", confidence: 0.90,
            triggers: [
              "i'm a","i am a","i work as","i'm an","i am an",
              "i specialize in","i specialise in","my background is",
              "i studied","i have a degree","i'm experienced in",
              "i know how to","i've been working on","i build",
              "i develop","i design","i manage","i lead","i run",
              "my expertise","professionally i"
            ],
          },
          {
            category: "correction", confidence: 0.80,
            triggers: [
              "actually","that's not right","you're wrong","that's wrong",
              "no,","incorrect","not exactly","not quite","i meant",
              "what i meant","to clarify","let me correct","the correct",
              "it's actually","the real","in fact","correction:"
            ],
          },
          {
            category: "goal", confidence: 0.82,
            triggers: [
              "i want to","i need to","i'm trying to","my goal is",
              "i'm working on","i'm building","i'm creating","i'm developing",
              "i'm planning to","i'd like to","my plan is","i hope to",
              "i'm aiming to","i want","i need","i'm looking to"
            ],
          },
          {
            category: "context", confidence: 0.83,
            triggers: [
              "my team","my company","my project","we use","our stack",
              "our team","at my job","at work","my app","my website",
              "my product","my startup","my business","in my industry",
              "we're building","my codebase","our platform"
            ],
          },
        ],
      },
      storage: {
        dedupSimilarityThreshold: 0.92,
        dedupSearchLimit: 3,
      },
      recall: {
        limit: 5,
        minSimilarity: 0.72,
      },
      labels: {
        personal:   "About this user",
        preference: "Their preferences",
        expertise:  "Their background & expertise",
        correction: "Things they've corrected me on",
        goal:       "Their stated goals",
        context:    "Their context & environment",
      },
    },
  },
  {
    path: IMAGE_CONFIG_CDN_PATH,
    label: "Image Generation Config",
    payload: IMAGE_CONFIG_DEFAULT as unknown as Record<string, unknown>,
  },
];

// ── Bootstrap Runner ───────────────────────────────────────────────────────────

export async function bootstrapCdnConfigs(): Promise<void> {
  console.log("[CdnBootstrap] Starting autonomous config sync...");

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const cfg of BOOTSTRAP_CONFIGS) {
    try {
      // Use fetchPrivateFile — the proven read path — as the existence check.
      // If it returns any non-null value, the file is on the CDN and we leave it alone.
      const existing = await fetchPrivateFile(cfg.path).catch(() => null);

      if (existing !== null) {
        skipped++;
        continue;
      }

      // File is missing — auto-create it with the default payload
      const ok = await pushPrivateFile(
        cfg.path,
        cfg.payload,
        `[auto] Bootstrap ${cfg.label} config — initial defaults`
      );

      if (ok) {
        console.log(`[CdnBootstrap] ✓ Created ${cfg.path}`);
        created++;
      } else {
        // Write failed — could be permission issue or file actually exists but unreadable.
        // Either way, offline hardcoded defaults are identical — system runs fine.
        console.log(`[CdnBootstrap] ${cfg.label}: CDN write skipped — offline defaults active (no impact)`);
        skipped++;
      }
    } catch (err: any) {
      console.log(`[CdnBootstrap] ${cfg.label}: CDN sync skipped — offline defaults active (no impact)`);
      skipped++;
    }
  }

  const total = BOOTSTRAP_CONFIGS.length;
  console.log(
    `[CdnBootstrap] Done — ${created} auto-created, ${skipped}/${total} on CDN or using offline defaults`
  );
}
