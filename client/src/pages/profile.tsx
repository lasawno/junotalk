import { useState, useEffect, useRef, useCallback } from "react";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Phone, Code2, ChevronRight, Camera, Loader2, MessageSquare, Check, Mail, Video, Shield, AlertTriangle, UserCheck, Globe, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { safeDisplayName, safeInitials } from "@/lib/utils";
import type { UserPreferences } from "@shared/schema";
import MobileBottomNav from "@/components/MobileBottomNav";
import ImageCropper from "@/components/ImageCropper";
import { useI18n } from "@/lib/i18n.jsx";
import { LANGUAGES } from "@/lib/languages";
import BackTriangle from "@/components/BackTriangle";

export default function Profile() {
  useSEO(SEO_CONFIGS.profile);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [lastInitial, setLastInitial] = useState("");
  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsUsernameAvailable, setSettingsUsernameAvailable] = useState<boolean | null>(null);
  const [checkingSettingsUsername, setCheckingSettingsUsername] = useState(false);
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [checklistEmail, setChecklistEmail] = useState("");
  const [checklistPhone, setChecklistPhone] = useState("");
  const [editingChecklist, setEditingChecklist] = useState<string | null>(null);
  const [spokenLanguages, setSpokenLanguages] = useState<string[]>([]);
  const [showLangPicker, setShowLangPicker] = useState(false);

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/preferences"],
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
      if ((preferences as any).spokenLanguages) {
        setSpokenLanguages((preferences as any).spokenLanguages);
      }
    }
  }, [preferences]);

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
      const currentName = displayName.trim();
      const genericNames = new Set(["user", "guest", "anonymous", "unknown", ""]);
      const needsNameUpdate = !currentName || genericNames.has(currentName.toLowerCase());

      if (needsNameUpdate) {
        await apiRequest("PATCH", "/api/user/profile", {
          firstName: settingsUsername.trim(),
        });
      }

      const res = await apiRequest("POST", "/api/username/set", { username: settingsUsername.trim() });
      return res.json();
    },
    onSuccess: (userData: any) => {
      if (userData) {
        queryClient.setQueryData(["/api/auth/user"], userData);
        if (!displayName.trim() || new Set(["user", "guest", "anonymous", "unknown", ""]).has(displayName.trim().toLowerCase())) {
          setDisplayName(settingsUsername.trim());
        }
      }
      toast({ title: t("settings.saved"), description: "Username updated" });
    },
    onError: () => {
      toast({ title: "Couldn't save username", description: "Please try again in a moment" });
    },
  });

  const langBeforeEditRef = useRef<string[]>([]);

  const updateLanguagesMutation = useMutation({
    mutationFn: async (langs: string[]) => {
      return apiRequest("PATCH", "/api/preferences", { spokenLanguages: langs });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      toast({ title: "Languages updated" });
    },
    onError: () => {
      setSpokenLanguages(langBeforeEditRef.current);
      toast({ title: "Failed to update languages", variant: "default" });
    },
  });

  const toggleLanguage = useCallback((code: string) => {
    setSpokenLanguages(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= 5) return prev;
      return [...prev, code];
    });
  }, []);

  const saveLangsAndClose = useCallback(() => {
    langBeforeEditRef.current = [...spokenLanguages];
    updateLanguagesMutation.mutate(spokenLanguages);
    setShowLangPicker(false);
  }, [spokenLanguages, updateLanguagesMutation]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data?: any) => {
      return apiRequest("PATCH", "/api/user/profile", data || { firstName: displayName.trim(), lastName: lastInitial.trim() || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: t("settings.saved") });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("settings.saveError"), variant: "default" });
    },
  });

  return (
    <div className="min-h-screen bg-background relative">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-0 h-16">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back" label={t("settings.profile")} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <SectionBoundary label="Profile Card">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
          <CardContent className="space-y-6 pt-5">
            <div className="flex items-center gap-4">
              <div className="relative">
                <label
                  className="relative group cursor-pointer block"
                  data-testid="button-profile-image"
                >
                  <input
                    ref={profileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileImageChange}
                    disabled={isUploadingPhoto}
                    data-testid="input-profile-image"
                  />
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={user?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-white text-xl font-semibold bg-blue-600">
                      {safeInitials(user?.firstName, user?.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                    {isUploadingPhoto ? (
                      <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
                    ) : (
                      <Camera className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                </label>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white">{t("settings.profile")}</h3>
                <p className="text-xs text-blue-100/90">{t("settings.editProfile")}</p>
                <p className="text-[11px] text-blue-200/75 mt-0.5">{t("settings.changePhoto")}</p>
              </div>
              <div className="flex flex-col items-center gap-1 self-start pt-1" data-testid="profile-badge">
                <div className="w-9 h-9 rounded-full bg-blue-500/15 flex items-center justify-center">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-[10px] text-blue-200/80">Verified</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="display-name" className="text-blue-100">{t("settings.displayName")}</Label>
              <Input
                id="display-name"
                type="text"
                placeholder={t("settings.displayName")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-display-name"
              />
              <p className="text-xs text-blue-100/90">
                This is how others will see you in rooms and video calls
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-username" className="text-blue-100">Username</Label>
              {(user as any)?.username && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-400/20">
                  <span className="text-sm font-medium text-blue-200" data-testid="text-current-handle">
                    @{(user as any).username}
                  </span>
                  <span className="text-xs text-blue-300/50">Your handle</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  id="settings-username"
                  type="text"
                  placeholder="Choose a username"
                  maxLength={20}
                  value={settingsUsername}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "");
                    setSettingsUsername(val);
                    checkSettingsUsername(val);
                  }}
                  data-testid="input-settings-username"
                />
                <Button
                  size="sm"
                  onClick={() => updateUsernameMutation.mutate()}
                  disabled={!settingsUsername.trim() || settingsUsername.trim().length < 3 || settingsUsername.trim() === (user as any)?.username || updateUsernameMutation.isPending}
                  data-testid="button-save-username"
                >
                  {updateUsernameMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (user as any)?.username ? "Update" : "Set"}
                </Button>
              </div>
              {checkingSettingsUsername && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking...
                </p>
              )}
              {!checkingSettingsUsername && settingsUsernameAvailable === true && settingsUsername.length >= 3 && (
                <p className="text-xs text-green-400 flex items-center gap-1" data-testid="text-settings-username-available">
                  <Check className="w-3 h-3" />
                  Available
                </p>
              )}
              {!checkingSettingsUsername && settingsUsernameAvailable === false && settingsUsername.length >= 3 && (
                <p className="text-xs text-red-400 flex items-center gap-1" data-testid="text-settings-username-taken">
                  <AlertTriangle className="w-3 h-3" />
                  Not available
                </p>
              )}
              <p className="text-xs text-blue-100/90">
                Letters, numbers, underscores, dots. Others can find you by this name.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone-number" className="text-blue-100">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-300" />
                  {t("settings.phoneNumber")}
                  <Shield className="w-3 h-3 text-blue-400" />
                </div>
              </Label>
              <Input
                id="phone-number"
                type="text"
                placeholder="No phone number set"
                value={phoneNumber}
                readOnly
                disabled={isLoading}
                data-testid="input-phone-number"
                className="bg-blue-500/10 text-blue-100 border-blue-500/15"
              />
              <p className="text-xs text-blue-100/90 flex items-center gap-1">
                <Shield className="w-3 h-3 text-blue-400" />
                Phone number is encrypted and masked for your security
              </p>
            </div>

            <div className="space-y-3">
              <Label className="text-blue-100">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-300" />
                  Languages I Speak
                </div>
              </Label>
              <p className="text-xs text-blue-100/90">
                Show others which languages you speak, up to 5
              </p>
              {spokenLanguages.length > 0 && (
                <div className="flex flex-wrap gap-2" data-testid="language-badges">
                  {spokenLanguages.map(code => {
                    const lang = LANGUAGES.find(l => l.code === code);
                    return (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-sm font-medium text-blue-200"
                        data-testid={`badge-lang-${code}`}
                      >
                        {lang?.name || code}
                        <button
                          type="button"
                          onClick={() => {
                            const next = spokenLanguages.filter(c => c !== code);
                            langBeforeEditRef.current = [...spokenLanguages];
                            setSpokenLanguages(next);
                            updateLanguagesMutation.mutate(next);
                          }}
                          className="hover:text-red-300 transition-colors"
                          data-testid={`remove-lang-${code}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <SectionBoundary label="Language Picker">
              {!showLangPicker ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowLangPicker(true)}
                  className="border-blue-400/30 text-blue-200 hover:bg-blue-500/15"
                  data-testid="button-add-language"
                >
                  <Globe className="w-4 h-4 mr-1.5" />
                  {spokenLanguages.length === 0 ? "Add Languages" : "Edit Languages"}
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2" data-testid="language-picker">
                    {LANGUAGES.map(lang => {
                      const selected = spokenLanguages.includes(lang.code);
                      const disabled = !selected && spokenLanguages.length >= 5;
                      return (
                        <button
                          key={lang.code}
                          type="button"
                          onClick={() => !disabled && toggleLanguage(lang.code)}
                          disabled={disabled}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            selected
                              ? "bg-blue-500/25 border-blue-400/50 text-blue-200"
                              : disabled
                                ? "bg-transparent border-blue-500/10 text-blue-300/30 cursor-not-allowed"
                                : "bg-transparent border-blue-500/15 text-blue-200/80 hover:bg-blue-500/10 hover:border-blue-400/30"
                          }`}
                          data-testid={`lang-option-${lang.code}`}
                        >
                          {selected && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                          {lang.name}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={saveLangsAndClose}
                    disabled={updateLanguagesMutation.isPending}
                    className="text-blue-300/70"
                    data-testid="button-close-lang-picker"
                  >
                    {updateLanguagesMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Done
                  </Button>
                </div>
              )}
              </SectionBoundary>
            </div>

            <Button
              className="w-full"
              onClick={() => updateProfileMutation.mutate(undefined)}
              disabled={updateProfileMutation.isPending}
              data-testid="button-save-profile"
            >
              {updateProfileMutation.isPending ? t("common.loading") : "Save Profile"}
            </Button>
          </CardContent>
        </Card>
        </SectionBoundary>

        <SectionBoundary label="Profile Checklist">
        <Card className="border scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="profile-checklist">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-white">Complete Your Profile</CardTitle>
            </div>
            <CardDescription className="text-blue-100/90">
              {(() => {
                const hasEmail = !!(user as any)?.emailLinked;
                const hasPhone = !!(preferences as any)?.phoneLinked;
                const hasUsername = !!(user as any)?.username;
                const done = [hasEmail, hasPhone, hasUsername].filter(Boolean).length;
                return done === 3 ? "All set! Your profile is complete." : `${done}/3 completed. Add your details for the best experience.`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border ${(user as any)?.emailLinked ? "border-blue-500/20 bg-blue-500/5" : "border-yellow-500/30 bg-yellow-500/5 cursor-pointer hover:bg-yellow-500/10 transition-colors"}`}
                onClick={() => {
                  if (!(user as any)?.emailLinked && editingChecklist !== "email") {
                    setEditingChecklist("email");
                  }
                }}
                data-testid="checklist-email"
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${(user as any)?.emailLinked ? "bg-blue-500/20" : "bg-yellow-500/20"}`}>
                  {(user as any)?.emailLinked ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Mail className="w-3.5 h-3.5 text-yellow-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${(user as any)?.emailLinked ? "text-blue-300" : "text-yellow-300"}`}>
                    {(user as any)?.emailLinked ? "Email linked" : "Add your email"}
                  </p>
                  {(user as any)?.emailLinked && <p className="text-xs text-blue-100/60 truncate">Linked securely</p>}
                </div>
                {!(user as any)?.emailLinked && <ChevronRight className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
              </div>
              {editingChecklist === "email" && !(user as any)?.emailLinked && (
                <div className="flex gap-2 pl-9">
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={checklistEmail}
                    onChange={(e) => setChecklistEmail(e.target.value)}
                    className="flex-1"
                    data-testid="input-checklist-email"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    disabled={!checklistEmail.trim() || updateProfileMutation.isPending}
                    onClick={async () => {
                      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                      if (!emailRegex.test(checklistEmail.trim())) {
                        toast({ title: "Invalid email", variant: "default" });
                        return;
                      }
                      try {
                        await apiRequest("PATCH", "/api/user/profile", {
                          firstName: displayName.trim() || user?.firstName || "User",
                          email: checklistEmail.trim(),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                        toast({ title: "Email added!" });
                        setEditingChecklist(null);
                        setChecklistEmail("");
                      } catch {
                        toast({ title: "Failed to save email", variant: "default" });
                      }
                    }}
                    data-testid="button-save-checklist-email"
                  >
                    Save
                  </Button>
                </div>
              )}

              <div
                className={`flex items-center gap-3 p-3 rounded-lg border ${(preferences as any)?.phoneLinked ? "border-blue-500/20 bg-blue-500/5" : "border-yellow-500/30 bg-yellow-500/5 cursor-pointer hover:bg-yellow-500/10 transition-colors"}`}
                onClick={() => {
                  if (!(preferences as any)?.phoneLinked && editingChecklist !== "phone") {
                    setEditingChecklist("phone");
                  }
                }}
                data-testid="checklist-phone"
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${(preferences as any)?.phoneLinked ? "bg-blue-500/20" : "bg-yellow-500/20"}`}>
                  {(preferences as any)?.phoneLinked ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Phone className="w-3.5 h-3.5 text-yellow-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${(preferences as any)?.phoneLinked ? "text-blue-300" : "text-yellow-300"}`}>
                    {(preferences as any)?.phoneLinked ? "Phone linked" : "Add your phone number"}
                  </p>
                  {(preferences as any)?.phoneLinked && <p className="text-xs text-blue-100/60">Encrypted and secure</p>}
                </div>
                {!(preferences as any)?.phoneLinked && <ChevronRight className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
              </div>
              {editingChecklist === "phone" && !(preferences as any)?.phoneLinked && (
                <div className="flex gap-2 pl-9">
                  <Input
                    type="tel"
                    inputMode="tel"
                    placeholder="+1 555 123 4567"
                    value={checklistPhone}
                    onChange={(e) => setChecklistPhone(e.target.value)}
                    className="flex-1"
                    data-testid="input-checklist-phone"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    disabled={!checklistPhone.trim() || updateProfileMutation.isPending}
                    onClick={async () => {
                      try {
                        await apiRequest("PATCH", "/api/user/profile", {
                          firstName: displayName.trim() || user?.firstName || "User",
                          phoneNumber: checklistPhone.trim(),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
                        toast({ title: "Phone number added!" });
                        setEditingChecklist(null);
                        setChecklistPhone("");
                      } catch (err: any) {
                        const msg = err?.message || "Failed to save phone number";
                        toast({ title: msg, variant: "default" });
                      }
                    }}
                    data-testid="button-save-checklist-phone"
                  >
                    Save
                  </Button>
                </div>
              )}

              <div
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${(user as any)?.username ? "border-blue-500/20 bg-blue-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}
                onClick={() => {
                  const el = document.getElementById("settings-username");
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => el.focus(), 400);
                  }
                }}
                data-testid="checklist-username"
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${(user as any)?.username ? "bg-blue-500/20" : "bg-yellow-500/20"}`}>
                  {(user as any)?.username ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Code2 className="w-3.5 h-3.5 text-yellow-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${(user as any)?.username ? "text-blue-300" : "text-yellow-300"}`}>
                    {(user as any)?.username ? "Username set" : "Set a username"}
                  </p>
                  {(user as any)?.username && <p className="text-xs text-blue-100/60 truncate">@{(user as any).username}</p>}
                  {!(user as any)?.username && <p className="text-xs text-yellow-100/60">Tap to set your username</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-blue-400/50 flex-shrink-0" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-blue-500/10">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-500/15 text-blue-300 text-xs font-medium" data-testid="status-video">
                <Video className="w-3.5 h-3.5" />
                <span>Video ready</span>
                <Check className="w-3 h-3" />
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-500/15 text-blue-300 text-xs font-medium" data-testid="status-chat">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat ready</span>
                <Check className="w-3 h-3" />
              </div>
            </div>
          </CardContent>
        </Card>
        </SectionBoundary>

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
