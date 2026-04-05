import { useState, useEffect, useRef, useCallback } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import SectionBoundary from "@/components/dashboard/SectionBoundary";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Subtitles, Volume2, Phone, Code2, ChevronRight, Camera, Loader2, MessageSquare, Send, Mail, Check, X, Video, Shield, ChevronDown, Download, Trash2, AlertTriangle, FileText, UserCheck, Headphones, Palette, Mic, AudioLines, MicOff, StopCircle } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { safeDisplayName, safeInitials } from "@/lib/utils";
import type { UserPreferences, Feedback as FeedbackType } from "@shared/schema";
import MobileBottomNav from "@/components/MobileBottomNav";
import ImageCropper from "@/components/ImageCropper";

import { LANGUAGES, LANGUAGES_WITH_AUTO, UI_LANGUAGES } from "@/lib/languages";
import { useI18n } from "@/lib/i18n.jsx";
import { getConsentStatus, setConsent } from "@/lib/cookie-consent";
import { Cookie } from "lucide-react";

const SUBTITLE_LANGUAGES = LANGUAGES;

export default function Settings() {
  useSEO(SEO_CONFIGS.settings);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, locale, setLocale } = useI18n();
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [lastInitial, setLastInitial] = useState("");
  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsUsernameAvailable, setSettingsUsernameAvailable] = useState<boolean | null>(null);
  const [checkingSettingsUsername, setCheckingSettingsUsername] = useState(false);
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [spokenLanguage, setSpokenLanguage] = useState("auto");
  const [subtitleLanguage, setSubtitleLanguage] = useState("en");
  const [showOriginalText, setShowOriginalText] = useState(true);
  const [showTranslatedText, setShowTranslatedText] = useState(true);
  const [autoDetectLanguage, setAutoDetectLanguage] = useState(true);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [checklistEmail, setChecklistEmail] = useState("");
  const [checklistPhone, setChecklistPhone] = useState("");
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);

  // Voice Identity state
  const [voiceIdentityEnabled, setVoiceIdentityEnabled] = useState(false);
  const [voiceIdentityVoice, setVoiceIdentityVoice] = useState("nova");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/preferences"],
  });

  const { data: feedbackList = [], isLoading: loadingFeedback } = useQuery<FeedbackType[]>({
    queryKey: ["/api/feedback"],
    enabled: !!user,
  });

  type VoiceProfileData = { enabled: boolean; voice: string; sample: { status: string; uploadedAt: string; hasSample: boolean } | null };
  const { data: voiceProfile } = useQuery<VoiceProfileData>({
    queryKey: ["/api/v1/voice-profile"],
    enabled: !!user,
  });

  const voiceProfileMutation = useMutation({
    mutationFn: async (data: { enabled?: boolean; voice?: string }) => {
      return apiRequest("PATCH", "/api/v1/voice-profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/voice-profile"] });
      toast({ title: "Voice Identity saved" });
    },
    onError: () => {
      toast({ title: "Could not save voice settings", variant: "default" });
    },
  });

  const uploadSampleMutation = useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData();
      form.append("sample", blob, "voice-sample.webm");
      const res = await fetch("/api/v1/voice-profile/sample", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/voice-profile"] });
      toast({ title: "Voice sample saved", description: "Your reference sample is stored securely." });
    },
    onError: () => {
      toast({ title: "Upload failed", description: "Could not save your voice sample. Please try again.", variant: "default" });
    },
  });

  const deleteSampleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/v1/voice-profile");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/voice-profile"] });
      setVoiceIdentityEnabled(false);
      setShowDeleteConfirm(false);
      toast({ title: "Voice profile deleted" });
    },
    onError: () => {
      toast({ title: "Could not delete profile", variant: "default" });
    },
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        firstName: feedbackName,
        comment: feedbackComment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      setFeedbackName("");
      setFeedbackComment("");
      toast({
        title: t("feedback.submitted"),
        description: t("common.success"),
      });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("feedback.submitError"), variant: "default" });
    },
  });

  useEffect(() => {
    if (user) {
      setDisplayName(safeDisplayName(user.firstName, user.lastName));
      setLastInitial(user.lastName ? user.lastName.charAt(0).toUpperCase() : "");
      if ((user as any).username) {
        setSettingsUsername((user as any).username);
      }
    }
  }, [user]);

  useEffect(() => {
    if (preferences) {
      setPhoneNumber((preferences as any).phoneMasked || "");
      setSpokenLanguage(preferences.spokenLanguage || "auto");
      setSubtitleLanguage(preferences.subtitleLanguage || "en");
      setShowOriginalText(preferences.showOriginalText ?? true);
      setShowTranslatedText(preferences.showTranslatedText ?? true);
      setAutoDetectLanguage(preferences.autoDetectLanguage ?? true);
    }
  }, [preferences]);

  useEffect(() => {
    if (voiceProfile) {
      setVoiceIdentityEnabled(voiceProfile.enabled ?? false);
      setVoiceIdentityVoice(voiceProfile.voice ?? "nova");
    }
  }, [voiceProfile]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        uploadSampleMutation.mutate(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => {
          if (s >= 29) {
            stopRecording();
            return 30;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record a sample.", variant: "default" });
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const { uploadFile, isUploading: isUploadingPhoto } = useUpload({
    bucket: "public-assets",
    onSuccess: async (response) => {
      try {
        await new Promise(r => setTimeout(r, 500));
        await apiRequest("POST", "/api/profile-image", { objectPath: response.objectPath });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        toast({ title: t("settings.saved") });
      } catch {
        toast({ title: t("settings.saveError"), description: "Could not save profile photo. Please try again.", variant: "default" });
      }
    },
    onError: () => {
      toast({ title: t("settings.saveError"), description: "Upload failed. Please try again.", variant: "default" });
    },
  });

  const handleProfileImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("common.error"), variant: "default" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: t("common.error"), variant: "default" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    if (profileInputRef.current) profileInputRef.current.value = "";
  }, [toast]);

  const handleCropComplete = useCallback(async (croppedBlob: Blob) => {
    setCropImageSrc(null);
    const file = new File([croppedBlob], "profile.jpg", { type: "image/jpeg" });
    await uploadFile(file);
  }, [uploadFile]);

  const checkSettingsUsername = useCallback((value: string) => {
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    const clean = value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
    if (clean.length < 3) {
      setSettingsUsernameAvailable(null);
      setCheckingSettingsUsername(false);
      return;
    }
    if (clean === (user as any)?.username) {
      setSettingsUsernameAvailable(null);
      setCheckingSettingsUsername(false);
      return;
    }
    setCheckingSettingsUsername(true);
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/username/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: clean }),
          credentials: "include",
        });
        const data = await res.json();
        setSettingsUsernameAvailable(data.available ?? null);
      } catch {
        setSettingsUsernameAvailable(null);
      } finally {
        setCheckingSettingsUsername(false);
      }
    }, 500);
  }, [user]);

  const updateUsernameMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/username/set", { username: settingsUsername.trim() });
      return res.json();
    },
    onSuccess: (userData: any) => {
      if (userData) {
        queryClient.setQueryData(["/api/auth/user"], userData);
      }
      toast({ title: t("settings.saved"), description: "Username updated" });
    },
    onError: () => {
      toast({ title: "Couldn't save username", description: "Please try again in a moment" });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", "/api/user/profile", { firstName: displayName.trim(), lastName: lastInitial.trim() || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("settings.saveError"), variant: "default" });
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: Partial<UserPreferences>) => {
      return apiRequest("PATCH", "/api/preferences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      toast({
        title: t("settings.saved"),
        description: t("common.success"),
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("settings.saveError"),
        variant: "default",
      });
    },
  });

  const handleSave = async () => {
    if (!displayName.trim()) {
      toast({ title: t("common.required"), variant: "default" });
      return;
    }

    await updateProfileMutation.mutateAsync();

    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, subtitleLanguage); } catch {}
    updatePreferencesMutation.mutate({
      spokenLanguage,
      subtitleLanguage,
      showOriginalText,
      showTranslatedText,
      autoDetectLanguage,
    });
  };

  return (
    <div className="min-h-screen bg-background relative">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-0 h-16">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back" label={t("settings.title")} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* UI Language */}
        <SectionBoundary label="UI Language">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(120deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-white">{t("settings.uiLanguage")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Select value={locale} onValueChange={(val) => setLocale(val as any)}>
              <SelectTrigger data-testid="select-ui-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UI_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.nativeName} ({lang.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Language Settings */}
        <SectionBoundary label="Language Settings">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(140deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-white">{t("settings.languageSettings")}</CardTitle>
            </div>
            <CardDescription className="text-blue-100/90">
              {t("settings.spokenLanguage")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Spoken Language */}
            <div className="space-y-2">
              <Label htmlFor="spoken-language" className="text-blue-100">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-blue-300" />
                  {t("settings.spokenLanguage")}
                </div>
              </Label>
              <Select 
                value={spokenLanguage} 
                onValueChange={setSpokenLanguage}
                disabled={isLoading}
              >
                <SelectTrigger id="spoken-language" data-testid="select-spoken-language">
                  <SelectValue placeholder={t("settings.language")} />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES_WITH_AUTO.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subtitle Language */}
            <div className="space-y-2">
              <Label htmlFor="subtitle-language" className="text-blue-100">
                <div className="flex items-center gap-2">
                  <Subtitles className="w-4 h-4 text-blue-300" />
                  {t("settings.subtitleLanguage")}
                </div>
              </Label>
              <Select 
                value={subtitleLanguage} 
                onValueChange={setSubtitleLanguage}
                disabled={isLoading}
              >
                <SelectTrigger id="subtitle-language" data-testid="select-subtitle-language">
                  <SelectValue placeholder={t("settings.language")} />
                </SelectTrigger>
                <SelectContent>
                  {SUBTITLE_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Display Settings */}
        <SectionBoundary label="Display Settings">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(160deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Subtitles className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-white">{t("settings.showOriginal")}</CardTitle>
            </div>
            <CardDescription className="text-blue-100/90">
              {t("settings.subtitleLanguage")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="show-original" className="text-blue-100">{t("settings.showOriginal")}</Label>
              </div>
              <Switch
                id="show-original"
                checked={showOriginalText}
                onCheckedChange={setShowOriginalText}
                disabled={isLoading}
                data-testid="switch-show-original"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="show-translated" className="text-blue-100">{t("settings.showTranslated")}</Label>
              </div>
              <Switch
                id="show-translated"
                checked={showTranslatedText}
                onCheckedChange={setShowTranslatedText}
                disabled={isLoading}
                data-testid="switch-show-translated"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-detect" className="text-blue-100">{t("settings.autoDetect")}</Label>
              </div>
              <Switch
                id="auto-detect"
                checked={autoDetectLanguage}
                onCheckedChange={setAutoDetectLanguage}
                disabled={isLoading}
                data-testid="switch-auto-detect"
              />
            </div>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Dashboard Theme */}
        <SectionBoundary label="Dashboard Theme">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(160deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardContent className="p-0">
            <button
              onClick={() => setLocation("/dashboard-theme")}
              className="w-full flex items-center justify-between px-4 py-4 hover:bg-white/5 transition-colors rounded-xl"
              data-testid="button-dashboard-theme"
            >
              <div className="flex items-center gap-3">
                <Palette className="w-5 h-5 text-blue-400" />
                <div className="text-left">
                  <p className="text-sm font-medium text-white">Dashboard Theme</p>
                  <p className="text-xs text-blue-200/50">Change your dashboard background</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-300/50" />
            </button>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Save Button */}
        <Button 
          className="w-full" 
          onClick={handleSave}
          disabled={updatePreferencesMutation.isPending || updateProfileMutation.isPending}
          data-testid="button-save-settings"
        >
          {(updatePreferencesMutation.isPending || updateProfileMutation.isPending) ? t("common.loading") : t("settings.save")}
        </Button>

        {/* Community Feedback */}
        <SectionBoundary label="Community Feedback">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader className="cursor-pointer" onClick={() => setFeedbackOpen(!feedbackOpen)} data-testid="button-toggle-feedback">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                <CardTitle className="text-white">{t("settings.feedback")}</CardTitle>
              </div>
              <ChevronDown className={`w-5 h-5 text-blue-200/75 transition-transform duration-200 ${feedbackOpen ? "rotate-180" : ""}`} />
            </div>
            <CardDescription className="text-blue-100/90">
              {t("feedback.shareFeedback")}
            </CardDescription>
          </CardHeader>
          {feedbackOpen && (
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Input
                  type="text"
                  placeholder={t("feedback.namePlaceholder")}
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  data-testid="input-feedback-name"
                />
                <Textarea
                  placeholder={t("feedback.commentPlaceholder")}
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  className="min-h-[100px]"
                  data-testid="input-feedback-comment"
                />
                <Button
                  onClick={(e) => { e.preventDefault(); submitFeedbackMutation.mutate(); }}
                  disabled={!feedbackName.trim() || !feedbackComment.trim() || submitFeedbackMutation.isPending}
                  type="button"
                  data-testid="button-submit-feedback"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {submitFeedbackMutation.isPending ? t("feedback.submitting") : t("feedback.submit")}
                </Button>
              </div>

              {loadingFeedback ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                </div>
              ) : feedbackList.length > 0 && (
                <SectionBoundary label="Feedback Wall">
                <div className="space-y-2 pt-2 border-t border-blue-500/15">
                  <h4 className="text-xs font-medium text-blue-100/90">{t("feedback.communityWall")}</h4>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {feedbackList.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-md bg-blue-500/10"
                        data-testid={`feedback-item-${item.id}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-medium text-blue-400">{item.firstName}</span>
                          <span className="text-[10px] text-blue-200/75">
                            {new Date(item.createdAt!).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-blue-100">{item.comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
                </SectionBoundary>
              )}
            </CardContent>
          )}
        </Card>
        </SectionBoundary>

        {/* Cookie & Ad Preferences */}
        <SectionBoundary label="Cookie Preferences">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="card-cookie-settings">
          <CardContent className="py-4 px-4 space-y-4">
            <div className="flex items-center gap-3">
              <Cookie className="w-5 h-5 text-blue-400" />
              <div>
                <p className="text-sm font-medium text-white">Cookie Preferences</p>
                <p className="text-xs text-blue-100/90">Control how your data is used</p>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-medium text-white">Cookie Consent</p>
                <p className="text-xs text-blue-100/90 leading-relaxed mt-0.5">
                  Allow cookies to improve your experience and remember your preferences
                </p>
              </div>
              <Switch
                checked={getConsentStatus() === "accepted"}
                onCheckedChange={(checked) => { setConsent(checked ? "accepted" : "declined"); window.location.reload(); }}
                data-testid="toggle-data-sharing"
              />
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/15">
              <Shield className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-blue-100/90 leading-relaxed">
                {getConsentStatus() === "accepted"
                  ? "Cookies are enabled. Your preferences are saved for a better experience. Your personal data (email, phone) remains encrypted and is never shared."
                  : "Cookies are disabled. Your preferences won't be saved between sessions."}
              </p>
            </div>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Data & Privacy */}
        <SectionBoundary label="Data & Privacy">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(120deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-base text-white">Data & Privacy</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/privacy">
              <Button variant="outline" className="w-full justify-start gap-2 text-blue-100 border-blue-500/15 hover:bg-blue-500/10" data-testid="button-privacy-policy">
                <Shield className="w-4 h-4 text-blue-400" />
                Privacy Policy
              </Button>
            </Link>
            <Link href="/terms">
              <Button variant="outline" className="w-full justify-start gap-2 text-blue-100 border-blue-500/15 hover:bg-blue-500/10" data-testid="button-terms-of-service">
                <FileText className="w-4 h-4 text-blue-400" />
                Terms of Service
              </Button>
            </Link>

            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-blue-100 border-blue-500/15 hover:bg-blue-500/10"
              data-testid="button-export-data"
              onClick={async () => {
                try {
                  toast({ title: "Exporting...", description: "Preparing your data export" });
                  const res = await fetch("/api/gdpr/export", { credentials: "include" });
                  if (!res.ok) throw new Error("Export failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `junotalk-data-export-${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Export Complete", description: "Your data has been downloaded" });
                } catch {
                  toast({ title: "Export Failed", description: "Could not export your data. Please try again.", variant: "default" });
                }
              }}
            >
              <Download className="w-4 h-4 text-blue-400" />
              Export My Data
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm font-bold transition-colors"
              style={{ color: "#dc2626", borderColor: "rgba(220,38,38,0.5)", backgroundColor: "rgba(220,38,38,0.1)" }}
              data-testid="button-delete-account"
              onClick={() => {
                const confirmed = window.confirm(
                  "Are you sure you want to permanently delete your account? This will remove all your data, rooms, messages, and contacts. This action cannot be undone."
                );
                if (!confirmed) return;
                const doubleConfirm = window.confirm(
                  "This is your final confirmation. All data will be permanently erased. Proceed?"
                );
                if (!doubleConfirm) return;
                fetch("/api/gdpr/delete-account", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json", "X-GDPR-Delete-Confirm": "true" },
                  credentials: "include",
                  body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
                }).then(r => {
                  if (r.ok) {
                    window.location.href = "/";
                  } else {
                    toast({ title: "Deletion Failed", description: "Could not delete account. Please try again.", variant: "default" });
                  }
                }).catch(() => {
                  toast({ title: "Deletion Failed", description: "Could not delete account. Please try again.", variant: "default" });
                });
              }}
            >
              <Trash2 className="w-4 h-4" />
              Delete My Account
            </Button>

            <div className="flex items-start gap-2 p-2 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300">
                Account deletion is permanent and cannot be undone. All your data, rooms, messages, and contacts will be erased.
              </p>
            </div>
          </CardContent>
        </Card>
        </SectionBoundary>

        {/* Voice Identity */}
        <SectionBoundary label="Voice Identity">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(130deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,rgba(96,165,250,0.2),rgba(139,92,246,0.2))", border: "1px solid rgba(96,165,250,0.3)" }}>
                  <AudioLines className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-white text-base">Voice Identity</CardTitle>
                  <CardDescription className="text-blue-100/60 text-xs mt-0.5">Personalize how Juno speaks your translations</CardDescription>
                </div>
              </div>
              <Switch
                checked={voiceIdentityEnabled}
                onCheckedChange={(val) => {
                  setVoiceIdentityEnabled(val);
                  voiceProfileMutation.mutate({ enabled: val, voice: voiceIdentityVoice });
                }}
                disabled={voiceProfileMutation.isPending}
                data-testid="switch-voice-identity"
              />
            </div>
          </CardHeader>

          {voiceIdentityEnabled && (
            <CardContent className="space-y-5 pt-0">
              {/* Voice picker */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-blue-200/70 uppercase tracking-wider">Proxy Voice</Label>
                <p className="text-xs text-blue-100/40 leading-relaxed">Choose the voice used for your translations now. When LuxTTS launches, your recorded sample will replace this.</p>
                <Select
                  value={voiceIdentityVoice}
                  onValueChange={(v) => {
                    setVoiceIdentityVoice(v);
                    voiceProfileMutation.mutate({ enabled: voiceIdentityEnabled, voice: v });
                  }}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-voice-identity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a3a6e] border-white/10">
                    {[
                      { id: "nova", label: "Nova", desc: "Warm, expressive" },
                      { id: "alloy", label: "Alloy", desc: "Neutral, clear" },
                      { id: "echo", label: "Echo", desc: "Smooth, natural" },
                      { id: "fable", label: "Fable", desc: "Gentle, storytelling" },
                      { id: "onyx", label: "Onyx", desc: "Deep, resonant" },
                      { id: "shimmer", label: "Shimmer", desc: "Bright, energetic" },
                    ].map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-white focus:bg-white/10">
                        <span className="font-medium">{v.label}</span>
                        <span className="text-white/40 ml-2 text-xs">{v.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Voice sample section */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-blue-200/70 uppercase tracking-wider">Voice Reference Sample</Label>
                <p className="text-xs text-blue-100/40 leading-relaxed">Record 10-30 seconds of natural speech. This sample will be used by LuxTTS to match your voice when it becomes available.</p>

                {voiceProfile?.sample?.hasSample ? (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-xs font-medium text-green-300">Sample saved</span>
                        {voiceProfile.sample.uploadedAt && (
                          <span className="text-xs text-white/30">
                            {new Date(voiceProfile.sample.uploadedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {showDeleteConfirm ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => deleteSampleMutation.mutate()}
                            disabled={deleteSampleMutation.isPending}
                            className="text-xs text-[#ff0000] font-medium hover:text-[#ff0000]/80 transition-colors"
                            data-testid="button-confirm-delete-voice"
                          >
                            {deleteSampleMutation.isPending ? "Deleting..." : "Confirm delete"}
                          </button>
                          <button onClick={() => setShowDeleteConfirm(false)} className="text-xs text-white/40 hover:text-white/60">Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="flex items-center gap-1 text-xs text-white/30 hover:text-[#ff0000] transition-colors"
                          data-testid="button-delete-voice-sample"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </div>
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={uploadSampleMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#93c5fd" }}
                      data-testid="button-re-record-voice"
                    >
                      <Mic className="w-3.5 h-3.5" /> Re-record sample
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {isRecording ? (
                      <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-[#ff0000] animate-pulse" />
                            <span className="text-xs font-medium text-[#ff0000]">Recording... {recordingSeconds}s / 30s</span>
                          </div>
                        </div>
                        <div className="w-full rounded-full h-1" style={{ background: "rgba(239,68,68,0.15)" }}>
                          <div className="h-1 rounded-full bg-[#ff0000] transition-all" style={{ width: `${(recordingSeconds / 30) * 100}%` }} />
                        </div>
                        <button
                          onClick={stopRecording}
                          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all"
                          style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" }}
                          data-testid="button-stop-recording-voice"
                        >
                          <StopCircle className="w-3.5 h-3.5" /> Stop and save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={startRecording}
                        disabled={uploadSampleMutation.isPending}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                        style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#93c5fd" }}
                        data-testid="button-start-recording-voice"
                      >
                        {uploadSampleMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Saving sample...</>
                        ) : (
                          <><Mic className="w-4 h-4" /> Record a voice sample</>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Privacy notice */}
              <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Shield className="w-3.5 h-3.5 text-blue-400/60 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-white/30 leading-relaxed">
                  Your voice sample is stored in a private, encrypted bucket under your account. It is never shared or used for any purpose other than voice synthesis on your behalf. You can delete it at any time.
                </p>
              </div>

              {/* LuxTTS coming soon footer */}
              <div className="flex items-center gap-2 pt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60 animate-pulse flex-shrink-0" />
                <p className="text-[10px] text-white/25">LuxTTS custom voice cloning is coming soon. Your sample will be used automatically when it launches.</p>
              </div>
            </CardContent>
          )}
        </Card>
        </SectionBoundary>

        {/* Developer Portal */}
        <SectionBoundary label="Developer Portal">
        <Link href="/developer">
          <Card className="border hover-elevate cursor-pointer scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(140deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
            <CardContent className="flex items-center justify-between py-4 px-4">
              <div className="flex items-center gap-3">
                <Code2 className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-white">Portal Access</p>
                  <p className="text-xs text-blue-100/90">Management platform</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-200/75" />
            </CardContent>
          </Card>
        </Link>
        </SectionBoundary>

        {/* Support */}
        <SectionBoundary label="Support Link">
        <Link href="/support" data-testid="link-support">
          <Card className="border cursor-pointer scroll-brighten hover-elevate" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
            <CardContent className="flex items-center justify-between py-4 px-4">
              <div className="flex items-center gap-3">
                <Headphones className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-white">{t("nav.support") || "Support"}</p>
                  <p className="text-xs text-blue-100/90">Help center & tickets</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-200/75" />
            </CardContent>
          </Card>
        </Link>
        </SectionBoundary>

        {/* Logout */}
        <Button 
          variant="outline" 
          className="w-full text-blue-100 border-blue-500/15 hover:bg-blue-500/10" 
          asChild
          data-testid="button-logout"
          style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}
        >
          <a href="/api/logout">{t("settings.logOut")}</a>
        </Button>

        <div className="h-16 sm:hidden" />
      </main>

      <MobileBottomNav />

      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropImageSrc(null)}
        />
      )}
    </div>
  );
}
