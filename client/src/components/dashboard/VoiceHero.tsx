import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import SectionBoundary from "./SectionBoundary";
import orbImg from "@assets/Untitled_design_1774744590184.png";
import junoIntelIcon from "@assets/Untitled_design_1775249976943.png";

interface VoiceHeroProps {
  onMicTap: () => void;
  onOpenChat: () => void;
}

const CARD_BG = "linear-gradient(170deg, rgba(65,125,215,0.95) 0%, rgba(45,98,195,0.95) 55%, rgba(32,78,172,0.98) 100%)";
const CARD_BORDER = "1px solid rgba(100,170,255,0.5)";
const INTEL_BORDER = "none";
const GLOSS = (
  <div
    className="absolute top-0 left-0 right-0 pointer-events-none"
    style={{
      height: "42%",
      background: "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 100%)",
      borderRadius: "9999px 9999px 0 0",
    }}
  />
);

function TranslatorIcon({ size = 52 }: { size?: number }) {
  const bubble = Math.round(size * 0.62);
  const offset = Math.round(size * 0.38);
  const total = bubble + offset;
  const r = Math.round(bubble * 0.22);
  const fontSize = Math.round(bubble * 0.48);
  const cx = Math.round(bubble * 0.5);
  const cy = Math.round(bubble * 0.5);
  return (
    <svg width={total} height={total} viewBox={`0 0 ${total} ${total}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Green bubble — back, top-left, Chinese 文 */}
      <rect x="0" y="0" width={bubble} height={bubble} rx={r} fill="#4CD964" />
      <text
        x={cx}
        y={cy + fontSize * 0.36}
        textAnchor="middle"
        fontFamily="-apple-system, 'Hiragino Sans', 'Noto Sans CJK SC', sans-serif"
        fontSize={fontSize}
        fontWeight="600"
        fill="white"
      >文</text>
      {/* Blue bubble — front, bottom-right, letter A */}
      <rect x={offset} y={offset} width={bubble} height={bubble} rx={r} fill="#007AFF" />
      <text
        x={offset + cx}
        y={offset + cy + fontSize * 0.36}
        textAnchor="middle"
        fontFamily="-apple-system, 'SF Pro Display', sans-serif"
        fontSize={fontSize}
        fontWeight="700"
        fill="white"
      >A</text>
    </svg>
  );
}

function VoiceHeroInner({ onMicTap, onOpenChat }: VoiceHeroProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="mb-1 space-y-2">
      {/* Juno Intelligence AI card */}
      <button
        onClick={() => setLocation("/juno")}
        className="w-[82%] mx-auto block relative overflow-hidden rounded-full active:scale-[0.98] transition-transform"
        style={{ background: CARD_BG, border: INTEL_BORDER, boxShadow: "0 2px 16px rgba(96,165,250,0.28), inset 0 2px 0 rgba(160,210,255,0.45), inset 0 -2px 0 rgba(160,210,255,0.45), inset 0 1px 0 rgba(255,255,255,0.18)" }}
        data-testid="card-juno-intelligence"
      >
        {GLOSS}
        <div className="px-3 py-1.5 flex items-center justify-center gap-3 relative z-10">
          <div
            className="w-11 h-11 flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden relative"
            style={{
              background: "radial-gradient(circle at 38% 32%, #ffffff 0%, #e8f0ff 100%)",
              border: "1px solid rgba(180,210,255,0.7)",
              boxShadow: "0 4px 10px rgba(0,0,0,0.38), 0 1px 3px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -2px 3px rgba(120,160,255,0.18)",
            }}
          >
            <img
              src={junoIntelIcon}
              alt="Juno Intelligence"
              className="object-contain"
              style={{ width: "132%", height: "132%" }}
            />
            <div
              className="absolute top-0 left-0 right-0 pointer-events-none rounded-t-full"
              style={{
                height: "46%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 100%)",
              }}
            />
          </div>
          <div className="text-center">
            <h3 className="text-base font-bold text-white tracking-wide">Juno Intelligence</h3>
            <p className="text-xs text-white/80 leading-snug">The AI engine behind JunoTalk</p>
          </div>
        </div>
      </button>

      {/* Side-by-side row: Juno Translator | Tap to Speak */}
      <div className="flex gap-2">
        {/* Juno Translator */}
        <button
          onClick={onOpenChat}
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-xl cursor-pointer active:scale-[0.98] transition-transform select-none text-left relative overflow-hidden"
          style={{ background: CARD_BG, border: CARD_BORDER, boxShadow: "0 2px 14px rgba(59,130,246,0.22), inset 0 1px 0 rgba(255,255,255,0.18)" }}
          data-testid="button-open-juno-chat"
        >
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none"
            style={{
              height: "42%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 100%)",
              borderRadius: "10px 10px 0 0",
            }}
          />
          <div className="flex-shrink-0 relative z-10">
            <TranslatorIcon size={32} />
          </div>
          <div className="flex-1 min-w-0 relative z-10">
            <p className="text-xs font-bold text-white leading-tight tracking-wide">Juno Translator</p>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-white/60 flex-shrink-0 relative z-10" />
        </button>

        {/* Tap to Speak */}
        <button
          onClick={onMicTap}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl cursor-pointer active:scale-[0.98] transition-transform select-none relative overflow-hidden"
          style={{ minWidth: "40%", background: CARD_BG, border: CARD_BORDER, boxShadow: "0 2px 12px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,0.18)" }}
          data-testid="button-juno-mic"
        >
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none"
            style={{
              height: "42%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 100%)",
              borderRadius: "10px 10px 0 0",
            }}
          />
          <p className="text-xs font-bold text-white whitespace-nowrap relative z-10">Tap to Speak</p>
          <img
            src={orbImg}
            alt="Juno orb"
            className="w-6 h-6 object-contain flex-shrink-0 relative z-10"
          />
        </button>
      </div>
    </div>
  );
}

export default function VoiceHero({ onMicTap, onOpenChat }: VoiceHeroProps) {
  return (
    <SectionBoundary label="Juno Intelligence">
      <VoiceHeroInner onMicTap={onMicTap} onOpenChat={onOpenChat} />
    </SectionBoundary>
  );
}
