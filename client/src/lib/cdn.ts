const CDN_BASE = "https://lasawno.github.io/junotalk-cdn/assets";
const LOCAL_BASE = "";

function asset(filename: string): string {
  return `${LOCAL_BASE}/${filename}`;
}

export const CDN_ASSETS = {
  logo: asset("speech-bubble-icon.png"),
  ringtone: asset("ringtone.mp3"),
  dashboardBg: asset("dashboard-bg.png"),
  junoCharacter: asset("juno-character.png"),
  planetOrb: asset("planet_orb_transparent.webp"),
  planetOrbFallback: asset("planet_orb_transparent.png"),
  themes: {
    frost: asset("theme-frost.png"),
    liquidBlue: asset("theme-liquid-blue.png"),
    blueLines: asset("theme-blue-lines.png"),
    aurora: asset("theme-aurora.png"),
    storm: asset("theme-storm.png"),
    ember: asset("theme-ember.png"),
    void: asset("theme-void.png"),
    forest: asset("theme-forest.png"),
    prism: asset("theme-prism.png"),
    circuit: asset("theme-circuit.png"),
    spectrum: asset("theme-spectrum.jpg"),
    silver: asset("theme-silver.png"),
    deepBlack: asset("theme-deep-black.png"),
    rainGlass: asset("theme-rain-glass.png"),
  },
  cdn: CDN_BASE,
} as const;
