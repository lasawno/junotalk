const orbPlanetWebp = "/planet_orb_transparent.webp";
const orbPlanetPng  = "/planet_orb_transparent.png";

interface JunoBubbleProps {
  size?: number;
  isActive?: boolean;
  isSpeaking?: boolean;
}

const DOTS = 3;

export default function JunoBubble({ size = 36, isActive, isSpeaking }: JunoBubbleProps) {
  const diameter = size * 2.5;
  const dotSize = Math.max(4, Math.round(diameter * 0.085));
  const dotGap = Math.round(diameter * 0.055);
  const cycleDuration = 1.4;
  const delayStep = cycleDuration / (DOTS * 2);

  return (
    <div
      style={{
        width: diameter,
        height: diameter,
        position: "relative",
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes junoFlip {
          0%, 100% { transform: scaleY(1);   border-radius: 50%; opacity: 0.85; }
          18%       { transform: scaleY(3.0); border-radius: 30%; opacity: 1;    }
          36%       { transform: scaleY(1);   border-radius: 50%; opacity: 0.85; }
        }
      `}</style>

      <picture>
        <source srcSet={orbPlanetWebp} type="image/webp" />
        <img
          src={orbPlanetPng}
          alt="Juno"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </picture>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: dotGap }}>
          {Array.from({ length: DOTS }).map((_, i) => (
            <div
              key={i}
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.92)",
                animation: `junoFlip ${cycleDuration}s ease-in-out ${(i * delayStep).toFixed(2)}s infinite`,
                animationPlayState: (isActive || isSpeaking) ? "running" : "paused",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
