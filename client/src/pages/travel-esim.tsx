import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Wifi, Signal, ChevronRight, Search, Smartphone, QrCode, MapPin, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import BackTriangle from "@/components/BackTriangle";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";

const ESIM_PROVIDER_URL = "https://www.airalo.com";

const REGIONS = [
  { id: "popular", label: "Popular" },
  { id: "americas", label: "Americas" },
  { id: "europe", label: "Europe" },
  { id: "asia", label: "Asia" },
  { id: "africa", label: "Africa" },
  { id: "oceania", label: "Oceania" },
];

interface ESimDestination {
  id: string;
  country: string;
  flag: string;
  region: string;
  slug: string;
}

const DESTINATIONS: ESimDestination[] = [
  { id: "us", country: "United States", flag: "🇺🇸", region: "americas", slug: "united-states-esim" },
  { id: "mx", country: "Mexico", flag: "🇲🇽", region: "americas", slug: "mexico-esim" },
  { id: "jp", country: "Japan", flag: "🇯🇵", region: "asia", slug: "japan-esim" },
  { id: "th", country: "Thailand", flag: "🇹🇭", region: "asia", slug: "thailand-esim" },
  { id: "kr", country: "South Korea", flag: "🇰🇷", region: "asia", slug: "south-korea-esim" },
  { id: "gb", country: "United Kingdom", flag: "🇬🇧", region: "europe", slug: "united-kingdom-esim" },
  { id: "eu", country: "Europe (Regional)", flag: "🇪🇺", region: "europe", slug: "europe-esim" },
  { id: "ca", country: "Canada", flag: "🇨🇦", region: "americas", slug: "canada-esim" },
  { id: "br", country: "Brazil", flag: "🇧🇷", region: "americas", slug: "brazil-esim" },
  { id: "au", country: "Australia", flag: "🇦🇺", region: "oceania", slug: "australia-esim" },
  { id: "de", country: "Germany", flag: "🇩🇪", region: "europe", slug: "germany-esim" },
  { id: "fr", country: "France", flag: "🇫🇷", region: "europe", slug: "france-esim" },
  { id: "it", country: "Italy", flag: "🇮🇹", region: "europe", slug: "italy-esim" },
  { id: "es", country: "Spain", flag: "🇪🇸", region: "europe", slug: "spain-esim" },
  { id: "in", country: "India", flag: "🇮🇳", region: "asia", slug: "india-esim" },
  { id: "cn", country: "China", flag: "🇨🇳", region: "asia", slug: "china-esim" },
  { id: "tr", country: "Turkey", flag: "🇹🇷", region: "europe", slug: "turkey-esim" },
  { id: "za", country: "South Africa", flag: "🇿🇦", region: "africa", slug: "south-africa-esim" },
  { id: "eg", country: "Egypt", flag: "🇪🇬", region: "africa", slug: "egypt-esim" },
  { id: "ae", country: "United Arab Emirates", flag: "🇦🇪", region: "asia", slug: "united-arab-emirates-esim" },
  { id: "ng", country: "Nigeria", flag: "🇳🇬", region: "africa", slug: "nigeria-esim" },
  { id: "nz", country: "New Zealand", flag: "🇳🇿", region: "oceania", slug: "new-zealand-esim" },
  { id: "ar", country: "Argentina", flag: "🇦🇷", region: "americas", slug: "argentina-esim" },
  { id: "co", country: "Colombia", flag: "🇨🇴", region: "americas", slug: "colombia-esim" },
  { id: "pt", country: "Portugal", flag: "🇵🇹", region: "europe", slug: "portugal-esim" },
  { id: "nl", country: "Netherlands", flag: "🇳🇱", region: "europe", slug: "netherlands-esim" },
  { id: "be", country: "Belgium", flag: "🇧🇪", region: "europe", slug: "belgium-esim" },
  { id: "ch", country: "Switzerland", flag: "🇨🇭", region: "europe", slug: "switzerland-esim" },
  { id: "at", country: "Austria", flag: "🇦🇹", region: "europe", slug: "austria-esim" },
  { id: "se", country: "Sweden", flag: "🇸🇪", region: "europe", slug: "sweden-esim" },
  { id: "no", country: "Norway", flag: "🇳🇴", region: "europe", slug: "norway-esim" },
  { id: "dk", country: "Denmark", flag: "🇩🇰", region: "europe", slug: "denmark-esim" },
  { id: "fi", country: "Finland", flag: "🇫🇮", region: "europe", slug: "finland-esim" },
  { id: "ie", country: "Ireland", flag: "🇮🇪", region: "europe", slug: "ireland-esim" },
  { id: "pl", country: "Poland", flag: "🇵🇱", region: "europe", slug: "poland-esim" },
  { id: "cz", country: "Czech Republic", flag: "🇨🇿", region: "europe", slug: "czech-republic-esim" },
  { id: "gr", country: "Greece", flag: "🇬🇷", region: "europe", slug: "greece-esim" },
  { id: "hu", country: "Hungary", flag: "🇭🇺", region: "europe", slug: "hungary-esim" },
  { id: "ro", country: "Romania", flag: "🇷🇴", region: "europe", slug: "romania-esim" },
  { id: "hr", country: "Croatia", flag: "🇭🇷", region: "europe", slug: "croatia-esim" },
  { id: "bg", country: "Bulgaria", flag: "🇧🇬", region: "europe", slug: "bulgaria-esim" },
  { id: "is", country: "Iceland", flag: "🇮🇸", region: "europe", slug: "iceland-esim" },
  { id: "ru", country: "Russia", flag: "🇷🇺", region: "europe", slug: "russia-esim" },
  { id: "ua", country: "Ukraine", flag: "🇺🇦", region: "europe", slug: "ukraine-esim" },
  { id: "il", country: "Israel", flag: "🇮🇱", region: "asia", slug: "israel-esim" },
  { id: "sa", country: "Saudi Arabia", flag: "🇸🇦", region: "asia", slug: "saudi-arabia-esim" },
  { id: "qa", country: "Qatar", flag: "🇶🇦", region: "asia", slug: "qatar-esim" },
  { id: "sg", country: "Singapore", flag: "🇸🇬", region: "asia", slug: "singapore-esim" },
  { id: "my", country: "Malaysia", flag: "🇲🇾", region: "asia", slug: "malaysia-esim" },
  { id: "id", country: "Indonesia", flag: "🇮🇩", region: "asia", slug: "indonesia-esim" },
  { id: "ph", country: "Philippines", flag: "🇵🇭", region: "asia", slug: "philippines-esim" },
  { id: "vn", country: "Vietnam", flag: "🇻🇳", region: "asia", slug: "vietnam-esim" },
  { id: "tw", country: "Taiwan", flag: "🇹🇼", region: "asia", slug: "taiwan-esim" },
  { id: "hk", country: "Hong Kong", flag: "🇭🇰", region: "asia", slug: "hong-kong-esim" },
  { id: "pk", country: "Pakistan", flag: "🇵🇰", region: "asia", slug: "pakistan-esim" },
  { id: "bd", country: "Bangladesh", flag: "🇧🇩", region: "asia", slug: "bangladesh-esim" },
  { id: "lk", country: "Sri Lanka", flag: "🇱🇰", region: "asia", slug: "sri-lanka-esim" },
  { id: "np", country: "Nepal", flag: "🇳🇵", region: "asia", slug: "nepal-esim" },
  { id: "mm", country: "Myanmar", flag: "🇲🇲", region: "asia", slug: "myanmar-esim" },
  { id: "kh", country: "Cambodia", flag: "🇰🇭", region: "asia", slug: "cambodia-esim" },
  { id: "la", country: "Laos", flag: "🇱🇦", region: "asia", slug: "laos-esim" },
  { id: "mn", country: "Mongolia", flag: "🇲🇳", region: "asia", slug: "mongolia-esim" },
  { id: "uz", country: "Uzbekistan", flag: "🇺🇿", region: "asia", slug: "uzbekistan-esim" },
  { id: "kz", country: "Kazakhstan", flag: "🇰🇿", region: "asia", slug: "kazakhstan-esim" },
  { id: "pe", country: "Peru", flag: "🇵🇪", region: "americas", slug: "peru-esim" },
  { id: "cl", country: "Chile", flag: "🇨🇱", region: "americas", slug: "chile-esim" },
  { id: "ec", country: "Ecuador", flag: "🇪🇨", region: "americas", slug: "ecuador-esim" },
  { id: "cr", country: "Costa Rica", flag: "🇨🇷", region: "americas", slug: "costa-rica-esim" },
  { id: "pa", country: "Panama", flag: "🇵🇦", region: "americas", slug: "panama-esim" },
  { id: "do", country: "Dominican Republic", flag: "🇩🇴", region: "americas", slug: "dominican-republic-esim" },
  { id: "gt", country: "Guatemala", flag: "🇬🇹", region: "americas", slug: "guatemala-esim" },
  { id: "uy", country: "Uruguay", flag: "🇺🇾", region: "americas", slug: "uruguay-esim" },
  { id: "jm", country: "Jamaica", flag: "🇯🇲", region: "americas", slug: "jamaica-esim" },
  { id: "pr", country: "Puerto Rico", flag: "🇵🇷", region: "americas", slug: "puerto-rico-esim" },
  { id: "ke", country: "Kenya", flag: "🇰🇪", region: "africa", slug: "kenya-esim" },
  { id: "gh", country: "Ghana", flag: "🇬🇭", region: "africa", slug: "ghana-esim" },
  { id: "tz", country: "Tanzania", flag: "🇹🇿", region: "africa", slug: "tanzania-esim" },
  { id: "et", country: "Ethiopia", flag: "🇪🇹", region: "africa", slug: "ethiopia-esim" },
  { id: "ma", country: "Morocco", flag: "🇲🇦", region: "africa", slug: "morocco-esim" },
  { id: "tn", country: "Tunisia", flag: "🇹🇳", region: "africa", slug: "tunisia-esim" },
  { id: "sn", country: "Senegal", flag: "🇸🇳", region: "africa", slug: "senegal-esim" },
  { id: "cm", country: "Cameroon", flag: "🇨🇲", region: "africa", slug: "cameroon-esim" },
  { id: "ci", country: "Ivory Coast", flag: "🇨🇮", region: "africa", slug: "ivory-coast-esim" },
  { id: "ug", country: "Uganda", flag: "🇺🇬", region: "africa", slug: "uganda-esim" },
  { id: "rw", country: "Rwanda", flag: "🇷🇼", region: "africa", slug: "rwanda-esim" },
  { id: "mz", country: "Mozambique", flag: "🇲🇿", region: "africa", slug: "mozambique-esim" },
  { id: "fj", country: "Fiji", flag: "🇫🇯", region: "oceania", slug: "fiji-esim" },
  { id: "pg", country: "Papua New Guinea", flag: "🇵🇬", region: "oceania", slug: "papua-new-guinea-esim" },
];

const HOW_IT_WORKS = [
  { icon: Globe, title: "Pick Your Destination", desc: "Browse eSIM plans for your travel country" },
  { icon: Smartphone, title: "Choose a Plan", desc: "Select the data plan that fits your trip" },
  { icon: QrCode, title: "Get Your QR Code", desc: "Receive an instant activation QR code" },
  { icon: Signal, title: "Scan & Connect", desc: "Scan in your phone settings and go online" },
];

export default function TravelESim() {
  const [, setLocation] = useLocation();
  const [selectedRegion, setSelectedRegion] = useState("popular");
  const [searchQuery, setSearchQuery] = useState("");

  useSEO(SEO_CONFIGS.travelEsim);

  const filteredCountries = DESTINATIONS.filter(c => {
    if (searchQuery) {
      return c.country.toLowerCase().includes(searchQuery.toLowerCase());
    }
    if (selectedRegion === "popular") {
      return ["mx", "jp", "eu", "us", "th", "gb"].includes(c.id);
    }
    return c.region === selectedRegion;
  });

  const getProviderLink = (slug: string) => {
    return `${ESIM_PROVIDER_URL}/${slug}`;
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg, #020310 0%, #152a58 40%, #020310 100%)" }}>
      <header className="sticky top-0 z-30 backdrop-blur border-b border-white/5" style={{ background: "rgba(2,3,12,0.85)" }}>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-0">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back-esim" size="sm" label="Travel eSIM" />
          </div>
          <Badge variant="outline" className="border-teal-500/30 text-teal-400 text-[11px]">
            <Wifi className="w-3 h-3 mr-1" />
            Instant Data
          </Badge>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        <div className="px-4 pt-5 pb-3">
          <div className="text-center mb-5">
            <h2 className="text-xl font-bold text-white mb-1">Stay Connected Anywhere</h2>
            <p className="text-sm text-blue-200/60">Get an eSIM for your destination. No roaming fees.</p>
          </div>

          <div className="flex gap-2 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 z-10" />
              <Input
                type="text"
                placeholder="Search countries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-teal-500/50"
                data-testid="input-esim-search"
              />
            </div>
          </div>

          {!searchQuery && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide">
              {REGIONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRegion(r.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    selectedRegion === r.id
                      ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                  }`}
                  data-testid={`button-region-${r.id}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4">
          <div className="grid gap-2.5">
            {filteredCountries.map(country => (
              <a
                key={country.id}
                href={getProviderLink(country.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left rounded-xl border border-white/8 hover:border-teal-500/20 transition-colors block"
                style={{ background: "linear-gradient(135deg, rgba(15,26,46,0.9) 0%, rgba(22,34,64,0.7) 100%)" }}
                data-testid={`card-country-${country.id}`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-2xl">{country.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate" data-testid={`text-country-name-${country.id}`}>{country.country}</p>
                    <p className="text-[11px] text-teal-400/60">View eSIM plans</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5 text-white/25" />
                    <ChevronRight className="w-4 h-4 text-white/20" />
                  </div>
                </div>
              </a>
            ))}
            {filteredCountries.length === 0 && (
              <div className="text-center py-12" data-testid="text-no-countries-found">
                <MapPin className="w-8 h-8 text-white/20 mx-auto mb-2" />
                <p className="text-sm text-white/40">No countries found</p>
                <p className="text-xs text-white/25 mt-1">Try a different search term</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 mt-8 mb-6">
          <Button
            className="w-full h-12 rounded-xl font-semibold text-base mb-4"
            style={{ background: "linear-gradient(135deg, #14b8a6, #0d9488)" }}
            asChild
            data-testid="button-browse-all-esim"
          >
            <a href={ESIM_PROVIDER_URL} target="_blank" rel="noopener noreferrer">
              <Globe className="w-5 h-5 mr-2" />
              Browse All eSIM Plans
              <ExternalLink className="w-4 h-4 ml-2" />
            </a>
          </Button>

          <h3 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wider">How it works</h3>
          <div className="grid gap-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5"
                style={{ background: "rgba(15,26,46,0.5)" }}
                data-testid={`card-how-step-${i}`}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(20,184,166,0.15)" }}>
                  <step.icon className="w-4 h-4 text-teal-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{step.title}</p>
                  <p className="text-[11px] text-white/40">{step.desc}</p>
                </div>
                <div className="ml-auto w-6 h-6 rounded-full border border-white/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs text-white/40 font-bold">{i + 1}</span>
                </div>
              </div>
            ))}
          </div>

          <Card className="mt-5 border border-teal-500/15" style={{ background: "linear-gradient(140deg, #1a3a6e 0%, #0d2a2a 50%, #1a3a6e 100%)" }}>
            <CardContent className="p-4 text-center">
              <Wifi className="w-6 h-6 text-teal-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-white mb-1">Travel + Translate</p>
              <p className="text-xs text-white/40 leading-relaxed">
                Get mobile data, translate conversations, and message anyone worldwide. All inside JunoTalk.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}
