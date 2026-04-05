import { useState, useEffect, useRef } from "react";
import type { ConnectionStatus as Status, ConnectionQuality } from "@/hooks/use-websocket";

interface ConnectionStatusProps {
  status: Status;
  quality?: ConnectionQuality;
  rtt?: number;
  className?: string;
}

export default function ConnectionStatus({ status, quality = "good", rtt = 0, className = "" }: ConnectionStatusProps) {
  const [showLabel, setShowLabel] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (status === "connected" && quality !== "poor") {
      setShowLabel(false);
    } else {
      timerRef.current = setTimeout(() => setShowLabel(true), 3000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [status, quality]);

  const dotColor =
    status === "connected"
      ? quality === "poor"
        ? "bg-amber-500/80"
        : quality === "fair"
        ? "bg-blue-400/80"
        : "bg-blue-600/80"
      : status === "reconnecting"
      ? "bg-amber-500/80"
      : "bg-red-500/80";

  const pulseColor =
    status === "connected"
      ? quality === "poor"
        ? "bg-amber-400/60"
        : "bg-blue-500/60"
      : status === "reconnecting"
      ? "bg-amber-400/60"
      : "bg-red-400/60";

  const label =
    status === "connected"
      ? quality === "poor"
        ? `Slow (${rtt}ms)`
        : quality === "fair"
        ? `Fair (${rtt}ms)`
        : "Connected"
      : status === "reconnecting"
      ? "Reconnecting..."
      : "Disconnected";

  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      data-testid="connection-status"
      title={status === "connected" ? `${quality} ${rtt}ms RTT` : label}
    >
      <span className="relative flex h-2.5 w-2.5">
        {status !== "disconnected" && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pulseColor}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotColor}`}
        />
      </span>
      {((status !== "connected") || quality === "poor" || quality === "fair") && showLabel && (
        <span className="text-[10px] text-muted-foreground" data-testid="text-connection-label">
          {label}
        </span>
      )}
    </div>
  );
}
