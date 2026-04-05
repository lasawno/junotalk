import { useEffect } from "react";

interface SEOConfig {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: string;
  robots?: string;
  jsonLd?: Record<string, unknown>;
}

const BASE_URL = "https://junotalk.app";
const DEFAULT_IMAGE = `${BASE_URL}/og-image.png`;
const DEFAULT_TITLE = "JunoTalk: Powered by Juno Intelligence";

function setMeta(attr: string, key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

export function useSEO(config: SEOConfig) {
  useEffect(() => {
    const prevTitle = document.title;

    document.title = config.title;

    setMeta("name", "description", config.description);
    if (config.keywords) {
      setMeta("name", "keywords", config.keywords);
    }
    setMeta("name", "robots", config.robots || "index, follow");

    const ogImage = config.ogImage || DEFAULT_IMAGE;
    setMeta("property", "og:title", config.title);
    setMeta("property", "og:description", config.description);
    setMeta("property", "og:type", config.ogType || "website");
    setMeta("property", "og:site_name", "JunoTalk");
    setMeta("property", "og:url", config.canonical || BASE_URL);
    setMeta("property", "og:image", ogImage);

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", config.title);
    setMeta("name", "twitter:description", config.description);
    setMeta("name", "twitter:image", ogImage);

    if (config.canonical) {
      setLink("canonical", config.canonical);
    }

    let ldEl: HTMLScriptElement | null = null;
    if (config.jsonLd) {
      ldEl = document.createElement("script");
      ldEl.type = "application/ld+json";
      ldEl.id = "page-ld-json";
      ldEl.textContent = JSON.stringify(config.jsonLd);
      const existing = document.getElementById("page-ld-json");
      if (existing) existing.remove();
      document.head.appendChild(ldEl);
    }

    return () => {
      document.title = prevTitle;
      if (ldEl) ldEl.remove();
    };
  }, [config.title, config.description, config.canonical]);
}

export const SEO_CONFIGS = {
  landing: {
    title: "JunoTalk: Powered by Juno Intelligence",
    description: "Secure messaging, voice and video, powered by Juno Intelligence. Communicate across languages without barriers.",
    keywords: "JunoTalk, Juno Intelligence, secure messaging, encrypted messaging, phone calls, video chat, Juno Vision, camera translation, real-time translation, end-to-end encryption, multilingual chat, travel eSIM",
    canonical: `${BASE_URL}/`,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "JunoTalk",
      "url": BASE_URL,
      "description": "Encrypted messaging, phone calls and video chat powered by Juno Intelligence. Juno Vision identifies and translates anything your camera sees. No phone number required.",
      "applicationCategory": "CommunicationApplication",
      "operatingSystem": "Web, iOS, Android",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "featureList": "End-to-End Encrypted Messaging, Phone Calls, Video Chat, Juno Intelligence AI, Juno Vision Camera Translation, Multilingual Chat, Travel eSIM, No Phone Number Required",
      "creator": { "@type": "Organization", "name": "JunoTalk", "url": BASE_URL },
    },
  },
  home: {
    title: "JunoTalk: Powered by Juno Intelligence",
    description: "Encrypted messaging, phone calls and video chat powered by Juno Intelligence. Juno Vision identifies and translates anything your camera sees. No phone number required.",
    keywords: "JunoTalk, Juno Intelligence, encrypted messaging, HD video calls, voice calls, encrypted calls, multilingual chat, secure messaging, real-time translation, travel eSIM",
    canonical: `${BASE_URL}/`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "JunoTalk",
      "url": BASE_URL,
      "applicationCategory": "CommunicationApplication",
      "operatingSystem": "Web",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    },
  },
  voiceTranslate: {
    title: "Juno Intelligence | JunoTalk",
    description: "Juno Intelligence is the AI engine behind JunoTalk: conversational, context-aware, and always ready to help. Ask anything, translate on demand, and reason through ideas by voice.",
    keywords: "Juno Intelligence, JunoTalk, conversational AI, AI assistant, reasoning AI, voice AI, on-demand translation, personal AI",
    canonical: `${BASE_URL}/juno`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Juno Intelligence",
      "description": "Juno Intelligence, the AI engine powering JunoTalk. Conversational, voice-activated, and capable of on-demand translation.",
      "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE_URL },
    },
  },
  travelEsim: {
    title: "Travel eSIM - Instant Data Worldwide | JunoTalk",
    description: "Get instant travel eSIM data plans for multiple countries worldwide. No roaming fees, no physical SIM card. Pick your destination, choose a plan, scan a QR code, and stay connected.",
    keywords: "travel eSIM, international data plan, eSIM for travel, roaming free data, mobile data abroad, instant eSIM activation, QR code eSIM, global data plan",
    canonical: `${BASE_URL}/travel-esim`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Travel eSIM - Instant Mobile Data",
      "description": "Instant travel eSIM data plans for multiple countries worldwide. No roaming fees, no physical SIM needed.",
      "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE_URL },
    },
  },
  earning: {
    title: "JunoTalk Partner Program | Earn Online Opportunities",
    description: "Earn online with JunoTalk partners. Discover remote earning opportunities, digital work programs, and global partner collaborations.",
    keywords: "earn online, remote work, digital tasks, earning opportunities, partner program, quick rewards, language gigs, freelance, JunoTalk",
    canonical: `${BASE_URL}/earning`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "JunoTalk Partner & Earnings Program",
      "description": "Partner opportunities and earning programs available through JunoTalk.",
      "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE_URL },
    },
  },
  privacy: {
    title: "Privacy Policy | JunoTalk",
    description: "JunoTalk privacy policy. Learn how we protect your data with AES-256 encryption, GDPR compliance, and end-to-end encrypted messaging. No phone numbers or social media required.",
    keywords: "JunoTalk privacy policy, data protection, AES-256 encryption, GDPR compliant, encrypted messaging privacy",
    canonical: `${BASE_URL}/privacy`,
  },
  support: {
    title: "Support & Help Center | JunoTalk",
    description: "Get help with JunoTalk. Find answers about encrypted messaging, Juno Intelligence, video calls, travel eSIM, and account settings.",
    keywords: "JunoTalk support, Juno Intelligence support, help center, customer support, messaging help, eSIM support",
    canonical: `${BASE_URL}/support`,
  },
  feedback: {
    title: "Feedback | JunoTalk",
    description: "Share your feedback about JunoTalk. Help us improve encrypted messaging, Juno Intelligence, video calls, and travel eSIM features.",
    keywords: "JunoTalk feedback, Juno Intelligence feedback, app feedback, feature requests, bug reports",
    canonical: `${BASE_URL}/feedback`,
  },
  chatRooms: {
    title: "Encrypted Chat Rooms | JunoTalk",
    description: "Create and join end-to-end encrypted chat rooms. Messages are automatically translated to each participant's language. Share a 6-character code to connect instantly.",
    robots: "noindex, nofollow",
  },
  calls: {
    title: "HD Video Calls with Live Translation | JunoTalk",
    description: "Make HD video calls with live AI-translated captions. Crystal clear video with real-time speech translation across multiple languages.",
    robots: "noindex, nofollow",
  },
  settings: {
    title: "Settings | JunoTalk",
    description: "Manage your JunoTalk settings.",
    robots: "noindex, nofollow",
  },
  profile: {
    title: "Profile | JunoTalk",
    description: "Manage your JunoTalk profile.",
    robots: "noindex, nofollow",
  },
} as const;
