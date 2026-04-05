import { useState, useEffect, useRef, useCallback } from "react";
import { buildAudioProcessor } from "@/lib/audio-processor";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useWakeLock } from "@/hooks/use-wake-lock";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Send,
  Video,
  ImageIcon,
  Camera,
  Loader2,
  MessageSquare,
  WifiOff,
  Languages,
  X,
  Heart,
  Reply,
  Share2,
  Copy,
  EyeOff,
  Eye,
  Mic,
  Trash2,
  Download,
  Play,
  Pause,
  CheckCheck,
  RefreshCw,
  Pencil,
  Check,
  ShieldCheck,
  Plus,
  Phone,
  MapPin,
  Navigation,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeInitials } from "@/lib/utils";
import { enqueue, drainQueue, type VoiceMessagePayload } from "@/lib/offline-queue";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWebSocket } from "@/hooks/use-websocket";
import { useSocketChat } from "@/hooks/use-socket-chat";
import ConnectionStatus from "@/components/ConnectionStatus";
import type { Room, RoomMember } from "@shared/schema";
import type { User } from "@shared/models/auth";
import CameraModal, { type VideoCaptionSegment } from "@/components/CameraModal";
import LocationShareSheet, { type LocationPayload } from "@/components/LocationShareSheet";
import VoiceBubble from "@/components/VoiceBubble";
import { CDN_ASSETS } from "@/lib/cdn";
const logoImg = CDN_ASSETS.logo;
import { useI18n } from "@/lib/i18n.jsx";
import { generateKeyPair, importPublicKey, deriveSharedKey, encryptMessage, decryptMessage, type E2EEKeyPair } from "@/lib/e2ee";
function EmojiPickerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22c-5 0-9-3.6-9-8s4-8 9-8 9 3.6 9 8c0 1.6-.5 3-1.4 4.2L22 22l-4.6-1.4c-1.6.9-3.4 1.4-5.4 1.4z" />
      <circle cx="9.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 17.5s1.2 1.5 3 1.5 3-1.5 3-1.5" />
      <path d="M8 4.5L8 3.5M8 2.5L8 1.5M6.5 3L7.5 3M8.5 3L9.5 3" strokeWidth="1.2" />
      <path d="M12 3L12 2M12 1L12 0M10.5 1.5L11.5 1.5M12.5 1.5L13.5 1.5" strokeWidth="1.4" />
      <path d="M16 4.5L16 3.5M16 2.5L16 1.5M14.5 3L15.5 3M16.5 3L17.5 3" strokeWidth="1.2" />
    </svg>
  );
}

import { LANGUAGES } from "@/lib/languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u20e3\s0-9#*]+$/u;
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!EMOJI_ONLY_RE.test(trimmed)) return false;
  return /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(trimmed);
}

const MEDIA_MARKERS = new Set(["[Image]", "[Video]", "[Emoji]", "[GIF]", "[Voice]", "[Sticker]"]);
function isTranslatableText(text: string | null | undefined): boolean {
  if (!text) return false;
  if (MEDIA_MARKERS.has(text)) return false;
  if (text.startsWith("[Location:") || text.startsWith("[LiveLocation:")) return false;
  if (isEmojiOnly(text)) return false;
  return true;
}

function parseLocationMsg(text: string) {
  try {
    const isLive = text.startsWith("[LiveLocation:");
    const inner = text.replace(/^\[(Live)?Location:/, "").replace(/\]$/, "");
    const data = JSON.parse(inner) as { lat: number; lng: number; name: string; expiresAt?: number };
    return { ...data, isLive };
  } catch {
    return null;
  }
}

function formatLocationTimeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  if (mins > 0) return `${mins}m remaining`;
  return "Expiring soon";
}

const TRANSLATION_CACHE_KEY = STORAGE_KEYS.translationCache;
const TRANSLATION_CACHE_MAX = 300;

let translationCacheMemory: Record<string, string> | null = null;
let translationCacheDirty = false;

function getTranslationCache(): Record<string, string> {
  if (translationCacheMemory) return translationCacheMemory;
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
    translationCacheMemory = raw ? JSON.parse(raw) : {};
  } catch { translationCacheMemory = {}; }
  return translationCacheMemory!;
}

function flushTranslationCache() {
  if (!translationCacheDirty || !translationCacheMemory) return;
  try {
    const keys = Object.keys(translationCacheMemory);
    if (keys.length > TRANSLATION_CACHE_MAX) {
      const trimmed: Record<string, string> = {};
      const keep = keys.slice(-TRANSLATION_CACHE_MAX);
      keep.forEach(k => { trimmed[k] = translationCacheMemory![k]; });
      translationCacheMemory = trimmed;
    }
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(translationCacheMemory));
    translationCacheDirty = false;
  } catch {}
}

if (typeof window !== "undefined") {
  setInterval(flushTranslationCache, 10000);
  window.addEventListener("beforeunload", flushTranslationCache);
}

function cacheKey(text: string, lang: string): string {
  return `${lang}:${text.slice(0, 200)}`;
}

function getCachedTranslation(text: string, lang: string): string | null {
  const cache = getTranslationCache();
  return cache[cacheKey(text, lang)] || null;
}

function saveCachedTranslation(text: string, lang: string, translated: string) {
  const cache = getTranslationCache();
  cache[cacheKey(text, lang)] = translated;
  translationCacheDirty = true;
}

const ANIMATED_EMOJIS: Record<string, string[]> = {
  smileys: [
    "1f600","1f604","1f601","1f606","1f605","1f602","1f923","1f642","1f643",
    "1f609","1f60a","1f607","1f970","1f60d","1f929","1f618","1f617","1f61a",
    "1f60b","1f61b","1f61c","1f92a","1f911","1f917","1f92d","1f92b","1f914",
    "1f910","1f928","1f610","1f636","1f60f","1f612","1f644","1f62c","1f925",
    "1f60c","1f614","1f62a","1f924","1f634","1f637","1f912","1f915","1f922","1f92e",
    "1f927","1f975","1f976","1f974","1f635","1f92f","1f920","1f973","1f978","1f979",
    "1f972","1fae0","1fae1","1fae2","1fae3","1fae4","1fae5","1fae6","1fae7","1fae8",
    "1fae9","1f636_200d_1f32b_fe0f","1f60e","1f913","1f9d0","1f615","1f61f","1f641",
    "1f62e","1f62f","1f632","1f633","1f97a","1f626","1f627","1f628","1f630","1f625",
    "1f622","1f62d","1f631","1f616","1f623","1f61e","1f613","1f629","1f62b","1f971",
    "1f624","1f621","1f620","1f92c","1f608","1f47f",
  ],
  gestures: [
    "1f44d","1f44e","1f44a","270a","1f91b","1f91c","1f44f","1f64c","1f450","1f932",
    "1f91d","1f64f","270d_fe0f","1f485","1f91e","1f91f","1f918","1f919","1f448",
    "1f449","1f446","1f447","261d_fe0f","270b","1f91a","1f590_fe0f","1f596","1f44b",
    "1f44c","1f90f","270c_fe0f","1f90c","1f4aa","1f9b5","1f9b6","1f9be","1f9bf",
    "1faf0","1faf1","1faf2","1faf3","1faf4","1faf5","1faf6","1faf7","1faf8",
  ],
  people: [
    "1f480","1f4a9","1f921","1f47b","1f47d","1f47e","1f916","1f483","1f57a",
    "1f440","1f441_fe0f","1f463","1fac0","1f934","1f478","1f9d9","1f9da",
    "1f9db","1f9dc","1f9dd","1f9de","1f9df","1f385","1f936","1f9b8","1f9b9",
    "1f977","1f470","1f935","1f930","1f931","1f47c","1f9d1_200d_1f384",
    "1f468_200d_1f680","1f469_200d_1f680","1f468_200d_1f373","1f469_200d_1f373",
    "1f468_200d_1f3a8","1f469_200d_1f3a8","1f468_200d_1f52c","1f469_200d_1f52c",
    "1f468_200d_1f4bb","1f469_200d_1f4bb","1f9d1_200d_1f3eb","1f9d1_200d_2695_fe0f",
  ],
  animals: [
    "1f431","1f984","1f42e","1f438","1f648","1f649","1f64a","1f412","1f426","1f985",
    "1f989","1f987","1f40a","1f422","1f40d","1f409","1f995","1f996","1f433","1f42c",
    "1f41f","1f421","1f419","1f40c","1f98b","1f41b","1f41c","1f41d","1f41e","1f9a6",
    "1f9a7","1f9ad","1f99e","1f99f","1f9a0","1f998","1f99a","1f40e","1f416","1f410",
    "1f577_fe0f","1f982","1f980","1fab0","1fab1","1fab3","1fabf","1f405","1f415",
    "1f429","1f413","1f54a_fe0f","1f98d","1f436","1f43b","1f43c","1f428","1f42f",
    "1f981","1f434","1f437","1f430","1f427","1f99c","1f9a9","1f9a2","1f994",
    "1f992","1f993","1f9a5","1f9a8","1f99d","1f9ab","1fab6","1fab7","1fab8",
  ],
  food: [
    "1f345","1f32f","1f37f","1f382","1f35c","1f35d","2615","1f37e","1f377","1f379",
    "1f37b","1f942","1f339","1f331","1f340","1f342","1f343","1f490","1f48e",
    "1f34e","1f34f","1f34a","1f34b","1f34c","1f347","1f353","1fad0","1f348","1f349",
    "1f351","1f352","1f350","1f96d","1f34d","1f965","1f951","1f346","1f955",
    "1f33d","1f336_fe0f","1f952","1f966","1f9c5","1f9c6","1f344","1f95c",
    "1f950","1f35e","1f956","1f968","1f96f","1f9c0","1f356","1f357","1f969",
    "1f354","1f355","1f32d","1f32e","1f9c6","1f959","1f9aa","1f35b","1f363",
    "1f371","1f358","1f365","1f96e","1f370","1f9c1","1f366","1f367","1f368",
    "1f369","1f36a","1f36b","1f36c","1f36d","1f36e","1f36f","1f9cb","1f964",
  ],
  activity: [
    "26bd","26be","1f3b1","1f3d3","1f3f8","1f3d2","1f3d1","1f94d","1f3af","26f3",
    "1f94b","1f3a3","1f3b7","1f3ba","1f941","1f3b2","1f3b0","1f3b3","1f6f9",
    "1f6fc","1fa81","1f3c6","1f947","1f948","1f949","1f3c0","1f3c8","1f3be",
    "1f94e","1f94f","1f3d0","1f3c9","1f3b3","1f3cf","1f3d1","1f3d2","1f94a",
    "1f94c","26f8_fe0f","1f3a4","1f3b8","1f3b9","1f3bb","1f3ac","1f3a8",
    "1f3ad","1f3aa","1fa70","1fa79","1fa71","1fa72","1fa73","1f9e9",
  ],
  objects: [
    "1f50b","1f4a1","270f_fe0f","1f680","1f6f8","1f6eb","1f6ec","1f697","1f6a8",
    "1f695","2699_fe0f","1f4a3","1f512","1f525","1f4a5","1f4ab","2728","1f31f",
    "1f4a7","1f30a","1f30d","1f30e","1f30f","1f31e","1f31b","1f31c","1f308",
    "1f327_fe0f","1f329_fe0f","1f32a_fe0f","2744_fe0f","2603_fe0f","26c4","1f32c_fe0f",
    "1f4f1","1f4bb","1f5a5_fe0f","1f4f7","1f4f8","1f4fd_fe0f","1f4fa","1f4e6",
    "1f381","1f388","1f389","1f38a","1f38e","1f3ee","1f9e7","1f4b0","1f4b3",
    "1f4b5","1f4b8","1f48d","1f451","1f452","1f393","1f3a9","1f9e2","26d1_fe0f",
  ],
  symbols: [
    "2764_fe0f","1f9e1","1f49b","1f49a","1f499","1f49c","1f5a4","1f90e","1f90d",
    "1f498","1f49d","1f496","1f497","1f493","1f49e","1f495","1f49f","2763_fe0f",
    "1f48b","1f4af","2705","274c","2753","2757","1f514","1f3b6",
    "2764_fe0f_200d_1f525","2764_fe0f_200d_1fa79","1f90d","1fa76","1fa77","1fa78",
    "262e_fe0f","271d_fe0f","262a_fe0f","2638_fe0f","2721_fe0f","1f549_fe0f",
    "267e_fe0f","269b_fe0f","2622_fe0f","2623_fe0f","1f4f4","1f4f3",
    "1f6ab","26a0_fe0f","267b_fe0f","2747_fe0f","1f534","1f7e0","1f7e1",
    "1f7e2","1f535","1f7e3","1f7e4","26ab","26aa","1f7e5","1f7e7","1f7e8",
    "1f7e9","1f7e6","1f7ea","1f7eb",
  ],
  flags: [
    "1f1fa_1f1f8","1f1ec_1f1e7","1f1e8_1f1e6","1f1e6_1f1fa","1f1eb_1f1f7",
    "1f1e9_1f1ea","1f1ea_1f1f8","1f1ee_1f1f9","1f1ef_1f1f5","1f1f0_1f1f7",
    "1f1e7_1f1f7","1f1f2_1f1fd","1f1ee_1f1f3","1f1e8_1f1f3","1f1f7_1f1fa",
    "1f1ff_1f1e6","1f1f3_1f1ec","1f1ea_1f1ec","1f1f0_1f1ea","1f1ec_1f1ed",
    "1f1e8_1f1f4","1f1e6_1f1f7","1f1e8_1f1f1","1f1f5_1f1ea","1f1fb_1f1ea",
    "1f1f5_1f1ed","1f1f9_1f1ed","1f1fb_1f1f3","1f1ee_1f1e9","1f1f2_1f1fe",
    "1f1f5_1f1f0","1f1e7_1f1e9","1f1f9_1f1f7","1f1f5_1f1f1","1f1fa_1f1e6",
    "1f1f8_1f1e6","1f1e6_1f1ea","1f1f6_1f1e6","1f3f3_fe0f","1f3f4","1f3c1",
    "1f3f3_fe0f_200d_1f308",
  ],
};

type CaptionSegment = {
  start: number;
  end: number;
  text: string;
};

interface ChatMessage {
  id: string;
  roomCode: string;
  fromId: string;
  fromName: string;
  text: string;
  translatedText?: string;
  oversightCorrected?: boolean;
  isTranslating?: boolean;
  translationFailed?: boolean;
  imageData?: string;
  videoData?: string;
  audioData?: string;
  mediaType?: "image" | "video" | "audio";
  transcription?: string;
  transcriptionTranslated?: string;
  isTranscriptionTranslating?: boolean;
  transcriptionFeedback?: "useful" | "not_useful";
  timestamp: number;
  vanish?: boolean;
  reactions?: Record<string, string[]>;
  replyTo?: { id: string; fromName: string; text: string; imageData?: string; videoData?: string };
  liveCaptions?: VideoCaptionSegment[];
  isBurningCaptions?: boolean;
  hasBurnedCaptions?: boolean;
  status?: "sent" | "delivered" | "seen" | "queued";
  edited?: boolean;
  editedAt?: number;
  e2ee?: boolean;
}

const EMOJI_MAP: Record<string, string> = { heart: "❤️", thumbsup: "👍", thumbsdown: "👎", laugh: "😂", fire: "🔥", cry: "😢", surprised: "😮", pray: "🙏", clap: "👏", party: "🎉", confetti: "🥳", hundred: "💯", hearteyes: "😍", thinking: "🤔", skull: "💀", eyes: "👀", muscle: "💪", kiss: "😘", angry: "😡", wave: "👋", cool: "😎", heartbroken: "💔", rocket: "🚀", exclamation: "‼️", question: "❓", poop: "💩", ghost: "👻", alien: "👽", robot: "🤖", unicorn: "🦄", rainbow: "🌈", star: "⭐", sparkles: "✨", lightning: "⚡", snowflake: "❄️", sun: "☀️", moon: "🌙", crown: "👑", diamond: "💎", gift: "🎁", trophy: "🏆", medal: "🥇", ok: "👌", peace: "✌️", fist: "✊", handshake: "🤝", salute: "🫡", shush: "🤫", mindblown: "🤯", nerd: "🤓", wink: "😉", hug: "🤗", sick: "🤢", devil: "😈", angel: "😇", money: "🤑", sleepy: "😴", dizzy: "😵", sweat: "😅", smirk: "😏", innocent: "🙈", balloon: "🎈", cherry: "🍒", pizza: "🍕", coffee: "☕", butterfly: "🦋", earth: "🌍", heartpink: "💗", megaphone: "📣", dog: "🐶", cat: "🐱", bear: "🐻", fox: "🦊", lion: "🦁", penguin: "🐧", chicken: "🐔", whale: "🐳", dolphin: "🐬", turtle: "🐢", snake: "🐍", ladybug: "🐞", bee: "🐝", crab: "🦀", octopus: "🐙", tropical: "🐠", palm: "🌴", cactus: "🌵", sunflower: "🌻", tulip: "🌷", rose: "🌹", maple: "🍁", mushroom: "🍄", grapes: "🍇", watermelon: "🍉", lemon: "🍋", banana: "🍌", avocado: "🥑", taco: "🌮", icecream: "🍦", donut: "🍩", cake: "🎂", chocolate: "🍫", popcorn: "🍿", soccerball: "⚽", basketball: "🏀", football: "🏈", baseball: "⚾", tennis: "🎾", guitar: "🎸", microphone: "🎤", headphones: "🎧", paintbrush: "🎨", camera: "📷", movie: "🎬", lightbulb: "💡", lock: "🔒", key: "🔑", magnify: "🔍", bell: "🔔", pin: "📌", paperclip: "📎", scissors: "✂️", hammer: "🔨", checkmark: "✅", crossmark: "❌", warning: "⚠️", infinity: "♾️", peace2: "☮️", yin: "☯️", hourglass: "⏳", umbrella: "☂️" };

const EMOJI_LIST: { key: string; label: string }[] = Object.entries(EMOJI_MAP).map(([key, label]) => ({ key, label }));

const QUICK_EMOJIS = EMOJI_LIST.slice(0, 8);

export default function RoomChat() {
  const [, params] = useRoute("/chat-rooms/:code");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const { justReconnected } = useNetworkStatus();
  const roomCode = params?.code || "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [activeUserIds, setActiveUserIds] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [chatLanguage, setChatLanguage] = useState(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.subtitleLang);
      return cached || "en";
    } catch { return "en"; }
  });
  const [detectedTypingLang, setDetectedTypingLang] = useState<string | null>(null);
  const detectLangTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealedMedia, setRevealedMedia] = useState<Set<string>>(new Set());
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [viewerVideo, setViewerVideo] = useState<string | null>(null);
  const [viewerVideoMsgId, setViewerVideoMsgId] = useState<string | null>(null);
  const [videoCaptions, setVideoCaptions] = useState<CaptionSegment[]>([]);
  const [videoCaptionStatus, setVideoCaptionStatus] = useState<"idle" | "extracting" | "transcribing" | "translating" | "done" | "no-speech" | "error">("idle");
  const [activeCaption, setActiveCaption] = useState<string>("");
  const [viewerPlaying, setViewerPlaying] = useState(false);
  const [viewerProgress, setViewerProgress] = useState(0);
  const [viewerDuration, setViewerDuration] = useState(0);
  const [viewerHasBurnedCaptions, setViewerHasBurnedCaptions] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLocationSheet, setShowLocationSheet] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("smileys");
  const [pickerTab, setPickerTab] = useState<"stickers" | "gifs">("stickers");
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<Array<{ id: string; title: string; preview: string; url: string; width: number; height: number }>>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const [showDisconnected, setShowDisconnected] = useState(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingSentRef = useRef(0);
  const gifSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showingOriginal, setShowingOriginal] = useState<Set<string>>(new Set());
  const [verifiedMessages, setVerifiedMessages] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.roomVerified(roomCode));
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [verifyingMessages, setVerifyingMessages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (verifiedMessages.size > 0) {
      try {
        const arr = [...verifiedMessages];
        const capped = arr.length > 200 ? arr.slice(-200) : arr;
        localStorage.setItem(STORAGE_KEYS.roomVerified(roomCode), JSON.stringify(capped));
      } catch {}
    }
  }, [verifiedMessages, roomCode]);

  useEffect(() => {
    if (!justReconnected || !roomCode || !user) return;
    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    drainQueue({
      onVoiceMessage: async (payload) => {
        if (payload.roomCode !== roomCode) return false;
        try {
          const res = await fetch(`/api/room-messages/${payload.roomCode}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              text: "[Voice]",
              fromName: payload.fromName || fromName,
              audioData: payload.audioData,
              ...(payload.transcription ? { transcription: payload.transcription } : {}),
              ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
              ...(payload.vanish ? { vanish: payload.vanish } : {}),
            }),
          });
          if (res.ok) {
            setMessages(prev =>
              prev.map(m => m.status === "queued" ? { ...m, status: "sent" as const } : m),
            );
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
      onWhisperChunk: async () => false,
    });
  }, [justReconnected, roomCode, user]);

  const [actionMenuMsg, setActionMenuMsg] = useState<ChatMessage | null>(null);
  const [showExpandedReactions, setShowExpandedReactions] = useState(false);
  const [actionMenuPos, setActionMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [vanishMode, setVanishMode] = useState(false);
  const [showVanishHint, setShowVanishHint] = useState(false);
  const vanishHintShown = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const MAX_VOICE_RECORDING_SECONDS = 120;
  const [isRecording, setIsRecording] = useState(false);
  useWakeLock(isRecording);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioProcDisposeRef = useRef<(() => void) | null>(null);
  const micHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micCancelledRef = useRef(false);
  const micReleasedDuringStartRef = useRef(false);
  const voiceRecognitionRef = useRef<any>(null);
  const voiceTranscriptRef = useRef("");

  const [incomingCall, setIncomingCall] = useState<{ callerId: string; callerName: string } | null>(null);
  const incomingCallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const e2eeKeyPairRef = useRef<E2EEKeyPair | null>(null);
  const e2eeSharedKeyRef = useRef<CryptoKey | null>(null);
  const [e2eeActive, setE2eeActive] = useState(false);
  const e2eePeerIdRef = useRef<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const chatLanguageRef = useRef((() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "en";
    } catch { return "en"; }
  })());
  const captionRequestIdRef = useRef<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { data: userPrefs } = useQuery<{ subtitleLanguage?: string }>({
    queryKey: ["/api/preferences"],
    enabled: !!user,
  });

  const { data: roomMembersData = {} } = useQuery<Record<string, (RoomMember & { user?: User })[]>>({
    queryKey: ["/api/my-room-members"],
    enabled: !!user,
    refetchInterval: 120000,
  });

  const members = roomMembersData[roomCode] || [];

  const { data: partnerLangData } = useQuery<{ partnerLang: string | null; partnerName: string | null }>({
    queryKey: ["/api/room-partner-lang", roomCode],
    enabled: !!user && !!roomCode,
    refetchInterval: 300000,
  });
  const partnerLang = partnerLangData?.partnerLang || null;
  const partnerLangRef = useRef<string | null>(null);
  const prevPartnerLangRef = useRef<string | null>(null);
  useEffect(() => { partnerLangRef.current = partnerLang; }, [partnerLang]);

  useEffect(() => {
    if (partnerLangData?.partnerName && !vanishHintShown.current) {
      vanishHintShown.current = true;
      setShowVanishHint(true);
      setTimeout(() => setShowVanishHint(false), 4000);
    }
  }, [partnerLangData?.partnerName]);

  const translateTextRef = useRef<(text: string, targetLang: string, sourceLang?: string, source?: string) => Promise<{ text: string; oversightCorrected?: boolean; autoVerified?: boolean }>>(async (t) => ({ text: t }));
  const manualTranslateRef = useRef<Set<string>>(new Set());
  const pendingTranslationTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleWsMessage = useCallback((message: any) => {
    if (message.type === "e2ee-public-key") {
      console.log("[E2EE] Received public key from", message.userId, "for room", message.roomCode, "myRoom:", roomCode);
      if (message.roomCode === roomCode && message.userId && message.publicKeyJwk && message.userId !== user?.id) {
        const alreadyExchanged = e2eePeerIdRef.current === message.userId && e2eeSharedKeyRef.current;
        console.log("[E2EE] Processing key, alreadyExchanged:", !!alreadyExchanged);
        (async () => {
          try {
            if (!e2eeKeyPairRef.current) {
              e2eeKeyPairRef.current = await generateKeyPair();
              console.log("[E2EE] Generated local key pair");
            }
            const peerPub = await importPublicKey(message.publicKeyJwk);
            const shared = await deriveSharedKey(e2eeKeyPairRef.current.privateKey, peerPub);
            e2eeSharedKeyRef.current = shared;
            e2eePeerIdRef.current = message.userId;
            setE2eeActive(true);
            console.log("[E2EE] Shared key derived, E2EE active!");
            if (!alreadyExchanged) {
              const ws = getWsRef.current?.();
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "e2ee-public-key",
                  roomCode,
                  publicKeyJwk: e2eeKeyPairRef.current.publicKeyJwk,
                }));
                console.log("[E2EE] Sent our public key back");
              }
            }
          } catch (err) {
            console.error("[E2EE] Key exchange error:", err);
          }
        })();
      }
      return;
    }
    if (message.type === "chat-presence") {
      if (message.roomCode === roomCode) {
        setActiveUserIds(message.activeUserIds || []);
        const otherUsers = (message.activeUserIds || []).filter((id: string) => id !== user?.id);
        if (otherUsers.length > 0 && !e2eeSharedKeyRef.current && e2eeKeyPairRef.current) {
          const ws = getWsRef.current?.();
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "e2ee-public-key",
              roomCode,
              publicKeyJwk: e2eeKeyPairRef.current.publicKeyJwk,
            }));
            console.log("[E2EE] Sent key on presence update, other users:", otherUsers.length);
          }
        }
      }
    } else if (message.type === "home-chat-typing") {
      if (message.roomCode === roomCode && message.userId !== user?.id) {
        setTypingUsers(prev => {
          const next = new Map(prev);
          if (message.isTyping) {
            const existing = next.get(message.userId);
            if (existing) clearTimeout(existing.timer);
            const timer = setTimeout(() => {
              setTypingUsers(p => {
                const n = new Map(p);
                n.delete(message.userId);
                return n;
              });
            }, 30000);
            next.set(message.userId, { name: message.userName, timer });
          } else {
            const existing = next.get(message.userId);
            if (existing) clearTimeout(existing.timer);
            next.delete(message.userId);
          }
          return next;
        });
      }
    } else if (message.type === "home-chat-message" || message.type === "home-chat-message-sent") {
      const msg = message.message as ChatMessage;
      if (msg.roomCode !== roomCode) return;

      if (message.type === "home-chat-message-sent" && msg.fromId === user!.id) {
        setMessages(prev => {
          const hasOptimistic = prev.some(m => m.id.startsWith("local-") && m.fromId === msg.fromId && Math.abs(m.timestamp - msg.timestamp) < 5000);
          if (hasOptimistic) {
            return prev.map(m =>
              m.id.startsWith("local-") && m.fromId === msg.fromId && Math.abs(m.timestamp - msg.timestamp) < 5000
                ? { ...msg, translatedText: m.translatedText, isTranslating: m.isTranslating, status: m.status || "sent" }
                : m
            );
          }
          return [...prev, { ...msg, status: "sent" as const }];
        });
        // Translation is handled server-side by the translation agent. Do NOT translate on frontend.
      } else if (message.type === "home-chat-message") {
        if (msg.fromId === user?.id) return;
        if (msg.e2ee && e2eeSharedKeyRef.current) {
          (async () => {
            try {
              const plaintext = await decryptMessage(e2eeSharedKeyRef.current!, msg.text);
              const decryptedMsg = { ...msg, text: plaintext };
              const translatable = isTranslatableText(plaintext);
              const hasTranscription = plaintext === "[Voice]" && !!decryptedMsg.transcription;
              const e2eeLang = chatLanguageRef.current;
              const e2eeNeedsTranslation = translatable && e2eeLang && e2eeLang !== "en";
              setMessages(prev => [...prev, {
                ...decryptedMsg,
                ...(e2eeNeedsTranslation ? { isTranslating: true } : {}),
                ...(hasTranscription ? { isTranscriptionTranslating: true } : {}),
              }]);
              fetch(`/api/room-read/${roomCode}`, { method: "POST", credentials: "include" }).catch(() => {});
              chatSendRef.current({ type: "msg-delivered", roomCode, messageIds: [msg.id] });
              if (document.visibilityState === "visible") {
                chatSendRef.current({ type: "msg-seen", roomCode, messageIds: [msg.id] });
              }
              if (e2eeNeedsTranslation) {
                const lang = e2eeLang;
                const srcLang = partnerLangRef.current || undefined;
                const e2eeMsgId = msg.id;
                translateTextRef.current(plaintext, lang, srcLang).then(result => {
                  if (chatLanguageRef.current !== lang) return;
                  const translated = typeof result === "string" ? result : result.text;
                  setMessages(p => p.map(m => {
                    if (m.id !== e2eeMsgId || m.translatedText) return m;
                    if (translated && translated !== plaintext) {
                      return { ...m, translatedText: translated, isTranslating: false, translationFailed: false };
                    }
                    return { ...m, isTranslating: false };
                  }));
                }).catch(() => {
                  setMessages(p => p.map(m =>
                    m.id === e2eeMsgId && !m.translatedText ? { ...m, isTranslating: false, translationFailed: true } : m
                  ));
                });
              }
            } catch {
              setMessages(prev => [...prev, { ...msg, text: "[Encrypted message]" }]);
            }
          })();
          return;
        }
        const hasTranscription = msg.text === "[Voice]" && !!msg.transcription;
        const incomingLang = chatLanguageRef.current;
        const needsTranslation = isTranslatableText(msg.text) && incomingLang && incomingLang !== "en";
        setMessages(prev => [...prev, {
          ...msg,
          ...(needsTranslation ? { isTranslating: true } : {}),
          ...(hasTranscription ? { isTranscriptionTranslating: true } : {}),
        }]);
        fetch(`/api/room-read/${roomCode}`, { method: "POST", credentials: "include" }).catch(() => {});
        chatSendRef.current({ type: "msg-delivered", roomCode, messageIds: [msg.id] });
        if (document.visibilityState === "visible") {
          chatSendRef.current({ type: "msg-seen", roomCode, messageIds: [msg.id] });
        }
        setTypingUsers(prev => {
          if (prev.has(msg.fromId)) {
            const next = new Map(prev);
            const existing = next.get(msg.fromId);
            if (existing) clearTimeout(existing.timer);
            next.delete(msg.fromId);
            return next;
          }
          return prev;
        });

        if (needsTranslation) {
          const msgId = msg.id;
          const msgText = msg.text;
          const timerId = setTimeout(() => {
            pendingTranslationTimers.current.delete(msgId);
            setMessages(prev => {
              const target = prev.find(m => m.id === msgId);
              if (!target || target.translatedText || !target.isTranslating) return prev;
              const lang = chatLanguageRef.current;
              if (!lang || lang === "en") return prev;
              const srcLang = partnerLangRef.current || undefined;
              translateTextRef.current(msgText, lang, srcLang).then(result => {
                if (chatLanguageRef.current !== lang) return;
                const translated = typeof result === "string" ? result : result.text;
                setMessages(p => p.map(m => {
                  if (m.id !== msgId || m.translatedText) return m;
                  if (translated && translated !== msgText) {
                    return { ...m, translatedText: translated, isTranslating: false, translationFailed: false };
                  }
                  return { ...m, isTranslating: false };
                }));
              }).catch(() => {
                setMessages(p => p.map(m =>
                  m.id === msgId && !m.translatedText ? { ...m, isTranslating: false, translationFailed: true } : m
                ));
              });
              return prev;
            });
          }, 5000);
          pendingTranslationTimers.current.set(msgId, timerId);
        }
      }
    } else if (message.type === "home-chat-reaction-update") {
      if (message.roomCode === roomCode && message.messageId) {
        setMessages(prev => prev.map(m =>
          m.id === message.messageId ? { ...m, reactions: message.reactions || {} } : m
        ));
      }
    } else if (message.type === "home-chat-message-deleted") {
      if (message.roomCode === roomCode && message.messageId) {
        setMessages(prev => prev.filter(m => m.id !== message.messageId));
      }
    } else if (message.type === "message-translated") {
      if (message.roomCode === roomCode && message.messageId && message.translatedText) {
        setMessages(prev => prev.map(m =>
          m.id === message.messageId
            ? { ...m, translatedText: message.translatedText, isTranslating: false }
            : m
        ));
      }
    } else if (message.type === "home-chat-edited") {
      if (message.roomCode === roomCode && message.messageId && message.newText) {
        setMessages(prev => prev.map(m =>
          m.id === message.messageId
            ? { ...m, text: message.newText, edited: true, editedAt: message.editedAt || Date.now(), translatedText: undefined, oversightCorrected: undefined, isTranslating: false }
            : m
        ));
        setVerifiedMessages(prev => { const next = new Set(prev); next.delete(message.messageId); return next; });
      }
    } else if (message.type === "home-chat-verified") {
      if (message.roomCode === roomCode && message.messageId) {
        setVerifiedMessages(prev => { const next = new Set(prev); next.add(message.messageId); return next; });
      }
    } else if (message.type === "msg-status-update") {
      if (message.roomCode === roomCode && Array.isArray(message.messageIds)) {
        const newStatus = message.status as "delivered" | "seen";
        setMessages(prev => prev.map(m => {
          if (message.messageIds.includes(m.id) && m.fromId === user?.id) {
            if (newStatus === "seen" || (newStatus === "delivered" && m.status !== "seen")) {
              return { ...m, status: newStatus };
            }
          }
          return m;
        }));
      }
    } else if (message.type === "incoming-call") {
      if (message.roomCode === roomCode && message.callerId !== user?.id) {
        setIncomingCall({
          callerId: message.callerId,
          callerName: message.callerName || "Someone",
        });
        if (incomingCallTimerRef.current) clearTimeout(incomingCallTimerRef.current);
        incomingCallTimerRef.current = setTimeout(() => {
          setIncomingCall(null);
        }, 30000);
      }
    }
  }, [roomCode, user]);

  const handleWsOpen = useCallback(async (ws: WebSocket) => {
    console.log("[E2EE] WebSocket opened for E2EE key exchange, room", roomCode);
    try {
      if (!e2eeKeyPairRef.current) {
        e2eeKeyPairRef.current = await generateKeyPair();
        console.log("[E2EE] Generated key pair on open");
      }
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "e2ee-public-key",
            roomCode,
            publicKeyJwk: e2eeKeyPairRef.current!.publicKeyJwk,
          }));
          console.log("[E2EE] Sent public key to room", roomCode);
        }
      }, 500);
    } catch (err) {
      console.error("[E2EE] Key generation error on open:", err);
    }
  }, [roomCode]);

  const { status: connectionStatus, send: wsSend, getWs, quality: connectionQuality, rtt: connectionRtt } = useWebSocket({
    userId: user?.id || null,
    onMessage: handleWsMessage,
    onOpen: handleWsOpen,
    onReconnect: handleWsOpen,
    enabled: !!user && !!roomCode,
  });

  const getWsRef = useRef(getWs);
  useEffect(() => { getWsRef.current = getWs; }, [getWs]);

  const handleSocketChatEvent = useCallback((event: string, data: any) => {
    const eventTypeMap: Record<string, string> = {
      "new-message": "home-chat-message",
      "message-sent": "home-chat-message-sent",
      "typing": "home-chat-typing",
      "reaction-update": "home-chat-reaction-update",
      "message-edited": "home-chat-edited",
      "message-translated": "message-translated",
      "message-deleted": "home-chat-message-deleted",
      "verified": "home-chat-verified",
      "msg-status-update": "msg-status-update",
      "chat-presence": "chat-presence",
      "error-msg": "error",
    };
    const mappedType = eventTypeMap[event] || event;
    if (mappedType === "home-chat-message" || mappedType === "home-chat-message-sent") {
      handleWsMessage({ type: mappedType, message: data });
    } else {
      handleWsMessage({ type: mappedType, ...data });
    }
  }, [handleWsMessage]);

  const { status: socketChatStatus, emit: socketChatEmit, subscribe: socketChatSubscribe, unsubscribe: socketChatUnsubscribe, connected: socketChatConnected } = useSocketChat({
    userId: user?.id || null,
    enabled: !!user && !!roomCode,
    onMessage: handleSocketChatEvent,
  });

  const chatSendRef = useRef<(msg: any) => void>(() => {});

  const chatSend = useCallback((msg: any): boolean => {
    const typeMap: Record<string, string> = {
      "home-chat-send": "send-message",
      "home-chat-typing": "typing",
      "home-chat-react": "react",
      "home-chat-edit": "edit",
      "home-chat-delete": "delete",
      "home-chat-image": "send-image",
      "home-chat-video": "send-video",
      "home-chat-verified": "verified",
      "msg-delivered": "msg-delivered",
      "msg-seen": "msg-seen",
      "home-chat-subscribe": "subscribe",
      "home-chat-unsubscribe": "unsubscribe",
    };
    const { type, ...rest } = msg;
    const socketEvent = typeMap[type];
    if (socketEvent) {
      return socketChatEmit(socketEvent, rest);
    } else {
      wsSend(msg);
      return true;
    }
  }, [socketChatEmit, wsSend]);

  useEffect(() => { chatSendRef.current = chatSend; }, [chatSend]);

  useEffect(() => {
    if (socketChatConnected && roomCode) {
      socketChatSubscribe(roomCode);
    }
    return () => {
      if (roomCode) socketChatUnsubscribe(roomCode);
    };
  }, [socketChatConnected, roomCode, socketChatSubscribe, socketChatUnsubscribe]);

  useEffect(() => {
    if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    if (connectionStatus === "connected") {
      setShowDisconnected(false);
    } else {
      disconnectTimerRef.current = setTimeout(() => setShowDisconnected(true), 3000);
    }
    return () => { if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current); };
  }, [connectionStatus]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      setMessages(prev => {
        const unseenIds = prev
          .filter(m => m.fromId !== user?.id && m.status !== "seen")
          .map(m => m.id);
        if (unseenIds.length > 0) {
          chatSendRef.current({ type: "msg-seen", roomCode, messageIds: unseenIds });
        }
        return prev;
      });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [roomCode, user?.id]);

  const translateText = useCallback(async (text: string, targetLang: string, sourceLang?: string, source?: string): Promise<{ text: string; oversightCorrected?: boolean; autoVerified?: boolean }> => {
    if (sourceLang && sourceLang === targetLang) return { text };
    const cached = getCachedTranslation(text, targetLang);
    if (cached) return { text: cached };
    try {
      const response = await fetch("/api/v1/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, targetLang, sourceLang, roomCode, ...(source ? { source } : {}) }),
      });
      if (!response.ok) throw new Error("Translation request failed");
      const data = await response.json();
      if (data.skipped) {
        saveCachedTranslation(text, targetLang, text);
        return { text };
      }
      const result = data.translatedText || text;
      saveCachedTranslation(text, targetLang, result);
      return { text: result, oversightCorrected: data.oversightCorrected || false, autoVerified: data.autoVerified || false };
    } catch {
      throw new Error("Translation failed");
    }
  }, [roomCode]);

  const handleVerifyTranslation = useCallback(async (msg: ChatMessage) => {
    if (!msg.translatedText || msg.translatedText === msg.text || verifyingMessages.has(msg.id)) return;
    setVerifyingMessages(prev => { const next = new Set(prev); next.add(msg.id); return next; });
    try {
      const response = await fetch("/api/v1/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: msg.text, targetLang: userPrefs?.subtitleLanguage || "en", verify: true, roomCode }),
      });
      if (response.ok) {
        const data = await response.json();
        const correctedText = data.translatedText || msg.translatedText;
        if (correctedText !== msg.translatedText) {
          setMessages(prev => prev.map(m =>
            m.id === msg.id ? { ...m, translatedText: correctedText, oversightCorrected: true } : m
          ));
        }
      }
      setVerifiedMessages(prev => { const next = new Set(prev); next.add(msg.id); return next; });
      const ws = getWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        chatSend({ type: "home-chat-verified", roomCode, messageId: msg.id });
      }
    } catch {
      setVerifiedMessages(prev => { const next = new Set(prev); next.add(msg.id); return next; });
    } finally {
      setVerifyingMessages(prev => { const next = new Set(prev); next.delete(msg.id); return next; });
    }
  }, [roomCode, userPrefs?.subtitleLanguage, verifyingMessages, chatSend, getWs]);

  translateTextRef.current = translateText;

  const EDIT_WINDOW_MS = 15 * 60 * 1000;

  const canEditMessage = useCallback((msg: ChatMessage) => {
    if (msg.fromId !== user?.id) return false;
    if (msg.imageData || msg.videoData || msg.audioData) return false;
    if (MEDIA_MARKERS.has(msg.text || "")) return false;
    if (msg.text && isEmojiOnly(msg.text)) return false;
    return (Date.now() - msg.timestamp) < EDIT_WINDOW_MS;
  }, [user?.id]);

  const handleEditMessage = useCallback((msg: ChatMessage) => {
    if (!canEditMessage(msg)) return;
    setEditingMsg(msg);
    setMessageInput(msg.text);
    setActionMenuMsg(null);
  }, [canEditMessage]);

  const submitEditMessage = useCallback(() => {
    if (!editingMsg || !user) return;
    const newText = messageInput.trim();
    if (!newText || newText === editingMsg.text) {
      setEditingMsg(null);
      setMessageInput("");
      return;
    }
    setMessages(prev => prev.map(m =>
      m.id === editingMsg.id
        ? { ...m, text: newText, edited: true, editedAt: Date.now(), translatedText: undefined, oversightCorrected: undefined, isTranslating: false }
        : m
    ));
    setVerifiedMessages(prev => { const next = new Set(prev); next.delete(editingMsg.id); return next; });
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      chatSend({ type: "home-chat-edit", roomCode, messageId: editingMsg.id, newText });
    }
    setEditingMsg(null);
    setMessageInput("");
  }, [editingMsg, messageInput, user, roomCode, chatSend, getWs]);

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
    setMessages(prev => {
      const pLangSrc = partnerLangRef.current;
      const updated = prev.map(m => {
        if (m.fromId === user?.id) return m;
        const isText = isTranslatableText(m.text);
        if (isText && !m.translatedText) {
          const cached = getCachedTranslation(m.text!, lang);
          if (cached) {
            if (cached !== m.text) return { ...m, translatedText: cached, isTranslating: false };
            return { ...m, isTranslating: false };
          }
          return { ...m, isTranslating: true };
        }
        return m;
      });
      updated.forEach(msg => {
        if (msg.fromId === user?.id) return;
        if (msg.translatedText || !msg.isTranslating) return;
        if (isTranslatableText(msg.text)) {
          const srcLang = pLangSrc || undefined;
          translateText(msg.text, lang, srcLang).then(result => {
            if (chatLanguageRef.current !== lang) return;
            const translated = typeof result === "string" ? result : result.text;
            const oversightCorrected = typeof result === "object" ? result.oversightCorrected : false;
            const autoVerified = typeof result === "object" ? result.autoVerified : false;
            if (translated && translated !== msg.text) {
              setMessages(p => p.map(m2 =>
                m2.id === msg.id ? { ...m2, translatedText: translated, oversightCorrected: oversightCorrected || autoVerified, isTranslating: false, translationFailed: false } : m2
              ));
              if (autoVerified) {
                setVerifiedMessages(p => { const next = new Set(p); next.add(msg.id); return next; });
              }
            } else {
              setMessages(p => p.map(m2 =>
                m2.id === msg.id ? { ...m2, isTranslating: false } : m2
              ));
            }
          }).catch(() => {
            setMessages(p => p.map(m2 =>
              m2.id === msg.id ? { ...m2, isTranslating: false, translationFailed: true } : m2
            ));
          });
        }
      });
      return updated;
    });
  }, [userPrefs, translateText]);

  const loadedRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomCode || !user) return;

    pendingTranslationTimers.current.forEach(t => clearTimeout(t));
    pendingTranslationTimers.current.clear();
    loadedRoomRef.current = null;
    setLoadingMessages(true);
    const loadWithRetry = (attempt: number) => {
      fetch(`/api/room-messages/${roomCode}`, { credentials: "include" })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error(`Failed to load: ${res.status}`);
        })
        .then(async (msgs: ChatMessage[]) => {
          loadedRoomRef.current = roomCode;
          const sharedKey = e2eeSharedKeyRef.current;
          if (sharedKey) {
            const decrypted = await Promise.all(msgs.map(async (m) => {
              if (m.e2ee && m.fromId !== user.id) {
                try {
                  const plaintext = await decryptMessage(sharedKey, m.text);
                  return { ...m, text: plaintext };
                } catch {
                  return { ...m, text: "[Encrypted message]" };
                }
              }
              return m;
            }));
            setMessages(decrypted);
          } else {
            const withServerTranslations = msgs.map((m: any) => {
              if (m.serverTranslatedText && m.fromId !== user.id) {
                return { ...m, translatedText: m.serverTranslatedText };
              }
              return m;
            });
            setMessages(withServerTranslations);
          }
          const serverVerified = msgs.filter(m => (m as any).verified).map(m => m.id);
          if (serverVerified.length > 0) {
            setVerifiedMessages(prev => {
              const next = new Set(prev);
              serverVerified.forEach(id => next.add(id));
              return next;
            });
          }
          fetch(`/api/room-read/${roomCode}`, { method: "POST", credentials: "include" }).catch(() => {});
          setLoadingMessages(false);
        })
        .catch(() => {
          if (attempt < 3) {
            setTimeout(() => loadWithRetry(attempt + 1), Math.min(1500 * Math.pow(2, attempt), 6000));
          } else {
            toast({ title: t("error.somethingWentWrong"), variant: "default" });
            setLoadingMessages(false);
          }
        });
    };
    loadWithRetry(0);
  }, [roomCode, user]);

  const translationRunRef = useRef(0);

  useEffect(() => {
    if (!user || messages.length === 0) return;
    const lang = chatLanguageRef.current;
    const pLang = partnerLang;
    const partnerLangChanged = pLang && prevPartnerLangRef.current !== null && prevPartnerLangRef.current !== pLang;
    prevPartnerLangRef.current = pLang;

    if (partnerLangChanged) {
      setMessages(prev => prev.map(m => {
        if (isTranslatableText(m.text)) {
          return { ...m, translatedText: undefined, isTranslating: false };
        }
        return m;
      }));
    }

    const needsWork = messages.some(m => {
      if (m.fromId === user.id) return false;
      if (!isTranslatableText(m.text)) return false;
      if (m.translatedText && !partnerLangChanged) return false;
      // Only needs work if user has opted into a non-English target language
      return !!lang && lang !== "en";
    });
    if (!needsWork) return;

    const runId = ++translationRunRef.current;

    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.fromId === user.id) return m;
        const skipExisting = m.translatedText && !partnerLangChanged;
        if (!isTranslatableText(m.text) || skipExisting) return m;
        if (!lang) return m;
        const cached = getCachedTranslation(m.text!, lang);
        if (cached) {
          if (cached !== m.text) {
            return { ...m, translatedText: cached, isTranslating: false };
          }
          return { ...m, isTranslating: false };
        }
        return m.isTranslating ? m : { ...m, isTranslating: true };
      });
      return updated;
    });

    messages.forEach(msg => {
      if (msg.fromId === user.id) return;
      const skipExisting = msg.translatedText && !partnerLangChanged;
      if (!isTranslatableText(msg.text) || skipExisting) return;
      if (!lang) return;
      const cached = getCachedTranslation(msg.text!, lang);
      if (cached) return;
      const srcLang = pLang;
      translateTextRef.current(msg.text!, lang, srcLang || undefined).then(result => {
        if (chatLanguageRef.current !== lang) return;
        if (manualTranslateRef.current.has(msg.id)) return;
        const translated = typeof result === "string" ? result : result.text;
        const oversightCorrected = typeof result === "object" ? result.oversightCorrected : false;
        const autoVerified = typeof result === "object" ? result.autoVerified : false;
        if (translated && translated !== msg.text) {
          setMessages(p => p.map(m =>
            m.id === msg.id && !m.translatedText ? { ...m, translatedText: translated, oversightCorrected: oversightCorrected || autoVerified, isTranslating: false } : m
          ));
          if (autoVerified) {
            setVerifiedMessages(p => { const next = new Set(p); next.add(msg.id); return next; });
          }
        } else {
          setMessages(p => p.map(m =>
            m.id === msg.id && !m.translatedText ? { ...m, isTranslating: false } : m
          ));
        }
      }).catch(() => {
        if (chatLanguageRef.current !== lang) return;
        if (manualTranslateRef.current.has(msg.id)) return;
        setMessages(p => p.map(m =>
          m.id === msg.id && !m.translatedText ? { ...m, isTranslating: false, translationFailed: true } : m
        ));
      });
    });
  }, [messages.length, partnerLang, user]);

  // Voice transcription translation handled server-side. Do not translate on frontend.


  useEffect(() => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, [messages.length, typingUsers.size]);


  const sendTypingEvent = useCallback((isTyping: boolean) => {
    if (!user || !roomCode) return;
    const now = Date.now();
    if (isTyping && now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    chatSend({ type: "home-chat-typing", roomCode, userName: fromName, isTyping });
  }, [user, roomCode, chatSend]);

  const stopTypingHeartbeat = useCallback(() => {
    if (typingHeartbeatRef.current) {
      clearInterval(typingHeartbeatRef.current);
      typingHeartbeatRef.current = null;
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  const startTypingHeartbeat = useCallback(() => {
    stopTypingHeartbeat();
    typingHeartbeatRef.current = setInterval(() => {
      lastTypingSentRef.current = 0;
      sendTypingEvent(true);
    }, 5000);
    typingTimeoutRef.current = setTimeout(() => {
      stopTypingHeartbeat();
      sendTypingEvent(false);
    }, 30000);
  }, [sendTypingEvent, stopTypingHeartbeat]);

  useEffect(() => {
    return () => {
      if (typingHeartbeatRef.current) clearInterval(typingHeartbeatRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUsers(prev => {
        prev.forEach(entry => clearTimeout(entry.timer));
        return new Map();
      });
    };
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setMessageInput(value);
    if (value.trim()) {
      sendTypingEvent(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        stopTypingHeartbeat();
        sendTypingEvent(false);
      }, 30000);
      if (!typingHeartbeatRef.current) {
        typingHeartbeatRef.current = setInterval(() => {
          lastTypingSentRef.current = 0;
          sendTypingEvent(true);
        }, 5000);
      }
      // Debounced language detection — fires after first word (3+ chars)
      if (detectLangTimeoutRef.current) clearTimeout(detectLangTimeoutRef.current);
      if (value.trim().length >= 2) {
        detectLangTimeoutRef.current = setTimeout(async () => {
          try {
            const res = await fetch("/api/v1/detect-language", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ text: value.trim() }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.language) setDetectedTypingLang(data.language);
            }
          } catch {}
        }, 400);
      }
    } else {
      stopTypingHeartbeat();
      sendTypingEvent(false);
      if (detectLangTimeoutRef.current) clearTimeout(detectLangTimeoutRef.current);
      setDetectedTypingLang(null);
    }
  }, [sendTypingEvent, stopTypingHeartbeat]);

  const sendMessage = useCallback(() => {
    const text = messageInput.trim();
    if (!text || !user) return;
    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    stopTypingHeartbeat();
    sendTypingEvent(false);

    const replyRef = replyingTo ? {
      id: replyingTo.id,
      fromName: replyingTo.fromName,
      text: replyingTo.text,
      ...(replyingTo.imageData ? { imageData: replyingTo.imageData } : {}),
      ...(replyingTo.videoData ? { videoData: replyingTo.videoData } : {}),
    } : undefined;

    const optimisticMsg: ChatMessage = {
      id: localId, roomCode, fromId: user.id, fromName, text, timestamp: Date.now(),
      status: "sent",
      e2ee: !!e2eeSharedKeyRef.current,
      ...(replyRef ? { replyTo: replyRef } : {}),
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setMessageInput("");
    setReplyingTo(null);
    setDetectedTypingLang(null);
    if (detectLangTimeoutRef.current) clearTimeout(detectLangTimeoutRef.current);

    // Translation is handled server-side by the translation agent.
    // Do NOT translate on the frontend when sending. Users can manually trigger
    // translation as a secondary option if needed via handleTranslateAction.

    const sendViaRest = (msgText: string) => {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ text: msgText, fromName, ...(replyRef ? { replyTo: replyRef } : {}) }),
      }).catch(() => {
        toast({ title: t("error.somethingWentWrong"), variant: "default" });
      });
    };

    const clientTimestamp = Date.now();
    if (e2eeSharedKeyRef.current) {
      encryptMessage(e2eeSharedKeyRef.current, text).then(encrypted => {
        const sent = chatSend({ type: "home-chat-send", roomCode, text: encrypted, fromName, e2ee: true, clientTimestamp, ...(replyRef ? { replyTo: replyRef } : {}) });
        if (!sent) {
          toast({ title: "Connection lost. Reconnecting...", variant: "default" });
        }
      }).catch(() => {
        const sent = chatSend({ type: "home-chat-send", roomCode, text, fromName, clientTimestamp, ...(replyRef ? { replyTo: replyRef } : {}) });
        if (!sent) sendViaRest(text);
      });
    } else {
      const sent = chatSend({ type: "home-chat-send", roomCode, text, fromName, clientTimestamp, ...(replyRef ? { replyTo: replyRef } : {}) });
      if (!sent) sendViaRest(text);
    }
  }, [messageInput, user, roomCode, toast, chatSend, replyingTo, t]);

  const sendLocationMessage = useCallback((payload: LocationPayload) => {
    if (!user) return;
    const isLive = payload.expiresAt !== undefined;
    const prefix = isLive ? "[LiveLocation:" : "[Location:";
    const data = {
      lat: payload.lat,
      lng: payload.lng,
      name: payload.name,
      ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
    };
    const text = `${prefix}${JSON.stringify(data)}]`;
    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg: ChatMessage = {
      id: localId, roomCode, fromId: user.id, fromName, text, timestamp: Date.now(), status: "sent",
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setShowLocationSheet(false);
    const clientTimestamp = Date.now();
    const sent = chatSend({ type: "home-chat-send", roomCode, text, fromName, clientTimestamp });
    if (!sent) {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, fromName }),
      }).catch(() => {});
    }
  }, [user, roomCode, chatSend]);

  const recordingStartTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    micReleasedDuringStartRef.current = false;
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        }
      });
      if (micReleasedDuringStartRef.current || micCancelledRef.current) {
        rawStream.getTracks().forEach(t => t.stop());
        return;
      }

      // Build the Web Audio noise-reduction chain on top of the hardware-level
      // constraints already applied above. The processor attenuates sub-80 Hz
      // rumble (highpass filter) and normalises levels (dynamics compressor).
      const processor = await buildAudioProcessor(rawStream);
      audioProcDisposeRef.current = processor.dispose;
      const stream = processor.processedStream;
      streamRef.current = stream;
      recordedChunksRef.current = [];

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      let mimeType = "audio/webm";
      if (isIOS) {
        if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else if (MediaRecorder.isTypeSupported("audio/aac")) mimeType = "audio/aac";
        else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
      } else {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
        else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
        else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        try { audioProcDisposeRef.current?.(); } catch {}
        audioProcDisposeRef.current = null;
        streamRef.current = null;

        if (voiceRecognitionRef.current) {
          try { voiceRecognitionRef.current.stop(); } catch {}
          voiceRecognitionRef.current = null;
        }

        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }

        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const durationMs = Date.now() - recordingStartTimeRef.current;

        if (blob.size < 100 || durationMs < 500) {
          toast({ title: "Recording too short", description: "Hold for at least 1 second while speaking", variant: "default" });
          setIsRecording(false);
          setRecordingDuration(0);
          return;
        }

        setIsRecording(false);
        setRecordingDuration(0);

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          if (!base64Audio || !user) return;

          const MAX_AUDIO_SIZE = 5 * 1024 * 1024;
          if (base64Audio.length > MAX_AUDIO_SIZE) {
            toast({ title: "Recording too long", description: "Voice notes must be under 5MB", variant: "default" });
            return;
          }

          const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
          const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          const replyRef = replyingTo ? {
            id: replyingTo.id, fromName: replyingTo.fromName, text: replyingTo.text,
            ...(replyingTo.imageData ? { imageData: replyingTo.imageData } : {}),
            ...(replyingTo.videoData ? { videoData: replyingTo.videoData } : {}),
          } : undefined;

          const capturedTranscript = voiceTranscriptRef.current || undefined;

          const isCurrentlyOffline = !navigator.onLine;

          const optimisticMsg: ChatMessage = {
            id: localId, roomCode, fromId: user.id, fromName,
            text: "[Voice]", audioData: base64Audio, mediaType: "audio",
            transcription: capturedTranscript,
            timestamp: Date.now(), status: isCurrentlyOffline ? "queued" : "sent",
            ...(replyRef ? { replyTo: replyRef } : {}),
            ...(vanishMode ? { vanishAt: Date.now() + 10000 } : {}),
          };
          setMessages(prev => [...prev, optimisticMsg]);
          setReplyingTo(null);

          const queuePayload: VoiceMessagePayload = {
            roomCode, fromName, audioData: base64Audio,
            ...(capturedTranscript ? { transcription: capturedTranscript } : {}),
            ...(replyRef ? { replyTo: replyRef } : {}),
            ...(vanishMode ? { vanish: true } : {}),
          };

          if (isCurrentlyOffline) {
            enqueue({ type: "voice-message", timestamp: Date.now(), retries: 0, payload: queuePayload });
            toast({ title: "Saved offline", description: "Voice message will be delivered when you're back online.", variant: "default" });
          } else {
            const ws = getWs();
            if (socketChatConnected || (ws && ws.readyState === WebSocket.OPEN)) {
              chatSend({ type: "home-chat-send", roomCode, text: "[Voice]", fromName, audioData: base64Audio, ...(capturedTranscript ? { transcription: capturedTranscript } : {}), ...(replyRef ? { replyTo: replyRef } : {}), ...(vanishMode ? { vanish: true } : {}) });
            } else {
              fetch(`/api/room-messages/${roomCode}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                credentials: "include", body: JSON.stringify({ text: "[Voice]", fromName, audioData: base64Audio, ...(capturedTranscript ? { transcription: capturedTranscript } : {}), ...(replyRef ? { replyTo: replyRef } : {}), ...(vanishMode ? { vanish: true } : {}) }),
              }).catch(() => {
                enqueue({ type: "voice-message", timestamp: Date.now(), retries: 0, payload: queuePayload });
                setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: "queued" as const } : m));
                toast({ title: "Saved offline", description: "Voice message queued — will send when connection is restored.", variant: "default" });
              });
            }
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(250);
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);

      voiceTranscriptRef.current = "";
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          recognition.onresult = (event: any) => {
            let final = "";
            for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                final += event.results[i][0].transcript + " ";
              }
            }
            if (final.trim()) voiceTranscriptRef.current = final.trim();
          };
          recognition.onerror = () => {};
          recognition.start();
          voiceRecognitionRef.current = recognition;
        }
      } catch {}
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "NotFoundError") {
        toast({ title: "Microphone access denied", description: "Please allow microphone access in your browser settings", variant: "default" });
      } else {
        toast({ title: "Could not start recording", description: err?.message || "Unknown error", variant: "default" });
      }
    }
  }, [isRecording, toast, user, roomCode, chatSend, getWs, t, replyingTo, vanishMode]);

  const cancelRecording = useCallback(() => {
    if (voiceRecognitionRef.current) {
      try { voiceRecognitionRef.current.abort(); } catch {}
      voiceRecognitionRef.current = null;
    }
    voiceTranscriptRef.current = "";
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        try { audioProcDisposeRef.current?.(); } catch {}
        audioProcDisposeRef.current = null;
        streamRef.current = null;
      };
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    recordedChunksRef.current = [];
    setIsRecording(false);
    setRecordingDuration(0);
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    const durationMs = Date.now() - recordingStartTimeRef.current;
    if (durationMs < 500) {
      cancelRecording();
      toast({ title: t("room.holdToRecord"), description: t("room.holdToRecordDesc") });
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.requestData(); } catch {}
      mediaRecorderRef.current.stop();
    }
  }, [isRecording, cancelRecording, toast, t]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (micHoldTimerRef.current) clearTimeout(micHoldTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      try { audioProcDisposeRef.current?.(); } catch {}
      audioProcDisposeRef.current = null;
    };
  }, []);

  const handleMicDown = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    micCancelledRef.current = false;
    micHoldTimerRef.current = setTimeout(() => {
      if (!micCancelledRef.current) {
        startRecording();
      }
    }, 150);
  }, [startRecording]);

  const handleMicUp = useCallback(() => {
    if (!isRecording) {
      micReleasedDuringStartRef.current = true;
    }
    if (micHoldTimerRef.current) {
      clearTimeout(micHoldTimerRef.current);
      micHoldTimerRef.current = null;
    }
    if (!micCancelledRef.current && !isRecording) {
      toast({ title: t("room.holdToRecord"), description: t("room.holdToRecordDesc") });
    }
  }, [isRecording, toast, t]);

  const handleMicCancel = useCallback(() => {
    micCancelledRef.current = true;
    if (micHoldTimerRef.current) {
      clearTimeout(micHoldTimerRef.current);
      micHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const handleGlobalUp = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.closest("[data-testid='button-cancel-recording']")) return;
      stopRecording();
    };
    window.addEventListener("touchend", handleGlobalUp, { passive: true });
    window.addEventListener("mouseup", handleGlobalUp);
    return () => {
      window.removeEventListener("touchend", handleGlobalUp);
      window.removeEventListener("mouseup", handleGlobalUp);
    };
  }, [isRecording, stopRecording]);

  useEffect(() => {
    if (isRecording && recordingDuration >= MAX_VOICE_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [isRecording, recordingDuration, stopRecording]);

  const handleLongPressStart = useCallback((msg: ChatMessage, e: React.TouchEvent | React.MouseEvent) => {
    longPressTriggered.current = false;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      const menuW = 280;
      const menuH = 340;
      const menuX = Math.min(Math.max(8, clientX - menuW / 2), window.innerWidth - menuW - 8);
      const menuY = Math.min(Math.max(10, clientY - 70), window.innerHeight - menuH);
      setActionMenuPos({ x: menuX, y: menuY });
      setActionMenuMsg(msg);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 400);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleVanishReveal = useCallback((msgId: string) => {
    setRevealedMedia(prev => new Set(prev).add(msgId));
    setTimeout(() => {
      setRevealedMedia(prev => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }, 10000);
  }, []);

  const handleReaction = useCallback((msgId: string, emoji: string) => {
    chatSend({ type: "home-chat-react", roomCode, messageId: msgId, emoji });
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      if (reactions[emoji]?.includes(user?.id || "")) {
        reactions[emoji] = reactions[emoji].filter(u => u !== user?.id);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        Object.keys(reactions).forEach(k => {
          reactions[k] = reactions[k].filter(u => u !== user?.id);
          if (reactions[k].length === 0) delete reactions[k];
        });
        reactions[emoji] = [...(reactions[emoji] || []), user?.id || ""];
      }
      return { ...m, reactions };
    }));
    setActionMenuMsg(null);
    setShowExpandedReactions(false);
  }, [chatSend, roomCode, user]);

  const handleReplyAction = useCallback((msg: ChatMessage) => {
    setReplyingTo(msg);
    setActionMenuMsg(null);
  }, []);

  const handleDeleteAction = useCallback(async (msg: ChatMessage) => {
    setActionMenuMsg(null);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    const sent = chatSend({ type: "home-chat-delete", roomCode, messageId: msg.id });
    if (!sent) {
      try {
        await apiRequest("DELETE", `/api/room-messages/${roomCode}/${msg.id}`);
      } catch {}
    }
    toast({ title: t("room.messageDeleted") });
  }, [roomCode, toast, t, chatSend]);

  const handleTranslateAction = useCallback(async (msg: ChatMessage) => {
    setActionMenuMsg(null);
    if (!isTranslatableText(msg.text)) {
      toast({ title: t("room.noTextToTranslate") });
      return;
    }
    if (msg.isTranslating) return;
    const isMe = msg.fromId === user?.id;
    const targetLang = isMe ? (partnerLangRef.current || chatLanguageRef.current) : chatLanguageRef.current;
    const sourceLang = isMe ? chatLanguageRef.current : (partnerLangRef.current || undefined);
    manualTranslateRef.current.add(msg.id);
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, isTranslating: true } : m
    ));
    try {
      const result = await translateText(msg.text, targetLang, sourceLang);
      const translated = typeof result === "string" ? result : result.text;
      const oversightCorrected = typeof result === "object" ? result.oversightCorrected : false;
      const autoVerified = typeof result === "object" ? result.autoVerified : false;
      manualTranslateRef.current.delete(msg.id);
      if (translated && translated !== msg.text) {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, translatedText: translated, oversightCorrected: oversightCorrected || autoVerified, isTranslating: false } : m
        ));
        if (autoVerified) {
          setVerifiedMessages(prev => { const next = new Set(prev); next.add(msg.id); return next; });
        }
        toast({ title: t("room.translated") });
      } else {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, isTranslating: false } : m
        ));
        toast({ title: t("room.sameLanguage") });
      }
    } catch {
      manualTranslateRef.current.delete(msg.id);
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, isTranslating: false, translationFailed: true } : m
      ));
      toast({ title: t("room.translationFailed"), variant: "default" });
    }
  }, [translateText, toast, t, user]);

  const handleRetryTranslation = useCallback(async (msg: ChatMessage) => {
    if (!msg.text || msg.isTranslating) return;
    manualTranslateRef.current.add(msg.id);
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, isTranslating: true, translationFailed: false } : m
    ));
    const isMe = msg.fromId === user?.id;
    try {
      const targetLang = isMe ? partnerLangRef.current : chatLanguageRef.current;
      if (!targetLang) {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, isTranslating: false } : m
        ));
        return;
      }
      const sourceLang = isMe ? chatLanguageRef.current : (partnerLangRef.current || undefined);
      const result = await translateText(msg.text, targetLang, sourceLang);
      const translated = typeof result === "string" ? result : result.text;
      const oversightCorrected = typeof result === "object" ? result.oversightCorrected : false;
      manualTranslateRef.current.delete(msg.id);
      if (translated && translated !== msg.text) {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, translatedText: translated, oversightCorrected, isTranslating: false, translationFailed: false } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, isTranslating: false, translationFailed: false } : m
        ));
      }
    } catch {
      manualTranslateRef.current.delete(msg.id);
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, isTranslating: false, translationFailed: true } : m
      ));
      toast({ title: t("room.translationFailed") || "Translation failed", variant: "default" });
    }
  }, [translateText, user, toast, t]);

  const handleShareAction = useCallback(async (msg: ChatMessage) => {
    setActionMenuMsg(null);
    const shareText = msg.translatedText && msg.translatedText !== msg.text
      ? `${msg.translatedText}\n(${msg.text})`
      : msg.text;

    if ((msg.text === "[GIF]" || msg.text === "[Image]") && msg.imageData) {
      if (navigator.share) {
        try {
          await navigator.share({ text: msg.text === "[GIF]" ? "Check out this GIF!" : "Check out this photo!", url: msg.imageData });
        } catch {}
      } else {
        try {
          await navigator.clipboard.writeText(msg.imageData);
          toast({ title: "Copied!" });
        } catch {
          toast({ title: t("error.somethingWentWrong"), variant: "default" });
        }
      }
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        toast({ title: "Copied!" });
      } catch {
        toast({ title: t("error.somethingWentWrong"), variant: "default" });
      }
    }
  }, [toast, t]);

  const handleMediaPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast({ title: t("error.somethingWentWrong"), variant: "default" });
      e.target.value = "";
      return;
    }
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const maxImageSize = isMobile ? 15.5 * 1024 * 1024 : 25 * 1024 * 1024;
    const maxVideoSize = 25 * 1024 * 1024;
    const maxSize = isVideo ? maxVideoSize : maxImageSize;
    const maxLabel = isVideo ? "25MB" : (isMobile ? "15.5MB" : "25MB");
    if (file.size > maxSize) {
      toast({ title: t("error.somethingWentWrong"), description: `Max ${maxLabel}`, variant: "default" });
      e.target.value = "";
      return;
    }

    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const isVanish = vanishMode;
      const optimisticMsg: ChatMessage = {
        id: localId, roomCode, fromId: user.id, fromName,
        text: isVideo ? "[Video]" : "[Image]",
        ...(isImage ? { imageData: result } : { videoData: result }),
        mediaType: isImage ? "image" : "video",
        timestamp: Date.now(), status: "sent",
        ...(isVanish ? { vanish: true } : {}),
      };
      setMessages(prev => [...prev, optimisticMsg]);

      const ws = getWs();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast({ title: t("room.disconnected"), variant: "default" });
        return;
      }
      const type = isVideo ? "home-chat-video" : "home-chat-image";
      const dataKey = isVideo ? "videoData" : "imageData";
      chatSend({ type, roomCode, fromName, [dataKey]: result, ...(isVanish ? { vanish: true } : {}) });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [user, roomCode, toast, chatSend, getWs, vanishMode]);

  const handleCameraCapture = useCallback((file: File, captions?: VideoCaptionSegment[]) => {
    setShowCamera(false);
    if (!user) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) return;

    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const maxImageSize = isMobile ? 15.5 * 1024 * 1024 : 25 * 1024 * 1024;
    const maxVideoSize = 25 * 1024 * 1024;
    const maxSize = isVideo ? maxVideoSize : maxImageSize;
    const maxLabel = isVideo ? "25MB" : (isMobile ? "15.5MB" : "25MB");
    if (file.size > maxSize) {
      toast({ title: t("error.somethingWentWrong"), description: `Max ${maxLabel}`, variant: "default" });
      return;
    }

    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const reader = new FileReader();
    reader.onload = async () => {
      let result = reader.result as string;
      const isVanish = vanishMode;

      if (isVideo && captions && captions.length > 0) {
        let burnedOk = false;
        const sendTimestamp = Date.now();
        const optimisticProcessing: ChatMessage = {
          id: localId, roomCode, fromId: user.id, fromName,
          text: "[Video]",
          mediaType: "video",
          timestamp: sendTimestamp, status: "sent",
          ...(isVanish ? { vanish: true } : {}),
          liveCaptions: captions,
          isBurningCaptions: true,
        };
        setMessages(prev => [...prev, optimisticProcessing]);

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 90000);
          const burnResponse = await fetch("/api/video-captions/burn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoData: result, captions }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (burnResponse.ok) {
            const burnResult = await burnResponse.json();
            if (burnResult.videoData) {
              result = burnResult.videoData;
              burnedOk = true;
            }
          } else {
            console.warn("[CaptionBurn] Server returned", burnResponse.status);
          }
        } catch (err) {
          console.warn("[CaptionBurn] Failed to burn captions, sending original:", err);
        }

        setMessages(prev => prev.filter(m => m.id !== localId));

        const ws = getWs();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          toast({ title: t("room.disconnected"), variant: "default" });
          return;
        }
        chatSend({
          type: "home-chat-video", roomCode, fromName, videoData: result,
          ...(isVanish ? { vanish: true } : {}),
          liveCaptions: captions,
          hasBurnedCaptions: burnedOk,
        });
      } else {
        const optimisticMsg: ChatMessage = {
          id: localId, roomCode, fromId: user.id, fromName,
          text: isVideo ? "[Video]" : "[Image]",
          ...(isImage ? { imageData: result } : { videoData: result }),
          mediaType: isImage ? "image" : "video",
          timestamp: Date.now(), status: "sent",
          ...(isVanish ? { vanish: true } : {}),
        };
        setMessages(prev => [...prev, optimisticMsg]);

        const type = isVideo ? "home-chat-video" : "home-chat-image";
        const dataKey = isVideo ? "videoData" : "imageData";
        chatSend({
          type, roomCode, fromName, [dataKey]: result,
          ...(isVanish ? { vanish: true } : {}),
        });
      }
    };
    reader.readAsDataURL(file);
  }, [user, roomCode, toast, chatSend, getWs, vanishMode]);

  const sendAnimatedEmoji = useCallback((emojiCode: string) => {
    if (!user) return;
    const imageData = `https://fonts.gstatic.com/s/e/notoemoji/latest/${emojiCode}/512.gif`;

    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const optimisticMsg: ChatMessage = {
      id: localId, roomCode, fromId: user.id, fromName,
      text: "[Emoji]", imageData, mediaType: "image",
      timestamp: Date.now(), status: "sent",
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const sent = chatSend({ type: "home-chat-image", roomCode, fromName, imageData });
    if (!sent) {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ text: "[Emoji]", fromName, imageData }),
      }).catch(() => {});
    }

    setShowEmojiPicker(false);
  }, [user, roomCode, toast, chatSend]);

  const fetchGifs = useCallback(async (query?: string) => {
    setGifLoading(true);
    try {
      const endpoint = query
        ? `/api/gifs/search?q=${encodeURIComponent(query)}`
        : `/api/gifs/trending`;
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setGifResults(data.gifs || []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }, []);

  const handleGifSearchChange = useCallback((value: string) => {
    setGifSearch(value);
    if (gifSearchTimeout.current) clearTimeout(gifSearchTimeout.current);
    gifSearchTimeout.current = setTimeout(() => {
      fetchGifs(value.trim() || undefined);
    }, 400);
  }, [fetchGifs]);

  const sendGif = useCallback((gifUrl: string) => {
    if (!user) return;
    const fromName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const optimisticMsg: ChatMessage = {
      id: localId, roomCode, fromId: user.id, fromName,
      text: "[GIF]", imageData: gifUrl, mediaType: "image",
      timestamp: Date.now(), status: "sent",
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const sent = chatSend({ type: "home-chat-image", roomCode, fromName, imageData: gifUrl });
    if (!sent) {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ text: "[GIF]", fromName, imageData: gifUrl }),
      }).catch(() => {});
    }

    setShowEmojiPicker(false);
  }, [user, roomCode, chatSend]);

  useEffect(() => {
    if (showEmojiPicker && pickerTab === "gifs" && gifResults.length === 0 && !gifLoading) {
      fetchGifs();
    }
  }, [showEmojiPicker, pickerTab, gifResults.length, gifLoading, fetchGifs]);

  const loadVideoCaptions = useCallback(async (msgId: string, videoData: string) => {
    const requestId = msgId;
    captionRequestIdRef.current = requestId;
    setVideoCaptions([]);
    setActiveCaption("");
    setVideoCaptionStatus("extracting");

    try {
      setVideoCaptionStatus("transcribing");
      const transcribeRes = await apiRequest("POST", "/api/video-captions/transcribe", {
        messageId: msgId,
        videoData,
      });
      if (captionRequestIdRef.current !== requestId) return;
      const transcription = await transcribeRes.json();

      if (transcription.noSpeech || !transcription.segments?.length) {
        if (captionRequestIdRef.current === requestId) setVideoCaptionStatus("no-speech");
        return;
      }

      const targetLang = chatLanguageRef.current;
      if (targetLang && targetLang !== transcription.lang) {
        setVideoCaptionStatus("translating");
        const translateRes = await apiRequest("POST", "/api/video-captions/translate", {
          messageId: msgId,
          targetLang,
        });
        if (captionRequestIdRef.current !== requestId) return;
        const translated = await translateRes.json();
        if (translated.segments?.length) {
          setVideoCaptions(translated.segments);
          setVideoCaptionStatus("done");
          return;
        }
      }

      if (captionRequestIdRef.current !== requestId) return;
      setVideoCaptions(transcription.segments);
      setVideoCaptionStatus("done");
    } catch (err) {
      if (captionRequestIdRef.current === requestId) setVideoCaptionStatus("error");
    }
  }, []);

  const openVideoViewer = useCallback((msgId: string, videoData: string, preAttachedCaptions?: VideoCaptionSegment[], hasBurnedCaptions?: boolean) => {
    setViewerVideo(videoData);
    setViewerVideoMsgId(msgId);
    setActiveCaption("");
    setViewerPlaying(false);
    setViewerProgress(0);
    setViewerDuration(0);
    setViewerHasBurnedCaptions(!!hasBurnedCaptions);
    if (hasBurnedCaptions) {
      setVideoCaptionStatus("done");
      setVideoCaptions([]);
    } else if (preAttachedCaptions && preAttachedCaptions.length > 0) {
      setVideoCaptions(preAttachedCaptions);
      setVideoCaptionStatus("done");
    } else {
      loadVideoCaptions(msgId, videoData);
    }
  }, [loadVideoCaptions]);

  const closeVideoViewer = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setViewerVideo(null);
    setViewerVideoMsgId(null);
    setVideoCaptions([]);
    setVideoCaptionStatus("idle");
    setActiveCaption("");
    setViewerPlaying(false);
    setViewerProgress(0);
    setViewerDuration(0);
    setViewerHasBurnedCaptions(false);
  }, []);

  const handleViewerPlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setViewerPlaying(true);
    } else {
      videoRef.current.pause();
      setViewerPlaying(false);
    }
  }, []);

  const handleViewerDownload = useCallback(() => {
    if (!viewerVideo) return;
    const a = document.createElement("a");
    a.href = viewerVideo;
    a.download = `junotalk-video-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [viewerVideo]);

  const handleViewerShare = useCallback(async () => {
    if (!viewerVideo) return;
    try {
      const res = await fetch(viewerVideo);
      const blob = await res.blob();
      const file = new File([blob], `junotalk-video-${Date.now()}.mp4`, { type: "video/mp4" });
      if (navigator.share) {
        await navigator.share({ files: [file], title: "JunoTalk Video" });
      } else {
        handleViewerDownload();
      }
    } catch {
      handleViewerDownload();
    }
  }, [viewerVideo, handleViewerDownload]);

  const handleLanguageChange = useCallback(async (lang: string) => {
    setChatLanguage(lang);
    chatLanguageRef.current = lang;
    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, lang); } catch {}
    try {
      await apiRequest("PATCH", "/api/preferences", { subtitleLanguage: lang });
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    } catch {}

    // "en" means translation is off — clear any existing translations instead of calling the API
    if (lang === "en") {
      setMessages(prev => prev.map(m => ({ ...m, translatedText: undefined, isTranslating: false })));
      return;
    }

    setMessages(prev => {
      const pLangSrc = partnerLangRef.current;
      const updated = prev.map(m => {
        if (m.fromId === user?.id) return m;
        if (!isTranslatableText(m.text)) return m;
        const cached = getCachedTranslation(m.text!, lang);
        if (cached) {
          if (cached !== m.text) return { ...m, translatedText: cached, isTranslating: false };
          return { ...m, isTranslating: false };
        }
        return { ...m, isTranslating: true, translatedText: undefined };
      });
      updated.forEach(msg => {
        if (msg.fromId === user?.id) return;
        if (msg.translatedText || !msg.isTranslating) return;
        if (!isTranslatableText(msg.text)) return;
        const srcLang = pLangSrc || undefined;
        translateText(msg.text!, lang, srcLang).then(result => {
          if (chatLanguageRef.current !== lang) return;
          if (manualTranslateRef.current.has(msg.id)) return;
          const translated = typeof result === "string" ? result : result.text;
          const oversightCorrected = typeof result === "object" ? result.oversightCorrected : false;
          const autoVerified = typeof result === "object" ? result.autoVerified : false;
          if (translated && translated !== msg.text) {
            setMessages(p => p.map(m =>
              m.id === msg.id ? { ...m, translatedText: translated, oversightCorrected: oversightCorrected || autoVerified, isTranslating: false } : m
            ));
            if (autoVerified) {
              setVerifiedMessages(p => { const next = new Set(p); next.add(msg.id); return next; });
            }
          } else {
            setMessages(p => p.map(m =>
              m.id === msg.id ? { ...m, isTranslating: false } : m
            ));
          }
        }).catch(() => {
          if (chatLanguageRef.current !== lang) return;
          if (manualTranslateRef.current.has(msg.id)) return;
          setMessages(p => p.map(m =>
            m.id === msg.id ? { ...m, isTranslating: false, translationFailed: true } : m
          ));
        });
      });
      return updated;
    });
  }, [translateText]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  if (!user) return null;

  const langName = LANGUAGES.find(l => l.code === chatLanguage)?.name || "English";

  return (
    <div className="h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2 px-3 h-14">
          <Button
            variant="ghost"
            onClick={() => setLocation("/chat-rooms")}
            data-testid="button-back-chat-rooms"
            className="w-11 h-11 min-w-[44px] p-0 flex items-center justify-center"
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="flex-shrink-0">
              <polygon points="4,14 24,4 24,24" fill="#00B899" />
            </svg>
          </Button>
          {(() => {
            const otherMember = members.find(m => m.userId !== user?.id);
            const otherName = otherMember
              ? ((otherMember as any).user?.firstName
                ? `${(otherMember as any).user.firstName}${(otherMember as any).user?.lastName ? ` ${(otherMember as any).user.lastName}` : ""}`
                : (otherMember as any).username || null)
              : null;
            const isActive = otherMember ? activeUserIds.includes(otherMember.userId) : false;
            return otherMember ? (
              <div className="flex items-center gap-2 min-w-0" data-testid="chat-partner-info">
                <div className="relative flex-shrink-0">
                  <Avatar className="w-8 h-8 border-2 border-background">
                    <AvatarImage src={(otherMember as any).user?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                      {safeInitials((otherMember as any).user?.firstName, (otherMember as any).user?.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  {isActive && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground truncate block" data-testid="chat-partner-name">
                    {otherName || "Member"}
                  </span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Languages className="w-2.5 h-2.5" />
                    {detectedTypingLang && messageInput.trim() ? (
                      <span className="flex items-center gap-1">
                        <span
                          className="font-semibold"
                          style={{ color: "#00e896" }}
                          data-testid="text-detected-lang"
                        >
                          {LANGUAGES.find(l => l.code === detectedTypingLang)?.name || detectedTypingLang}
                        </span>
                        <span style={{ opacity: 0.5 }}>detected</span>
                      </span>
                    ) : messages.some(m => m.isTranslating && m.fromId !== user?.id) ? (
                      <span className="animate-pulse">{langName}</span>
                    ) : langName}
                    {e2eeActive && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium ml-1">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        E2EE
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <ConnectionStatus status={connectionStatus} quality={connectionQuality} rtt={connectionRtt} />
                <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-translating-label">
                  <Languages className="w-3 h-3" />
                  {langName}
                </span>
              </div>
            );
          })()}

          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLocation(`/room/${roomCode}/call`)}
              className="gap-1 h-9 px-2.5"
              data-testid="button-start-call"
            >
              <Phone className="w-4 h-4" />
              Call
            </Button>
            <Button
              size="sm"
              onClick={() => setLocation(`/room/${roomCode}/call`)}
              className="gap-1 h-9 px-2.5"
              data-testid="button-join-video"
            >
              <Video className="w-4 h-4" />
              Video
            </Button>
          </div>
        </div>

        {connectionStatus !== "connected" && showDisconnected && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 text-destructive text-xs" data-testid="ws-disconnected">
            <WifiOff className="w-3 h-3" />
            <span>{t("room.reconnecting")}</span>
          </div>
        )}
      </header>

      {incomingCall && (
        <SectionBoundary label="Incoming Call">
        <div className="mx-3 mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center gap-3" data-testid="incoming-call-banner">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Video className="w-5 h-5 text-primary animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-caller-name">{incomingCall.callerName}</p>
            <p className="text-xs text-muted-foreground">{t("room.incomingVideoCall")}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setIncomingCall(null);
                if (incomingCallTimerRef.current) clearTimeout(incomingCallTimerRef.current);
              }}
              data-testid="button-decline-call"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIncomingCall(null);
                if (incomingCallTimerRef.current) clearTimeout(incomingCallTimerRef.current);
                setLocation(`/room/${roomCode}/call`);
              }}
              data-testid="button-accept-call"
            >
              <Video className="w-3.5 h-3.5 mr-1" />
              {t("room.acceptCall")}
            </Button>
          </div>
        </div>
        </SectionBoundary>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col" data-scrollable data-testid="chat-messages-container">
        
        <div className="pb-1" data-testid="language-select-panel">
          <Select value={chatLanguage} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-full border-blue-500/30" data-testid="select-chat-language">
              <SelectValue placeholder={t("settings.subtitleLanguage")} />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code} data-testid={`lang-option-${lang.code}`}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <div className="space-y-2">
        {loadingMessages ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <MessageSquare className="w-10 h-10 mb-3 opacity-50" />
            <p>{t("room.noOneHere")}</p>
            <p className="text-xs mt-1">{t("room.waitingForOthers")}</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.fromId === user?.id;
            const hasMedia = !!(msg.imageData || msg.videoData || msg.audioData);
            const isVoice = msg.text === "[Voice]" && !!msg.audioData;
            const isEmoji = msg.text === "[Emoji]";
            const isGif = msg.text === "[GIF]";
            const isRevealed = revealedMedia.has(msg.id);
            const isVanishMedia = hasMedia && !!msg.vanish;
            const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;

            const isKeyboardEmoji = !isEmoji && !isGif && !hasMedia && msg.text && isEmojiOnly(msg.text);

            const emojiMap = EMOJI_MAP;
            const reactionBadge = hasReactions ? (
              <div
                className={`absolute ${isMe ? "-left-2" : "-right-2"} -bottom-2 flex gap-0.5 z-10`}
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" }}
              >
                {Object.entries(msg.reactions!).map(([emoji, users]) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(msg.id, emoji)}
                    className="flex items-center gap-0.5 rounded-full text-[16px] px-0.5 py-0 leading-none"
                    style={{ background: "none", border: "none" }}
                    data-testid={`reaction-${emoji}-${msg.id}`}
                  >
                    <span>{emojiMap[emoji] || emoji}</span>
                    {users.length > 1 && <span className="text-[10px] font-bold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{users.length}</span>}
                  </button>
                ))}
              </div>
            ) : null;

            const pressHandlers = {
              onTouchStart: (e: React.TouchEvent) => handleLongPressStart(msg, e),
              onTouchEnd: handleLongPressEnd,
              onTouchMove: handleLongPressEnd,
              onTouchCancel: handleLongPressEnd,
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                const menuW = 280;
                const menuH = 340;
                const menuX = Math.min(Math.max(8, e.clientX - menuW / 2), window.innerWidth - menuW - 8);
                const menuY = Math.min(Math.max(10, e.clientY - 70), window.innerHeight - menuH);
                setActionMenuPos({ x: menuX, y: menuY });
                setActionMenuMsg(msg);
                if (navigator.vibrate) navigator.vibrate(30);
              },
            };

            if (isKeyboardEmoji) {
              const emojiCount = [...msg.text!].filter(c => /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(c)).length;
              const fontSize = emojiCount <= 1 ? "56px" : emojiCount <= 3 ? "44px" : "36px";
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}
                  data-testid={`chat-msg-${msg.id}`}
                >
                  <div
                    className={`relative ${isMe ? "mr-1" : "ml-1"}`}
                    {...pressHandlers}
                  >
                    {!isMe && (
                      <span className="text-[10px] text-primary font-semibold mb-0.5 block">{msg.fromName}</span>
                    )}
                    <span style={{ fontSize, lineHeight: 1.2 }} data-testid={`chat-keyboard-emoji-${msg.id}`}>
                      {msg.text}
                    </span>
                    {reactionBadge}
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                      {isMe && (
                        <span className="text-[10px] font-medium text-muted-foreground" data-testid={`msg-status-${msg.id}`}>
                          {msg.status === "queued" ? <><Clock className="w-2.5 h-2.5 inline mr-0.5 opacity-60" />Queued</> : msg.status === "seen" ? "Seen" : msg.status === "delivered" ? "Delivered" : "Sent"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if ((isEmoji || isGif) && msg.imageData) {
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  data-testid={`chat-msg-${msg.id}`}
                >
                  <div
                    className={`relative ${isMe ? "mr-1" : "ml-1"} ${isGif ? "max-w-[75%]" : ""}`}
                    {...pressHandlers}
                  >
                    {!isMe && (
                      <span className="text-[10px] text-primary font-semibold mb-0.5 block">{msg.fromName}</span>
                    )}
                    <img
                      src={msg.imageData}
                      alt={isGif ? "GIF" : "Animated emoji"}
                      className={isGif ? "max-w-full rounded-lg object-cover" : "w-20 h-20 object-contain"}
                      data-testid={isGif ? `chat-gif-${msg.id}` : `chat-emoji-${msg.id}`}
                    />
                    {reactionBadge}
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                      {isMe && (
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: "white" }}
                          data-testid={`msg-status-${msg.id}`}
                        >
                          {msg.status === "queued" ? <><Clock className="w-2.5 h-2.5 inline mr-0.5 opacity-60" />Queued</> : msg.status === "seen" ? "Seen" : msg.status === "delivered" ? "Delivered" : "Sent"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            const isLocationMsg =
              (msg.text?.startsWith("[Location:") || msg.text?.startsWith("[LiveLocation:")) ?? false;
            if (isLocationMsg) {
              const locData = parseLocationMsg(msg.text!);
              const isLive = locData?.isLive ?? false;
              const expired = isLive && locData?.expiresAt ? Date.now() > locData.expiresAt : false;
              const mapsUrl = locData
                ? `https://www.google.com/maps?q=${locData.lat},${locData.lng}`
                : "#";
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"} ${hasReactions ? "mb-3" : ""}`}
                  data-testid={`chat-msg-${msg.id}`}
                >
                  <div className={`relative max-w-[85%] ${isMe ? "mr-1" : "ml-1"}`}>
                    {!isMe && (
                      <span className="text-[10px] text-primary font-semibold mb-0.5 block">{msg.fromName}</span>
                    )}
                    <button
                      className="block rounded-2xl overflow-hidden text-left"
                      style={{
                        width: 220,
                        border: isMe
                          ? "1px solid hsla(215,80%,82%,0.5)"
                          : "1px solid hsla(152,50%,55%,0.3)",
                        boxShadow: isMe
                          ? "0 1px 10px 1px hsla(215,70%,55%,0.25)"
                          : "0 1px 6px 0px hsla(152,55%,45%,0.12)",
                      }}
                      onClick={() => window.open(mapsUrl, "_blank")}
                      {...pressHandlers}
                      data-testid={`chat-location-${msg.id}`}
                    >
                      <div className="relative bg-[#1a2840] overflow-hidden" style={{ height: 110 }}>
                        {locData && (
                          <img
                            src={`https://staticmap.openstreetmap.de/staticmap.php?center=${locData.lat},${locData.lng}&zoom=15&size=220x110&markers=${locData.lat},${locData.lng},lightblue`}
                            alt="Location map"
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="relative flex items-center justify-center">
                            {isLive && !expired && (
                              <div className="absolute w-10 h-10 rounded-full bg-blue-400/30 animate-ping" />
                            )}
                            <div className="w-8 h-8 rounded-full bg-blue-500 border-[2.5px] border-white shadow-lg flex items-center justify-center z-10">
                              <Navigation className="w-3.5 h-3.5 text-white fill-white" />
                            </div>
                          </div>
                        </div>
                        {isLive && (
                          <div className="absolute top-2 left-2">
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white ${expired ? "bg-gray-600/80" : "bg-red-500/90"}`}>
                              {!expired && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                              {expired ? "Expired" : "LIVE"}
                            </div>
                          </div>
                        )}
                      </div>
                      <div
                        className="px-3 py-2"
                        style={{ background: isMe ? "hsl(215 70% 55%)" : "hsl(152 55% 42%)" }}
                      >
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-white/80 flex-shrink-0" />
                          <p className="text-[12px] font-semibold text-white truncate">
                            {locData?.name || "Location"}
                          </p>
                        </div>
                        {isLive && locData?.expiresAt && (
                          <p className="text-[10px] text-white/60 mt-0.5">
                            {expired ? "Location expired" : formatLocationTimeRemaining(locData.expiresAt)}
                          </p>
                        )}
                        <p className="text-[10px] text-white/50 mt-0.5">Tap to open in Maps</p>
                      </div>
                    </button>
                    {reactionBadge}
                    <div className="flex items-center gap-1.5 mt-1 justify-end">
                      <span className="text-[11px] font-medium text-white">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isMe && (
                        <span className="text-[10px] font-semibold text-white">
                          {msg.status === "queued" ? <><Clock className="w-2.5 h-2.5 inline mr-0.5 opacity-60" />Queued</> : msg.status === "seen" ? "Seen" : msg.status === "delivered" ? "Delivered" : "Sent"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            const hasTranslation = !!msg.translatedText && msg.translatedText !== msg.text && !msg.isTranslating;
            const msgVerified = msg.oversightCorrected || verifiedMessages.has(msg.id);

            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"} ${hasReactions ? "mb-3" : ""}`}
                data-testid={`chat-msg-${msg.id}`}
              >
                <div className={`relative max-w-[85%] ${isMe ? "mr-1" : "ml-1"}`}>
                  {!isMe && (
                    <span className="text-[10px] text-primary font-semibold mb-0.5 block">{msg.fromName}</span>
                  )}
                  <div className={`flex items-center gap-1.5 mb-1 ${isMe ? "justify-end" : "justify-start"}`}>
                    {msg.e2ee && (
                      <ShieldCheck className="w-3 h-3 text-emerald-400" data-testid={`msg-e2ee-${msg.id}`} />
                    )}
                    <span className="text-[11px] font-medium text-white">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {msg.edited && (
                      <span className="text-[10px] italic" style={{ color: "rgba(255,255,255,0.5)" }} data-testid={`msg-edited-${msg.id}`}>(edited)</span>
                    )}
                    {isMe && (
                      <span
                        className="text-[10px] font-semibold"
                        style={{ color: "white" }}
                        data-testid={`msg-status-${msg.id}`}
                      >
                        {msg.status === "queued" ? <><Clock className="w-2.5 h-2.5 inline mr-0.5 opacity-60" />Queued</> : msg.status === "seen" ? "Seen" : msg.status === "delivered" ? "Delivered" : "Sent"}
                      </span>
                    )}
                  </div>
                  {msg.replyTo && (
                    <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-0.5`} data-testid={`reply-quote-${msg.id}`}>
                      <div
                        className="flex items-stretch gap-0 rounded-lg overflow-hidden max-w-[75%]"
                        style={{
                          background: isMe ? "hsl(215 70% 35% / 0.5)" : "hsl(152 55% 28% / 0.5)",
                        }}
                      >
                        <div
                          className="w-[3px] flex-shrink-0 rounded-l"
                          style={{ background: isMe ? "hsl(215 70% 65%)" : "hsl(152 55% 55%)" }}
                        />
                        <div className="flex items-start gap-2 px-2.5 py-1.5 min-w-0">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-[11px] text-white/90 mb-0.5">{msg.replyTo.fromName}</p>
                            {msg.replyTo.imageData && !msg.replyTo.videoData ? (
                              <span className="text-white/60 text-[12px]">
                                {msg.replyTo.text === "[GIF]" ? "GIF" : msg.replyTo.text === "[Emoji]" ? "Sticker" : "Photo"}
                              </span>
                            ) : msg.replyTo.videoData ? (
                              <span className="text-white/60 text-[12px]">Video</span>
                            ) : (
                              <p className="text-white/70 line-clamp-1 text-[12px]">{msg.replyTo.text}</p>
                            )}
                          </div>
                          {msg.replyTo.imageData && (
                            <img src={msg.replyTo.imageData} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                          )}
                          {msg.replyTo.videoData && !msg.replyTo.imageData && (
                            <video src={msg.replyTo.videoData} className="w-8 h-8 rounded object-cover flex-shrink-0" muted playsInline />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {hasMedia && !isVoice && !(isVanishMedia && !isRevealed) && (isVanishMedia ? isRevealed : true) ? (
                    <div
                      className="relative rounded-[18px] overflow-hidden"
                      style={{
                        borderRadius: "18px",
                        border: isMe
                          ? "1px solid hsla(215, 80%, 82%, 0.5)"
                          : "1px solid hsla(152, 50%, 55%, 0.3)",
                        boxShadow: isMe
                          ? "0 1px 10px 1px hsla(215, 70%, 55%, 0.25), 0 0 20px 2px hsla(215, 70%, 60%, 0.08)"
                          : "0 1px 6px 0px hsla(152, 55%, 45%, 0.12), 0 0 10px 1px hsla(152, 55%, 50%, 0.04)",
                      }}
                      {...pressHandlers}
                    >
                      {msg.imageData && (
                        <button onClick={() => setViewerImage(msg.imageData!)} className="block" data-testid={`chat-image-${msg.id}`}>
                          <img src={msg.imageData} alt="Shared image" className="max-w-[260px] max-h-[300px] object-cover" style={{ display: "block" }} />
                        </button>
                      )}
                      {msg.isBurningCaptions && !msg.videoData && (
                        <div className="bg-black/40 flex items-center justify-center py-8 px-10" data-testid={`chat-video-burning-${msg.id}`}>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span className="text-white text-xs font-medium">Adding captions...</span>
                          </div>
                        </div>
                      )}
                      {msg.videoData && (
                        <button onClick={() => openVideoViewer(msg.id, msg.videoData!, msg.liveCaptions, msg.hasBurnedCaptions)} className="relative block" data-testid={`chat-video-${msg.id}`}>
                          <video
                            src={msg.videoData}
                            className="max-w-[260px] max-h-[300px] object-cover"
                            style={{ display: "block" }}
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedData={(e) => {
                              const vid = e.currentTarget;
                              vid.currentTime = 0.1;
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                              <Play className="w-5 h-5 text-white ml-0.5" />
                            </div>
                          </div>
                        </button>
                      )}
                      {isVanishMedia && (
                        <div className="absolute bottom-2 left-2">
                          <p className="text-[10px] text-white/70 flex items-center gap-1 bg-black/40 rounded-full px-2 py-0.5">
                            <EyeOff className="w-3 h-3" /> Vanish
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                  <div
                    className="relative px-3.5 py-2.5 text-[16px] leading-snug font-medium"
                    style={{
                      background: isMe
                        ? "hsl(215 70% 55%)"
                        : "hsl(152 55% 42%)",
                      color: "white",
                      borderRadius: isMe ? "18px 18px 18px 18px" : "18px 18px 18px 18px",
                      border: isMe
                        ? "1px solid hsla(215, 80%, 82%, 0.5)"
                        : "1px solid hsla(152, 50%, 55%, 0.3)",
                      boxShadow: isMe
                        ? "0 1px 10px 1px hsla(215, 70%, 55%, 0.25), 0 0 20px 2px hsla(215, 70%, 60%, 0.08)"
                        : "0 1px 6px 0px hsla(152, 55%, 45%, 0.12), 0 0 10px 1px hsla(152, 55%, 50%, 0.04)",
                    }}
                    {...pressHandlers}
                  >
                    {hasMedia && isVanishMedia && !isRevealed ? (
                      <button
                        onClick={() => handleVanishReveal(msg.id)}
                        className="block w-full"
                        data-testid={`button-reveal-media-${msg.id}`}
                      >
                        {msg.videoData ? (
                          <div className="flex flex-col items-center gap-1.5 py-2 px-2">
                            <img src={logoImg} alt="JunoTalk" className="w-10 h-10 rounded-lg object-contain" />
                            <p className="text-xs font-semibold tracking-wide text-white">Vanish Video</p>
                            <p className="text-[10px] text-white/60">{t("room.videoOff")}</p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-1">
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/20">
                              <ImageIcon className="h-7 w-7 text-white" />
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium text-white">Vanish Photo</p>
                              <p className="text-[11px] text-white/60">{t("room.videoOff")}</p>
                            </div>
                          </div>
                        )}
                      </button>
                    ) : isVoice && msg.audioData ? (
                      <VoiceBubble
                        audioUrl={msg.audioData}
                        isMine={isMe}
                        timestamp={new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        transcription={msg.transcription}
                        transcriptionTranslated={msg.transcriptionTranslated}
                        isTranscriptionTranslating={msg.isTranscriptionTranslating}
                        transcriptionFeedback={msg.transcriptionFeedback}
                        onTranscriptFeedback={(useful) => {
                          setMessages(prev => prev.map(m =>
                            m.id === msg.id ? { ...m, transcriptionFeedback: useful ? "useful" : "not_useful" } : m
                          ));
                        }}
                      />
                    ) : null}
                    {isTranslatableText(msg.text) && (
                      msg.translatedText && msg.translatedText !== msg.text ? (
                        <div data-testid={`msg-translated-${msg.id}`}>
                          <span>{msg.text}</span>
                          <p
                            className="text-[13px] italic mt-1"
                            style={{ color: "rgba(255,255,255,0.72)" }}
                            data-testid={`msg-translation-text-${msg.id}`}
                          >
                            {msg.translatedText}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span>{msg.text}</span>
                          {msg.translationFailed && !msg.isTranslating && !isMe && (
                            <div
                              className="flex items-center gap-1 mt-1 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); handleRetryTranslation(msg); }}
                              data-testid={`retry-translation-${msg.id}`}
                            >
                              <RefreshCw className="h-3 w-3" style={{ color: "#f97316" }} />
                              <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                                Tap to retry translation
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    )}
                    {msg.text === "[Image]" && !hasMedia && (
                      <span className={`text-xs font-semibold ${isMe ? "text-primary-foreground" : "text-foreground"}`}>Image</span>
                    )}
                    {msg.text === "[Video]" && !hasMedia && (
                      <span className={`text-xs font-semibold ${isMe ? "text-primary-foreground" : "text-foreground"}`}>Video</span>
                    )}
                    {msg.isTranslating && (
                      <div
                        className="flex items-center gap-1.5 mt-1"
                        data-testid={`translating-${msg.id}`}
                      >
                        <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#fff44f" }} />
                        <p className="text-[10px] animate-pulse text-white/70">
                          {t("room.translating")}
                        </p>
                      </div>
                    )}
                  </div>
                  )}
                  {hasTranslation && msgVerified && (
                    <span
                      data-testid={`msg-verification-${msg.id}`}
                      className={`absolute bottom-0 ${isMe ? "-left-5" : "-right-5"} flex items-center`}
                      style={{ zIndex: 1 }}
                    >
                      <CheckCheck className="h-4 w-4" style={{ color: "#22c55e" } as any} data-testid={`verified-check-${msg.id}`} aria-label="Translation verified" />
                    </span>
                  )}
                  {reactionBadge}
                </div>
              </div>
            );
          })
        )}
        {typingUsers.size > 0 && (
          <div
            className="flex justify-start py-1"
            data-testid="typing-indicator"
            style={{ animation: "typingSlideIn 0.25s ease-out forwards" }}
          >
            <div className="ml-1 max-w-[85%]">
              <span className="text-[10px] text-primary font-semibold mb-0.5 block">
                {Array.from(typingUsers.values()).map(u => u.name).join(", ")}
              </span>
              <div className="flex items-end gap-2">
                <div
                  className="relative px-4 py-3 rounded-[18px] rounded-bl-[6px]"
                  style={{
                    background: "linear-gradient(180deg, hsl(215 18% 38%) 0%, hsl(216 18% 34%) 50%, hsl(218 18% 30%) 100%)",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -1px 2px rgba(0,0,0,0.06), 0 1px 6px rgba(0,0,0,0.15)",
                  }}
                >
                  <div
                    className="absolute bottom-0 -left-1 w-2.5 h-2.5"
                    style={{
                      clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
                      background: "hsl(218 18% 30%)",
                    }}
                  />
                  <div className="flex items-center justify-center" style={{ gap: "5px", padding: "2px 0" }}>
                    <img
                      src={logoImg}
                      alt=""
                      style={{
                        width: "22px",
                        height: "22px",
                        objectFit: "contain",
                        animation: "junotalkPulse 1.8s cubic-bezier(.4,0,.2,1) infinite",
                      }}
                      data-testid="typing-logo-1"
                    />
                    <img
                      src={logoImg}
                      alt=""
                      style={{
                        width: "22px",
                        height: "22px",
                        objectFit: "contain",
                        animation: "junotalkPulse 1.8s cubic-bezier(.4,0,.2,1) infinite",
                        animationDelay: "0.25s",
                      }}
                      data-testid="typing-logo-2"
                    />
                    <img
                      src={logoImg}
                      alt=""
                      style={{
                        width: "22px",
                        height: "22px",
                        objectFit: "contain",
                        animation: "junotalkPulse 1.8s cubic-bezier(.4,0,.2,1) infinite",
                        animationDelay: "0.5s",
                      }}
                      data-testid="typing-logo-3"
                    />
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground italic pb-0.5" data-testid="text-typing-name">
                  {t("room.isTyping")}
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
        </div>
      </div>

      {actionMenuMsg && (
        <SectionBoundary label="Message Actions">
        <div
          className="fixed inset-0 z-[90]"
          onClick={() => { setActionMenuMsg(null); setShowExpandedReactions(false); }}
          data-testid="action-menu-overlay"
        >
          <div
            className="fixed flex flex-col items-center z-[91]"
            style={{
              left: "50%",
              transform: "translateX(-50%)",
              top: Math.min(Math.max(60, actionMenuPos.y - 30), window.innerHeight - (showExpandedReactions ? 500 : 320)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center rounded-full shadow-lg"
              style={{
                background: "linear-gradient(135deg, #1a2332 0%, #162030 100%)",
                border: "1.5px solid rgba(80, 180, 255, 0.7)",
                boxShadow: "0 0 18px rgba(80, 180, 255, 0.35), 0 0 6px rgba(80, 180, 255, 0.25), inset 0 0 8px rgba(80, 180, 255, 0.05), 0 4px 16px rgba(0, 0, 0, 0.4)",
              }}
              data-testid="emoji-reaction-bar"
            >
              <div className="flex items-center gap-0.5 px-2 py-1.5">
                {QUICK_EMOJIS.map(({ key, label }) => (
                  <button
                    key={key}
                    className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-[20px] active:scale-125 transition-transform hover:bg-white/10"
                    onClick={() => handleReaction(actionMenuMsg.id, key)}
                    data-testid={`emoji-react-${key}`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-[18px] active:scale-110 transition-transform"
                  style={{ border: "1.5px solid rgba(80, 180, 255, 0.6)" }}
                  onClick={() => setShowExpandedReactions(prev => !prev)}
                  data-testid="emoji-react-expand"
                >
                  <Plus className="w-4 h-4 text-[rgba(200,220,255,0.7)]" />
                </button>
              </div>
            </div>
            {showExpandedReactions && (
              <div
                className="rounded-2xl shadow-lg p-2.5 overflow-y-auto no-scrollbar"
                style={{
                  background: "linear-gradient(135deg, #1a2332 0%, #162030 100%)",
                  border: "1.5px solid rgba(80, 180, 255, 0.7)",
                  boxShadow: "0 0 18px rgba(80, 180, 255, 0.35), 0 0 6px rgba(80, 180, 255, 0.25), inset 0 0 8px rgba(80, 180, 255, 0.05), 0 4px 16px rgba(0, 0, 0, 0.4)",
                  maxWidth: "min(90vw, 340px)",
                  maxHeight: "260px",
                }}
                data-testid="emoji-reaction-expanded"
              >
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJI_LIST.map(({ key, label }) => (
                    <button
                      key={key}
                      className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-[20px] active:scale-125 transition-transform hover:bg-white/10"
                      onClick={() => {
                        handleReaction(actionMenuMsg.id, key);
                        setShowExpandedReactions(false);
                      }}
                      data-testid={`emoji-expand-${key}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-center" style={{ marginTop: "4px" }}>
              <svg width="20" height="10" viewBox="0 0 20 10">
                <path d="M0 0 L10 10 L20 0" fill="#1a2332" stroke="rgba(80, 180, 255, 0.7)" strokeWidth="1.5" />
              </svg>
            </div>
            <div
              className="rounded-full shadow-lg"
              style={{
                background: "linear-gradient(135deg, #1a2332 0%, #162030 100%)",
                border: "1.5px solid rgba(80, 180, 255, 0.7)",
                boxShadow: "0 0 18px rgba(80, 180, 255, 0.35), 0 0 6px rgba(80, 180, 255, 0.25), inset 0 0 8px rgba(80, 180, 255, 0.05), 0 4px 16px rgba(0, 0, 0, 0.4)",
                marginTop: "2px",
              }}
              data-testid="action-menu"
            >
              <div className="flex items-stretch px-2 py-1.5">
                <button
                  className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[48px] active:bg-white/10 rounded-lg transition-colors"
                  onClick={() => handleReplyAction(actionMenuMsg)}
                  data-testid="action-reply"
                >
                  <Reply className="w-5 h-5 text-[rgba(200,220,255,0.9)]" />
                  <span className="text-[10px] font-semibold text-[rgba(200,220,255,0.9)]">Reply</span>
                </button>
                <div className="w-px self-stretch my-1.5" style={{ background: "rgba(80, 180, 255, 0.3)" }} />
                <button
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[48px] rounded-lg transition-colors ${canEditMessage(actionMenuMsg) ? "active:bg-white/10" : "opacity-35"}`}
                  onClick={() => { if (canEditMessage(actionMenuMsg)) handleEditMessage(actionMenuMsg); }}
                  data-testid="action-edit"
                >
                  <Pencil className="w-5 h-5 text-[rgba(200,220,255,0.9)]" />
                  <span className="text-[10px] font-semibold text-[rgba(200,220,255,0.9)]">Edit</span>
                </button>
                <div className="w-px self-stretch my-1.5" style={{ background: "rgba(80, 180, 255, 0.3)" }} />
                <button
                  className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[48px] active:bg-white/10 rounded-lg transition-colors"
                  onClick={() => {
                    const copyText = actionMenuMsg.translatedText
                      ? `${actionMenuMsg.translatedText}\n(${actionMenuMsg.text})`
                      : actionMenuMsg.text;
                    if (copyText) {
                      navigator.clipboard.writeText(copyText).then(() => {
                        toast({ title: "Copied to clipboard" });
                      });
                    }
                    setActionMenuMsg(null);
                  }}
                  data-testid="action-copy"
                >
                  <Copy className="w-5 h-5 text-[rgba(200,220,255,0.9)]" />
                  <span className="text-[10px] font-semibold text-[rgba(200,220,255,0.9)]">Copy</span>
                </button>
                <div className="w-px self-stretch my-1.5" style={{ background: "rgba(80, 180, 255, 0.3)" }} />
                <button
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[48px] rounded-lg transition-colors ${isTranslatableText(actionMenuMsg.text) ? "active:bg-white/10" : "opacity-35"}`}
                  onClick={() => { if (isTranslatableText(actionMenuMsg.text)) handleTranslateAction(actionMenuMsg); }}
                  data-testid="action-translate"
                >
                  <Languages className="w-5 h-5 text-[rgba(100,180,255,1)]" />
                  <span className="text-[10px] font-semibold text-[rgba(100,180,255,1)]">{t("room.translate") || "Translate"}</span>
                </button>
                <div className="w-px self-stretch my-1.5" style={{ background: "rgba(80, 180, 255, 0.3)" }} />
                <button
                  className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[48px] active:bg-white/10 rounded-lg transition-colors"
                  onClick={() => handleDeleteAction(actionMenuMsg)}
                  data-testid="action-delete"
                >
                  <Trash2 className="w-5 h-5 text-red-400" />
                  <span className="text-[10px] font-semibold text-red-400">{t("room.deleteMessage")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </SectionBoundary>
      )}

      <div className="border-t bg-background px-3 py-1 pb-safe">
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          ref={mediaInputRef}
          onChange={handleMediaPick}
          data-testid="input-media-file"
        />

        {replyingTo && !editingMsg && (
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1 bg-muted/50 rounded-lg border-l-2 border-primary" data-testid="reply-bar">
            {replyingTo.imageData && (
              <img src={replyingTo.imageData} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
            )}
            {replyingTo.videoData && !replyingTo.imageData && (
              <video src={replyingTo.videoData} className="w-9 h-9 rounded-md object-cover flex-shrink-0" muted playsInline />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-primary">{replyingTo.fromName}</p>
              <p className="text-[12px] text-muted-foreground truncate">
                {replyingTo.imageData ? (replyingTo.text === "[GIF]" ? "GIF" : replyingTo.text === "[Emoji]" ? "Sticker" : "Photo") : replyingTo.videoData ? "Video" : replyingTo.text}
              </p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1 text-muted-foreground" data-testid="button-cancel-reply">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {editingMsg && (
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1 bg-blue-500/10 rounded-lg border-l-2 border-blue-500" data-testid="edit-bar">
            <Pencil className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-blue-400">Editing message</p>
              <p className="text-[12px] text-muted-foreground truncate">{editingMsg.text}</p>
            </div>
            <button onClick={() => { setEditingMsg(null); setMessageInput(""); }} className="p-1 text-muted-foreground" data-testid="button-cancel-edit">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!isRecording && (
          <div className="flex items-center gap-2 py-1 px-1">
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              className="p-1.5 rounded-md hover-elevate text-blue-400 hover:text-blue-300"
              data-testid="button-send-media"
            >
              <ImageIcon className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="p-1.5 rounded-md hover-elevate text-blue-400 hover:text-blue-300"
              data-testid="button-camera"
            >
              <Camera className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => setShowLocationSheet(true)}
              className="p-1.5 rounded-md hover-elevate text-blue-400 hover:text-blue-300"
              data-testid="button-share-location"
            >
              <MapPin className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1.5 rounded-md hover-elevate text-blue-400 hover:text-blue-300"
              data-testid="button-ai-emoji"
            >
              <EmojiPickerIcon className="h-7 w-7" />
            </button>
            <div className="flex-1" />
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setVanishMode(v => !v);
                  setShowVanishHint(false);
                }}
                className={`p-1.5 rounded-md flex items-center gap-1 text-xs font-medium transition-colors ${
                  vanishMode ? "text-amber-600 dark:text-amber-500 bg-amber-600/8" : "text-muted-foreground"
                }`}
                data-testid="button-vanish-toggle"
              >
                {vanishMode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                <span className="text-[10px]">{vanishMode ? "Vanish ON" : "Vanish"}</span>
              </button>
              {showVanishHint && (
                <div className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap bg-foreground text-background text-[10px] font-medium px-2 py-1 rounded-md shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <ImageIcon className="w-3 h-3 inline mr-1" />
                  turn on for image and/video
                </div>
              )}
            </div>
          </div>
        )}
        {isRecording ? (
          <div
            className="flex items-center gap-2 pb-1 animate-in fade-in duration-200 select-none"
            data-testid="voice-recording-bar"
          >
            <button
              type="button"
              onClick={cancelRecording}
              className="p-2 rounded-full text-destructive"
              data-testid="button-cancel-recording"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full bg-destructive/10 dark:bg-destructive/15">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
              </span>
              <span className="text-sm font-medium tabular-nums text-destructive" data-testid="text-recording-timer">
                {Math.floor(recordingDuration / 60).toString().padStart(2, "0")}:{(recordingDuration % 60).toString().padStart(2, "0")}
              </span>
              <div className="flex-1 flex items-center justify-center gap-[3px]" data-testid="voice-waveform">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-destructive/60"
                    style={{
                      height: `${8 + Math.sin((recordingDuration * 3 + i) * 0.7) * 6 + Math.random() * 8}px`,
                      transition: "height 0.15s ease",
                    }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("room.releaseToSend")}</span>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="p-2.5 rounded-full bg-primary text-primary-foreground shadow-md"
              data-testid="button-send-recording"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); editingMsg ? submitEditMessage() : sendMessage(); }}
            className="flex items-center gap-2 pb-1"
          >
            <Input
              value={messageInput}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={editingMsg ? "Edit your message..." : t("room.messagePlaceholder")}
              className="flex-1 border-blue-500/30 focus:border-blue-500/50"
              autoComplete="off"
              autoCorrect="on"
              enterKeyHint="send"
              inputMode="text"
              data-testid="input-chat-message"
            />
            {messageInput.trim() ? (
              <Button
                type="submit"
                size="icon"
                data-testid={editingMsg ? "button-confirm-edit" : "button-send-message"}
                className={editingMsg ? "bg-blue-500 hover:bg-blue-600" : undefined}
              >
                {editingMsg ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </Button>
            ) : (
              <button
                type="button"
                onTouchStart={handleMicDown}
                onTouchEnd={handleMicUp}
                onTouchCancel={handleMicCancel}
                onMouseDown={handleMicDown}
                onMouseUp={handleMicUp}
                onMouseLeave={handleMicCancel}
                onContextMenu={(e) => e.preventDefault()}
                className={`flex items-center justify-center w-11 h-11 rounded-full text-white shadow-md select-none touch-none transition-colors ${
                  isRecording
                    ? "bg-destructive animate-pulse"
                    : "bg-blue-500 dark:bg-blue-500"
                }`}
                data-testid="button-start-recording"
              >
                <Mic className="w-6 h-6" />
              </button>
            )}
          </form>
        )}
      </div>

      {viewerImage && (
        <SectionBoundary label="Image Viewer">
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setViewerImage(null)}
          data-testid="viewer-image-overlay"
        >
          <img src={viewerImage} alt="Full view" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" data-testid="viewer-image-full" />
          <p className="absolute bottom-8 text-white/50 text-xs">{t("common.close")}</p>
        </div>
        </SectionBoundary>
      )}

      {viewerVideo && (
        <SectionBoundary label="Video Viewer">
        <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="viewer-video-overlay">
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-black/80 z-10">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="text-white no-default-hover-elevate"
                onClick={closeVideoViewer}
                data-testid="button-close-video-viewer"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <p className="text-white text-sm font-medium">Video</p>
            </div>
            <div className="flex items-center gap-1">
              {videoCaptionStatus !== "idle" && videoCaptionStatus !== "done" && videoCaptionStatus !== "no-speech" && videoCaptionStatus !== "error" && (
                <div className="flex items-center gap-2 mr-2" data-testid="caption-loading-indicator">
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span className="text-white/60 text-xs">
                    {videoCaptionStatus === "extracting" && t("room.connecting")}
                    {videoCaptionStatus === "transcribing" && t("room.captions")}
                    {videoCaptionStatus === "translating" && t("room.translating")}
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-white no-default-hover-elevate"
                onClick={handleViewerDownload}
                data-testid="button-viewer-download"
              >
                <Download className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white no-default-hover-elevate"
                onClick={handleViewerShare}
                data-testid="button-viewer-share"
              >
                <Share2 className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex items-end justify-center relative" onClick={handleViewerPlayPause}>
            <video
              ref={videoRef}
              src={viewerVideo}
              className="w-full h-full object-contain"
              playsInline
              controls={false}
              onPlay={() => setViewerPlaying(true)}
              onPause={() => setViewerPlaying(false)}
              onEnded={() => {
                setViewerPlaying(false);
                setViewerProgress(viewerDuration);
              }}
              onLoadedMetadata={(e) => {
                setViewerDuration(e.currentTarget.duration);
              }}
              onTimeUpdate={(e) => {
                setViewerProgress(e.currentTarget.currentTime);
                if (!viewerHasBurnedCaptions && videoCaptions.length > 0) {
                  const currentMs = e.currentTarget.currentTime * 1000;
                  const segment = videoCaptions.find(
                    (s) => currentMs >= s.start && currentMs <= s.end
                  );
                  setActiveCaption(segment?.text || "");
                }
              }}
              data-testid="viewer-video-full"
            />

            {!viewerPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingTop: "10%" }}>
                <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                  <Play className="w-8 h-8 text-white ml-1" />
                </div>
              </div>
            )}

            {!viewerHasBurnedCaptions && activeCaption && (
              <div
                className="absolute bottom-2 left-4 right-4 flex justify-center pointer-events-none"
                data-testid="video-caption-overlay"
              >
                <div className="bg-black/75 backdrop-blur-sm rounded-md px-4 py-2 max-w-[90%]">
                  <p className="text-white text-sm font-medium text-center leading-snug">
                    {activeCaption}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 pb-5 pt-3 bg-black/80 space-y-3">
            {viewerDuration > 0 && (
              <div className="flex items-center gap-3" data-testid="viewer-progress-bar">
                <span className="text-white/60 text-xs tabular-nums w-10 text-right">
                  {Math.floor(viewerProgress / 60)}:{Math.floor(viewerProgress % 60).toString().padStart(2, "0")}
                </span>
                <div
                  className="flex-1 h-1 bg-white/20 rounded-full relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!videoRef.current || !viewerDuration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    videoRef.current.currentTime = pct * viewerDuration;
                  }}
                >
                  <div
                    className="absolute top-0 left-0 h-full bg-primary rounded-full"
                    style={{ width: `${viewerDuration > 0 ? (viewerProgress / viewerDuration) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-white/60 text-xs tabular-nums w-10">
                  {Math.floor(viewerDuration / 60)}:{Math.floor(viewerDuration % 60).toString().padStart(2, "0")}
                </span>
              </div>
            )}

            <div className="text-center">
              {viewerHasBurnedCaptions ? (
                <p className="text-white/50 text-xs" data-testid="caption-burned-info">
                  {t("room.captionsOn")} - {t("room.translatedText")} {LANGUAGES.find(l => l.code === chatLanguage)?.name || chatLanguage}
                </p>
              ) : videoCaptionStatus === "no-speech" ? (
                <p className="text-white/50 text-xs" data-testid="caption-no-speech">{t("room.captionsOff")}</p>
              ) : videoCaptionStatus === "error" ? (
                <p className="text-white/50 text-xs" data-testid="caption-error">{t("room.captionsOff")}</p>
              ) : videoCaptionStatus === "done" && videoCaptions.length > 0 ? (
                <p className="text-white/50 text-xs" data-testid="caption-active">
                  {t("room.captionsOn")} {chatLanguage !== "en" ? `- ${t("room.translatedText")} ${LANGUAGES.find(l => l.code === chatLanguage)?.name || chatLanguage}` : ""}
                </p>
              ) : (
                <p className="text-white/50 text-xs">{t("room.videoOn")}</p>
              )}
            </div>
          </div>
        </div>
        </SectionBoundary>
      )}

      {showEmojiPicker && (
        <SectionBoundary label="Emoji Picker">
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-end justify-center" data-testid="emoji-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowEmojiPicker(false); }}>
          <div className="w-full max-w-md bg-background rounded-t-2xl p-3 pb-5 animate-in slide-in-from-bottom duration-300" style={{ maxHeight: "60vh", touchAction: "auto" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <EmojiPickerIcon className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm text-foreground">
                  {pickerTab === "stickers" ? "Stickers" : "GIFs"}
                </h3>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowEmojiPicker(false)} data-testid="button-close-emoji-picker">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-1 mb-2">
              <Button
                variant={pickerTab === "stickers" ? "default" : "outline"}
                size="sm"
                className="text-xs flex-1"
                onClick={() => setPickerTab("stickers")}
                data-testid="picker-tab-stickers"
              >
                Stickers
              </Button>
              <Button
                variant={pickerTab === "gifs" ? "default" : "outline"}
                size="sm"
                className="text-xs flex-1"
                onClick={() => setPickerTab("gifs")}
                data-testid="picker-tab-gifs"
              >
                GIFs
              </Button>
            </div>

            {pickerTab === "stickers" ? (
              <>
                <div className="flex gap-1 mb-2 overflow-x-auto pb-1 flex-nowrap" style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}>
                  {[
                    { id: "smileys", label: "😊 Faces" },
                    { id: "gestures", label: "👋 Hands" },
                    { id: "people", label: "🧑 People" },
                    { id: "animals", label: "🐾 Animals" },
                    { id: "food", label: "🍕 Food" },
                    { id: "activity", label: "⚽ Fun" },
                    { id: "objects", label: "🚀 Objects" },
                    { id: "symbols", label: "❤️ Symbols" },
                    { id: "flags", label: "🏁 Flags" },
                  ].map(cat => (
                    <Button
                      key={cat.id}
                      variant={emojiCategory === cat.id ? "default" : "ghost"}
                      size="sm"
                      className="text-xs whitespace-nowrap flex-shrink-0"
                      onClick={() => setEmojiCategory(cat.id)}
                      data-testid={`emoji-cat-${cat.id}`}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1 overflow-y-auto" style={{ maxHeight: "35vh", touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
                  {(ANIMATED_EMOJIS[emojiCategory] || []).map((code: string) => (
                    <button
                      key={code}
                      className="p-1.5 rounded-lg hover-elevate flex items-center justify-center"
                      onClick={() => sendAnimatedEmoji(code)}
                      data-testid={`emoji-${code}`}
                    >
                      <img
                        src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.gif`}
                        alt="emoji"
                        className="w-12 h-12"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-2">
                  <Input
                    value={gifSearch}
                    onChange={(e) => handleGifSearchChange(e.target.value)}
                    placeholder="Search GIFs..."
                    className="text-sm"
                    data-testid="input-gif-search"
                  />
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: "38vh" }}>
                  {gifLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : gifResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm">
                      <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
                      <p>{gifSearch ? "No GIFs found" : "Search for GIFs"}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {gifResults.map((gif) => (
                        <button
                          key={gif.id}
                          className="rounded-lg overflow-visible hover-elevate"
                          onClick={() => sendGif(gif.url)}
                          data-testid={`gif-${gif.id}`}
                        >
                          <img
                            src={gif.preview || gif.url}
                            alt={gif.title}
                            className="w-full rounded-lg object-cover"
                            style={{ aspectRatio: `${gif.width}/${gif.height}` }}
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground text-center mt-2 opacity-60">Powered by GIPHY</p>
                </div>
              </>
            )}
          </div>
        </div>
        </SectionBoundary>
      )}

      {showCamera && (
        <SectionBoundary label="Camera">
        <CameraModal
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
        </SectionBoundary>
      )}

      {showLocationSheet && (
        <LocationShareSheet
          onShare={sendLocationMessage}
          onClose={() => setShowLocationSheet(false)}
        />
      )}
    </div>
  );
}
