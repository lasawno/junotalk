import { useState, useEffect } from "react";
import { MapPin, Navigation, X, Clock, Sun, Infinity as InfinityIcon } from "lucide-react";

export type LocationPayload = {
  lat: number;
  lng: number;
  name: string;
  expiresAt?: number;
};

type Props = {
  onShare: (payload: LocationPayload) => void;
  onClose: () => void;
};

const LIVE_OPTIONS: {
  label: string;
  icon: typeof Clock;
  getExpiry: () => number;
}[] = [
  {
    label: "Share for 1 Hour",
    icon: Clock,
    getExpiry: () => Date.now() + 60 * 60 * 1000,
  },
  {
    label: "Share Until End of Day",
    icon: Sun,
    getExpiry: () => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    },
  },
  {
    label: "Share Indefinitely",
    icon: InfinityIcon,
    getExpiry: () => Date.now() + 7 * 24 * 60 * 60 * 1000,
  },
];

function buildStaticMapUrl(lat: number, lng: number) {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=300x160&markers=${lat},${lng},lightblue`;
}

export default function LocationShareSheet({ onShare, onClose }: Props) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [placeName, setPlaceName] = useState("Current Location");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setLoading(false);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { "Accept-Language": "en" } }
          );
          if (res.ok) {
            const data = await res.json();
            const a = data.address || {};
            const name =
              [a.road, a.city || a.town || a.village || a.county]
                .filter(Boolean)
                .join(", ") ||
              data.display_name?.split(",").slice(0, 2).join(",").trim() ||
              "Current Location";
            setPlaceName(name);
          }
        } catch {
          // keep default
        }
      },
      (err) => {
        setError(
          err.code === 1
            ? "Location permission was denied. Please allow location access and try again."
            : "Could not get your current location."
        );
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }, []);

  const handleShare = (expiresAt?: number) => {
    if (!coords) return;
    onShare({ lat: coords.lat, lng: coords.lng, name: placeName, expiresAt });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-background rounded-t-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm text-foreground">Share Location</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-muted transition-colors"
            data-testid="button-close-location-sheet"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="relative bg-muted overflow-hidden" style={{ height: 160 }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-7 h-7 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">Getting location…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <MapPin className="w-9 h-9 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          )}
          {coords && !error && !mapFailed && (
            <img
              src={buildStaticMapUrl(coords.lat, coords.lng)}
              alt="Map preview"
              className="w-full h-full object-cover"
              onError={() => setMapFailed(true)}
            />
          )}
          {coords && !error && mapFailed && (
            <div className="absolute inset-0 bg-[#1a2840] flex items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-blue-400/60">
                <MapPin className="w-10 h-10" />
                <span className="text-[11px]">
                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                </span>
              </div>
            </div>
          )}
          {coords && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-14 h-14 rounded-full bg-blue-400/20 animate-ping" />
                <div className="w-9 h-9 rounded-full bg-blue-500 border-[3px] border-white shadow-lg flex items-center justify-center z-10">
                  <Navigation className="w-4 h-4 text-white fill-white" />
                </div>
              </div>
            </div>
          )}
        </div>

        {coords && (
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{placeName}</p>
              <p className="text-[11px] text-muted-foreground">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            </div>
          </div>
        )}

        <div className="p-3 space-y-2 pb-7">
          <button
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ background: "hsl(215 70% 55%)" }}
            onClick={() => handleShare(undefined)}
            disabled={!coords}
            data-testid="button-share-location-once"
          >
            <MapPin className="w-4 h-4 flex-shrink-0" />
            Share Location
          </button>

          <p className="text-[11px] text-muted-foreground px-1 pt-1 font-medium uppercase tracking-wide">
            Live Location
          </p>

          {LIVE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.label}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border text-sm font-medium text-foreground text-left hover:bg-muted/50 transition-colors disabled:opacity-40"
                onClick={() => handleShare(opt.getExpiry())}
                disabled={!coords}
                data-testid={`button-share-live-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
