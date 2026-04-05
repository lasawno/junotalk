const BRAND = "junotalk";

export const STORAGE_KEYS = {
  // Voice Translate page settings
  voice:             `${BRAND}_voice`,
  autoplay:          `${BRAND}_autoplay`,
  textSize:          `${BRAND}_textsize`,
  speed:             `${BRAND}_speed`,
  wakeWord:          `${BRAND}_wakeword`,
  translateFromLang: `${BRAND}_translate_from`,
  translateToLang:   `${BRAND}_translate_to`,

  // App-wide preferences
  uiLang:            `${BRAND}-ui-lang`,
  subtitleLang:      `${BRAND}-subtitle-lang`,
  cookieConsent:     `${BRAND}-cookie-consent`,
  splashSeen:        `${BRAND}-splash-seen`,
  onboardingDone:    `${BRAND}-onboarding-complete`,
  pendingRoom:       `${BRAND}-pending-room`,
  translationCache:  `${BRAND}-translation-cache`,
  lowData:           `${BRAND}-low-data`,

  // Theme system
  dashboardTheme:    `${BRAND}-dashboard-theme`,
  themeVersion:      `${BRAND}-theme-v`,
  customThemes:      `${BRAND}-custom-themes`,
  legacyTheme:       `${BRAND}-theme`,

  // Landing page
  betaDismissed:     `${BRAND}-beta-dismissed`,
  siteLang:          `${BRAND}-site-lang`,

  // Update checker
  knownVersion:      `${BRAND}-known-version`,
  pendingUpdate:     `${BRAND}-pending-update`,

  // Social connect browser mode
  socialBrowserMode: `${BRAND}-social-browser-mode`,

  // JunoVision
  visionMode:        `${BRAND}-vision-mode`,
  visionSourceLang:  `${BRAND}-vision-src-lang`,
  visionTargetLang:  `${BRAND}-vision-tgt-lang`,

  // Room-scoped keys (functions return a unique key per room/user)
  myRooms:           (userId: number | string) => `${BRAND}-cached-my-rooms-${userId}`,
  joinedRooms:       (userId: number | string) => `${BRAND}-cached-joined-rooms-${userId}`,
  roomVerified:      (roomCode: string) => `${BRAND}-verified-${roomCode}`,
} as const;

export const DOM_IDS = {
  updateOverlay: `${BRAND}-update-overlay`,
} as const;
