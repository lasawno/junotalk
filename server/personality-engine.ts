import {
  getPersonalityConfig,
  getModulesConfig,
  getActivePersonalityProfile,
  type PersonalityProfile,
} from "./github-config";

export interface PersonalityContext {
  profile: PersonalityProfile;
  shouldInjectHumor: boolean;
  toneDirective: string;
  overrideReason: string | null;
}

let lastHumorTimestamp = 0;

function canInjectHumor(profile: PersonalityProfile): boolean {
  if (profile.humorLevel <= 0) return false;

  const config = getPersonalityConfig();
  const now = Date.now();
  if (now - lastHumorTimestamp < config.humorCooldownMs) return false;

  const roll = Math.random();
  if (roll > profile.humorLevel) return false;

  lastHumorTimestamp = now;
  return true;
}

const SERIOUS_INTENTS = new Set(["emergency", "medical", "transaction", "legal"]);

export function getPersonalityForContext(intent?: string): PersonalityContext {
  const modulesConfig = getModulesConfig();
  const personalityConfig = getPersonalityConfig();

  if (!modulesConfig.personality.enabled || !personalityConfig.enabled) {
    return {
      profile: getActivePersonalityProfile(),
      shouldInjectHumor: false,
      toneDirective: "",
      overrideReason: "Personality module disabled",
    };
  }

  let overrideReason: string | null = null;
  const profile = getActivePersonalityProfile(intent);

  if (intent && personalityConfig.overrideIntents[intent]) {
    overrideReason = `Intent "${intent}" overrides to "${personalityConfig.overrideIntents[intent]}" profile`;
  }

  const isSeriousContext = intent ? SERIOUS_INTENTS.has(intent) : false;
  const shouldInjectHumor = !isSeriousContext && canInjectHumor(profile);

  const toneDirective = buildToneDirective(profile, shouldInjectHumor, isSeriousContext);

  return {
    profile,
    shouldInjectHumor,
    toneDirective,
    overrideReason,
  };
}

function buildToneDirective(
  profile: PersonalityProfile,
  includeHumor: boolean,
  seriousContext: boolean
): string {
  const parts: string[] = [];

  parts.push(`[Personality: ${profile.name}]`);
  parts.push(`Tone: ${profile.tone.join(", ")}.`);
  parts.push(profile.responseStyle);

  if (seriousContext) {
    parts.push("IMPORTANT: This is a serious context. Maintain a professional and clear tone. Do not use humor or casual language.");
  } else if (includeHumor) {
    parts.push("Feel free to be lighthearted or add a touch of wit if it fits naturally. Do not force humor — it should feel organic.");
  }

  if (profile.guidelines.length > 0) {
    parts.push("Guidelines: " + profile.guidelines.slice(0, 3).join(". ") + ".");
  }

  return parts.join(" ");
}

export function buildPersonalityPrompt(context: PersonalityContext): string {
  if (!context.toneDirective) return "";
  return context.toneDirective;
}

export function getPersonalityStats() {
  const config = getPersonalityConfig();
  const activeProfile = getActivePersonalityProfile();

  return {
    enabled: config.enabled,
    activeProfile: activeProfile.id,
    profileName: activeProfile.name,
    humorLevel: activeProfile.humorLevel,
    availableProfiles: config.profiles.map(p => ({ id: p.id, name: p.name, humorLevel: p.humorLevel })),
    overrideIntents: config.overrideIntents,
    humorCooldownMs: config.humorCooldownMs,
  };
}

let engineInitialized = false;

export function initPersonalityEngine(): void {
  if (engineInitialized) return;
  engineInitialized = true;

  const stats = getPersonalityStats();
  console.log(
    `[PersonalityEngine] Initialized: profile="${stats.profileName}", ` +
    `humor=${stats.humorLevel}, ` +
    `${stats.availableProfiles.length} profiles, ` +
    `${Object.keys(stats.overrideIntents).length} intent overrides`
  );
}
