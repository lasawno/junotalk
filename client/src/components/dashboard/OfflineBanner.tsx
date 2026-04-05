import { useNetworkStatus } from "@/hooks/use-network-status";
import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const [visible, setVisible] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  if (!visible) return null;

  return (
    <div
      style={{
        transform: show ? "translateY(0)" : "translateY(-110%)",
        transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        background: "rgba(20, 30, 60, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(251,146,60,0.4)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        zIndex: 49,
      }}
      className="w-full px-4 py-2 flex items-center gap-3"
      data-testid="banner-offline"
    >
      {/* Pulsing dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{
            background: "rgba(251,146,60,1)",
            animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ background: "rgba(251,146,60,1)" }}
        />
      </span>

      <div className="flex flex-col leading-tight">
        <span
          className="text-xs font-semibold"
          style={{ color: "rgba(251,146,60,1)" }}
        >
          Buffering…
        </span>
        <span
          className="text-[10px]"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          You're still here. Reconnecting in the background.
        </span>
      </div>
    </div>
  );
}
