import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

interface FeatureFlag {
  key: string;
  enabled: boolean;
}

interface FeatureFlagsContextValue {
  flags: Record<string, boolean>;
  isLoading: boolean;
}

export const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: {},
  isLoading: true,
});

export function useFeatureFlagsQuery() {
  return useQuery<FeatureFlag[]>({
    queryKey: ["/api/feature-flags"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFeatureFlags(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext);
}

export function useFeatureFlag(name: string): boolean {
  const { flags } = useFeatureFlags();
  return flags[name] ?? false;
}

export function useFeatureFlagsValue(): FeatureFlagsContextValue {
  const { data, isLoading } = useFeatureFlagsQuery();
  const flags = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(data.map((f) => [f.key, f.enabled]));
  }, [data]);
  return { flags, isLoading };
}
