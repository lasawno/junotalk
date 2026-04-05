import { Button } from "@/components/ui/button";

interface BackTriangleProps {
  onClick?: () => void;
  testId?: string;
  size?: "sm" | "md";
  label?: string;
}

export default function BackTriangle({ onClick = () => window.history.back(), testId = "button-back", size = "md", label }: BackTriangleProps) {
  const svgSize = size === "sm" ? 22 : 26;

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      data-testid={testId}
      className="flex items-center gap-1 px-2 py-2 h-auto min-w-0 hover:bg-white/5"
    >
      <svg width={svgSize} height={svgSize} viewBox="0 0 28 28" fill="none" className="flex-shrink-0">
        <polygon points="4,14 24,4 24,24" fill="#00B899" />
      </svg>
      {label && (
        <span className="text-lg font-semibold text-white leading-tight">{label}</span>
      )}
    </Button>
  );
}
