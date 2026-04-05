import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

interface Props {
  target: { name: string; avatar: string | null };
  onCancel: () => void;
}

const STATUS_STEPS = ["Calling", "Calling.", "Calling..", "Calling..."];

export default function OutgoingCallScreen({ target, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [ring, setRing] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STATUS_STEPS.length), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setRing((r) => r + 1), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(10px)" }}
      data-testid="outgoing-call-screen"
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 140,
                height: 140,
                border: "1.5px solid rgba(100,160,255,0.25)",
                opacity: ring % 3 === i ? 0.7 : 0.15,
                transform: `scale(${1 + i * 0.28 + (ring % 3 === i ? 0.1 : 0)})`,
                transition: "transform 0.9s ease-in-out, opacity 0.9s ease-in-out",
              }}
            />
          ))}
          <Avatar className="w-24 h-24 border-2 border-blue-400/25">
            <AvatarImage src={target.avatar || undefined} />
            <AvatarFallback className="text-2xl font-bold bg-blue-900/50 text-blue-200">
              {getInitials(target.name)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <p className="text-xl font-semibold text-white" data-testid="outgoing-call-name">
            {target.name}
          </p>
          <p
            className="text-sm text-blue-300/60 mt-1 font-mono"
            style={{ minWidth: 90, display: "inline-block", textAlign: "left" }}
            data-testid="outgoing-call-status"
          >
            {STATUS_STEPS[step]}
          </p>
        </div>

        <button
          data-testid="button-cancel-call"
          onClick={onCancel}
          className="flex flex-col items-center gap-2 mt-4"
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
          <span className="text-xs text-red-300/70 font-medium">Cancel</span>
        </button>
      </div>
    </div>
  );
}
