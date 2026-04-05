import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  KeyRound, 
  LogOut,
  Plus,
  Copy,
  Check,
  Hash,
  MessageSquare,
  Trash2,
  Share2,
  Loader2,
  Bot,
  X,
  Camera,
  Smartphone,
  ShieldCheck,
  BadgeCheck,
  Lock,
  QrCode,
  UserCheck,
  AlignJustify,
  Mic,
} from "lucide-react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useLocation } from "wouter";
import { CDN_ASSETS } from "@/lib/cdn";
import { apiRequest, queryClient } from "@/lib/queryClient";
import JunoVision from "@/components/JunoVision";
import MediaCarousel from "@/components/MediaCarousel";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import VoiceHero from "@/components/dashboard/VoiceHero";
import ServicesGrid from "@/components/dashboard/ServicesGrid";
import QuickActions from "@/components/dashboard/QuickActions";
import { useToast } from "@/hooks/use-toast";
import { safeDisplayName, safeInitials } from "@/lib/utils";
import { useUpload } from "@/hooks/use-upload";
import JunoVoiceOverlay, { type JunoVoiceOverlayHandle } from "@/components/JunoVoiceOverlay";
import JunoChatModal from "@/components/JunoChatModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ImageCropper from "@/components/ImageCropper";
import type { Room, Feedback, RoomMember, SupportTicket } from "@shared/schema";
import type { User } from "@shared/models/auth";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useI18n } from "@/lib/i18n.jsx";
import { useWebSocket } from "@/hooks/use-websocket";
import ConnectionStatus from "@/components/ConnectionStatus";
import OfflineBanner from "@/components/dashboard/OfflineBanner";
import { InlineConnectionDot } from "@/components/ConnectionDot";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";
import { ChevronDown, Video, Phone as PhoneIcon, MessageCircle } from "lucide-react";
import themeIconImg from "@assets/theme_icon_nobg.png";

import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import blueTextureBg from "@assets/2232E96E-A241-42E0-8DD4-F284B9E0672F_1774918044204.png";
import mossyForestBg from "@assets/Brown_Simple_Smoke_Phone_Wallpaper_1775058777454.jpeg";
import { THEMES } from "@/pages/dashboard-theme";

interface RoomChatMessage {
  id: string;
  roomCode: string;
  fromId: string;
  fromName: string;
  text: string;
  translatedText?: string;
  isTranslating?: boolean;
  imageData?: string;
  videoData?: string;
  mediaType?: "image" | "video";
  timestamp: number;
}


export default function Home() {
  useSEO(SEO_CONFIGS.home);
  const { t, locale } = useI18n();
  const { user, logout } = useAuth();
  const { pullY, refreshing } = usePullToRefresh([
    ["/api/my-rooms"],
    ["/api/joined-rooms"],
    ["/api/my-room-members"],
    ["/api/room-message-counts"],
    ["/api/preferences"],
  ]);
  const [, setLocation] = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [qrRoomCode, setQrRoomCode] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [expandedChats, setExpandedChats] = useState<Record<string, boolean>>({});
  const [expandedRoomActions, setExpandedRoomActions] = useState<Record<string, boolean>>({});
  const [roomChatMessages, setRoomChatMessages] = useState<Record<string, RoomChatMessage[]>>({});
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});
  const [chatLanguage, setChatLanguage] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "en";
    } catch { return "en"; }
  });
  const chatLanguageRef = useRef((() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "en";
    } catch { return "en"; }
  })());
  const [chatPresence, setChatPresence] = useState<Record<string, number>>({});
  const [memberPresence, setMemberPresence] = useState<Record<string, "online" | "in-call" | "offline">>({});
  const chatEndRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showJunoVision, setShowJunoVision] = useState(false);
  const [showJunoChat, setShowJunoChat] = useState(false);
  const [roomsFrost, setRoomsFrost] = useState(false);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTab, setSupportTab] = useState<"chat" | "ticket" | "history">("chat");
  const [chatMessages, setChatMessages] = useState<{role: "user" | "assistant"; content: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [ticketCategory, setTicketCategory] = useState("other");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const supportChatContainerRef = useRef<HTMLDivElement | null>(null);
  const expandedChatsRef = useRef<Record<string, boolean>>({});
  const { toast } = useToast();
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const { uploadFile, isUploading: isUploadingPhoto } = useUpload({
    bucket: "public-assets",
    onSuccess: async (response) => {
      try {
        await new Promise(r => setTimeout(r, 500));
        await apiRequest("POST", "/api/profile-image", { objectPath: response.objectPath });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        toast({ title: t("common.success") });
      } catch {
        toast({ title: t("common.error"), description: "Could not save profile photo. Please try again.", variant: "default" });
      }
    },
    onError: () => {
      toast({ title: t("common.error"), description: "Upload failed. Please try again.", variant: "default" });
    },
  });

  const handleProfileImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("common.error"), description: "Please select an image file", variant: "default" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: t("common.error"), description: "Image must be under 5MB", variant: "default" });
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

  const { data: userPrefs } = useQuery<{ subtitleLanguage?: string; phoneMasked?: string; phoneLinked?: boolean }>({
    queryKey: ["/api/preferences"],
    enabled: !!user,
  });

  // ── Juno voice overlay — isolated in its own component + ErrorBoundary ───
  const junoRef = useRef<JunoVoiceOverlayHandle>(null);

  const translateText = useCallback(async (text: string, targetLang: string): Promise<string> => {
    try {
      const response = await fetch("/api/v1/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, targetLang }),
      });
      if (!response.ok) return text;
      const data = await response.json();
      return data.translatedText || text;
    } catch {
      return text;
    }
  }, []);

  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (prefsAppliedRef.current) return;
    if (!userPrefs?.subtitleLanguage) return;
    let hasManualChoice = false;
    try { hasManualChoice = !!localStorage.getItem(STORAGE_KEYS.subtitleLang); } catch {}
    if (hasManualChoice) {
      prefsAppliedRef.current = true;
      return;
    }
    prefsAppliedRef.current = true;
    const lang = userPrefs.subtitleLanguage;
    if (lang === chatLanguageRef.current) return;
    setChatLanguage(lang);
    chatLanguageRef.current = lang;
    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, lang); } catch {}
    if (lang !== "en") {
      setRoomChatMessages(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(rc => {
          updated[rc] = updated[rc].map(m => {
            if (m.text && m.text !== "[Image]" && m.text !== "[Video]" && m.text !== "[Emoji]" && !m.translatedText) {
              translateText(m.text, lang).then(translated => {
                if (chatLanguageRef.current !== lang) return;
                setRoomChatMessages(p => ({
                  ...p,
                  [rc]: (p[rc] || []).map(msg =>
                    msg.id === m.id ? { ...msg, translatedText: translated, isTranslating: false } : msg
                  ),
                }));
              });
              return { ...m, isTranslating: true };
            }
            return m;
          });
        });
        return updated;
      });
    }
  }, [userPrefs, translateText]);

  const handleChatLanguageChange = useCallback(async (lang: string) => {
    setChatLanguage(lang);
    chatLanguageRef.current = lang;
    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, lang); } catch {}
    try {
      await apiRequest("PATCH", "/api/preferences", { subtitleLanguage: lang });
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    } catch {}

    if (lang === "en") {
      setRoomChatMessages(prev => {
        const updated: Record<string, RoomChatMessage[]> = {};
        for (const [code, msgs] of Object.entries(prev)) {
          updated[code] = msgs.map(m => ({ ...m, translatedText: undefined, isTranslating: false }));
        }
        return updated;
      });
      return;
    }

    let workList: { code: string; msg: RoomChatMessage }[] = [];
    setRoomChatMessages(prev => {
      const updated: Record<string, RoomChatMessage[]> = {};
      for (const [code, msgs] of Object.entries(prev)) {
        updated[code] = msgs.map(m => {
          workList.push({ code, msg: m });
          return { ...m, isTranslating: true, translatedText: undefined };
        });
      }
      return updated;
    });

    const BATCH_SIZE = 5;
    for (let i = 0; i < workList.length; i += BATCH_SIZE) {
      const batch = workList.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(({ code, msg }) =>
        translateText(msg.text, lang).then(translated => {
          if (chatLanguageRef.current !== lang) return;
          setRoomChatMessages(prev => ({
            ...prev,
            [code]: (prev[code] || []).map(m =>
              m.id === msg.id ? { ...m, translatedText: translated, isTranslating: false } : m
            ),
          }));
        }).catch(() => {
          if (chatLanguageRef.current !== lang) return;
          setRoomChatMessages(prev => ({
            ...prev,
            [code]: (prev[code] || []).map(m =>
              m.id === msg.id ? { ...m, isTranslating: false } : m
            ),
          }));
        })
      ));
    }
  }, [translateText]);

  const { data: myRooms = [], isLoading: loadingRooms, isError: myRoomsError } = useQuery<Room[]>({
    queryKey: ["/api/my-rooms"],
    refetchOnWindowFocus: true,
    staleTime: 0,
    refetchOnReconnect: true,
  });
  const myRoomsRef = useRef<Room[]>([]);
  const subscribedRoomsRef = useRef<Set<string>>(new Set());
  useEffect(() => { myRoomsRef.current = myRooms; }, [myRooms]);

  const cacheKey = user?.id ? STORAGE_KEYS.myRooms(user.id) : null;
  const joinedCacheKey = user?.id ? STORAGE_KEYS.joinedRooms(user.id) : null;

  useEffect(() => {
    if (myRooms.length > 0 && cacheKey) {
      try { sessionStorage.setItem(cacheKey, JSON.stringify(myRooms)); } catch {}
    }
  }, [myRooms, cacheKey]);

  const { data: joinedRooms = [], isError: joinedRoomsError } = useQuery<(Room & { hostName?: string; hostProfileImage?: string | null })[]>({
    queryKey: ["/api/joined-rooms"],
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 0,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (joinedRooms.length > 0 && joinedCacheKey) {
      try { sessionStorage.setItem(joinedCacheKey, JSON.stringify(joinedRooms)); } catch {}
    }
  }, [joinedRooms, joinedCacheKey]);

  const cachedMyRooms = useMemo(() => {
    if (myRooms.length > 0) return myRooms;
    if (myRoomsError && cacheKey) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached) as Room[];
      } catch {}
    }
    return myRooms;
  }, [myRooms, myRoomsError, cacheKey]);

  const cachedJoinedRooms = useMemo(() => {
    if (joinedRooms.length > 0) return joinedRooms;
    if (joinedRoomsError && joinedCacheKey) {
      try {
        const cached = sessionStorage.getItem(joinedCacheKey);
        if (cached) return JSON.parse(cached) as (Room & { hostName?: string; hostProfileImage?: string | null })[];
      } catch {}
    }
    return joinedRooms;
  }, [joinedRooms, joinedRoomsError, joinedCacheKey]);

  const { data: roomMembersData = {} } = useQuery<Record<string, (RoomMember & { user?: User })[]>>({
    queryKey: ["/api/my-room-members"],
    enabled: !!user && (cachedMyRooms.length > 0 || cachedJoinedRooms.length > 0),
    refetchInterval: 30000,
  });

  useEffect(() => {
    const allMemberIds = new Set<string>();
    Object.values(roomMembersData).forEach(members => {
      members.forEach(m => {
        if (m.userId && m.userId !== user?.id) allMemberIds.add(m.userId);
      });
    });
    cachedJoinedRooms.forEach(room => {
      if (room.hostId && room.hostId !== user?.id) allMemberIds.add(room.hostId);
    });
    if (allMemberIds.size === 0) return;
    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userIds: Array.from(allMemberIds) }),
    })
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        setMemberPresence(prev => ({ ...prev, ...data } as Record<string, "online" | "in-call" | "offline">));
      })
      .catch(() => {});
  }, [roomMembersData, user?.id]);

  useEffect(() => {
    if (!myRoomsError && !joinedRoomsError) return;
    let attempt = 0;
    const retry = () => {
      const delay = Math.min(10000 * Math.pow(2, attempt), 60000);
      attempt++;
      return setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/my-rooms"] });
        queryClient.invalidateQueries({ queryKey: ["/api/joined-rooms"] });
        timerId = retry();
      }, delay);
    };
    let timerId = retry();
    return () => clearTimeout(timerId);
  }, [myRoomsError, joinedRoomsError]);

  const { data: feedbackList = [], isLoading: loadingFeedback } = useQuery<Feedback[]>({
    queryKey: ["/api/feedback"],
  });

  const { data: myTickets = [], isLoading: loadingTickets } = useQuery<SupportTicket[]>({
    queryKey: ["/api/support/tickets"],
    enabled: !!user,
  });



  const scrollLockCleanupRef = useRef<(() => void) | null>(null);
  const scrollAnchorRef = useRef<{ element: Element; offsetTop: number } | null>(null);

  const lockScroll = useCallback(() => {
    if (scrollLockCleanupRef.current) scrollLockCleanupRef.current();

    const activeEl = document.activeElement as HTMLElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
      activeEl.blur();
    }

    const anchorEl = document.elementFromPoint(window.innerWidth / 2, 100);
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      scrollAnchorRef.current = { element: anchorEl, offsetTop: rect.top };
    }

    const target = window.scrollY;
    const handler = () => {
      if (scrollAnchorRef.current) {
        const rect = scrollAnchorRef.current.element.getBoundingClientRect();
        const drift = rect.top - scrollAnchorRef.current.offsetTop;
        if (Math.abs(drift) > 2) {
          window.scrollBy({ top: drift, behavior: "instant" as ScrollBehavior });
        }
      } else if (Math.abs(window.scrollY - target) > 2) {
        window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
      }
    };
    window.addEventListener("scroll", handler, { passive: false });

    let resizeCleanup: (() => void) | null = null;
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const resizeHandler = () => {
        requestAnimationFrame(handler);
      };
      vv.addEventListener("resize", resizeHandler);
      resizeCleanup = () => vv.removeEventListener("resize", resizeHandler);
    }

    const timeout = setTimeout(() => {
      window.removeEventListener("scroll", handler);
      resizeCleanup?.();
      scrollAnchorRef.current = null;
      scrollLockCleanupRef.current = null;
    }, 1200);
    scrollLockCleanupRef.current = () => {
      window.removeEventListener("scroll", handler);
      resizeCleanup?.();
      clearTimeout(timeout);
      scrollAnchorRef.current = null;
      scrollLockCleanupRef.current = null;
    };
  }, []);

  const unlockScroll = useCallback(() => {
    if (scrollLockCleanupRef.current) scrollLockCleanupRef.current();
  }, []);

  const sendSupportChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    lockScroll();
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    const scrollChat = () => {
      const container = supportChatContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    setTimeout(scrollChat, 50);
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      lockScroll();
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply || t("error.somethingWentWrong") }]);
    } catch {
      lockScroll();
      setChatMessages(prev => [...prev, { role: "assistant", content: t("error.connectionLost") }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        scrollChat();
        setTimeout(unlockScroll, 300);
      }, 100);
    }
  };

  const submitTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim() || ticketSubmitting) return;
    lockScroll();
    setTicketSubmitting(true);
    try {
      await apiRequest("POST", "/api/support/tickets", {
        category: ticketCategory,
        subject: ticketSubject,
        description: ticketDescription,
        priority: ticketPriority,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setTicketSubject("");
      setTicketDescription("");
      setTicketCategory("other");
      setTicketPriority("medium");
      setSupportTab("history");
      toast({ title: t("support.ticketSubmitted"), description: "Our team will review your issue." });
    } catch {
      toast({ title: t("common.error"), description: t("support.ticketError"), variant: "default" });
    } finally {
      setTicketSubmitting(false);
      setTimeout(unlockScroll, 500);
    }
  };

  const handleHomeWsMessage = useCallback((message: any) => {
    if (message.type === "home-chat-message") {
      const msg = message.message as RoomChatMessage;
      const lang = chatLanguageRef.current || "en";
      const needsMsgTranslation = lang && lang !== "en";

      // Only call translate API when user has opted into a non-English subtitle language
      setRoomChatMessages(prev => ({
        ...prev,
        [msg.roomCode]: [...(prev[msg.roomCode] || []), { ...msg, isTranslating: !!needsMsgTranslation }],
      }));

      if (!needsMsgTranslation) return;

      fetch("/api/v1/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: msg.text, targetLang: lang }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) {
            setRoomChatMessages(prev => ({
              ...prev,
              [msg.roomCode]: (prev[msg.roomCode] || []).map(m =>
                m.id === msg.id ? { ...m, isTranslating: false } : m
              ),
            }));
            return;
          }
          const translated = data.translatedText || msg.text;
          if (translated !== msg.text) {
            setRoomChatMessages(prev => ({
              ...prev,
              [msg.roomCode]: (prev[msg.roomCode] || []).map(m =>
                m.id === msg.id ? { ...m, translatedText: translated, isTranslating: false } : m
              ),
            }));
          } else {
            setRoomChatMessages(prev => ({
              ...prev,
              [msg.roomCode]: (prev[msg.roomCode] || []).map(m =>
                m.id === msg.id ? { ...m, isTranslating: false } : m
              ),
            }));
          }
        })
        .catch(() => {
          setRoomChatMessages(prev => ({
            ...prev,
            [msg.roomCode]: (prev[msg.roomCode] || []).map(m =>
              m.id === msg.id ? { ...m, isTranslating: false } : m
            ),
          }));
        });
    } else if (message.type === "chat-presence") {
      setChatPresence(prev => ({
        ...prev,
        [message.roomCode]: message.count,
      }));
    } else if (message.type === "user-presence-update") {
      setMemberPresence(prev => ({
        ...prev,
        [message.userId]: message.status,
      }));
    } else if (message.type === "msg-count-update") {
      queryClient.invalidateQueries({ queryKey: ["/api/room-message-counts"] });
    } else if (message.type === "member-joined") {
      queryClient.invalidateQueries({ queryKey: ["/api/my-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/joined-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-room-members"] });
    }
  }, []);

  const handleHomeWsOpen = useCallback((ws: WebSocket) => {
    subscribedRoomsRef.current.clear();
    myRoomsRef.current.forEach(room => {
      if (!subscribedRoomsRef.current.has(room.code)) {
        ws.send(JSON.stringify({ type: "home-chat-subscribe", roomCode: room.code }));
        subscribedRoomsRef.current.add(room.code);
      }
    });
  }, [user]);

  const { status: homeConnectionStatus, send: homeWsSend, getWs: homeGetWs, quality: homeConnectionQuality, rtt: homeConnectionRtt } = useWebSocket({
    userId: user?.id || null,
    onMessage: handleHomeWsMessage,
    onOpen: handleHomeWsOpen,
    onReconnect: handleHomeWsOpen,
    enabled: !!user,
  });

  useEffect(() => {
    const ws = homeGetWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    cachedMyRooms.forEach(room => {
      if (!subscribedRoomsRef.current.has(room.code)) {
        ws.send(JSON.stringify({ type: "home-chat-subscribe", roomCode: room.code }));
        subscribedRoomsRef.current.add(room.code);
      }
    });
  }, [cachedMyRooms, homeGetWs]);

  // Refresh time-ago labels every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 120000);
    return () => clearInterval(interval);
  }, []);

  const toggleChat = useCallback(async (roomCode: string) => {
    const isExpanding = !expandedChats[roomCode];
    const scrollY = window.scrollY;
    setExpandedChats(prev => {
      const updated = { ...prev, [roomCode]: isExpanding };
      expandedChatsRef.current = updated;
      return updated;
    });
    const restoreScroll = () => window.scrollTo(0, scrollY);
    requestAnimationFrame(restoreScroll);
    setTimeout(restoreScroll, 0);
    setTimeout(restoreScroll, 50);
    setTimeout(restoreScroll, 100);

    if (isExpanding) {
      try {
        const res = await fetch(`/api/room-messages/${roomCode}`, { credentials: "include" });
        if (res.ok) {
          const messages: RoomChatMessage[] = await res.json();
          setRoomChatMessages(prev => ({ ...prev, [roomCode]: messages }));
          const lang = chatLanguageRef.current || "en";

          // Only translate history if user has opted into a non-English subtitle language
          if (lang !== "en" && messages.length > 0) {
            setRoomChatMessages(prev => ({
              ...prev,
              [roomCode]: (prev[roomCode] || []).map(m => ({ ...m, isTranslating: true })),
            }));
            for (const msg of messages) {
              translateText(msg.text, lang).then(translated => {
                if (chatLanguageRef.current !== lang) return;
                setRoomChatMessages(prev => ({
                  ...prev,
                  [roomCode]: (prev[roomCode] || []).map(m =>
                    m.id === msg.id ? { ...m, translatedText: translated, isTranslating: false } : m
                  ),
                }));
              }).catch(() => {
                if (chatLanguageRef.current !== lang) return;
                setRoomChatMessages(prev => ({
                  ...prev,
                  [roomCode]: (prev[roomCode] || []).map(m =>
                    m.id === msg.id ? { ...m, isTranslating: false } : m
                  ),
                }));
              });
            }
          }
        }
      } catch {}
      setTimeout(() => {
        const container = document.querySelector(`[data-testid="chat-messages-${roomCode}"]`);
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }, 50);
    } else {
      expandedChatsRef.current = { ...expandedChatsRef.current, [roomCode]: false };
    }
  }, [expandedChats, user, translateText]);

  const sendHomeChat = useCallback((roomCode: string) => {
    const text = chatInputs[roomCode]?.trim();
    if (!text || !user) return;

    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lang = chatLanguageRef.current;
    const needsTranslation = lang && lang !== "en";
    const fromName = user.firstName || "You";
    const msg: RoomChatMessage = {
      id: msgId,
      roomCode,
      fromId: user.id,
      fromName,
      text,
      isTranslating: !!needsTranslation,
      timestamp: Date.now(),
    };
    setRoomChatMessages(prev => ({
      ...prev,
      [roomCode]: [...(prev[roomCode] || []), msg],
    }));
    setChatInputs(prev => ({ ...prev, [roomCode]: "" }));

    const ws = homeGetWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      homeWsSend({
        type: "home-chat-send",
        roomCode,
        text,
        fromName,
      });
    } else {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, fromName }),
      }).catch(() => {});
    }

    if (needsTranslation) {
      translateText(text, lang).then(translated => {
        if (chatLanguageRef.current !== lang) return;
        setRoomChatMessages(prev => ({
          ...prev,
          [roomCode]: (prev[roomCode] || []).map(m =>
            m.id === msgId ? { ...m, translatedText: translated, isTranslating: false } : m
          ),
        }));
      }).catch(() => {
        if (chatLanguageRef.current !== lang) return;
        setRoomChatMessages(prev => ({
          ...prev,
          [roomCode]: (prev[roomCode] || []).map(m =>
            m.id === msgId ? { ...m, isTranslating: false } : m
          ),
        }));
      });
    }
  }, [chatInputs, user, translateText]);

  useEffect(() => {
    Object.keys(expandedChats).forEach(code => {
      if (expandedChats[code]) {
        const container = document.querySelector(`[data-testid="chat-messages-${code}"]`);
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }
    });
  }, [roomChatMessages, expandedChats]);

  const submitFeedbackMutation = useMutation({
    mutationFn: async () => {
      lockScroll();
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
        title: t("home.feedbackSuccess"),
        description: "Your comment has been shared with everyone.",
      });
      setTimeout(unlockScroll, 500);
    },
    onError: () => {
      unlockScroll();
      toast({
        title: t("common.error"),
        description: t("home.feedbackError"),
        variant: "default",
      });
    },
  });

  const activeRoomsRef = useRef<HTMLDivElement | null>(null);

  const deleteRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      return apiRequest("DELETE", `/api/rooms/${roomId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-rooms"] });
      toast({
        title: t("home.deleteRoom"),
        description: "The room has been removed from your account",
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("home.deleteRoom"),
        variant: "default",
      });
    },
  });

  const leaveRoomMutation = useMutation({
    mutationFn: async (roomCode: string) => {
      return apiRequest("DELETE", `/api/room-members/${roomCode}/leave`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/joined-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-room-members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      toast({
        title: t("home.leaveRoom"),
        description: "You have left this room",
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("home.leaveRoom"),
        variant: "default",
      });
    },
  });

  const handleJoinRoom = async () => {
    if (joinCode.length !== 6) {
      toast({
        title: t("common.error"),
        description: t("home.enterRoomCode"),
        variant: "default",
      });
      return;
    }
    
    try {
      const res = await fetch(`/api/rooms/${joinCode.toUpperCase()}`, { credentials: "include" });
      if (res.ok) {
        setLocation(`/room/${joinCode.toUpperCase()}/call`);
      } else {
        toast({
          title: t("common.error"),
          description: t("home.enterRoomCode"),
          variant: "default",
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        description: t("home.joinRoom"),
        variant: "default",
      });
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast({
      title: t("home.copiedCode"),
      description: t("home.shareRoom"),
    });
  };

  const getShareableLink = (code: string) => {
    return `${window.location.origin}/join/${code}`;
  };

  const copyLink = (code: string) => {
    const link = getShareableLink(code);
    navigator.clipboard.writeText(link);
    setCopiedLink(code);
    setTimeout(() => setCopiedLink(null), 2000);
    toast({
      title: t("home.copiedCode"),
      description: t("home.shareRoom"),
    });
  };

  const shareRoom = async (code: string) => {
    const link = getShareableLink(code);
    const shareData = {
      title: "Join my JunoTalk call",
      text: `Join my video call with live translated captions! Use code: ${code}`,
      url: link,
    };
    
    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        // User cancelled or share failed, fallback to copy
        copyLink(code);
      }
    } else {
      // Fallback to copying the link
      copyLink(code);
    }
  };

  const shareQrCode = async (code: string) => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `junotalk-${code}.png`, { type: "image/png" });
      const shareData = { files: [file], title: "Join my JunoTalk room", text: `Use code ${code} to join` };
      if (navigator.share && navigator.canShare?.(shareData)) {
        try {
          await navigator.share(shareData);
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `junotalk-${code}.png`; a.click();
          URL.revokeObjectURL(url);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `junotalk-${code}.png`; a.click();
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  };

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    return safeInitials(firstName, lastName);
  };

  const getThemeConfig = (themeId: string): { bg: string | null; overlay: number } => {
    if (themeId === "blue-wave")   return { bg: CDN_ASSETS.themes.frost,      overlay: 0.55 };
    if (themeId === "liquid-blue") return { bg: CDN_ASSETS.themes.liquidBlue, overlay: 0.35 };
    if (themeId === "blue-lines")  return { bg: CDN_ASSETS.themes.blueLines,  overlay: 0.30 };
    if (themeId === "aurora")      return { bg: CDN_ASSETS.themes.aurora,     overlay: 0.35 };
    if (themeId === "storm")       return { bg: CDN_ASSETS.themes.storm,      overlay: 0.30 };
    if (themeId === "ember")       return { bg: CDN_ASSETS.themes.ember,      overlay: 0.40 };
    if (themeId === "void")        return { bg: CDN_ASSETS.themes.void,       overlay: 0.45 };
    if (themeId === "forest")      return { bg: CDN_ASSETS.themes.forest,     overlay: 0.25 };
    if (themeId === "prism")       return { bg: CDN_ASSETS.themes.prism,      overlay: 0.25 };
    if (themeId === "circuit")     return { bg: CDN_ASSETS.themes.circuit,    overlay: 0.20 };
    if (themeId === "spectrum")    return { bg: CDN_ASSETS.themes.spectrum,   overlay: 0.28 };
    if (themeId === "frost")       return { bg: CDN_ASSETS.themes.frost,      overlay: 0.55 };
    if (themeId === "silver")      return { bg: CDN_ASSETS.themes.silver,     overlay: 0.52 };
    if (themeId === "deep-black")  return { bg: CDN_ASSETS.themes.deepBlack,  overlay: 0.12 };
    if (themeId === "rain-glass")   return { bg: CDN_ASSETS.themes.rainGlass,  overlay: 0.28 };
    if (themeId === "blue-texture") return { bg: blueTextureBg,                overlay: 0.08 };
    if (themeId === "mossy-forest") return { bg: mossyForestBg,                overlay: 0.30 };
    try {
      const custom = JSON.parse(localStorage.getItem(STORAGE_KEYS.customThemes) || "[]");
      const found = custom.find((t: { id: string; bg: string; overlay: number }) => t.id === themeId);
      if (found) return { bg: found.bg, overlay: found.overlay };
    } catch {}
    return { bg: null, overlay: 0 };
  };

  const [themeConfig, setThemeConfig] = useState(() => {
    return getThemeConfig(localStorage.getItem(STORAGE_KEYS.dashboardTheme) || "blue-texture");
  });

  // Seed the default theme for first-time visitors so it is always persisted
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEYS.dashboardTheme)) {
      localStorage.setItem(STORAGE_KEYS.dashboardTheme, "blue-texture");
      setThemeConfig(getThemeConfig("blue-texture"));
    }
  }, []);

  useEffect(() => {
    const onStorage = () => {
      setThemeConfig(getThemeConfig(localStorage.getItem(STORAGE_KEYS.dashboardTheme) || "blue-texture"));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div className="h-[100dvh] bg-background relative flex flex-col overflow-hidden">

      {/* ── Juno voice overlay — isolated component, ErrorBoundary ensures home never crashes ── */}
      <ErrorBoundary silent>
        <JunoVoiceOverlay ref={junoRef} userLang={userPrefs?.subtitleLanguage} />
      </ErrorBoundary>

      {/* ── Juno chat popup (wide card, QR-style) ── */}
      <JunoChatModal
        isOpen={showJunoChat}
        onClose={() => setShowJunoChat(false)}
        userLang={userPrefs?.subtitleLanguage}
      />

      {themeConfig.bg && (
        <>
          <div
            className="fixed inset-0 z-0 pointer-events-none"
            style={{ backgroundImage: `url('${themeConfig.bg}')`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
          />
          {themeConfig.overlay > 0 && (
            <div className="fixed inset-0 z-0 pointer-events-none" style={{ background: `rgba(0,0,0,${themeConfig.overlay})` }} />
          )}
        </>
      )}
      <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
      <input
        ref={profileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleProfileImageChange}
        data-testid="input-profile-image"
      />

      

      {/* Top header bar */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="flex items-center justify-between px-4 h-16">
        {/* Left: branding */}
        <div className="flex flex-col leading-none">
          <span className="text-2xl font-extrabold tracking-tight" style={{ textShadow: "0 0 20px rgba(59,130,246,0.4)" }} data-testid="text-home-logo-name">
            <span className="text-white">Juno</span><span style={{ color: "#60a5fa" }}>Talk</span>
          </span>
          <span className="text-[10px] font-semibold tracking-widest uppercase mt-0.5" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.18em" }}>Dashboard</span>
        </div>

        {/* Right: avatar + theme + menu */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocation("/profile")}
            className="focus:outline-none active:scale-95 transition-transform relative"
            data-testid="button-header-avatar"
          >
            <Avatar className="border-2" style={{ width: 54, height: 54, borderColor: "rgba(96,165,250,0.4)" }}>
              <AvatarImage src={(user as any)?.profileImageUrl || (user as any)?.profileImage || ""} alt="Profile" />
              <AvatarFallback className="text-sm font-semibold" style={{ background: "rgba(59,130,246,0.2)", color: "#93c5fd" }}>
                {safeInitials((user as any)?.firstName, (user as any)?.lastName)}
              </AvatarFallback>
            </Avatar>
            {/* Connection status badge */}
            <span className="absolute bottom-0.5 right-0.5 pointer-events-none">
              <InlineConnectionDot />
            </span>
          </button>

          {/* Theme palette button */}
          <button
            onClick={() => { setShowThemeDropdown(!showThemeDropdown); setShowMenu(false); }}
            className="flex items-center justify-center active:scale-90 transition-all"
            style={{ opacity: showThemeDropdown ? 1 : 0.85 }}
            data-testid="button-header-theme"
          >
            <img src={themeIconImg} alt="theme" className="w-8 h-8 object-contain" />
          </button>

          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center justify-center rounded-xl active:scale-90 transition-all"
            style={{
              width: "38px",
              height: "38px",
              background: "linear-gradient(135deg, rgba(32,62,125,0.95) 0%, rgba(25,52,110,0.9) 100%)",
              border: "1.5px solid rgba(96,165,250,0.45)",
            }}
            data-testid="button-header-menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-white/90">
              <line x1="3" y1="5"  x2="17" y2="5"  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="3" y1="15" x2="17" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      </div>

      {/* Theme picker dropdown */}
      {showThemeDropdown && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowThemeDropdown(false)} />
          <div
            className="absolute right-4 z-40 mt-1 rounded-2xl overflow-hidden shadow-2xl"
            style={{
              top: "64px",
              width: "calc(100vw - 32px)",
              maxWidth: "380px",
              background: "rgba(14,30,76,0.97)",
              border: "1px solid rgba(96,165,250,0.2)",
              backdropFilter: "blur(20px)",
            }}
            data-testid="theme-dropdown"
          >
            <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <img src={themeIconImg} alt="theme" className="w-5 h-5 object-contain" />
              <span className="text-sm font-semibold text-white">Dashboard Theme</span>
            </div>
            <div className="p-3 grid grid-cols-4 gap-2">
              {THEMES.map((theme) => {
                const isSelected = (localStorage.getItem(STORAGE_KEYS.dashboardTheme) || "blue-texture") === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => {
                      localStorage.setItem(STORAGE_KEYS.dashboardTheme, theme.id);
                      setThemeConfig(getThemeConfig(theme.id));
                      setShowThemeDropdown(false);
                    }}
                    className="flex flex-col items-center gap-1 active:scale-95 transition-transform"
                    data-testid={`theme-quick-${theme.id}`}
                  >
                    <div
                      className="w-full rounded-lg overflow-hidden"
                      style={{
                        height: "52px",
                        border: isSelected ? "2px solid rgba(96,165,250,0.9)" : "1.5px solid rgba(255,255,255,0.12)",
                        boxShadow: isSelected ? "0 0 8px rgba(96,165,250,0.4)" : "none",
                        background: theme.preview ? "transparent" : "linear-gradient(135deg, #1a3a80 0%, #2a50a0 100%)",
                        position: "relative",
                      }}
                    >
                      {theme.preview
                        ? <img src={theme.preview} alt={theme.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full" style={{ background: "linear-gradient(135deg, #1a3a80 0%, #2a50a0 50%, #1a3a80 100%)" }} />
                      }
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.25)" }}>
                          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-white/60 text-center leading-tight line-clamp-1 w-full">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Hamburger dropdown menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
          <div
            className="absolute right-4 z-40 mt-1 w-48 rounded-xl overflow-hidden shadow-xl"
            style={{
              top: "64px",
              background: "rgba(18,38,90,0.97)",
              border: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(16px)",
            }}
            data-testid="menu-dropdown"
          >
            {[
              { label: "Profile", path: "/profile" },
              { label: "Settings", path: "/settings" },
            ].map(({ label, path }) => (
              <button
                key={path}
                onClick={() => { setShowMenu(false); setLocation(path); }}
                className="w-full text-left px-4 py-3 text-base text-white/80 hover:bg-white/8 hover:text-white transition-colors border-b border-white/5"
                data-testid={`menu-item-${label.toLowerCase().replace(" ", "-")}`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setShowMenu(false); setLocation("/ai-agent-hub"); }}
              className="w-full text-left px-4 py-3 text-base text-white/80 hover:bg-white/8 hover:text-white transition-colors border-b border-white/5 flex flex-col items-start gap-0.5"
              data-testid="menu-item-ai-agent-hub"
            >
              <span>AI Agent Hub</span>
              <span className="text-xs" style={{ color: "#facc15" }}>Coming Soon</span>
            </button>
            <button
              onClick={() => { setShowMenu(false); logout(); }}
              className="w-full text-left px-4 py-3 text-base text-[#ff0000]/80 hover:bg-[#ff0000]/10 hover:text-[#ff0000] transition-colors"
              data-testid="menu-item-logout"
            >
              Sign Out
            </button>
          </div>
        </>
      )}

      {/* Offline / buffering banner */}
      <OfflineBanner />

      {/* Main Content */}
      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-1 pb-2 relative z-10 flex-1 flex flex-col overflow-hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderLeft: "1px solid rgba(96,165,250,0.25)", borderRight: "1px solid rgba(96,165,250,0.25)" }}>
        <VoiceHero
          onMicTap={() => junoRef.current?.handleMicTap()}
          onOpenChat={() => setShowJunoChat(true)}
        />
        <div className="mt-3">
          <ServicesGrid onOpenJunoVision={() => setShowJunoVision(true)} />
        </div>

        {/* My Active Rooms - includes both created and joined rooms */}
        <SectionBoundary label="Active Rooms">
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Frost toggle — right side tab */}
          <button
            onClick={() => setRoomsFrost(f => !f)}
            data-testid="toggle-rooms-frost"
            aria-label={roomsFrost ? "Frost on" : "Frost off"}
            className="absolute z-20 focus:outline-none flex flex-col items-center gap-1.5"
            style={{ right: -1, top: "50%", transform: "translateY(-50%)", padding: "10px 5px", background: roomsFrost ? "rgba(20,50,110,0.95)" : "rgba(16,32,72,0.95)", borderRadius: "8px 0 0 8px", border: "1px solid rgba(255,255,255,0.10)", borderRight: "none", boxShadow: "-2px 0 12px rgba(0,0,0,0.3)" }}
          >
            {/* vertical pill */}
            <div
              className="relative rounded-full transition-colors duration-300"
              style={{ width: 18, height: 34, background: roomsFrost ? "rgba(59,130,246,0.80)" : "rgba(255,255,255,0.13)" }}
            >
              <div
                className="absolute rounded-full bg-white transition-transform duration-300"
                style={{ width: 14, height: 14, left: 2, transform: roomsFrost ? "translateY(18px)" : "translateY(2px)", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" }}
              />
            </div>
            {/* label */}
            <span
              className="text-[9px] font-semibold tracking-wide"
              style={{ writingMode: "vertical-rl", textOrientation: "mixed", color: roomsFrost ? "rgba(147,197,253,0.9)" : "rgba(255,255,255,0.30)", letterSpacing: 1 }}
            >
              {roomsFrost ? "ON" : "OFF"}
            </span>
          </button>

          <Card ref={activeRoomsRef} data-testid="section-active-rooms" className="scroll-brighten flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: roomsFrost ? "rgba(4,12,40,0.82)" : "rgba(16,32,72,0.85)", backdropFilter: roomsFrost ? "blur(22px) saturate(1.6)" : "blur(0px) saturate(1)", WebkitBackdropFilter: roomsFrost ? "blur(22px) saturate(1.6)" : "blur(0px) saturate(1)", borderRadius: "1.25rem", border: roomsFrost ? "1px solid rgba(255,255,255,0.10)" : "1px solid transparent", boxShadow: roomsFrost ? "0 4px 32px rgba(0,0,0,0.45)" : "none", transition: "background 0.35s, border-color 0.35s, box-shadow 0.35s, backdrop-filter 0.35s, -webkit-backdrop-filter 0.35s" }}>
          <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden pb-1 pt-1.5">
            {loadingRooms ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-blue-500/10 animate-pulse">
                    <div className="h-8 w-8 bg-blue-400/20 rounded-md" />
                    <div className="h-4 w-16 bg-blue-400/20 rounded" />
                    <div className="flex-1" />
                    <div className="h-6 w-6 bg-blue-400/20 rounded-full" />
                    <div className="h-8 w-16 bg-blue-400/20 rounded-md" />
                  </div>
                ))}
              </div>
            ) : cachedMyRooms.length === 0 && cachedJoinedRooms.length === 0 ? (
              <div className="text-center py-8 text-blue-200/70">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t("home.noActiveRooms")}</p>
                <p className="text-base text-blue-200/60">{t("home.noActiveRoomsDesc")}</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(96,165,250,0.2) transparent" }}>
                {cachedMyRooms.map((room) => {
                  const activeMembers = (roomMembersData[room.code] || []).filter((m: any) => m.isActive);
                  const isRoomFull = activeMembers.length >= 2;
                  const otherMember = activeMembers.find((m: any) => m.userId !== user?.id);
                  const otherMemberName = otherMember?.user?.firstName
                    ? `${otherMember.user.firstName}${otherMember.user.lastName ? ` ${otherMember.user.lastName}` : ""}`
                    : otherMember?.username || null;
                  const presence = otherMember?.userId ? memberPresence[otherMember.userId] : null;

                  const isNewCode = room.createdAt
                    ? (Date.now() - new Date(room.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000
                    : false;

                  return (
                    <div
                      key={room.id}
                      className="px-3 py-2 hover:bg-white/3 transition-colors"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", ...(roomsFrost && isRoomFull ? { opacity: 0, filter: "blur(8px)", pointerEvents: "none", userSelect: "none", transition: "opacity 0.35s, filter 0.35s" } : roomsFrost && !isNewCode ? { opacity: 0.22, filter: "blur(2.5px)", pointerEvents: "none", userSelect: "none", transition: "opacity 0.35s, filter 0.35s" } : { transition: "opacity 0.35s, filter 0.35s" }) }}
                      data-testid={`room-${room.code}`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { if (confirm("Delete this code? This cannot be undone.")) deleteRoomMutation.mutate(room.id); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-500/25 hover:bg-red-500/15 transition-colors flex-shrink-0"
                          data-testid={`button-delete-${room.code}`}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-[#ff0000]" />
                        </button>
                        <div className="relative flex flex-col items-start">
                          {isNewCode && (
                            <span
                              className="text-[8px] font-bold tracking-widest uppercase leading-none mb-0.5"
                              style={{ color: "#4ade80" }}
                              data-testid={`badge-new-${room.code}`}
                            >
                              NEW
                            </span>
                          )}
                          <span className="font-mono text-sm font-bold tracking-normal text-white whitespace-nowrap" data-testid={`room-code-${room.code}`}>
                            {room.code}
                          </span>
                        </div>
                        {isRoomFull && otherMemberName ? (
                          <button
                            onClick={() => setExpandedRoomActions(prev => ({ ...prev, [room.code]: !prev[room.code] }))}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                            data-testid={`badge-connected-${room.code}`}
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${presence === "in-call" ? "bg-amber-500 animate-pulse" : presence === "online" ? "bg-green-500" : "bg-gray-500"}`} />
                            <span className="text-xs text-emerald-300 font-medium">Connected</span>
                            <ChevronDown className={`w-3 h-3 text-emerald-300/70 transition-transform ${expandedRoomActions[room.code] ? "rotate-180" : ""}`} />
                          </button>
                        ) : (
                          <span className="text-sm text-blue-300/40">Share to connect</span>
                        )}
                        <div className="flex items-center gap-0.5 ml-auto">
                          <button onClick={() => copyCode(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-copy-${room.code}`} title="Copy">
                            {copiedCode === room.code ? <Check className="w-4 h-4 text-blue-400" /> : <Copy className="w-4 h-4 text-white/80" />}
                          </button>
                          <button onClick={() => setQrRoomCode(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-qr-${room.code}`} title="QR Code">
                            <QrCode className="w-4 h-4 text-white/80" />
                          </button>
                          <button onClick={() => shareRoom(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-share-${room.code}`} title="Share">
                            <Share2 className="w-4 h-4 text-white/80" />
                          </button>
                        </div>
                      </div>

                      {isRoomFull && expandedRoomActions[room.code] && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => setLocation(`/chat-rooms/${room.code}`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-text-${room.code}`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Text
                          </button>
                          <button
                            onClick={() => setLocation(`/room/${room.code}/call`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-call-${room.code}`}
                          >
                            <PhoneIcon className="w-3.5 h-3.5" />
                            Call
                          </button>
                          <button
                            onClick={() => setLocation(`/room/${room.code}/call`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-video-${room.code}`}
                          >
                            <Video className="w-3.5 h-3.5" />
                            Video
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {cachedJoinedRooms.map((room) => {
                  const presence = room.hostId ? memberPresence[room.hostId] : null;

                  return (
                    <div
                      key={`joined-${room.id}`}
                      className="px-3 py-2 hover:bg-white/3 transition-colors"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", ...(roomsFrost ? { opacity: 0.22, filter: "blur(2.5px)", pointerEvents: "none", userSelect: "none", transition: "opacity 0.35s, filter 0.35s" } : { transition: "opacity 0.35s, filter 0.35s" }) }}
                      data-testid={`joined-room-${room.code}`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { if (confirm("Leave this room?")) leaveRoomMutation.mutate(room.code); }}
                          disabled={leaveRoomMutation.isPending}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-500/25 hover:bg-red-500/15 transition-colors flex-shrink-0"
                          data-testid={`button-leave-${room.code}`}
                          title="Leave"
                        >
                          <LogOut className="w-4 h-4 text-[#ff0000]" />
                        </button>
                        <span className="font-mono text-sm font-bold tracking-normal text-white whitespace-nowrap" data-testid={`joined-room-code-${room.code}`}>
                          {room.code}
                        </span>
                        {room.hostName ? (
                          <button
                            onClick={() => setExpandedRoomActions(prev => ({ ...prev, [`j-${room.code}`]: !prev[`j-${room.code}`] }))}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                            data-testid={`badge-host-${room.code}`}
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${presence === "in-call" ? "bg-amber-500 animate-pulse" : presence === "online" ? "bg-green-500" : "bg-gray-500"}`} />
                            <span className="text-xs text-emerald-300 font-medium">Connected</span>
                            <ChevronDown className={`w-3 h-3 text-emerald-300/70 transition-transform ${expandedRoomActions[`j-${room.code}`] ? "rotate-180" : ""}`} />
                          </button>
                        ) : (
                          <span className="text-sm text-blue-300/40">Joined</span>
                        )}
                        <div className="flex items-center gap-0.5 ml-auto">
                          <button onClick={() => copyCode(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-copy-joined-${room.code}`} title="Copy">
                            {copiedCode === room.code ? <Check className="w-4 h-4 text-blue-400" /> : <Copy className="w-4 h-4 text-white/80" />}
                          </button>
                          <button onClick={() => setQrRoomCode(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-qr-joined-${room.code}`} title="QR Code">
                            <QrCode className="w-4 h-4 text-white/80" />
                          </button>
                          <button onClick={() => shareRoom(room.code)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-blue-500/15 transition-colors" style={{ background: "rgba(28,52,108,0.88)", border: "1px solid rgba(59,130,246,0.22)" }} data-testid={`button-share-joined-${room.code}`} title="Share">
                            <Share2 className="w-4 h-4 text-white/80" />
                          </button>
                        </div>
                      </div>

                      {room.hostName && expandedRoomActions[`j-${room.code}`] && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => setLocation(`/chat-rooms/${room.code}`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-text-joined-${room.code}`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Text
                          </button>
                          <button
                            onClick={() => setLocation(`/room/${room.code}/call`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-call-joined-${room.code}`}
                          >
                            <PhoneIcon className="w-3.5 h-3.5" />
                            Call
                          </button>
                          <button
                            onClick={() => setLocation(`/room/${room.code}/call`)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 transition-colors text-blue-200 text-sm font-medium"
                            data-testid={`action-video-joined-${room.code}`}
                          >
                            <Video className="w-3.5 h-3.5" />
                            Video
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        </SectionBoundary>

        {/* Juno Tools */}
        <MediaCarousel />

        <QuickActions />

      </main>



      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropImageSrc(null)}
        />
      )}

      {qrRoomCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setQrRoomCode(null)}
          data-testid="qr-overlay"
        >
          <Card
            className="relative w-[300px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2"
              onClick={() => setQrRoomCode(null)}
              data-testid="button-close-qr"
            >
              <X className="w-4 h-4" />
            </Button>
            <CardContent className="flex flex-col items-center gap-4 pt-8 pb-6">
              <p className="text-base font-medium text-muted-foreground">{t("home.shareRoom")}</p>
              <div className="bg-white p-3 rounded-md">
                <QRCodeSVG
                  value={`${window.location.origin}/join/${qrRoomCode}`}
                  size={200}
                  level="H"
                  data-testid="qr-code-image"
                />
              </div>
              {/* Hidden canvas used to export QR as PNG for image sharing (e.g. Instagram) */}
              <div style={{ position: "absolute", opacity: 0, pointerEvents: "none", left: -9999 }}>
                <QRCodeCanvas
                  ref={qrCanvasRef}
                  value={`${window.location.origin}/join/${qrRoomCode}`}
                  size={400}
                  level="H"
                  marginSize={2}
                />
              </div>
              <p className="font-mono text-lg font-bold tracking-widest text-primary" data-testid="qr-room-code">{qrRoomCode}</p>
              <p className="text-sm text-center text-muted-foreground">
                {t("room.scanToJoin") || "Scan to join this room"}
              </p>
              <Button
                className="w-full flex items-center gap-2"
                onClick={() => shareQrCode(qrRoomCode)}
                data-testid="button-share-qr"
              >
                <Share2 className="w-4 h-4" />
                Share QR Code
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <JunoVision
        isOpen={showJunoVision}
        onClose={() => setShowJunoVision(false)}
        sourceLang="en"
        targetLang="es"
      />

    </div>
  );
}
