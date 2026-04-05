const CHARS: string[] = [
  "あ", "가", "ب", "Ω", "漢", "ñ", "花", "朝",
  "文", "大", "百", "龙", "タ", "サ", "コ", "ネ",
  "ش", "ع", "ق", "Ă", "Ğ", "Ş", "Ő", "ည",
  "К", "α", "β", "Д", "ก", "ถ", "ས", "ꕥ",
  "の", "다", "م", "Σ", "風", "ê", "雨", "月",
  "天", "虎", "雪", "山", "ナ", "リ", "テ", "ケ",
  "ذ", "ص", "Č", "Ř", "Å", "Æ", "ዐ", "ᐊ",
  "л", "Δ", "Φ", "И", "Я", "ข", "ม", "ᓂ",
  "き", "나", "ت", "Ψ", "海", "ã", "星", "空",
  "地", "火", "竹", "春", "ヌ", "ワ", "マ", "ௐ",
  "ج", "ه", "و", "Ł", "Ń", "Ä", "Ö", "ಕ",
  "п", "ц", "Г", "Х", "ค", "พ", "Ꮝ", "Ꭶ",
  "め", "마", "ẹ", "Ё", "森", "î", "雲", "石",
  "水", "金", "鳥", "草", "カ", "ソ", "ꙮ", "ན",
  "ئ", "آ", "پ", "Ď", "Ŝ", "Ĉ", "Ŭ", "ස",
  "щ", "φ", "χ", "В", "Ш", "ช", "ล", "Ꮭ",
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function shuffleWithSeed(arr: string[], seed: number): string[] {
  const result = [...arr];
  const rand = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function DecorativeBackground({ variant = 0 }: { variant?: number }) {
  const shuffled = shuffleWithSeed(CHARS, variant * 7919 + 1);
  const count = shuffled.length;
  const cols = 8;
  const rows = Math.ceil(count / cols);
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  const rand = seededRandom(variant * 3571 + 37);

  const items = shuffled.map((char, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = (rand() - 0.5) * cellW * 0.6;
    const jitterY = (rand() - 0.5) * cellH * 0.6;
    const x = col * cellW + cellW / 2 + jitterX;
    const y = row * cellH + cellH / 2 + jitterY;
    const size = 10 + Math.floor(rand() * 14);
    const rotation = Math.floor(rand() * 40) - 20;
    const weight = rand() > 0.7 ? 700 : 400;
    const opacity = 0.14 + rand() * 0.16;

    return { x: Math.max(1, Math.min(99, x)), y: Math.max(0.5, Math.min(99.5, y)), size, rotation, char, weight, opacity };
  });

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none select-none z-0" aria-hidden="true">
      {items.map((item, i) => (
        <span
          key={i}
          className="absolute text-primary"
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            fontSize: `${item.size}px`,
            transform: `rotate(${item.rotation}deg)`,
            fontWeight: item.weight,
            opacity: item.opacity,
          }}
        >
          {item.char}
        </span>
      ))}
    </div>
  );
}
