import { useEffect } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export function useTheme() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    localStorage.setItem(STORAGE_KEYS.legacyTheme, "dark");
  }, []);

  return { theme: "dark" as const };
}
