import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n.jsx";
import { CDN_ASSETS } from "@/lib/cdn";
const logoImage = CDN_ASSETS.logo;
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();
  const { t } = useI18n();
  useSEO(SEO_CONFIGS.privacy);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-0 h-16">
            <BackTriangle onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")} testId="button-back-privacy" label="Privacy Policy" />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-privacy-title">{t("settings.privacyPolicy")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">Last updated: March 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. Introduction</h2>
            <p className="text-muted-foreground">
              JunoTalk ("we," "our," or "us") provides a communication platform featuring video calling, messaging, and real-time translation services. This Privacy Policy explains what information we collect, how we use it, how we protect it, and what choices you have. By using JunoTalk, you agree to the practices described in this policy.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">2. Information We Collect</h2>
            <p className="text-muted-foreground">We collect information to provide, maintain, and improve our services:</p>
            <div className="space-y-3">
              <div>
                <p className="text-muted-foreground"><strong className="text-foreground">Account Information</strong></p>
                <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                  <li>Name, email address, and profile photo from your Google account when you sign in</li>
                  <li>Phone number, if you choose to provide one, for account connectivity and discovery</li>
                  <li>Language preferences for translation services</li>
                  <li>Profile information you choose to add (username, bio)</li>
                </ul>
              </div>
              <div>
                <p className="text-muted-foreground"><strong className="text-foreground">Usage Information</strong></p>
                <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                  <li>Feature usage and platform activity to improve service quality</li>
                  <li>Device information and session data for security and troubleshooting</li>
                </ul>
              </div>
              <div>
                <p className="text-muted-foreground"><strong className="text-foreground">Communication Content</strong></p>
                <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                  <li>Chat messages you send through the platform (temporarily stored, then automatically deleted)</li>
                  <li>Text content processed through our translation services</li>
                  <li>We do not store audio or video recordings from calls</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">3. How We Use Your Information</h2>
            <p className="text-muted-foreground">Your information is used for the following purposes:</p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Providing video calling, messaging, and real-time translation services</li>
              <li>Identifying you to other participants during calls and conversations</li>
              <li>Enabling other users to find and connect with you on the platform</li>
              <li>Authenticating your account and maintaining security</li>
              <li>Sending service-related notifications such as room invitations</li>
              <li>Improving translation accuracy and overall service performance</li>
              <li>Detecting and preventing abuse, fraud, and unauthorized access</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. Automated Processing & AI</h2>
            <p className="text-muted-foreground">
              JunoTalk uses automated processing, including AI-powered services, to provide translation, speech-to-text, and caption features. When using these features:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Only the text content of your speech or messages is processed. No personal identifiers are included</li>
              <li>Translation and caption processing is performed in real-time and is not permanently retained</li>
              <li>We do not use your content to train AI models</li>
              <li>No automated decisions are made that produce legal or similarly significant effects on you</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">5. Data Sharing</h2>
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="font-medium text-foreground">
                JunoTalk does not sell, rent, or trade your personal information to third parties for marketing or advertising purposes.
              </p>
            </div>
            <p className="text-muted-foreground">
              We may share limited data only in the following circumstances:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Service Providers:</strong> We use trusted third-party services to process translations and deliver platform features. These providers receive only the minimum data necessary to perform their function and are bound by their own privacy obligations. No personal identifiers are shared with translation providers.</li>
              <li><strong className="text-foreground">Legal Obligations:</strong> We may disclose information if required to do so by law, regulation, court order, or other governmental request.</li>
              <li><strong className="text-foreground">Safety & Protection:</strong> We may share information when we believe it is necessary to protect the safety, rights, or property of our users, the public, or JunoTalk.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">6. Data Security</h2>
            <p className="text-muted-foreground">
              We implement industry-standard security measures to protect your personal information:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>All data is transmitted over encrypted connections</li>
              <li>End-to-end encryption for chat messages and video captions</li>
              <li>Video calls use encrypted peer-to-peer connections</li>
              <li>Personal data is encrypted at rest where applicable</li>
              <li>No audio or video recordings are stored on our servers</li>
              <li>Sessions expire automatically after a period of inactivity</li>
            </ul>
            <p className="text-muted-foreground">
              While we take extensive measures to protect your data, no method of electronic transmission or storage is 100% secure. We cannot guarantee absolute security but are committed to protecting your information using commercially reasonable safeguards.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">7. Data Retention</h2>
            <p className="text-muted-foreground">
              We retain your personal information only for as long as necessary to provide our services and fulfill the purposes described in this policy. Communication content such as chat messages is automatically deleted on a regular basis. When you delete your account, all associated personal data is permanently removed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">8. Cookies & Similar Technologies</h2>
            <p className="text-muted-foreground">
              We use cookies and similar technologies for the following purposes:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Essential Cookies:</strong> Required for authentication, session management, and core platform functionality. These cannot be disabled.</li>
              <li><strong className="text-foreground">Preference Cookies:</strong> Store your settings such as language preferences and display options.</li>
            </ul>
            <p className="text-muted-foreground">
              We do not use advertising or tracking cookies. You can manage cookie preferences through your browser settings or within the app. Disabling essential cookies may affect your ability to use the platform.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">9. Your Rights</h2>
            <p className="text-muted-foreground">Depending on your location, you may have the following rights under applicable data protection laws (including GDPR, CCPA, and similar regulations). You can exercise most of these directly from the Settings page in the app:</p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Access:</strong> View the personal information we hold about you</li>
              <li><strong className="text-foreground">Portability:</strong> Download your data from Settings {">"} Data & Privacy</li>
              <li><strong className="text-foreground">Correction:</strong> Update inaccurate personal information through your profile settings</li>
              <li><strong className="text-foreground">Deletion:</strong> Permanently delete your account and all associated data from Settings {">"} Data & Privacy</li>
              <li><strong className="text-foreground">Withdraw Consent:</strong> Revoke permissions at any time, including Google account access</li>
              <li><strong className="text-foreground">Object:</strong> Contact us to object to specific data processing activities</li>
              <li><strong className="text-foreground">Non-Discrimination:</strong> We will not discriminate against you for exercising any of your privacy rights</li>
            </ul>
            <p className="text-muted-foreground">
              We will respond to all valid requests within the timeframe required by applicable law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">10. Children's Privacy</h2>
            <p className="text-muted-foreground">
              JunoTalk is not directed to children under the age of 16. We do not knowingly collect personal information from children under 16. If we become aware that we have collected personal information from a child under 16, we will take steps to delete that information promptly. If you believe a child under 16 has provided us with personal information, please contact us.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">11. International Data Transfers</h2>
            <p className="text-muted-foreground">
              JunoTalk operates globally and your information may be processed in countries other than your own. When we transfer data internationally, we ensure appropriate safeguards are in place to protect your information in accordance with applicable data protection laws. By using JunoTalk, you consent to the transfer of your information to countries that may have different data protection rules than your country of residence.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">12. Third-Party Links & Services</h2>
            <p className="text-muted-foreground">
              JunoTalk may contain links to third-party websites or services. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services before providing your information.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">13. Embedded Third-Party Content</h2>
            <p className="text-muted-foreground">
              Our platform displays content from third-party services such as YouTube, Vimeo, and Dailymotion through their official embed mechanisms. This content appears within the JunoTalk dashboard media feed and is served directly by those platforms using their standard, publicly approved embedding methods.
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">We do not host or alter this content.</strong> All embedded videos are provided directly by the originating platform and are subject to that platform's own terms, availability, and policies.</li>
              <li><strong className="text-foreground">We do not track your viewing activity.</strong> JunoTalk does not collect or store information about which embedded videos you watch or interact with.</li>
              <li><strong className="text-foreground">Third-party data practices apply.</strong> By interacting with embedded content, you may be subject to the privacy policies and data practices of the respective third-party platforms, including any cookies or tracking technologies they deploy through their players.</li>
              <li><strong className="text-foreground">Content is curated by JunoTalk.</strong> All video sources displayed in the media feed are selected and managed by JunoTalk administrators. Users cannot submit or inject external content into the feed.</li>
            </ul>
            <p className="text-muted-foreground">
              We encourage you to review the privacy policies of YouTube, Vimeo, and Dailymotion if you have questions about how those platforms handle data when their embedded players are used.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">14. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time to reflect changes to our practices, technology, or legal requirements. We will notify you of any material changes through the platform before they take effect. Your continued use of JunoTalk after such notification constitutes acceptance of the updated policy.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">15. Contact Us</h2>
            <p className="text-muted-foreground">
              If you have questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us through the in-app support system or submit a support ticket from your dashboard. We aim to respond to all inquiries within a reasonable timeframe.
            </p>
          </section>
        </div>

        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground text-center">
            2026 JunoTalk. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}
