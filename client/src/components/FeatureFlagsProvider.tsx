import { FeatureFlagsContext, useFeatureFlagsValue } from "@/hooks/use-feature-flags";

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const value = useFeatureFlagsValue();
  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}
