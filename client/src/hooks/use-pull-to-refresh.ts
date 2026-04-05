import { useEffect, useRef, useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

const PULL_THRESHOLD = 60;
const RESIST = 0.38;

export function usePullToRefresh(queryKeys?: string[][]) {
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const triggerRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullY(0);
    try {
      if (queryKeys && queryKeys.length > 0) {
        await Promise.all(queryKeys.map((k) => queryClient.invalidateQueries({ queryKey: k })));
      } else {
        await queryClient.invalidateQueries();
      }
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [queryKeys]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (window.scrollY > 2) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return;
      if (window.scrollY > 2) { pullingRef.current = false; setPullY(0); return; }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) { setPullY(0); return; }
      setPullY(Math.min(delta * RESIST, PULL_THRESHOLD * 1.6));
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      setPullY((current) => {
        if (current >= PULL_THRESHOLD) {
          triggerRefresh();
        } else {
          setTimeout(() => setPullY(0), 0);
        }
        return current;
      });
      startYRef.current = 0;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [triggerRefresh]);

  return { pullY, refreshing };
}
