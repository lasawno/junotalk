import BackTriangle from "@/components/BackTriangle";
import { useLocation } from "wouter";

export default function TermsOfService() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #070b14 0%, #0a0f1e 100%)" }}>
      <BackTriangle onClick={() => setLocation("/")} label="Terms of Service" />

      <div className="px-5 pt-20 pb-16 max-w-2xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
          <p className="text-xs text-white/40">Effective: January 1, 2025. Last updated: March 2026.</p>
        </div>

        <p className="text-sm text-white/65 leading-relaxed">
          By creating an account or using JunoTalk, you agree to these Terms of Service and our Privacy Policy. Please read them carefully.
        </p>

        {[
          {
            title: "1. About JunoTalk",
            body: "JunoTalk is a multilingual communication platform providing encrypted messaging, voice and video calling, and AI-powered real-time translation. We are committed to helping people communicate across language barriers securely.",
          },
          {
            title: "2. Eligibility",
            body: "You must be at least 13 years old to use JunoTalk. By using the platform, you confirm you meet this requirement. Users under 18 should have parental or guardian consent. We do not knowingly collect data from children under 13.",
          },
          {
            title: "3. Your Account",
            body: "You are responsible for maintaining the security of your account credentials. You must not share your account with others. You agree to notify us immediately of any unauthorized access. JunoTalk is not liable for losses caused by unauthorized account use.",
          },
          {
            title: "4. Acceptable Use",
            body: "You agree not to use JunoTalk to: (a) harass, threaten, or harm any person; (b) distribute illegal content; (c) impersonate others or JunoTalk staff; (d) attempt to circumvent security measures; (e) send spam, phishing messages, or scam content; (f) distribute malware or engage in cyberattacks; (g) violate any applicable law or regulation.",
          },
          {
            title: "5. AI-Powered Features",
            body: "JunoTalk uses artificial intelligence for real-time translation, speech recognition, captions, and conversational assistance. AI translations are provided for communication purposes and may not be perfectly accurate. Do not rely on AI translations for legal, medical, or safety-critical decisions. The AI assistant (Juno) is not a substitute for professional advice.",
          },
          {
            title: "6. Encryption and Privacy",
            body: "Messages and calls use end-to-end encryption. JunoTalk does not store the content of your calls. Message content is stored to enable conversation history. You can delete your data at any time from Settings. See our Privacy Policy for full details on data handling.",
          },
          {
            title: "7. Content You Share",
            body: "You retain ownership of content you share on JunoTalk. By using the platform, you grant JunoTalk a limited license to process your content solely to deliver the service (translation, storage, delivery). We do not use your messages for advertising.",
          },
          {
            title: "8. Content Moderation",
            body: "JunoTalk uses automated and human moderation to maintain a safe platform. We may remove content or suspend accounts that violate these terms. Users can report violations using the in-app report feature. Severe violations may result in permanent bans.",
          },
          {
            title: "9. Prohibited Content",
            body: "You must never share content that: depicts child sexual abuse material (CSAM) in any form; promotes, glorifies, or instructs violence against specific individuals or groups; constitutes hate speech targeting groups based on race, religion, gender, sexuality, nationality, or disability; contains weapon synthesis instructions or other operationally dangerous information.",
          },
          {
            title: "10. Suspension and Termination",
            body: "JunoTalk reserves the right to suspend or terminate accounts that violate these Terms. Violations may result in temporary restrictions, permanent bans, or referral to law enforcement where required. You may close your account at any time from Settings.",
          },
          {
            title: "11. Service Availability",
            body: "JunoTalk is provided on an as-is basis. We make no guarantee of uninterrupted availability. We may update or modify features at any time. We will provide notice for significant changes where possible.",
          },
          {
            title: "12. Limitation of Liability",
            body: "To the fullest extent permitted by law, JunoTalk is not liable for indirect, incidental, special, or consequential damages arising from your use of the platform. Our total liability is limited to the amount you paid for the service in the prior 12 months.",
          },
          {
            title: "13. Changes to These Terms",
            body: "We may update these Terms from time to time. We will notify you of material changes via the app or email. Continued use after changes constitutes acceptance. If you do not agree with updated Terms, you may close your account.",
          },
          {
            title: "14. Contact",
            body: "Questions about these Terms? Contact us through the Support page within the app.",
          },
        ].map(({ title, body }) => (
          <div key={title} className="space-y-2">
            <h2 className="text-sm font-semibold text-white/85">{title}</h2>
            <p className="text-sm text-white/55 leading-relaxed">{body}</p>
          </div>
        ))}

        <div
          className="rounded-xl p-4 space-y-2 mt-8"
          style={{ background: "rgba(80,120,255,0.07)", border: "1px solid rgba(100,140,255,0.14)" }}
        >
          <p className="text-xs font-semibold text-blue-300/80 uppercase tracking-wider">Acceptable Use Summary</p>
          <ul className="text-xs text-white/55 space-y-1 leading-relaxed list-none">
            {[
              "Be respectful. No harassment, threats, or targeted abuse.",
              "No impersonation of other people or JunoTalk staff.",
              "No spam, phishing, or fraudulent content.",
              "No illegal content of any kind.",
              "No content that sexualizes minors. Ever.",
              "Use AI features responsibly. Do not attempt to override AI safety guidelines.",
              "Report violations using the in-app report feature.",
            ].map(item => (
              <li key={item} className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">+</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
