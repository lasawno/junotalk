import { useEffect, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { IncomingCallInfo } from "@/contexts/call-context";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

interface Props {
  call: IncomingCallInfo;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallModal({ call, onAccept, onDecline }: Props) {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPulse((p) => p + 1), 700);
    return () => clearInterval(id);
  }, []);

  const ringScale = 1 + (pulse % 2 === 0 ? 0.06 : 0);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center pb-16"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
      data-testid="incoming-call-modal"
    >
      <div
        className="w-full max-w-sm mx-4 rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0f1729 0%, #1a1a3e 60%, #0a0f22 100%)",
          border: "1px solid rgba(100,140,255,0.18)",
          boxShadow: "0 0 60px rgba(80,120,255,0.25), 0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div className="flex flex-col items-center px-6 pt-10 pb-8 gap-5">
          <p className="text-xs font-semibold tracking-widest text-blue-300/70 uppercase">
            Incoming Video Call
          </p>

          <div
            className="relative"
            style={{
              transform: `scale(${ringScale})`,
              transition: "transform 0.35s ease-in-out",
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(80,140,255,0.25) 0%, transparent 70%)",
                transform: `scale(${1 + (pulse % 2 === 0 ? 0.3 : 0)})`,
                transition: "transform 0.7s ease-in-out",
              }}
            />
            <Avatar className="w-24 h-24 border-2 border-blue-400/30">
              <AvatarImage src={call.callerAvatar || undefined} />
              <AvatarFallback className="text-2xl font-bold bg-blue-900/50 text-blue-200">
                {getInitials(call.callerName)}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="text-center">
            <p className="text-xl font-semibold text-white" data-testid="incoming-caller-name">
              {call.callerName}
            </p>
            <p className="text-sm text-blue-200/60 mt-1">is calling you</p>
          </div>

          <div className="flex items-center justify-center gap-12 mt-4 w-full">
            <button
              data-testid="button-decline-call"
              onClick={onDecline}
              className="flex flex-col items-center gap-2 group"
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95"
                style={{
                  background: "rgba(220,50,50,0.18)",
                  border: "1.5px solid rgba(220,80,80,0.35)",
                  boxShadow: "0 0 20px rgba(200,40,40,0.2)",
                }}
              >
                <PhoneOff className="w-7 h-7 text-red-400" />
              </div>
              <span className="text-xs text-red-300/70 font-medium">Decline</span>
            </button>

            <button
              data-testid="button-accept-call"
              onClick={onAccept}
              className="flex flex-col items-center gap-2 group"
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95"
                style={{
                  background: "rgba(40,180,80,0.22)",
                  border: "1.5px solid rgba(60,200,100,0.4)",
                  boxShadow: "0 0 24px rgba(40,200,80,0.3)",
                }}
              >
                <Phone className="w-7 h-7 text-green-400" />
              </div>
              <span className="text-xs text-green-300/70 font-medium">Accept</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
