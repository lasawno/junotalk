import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Phone, Shield, ShieldCheck, CheckCircle, Globe, MessageSquare, Lock, AlertCircle, User, Languages, Info, Loader2, Video, Mic, Camera, PhoneCall } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CDN_ASSETS } from "@/lib/cdn";
const logoImage = CDN_ASSETS.logo;
import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";
import { useI18n } from "@/lib/i18n.jsx";

function trackOnboardingEvent(step: string, success: boolean, error?: string) {
  const deviceInfo = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop";
  fetch("/api/onboarding/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ step, success, error, deviceInfo }),
  }).catch(() => {});
}

const POPULAR_COUNTRIES: CountryCode[] = ["US", "GB", "CA", "AU", "IN", "DE", "FR", "JP", "BR", "MX", "NG", "ZA", "KE", "GH", "PH", "PK", "EG", "SA", "AE", "CN"];

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia",
  IN: "India", DE: "Germany", FR: "France", JP: "Japan", BR: "Brazil",
  MX: "Mexico", NG: "Nigeria", ZA: "South Africa", KE: "Kenya", GH: "Ghana",
  PH: "Philippines", PK: "Pakistan", EG: "Egypt", SA: "Saudi Arabia",
  AE: "United Arab Emirates", CN: "China", IT: "Italy", ES: "Spain",
  NL: "Netherlands", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
  PT: "Portugal", PL: "Poland", CZ: "Czech Republic", AT: "Austria",
  CH: "Switzerland", BE: "Belgium", IE: "Ireland", NZ: "New Zealand",
  SG: "Singapore", MY: "Malaysia", TH: "Thailand", ID: "Indonesia",
  VN: "Vietnam", KR: "South Korea", TW: "Taiwan", HK: "Hong Kong",
  TR: "Turkey", RU: "Russia", UA: "Ukraine", RO: "Romania", GR: "Greece",
  IL: "Israel", JO: "Jordan", LB: "Lebanon", IQ: "Iraq", KW: "Kuwait",
  QA: "Qatar", BH: "Bahrain", OM: "Oman", YE: "Yemen", MA: "Morocco",
  TN: "Tunisia", DZ: "Algeria", LY: "Libya", SD: "Sudan", ET: "Ethiopia",
  TZ: "Tanzania", UG: "Uganda", CM: "Cameroon", CI: "Ivory Coast",
  SN: "Senegal", ZW: "Zimbabwe", MZ: "Mozambique", AO: "Angola",
  CO: "Colombia", AR: "Argentina", CL: "Chile", PE: "Peru", VE: "Venezuela",
  EC: "Ecuador", BO: "Bolivia", PY: "Paraguay", UY: "Uruguay",
  CR: "Costa Rica", PA: "Panama", DO: "Dominican Republic", CU: "Cuba",
  GT: "Guatemala", HN: "Honduras", SV: "El Salvador", NI: "Nicaragua",
  JM: "Jamaica", TT: "Trinidad and Tobago", HT: "Haiti",
  BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal", MM: "Myanmar",
  KH: "Cambodia", LA: "Laos",
};

function getCountryName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

export default function Onboarding() {
  useWakeLock(true);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const genericNames = new Set(["user", "guest", "anonymous", "unknown"]);
  const isGenericName = (name: string | null | undefined) => !name || !name.trim() || genericNames.has(name.trim().toLowerCase());
  const [firstName, setFirstName] = useState(isGenericName(user?.firstName) ? "" : (user?.firstName || ""));
  const [lastName, setLastName] = useState(isGenericName(user?.lastName) ? "" : (user?.lastName || ""));
  const [chosenUsername, setChosenUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>("US");
  const [spokenLanguage, setSpokenLanguage] = useState("auto");
  const [consentData, setConsentData] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [submitAttempts, setSubmitAttempts] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [mediaPermissionsGranted, setMediaPermissionsGranted] = useState<boolean | null>(null);
  const [verifyScreen, setVerifyScreen] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpSentPayload, setOtpSentPayload] = useState<Record<string, any> | null>(null);
  const [emailRequired, setEmailRequired] = useState(false);
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phoneInteractionRef = useRef<{ focusTime: number; attempts: number; reported: boolean }>({ focusTime: 0, attempts: 0, reported: false });
  const pageLoadTimeRef = useRef(Date.now());

  useEffect(() => {
    trackOnboardingEvent("page_load", true);

    const abandonmentTimer = setTimeout(() => {
      const digits = document.querySelector<HTMLInputElement>('[data-testid="input-onboard-phone"]')?.value?.replace(/\D/g, "") || "";
      if (digits.length < 7) {
        trackOnboardingEvent("onboarding_stalled", false,
          `time=120s, phoneDigits=${digits.length}, device=${/Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop"}`
        );
      }
    }, 120000);

    const handleBeforeUnload = () => {
      const timeOnPage = Math.round((Date.now() - pageLoadTimeRef.current) / 1000);
      const digits = document.querySelector<HTMLInputElement>('[data-testid="input-onboard-phone"]')?.value?.replace(/\D/g, "") || "";
      if (timeOnPage > 10 && digits.length < 7) {
        navigator.sendBeacon("/api/onboarding/track", JSON.stringify({
          step: "page_abandon",
          success: false,
          error: `time=${timeOnPage}s, phoneDigits=${digits.length}, device=${/Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop"}`,
          deviceInfo: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
        }));
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    healthCheckRef.current = setInterval(async () => {
      try {
        await fetch("/api/onboarding/health", { credentials: "include" });
      } catch {}
    }, 30000);

    return () => {
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
      clearTimeout(abandonmentTimer);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const checkUsernameAvailability = useCallback((value: string) => {
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    const clean = value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
    if (clean.length < 3) {
      setUsernameAvailable(null);
      setCheckingUsername(false);
      return;
    }
    setCheckingUsername(true);
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/username/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: clean }),
          credentials: "include",
        });
        const data = await res.json();
        setUsernameAvailable(data.available ?? null);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);
  }, []);

  const allCountries = useMemo(() => {
    const countries = getCountries();
    const popular = POPULAR_COUNTRIES.filter(c => countries.includes(c));
    const rest = countries.filter(c => !POPULAR_COUNTRIES.includes(c)).sort((a, b) =>
      getCountryName(a).localeCompare(getCountryName(b))
    );
    return { popular, rest };
  }, []);

  const phoneValidation = useMemo(() => {
    const raw = phoneDigits.replace(/\D/g, "");
    if (!raw) return { valid: false, message: "", number: null };

    const callingCode = getCountryCallingCode(countryCode);
    const fullNumber = `+${callingCode}${raw}`;
    const parsed = parsePhoneNumberFromString(fullNumber, countryCode);

    if (!parsed || !parsed.isValid()) {
      if (raw.length < 6) {
        return { valid: false, message: "", number: null };
      }
      return { valid: false, message: t("onboarding.phoneInvalid"), number: null };
    }

    return {
      valid: true,
      message: `${parsed.formatInternational()}`,
      number: parsed.formatInternational(),
    };
  }, [phoneDigits, countryCode, t]);

  const maskedPhoneDisplay = useMemo(() => {
    const digits = phoneDigits.replace(/\D/g, "");
    return digits;
  }, [phoneDigits]);

  const cleanUsername = chosenUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  const invalidUsername = chosenUsername.trim().length > 0 && cleanUsername.length < 3;

  const phoneOptionallyValid = !phoneDigits.trim() || phoneValidation.valid;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailOptionallyValid = !email.trim() || emailRegex.test(email.trim());

  const emailMeetsRequirement = !emailRequired || (email.trim().length > 0 && emailRegex.test(email.trim()));
  const optionalFieldsValid = !showMoreDetails || (!invalidUsername && emailOptionallyValid && phoneOptionallyValid);
  const canSubmit = firstName.trim() && !genericNames.has(firstName.trim().toLowerCase()) && optionalFieldsValid && emailMeetsRequirement && consentData && !isSubmitting;

  const missingFirstName = !firstName.trim() || genericNames.has(firstName.trim().toLowerCase());
  const missingEmail = showMoreDetails && email.trim() && !emailRegex.test(email.trim());
  const missingPhone = showMoreDetails && phoneDigits.trim() && !phoneValidation.valid;
  const missingConsent = !consentData;

  const handleRequestMediaPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMediaPermissionsGranted(true);
    } catch {
      setMediaPermissionsGranted(false);
    }
  }, []);

  const finishOnboarding = async () => {
    trackOnboardingEvent("complete", true);
    await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    toast({ title: t("common.success"), description: t("onboarding.welcomeDesc") });
    let pendingRoom: string | null = null;
    try { pendingRoom = localStorage.getItem(STORAGE_KEYS.pendingRoom); } catch {}
    if (pendingRoom) {
      try { localStorage.removeItem(STORAGE_KEYS.pendingRoom); } catch {}
      setLocation(`/join/${pendingRoom}`);
    } else {
      setLocation("/");
    }
  };

  const handleSubmit = async () => {
    setTriedSubmit(true);
    if (missingFirstName || missingConsent) {
      trackOnboardingEvent("validation_fail", false, "Missing required fields");
      toast({ title: t("onboarding.missingFields"), variant: "default" });
      return;
    }
    if (emailRequired && !emailMeetsRequirement) {
      toast({ title: "Email address required", description: "Please enter a valid email to continue.", variant: "default" });
      document.querySelector<HTMLInputElement>('[data-testid="input-onboard-email"]')?.focus();
      return;
    }
    if (showMoreDetails && (invalidUsername || missingEmail || missingPhone)) {
      trackOnboardingEvent("validation_fail", false, "Invalid optional fields");
      if (missingEmail) {
        toast({ title: "Please enter a valid email or clear the field", variant: "default" });
      } else if (missingPhone) {
        toast({ title: "Please enter a valid phone number or clear the field", variant: "default" });
      } else {
        toast({ title: "Username must be at least 3 characters", variant: "default" });
      }
      return;
    }
    setIsSubmitting(true);
    trackOnboardingEvent("submit_attempt", true);
    try {
      const browserLang = navigator.language?.split("-")[0] || "en";
      const onboardingPayload: Record<string, any> = {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        browserLanguage: browserLang,
      };
      if (showMoreDetails) {
        if (cleanUsername) onboardingPayload.username = cleanUsername;
        if (email.trim()) onboardingPayload.email = email.trim();
        if (phoneValidation.number) onboardingPayload.phoneNumber = phoneValidation.number;
        if (spokenLanguage && spokenLanguage !== "auto") onboardingPayload.spokenLanguage = spokenLanguage;
      }

      const verifyRes = await apiRequest("POST", "/api/v1/email-verify/send", {
        firstName: firstName.trim(),
        email: email.trim() || undefined,
        onboardingPayload,
      });

      // Email sent — show verification screen
      setOtpSentPayload(onboardingPayload);
      setMaskedEmail((verifyRes as any).maskedEmail || "your email");
      setOtpCode("");
      setOtpError("");
      setVerifyScreen(true);
    } catch (error: any) {
      const message = error?.message || "";
      trackOnboardingEvent("submit_error", false, message);

      if (message === "email_required") {
        // No email on their profile — require them to enter one
        setEmailRequired(true);
        setShowMoreDetails(true);
        toast({
          title: "Email address required",
          description: "An email is needed to verify your account. Please enter one below.",
          variant: "default",
          duration: 6000,
        });
        setTimeout(() => {
          document.querySelector<HTMLInputElement>('[data-testid="input-onboard-email"]')?.focus();
        }, 300);
      } else {
        const nextAttempt = submitAttempts + 1;
        setSubmitAttempts(nextAttempt);
        if (nextAttempt >= 2) {
          toast({ title: "Still having trouble?", description: "Make sure your email address is correct.", variant: "default", duration: 7000 });
        } else {
          toast({ title: t("common.error"), description: message + " Please try again.", variant: "default" });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOtp = async () => {
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setOtpError("Please enter the 6-digit code from your email");
      return;
    }
    setIsConfirming(true);
    setOtpError("");
    try {
      await apiRequest("POST", "/api/v1/email-verify/confirm", { code: otpCode.trim() });
      await finishOnboarding();
    } catch (err: any) {
      setOtpError(err?.message || "Incorrect code. Please try again.");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleResendOtp = async () => {
    if (isResending || !otpSentPayload) return;
    setIsResending(true);
    setOtpError("");
    try {
      const verifyRes = await apiRequest("POST", "/api/v1/email-verify/send", {
        firstName: otpSentPayload.firstName || firstName.trim(),
        email: otpSentPayload.email,
        onboardingPayload: otpSentPayload,
      });
      if ((verifyRes as any).maskedEmail) setMaskedEmail((verifyRes as any).maskedEmail);
      setOtpCode("");
      toast({ title: "New code sent", description: `Check ${(verifyRes as any).maskedEmail || maskedEmail}` });
    } catch {
      toast({ title: "Couldn't resend", description: "Please try again in a moment.", variant: "default" });
    } finally {
      setIsResending(false);
    }
  };

  if (verifyScreen) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className="text-2xl font-bold text-white">Juno<span className="text-primary">Talk</span></span>
              <div className="w-14 h-14 flex-shrink-0 drop-shadow-[0_0_12px_rgba(59,130,246,0.4)]">
                <img src={logoImage} alt="JunoTalk" width={56} height={56} decoding="async" className="w-full h-full object-contain" />
              </div>
            </div>
          </div>

          <Card className="border border-blue-500/20" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
            <CardHeader className="pb-2 text-center">
              <div className="mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #1e4d9a 100%)", boxShadow: "0 0 16px rgba(59,130,246,0.35)" }}>
                <Mail className="w-7 h-7 text-blue-300" />
              </div>
              <CardTitle className="text-white text-xl">Check your email</CardTitle>
              <CardDescription className="text-blue-200/60 text-sm leading-relaxed pt-1">
                We sent a 6-digit code to<br />
                <span className="text-blue-300 font-medium">{maskedEmail}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 pt-2">
              <div className="space-y-2">
                <Input
                  data-testid="input-otp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtpCode(v);
                    if (otpError) setOtpError("");
                  }}
                  onKeyDown={e => { if (e.key === "Enter" && otpCode.length === 6) handleConfirmOtp(); }}
                  className="text-center text-3xl font-mono tracking-[0.5em] h-14 bg-[#152a58] border-blue-500/30 text-white placeholder:text-white/20 focus:border-blue-400/60 focus:ring-blue-400/20"
                  autoFocus
                  autoComplete="one-time-code"
                />
                {otpError && (
                  <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1" data-testid="text-otp-error">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {otpError}
                  </p>
                )}
              </div>

              <Button
                data-testid="button-verify-otp"
                className="w-full"
                size="lg"
                onClick={handleConfirmOtp}
                disabled={otpCode.length !== 6 || isConfirming}
                style={{ background: "linear-gradient(135deg, #1e4e8c 0%, #2563eb 100%)" }}
              >
                {isConfirming ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Verifying…</span>
                ) : (
                  <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Verify &amp; Continue</span>
                )}
              </Button>

              <div className="text-center space-y-1">
                <p className="text-xs text-blue-200/40">Code expires in 10 minutes</p>
                <button
                  data-testid="button-resend-otp"
                  onClick={handleResendOtp}
                  disabled={isResending}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
                >
                  {isResending ? "Sending…" : "Didn't get it? Resend code"}
                </button>
              </div>

              <button
                data-testid="button-back-to-form"
                onClick={() => setVerifyScreen(false)}
                className="w-full text-xs text-muted-foreground hover:text-white/60 transition-colors text-center"
              >
                ← Go back and edit my info
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-1">
            <span className="text-2xl font-bold text-white" data-testid="text-onboarding-title">Juno<span className="text-primary">Talk</span></span>
            <div className="w-16 h-16 flex-shrink-0 drop-shadow-[0_0_12px_rgba(59,130,246,0.4)]">
              <img src={logoImage} alt="JunoTalk" width={64} height={64} decoding="async" className="w-full h-full object-contain" />
            </div>
          </div>
          <p className="text-muted-foreground text-sm">{t("onboarding.welcomeDesc")}</p>
          <div className="flex items-center justify-center gap-3 pt-0.5">
            <div className="flex flex-col items-center gap-1" data-testid="splash-feature-security">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #1e4d9a 100%)", boxShadow: "0 0 8px rgba(59,130,246,0.3)" }}>
                <ShieldCheck className="w-5 h-5 text-blue-300" />
              </div>
              <span className="text-[10px] text-blue-300/70 font-medium">Encrypted</span>
            </div>
            <div className="flex flex-col items-center gap-1" data-testid="splash-feature-translation">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #1e4d9a 100%)", boxShadow: "0 0 8px rgba(59,130,246,0.3)" }}>
                <Languages className="w-5 h-5 text-blue-300" />
              </div>
              <span className="text-[10px] text-blue-300/70 font-medium">AI Translation</span>
            </div>
            <div className="flex flex-col items-center gap-1" data-testid="splash-feature-calls">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #1e4d9a 100%)", boxShadow: "0 0 8px rgba(59,130,246,0.3)" }}>
                <Phone className="w-5 h-5 text-blue-300" />
              </div>
              <span className="text-[10px] text-blue-300/70 font-medium">Voice Calls</span>
            </div>
            <div className="flex flex-col items-center gap-1" data-testid="splash-feature-video">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #1e4d9a 100%)", boxShadow: "0 0 8px rgba(59,130,246,0.3)" }}>
                <Video className="w-5 h-5 text-blue-300" />
              </div>
              <span className="text-[10px] text-blue-300/70 font-medium">Video & Chat</span>
            </div>
          </div>
        </div>

        <Card className="border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader>
            <CardTitle className="text-lg text-white">Get Started</CardTitle>
            <CardDescription>
              Just your name to begin. You can add more details later in your profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="onboard-firstname">
                <div className="flex items-center gap-2">
                  <User className={`w-4 h-4 ${triedSubmit && missingFirstName ? "text-destructive" : "text-primary"}`} />
                  {t("onboarding.firstName")}
                  <span className="text-destructive">*</span>
                </div>
              </Label>
              <Input
                id="onboard-firstname"
                type="text"
                placeholder={t("onboarding.firstName")}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-onboard-firstname"
                autoFocus
                className={triedSubmit && missingFirstName ? "border-destructive ring-1 ring-destructive/30" : ""}
              />
              {triedSubmit && missingFirstName && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="error-firstname">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {t("onboarding.nameRequired")}
                </p>
              )}
            </div>

            <div className={`space-y-3 ${triedSubmit && missingConsent ? "rounded-md p-2 bg-destructive/5 border-destructive/20" : ""}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="consent-data"
                  checked={consentData}
                  onCheckedChange={(checked) => {
                    setConsentData(checked === true);
                    setConsentPrivacy(checked === true);
                  }}
                  data-testid="checkbox-consent-data"
                  className={triedSubmit && !consentData ? "border-destructive data-[state=unchecked]:border-destructive" : ""}
                />
                <Label htmlFor="consent-data" className={`text-sm leading-relaxed cursor-pointer ${triedSubmit && !consentData ? "text-destructive" : ""}`}>
                  I agree to the <a href="/privacy" target="_blank" className="text-blue-400 underline">Privacy Policy</a>
                </Label>
              </div>
              {triedSubmit && missingConsent && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="error-consent">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Please accept to continue
                </p>
              )}
            </div>

            {consentData && (
              <div
                className="rounded-xl p-4 space-y-3"
                style={{
                  background: "rgba(80,120,255,0.07)",
                  border: "1px solid rgba(100,140,255,0.14)",
                }}
                data-testid="section-comm-permissions"
              >
                <p className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(147,197,253,0.8)" }}>
                  Communication Setup
                </p>
                <p className="text-xs text-white/55 leading-relaxed">
                  Your contacts will be able to call and message you. JunoTalk translates everything automatically.
                </p>
                <div className="grid grid-cols-2 gap-2 py-1">
                  {[
                    { icon: <PhoneCall className="w-3.5 h-3.5 text-green-400" />, label: "Voice calls" },
                    { icon: <Video className="w-3.5 h-3.5 text-blue-400" />, label: "Video calls" },
                    { icon: <MessageSquare className="w-3.5 h-3.5 text-purple-400" />, label: "Messages" },
                    { icon: <Languages className="w-3.5 h-3.5 text-orange-400" />, label: "Auto-translation" },
                  ].map(({ icon, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      {icon}
                      <span className="text-xs text-white/65">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-1 border-t border-blue-500/10">
                  {mediaPermissionsGranted === true ? (
                    <div className="flex items-center gap-2 text-sm text-green-400" data-testid="text-media-granted">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span>Camera and microphone ready</span>
                    </div>
                  ) : mediaPermissionsGranted === false ? (
                    <div className="space-y-1">
                      <p className="text-xs text-amber-400 flex items-center gap-1.5" data-testid="text-media-denied">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        Permission denied. Enable in your browser settings before making calls.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestMediaPermissions}
                      data-testid="button-grant-media"
                      className="flex items-center gap-2 text-sm transition-colors"
                      style={{ color: "rgba(147,197,253,0.9)" }}
                    >
                      <Camera className="w-4 h-4 flex-shrink-0" />
                      Set up camera and microphone
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-blue-500/10">
              <button
                type="button"
                onClick={() => setShowMoreDetails(!showMoreDetails)}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors w-full justify-center py-1"
                data-testid="button-show-more-details"
              >
                <Info className="w-4 h-4" />
                {showMoreDetails ? "Hide optional details" : "Add more details now (optional)"}
              </button>
            </div>

            {showMoreDetails && (
              <div className="space-y-5 pt-2 border-t border-blue-500/10">
                <div className="space-y-2">
                  <Label htmlFor="onboard-username">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-primary" />
                      Username
                      <span className="text-muted-foreground text-xs font-normal ml-1">(optional)</span>
                    </div>
                  </Label>
                  <Input
                    id="onboard-username"
                    type="text"
                    placeholder="Choose a username"
                    maxLength={20}
                    value={chosenUsername}
                    onChange={(e) => {
                      const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "");
                      setChosenUsername(val);
                      checkUsernameAvailability(val);
                    }}
                    data-testid="input-onboard-username"
                  />
                  {checkingUsername && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking availability...
                    </p>
                  )}
                  {!checkingUsername && usernameAvailable === true && cleanUsername.length >= 3 && (
                    <p className="text-xs text-green-400 flex items-center gap-1" data-testid="text-username-available">
                      <CheckCircle className="w-3 h-3 flex-shrink-0" />
                      Username available!
                    </p>
                  )}
                  {!checkingUsername && usernameAvailable === false && cleanUsername.length >= 3 && (
                    <p className="text-xs text-red-400 flex items-center gap-1" data-testid="text-username-taken">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      Not available
                    </p>
                  )}
                  {invalidUsername && (
                    <p className="text-xs text-destructive flex items-center gap-1" data-testid="error-username">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      Username must be at least 3 characters
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="onboard-email">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary" />
                      {t("onboarding.email")}
                      {emailRequired
                        ? <span className="text-red-400 text-xs font-medium ml-1">required</span>
                        : <span className="text-muted-foreground text-xs font-normal ml-1">(optional)</span>
                      }
                    </div>
                  </Label>
                  <Input
                    id="onboard-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailRequired) setEmailRequired(false); }}
                    data-testid="input-onboard-email"
                    className={
                      emailRequired
                        ? "border-red-400/70 ring-1 ring-red-400/30 focus:border-red-400 focus:ring-red-400/40"
                        : triedSubmit && missingEmail ? "border-destructive ring-1 ring-destructive/30" : ""
                    }
                  />
                  {emailRequired && (
                    <p className="text-xs text-red-400 flex items-center gap-1" data-testid="error-email-required">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      An email address is required to verify your account
                    </p>
                  )}
                  {!emailRequired && triedSubmit && missingEmail && (
                    <p className="text-xs text-destructive flex items-center gap-1" data-testid="error-email">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      Please enter a valid email address
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="onboard-phone">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-primary" />
                      {t("onboarding.phone")}
                      <span className="text-muted-foreground text-xs font-normal ml-1">(optional)</span>
                    </div>
                  </Label>
                  <div className="flex gap-2">
                    <Select value={countryCode} onValueChange={(val) => setCountryCode(val as CountryCode)}>
                      <SelectTrigger className="w-[130px] flex-shrink-0" data-testid="select-country-code">
                        <SelectValue placeholder={t("onboarding.selectCountry")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {allCountries.popular.map((code) => (
                          <SelectItem key={code} value={code}>
                            +{getCountryCallingCode(code)} {code}
                          </SelectItem>
                        ))}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-t mt-1 pt-1">
                          {t("onboarding.allCountries")}
                        </div>
                        {allCountries.rest.map((code) => (
                          <SelectItem key={code} value={code}>
                            +{getCountryCallingCode(code)} {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1">
                      <input
                        id="onboard-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder={t("onboarding.phone")}
                        value={maskedPhoneDisplay}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
                          setPhoneDigits(digits);
                        }}
                        data-testid="input-onboard-phone"
                        className={`flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${triedSubmit && missingPhone ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                      />
                    </div>
                  </div>
                  {phoneDigits.trim() && phoneValidation.message && (
                    <div className={`flex items-center gap-1.5 text-xs ${phoneValidation.valid ? "text-primary" : "text-destructive"}`} data-testid="text-phone-validation">
                      {phoneValidation.valid ? (
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                      <span>{phoneValidation.message}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4 text-primary" />
                      {t("onboarding.spokenLanguage")}
                      <span className="text-muted-foreground text-xs font-normal ml-1">(optional)</span>
                    </div>
                  </Label>
                  <Select value={spokenLanguage} onValueChange={setSpokenLanguage}>
                    <SelectTrigger data-testid="select-spoken-language">
                      <SelectValue placeholder={t("onboarding.spokenLanguage")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("onboarding.autoDetect")}</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                      <SelectItem value="it">Italian</SelectItem>
                      <SelectItem value="pt">Portuguese</SelectItem>
                      <SelectItem value="nl">Dutch</SelectItem>
                      <SelectItem value="pl">Polish</SelectItem>
                      <SelectItem value="cs">Czech</SelectItem>
                      <SelectItem value="ru">Russian</SelectItem>
                      <SelectItem value="ja">Japanese</SelectItem>
                      <SelectItem value="zh">Chinese</SelectItem>
                      <SelectItem value="ko">Korean</SelectItem>
                      <SelectItem value="ar">Arabic</SelectItem>
                      <SelectItem value="hi">Hindi</SelectItem>
                      <SelectItem value="tr">Turkish</SelectItem>
                      <SelectItem value="vi">Vietnamese</SelectItem>
                      <SelectItem value="th">Thai</SelectItem>
                      <SelectItem value="sv">Swedish</SelectItem>
                      <SelectItem value="da">Danish</SelectItem>
                      <SelectItem value="fi">Finnish</SelectItem>
                      <SelectItem value="no">Norwegian</SelectItem>
                      <SelectItem value="uk">Ukrainian</SelectItem>
                      <SelectItem value="el">Greek</SelectItem>
                      <SelectItem value="he">Hebrew</SelectItem>
                      <SelectItem value="id">Indonesian</SelectItem>
                      <SelectItem value="ms">Malay</SelectItem>
                      <SelectItem value="ro">Romanian</SelectItem>
                      <SelectItem value="hu">Hungarian</SelectItem>
                      <SelectItem value="bg">Bulgarian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="button-complete-onboarding"
            >
              {isSubmitting ? (
                t("onboarding.settingUp")
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Get Started
                </span>
              )}
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          {t("onboarding.privacyDesc")}
        </p>
      </div>
    </div>
  );
}
