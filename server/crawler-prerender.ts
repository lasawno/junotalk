import type { Request, Response, NextFunction } from "express";

const BOT_UA = /googlebot|bingbot|yandexbot|duckduckbot|slurp|baiduspider|facebookexternalhit|twitterbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|applebot|semrushbot|ahrefsbot|mj12bot|ia_archiver|archive\.org_bot|lighthouse|pagespeed/i;

const BASE = "https://junotalk.app";

interface PageData {
  title: string;
  description: string;
  keywords: string;
  canonical: string;
  body: string;
  jsonLd?: object;
}

function getPageData(path: string): PageData | null {
  switch (path) {
    case "/":
    case "/home":
      return {
        title: "JunoTalk - Secure Messages, Voice, and Video Chat Powered by AI Translation",
        description: "Speak any language and be understood instantly with JunoTalk. AI voice translation, end-to-end encrypted video and voice calls, multilingual messaging, and travel eSIM. No phone number required.",
        keywords: "JunoTalk, AI voice translation, speech to speech translation, AI translator, voice translation app, real-time translation, encrypted texting, encrypted messaging, messaging app, video calls, voice calls, phone calls, HD video calling, translated texting, voice messages, voice to text, voice message transcription, AI translation, live captions, private messaging, multilingual texting, multilingual chat, text and call, chat rooms, language barrier, translate app, speak and translate, AI voice translator, secure messaging app, encrypted calls, travel eSIM, international data plan, eSIM for travel, roaming free data, mobile data abroad, earning opportunities",
        canonical: `${BASE}/`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          "name": "JunoTalk",
          "url": BASE,
          "description": "Make encrypted video and voice calls, send translated messages, and use AI voice translation across multiple languages. Travel eSIM for instant data worldwide.",
          "applicationCategory": "CommunicationApplication",
          "operatingSystem": "Web",
          "dateModified": new Date().toISOString().split("T")[0],
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
          "featureList": [
            "AI translation across multiple languages for text, voice, and video calls",
            "Encrypted HD video and voice calls with live translated captions",
            "End-to-end encrypted messaging with real-time translation",
            "AI voice translation - speak and hear translations instantly",
            "Voice-to-text transcription for voice messages",
            "Travel eSIM - instant mobile data worldwide",
            "No phone number required - connect with a 6-digit room code",
            "AES-256 encrypted personal data with GDPR compliance"
          ],
          "image": `${BASE}/og-image.png?v=5`,
          "author": { "@type": "Organization", "name": "JunoTalk", "url": BASE, "logo": { "@type": "ImageObject", "url": `${BASE}/logo-512.png`, "width": 512, "height": 512 } },
        },
        body: `
    <section style="text-align:center;padding:60px 0 40px">
      <h1 style="font-size:36px;font-weight:800;line-height:1.2;margin-bottom:16px;background:linear-gradient(135deg,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent">AI Translation, Encrypted Calls & Chat</h1>
      <p style="font-size:18px;color:#94a3b8;max-width:640px;margin:0 auto 12px;line-height:1.6">Make encrypted video and voice calls, send translated messages, and use AI voice translation across multiple languages.</p>
      <p style="font-size:16px;color:#64748b;max-width:580px;margin:0 auto 32px;line-height:1.5">No phone number required. No social media needed. Just a 6-digit code is all you need. Your privacy is everything.</p>
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Get Started Free</a>
    </section>

    <section>
      <h2 style="font-size:28px;font-weight:700;text-align:center;margin-bottom:40px;color:#f1f5f9">Everything You Need to Communicate Globally</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">
        <article style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px">
          <h3 style="font-size:18px;font-weight:600;color:#60a5fa;margin-bottom:8px">AI Translation Across Multiple Languages</h3>
          <p style="color:#94a3b8;line-height:1.6;font-size:15px">Text, voice, and video — everything is automatically translated in real time. Speak any language and be understood instantly.</p>
        </article>
        <article style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px">
          <h3 style="font-size:18px;font-weight:600;color:#34d399;margin-bottom:8px">Encrypted Calls & Messaging</h3>
          <p style="color:#94a3b8;line-height:1.6;font-size:15px">HD video calls, voice calls, and end-to-end encrypted chat. Stay connected securely with anyone, anywhere.</p>
        </article>
        <article style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px">
          <h3 style="font-size:18px;font-weight:600;color:#06b6d4;margin-bottom:8px">Travel eSIM</h3>
          <p style="color:#94a3b8;line-height:1.6;font-size:15px">Instant mobile data for multiple countries worldwide. Pick a plan, scan a QR code, and stay connected. No roaming fees.</p>
        </article>
      </div>
    </section>

    <section style="padding:40px 0">
      <h2 style="font-size:28px;font-weight:700;text-align:center;margin-bottom:32px;color:#f1f5f9">How It Works</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;max-width:960px;margin:0 auto">
        <div style="text-align:center;padding:20px">
          <h3 style="font-size:16px;font-weight:600;color:#60a5fa;margin-bottom:8px">1. Create Your Account</h3>
          <p style="color:#94a3b8;font-size:14px">Sign up quickly and securely. No phone number or social media required.</p>
        </div>
        <div style="text-align:center;padding:20px">
          <h3 style="font-size:16px;font-weight:600;color:#34d399;margin-bottom:8px">2. Create or Join a Room</h3>
          <p style="color:#94a3b8;font-size:14px">Get a unique 6-character room code. Share it with anyone to connect instantly.</p>
        </div>
        <div style="text-align:center;padding:20px">
          <h3 style="font-size:16px;font-weight:600;color:#f59e0b;margin-bottom:8px">3. Set Your Language</h3>
          <p style="color:#94a3b8;font-size:14px">Choose your preferred language. Messages and calls are automatically translated.</p>
        </div>
        <div style="text-align:center;padding:20px">
          <h3 style="font-size:16px;font-weight:600;color:#a78bfa;margin-bottom:8px">4. Communicate Freely</h3>
          <p style="color:#94a3b8;font-size:14px">Text, call, or use voice translation. Every message arrives in the recipient's language.</p>
        </div>
      </div>
    </section>

    <section style="text-align:center;padding:60px 0 40px">
      <h2 style="font-size:28px;font-weight:700;margin-bottom:12px;color:#f1f5f9">Ready to Connect Without Boundaries?</h2>
      <p style="color:#94a3b8;font-size:16px;margin-bottom:28px">Join thousands of users who communicate across languages, completely free and fully encrypted.</p>
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Get Started Free</a>
    </section>`,
      };

    case "/travel-esim":
      return {
        title: "Travel eSIM - Instant Data Worldwide | JunoTalk",
        description: "Get instant travel eSIM data plans for multiple countries worldwide. No roaming fees, no physical SIM card. Pick your destination, choose a plan, scan a QR code, and stay connected.",
        keywords: "travel eSIM, international data plan, eSIM for travel, roaming free data, mobile data abroad, instant eSIM activation, QR code eSIM, global data plan, JunoTalk eSIM",
        canonical: `${BASE}/travel-esim`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          "name": "Travel eSIM - Instant Mobile Data Worldwide",
          "description": "Get instant travel eSIM data plans for multiple countries worldwide. No roaming fees, no physical SIM card needed.",
          "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE },
        },
        body: `
    <section style="text-align:center;padding:60px 0 40px">
      <h1 style="font-size:36px;font-weight:800;line-height:1.2;margin-bottom:16px;color:#34d399">Travel eSIM - Stay Connected Worldwide</h1>
      <p style="font-size:18px;color:#94a3b8;max-width:640px;margin:0 auto 32px;line-height:1.6">Get instant mobile data wherever you travel. No roaming fees, no physical SIM card needed. Pick your destination, choose a plan, scan the QR code, and you're online.</p>
    </section>
    <section>
      <h2 style="font-size:24px;font-weight:700;margin-bottom:24px;color:#f1f5f9">How Travel eSIM Works</h2>
      <ol style="color:#94a3b8;line-height:2;font-size:16px;max-width:600px;margin:0 auto;padding-left:20px">
        <li>Browse destinations worldwide</li>
        <li>Choose a data plan that fits your needs</li>
        <li>Receive your eSIM QR code instantly</li>
        <li>Scan the QR code in your phone settings</li>
        <li>You're connected - no roaming fees</li>
      </ol>
    </section>
    <section style="padding:40px 0">
      <h2 style="font-size:24px;font-weight:700;margin-bottom:16px;color:#f1f5f9">Popular Destinations</h2>
      <p style="color:#94a3b8;font-size:16px;line-height:1.6">Mexico, Japan, Europe, United States, Thailand, United Kingdom, South Korea, Australia, Canada, Brazil, India, Turkey, and 180+ more countries with instant eSIM activation.</p>
    </section>
    <section style="text-align:center;padding:40px 0">
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Get Your Travel eSIM</a>
    </section>`,
      };

    case "/voice-translate":
      return {
        title: "Juno AI Voice Translation | JunoTalk",
        description: "Speak in your language and hear instant AI translations. Juno supports multiple languages with 6 natural AI voices. Say Hey Juno for hands-free activation. Speech-to-speech translation powered by AI.",
        keywords: "AI voice translation, speech to speech translation, Juno AI translator, real-time translation, voice translator app, speak and translate, hands-free translation, AI voice translator, JunoTalk Juno",
        canonical: `${BASE}/voice-translate`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          "name": "Juno AI Voice Translation",
          "description": "AI-powered speech-to-speech translation supporting multiple languages with natural AI voices.",
          "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE },
        },
        body: `
    <section style="text-align:center;padding:60px 0 40px">
      <h1 style="font-size:36px;font-weight:800;line-height:1.2;margin-bottom:16px;color:#60a5fa">Juno - AI Voice Translation</h1>
      <p style="font-size:18px;color:#94a3b8;max-width:640px;margin:0 auto 16px;line-height:1.6">Speak in your language and hear the translation instantly in natural AI voices. Real-time speech-to-speech translation powered by AI.</p>
      <p style="font-size:16px;color:#64748b;max-width:580px;margin:0 auto 32px">Say "Hey Juno" for hands-free voice translation. Choose from 6 natural AI voices. Supports multiple languages.</p>
    </section>
    <section>
      <h2 style="font-size:24px;font-weight:700;margin-bottom:24px;color:#f1f5f9">Juno Features</h2>
      <ul style="color:#94a3b8;line-height:2;font-size:16px;max-width:600px;margin:0 auto;padding-left:20px">
        <li>Real-time speech-to-speech translation across multiple languages</li>
        <li>Wake-word activation - say "Hey Juno" to start translating</li>
        <li>6 natural AI voices: Nova, Alloy, Echo, Fable, Onyx, Shimmer</li>
        <li>Juno Vision - point your camera at text for instant visual translation</li>
        <li>Translation history with playback</li>
        <li>Works with any language pair</li>
      </ul>
    </section>
    <section style="text-align:center;padding:40px 0">
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Try Juno Free</a>
    </section>`,
      };

    case "/earning":
      return {
        title: "JunoTalk Partner Program | Earn Online Opportunities",
        description: "Earn online with JunoTalk partners. Discover remote earning opportunities, digital work programs, and global partner collaborations.",
        keywords: "earn online, remote work, digital tasks, earning opportunities, partner program, quick rewards, language gigs, freelance, JunoTalk",
        canonical: `${BASE}/earning`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          "name": "JunoTalk Partner & Earnings Program",
          "description": "Partner opportunities and earning programs available through JunoTalk.",
          "provider": { "@type": "Organization", "name": "JunoTalk", "url": BASE },
        },
        body: `
    <section style="text-align:center;padding:60px 0 40px">
      <h1 style="font-size:36px;font-weight:800;line-height:1.2;margin-bottom:16px;color:#f59e0b">JunoTalk Partner Program</h1>
      <p style="font-size:18px;color:#94a3b8;max-width:640px;margin:0 auto 32px;line-height:1.6">Discover earning opportunities through JunoTalk's trusted partner network. Remote work, digital tasks, language gigs, and more.</p>
    </section>
    <section>
      <h2 style="font-size:24px;font-weight:700;margin-bottom:24px;color:#f1f5f9">Earning Categories</h2>
      <ul style="color:#94a3b8;line-height:2;font-size:16px;max-width:600px;margin:0 auto;padding-left:20px">
        <li>Quick Rewards - Complete simple online tasks</li>
        <li>Digital Work - Freelance and remote opportunities</li>
        <li>Language Services - Translation and interpretation gigs</li>
        <li>Content Creation - Create and share content</li>
      </ul>
    </section>
    <section style="text-align:center;padding:40px 0">
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Start Earning</a>
    </section>`,
      };

    case "/privacy":
      return {
        title: "Privacy Policy | JunoTalk",
        description: "JunoTalk privacy policy. Learn how we protect your data with AES-256 encryption, GDPR compliance, and end-to-end encrypted messaging. No phone numbers or social media required.",
        keywords: "JunoTalk privacy policy, data protection, AES-256 encryption, GDPR compliant, encrypted messaging privacy",
        canonical: `${BASE}/privacy`,
        body: `
    <section style="padding:40px 0">
      <h1 style="font-size:32px;font-weight:800;margin-bottom:24px;color:#f1f5f9">Privacy Policy</h1>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">Data Protection</h2>
      <p style="color:#94a3b8;line-height:1.8;font-size:15px">JunoTalk uses AES-256-GCM encryption for personal data at rest. All connections use HTTPS and secure WebSockets (WSS). End-to-end encryption is available for chat rooms. No phone numbers, email addresses, or social media accounts are ever exposed to other users.</p>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">What We Collect</h2>
      <p style="color:#94a3b8;line-height:1.8;font-size:15px">We collect only the minimum data necessary: display name, language preference, and encrypted message content. Voice recordings are never stored. Translation cache is encrypted. Disappearing photos are permanently deleted after viewing.</p>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">GDPR Compliance</h2>
      <p style="color:#94a3b8;line-height:1.8;font-size:15px">JunoTalk is GDPR-compliant. You can request data deletion at any time. Cookie consent is required before any non-essential cookies are set. We do not sell your data to third parties.</p>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">Security Measures</h2>
      <ul style="color:#94a3b8;line-height:2;font-size:15px;padding-left:20px">
        <li>AES-256-GCM encryption for personal data</li>
        <li>End-to-end encrypted chat rooms</li>
        <li>HTTPS/WSS for all data in transit</li>
        <li>Encrypted translation cache</li>
        <li>No call recordings stored</li>
        <li>Auto-delete for temporary content</li>
      </ul>
    </section>`,
      };

    case "/support":
      return {
        title: "Support & Help Center | JunoTalk",
        description: "Get help with JunoTalk. Find answers about encrypted messaging, AI voice translation, video calls, travel eSIM, and account settings.",
        keywords: "JunoTalk support, help center, customer support, messaging help, translation help, eSIM support",
        canonical: `${BASE}/support`,
        body: `
    <section style="padding:40px 0">
      <h1 style="font-size:32px;font-weight:800;margin-bottom:16px;color:#f1f5f9">Support & Help Center</h1>
      <p style="font-size:16px;color:#94a3b8;margin-bottom:32px;line-height:1.6">Get help with JunoTalk features including encrypted messaging, AI voice translation, HD video calls, travel eSIM, and account management.</p>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">Common Topics</h2>
      <ul style="color:#94a3b8;line-height:2;font-size:15px;padding-left:20px">
        <li>Getting started with encrypted messaging</li>
        <li>Using Juno AI voice translation</li>
        <li>Setting up HD video calls</li>
        <li>Purchasing and activating travel eSIM</li>
        <li>Managing language preferences</li>
        <li>Account settings and privacy</li>
        <li>Troubleshooting connection issues</li>
      </ul>
    </section>
    <section style="text-align:center;padding:40px 0">
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Contact Support</a>
    </section>`,
      };

    case "/feedback":
      return {
        title: "Feedback | JunoTalk",
        description: "Share your feedback about JunoTalk. Help us improve encrypted messaging, AI voice translation, video calls, and travel eSIM features.",
        keywords: "JunoTalk feedback, app feedback, feature requests, bug reports",
        canonical: `${BASE}/feedback`,
        body: `
    <section style="padding:40px 0">
      <h1 style="font-size:32px;font-weight:800;margin-bottom:16px;color:#f1f5f9">Share Your Feedback</h1>
      <p style="font-size:16px;color:#94a3b8;margin-bottom:32px;line-height:1.6">Your feedback helps us improve JunoTalk. Tell us what you love, what could be better, or suggest new features.</p>
      <h2 style="font-size:20px;font-weight:600;margin:24px 0 12px;color:#60a5fa">We'd Love to Hear About</h2>
      <ul style="color:#94a3b8;line-height:2;font-size:15px;padding-left:20px">
        <li>Feature requests and ideas</li>
        <li>Translation quality feedback</li>
        <li>User experience improvements</li>
        <li>Bug reports</li>
        <li>General comments</li>
      </ul>
    </section>
    <section style="text-align:center;padding:40px 0">
      <a href="${BASE}/api/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px">Submit Feedback</a>
    </section>`,
      };

    default:
      return null;
  }
}

function buildFaqLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What is JunoTalk?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "JunoTalk is an all-in-one communication platform where you can make encrypted video and voice calls, send translated messages, and use AI voice translation across multiple languages. It also offers travel eSIM data for multiple countries worldwide. No phone number or social media required."
        }
      },
      {
        "@type": "Question",
        "name": "How does AI Voice Translation work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Tap the microphone, speak in your language, and JunoTalk instantly transcribes, translates, and speaks the translation back using natural AI voices. Say Hey Juno to activate hands-free. Choose from 6 AI voices."
        }
      },
      {
        "@type": "Question",
        "name": "What is Travel eSIM?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "JunoTalk offers instant travel eSIM data plans for multiple countries worldwide. Pick a destination, choose a data plan, scan a QR code, and get connected. No roaming fees, no physical SIM card needed."
        }
      },
      {
        "@type": "Question",
        "name": "What is Juno Vision?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Juno Vision is JunoTalk's camera-based visual translator. Point your camera at text, signs, menus, or documents and Juno instantly translates what it sees."
        }
      },
      {
        "@type": "Question",
        "name": "What languages does JunoTalk support?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "JunoTalk supports multiple languages for text and voice translation, including English, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Hindi, Portuguese, and more."
        }
      },
      {
        "@type": "Question",
        "name": "Is JunoTalk free to use?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes, JunoTalk is free to use. All features including encrypted messaging, AI voice translation, video calls, and chat rooms are available at no cost."
        }
      },
      {
        "@type": "Question",
        "name": "How secure is JunoTalk?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "JunoTalk uses AES-256 encryption for personal data, end-to-end encryption for chat rooms, HTTPS encryption for all communications, and never stores voice recordings. No phone numbers or social media accounts are required."
        }
      }
    ]
  });
}

export function crawlerPrerender(req: Request, res: Response, next: NextFunction) {
  const ua = req.headers["user-agent"] || "";
  if (!BOT_UA.test(ua)) return next();

  if (req.path.startsWith("/api") || req.path.startsWith("/assets") || req.path.includes(".")) return next();

  const page = getPageData(req.path);
  if (!page) return next();

  const isHome = req.path === "/" || req.path === "/home";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5">
  <title>${page.title}</title>
  <meta name="description" content="${page.description}">
  <meta name="keywords" content="${page.keywords}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${page.canonical}">
  <meta property="og:title" content="${page.title}">
  <meta property="og:description" content="${page.description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="JunoTalk">
  <meta property="og:url" content="${page.canonical}">
  <meta property="og:image" content="${BASE}/og-image.png?v=5">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${page.title}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${page.title}">
  <meta name="twitter:description" content="${page.description}">
  <meta name="twitter:image" content="${BASE}/og-image.png?v=5">
  <meta name="twitter:image:alt" content="${page.title}">
  <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png?v=3">
  <link rel="icon" type="image/png" sizes="192x192" href="/logo-192.png?v=3">
  <link rel="icon" type="image/png" sizes="512x512" href="/logo-512.png?v=3">
  <link rel="apple-touch-icon" sizes="192x192" href="/logo-192.png?v=3">
  <meta name="theme-color" content="#2563A8">
  ${page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd)}</script>` : ""}
  ${isHome ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "name": "JunoTalk", "url": BASE, "logo": { "@type": "ImageObject", "url": `${BASE}/logo-512.png`, "width": 512, "height": 512 } })}</script>` : ""}
  ${isHome ? `<script type="application/ld+json">${buildFaqLd()}</script>` : ""}
</head>
<body style="font-family:Inter,system-ui,-apple-system,sans-serif;margin:0;padding:0;background:#0f1117;color:#e2e8f0">
  <header style="padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.1)">
    <nav style="max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <a href="${BASE}" style="display:flex;align-items:center;gap:8px;text-decoration:none">
        <img src="${BASE}/logo-512.png" alt="JunoTalk Logo" width="40" height="40" style="border-radius:10px">
        <span style="font-size:20px;font-weight:700;color:#60a5fa">JunoTalk</span>
      </a>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <a href="${BASE}/#features" style="color:#94a3b8;text-decoration:none;font-size:14px">Features</a>
        <a href="${BASE}/voice-translate" style="color:#94a3b8;text-decoration:none;font-size:14px">Juno AI</a>
        <a href="${BASE}/travel-esim" style="color:#94a3b8;text-decoration:none;font-size:14px">Travel eSIM</a>
        <a href="${BASE}/privacy" style="color:#94a3b8;text-decoration:none;font-size:14px">Privacy</a>
        <a href="${BASE}/support" style="color:#94a3b8;text-decoration:none;font-size:14px">Support</a>
      </div>
    </nav>
  </header>

  <main style="max-width:1200px;margin:0 auto;padding:0 24px">
    ${page.body}
  </main>

  <footer style="border-top:1px solid rgba(255,255,255,0.08);padding:32px 24px;text-align:center">
    <p style="color:#60a5fa;font-weight:600;font-size:16px;margin-bottom:16px">JunoTalk - Translate Anything</p>
    <nav>
      <a href="${BASE}/#features" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Features</a>
      <a href="${BASE}/voice-translate" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Juno AI</a>
      <a href="${BASE}/travel-esim" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Travel eSIM</a>
      <a href="${BASE}/earning" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Earn</a>
      <a href="${BASE}/privacy" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Privacy</a>
      <a href="${BASE}/support" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Support</a>
      <a href="${BASE}/feedback" style="color:#64748b;text-decoration:none;font-size:13px;margin:0 12px">Feedback</a>
    </nav>
    <p style="color:#475569;font-size:12px;margin-top:16px">&copy; 2026 JunoTalk. All rights reserved.</p>
  </footer>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  res.setHeader("X-Prerender", "1");
  res.status(200).send(html);
}
