import { Bot } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { useLocation } from "wouter";

export default function AiAgentHub() {
  const [, setLocation] = useLocation();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(180deg, #080c20 0%, #0d1035 50%, #111440 100%)" }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-50 flex items-center gap-3 px-4 h-14 border-b"
        style={{ background: "rgba(8,12,32,0.97)", borderColor: "rgba(139,92,246,0.2)", backdropFilter: "blur(4px)" }}
      >
        <BackTriangle onClick={() => setLocation("/")} label="" />
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.4)" }}
          >
            <Bot className="w-4 h-4" style={{ color: "#a78bfa" }} />
          </div>
          <span className="text-sm font-bold text-white">AI Agent Hub</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(139,92,246,0.15)",
            border: "1.5px solid rgba(139,92,246,0.4)",
            boxShadow: "0 0 40px rgba(139,92,246,0.2)",
          }}
        >
          <Bot className="w-10 h-10" style={{ color: "#a78bfa" }} />
        </div>
        <p className="text-xl font-bold text-white text-center">AI Agent Hub</p>
      </div>
    </div>
  );
}
