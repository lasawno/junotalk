import { Loader2 } from "lucide-react";

interface Props {
  pullY: number;
  refreshing: boolean;
}

const THRESHOLD = 60;

export default function PullToRefreshIndicator({ pullY, refreshing }: Props) {
  const visible = refreshing || pullY > 4;
  if (!visible) return null;

  const progress = Math.min(pullY / THRESHOLD, 1);
  const scale = refreshing ? 1 : 0.5 + progress * 0.5;
  const opacity = refreshing ? 1 : progress;
  const offsetY = refreshing ? 10 : Math.max(pullY - 32, -8);

  return (
    <div
      className="fixed left-0 right-0 flex justify-center z-[9999] pointer-events-none"
      style={{ top: offsetY, opacity, transform: `scale(${scale})`, transition: pullY === 0 && !refreshing ? "all 0.25s ease" : undefined }}
    >
      <div className="bg-background border border-border rounded-full w-9 h-9 flex items-center justify-center shadow-lg">
        <Loader2
          className="w-5 h-5 text-primary"
          style={{
            animation: refreshing ? "spin 0.7s linear infinite" : "none",
            transform: refreshing ? undefined : `rotate(${pullY * 5}deg)`,
          }}
        />
      </div>
    </div>
  );
}
