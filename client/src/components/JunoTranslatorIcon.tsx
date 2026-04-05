interface Props {
  size?: number;
}

export default function JunoTranslatorIcon({ size = 36 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Dark bubble — back, bottom-right */}
      <rect x="11" y="17" width="24" height="18" rx="4.5" fill="#1a3560" />
      {/* Dark bubble tail — top-left */}
      <polygon points="13,17 13,12 18,17" fill="#1a3560" />

      {/* Green bubble — front, top-left */}
      <rect x="1" y="1" width="24" height="18" rx="4.5" fill="#16a34a" />
      {/* Green bubble tail — bottom-right */}
      <polygon points="19,19 24,24 24,19" fill="#16a34a" />

      {/* J in green bubble */}
      <text
        x="13"
        y="14"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="12"
        fontWeight="700"
        fill="white"
      >J</text>

      {/* J in dark bubble */}
      <text
        x="23"
        y="30"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="12"
        fontWeight="700"
        fill="white"
      >J</text>
    </svg>
  );
}
