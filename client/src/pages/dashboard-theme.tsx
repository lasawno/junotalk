import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Check, Palette, Plus, Trash2, ImagePlus, Home, Settings, ChevronLeft } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { useSEO } from "@/hooks/use-seo";
import { useToast } from "@/hooks/use-toast";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { CDN_ASSETS } from "@/lib/cdn";
import blueTextureBg from "@assets/2232E96E-A241-42E0-8DD4-F284B9E0672F_1774918044204.png";
import mossyForestBg from "@assets/Brown_Simple_Smoke_Phone_Wallpaper_1775058777454.jpeg";

export const THEME_KEY = STORAGE_KEYS.dashboardTheme;
export const CUSTOM_THEMES_KEY = STORAGE_KEYS.customThemes;

export interface ThemeEntry {
  id: string;
  name: string;
  description: string;
  preview: string | null;
  bg: string | null;
  overlay: number;
  isCustom?: boolean;
}

export const DEFAULT_THEME_ID = "blue-texture";

export const THEMES: ThemeEntry[] = [
  { id: "liquid-blue",name: "Liquid Blue",      description: "Glossy blue silk waves",      preview: CDN_ASSETS.themes.liquidBlue, bg: CDN_ASSETS.themes.liquidBlue, overlay: 0.18 },
  { id: "navy",       name: "Navy Blue",        description: "Classic solid navy blue",     preview: null,                         bg: null,                          overlay: 0 },
  { id: "frost",      name: "Frost",            description: "Soft icy blue-white",         preview: CDN_ASSETS.themes.frost,      bg: CDN_ASSETS.themes.frost,      overlay: 0.32 },
  { id: "blue-lines", name: "Blue Lines",       description: "Dark navy flowing waves",     preview: CDN_ASSETS.themes.blueLines,  bg: CDN_ASSETS.themes.blueLines,  overlay: 0.14 },
  { id: "aurora",     name: "Aurora",           description: "Blue and purple aurora",      preview: CDN_ASSETS.themes.aurora,     bg: CDN_ASSETS.themes.aurora,     overlay: 0.18 },
  { id: "storm",      name: "Storm",            description: "Dark dramatic cloudscape",    preview: CDN_ASSETS.themes.storm,      bg: CDN_ASSETS.themes.storm,      overlay: 0.14 },
  { id: "ember",      name: "Ember",            description: "Dark smoldering smoke",       preview: CDN_ASSETS.themes.ember,      bg: CDN_ASSETS.themes.ember,      overlay: 0.22 },
  { id: "void",       name: "Void",             description: "Alien purple landscape",      preview: CDN_ASSETS.themes.void,       bg: CDN_ASSETS.themes.void,       overlay: 0.25 },
  { id: "forest",     name: "Enchanted Forest", description: "Glowing magical woodland",    preview: CDN_ASSETS.themes.forest,     bg: CDN_ASSETS.themes.forest,     overlay: 0.10 },
  { id: "prism",      name: "Prism",            description: "Purple to green geometric",   preview: CDN_ASSETS.themes.prism,      bg: CDN_ASSETS.themes.prism,      overlay: 0.10 },
  { id: "circuit",    name: "Circuit",          description: "Blue tech circuitry",         preview: CDN_ASSETS.themes.circuit,    bg: CDN_ASSETS.themes.circuit,    overlay: 0.08 },
  { id: "spectrum",   name: "Spectrum",         description: "Colorful gradient blend",     preview: CDN_ASSETS.themes.spectrum,   bg: CDN_ASSETS.themes.spectrum,   overlay: 0.12 },
  { id: "silver",     name: "Silver",           description: "Clean light grey mist",       preview: CDN_ASSETS.themes.silver,     bg: CDN_ASSETS.themes.silver,     overlay: 0.30 },
  { id: "deep-black", name: "Deep Black",       description: "Pure dark minimal backdrop",  preview: CDN_ASSETS.themes.deepBlack,  bg: CDN_ASSETS.themes.deepBlack,  overlay: 0.05 },
  { id: "rain-glass",    name: "Rain Glass",      description: "Blue raindrop window",        preview: CDN_ASSETS.themes.rainGlass,  bg: CDN_ASSETS.themes.rainGlass,  overlay: 0.12 },
  { id: "blue-texture",  name: "Blue Texture",    description: "Royal blue leather finish",   preview: blueTextureBg,                bg: blueTextureBg,                overlay: 0.08 },
  { id: "mossy-forest",  name: "Mossy Forest",    description: "Lush green woodland canopy",   preview: mossyForestBg,                bg: mossyForestBg,                overlay: 0.30 },
];

function loadCustomThemes(): ThemeEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomThemes(themes: ThemeEntry[]) {
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

export default function DashboardTheme() {
  useSEO({ title: "Dashboard Theme | JunoTalk", description: "Customize your dashboard background" });
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<string>(() =>
    localStorage.getItem(THEME_KEY) || "blue-texture"
  );
  const [customThemes, setCustomThemes] = useState<ThemeEntry[]>(loadCustomThemes);

  // Persist default for first-time visitors
  useEffect(() => {
    if (!localStorage.getItem(THEME_KEY)) {
      localStorage.setItem(THEME_KEY, "blue-texture");
    }
  }, []);

  const [addingTheme, setAddingTheme] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingOverlay, setPendingOverlay] = useState(0.35);
  const [nameLoading, setNameLoading] = useState(false);

  const handleSelect = (id: string) => {
    setSelected(id);
    localStorage.setItem(THEME_KEY, id);
    window.dispatchEvent(new Event("storage"));
  };

  const analyzeImage = (dataUrl: string): Promise<{ brightness: number; r: number; g: number; b: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const SAMPLE = 80;
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve({ brightness: 0.5, r: 100, g: 100, b: 100 }); return; }
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
        let totalLum = 0, totalR = 0, totalG = 0, totalB = 0;
        const px = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          totalR += data[i]; totalG += data[i + 1]; totalB += data[i + 2];
          totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        resolve({ brightness: totalLum / px / 255, r: totalR / px, g: totalG / px, b: totalB / px });
      };
      img.onerror = () => resolve({ brightness: 0.5, r: 100, g: 100, b: 100 });
      img.src = dataUrl;
    });
  };

  const generateThemeName = (brightness: number, r: number, g: number, b: number): string => {
    const max = Math.max(r, g, b);
    const isBlue    = b === max && b > r * 1.2 && b > g * 1.1;
    const isGreen   = g === max && g > r * 1.2 && g > b * 1.1;
    const isRed     = r === max && r > g * 1.25 && r > b * 1.25;
    const isPurple  = r > g * 1.1 && b > g * 1.1 && !isRed;
    const isTeal    = g > r * 1.1 && b > r * 1.1 && !isGreen;
    const isWarm    = r > b * 1.15 && g > b * 1.05;

    const dark = brightness < 0.25;
    const mid  = brightness >= 0.25 && brightness < 0.60;

    if (isBlue)   return dark ? "Midnight Blue"  : mid ? "Rain Glass"    : "Arctic Sky";
    if (isTeal)   return dark ? "Deep Teal"      : mid ? "Ocean Haze"    : "Cyan Drift";
    if (isGreen)  return dark ? "Dark Canopy"    : mid ? "Forest Mist"   : "Jade Glow";
    if (isPurple) return dark ? "Deep Violet"    : mid ? "Purple Haze"   : "Lavender Mist";
    if (isRed)    return dark ? "Dark Ember"     : mid ? "Crimson Haze"  : "Rose Glow";
    if (isWarm)   return dark ? "Dark Amber"     : mid ? "Sunset Haze"   : "Golden Light";
    return               dark ? "Shadow Veil"    : mid ? "Silver Mist"   : "Pearl Cloud";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are supported", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setPendingImage(dataUrl);
      setPendingName("");
      setNameLoading(true);
      setAddingTheme(true);
      const { brightness, r, g, b } = await analyzeImage(dataUrl);
      setPendingOverlay(Math.round((0.12 + brightness * 0.50) * 100) / 100);
      setPendingName(generateThemeName(brightness, r, g, b));
      setNameLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveCustomTheme = () => {
    if (!pendingImage) return;
    const name = pendingName.trim() || "My Theme";
    const newTheme: ThemeEntry = {
      id: `custom-${Date.now()}`,
      name,
      description: "Custom theme",
      preview: pendingImage,
      bg: pendingImage,
      overlay: pendingOverlay,
      isCustom: true,
    };
    try {
      const updated = [...customThemes, newTheme];
      saveCustomThemes(updated);
      setCustomThemes(updated);
      setAddingTheme(false);
      setPendingImage(null);
      setPendingName("");
      setPendingOverlay(0.35);
      setNameLoading(false);
      handleSelect(newTheme.id);
      toast({ title: `"${name}" added` });
    } catch {
      toast({ title: "Image too large to save. Try a smaller file.", variant: "destructive" });
    }
  };

  const handleDeleteCustomTheme = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customThemes.filter((t) => t.id !== id);
    saveCustomThemes(updated);
    setCustomThemes(updated);
    if (selected === id) {
      handleSelect(DEFAULT_THEME_ID);
    }
    toast({ title: "Theme deleted" });
  };

  const allThemes = [...THEMES, ...customThemes];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="px-4 flex items-center h-14 gap-2">
          <BackTriangle onClick={() => setLocation("/settings")} testId="button-back-theme" label="Dashboard Theme" />
        </div>
      </header>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-semibold text-white">Dashboard Background</h1>
        </div>
        <p className="text-sm text-blue-200/60 -mt-4">Choose a background theme for your dashboard.</p>

        <div className="grid grid-cols-2 gap-3">
          {allThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => handleSelect(theme.id)}
              data-testid={`theme-option-${theme.id}`}
              className="relative rounded-xl overflow-hidden border-2 transition-all"
              style={{
                borderColor: selected === theme.id ? "rgba(59,130,246,0.8)" : "rgba(255,255,255,0.1)",
                background: theme.preview ? "transparent" : "linear-gradient(135deg, #1a3a6e 0%, #243a72 100%)",
              }}
            >
              <div className="aspect-video w-full relative">
                {theme.preview ? (
                  <img src={theme.preview} alt={theme.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a80 0%, #2a50a0 50%, #1a3a80 100%)" }}>
                    <span className="text-xs font-semibold text-blue-300/70">Navy</span>
                  </div>
                )}
                {selected === theme.id && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                {theme.isCustom && (
                  <button
                    onClick={(e) => handleDeleteCustomTheme(theme.id, e)}
                    data-testid={`delete-theme-${theme.id}`}
                    className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
              <div className="p-2 text-left" style={{ background: "rgba(15,26,46,0.9)" }}>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-white">{theme.name}</p>
                  {theme.id === DEFAULT_THEME_ID && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(59,130,246,0.22)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.35)" }}
                    >
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-blue-200/50">{theme.description}</p>
              </div>
            </button>
          ))}

          {/* Add Custom Theme card */}
          <button
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-add-custom-theme"
            className="relative rounded-xl overflow-hidden border-2 border-dashed transition-all hover:border-blue-400/60"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            <div className="aspect-video w-full flex flex-col items-center justify-center gap-1" style={{ background: "rgba(28,52,108,0.65)" }}>
              <ImagePlus className="w-6 h-6 text-blue-400/70" />
              <span className="text-[10px] text-blue-300/60">Upload image</span>
            </div>
            <div className="p-2 text-left" style={{ background: "rgba(15,26,46,0.9)" }}>
              <p className="text-xs font-semibold text-white flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Theme
              </p>
              <p className="text-[10px] text-blue-200/50">Use your own image</p>
            </div>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-custom-theme-file"
        />

        {/* Name dialog */}
        {addingTheme && pendingImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 100%)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <img src={pendingImage} alt="Preview" className="w-full h-40 object-cover" />
              <div className="p-4 space-y-3">
                <p className="text-sm font-semibold text-white">Confirm theme name</p>
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    value={nameLoading ? "" : pendingName}
                    onChange={(e) => setPendingName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !nameLoading && handleSaveCustomTheme()}
                    placeholder={nameLoading ? "Analyzing image..." : "Theme name"}
                    maxLength={30}
                    disabled={nameLoading}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-blue-300/50 outline-none border border-blue-400/30 focus:border-blue-400/70 disabled:opacity-60"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                    data-testid="input-custom-theme-name"
                  />
                  {nameLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-blue-400/40 border-t-blue-400 animate-spin" />
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAddingTheme(false); setPendingImage(null); setPendingOverlay(0.35); setNameLoading(false); }}
                    className="flex-1 py-2 rounded-lg text-sm text-blue-300/70 border border-white/10 hover:bg-white/5 transition-colors"
                    data-testid="button-cancel-custom-theme"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCustomTheme}
                    disabled={nameLoading}
                    className="flex-1 py-2 rounded-lg text-sm text-white font-semibold transition-colors disabled:opacity-50"
                    style={{ background: "rgba(59,130,246,0.8)" }}
                    data-testid="button-save-custom-theme"
                  >
                    Save Theme
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-blue-200/40 text-center">Tap a theme to apply it instantly.</p>
      </div>

      {/* Bottom navigation bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
        style={{
          background: "rgba(20,40,88,0.92)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          height: 64,
        }}
      >
        <button
          onClick={() => setLocation("/")}
          className="flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all hover:bg-white/5 active:scale-95"
          data-testid="nav-home"
        >
          <Home className="w-5 h-5 text-white/55" />
          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.55)", letterSpacing: "0.04em" }}>Home</span>
        </button>

        <button
          onClick={() => setLocation("/settings")}
          className="flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all hover:bg-white/5 active:scale-95"
          data-testid="nav-settings"
        >
          <Settings className="w-5 h-5 text-blue-400" />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#60a5fa", letterSpacing: "0.04em" }}>Settings</span>
        </button>
      </nav>

      {/* Spacer so content isn't hidden behind nav */}
      <div style={{ height: 80 }} />
    </div>
  );
}
