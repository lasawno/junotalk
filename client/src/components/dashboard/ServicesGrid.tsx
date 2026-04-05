import { useLocation } from "wouter";
import { Globe, DollarSign, LifeBuoy, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n.jsx";
import SectionBoundary from "./SectionBoundary";

interface ServicesGridProps {
  onOpenJunoVision: () => void;
}

const CARD_BG = "linear-gradient(170deg, rgba(65,125,215,0.95) 0%, rgba(45,98,195,0.95) 55%, rgba(32,78,172,0.98) 100%)";
const CARD_BORDER = "rgba(100,170,255,0.5)";

function ServicesGridInner({ onOpenJunoVision }: ServicesGridProps) {
  const [, setLocation] = useLocation();
  const { t } = useI18n();

  const services = [
    {
      id: "travel-esim",
      icon: <Globe className="w-5 h-5 text-white" />,
      label: t("home.travelEsim"),
      onClick: () => setLocation("/travel-esim"),
      testId: "card-travel-esim",
    },
    {
      id: "earning",
      icon: <DollarSign className="w-5 h-5 text-white" />,
      label: t("home.earning"),
      onClick: () => setLocation("/earning"),
      testId: "card-earning-opportunities",
    },
    {
      id: "support",
      icon: <LifeBuoy className="w-5 h-5 text-white" />,
      label: t("support.title"),
      onClick: () => setLocation("/support"),
      testId: "card-support",
    },
    {
      id: "juno-vision",
      icon: <Eye className="w-5 h-5 text-white" />,
      label: "Juno Vision",
      onClick: onOpenJunoVision,
      testId: "card-juno-vision",
    },
  ];

  return (
    <div className="mb-1">
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {services.map(svc => (
          <button
            key={svc.id}
            onClick={svc.onClick}
            className="flex flex-col items-center gap-0.5 py-1 px-1 rounded-xl active:scale-95 transition-transform relative overflow-hidden"
            style={{
              background: CARD_BG,
              border: `1.5px solid ${CARD_BORDER}`,
              boxShadow: "0 2px 12px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
            data-testid={svc.testId}
          >
            {/* top gloss */}
            <div
              className="absolute top-0 left-0 right-0 pointer-events-none"
              style={{
                height: "42%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 100%)",
                borderRadius: "10px 10px 0 0",
              }}
            />
            <div className="relative z-10">
              {svc.icon}
            </div>
            <span className="text-xs font-bold text-white text-center leading-tight relative z-10" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
              {svc.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ServicesGrid(props: ServicesGridProps) {
  return (
    <SectionBoundary label="Services">
      <ServicesGridInner {...props} />
    </SectionBoundary>
  );
}
