import { V2_FEATURE_FLAGS } from "@shared/schema";
import { storage } from "./storage";

export type AppMode = "stable" | "development";

export function getAppMode(): AppMode {
  const mode = (process.env.APP_MODE || "stable").toLowerCase();
  return mode === "development" ? "development" : "stable";
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  if (V2_FEATURE_FLAGS.has(key) && getAppMode() === "stable") {
    return false;
  }
  return storage.getFeatureFlag(key);
}

export async function getEffectiveFlags(): Promise<{ key: string; enabled: boolean; updatedAt: Date | null }[]> {
  const flags = await storage.getAllFeatureFlags();
  const mode = getAppMode();
  return flags.map((flag) => ({
    ...flag,
    enabled: V2_FEATURE_FLAGS.has(flag.key) && mode === "stable" ? false : flag.enabled,
  }));
}
