import { STORAGE_KEYS } from "@/lib/storage-keys";
import { buildAudioProcessor, AUDIO_CONSTRAINTS } from "@/lib/audio-processor";
import { enqueue, drainQueue, blobToBase64, base64ToBlob } from "@/lib/offline-queue";
import { safeDisplayName } from "@/lib/utils";
import { useI18n } from "@/lib/i18n.jsx";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useRingtone } from "@/hooks/use-ringtone";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import BackTriangle from "@/components/BackTriangle";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
  PhoneOff,
  Copy,
  Check,
  Languages,
  MessageCircle,
  MessageSquare,
  Send,
  X,
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  Settings,
  Users,
  Subtitles,
  Monitor,
  ChevronRight,
  WifiOff,
  RefreshCw,
  ShieldCheck,
  Shield,
  Sparkles,
  FileText,
  ListChecks,
  Loader2,
  ClipboardCopy,
  AlertTriangle,
  CameraOff,
  Speaker,
  Volume2,
  Phone,
  Zap,
  Headphones
} from "lucide-react";
import type { Room, RoomMember } from "@shared/schema";
import type { User } from "@shared/models/auth";
import { useToast } from "@/hooks/use-toast";

declare global {
  interface Window {
    JitsiMeetExternalAPI: any;
  }
}

import { LANGUAGES } from "@/lib/languages";

type Caption = {
  id: string;
  speaker: "you" | "them";
  original: string;
  translated: string;
  isTranslating?: boolean;
  timestamp: number;
};

type ChatMessage = {
  id: string;
  sender: "you" | "them";
  text: string;
  translatedText?: string;
  isTranslating?: boolean;
  timestamp: number;
};

type RoomWithHost = Room & { host: User };

export default function RoomCall() {
  const [, params] = useRoute("/room/:code/call");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const roomCode = params?.code?.toUpperCase();
  const { toast } = useToast();
  const { t } = useI18n();

  // Fetch user's saved language preference
  const { data: userPrefs } = useQuery<{ subtitleLanguage?: string; spokenLanguage?: string }>({
    queryKey: ["/api/preferences"],
    enabled: !!user,
  });

  const [subtitleLanguage, setSubtitleLanguage] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "en";
    } catch { return "en"; }
  });
  
  // Sync subtitle language from saved preferences on load
  useEffect(() => {
    if (userPrefs?.subtitleLanguage && userPrefs.subtitleLanguage !== subtitleLanguage) {
      setSubtitleLanguage(userPrefs.subtitleLanguage);
      try { localStorage.setItem(STORAGE_KEYS.subtitleLang, userPrefs.subtitleLanguage); } catch {}
    }
  }, [userPrefs]);

  // Handle language change and save to backend
  const handleLanguageChange = useCallback(async (lang: string) => {
    setSubtitleLanguage(lang);
    try { localStorage.setItem(STORAGE_KEYS.subtitleLang, lang); } catch {}
    const langName = LANGUAGES.find(l => l.code === lang)?.name || lang;
    try {
      await apiRequest("PATCH", "/api/preferences", { subtitleLanguage: lang });
      toast({
        title: t("common.success"),
        description: `${t("settings.subtitleLanguage")}: ${langName}`,
      });
    } catch (e) {
      console.error("Failed to save language preference:", e);
      toast({
        title: t("common.success"),
        description: `${t("room.translate")}: ${langName}`,
      });
    }
  }, [toast]);

  const [captions, setCaptions] = useState<Caption[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [displaySize, setDisplaySize] = useState<"normal" | "large" | "fullscreen">("normal");
  const [jitsiLoaded, setJitsiLoaded] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  useWakeLock(isInCall);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [jitsiError, setJitsiError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [wsConnected, setWsConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionQuality, setConnectionQuality] = useState<"good" | "fair" | "poor" | "connecting" | "reconnecting">("connecting");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [callTimeoutActive, setCallTimeoutActive] = useState(false);
  const [callTimeoutSeconds, setCallTimeoutSeconds] = useState(30);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callTimeoutIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const [networkStats, setNetworkStats] = useState<{ bitrate: number; packetLoss: number; resolution: string } | null>(null);
  const qualityDegradeRef = useRef(false);
  const [e2eVerified, setE2eVerified] = useState(false);
  const [e2eVerifying, setE2eVerifying] = useState(false);
  const [e2eSafetyNumber, setE2eSafetyNumber] = useState<string>("");
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [joinTimedOut, setJoinTimedOut] = useState(false);
  const [aiCaptionEnhance, setAiCaptionEnhance] = useState(true);
  const [showCallSummary, setShowCallSummary] = useState(false);
  const [callSummaryLoading, setCallSummaryLoading] = useState(false);
  const [callSummaryData, setCallSummaryData] = useState<{
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    duration: string;
    mood: string;
  } | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const endingCallRef = useRef(false);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (summaryAbortRef.current) {
        summaryAbortRef.current.abort();
      }
    };
  }, []);

  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const jitsiApiRef = useRef<any>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const captionContainerRef = useRef<HTMLDivElement>(null);
  const subtitleLanguageRef = useRef((() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.subtitleLang) || "en";
    } catch { return "en"; }
  })());
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsReconnectDelayRef = useRef(1000);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsCancelledRef = useRef(false);
  const jitsiRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpeechActiveRef = useRef<number>(Date.now());
  const translationInFlightRef = useRef<number>(0);
  const MAX_CONCURRENT_TRANSLATIONS = 3;
  const e2eKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const e2eChallengeRef = useRef<string | null>(null);
  const e2eSharedKeyRef = useRef<CryptoKey | null>(null);
  const e2eChainKeyRef = useRef<CryptoKey | null>(null);
  const e2eMsgCounterRef = useRef<number>(0);
  const e2ePeerCounterRef = useRef<number>(0);
  const initiateE2eWithRetryRef = useRef<(maxAttempts?: number) => void>(() => {});
  const whisperRecorderRef = useRef<MediaRecorder | null>(null);
  const whisperStreamRef = useRef<MediaStream | null>(null);
  const whisperProcDisposeRef = useRef<(() => void) | null>(null);
  const whisperIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [useWhisperFallback, setUseWhisperFallback] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState<"camera" | "mic" | "both" | null>(null);
  const [networkOffline, setNetworkOffline] = useState(!navigator.onLine);
  const [bufferedCaptionCount, setBufferedCaptionCount] = useState(0);
  const addCaptionRef = useRef<((text: string, speaker: "you" | "them") => void) | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>("");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>("");
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>("");
  const [lowDataMode, setLowDataMode] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.lowData) === "true"; } catch { return false; }
  });
  const [voiceOnlyMode, setVoiceOnlyMode] = useState(false);
  const [audioPriorityActive, setAudioPriorityActive] = useState(false);
  const lastRoomCodeRef = useRef<string | null>(null);
  const voiceOnlyRef = useRef(false);
  const lowDataRef = useRef(false);
  const audioPriorityRef = useRef(false);
  
  // Keep refs in sync with state
  useEffect(() => {
    subtitleLanguageRef.current = subtitleLanguage;
  }, [subtitleLanguage]);
  useEffect(() => { voiceOnlyRef.current = voiceOnlyMode; }, [voiceOnlyMode]);
  useEffect(() => { lowDataRef.current = lowDataMode; }, [lowDataMode]);
  useEffect(() => { audioPriorityRef.current = audioPriorityActive; }, [audioPriorityActive]);

  // Handle fullscreen exit
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displaySize === "fullscreen") {
        setDisplaySize("normal");
      }
    };
    
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [displaySize]);
  
  const [codeCopied, setCodeCopied] = useState(false);
  
  const { data: roomData, isLoading: loadingRoom, error: roomError } = useQuery<RoomWithHost>({
    queryKey: ["/api/rooms", roomCode],
    enabled: !!roomCode,
  });

  const { data: roomMembersList = [] } = useQuery<(RoomMember & { user?: User })[]>({
    queryKey: ["/api/room-members", roomCode],
    enabled: !!roomCode,
    refetchInterval: 60000,
  });
  const otherRoomMembers = roomMembersList.filter(m => m.userId !== user?.id && m.isActive);

  const copyRoomCode = useCallback(() => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCodeCopied(true);
      toast({ title: t("room.codeCopied") });
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }, [roomCode, toast]);

  const translateText = useCallback(async (text: string, targetLang: string): Promise<string> => {
    try {
      const response = await fetch("/api/v1/caption-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, targetLang, sourceLang: "en" }),
      });
      if (!response.ok) {
        console.warn("[CaptionTranslate] Request failed:", response.status);
        return text;
      }
      const data = await response.json();
      return data.translatedText || text;
    } catch (e) {
      console.warn("[CaptionTranslate] Error:", e);
      return text;
    }
  }, []);

  const deriveHkdfKeys = useCallback(async (rawSharedSecret: ArrayBuffer, myPubKey: ArrayBuffer, peerPubKey: ArrayBuffer) => {
    const salt = new Uint8Array(32);
    const myPub = new Uint8Array(myPubKey);
    const peerPub = new Uint8Array(peerPubKey);
    for (let i = 0; i < 32; i++) {
      salt[i] = (myPub[i % myPub.length] ^ peerPub[i % peerPub.length]);
    }
    const ikm = await crypto.subtle.importKey("raw", rawSharedSecret, "HKDF", false, ["deriveKey", "deriveBits"]);
    const info = new TextEncoder().encode("junotalk-e2e-v2");
    const rootKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info },
      ikm,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const chainInfo = new TextEncoder().encode("junotalk-chain-v2");
    const chainKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: chainInfo },
      ikm,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    return { rootKey, chainKey };
  }, []);

  const generateSafetyNumber = useCallback(async (myPubKey: ArrayBuffer, peerPubKey: ArrayBuffer) => {
    const combined = new Uint8Array(myPubKey.byteLength + peerPubKey.byteLength);
    const sorted = [new Uint8Array(myPubKey), new Uint8Array(peerPubKey)]
      .sort((a, b) => {
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return a[i] - b[i];
        }
        return 0;
      });
    combined.set(sorted[0], 0);
    combined.set(sorted[1], sorted[0].length);
    const hash = await crypto.subtle.digest("SHA-256", combined);
    const hashArr = new Uint8Array(hash);
    const groups: string[] = [];
    for (let i = 0; i < 6; i++) {
      const val = (hashArr[i * 2] << 8 | hashArr[i * 2 + 1]) % 10000;
      groups.push(val.toString().padStart(4, "0"));
    }
    return groups.join(" ");
  }, []);

  const ratchetMessageKey = useCallback(async (): Promise<CryptoKey | null> => {
    if (!e2eChainKeyRef.current) return e2eSharedKeyRef.current;
    try {
      const counter = e2eMsgCounterRef.current;
      const chainKeyRaw = await crypto.subtle.exportKey("raw", e2eChainKeyRef.current);
      const counterBytes = new TextEncoder().encode(`msg-${counter}`);
      const ikm = await crypto.subtle.importKey("raw", chainKeyRaw, "HKDF", false, ["deriveKey"]);
      const msgKey = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: counterBytes, info: new TextEncoder().encode("junotalk-msg") },
        ikm,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      const newChain = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: counterBytes, info: new TextEncoder().encode("junotalk-next") },
        ikm,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      e2eChainKeyRef.current = newChain;
      return msgKey;
    } catch (err) {
      console.error("[E2E] Ratchet failed:", err);
      return e2eSharedKeyRef.current;
    }
  }, []);

  const deriveIncomingKey = useCallback(async (msgCounter: number): Promise<CryptoKey | null> => {
    if (!e2eChainKeyRef.current) return e2eSharedKeyRef.current;
    try {
      const chainKeyRaw = await crypto.subtle.exportKey("raw", e2eChainKeyRef.current);
      const counterBytes = new TextEncoder().encode(`msg-${msgCounter}`);
      const ikm = await crypto.subtle.importKey("raw", chainKeyRaw, "HKDF", false, ["deriveKey"]);
      const msgKey = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: counterBytes, info: new TextEncoder().encode("junotalk-msg") },
        ikm,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      return msgKey;
    } catch {
      return e2eSharedKeyRef.current;
    }
  }, []);

  const e2eSeqRef = useRef(0);
  const e2eHandshakeRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const e2eVerifiedRef = useRef(false);
  const e2eVerifyingRef = useRef(false);
  const e2eKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const e2eLastPongRef = useRef(0);
  const e2eDecryptFailCountRef = useRef(0);

  useEffect(() => { e2eVerifiedRef.current = e2eVerified; }, [e2eVerified]);
  useEffect(() => { e2eVerifyingRef.current = e2eVerifying; }, [e2eVerifying]);

  const resetE2eState = useCallback(() => {
    e2eKeyPairRef.current = null;
    e2eChallengeRef.current = null;
    e2eSharedKeyRef.current = null;
    e2eChainKeyRef.current = null;
    e2eMsgCounterRef.current = 0;
    e2ePeerCounterRef.current = 0;
    e2eDecryptFailCountRef.current = 0;
    setE2eVerified(false);
    setE2eVerifying(false);
    setE2eSafetyNumber("");
    if (e2eHandshakeRetryRef.current) {
      clearTimeout(e2eHandshakeRetryRef.current);
      e2eHandshakeRetryRef.current = null;
    }
  }, []);

  const initiateE2eHandshake = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !roomCode) return;
    if (e2eVerifiedRef.current) return;
    setE2eVerifying(true);
    setE2eVerified(false);
    e2eMsgCounterRef.current = 0;
    e2ePeerCounterRef.current = 0;
    e2eDecryptFailCountRef.current = 0;
    const seq = ++e2eSeqRef.current;
    try {
      const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits", "deriveKey"]
      );
      e2eKeyPairRef.current = keyPair;
      const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
      const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      e2eChallengeRef.current = btoa(String.fromCharCode(...challenge));
      wsRef.current.send(JSON.stringify({
        type: "e2e-handshake",
        roomCode,
        publicKey: publicKeyB64,
        challenge: e2eChallengeRef.current,
        seq,
      }));
      console.warn(`[E2E] Initiation sent (seq=${seq})`);
    } catch (err) {
      console.error("[E2E] Handshake initiation failed:", err);
      setE2eVerifying(false);
    }
  }, [roomCode]);

  const handleE2eHandshake = useCallback(async (data: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !roomCode) return;
    try {
      if (data.publicKey && data.challenge && !data.response) {
        if (e2eVerifyingRef.current && e2eKeyPairRef.current && user && data.fromId) {
          const myId = user.id || "";
          const peerId = data.fromId || "";
          if (myId && peerId && myId < peerId) {
            console.warn("[E2E] Race detected — yielding to peer (my ID is lower)");
            return;
          }
          console.warn("[E2E] Race detected — I win, becoming responder");
          if (e2eHandshakeRetryRef.current) {
            clearTimeout(e2eHandshakeRetryRef.current);
            e2eHandshakeRetryRef.current = null;
          }
        }
        setE2eVerifying(true);
        const keyPair = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits", "deriveKey"]
        );
        e2eKeyPairRef.current = keyPair;
        const peerKeyBytes = Uint8Array.from(atob(data.publicKey), c => c.charCodeAt(0));
        const peerPublicKey = await crypto.subtle.importKey(
          "raw", peerKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
        );
        const rawBits = await crypto.subtle.deriveBits(
          { name: "ECDH", public: peerPublicKey },
          keyPair.privateKey,
          256
        );
        const myPubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
        const { rootKey, chainKey } = await deriveHkdfKeys(rawBits, myPubRaw, peerKeyBytes.buffer);
        e2eSharedKeyRef.current = rootKey;
        e2eChainKeyRef.current = chainKey;
        e2eMsgCounterRef.current = 0;
        e2ePeerCounterRef.current = 0;
        e2eDecryptFailCountRef.current = 0;
        const safetyNum = await generateSafetyNumber(myPubRaw, peerKeyBytes.buffer);
        setE2eSafetyNumber(safetyNum);
        const challengeBytes = Uint8Array.from(atob(data.challenge), c => c.charCodeAt(0));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          rootKey,
          challengeBytes
        );
        const myPublicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
        wsRef.current.send(JSON.stringify({
          type: "e2e-handshake",
          roomCode,
          publicKey: btoa(String.fromCharCode(...new Uint8Array(myPublicKeyRaw))),
          response: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
          iv: btoa(String.fromCharCode(...iv)),
          challenge: data.challenge,
        }));
        setE2eVerified(true);
        setE2eVerifying(false);
        e2eLastPongRef.current = Date.now();
        console.warn("[E2E] Handshake complete (responder)");
      } else if (data.publicKey && data.response && data.iv) {
        if (!e2eKeyPairRef.current) {
          console.warn("[E2E] Received response but no key pair — ignoring stale response");
          return;
        }
        const peerKeyBytes = Uint8Array.from(atob(data.publicKey), c => c.charCodeAt(0));
        const peerPublicKey = await crypto.subtle.importKey(
          "raw", peerKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
        );
        const rawBits = await crypto.subtle.deriveBits(
          { name: "ECDH", public: peerPublicKey },
          e2eKeyPairRef.current.privateKey,
          256
        );
        const myPubRaw = await crypto.subtle.exportKey("raw", e2eKeyPairRef.current.publicKey);
        const { rootKey, chainKey } = await deriveHkdfKeys(rawBits, myPubRaw, peerKeyBytes.buffer);
        e2eSharedKeyRef.current = rootKey;
        e2eChainKeyRef.current = chainKey;
        e2eDecryptFailCountRef.current = 0;
        const safetyNum = await generateSafetyNumber(myPubRaw, peerKeyBytes.buffer);
        setE2eSafetyNumber(safetyNum);
        const encryptedBytes = Uint8Array.from(atob(data.response), c => c.charCodeAt(0));
        const ivBytes = Uint8Array.from(atob(data.iv), c => c.charCodeAt(0));
        try {
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivBytes },
            rootKey,
            encryptedBytes
          );
          const decryptedB64 = btoa(String.fromCharCode(...new Uint8Array(decrypted)));
          if (decryptedB64 === e2eChallengeRef.current) {
            setE2eVerified(true);
            setE2eVerifying(false);
            e2eLastPongRef.current = Date.now();
            console.warn("[E2E] Handshake complete (initiator) — challenge verified");
          } else {
            console.warn("[E2E] Challenge mismatch — restarting handshake");
            resetE2eState();
            setTimeout(() => initiateE2eWithRetryRef.current(6), 1000);
          }
        } catch (decryptErr) {
          console.warn("[E2E] Challenge decrypt failed — key mismatch, restarting");
          resetE2eState();
          setTimeout(() => initiateE2eWithRetryRef.current(6), 1500);
        }
      }
    } catch (err) {
      console.error("[E2E] Handshake error:", err);
      resetE2eState();
      setTimeout(() => initiateE2eWithRetryRef.current(6), 2000);
    }
  }, [roomCode, user, deriveHkdfKeys, generateSafetyNumber, resetE2eState]);

  const handleE2eHandshakeAck = useCallback((data: any) => {
    if (!data.delivered && !e2eVerifiedRef.current) {
      console.warn("[E2E] Handshake not delivered — scheduling retry");
      if (e2eHandshakeRetryRef.current) clearTimeout(e2eHandshakeRetryRef.current);
      e2eHandshakeRetryRef.current = setTimeout(() => {
        if (!e2eVerifiedRef.current && mountedRef.current) {
          resetE2eState();
          initiateE2eWithRetryRef.current(6);
        }
      }, 3000);
    }
  }, [resetE2eState]);

  const handleE2eHandshakeError = useCallback((data: any) => {
    if (data.error === "no-peer") {
      console.warn("[E2E] No peer in room — scheduling retry");
      setE2eVerifying(false);
      if (e2eHandshakeRetryRef.current) clearTimeout(e2eHandshakeRetryRef.current);
      e2eHandshakeRetryRef.current = setTimeout(() => {
        if (!e2eVerifiedRef.current && mountedRef.current) {
          initiateE2eWithRetryRef.current(6);
        }
      }, 5000);
    } else if (data.error === "not-in-room") {
      console.warn("[E2E] Not registered in room — re-joining and retrying");
      if (wsRef.current?.readyState === WebSocket.OPEN && roomCode) {
        wsRef.current.send(JSON.stringify({ type: "join-room", roomCode, peerId: user?.id }));
        if (e2eHandshakeRetryRef.current) clearTimeout(e2eHandshakeRetryRef.current);
        e2eHandshakeRetryRef.current = setTimeout(() => {
          if (!e2eVerifiedRef.current && mountedRef.current) {
            initiateE2eWithRetryRef.current(6);
          }
        }, 2000);
      }
    }
  }, [roomCode, user]);

  const handleE2ePing = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && data.fromId) {
      wsRef.current.send(JSON.stringify({ type: "e2e-pong", targetId: data.fromId }));
    }
  }, []);

  const handleE2ePong = useCallback(() => {
    e2eLastPongRef.current = Date.now();
  }, []);

  const e2eEncrypt = useCallback(async (plaintext: string): Promise<{ ciphertext: string; iv: string; counter: number } | null> => {
    if (!e2eSharedKeyRef.current || !e2eVerified) return null;
    try {
      const counter = e2eMsgCounterRef.current++;
      const msgKey = await ratchetMessageKey();
      if (!msgKey) return null;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        msgKey,
        encoded
      );
      return {
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)),
        counter,
      };
    } catch (err) {
      console.error("[E2E] Encrypt failed:", err);
      return null;
    }
  }, [e2eVerified, ratchetMessageKey]);

  const e2eDecrypt = useCallback(async (ciphertext: string, iv: string, msgCounter?: number): Promise<string | null> => {
    if (!e2eSharedKeyRef.current || !e2eVerified) return null;
    try {
      if (msgCounter !== undefined && msgCounter <= e2ePeerCounterRef.current && e2ePeerCounterRef.current > 0) {
        console.warn("[E2E] Replay detected, counter:", msgCounter);
        return null;
      }
      if (msgCounter !== undefined) {
        e2ePeerCounterRef.current = msgCounter;
      }
      const decryptKey = (msgCounter !== undefined) ? await deriveIncomingKey(msgCounter) : e2eSharedKeyRef.current;
      if (!decryptKey) return null;
      const encBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
      const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        decryptKey,
        encBytes
      );
      e2eDecryptFailCountRef.current = 0;
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      e2eDecryptFailCountRef.current++;
      console.error(`[E2E] Decrypt failed (${e2eDecryptFailCountRef.current} consecutive)`, err);
      if (e2eDecryptFailCountRef.current >= 3) {
        console.warn("[E2E] Too many decrypt failures — keys out of sync, re-handshaking");
        resetE2eState();
        setTimeout(() => initiateE2eWithRetryRef.current(6), 1000);
      }
      return null;
    }
  }, [e2eVerified, deriveIncomingKey, resetE2eState]);

  const initiateE2eWithRetry = useCallback((maxAttempts = 6) => {
    if (e2eVerifiedRef.current) return;
    if (e2eHandshakeRetryRef.current) {
      clearTimeout(e2eHandshakeRetryRef.current);
      e2eHandshakeRetryRef.current = null;
    }
    let attempt = 0;
    const tryHandshake = () => {
      if (e2eVerifiedRef.current || !mountedRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        if (attempt < maxAttempts) {
          e2eHandshakeRetryRef.current = setTimeout(tryHandshake, 2000);
        }
        return;
      }
      if (e2eVerifyingRef.current) {
        if (attempt < maxAttempts) {
          e2eHandshakeRetryRef.current = setTimeout(tryHandshake, 2500);
        }
        return;
      }
      attempt++;
      console.warn(`[E2E] Handshake attempt ${attempt}/${maxAttempts}`);
      initiateE2eHandshake();
      if (attempt < maxAttempts) {
        const delay = Math.min(2000 * attempt, 10000);
        e2eHandshakeRetryRef.current = setTimeout(() => {
          if (!e2eVerifiedRef.current && !e2eSharedKeyRef.current) {
            tryHandshake();
          }
        }, delay);
      } else {
        e2eHandshakeRetryRef.current = setTimeout(() => {
          if (!e2eVerifiedRef.current) {
            console.warn("[E2E] All attempts exhausted — restarting from scratch");
            resetE2eState();
            initiateE2eWithRetryRef.current(6);
          }
        }, 15000);
      }
    };
    tryHandshake();
  }, [initiateE2eHandshake, resetE2eState]);

  initiateE2eWithRetryRef.current = initiateE2eWithRetry;

  const connectCaptionWebSocket = useCallback(() => {
    if (!roomCode || !user) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return;
    wsCancelledRef.current = false;

    function connect() {
      if (wsCancelledRef.current) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        wsReconnectDelayRef.current = 1000;
        setWsConnected(true);
        ws.send(JSON.stringify({ type: "register", userId: user!.id }));
        ws.send(JSON.stringify({ type: "join-room", roomCode, peerId: user!.id }));
        ws.send(JSON.stringify({ type: "room-call-notify", roomCode }));
        resetE2eState();
        setTimeout(() => initiateE2eWithRetry(6), 1500);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "room-caption" && data.fromId !== user!.id) {
            const processCaption = (text: string) => {
              const captionId = Date.now().toString();
              const currentLang = subtitleLanguageRef.current;
              const captionNeedsTranslation = currentLang && currentLang !== "en";
              setCaptions(prev => [...prev.slice(-49), {
                id: captionId,
                speaker: "them",
                original: text,
                translated: "",
                isTranslating: !!captionNeedsTranslation,
                timestamp: Date.now()
              }]);
              if (captionNeedsTranslation) {
                translateText(text, currentLang).then(translated => {
                  setCaptions(prev => prev.map(c =>
                    c.id === captionId
                      ? { ...c, translated, isTranslating: false }
                      : c
                  ));
                }).catch(() => {
                  setCaptions(prev => prev.map(c =>
                    c.id === captionId ? { ...c, isTranslating: false } : c
                  ));
                });
              }
            };
            if (data.e2e && data.ciphertext && data.iv) {
              e2eDecrypt(data.ciphertext, data.iv, data.counter).then(plaintext => {
                processCaption(plaintext || data.text || "[encrypted]");
              });
            } else {
              processCaption(data.text);
            }
          } else if (data.type === "user-joined" && data.userId !== user!.id) {
            console.warn("[E2E] Peer joined room — starting handshake");
            resetE2eState();
            setTimeout(() => initiateE2eWithRetry(6), 1500);
          } else if (data.type === "e2e-handshake" && data.fromId !== user!.id) {
            handleE2eHandshake(data);
          } else if (data.type === "e2e-handshake-ack") {
            handleE2eHandshakeAck(data);
          } else if (data.type === "e2e-handshake-error") {
            handleE2eHandshakeError(data);
          } else if (data.type === "e2e-ping" && data.fromId !== user!.id) {
            handleE2ePing(data);
          } else if (data.type === "e2e-pong" && data.fromId !== user!.id) {
            handleE2ePong();
          } else if (data.type === "room-chat" && data.fromId !== user!.id) {
            const processChat = (text: string, timestamp: number) => {
              const messageId = Date.now().toString();
              const targetLang = subtitleLanguageRef.current;
              const chatNeedsTranslation = targetLang && targetLang !== "none" && targetLang !== "en";
              const newMessage: ChatMessage = {
                id: messageId,
                sender: "them",
                text,
                isTranslating: !!chatNeedsTranslation,
                timestamp,
              };
              setChatMessages(prev => [...prev, newMessage]);
              if (chatNeedsTranslation) {
                translateText(text, targetLang).then(translated => {
                  setChatMessages(prev => prev.map(m =>
                    m.id === messageId
                      ? { ...m, translatedText: translated, isTranslating: false }
                      : m
                  ));
                }).catch(() => {
                  setChatMessages(prev => prev.map(m =>
                    m.id === messageId ? { ...m, isTranslating: false } : m
                  ));
                });
              } else {
                setChatMessages(prev => prev.map(m =>
                  m.id === messageId ? { ...m, isTranslating: false } : m
                ));
              }
            };
            if (data.e2e && data.ciphertext && data.iv) {
              e2eDecrypt(data.ciphertext, data.iv, data.counter).then(plaintext => {
                processChat(plaintext || data.text || "[encrypted]", data.timestamp || Date.now());
              });
            } else {
              processChat(data.text, data.timestamp || Date.now());
            }
          }
        } catch (e) {
          console.error("WebSocket message error:", e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (!wsCancelledRef.current) {
          const delay = Math.min(wsReconnectDelayRef.current, 10000);
          wsReconnectDelayRef.current = delay * 1.5;
          console.warn(`[Room WS] Reconnecting in ${delay}ms...`);
          wsReconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (err) => {
        console.error("[Room WS] Connection error:", err);
      };

      wsRef.current = ws;
    }

    connect();
  }, [roomCode, user, translateText, resetE2eState, initiateE2eWithRetry, handleE2eHandshake, handleE2eHandshakeAck, handleE2eHandshakeError, handleE2ePing, handleE2ePong]);

  const sendCaptionToOthers = useCallback(async (text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && roomCode) {
      const encrypted = await e2eEncrypt(text);
      if (encrypted) {
        wsRef.current.send(JSON.stringify({
          type: "room-caption",
          e2e: true,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          counter: encrypted.counter,
          roomCode
        }));
      } else {
        wsRef.current.send(JSON.stringify({
          type: "room-caption",
          text,
          roomCode
        }));
      }
    }
  }, [roomCode, e2eEncrypt]);

  useEffect(() => {
    if (!isInCall || !wsConnected) {
      if (e2eKeepaliveRef.current) {
        clearInterval(e2eKeepaliveRef.current);
        e2eKeepaliveRef.current = null;
      }
      return;
    }
    e2eLastPongRef.current = Date.now();
    e2eKeepaliveRef.current = setInterval(() => {
      if (!e2eVerifiedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "e2e-ping" }));
      const timeSinceLastPong = Date.now() - e2eLastPongRef.current;
      if (timeSinceLastPong > 45000 && participantCount > 1) {
        console.warn("[E2E] Keepalive timeout — peer may have disconnected, re-handshaking");
        resetE2eState();
        setTimeout(() => initiateE2eWithRetry(6), 1000);
      }
    }, 15000);
    return () => {
      if (e2eKeepaliveRef.current) {
        clearInterval(e2eKeepaliveRef.current);
        e2eKeepaliveRef.current = null;
      }
    };
  }, [isInCall, wsConnected, participantCount, resetE2eState, initiateE2eWithRetry]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (jitsiApiRef.current && isInCall) {
        setConnectionQuality("fair");
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        wsCancelledRef.current = false;
        connectCaptionWebSocket();
      }
    };
    const goOffline = () => {
      setIsOnline(false);
      setConnectionQuality("poor");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [isInCall, connectCaptionWebSocket]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isInCall) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          wsCancelledRef.current = false;
          connectCaptionWebSocket();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isInCall, connectCaptionWebSocket]);

  useEffect(() => {
    if (!roomData) return;

    const checkCaptionHealth = () => {
      if (!navigator.onLine) {
        setConnectionQuality("poor");
        return;
      }
      const speechActive = isListening || !!recognitionRef.current || !!whisperRecorderRef.current;
      const wsActive = wsRef.current?.readyState === WebSocket.OPEN;
      const wsConnecting = wsRef.current?.readyState === WebSocket.CONNECTING;

      if (speechActive) {
        lastSpeechActiveRef.current = Date.now();
      }

      if (wsActive) {
        setConnectionQuality("good");
      } else if (wsConnecting) {
        setConnectionQuality("connecting");
      } else {
        setConnectionQuality("connecting");
        if (!wsCancelledRef.current && !wsConnecting) {
          console.warn("[CaptionHealth] WebSocket down during call — forcing reconnect");
          connectCaptionWebSocket();
        }
      }
    };

    checkCaptionHealth();
    const interval = setInterval(checkCaptionHealth, 3000);
    return () => clearInterval(interval);
  }, [roomData, isListening]);

  useEffect(() => {
    if (!roomData || jitsiLoaded || jitsiError) return;
    const timeout = setTimeout(() => {
      if (!jitsiLoaded && !jitsiError) {
        setJoinTimedOut(true);
      }
    }, 20000);
    return () => clearTimeout(timeout);
  }, [roomData, jitsiLoaded, jitsiError]);

  const aiCaptionEnhanceRef = useRef(aiCaptionEnhance);
  useEffect(() => { aiCaptionEnhanceRef.current = aiCaptionEnhance; }, [aiCaptionEnhance]);

  const addCaption = useCallback((original: string, speaker: "you" | "them") => {
    const captionId = Date.now().toString();
    
    const loadingCaption: Caption = {
      id: captionId,
      speaker,
      original,
      translated: "",
      isTranslating: true,
      timestamp: Date.now(),
    };
    setCaptions(prev => [...prev.slice(-49), loadingCaption]);
    
    if (speaker === "you") {
      sendCaptionToOthers(original);
    }

    if (translationInFlightRef.current >= MAX_CONCURRENT_TRANSLATIONS) {
      setCaptions(prev => prev.map(c =>
        c.id === captionId ? { ...c, isTranslating: false } : c
      ));
      return;
    }

    translationInFlightRef.current += 1;

    if (aiCaptionEnhanceRef.current && original.length >= 5) {
      fetch("/api/caption-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: original }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.enhanced && data.cleanedText && data.cleanedText !== original) {
            const lang = subtitleLanguageRef.current;
            const enhancedNeedsTranslation = lang && lang !== "en";
            setCaptions(prev => prev.map(c =>
              c.id === captionId ? { ...c, original: data.cleanedText, isTranslating: !!enhancedNeedsTranslation } : c
            ));
            if (enhancedNeedsTranslation) {
              translateText(data.cleanedText, lang).then(translated => {
                setCaptions(prev => prev.map(c =>
                  c.id === captionId ? { ...c, translated, isTranslating: false } : c
                ));
              }).catch(() => {
                setCaptions(prev => prev.map(c =>
                  c.id === captionId ? { ...c, isTranslating: false } : c
                ));
              }).finally(() => { translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1); });
            } else {
              translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1);
            }
            return;
          }
          translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1);
        })
        .catch(() => { translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1); });
      return;
    }

    const currentLang = subtitleLanguageRef.current;
    if (!currentLang || currentLang === "en") {
      setCaptions(prev => prev.map(c =>
        c.id === captionId ? { ...c, isTranslating: false } : c
      ));
      translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1);
      return;
    }
    translateText(original, currentLang).then(translated => {
      setCaptions(prev => prev.map(c => 
        c.id === captionId 
          ? { ...c, translated, isTranslating: false }
          : c
      ));
    }).catch(() => {
      setCaptions(prev => prev.map(c => 
        c.id === captionId 
          ? { ...c, isTranslating: false }
          : c
      ));
    }).finally(() => { translationInFlightRef.current = Math.max(0, translationInFlightRef.current - 1); });
  }, [translateText, sendCaptionToOthers]);

  // Keep addCaptionRef in sync so offline-queue drain can call it
  useEffect(() => { addCaptionRef.current = addCaption; }, [addCaption]);

  // Re-translate existing captions when language changes
  const prevLanguageRef = useRef(subtitleLanguage);
  const captionsRef = useRef(captions);
  
  // Keep captionsRef updated
  useEffect(() => {
    captionsRef.current = captions;
    if (captionContainerRef.current) {
      captionContainerRef.current.scrollTop = captionContainerRef.current.scrollHeight;
    }
  }, [captions]);
  
  useEffect(() => {
    // Only run when language actually changes, not on initial mount
    if (prevLanguageRef.current === subtitleLanguage) return;
    prevLanguageRef.current = subtitleLanguage;
    
    
    const retranslate = async () => {
      const currentCaptions = captionsRef.current;
      if (currentCaptions.length === 0) return;

      // "en" means translation is off — clear translated text instead of calling the API
      if (!subtitleLanguage || subtitleLanguage === "en") {
        setCaptions(prev => prev.map(c => ({ ...c, translated: "", isTranslating: false })));
        return;
      }

      setCaptions(prev => prev.map(c => ({ ...c, isTranslating: true })));
      
      const updatedCaptions = await Promise.all(
        currentCaptions.map(async (caption) => {
          try {
            const translated = await translateText(caption.original, subtitleLanguage);
            return { ...caption, translated, isTranslating: false };
          } catch (e) {
            return { ...caption, isTranslating: false };
          }
        })
      );
      
      setCaptions(updatedCaptions);
    };
    
    retranslate();
  }, [subtitleLanguage, translateText]);

  const startWhisperFallback = useCallback(async () => {
    if (whisperRecorderRef.current) return;

    try {
      // Build noise-reduction chain: hardware constraints + Web Audio filter graph.
      // The processedStream feeds MediaRecorder with background noise already attenuated.
      const processor = await buildAudioProcessor();
      whisperProcDisposeRef.current = processor.dispose;
      whisperStreamRef.current = processor.processedStream;

      const recordAndSend = () => {
        if (!whisperStreamRef.current) return;
        const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
        let selectedMime = "";
        for (const mt of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mt)) { selectedMime = mt; break; }
        }

        const recorder = new MediaRecorder(whisperStreamRef.current, selectedMime ? { mimeType: selectedMime } : undefined);
        const chunks: Blob[] = [];
        whisperRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          if (chunks.length === 0) return;
          const blob = new Blob(chunks, { type: selectedMime || "audio/webm" });
          if (blob.size < 1000) return;

          const ext = selectedMime.includes("mp4") ? "mp4" : selectedMime.includes("ogg") ? "ogg" : "webm";

          // Buffer to IndexedDB when offline — drain automatically on reconnect
          if (!navigator.onLine) {
            try {
              const audioBase64 = await blobToBase64(blob);
              await enqueue({
                type: "whisper-chunk",
                timestamp: Date.now(),
                retries: 0,
                payload: { roomCode: roomCode || "", audioBase64, mimeType: selectedMime || "audio/webm", extension: ext },
              });
              setBufferedCaptionCount(prev => prev + 1);
            } catch (err) {
              console.warn("[Whisper fallback] Could not buffer offline chunk:", err);
            }
            return;
          }

          try {
            const formData = new FormData();
            formData.append("audio", blob, `chunk.${ext}`);

            const res = await fetch("/api/transcribe", {
              method: "POST",
              credentials: "include",
              body: formData,
            });

            if (res.ok) {
              const data = await res.json();
              if (data.text && data.text.trim()) {
                addCaption(data.text.trim(), "you");
              }
            }
          } catch (err) {
            console.error("[Whisper fallback] Transcription request failed:", err);
          }
        };

        recorder.start();
        setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, 4000);
      };

      recordAndSend();
      whisperIntervalRef.current = setInterval(recordAndSend, 5000);

      setUseWhisperFallback(true);
      setIsListening(true);
      console.warn("[Speech] Whisper fallback activated");
    } catch (err) {
      console.error("[Whisper fallback] Could not access microphone:", err);
      toast({ title: t("room.connectionError"), variant: "default" });
    }
  }, [addCaption, toast]);

  const stopWhisperFallback = useCallback(() => {
    if (whisperIntervalRef.current) {
      clearInterval(whisperIntervalRef.current);
      whisperIntervalRef.current = null;
    }
    if (whisperRecorderRef.current && whisperRecorderRef.current.state === "recording") {
      try { whisperRecorderRef.current.stop(); } catch {}
    }
    whisperRecorderRef.current = null;
    // Dispose audio processor chain (stops raw mic track + closes AudioContext)
    try { whisperProcDisposeRef.current?.(); } catch {}
    whisperProcDisposeRef.current = null;
    whisperStreamRef.current = null;
    setUseWhisperFallback(false);
    setIsListening(false);
    setInterimText("");
  }, []);

  const startSpeechRecognition = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      console.warn("[Speech] Web Speech API not available, switching to Whisper fallback");
      startWhisperFallback();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    const spokenLang = userPrefs?.spokenLanguage || "auto";
    const langMap: Record<string, string> = {
      en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
      pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", cs: "cs-CZ", ru: "ru-RU",
      ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", ar: "ar-SA", hi: "hi-IN",
      tr: "tr-TR", sv: "sv-SE", da: "da-DK", fi: "fi-FI", no: "nb-NO",
      el: "el-GR", he: "he-IL", th: "th-TH", vi: "vi-VN",
    };
    recognition.lang = spokenLang !== "auto" ? (langMap[spokenLang] || spokenLang) : (navigator.language || "en-US");

    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      const finalSegments: string[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (!transcript.trim()) continue;
        if (event.results[i].isFinal) {
          finalSegments.push(transcript.trim());
        } else {
          interimTranscript += (interimTranscript ? " " : "") + transcript.trim();
        }
      }

      if (finalSegments.length > 0) {
        finalSegments.forEach((segment) => {
          addCaption(segment, "you");
        });
        setInterimText("");
      } else if (interimTranscript) {
        setInterimText(interimTranscript);
        if (captionContainerRef.current) {
          captionContainerRef.current.scrollTop = captionContainerRef.current.scrollHeight;
        }
      }
    };

    let consecutiveErrors = 0;

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        recognitionRef.current = null;
        setIsListening(false);
        setPermissionDenied(prev => prev === "camera" ? "both" : "mic");
        return;
      }
      if (event.error === "no-speech") return;
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        console.warn("[Speech] Too many errors, switching to Whisper fallback");
        recognitionRef.current = null;
        setIsListening(false);
        startWhisperFallback();
      }
    };

    recognition.onend = () => {
      if (!recognitionRef.current) return;
      try {
        recognition.start();
        consecutiveErrors = 0;
      } catch (e) {
        setTimeout(() => {
          if (!recognitionRef.current) return;
          try {
            recognition.start();
            consecutiveErrors = 0;
          } catch (err) {
            console.warn("[Speech] Restart failed, switching to Whisper fallback");
            recognitionRef.current = null;
            setIsListening(false);
            startWhisperFallback();
          }
        }, 500);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
    }
  }, [addCaption, isListening, isInCall, toast, userPrefs?.spokenLanguage, startWhisperFallback]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText("");
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      if (useWhisperFallback) {
        stopWhisperFallback();
      } else {
        stopSpeechRecognition();
      }
    } else {
      startSpeechRecognition();
    }
  }, [isListening, useWhisperFallback, startSpeechRecognition, stopSpeechRecognition, startWhisperFallback, stopWhisperFallback]);

  const toggleMute = useCallback(() => {
    // Toggle audio in Jitsi if available
    if (jitsiApiRef.current) {
      jitsiApiRef.current.executeCommand('toggleAudio');
    }
    
    // Also toggle local stream audio tracks (for preview and backup)
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted; // If currently muted, unmute; if unmuted, mute
      });
    }
    
    if (!isMuted) {
      if (useWhisperFallback) {
        stopWhisperFallback();
      } else {
        stopSpeechRecognition();
      }
    } else {
      startSpeechRecognition();
    }
    
    setIsMuted(prev => !prev);
  }, [localStream, isMuted, stopSpeechRecognition, startSpeechRecognition, useWhisperFallback, stopWhisperFallback]);

  const toggleVideo = useCallback(() => {
    // Toggle video in Jitsi if available
    if (jitsiApiRef.current) {
      jitsiApiRef.current.executeCommand('toggleVideo');
    }
    
    // Also toggle local stream video tracks (for preview and backup)
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = isVideoOff; // If currently off, turn on; if on, turn off
      });
    }
    
    setIsVideoOff(prev => !prev);
    
    // Ensure speech recognition keeps running when video is paused
    if (!recognitionRef.current && !isMuted) {
      startSpeechRecognition();
    }
  }, [isMuted, startSpeechRecognition, localStream, isVideoOff]);

  const flipCamera = useCallback(() => {
    if (jitsiApiRef.current && jitsiLoaded) {
      jitsiApiRef.current.executeCommand('toggleCamera');
    } else {
      // Flip local preview camera
      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    }
  }, [jitsiLoaded]);

  const initJitsi = useCallback(async () => {
    if (!jitsiContainerRef.current || !roomCode || !user) return;
    if (jitsiApiRef.current) {
      jitsiApiRef.current.dispose();
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    await new Promise(r => setTimeout(r, 300));

    try {
      const normalizedRoom = `junotalk-${roomCode.toLowerCase()}`;

      let jwtToken: string | undefined;
      let jaasAppId: string | undefined;
      let fullRoomName = normalizedRoom;
      let domain = "meet.jit.si";

      try {
        const configRes = await fetch("/api/jitsi/config", { credentials: "include" });
        if (configRes.ok) {
          const config = await configRes.json();
          if (config.jaasConfigured) {
            jaasAppId = config.appId;
            try {
              const tokenRes = await fetch(`/api/jaas/token?room=${encodeURIComponent(normalizedRoom)}`, { credentials: "include" });
              if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                jwtToken = tokenData.token;
                domain = "8x8.vc";
                fullRoomName = `${jaasAppId}/${normalizedRoom}`;
                console.warn("[Jitsi] Using JaaS infrastructure");
              } else {
                console.warn("[Jitsi] JaaS token unavailable, using fallback server");
              }
            } catch (tokenErr) {
              console.warn("[Jitsi] JaaS token error, using fallback server");
            }
          } else {
            console.warn("[Jitsi] JaaS not configured, using fallback server");
          }
        }
      } catch (e) {
        console.warn("[Jitsi] Config fetch failed, using fallback server");
      }

      // Fetch TURN credentials from server (Twilio NTS if configured, else openrelay)
      let iceServers: any[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
      try {
        const turnRes = await fetch("/api/v1/turn-credentials", { credentials: "include" });
        if (turnRes.ok) {
          const turnData = await turnRes.json();
          if (turnData.iceServers?.length) {
            iceServers = turnData.iceServers;
            console.warn(`[Jitsi] TURN credentials loaded (provider: ${turnData.provider || "unknown"})`);
          }
        }
      } catch (e) {
        console.warn("[Jitsi] TURN credential fetch failed, using fallback STUN only");
      }

      // Split iceServers into stun and turn lists for Jitsi config
      const stunServers = iceServers.filter((s: any) => {
        const urls = Array.isArray(s.urls) ? s.urls[0] : s.urls;
        return typeof urls === "string" && urls.startsWith("stun:");
      });
      const turnServers = iceServers.filter((s: any) => {
        const urls = Array.isArray(s.urls) ? s.urls[0] : s.urls;
        return typeof urls === "string" && urls.startsWith("turn:");
      });

      console.warn("[Jitsi] Connecting to room...");
      const options: any = {
        roomName: fullRoomName,
        ...(jwtToken ? { jwt: jwtToken } : {}),
        width: "100%",
        height: "100%",
        parentNode: jitsiContainerRef.current,
        userInfo: {
          displayName: safeDisplayName(user.firstName, user.lastName),
        },
        configOverwrite: {
          startWithAudioMuted: false,
          startWithVideoMuted: voiceOnlyMode || lowDataMode,
          startSilent: false,
          prejoinPageEnabled: false,
          disableDeepLinking: true,
          toolbarButtons: [],
          hideConferenceSubject: true,
          hideConferenceTimer: true,
          disableRemoteMute: true,
          remoteVideoMenu: { disableKick: true },
          disableProfile: true,
          enableWelcomePage: false,
          enableClosePage: false,
          disableInviteFunctions: true,
          notifications: [],
          disableShortcuts: true,
          startInTileView: true,
          disableTileView: false,
          enableLobby: false,
          hideLobbyButton: true,
          requireDisplayName: false,
          enableInsecureRoomNameWarning: false,
          enableNoisyMicDetection: false,
          disableModeratorIndicator: true,
          disableReactions: true,
          disablePolls: true,
          disableSelfView: false,
          disableSelfViewSettings: true,
          p2p: {
            enabled: true,
            useStunTurn: true,
            stunServers: stunServers.length ? stunServers : [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
            ],
            turnServers: turnServers.length ? turnServers : [],
            iceTransportPolicy: "all",
            backToP2PDelay: 5,
          },
          useStunTurn: true,
          useTurnUdp: true,
          enableTurnTcp: true,
          disableSimulcast: false,
          enableLayerSuspension: false,
          resolution: lowDataMode ? 180 : 480,
          constraints: {
            video: {
              height: lowDataMode ? { ideal: 180, max: 360 } : { ideal: 480, max: 720 },
              width: lowDataMode ? { ideal: 320, max: 480 } : { ideal: 640, max: 1280 },
              frameRate: lowDataMode ? { ideal: 15, max: 20 } : { ideal: 24, max: 30 },
            },
          },
          disableAudioLevels: false,
          enableNoAudioDetection: true,
          enableTalkWhileMuted: true,
          channelLastN: 6,
          webrtcIceUdpDisable: false,
          webrtcIceTcpDisable: false,
          enableForcedReload: false,
          openBridgeChannel: "websocket",
          enableIceRestart: true,
          iceTransportPolicy: "all",
          forceJVB121Ratio: -1,
          testing: {
            p2pTestMode: false,
            enableTurnTcp: true,
          },
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: [],
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          HIDE_INVITE_MORE_HEADER: true,
          MOBILE_APP_PROMO: false,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
          DISABLE_FOCUS_INDICATOR: true,
          DISABLE_DOMINANT_SPEAKER_INDICATOR: true,
          FILM_STRIP_MAX_HEIGHT: 0,
          HIDE_DEEP_LINKING_LOGO: true,
          GENERATE_ROOMNAMES_ON_WELCOME_PAGE: false,
          DISPLAY_WELCOME_PAGE_CONTENT: false,
          DISPLAY_WELCOME_PAGE_TOOLBAR_ADDITIONAL_CONTENT: false,
          APP_NAME: "JunoTalk",
          PROVIDER_NAME: "JunoTalk",
          DEFAULT_BACKGROUND: "#1a1a2e",
          VIDEO_LAYOUT_FIT: "both",
          DISABLE_RINGING: true,
          DISABLE_TRANSCRIPTION_SUBTITLES: true,
          DISABLE_VIDEO_BACKGROUND: true,
          SHOW_CHROME_EXTENSION_BANNER: false,
          SHOW_PROMOTIONAL_CLOSE_PAGE: false,
          LANG_DETECTION: false,
          RECENT_LIST_ENABLED: false,
          SETTINGS_SECTIONS: [],
        },
      };

      connectCaptionWebSocket();

      const api = new window.JitsiMeetExternalAPI(domain, options);

      api.addEventListener("videoConferenceJoined", () => {
        console.warn("[Jitsi] Video conference joined");
        setJitsiLoaded(true);
        setIsInCall(true);

        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "video-call-join", roomCode }));
          }
        }, 500);

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
          setLocalStream(null);
        }

        const ensureMediaActive = (attempt = 0) => {
          if (attempt > 5) return;
          const delay = 1000 + attempt * 800;
          setTimeout(() => {
            Promise.all([
              api.isAudioMuted().catch(() => null),
              api.isVideoMuted().catch(() => null),
            ]).then(([audioMuted, videoMuted]) => {
              if (audioMuted === true) {
                api.executeCommand("toggleAudio");
                ensureMediaActive(attempt + 1);
              }
              if (!voiceOnlyRef.current && !lowDataRef.current && videoMuted === true) {
                api.executeCommand("toggleVideo");
              }
            }).catch(() => {});
          }, delay);
        };
        ensureMediaActive();

        // Poll participant count periodically to catch any missed events
        const pollParticipants = () => {
          try {
            const count = api.getNumberOfParticipants();
            if (count > 0) {
              setParticipantCount(count);
            }
          } catch (e) {
          }
        };
        
        // Initial check after 1 second, then every 3 seconds
        setTimeout(pollParticipants, 1000);
        const pollInterval = setInterval(pollParticipants, 3000);
        
        // Store interval to clear on cleanup
        (api as any)._pollInterval = pollInterval;
      });

      api.addEventListener("videoConferenceLeft", () => {
        console.warn("[Jitsi] Video conference left");
        setIsInCall(false);
        stopSpeechRecognition();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "video-call-leave", roomCode }));
        }
        wsCancelledRef.current = true;
        if (wsReconnectTimerRef.current) clearTimeout(wsReconnectTimerRef.current);
        if (jitsiRetryTimerRef.current) clearTimeout(jitsiRetryTimerRef.current);
        if (wsRef.current) {
          wsRef.current.close();
        }
        if ((api as any)._pollInterval) {
          clearInterval((api as any)._pollInterval);
        }
        setLocation("/chat-rooms");
      });

      api.addEventListener("participantJoined", (data: any) => {
        console.warn("[Jitsi] Participant joined");
        try {
          const count = api.getNumberOfParticipants();
          if (count > 0) {
            setParticipantCount(count);
          }
        } catch {
          setParticipantCount(prev => prev + 1);
        }
        if (callTimeoutRef.current) {
          clearTimeout(callTimeoutRef.current);
          callTimeoutRef.current = null;
        }
        if (callTimeoutIntervalRef.current) {
          clearInterval(callTimeoutIntervalRef.current);
          callTimeoutIntervalRef.current = null;
        }
        setCallTimeoutActive(false);
        setCallTimeoutSeconds(30);
        console.warn("[E2E] Jitsi participant joined — starting handshake");
        resetE2eState();
        setTimeout(() => initiateE2eWithRetry(6), 1500);
      });

      api.addEventListener("participantLeft", (data: any) => {
        console.warn("[Jitsi] Participant left");
        try {
          const count = api.getNumberOfParticipants();
          setParticipantCount(Math.max(1, count));
          if (count <= 1) {
            resetE2eState();
          }
        } catch {
          setParticipantCount(prev => Math.max(1, prev - 1));
        }
      });

      api.addEventListener("audioMuteStatusChanged", (data: any) => {
        setIsMuted(data.muted);
      });

      api.addEventListener("videoMuteStatusChanged", (data: any) => {
        setIsVideoOff(data.muted);
      });

      api.addEventListener("audioAvailabilityChanged", (data: any) => {
        if (data.available) {
          setTimeout(() => {
            api.isAudioMuted().then((muted: boolean) => {
              if (muted) api.executeCommand("toggleAudio");
            }).catch(() => {});
          }, 500);
        }
      });

      api.addEventListener("videoAvailabilityChanged", (data: any) => {
        if (data.available && !voiceOnlyRef.current && !lowDataRef.current) {
          setTimeout(() => {
            api.isVideoMuted().then((muted: boolean) => {
              if (muted) api.executeCommand("toggleVideo");
            }).catch(() => {});
          }, 500);
        }
      });

      api.addEventListener("connectionEstablished", () => {
        console.warn("[Jitsi] Connection established");
        setConnectionQuality("good");
        setJoinTimedOut(false);
        setIsReconnecting(false);
        reconnectAttemptRef.current = 0;
      });

      let retryCount = 0;
      api.addEventListener("connectionFailed", (error: any) => {
        console.error("[Jitsi] Connection failed:", error);
        setConnectionQuality("poor");
        retryCount++;
        if (retryCount <= 3) {
          setIsReconnecting(true);
          setConnectionQuality("reconnecting");
          setJitsiError(null);
          if (jitsiRetryTimerRef.current) clearTimeout(jitsiRetryTimerRef.current);
          jitsiRetryTimerRef.current = setTimeout(() => {
            setJitsiError(null);
            if (jitsiApiRef.current) {
              if ((jitsiApiRef.current as any)._pollInterval) {
                clearInterval((jitsiApiRef.current as any)._pollInterval);
              }
              jitsiApiRef.current.dispose();
              jitsiApiRef.current = null;
            }
            setIsReconnecting(false);
            initJitsi();
          }, 2000 * retryCount);
        } else {
          setIsReconnecting(false);
          setJitsiError(t("room.connectionError"));
        }
      });

      api.addEventListener("suspendDetected", () => {
        console.warn("[Jitsi] Suspend detected — attempting reconnect");
        setIsReconnecting(true);
        setConnectionQuality("reconnecting");
        reconnectAttemptRef.current++;
        if (reconnectAttemptRef.current <= 5) {
          if (jitsiRetryTimerRef.current) clearTimeout(jitsiRetryTimerRef.current);
          jitsiRetryTimerRef.current = setTimeout(() => {
            if (jitsiApiRef.current) {
              if ((jitsiApiRef.current as any)._pollInterval) {
                clearInterval((jitsiApiRef.current as any)._pollInterval);
              }
              jitsiApiRef.current.dispose();
              jitsiApiRef.current = null;
            }
            setIsReconnecting(false);
            initJitsi();
          }, 2000);
        }
      });

      api.addListener("connectionQuality", (stats: any) => {
        const quality = stats?.connectionQuality;
        if (quality !== undefined) {
          const bitrateVal = stats.bitrate?.download || stats.bitrate?.upload || 0;
          const packetLossVal = stats.packetLoss?.download || stats.packetLoss?.upload || 0;
          const resolutionVal = stats.resolution ? `${stats.resolution.width || 0}x${stats.resolution.height || 0}` : "";

          setNetworkStats({
            bitrate: Math.round(bitrateVal),
            packetLoss: Math.round(packetLossVal * 10) / 10,
            resolution: resolutionVal,
          });

          if (quality > 70) {
            setConnectionQuality("good");
            if (qualityDegradeRef.current) {
              qualityDegradeRef.current = false;
              try {
                api.executeCommand("setVideoQuality", lowDataRef.current ? 180 : 720);
              } catch {}
            }
            if (audioPriorityRef.current) {
              setAudioPriorityActive(false);
            }
          } else if (quality > 40) {
            setConnectionQuality("fair");
            if (!qualityDegradeRef.current) {
              qualityDegradeRef.current = true;
              try {
                api.executeCommand("setVideoQuality", 360);
              } catch {}
            }
          } else {
            setConnectionQuality("poor");
            if (!qualityDegradeRef.current) {
              qualityDegradeRef.current = true;
            }
            try {
              api.executeCommand("setVideoQuality", 180);
            } catch {}
            if (!audioPriorityRef.current) {
              setAudioPriorityActive(true);
              try {
                api.isVideoMuted().then((muted: boolean) => {
                  if (!muted) {
                    api.executeCommand("toggleVideo");
                    setIsVideoOff(true);
                  }
                }).catch(() => {});
              } catch {}
            }
          }
        }
      });

      api.addEventListener("audioAvailabilityChanged", (data: any) => {
      });

      api.addEventListener("deviceListChanged", (devices: any) => {
      });

      jitsiApiRef.current = api;
    } catch (error) {
      console.error("[Jitsi] Failed to initialize:", error);
      setJitsiError(t("room.connectionError"));
      toast({ 
        title: t("room.connectionError"), 
        description: t("error.tryAgain"),
        variant: "default"
      });
    }
  }, [roomCode, user, toast, setLocation, connectCaptionWebSocket, stopSpeechRecognition, startSpeechRecognition, initiateE2eWithRetry]);

  useEffect(() => {
    if (roomData && user && window.JitsiMeetExternalAPI && !jitsiApiRef.current) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        initJitsi();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [roomData, user, initJitsi]);

  useEffect(() => {
    return () => {
      wsCancelledRef.current = true;
      if (wsReconnectTimerRef.current) clearTimeout(wsReconnectTimerRef.current);
      if (jitsiRetryTimerRef.current) clearTimeout(jitsiRetryTimerRef.current);
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      if (callTimeoutIntervalRef.current) clearInterval(callTimeoutIntervalRef.current);
      if (jitsiApiRef.current) {
        if ((jitsiApiRef.current as any)._pollInterval) {
          clearInterval((jitsiApiRef.current as any)._pollInterval);
        }
        jitsiApiRef.current.dispose();
        jitsiApiRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (whisperIntervalRef.current) {
        clearInterval(whisperIntervalRef.current);
        whisperIntervalRef.current = null;
      }
      if (whisperRecorderRef.current && whisperRecorderRef.current.state === "recording") {
        try { whisperRecorderRef.current.stop(); } catch {}
      }
      whisperRecorderRef.current = null;
      if (whisperStreamRef.current) {
        whisperStreamRef.current.getTracks().forEach(t => t.stop());
        whisperStreamRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [localStream]);

  // Start local camera preview immediately
  useEffect(() => {
    let mounted = true;
    let currentStream: MediaStream | null = null;
    
    const startLocalPreview = async () => {
      // Stop any existing stream first
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: voiceOnlyMode ? false : { 
            facingMode,
            width: lowDataMode ? { ideal: 320, max: 480 } : { ideal: 640, max: 720 },
            height: lowDataMode ? { ideal: 240, max: 360 } : { ideal: 480, max: 720 },
            frameRate: lowDataMode ? { ideal: 12, max: 15 } : { ideal: 20, max: 24 }
          },
          audio: true
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        currentStream = stream;
        localStreamRef.current = stream;
        setLocalStream(stream);
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        console.error("Failed to start local camera:", err);
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          setPermissionDenied("camera");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          currentStream = stream;
          localStreamRef.current = stream;
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.play().catch(() => {});
          }
        } catch (e: any) {
          console.error("Camera not available:", e);
          if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
            setPermissionDenied("camera");
          }
        }
      }
    };
    
    if (!jitsiLoaded && roomData && user) {
      startLocalPreview();
    }
    
    return () => {
      mounted = false;
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomData, user, facingMode, jitsiLoaded]);

  // Stop local preview when Jitsi loads
  useEffect(() => {
    if (jitsiLoaded && localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
  }, [jitsiLoaded]);

  useEffect(() => {
    if (!window.JitsiMeetExternalAPI && roomData && user) {
      let scriptRetries = 0;
      const maxScriptRetries = 2;

      const loadJitsiScript = async () => {
        let scriptUrl = "https://meet.jit.si/external_api.js";
        try {
          const configRes = await fetch("/api/jitsi/config", { credentials: "include" });
          if (configRes.ok) {
            const config = await configRes.json();
            if (config.jaasConfigured && config.appId) {
              scriptUrl = `https://8x8.vc/${config.appId}/external_api.js`;
              console.warn("[Jitsi] Loading JaaS script");
            } else {
              console.warn("[Jitsi] Loading fallback script");
            }
          }
        } catch (e) {
          console.warn("[Jitsi] Config unavailable, using fallback script");
        }

        const oldScript = document.querySelector('script[src*="8x8.vc"], script[src*="meet.jit.si"]');
        if (oldScript) oldScript.remove();
        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = true;
        script.onerror = () => {
          console.error("[Jitsi] Script load failed");
          if (scriptRetries < maxScriptRetries) {
            scriptRetries++;
            console.warn(`[Jitsi] Retrying script load (attempt ${scriptRetries}/${maxScriptRetries})`);
            setTimeout(() => loadJitsiScript(), 3000);
          } else {
            setJitsiError(t("room.connectionError"));
          }
        };
        document.head.appendChild(script);
      };

      loadJitsiScript();

      const checkJitsi = setInterval(() => {
        if (window.JitsiMeetExternalAPI && !jitsiApiRef.current) {
          clearInterval(checkJitsi);
          initJitsi();
        }
      }, 300);
      
      const timeout = setTimeout(() => {
        clearInterval(checkJitsi);
        if (!window.JitsiMeetExternalAPI) {
          loadJitsiScript();
          const retryCheck = setInterval(() => {
            if (window.JitsiMeetExternalAPI && !jitsiApiRef.current) {
              clearInterval(retryCheck);
              initJitsi();
            }
          }, 500);
          setTimeout(() => clearInterval(retryCheck), 20000);
        }
      }, 10000);
      
      return () => {
        clearInterval(checkJitsi);
        clearTimeout(timeout);
      };
    }
  }, [roomData, user, initJitsi]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (roomData && !isListening && !recognitionRef.current) {
      const timer = setTimeout(() => {
        startSpeechRecognition();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [roomData]);

  const endCall = useCallback(async () => {
    if (endingCallRef.current) return;
    endingCallRef.current = true;

    stopSpeechRecognition();
    stopWhisperFallback();
    if (e2eHandshakeRetryRef.current) {
      clearTimeout(e2eHandshakeRetryRef.current);
      e2eHandshakeRetryRef.current = null;
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (jitsiApiRef.current) {
      jitsiApiRef.current.executeCommand('hangup');
      jitsiApiRef.current.dispose();
      jitsiApiRef.current = null;
    }

    const captionSnapshots = captionsRef.current;
    if (captionSnapshots.length >= 3) {
      setShowCallSummary(true);
      setCallSummaryLoading(true);
      setCallSummaryData(null);
      try {
        if (summaryAbortRef.current) summaryAbortRef.current.abort();
        const controller = new AbortController();
        summaryAbortRef.current = controller;
        const segments = captionSnapshots.map(c => ({
          speaker: c.speaker,
          text: c.original,
          timestamp: c.timestamp,
        }));
        const res = await fetch("/api/call-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ captions: segments }),
          signal: controller.signal,
        });
        if (!mountedRef.current) return;
        if (!res.ok) {
          setShowCallSummary(false);
          setLocation("/chat-rooms");
          return;
        }
        const data = await res.json();
        if (data.summary) {
          setCallSummaryData({
            summary: data.summary.summary || "",
            keyPoints: data.summary.keyPoints || [],
            actionItems: data.summary.actionItems || [],
            duration: data.summary.duration || "",
            mood: data.summary.mood || "",
          });
        } else {
          setShowCallSummary(false);
          setLocation("/chat-rooms");
        }
      } catch {
        if (mountedRef.current) {
          setShowCallSummary(false);
          setLocation("/chat-rooms");
        }
      } finally {
        if (mountedRef.current) setCallSummaryLoading(false);
      }
    } else {
      setLocation("/chat-rooms");
    }
  }, [setLocation, stopSpeechRecognition, stopWhisperFallback, localStream]);

  const sendChatMessage = useCallback(async () => {
    if (!messageInput.trim()) return;
    
    const activeEl = document.activeElement as HTMLElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
      activeEl.blur();
    }
    
    const originalText = messageInput.trim();
    const messageId = Date.now().toString();
    const targetLang = subtitleLanguageRef.current;
    
    
    // Show message immediately with translating status - translate if not English or none
    const shouldTranslate = !!(targetLang && targetLang !== "none" && targetLang !== "en");
    const newMessage: ChatMessage = {
      id: messageId,
      sender: "you",
      text: originalText,
      isTranslating: shouldTranslate ? true : false,
      timestamp: Date.now(),
    };
    
    setChatMessages(prev => [...prev, newMessage]);
    setMessageInput("");
    
    // Translate message before sending if language is set (not English)
    let messageToSend = originalText;
    if (shouldTranslate) {
      try {
        const response = await fetch("/api/v1/caption-translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: originalText,
            targetLang: targetLang,
            sourceLang: "en",
          }),
        });
        if (response.ok) {
          const data = await response.json();
          messageToSend = data.translatedText;
          // Update UI to show the translation
          setChatMessages(prev => prev.map(m => 
            m.id === messageId 
              ? { ...m, translatedText: messageToSend, isTranslating: false }
              : m
          ));
        } else {
          console.error("Translation API failed:", response.status);
          setChatMessages(prev => prev.map(m => 
            m.id === messageId ? { ...m, isTranslating: false } : m
          ));
        }
      } catch (error) {
        console.error("Chat translation error:", error);
        setChatMessages(prev => prev.map(m => 
          m.id === messageId ? { ...m, isTranslating: false } : m
        ));
      }
    }
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const encrypted = await e2eEncrypt(messageToSend);
      if (encrypted) {
        wsRef.current.send(JSON.stringify({
          type: "room-chat",
          e2e: true,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          counter: encrypted.counter,
          roomCode,
        }));
      } else {
        wsRef.current.send(JSON.stringify({
          type: "room-chat",
          text: messageToSend,
          roomCode,
        }));
      }
    } else {
      fetch(`/api/room-messages/${roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: messageToSend, fromName: safeDisplayName(user?.firstName, user?.lastName) }),
      }).catch(err => console.error("HTTP chat fallback error:", err));
    }
    
  }, [messageInput, roomCode, user, e2eEncrypt]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold">{t("room.joinRoom")}</h1>
          <BackTriangle onClick={() => setLocation("/chat-rooms")} testId="button-back-call-login" />
        </div>
      </div>
    );
  }

  if (loadingRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (roomError || !roomData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-destructive">{t("room.roomNotFound")}</h1>
          <BackTriangle onClick={() => setLocation("/chat-rooms")} testId="button-back-call-error" />
        </div>
      </div>
    );
  }

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (isInCall && participantCount <= 1) {
      setCallTimeoutActive(true);
      setCallTimeoutSeconds(30);
      let countdown = 30;
      callTimeoutIntervalRef.current = setInterval(() => {
        countdown--;
        setCallTimeoutSeconds(countdown);
        if (countdown <= 0) {
          if (callTimeoutIntervalRef.current) clearInterval(callTimeoutIntervalRef.current);
        }
      }, 1000);
      callTimeoutRef.current = setTimeout(() => {
        if (callTimeoutIntervalRef.current) clearInterval(callTimeoutIntervalRef.current);
        setCallTimeoutActive(false);
        toast({
          title: "No answer",
          description: "No one joined the call. Ending automatically.",
          variant: "default",
        });
        endCall();
      }, 30000);
    } else {
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
      if (callTimeoutIntervalRef.current) {
        clearInterval(callTimeoutIntervalRef.current);
        callTimeoutIntervalRef.current = null;
      }
      setCallTimeoutActive(false);
      setCallTimeoutSeconds(30);
    }
    return () => {
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      if (callTimeoutIntervalRef.current) clearInterval(callTimeoutIntervalRef.current);
    };
  }, [isInCall, participantCount]);

  const isWaitingForOthers = participantCount <= 1;

  useRingtone(isInCall && isWaitingForOthers && !jitsiError && !permissionDenied);

  useEffect(() => {
    const goOffline = () => setNetworkOffline(true);
    const goOnline = () => {
      setNetworkOffline(false);

      // Drain any Whisper chunks buffered while offline
      drainQueue({
        onVoiceMessage: async () => false,
        onWhisperChunk: async (payload) => {
          try {
            const blob = base64ToBlob(payload.audioBase64, payload.mimeType);
            if (blob.size < 1000) return true; // too small — skip
            const formData = new FormData();
            formData.append("audio", blob, `chunk.${payload.extension}`);
            const res = await fetch("/api/transcribe", { method: "POST", credentials: "include", body: formData });
            if (res.ok) {
              const data = await res.json();
              if (data.text && data.text.trim()) {
                addCaptionRef.current?.(data.text.trim(), "you");
              }
              setBufferedCaptionCount(prev => Math.max(0, prev - 1));
            }
            return res.ok;
          } catch {
            return false;
          }
        },
      });

      if (jitsiApiRef.current && isInCall) {
        try {
          jitsiApiRef.current.executeCommand("sendEndpointMessage", "", { type: "iceRestart" });
        } catch {}
        setIsReconnecting(true);
        setConnectionQuality("reconnecting");
        if (jitsiRetryTimerRef.current) clearTimeout(jitsiRetryTimerRef.current);
        jitsiRetryTimerRef.current = setTimeout(() => {
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
          if (jitsiApiRef.current) {
            if ((jitsiApiRef.current as any)._pollInterval) {
              clearInterval((jitsiApiRef.current as any)._pollInterval);
            }
            jitsiApiRef.current.dispose();
            jitsiApiRef.current = null;
          }
          setIsReconnecting(false);
          initJitsi();
        }, 1500);
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [isInCall, initJitsi]);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === "audioinput");
      const outputs = devices.filter(d => d.kind === "audiooutput");
      const videos = devices.filter(d => d.kind === "videoinput");
      setAudioDevices(inputs);
      setAudioOutputDevices(outputs);
      setVideoDevices(videos);
      setSelectedAudioInput(prev => prev || (inputs[0]?.deviceId ?? ""));
      setSelectedAudioOutput(prev => prev || (outputs[0]?.deviceId ?? ""));
      setSelectedVideoInput(prev => prev || (videos[0]?.deviceId ?? ""));
    } catch (e) {
      console.warn("Could not enumerate devices:", e);
    }
  }, []);

  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  const toggleVoiceOnly = useCallback(() => {
    const newVoiceOnly = !voiceOnlyMode;
    setVoiceOnlyMode(newVoiceOnly);
    if (jitsiApiRef.current) {
      if (newVoiceOnly) {
        jitsiApiRef.current.isVideoMuted().then((muted: boolean) => {
          if (!muted) {
            jitsiApiRef.current.executeCommand("toggleVideo");
            setIsVideoOff(true);
          }
        }).catch(() => {});
        try {
          jitsiApiRef.current.executeCommand("setVideoQuality", 0);
        } catch {}
      } else {
        jitsiApiRef.current.isVideoMuted().then((muted: boolean) => {
          if (muted) {
            jitsiApiRef.current.executeCommand("toggleVideo");
            setIsVideoOff(false);
          }
        }).catch(() => {});
        try {
          jitsiApiRef.current.executeCommand("setVideoQuality", lowDataMode ? 180 : 720);
        } catch {}
      }
    }
    toast({
      title: newVoiceOnly ? "Voice Only Mode" : "Video Mode",
      description: newVoiceOnly ? "Video disabled to save data" : "Video re-enabled",
    });
  }, [voiceOnlyMode, lowDataMode, toast]);

  const toggleLowDataMode = useCallback((enabled: boolean) => {
    setLowDataMode(enabled);
    try { localStorage.setItem(STORAGE_KEYS.lowData, String(enabled)); } catch {}
    if (jitsiApiRef.current) {
      try {
        jitsiApiRef.current.executeCommand("setVideoQuality", enabled ? 180 : 720);
      } catch {}
    }
    toast({
      title: enabled ? "Low Data Mode On" : "Low Data Mode Off",
      description: enabled ? "Reduced quality for slower networks" : "Full quality restored",
    });
  }, [toast]);

  const callAgain = useCallback(() => {
    if (wsRef.current) {
      wsCancelledRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (jitsiApiRef.current) {
      if ((jitsiApiRef.current as any)._pollInterval) {
        clearInterval((jitsiApiRef.current as any)._pollInterval);
      }
      jitsiApiRef.current.dispose();
      jitsiApiRef.current = null;
    }
    setShowCallSummary(false);
    setCallSummaryData(null);
    endingCallRef.current = false;
    setJitsiError(null);
    setJitsiLoaded(false);
    setIsInCall(false);
    setParticipantCount(1);
    setConnectionQuality("connecting");
    setCaptions([]);
    setChatMessages([]);
    setIsReconnecting(false);
    setCallTimeoutActive(false);
    setCallTimeoutSeconds(30);
    setAudioPriorityActive(false);
    reconnectAttemptRef.current = 0;
    qualityDegradeRef.current = false;
    setE2eVerified(false);
    setE2eVerifying(false);
    setTimeout(() => initJitsi(), 300);
  }, [initJitsi]);

  useEffect(() => {
    if (roomCode) lastRoomCodeRef.current = roomCode;
  }, [roomCode]);

  const switchAudioInput = useCallback(async (deviceId: string) => {
    setSelectedAudioInput(deviceId);
    if (jitsiApiRef.current) {
      try {
        await jitsiApiRef.current.setAudioInputDevice(deviceId, deviceId);
      } catch {
        try {
          jitsiApiRef.current.executeCommand("setAudioInputDevice", deviceId);
        } catch (e) { console.warn("Failed to switch audio input:", e); }
      }
    }
  }, []);

  const switchAudioOutput = useCallback(async (deviceId: string) => {
    setSelectedAudioOutput(deviceId);
    if (jitsiApiRef.current) {
      try {
        await jitsiApiRef.current.setAudioOutputDevice(deviceId, deviceId);
      } catch {
        try {
          jitsiApiRef.current.executeCommand("setAudioOutputDevice", deviceId);
        } catch (e) { console.warn("Failed to switch audio output:", e); }
      }
    }
  }, []);

  const switchVideoInput = useCallback(async (deviceId: string) => {
    setSelectedVideoInput(deviceId);
    if (jitsiApiRef.current) {
      try {
        await jitsiApiRef.current.setVideoInputDevice(deviceId, deviceId);
      } catch {
        try {
          jitsiApiRef.current.executeCommand("setVideoInputDevice", deviceId);
        } catch (e) { console.warn("Failed to switch video input:", e); }
      }
    }
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-muted overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-background gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {otherRoomMembers.length > 0 && (
            <span className="text-sm font-medium text-foreground truncate" data-testid="room-members-header">
              {otherRoomMembers.map(m => safeDisplayName(m.user?.firstName, m.user?.lastName, m.username, "Member")).join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setLocation(`/chat-rooms/${roomCode}`)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
            data-testid="button-switch-text"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Text
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0" data-testid="status-connection">
          {!isOnline ? (
            <>
              <WifiOff className="w-3 h-3 text-red-500" />
              <span className="text-red-500 text-xs font-medium">{t("room.connectionOffline")}</span>
            </>
          ) : isReconnecting || connectionQuality === "reconnecting" ? (
            <>
              <RefreshCw className="w-3 h-3 text-amber-500 animate-spin" />
              <span className="text-amber-500 text-xs font-medium">Reconnecting...</span>
            </>
          ) : connectionQuality === "connecting" ? (
            <>
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-500 text-xs">{t("room.captionsStarting")}</span>
            </>
          ) : participantCount > 1 && e2eVerified ? (
            <div className="flex flex-col items-center gap-0.5">
              <button
                onClick={() => setShowSafetyNumber(prev => !prev)}
                className="flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer"
                data-testid="button-e2e-status"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-500 text-xs font-medium">E2E Encrypted</span>
              </button>
              {showSafetyNumber && e2eSafetyNumber && (
                <div className="bg-black/80 rounded px-2 py-1 mt-1" data-testid="text-safety-number">
                  <span className="text-[10px] text-green-400 font-mono tracking-wider">{e2eSafetyNumber}</span>
                </div>
              )}
            </div>
          ) : participantCount > 1 && e2eVerifying ? (
            <>
              <Shield className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span className="text-amber-500 text-xs">Verifying...</span>
            </>
          ) : participantCount > 1 ? (
            <>
              <Shield className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-blue-500 text-xs">{t("room.connected")}</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-blue-500 text-xs">{t("room.captionsActive")}</span>
            </>
          )}
          {isInCall && connectionQuality !== "connecting" && connectionQuality !== "reconnecting" && (
            <div className="flex items-center gap-0.5 ml-1" data-testid="quality-bars" title={networkStats ? `${networkStats.bitrate}kbps | ${networkStats.packetLoss}% loss` : ""}>
              <div className={`w-1 h-1.5 rounded-sm ${connectionQuality === "good" || connectionQuality === "fair" ? "bg-green-500" : "bg-red-500"}`} />
              <div className={`w-1 h-2.5 rounded-sm ${connectionQuality === "good" || connectionQuality === "fair" ? "bg-green-500" : "bg-gray-600"}`} />
              <div className={`w-1 h-3.5 rounded-sm ${connectionQuality === "good" ? "bg-green-500" : "bg-gray-600"}`} />
            </div>
          )}
          {audioPriorityActive && (
            <span className="text-amber-400 text-[9px] ml-1 font-medium" data-testid="audio-priority-badge">AUDIO</span>
          )}
          {lowDataMode && (
            <span className="text-amber-400 text-[9px] ml-1 font-medium" data-testid="low-data-badge">LOW</span>
          )}
          {voiceOnlyMode && (
            <span className="text-blue-400 text-[9px] ml-1 font-medium" data-testid="voice-only-badge">VOICE</span>
          )}
        </div>
      </div>

      {/* 50-50 Split Video Container - Shows immediately */}
      <div className={`relative overflow-hidden bg-[#1a1a2e] ${
        displaySize === "fullscreen" 
          ? "fixed inset-0 z-40 m-0" 
          : displaySize === "large" 
            ? "flex-1 mx-2 my-2 rounded-2xl" 
            : "flex-1 mx-4 my-4 rounded-2xl"
      }`}>
        {/* Split View Layout - Always 50-50 */}
        <div className="absolute inset-0 flex flex-col">
          {/* Top Half - Room Info Card (Always visible) */}
          <div className="relative h-1/2 bg-card flex items-center justify-center p-4 z-20">
            {isWaitingForOthers ? (
              /* Waiting info card */
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center relative">
                  <Users className="w-8 h-8 text-primary" />
                  {isInCall && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center animate-pulse" data-testid="ringing-indicator">
                      <Volume2 className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <h2 className="text-xl font-bold mb-1">{t("room.joinedRoom")}</h2>
                <p className="text-muted-foreground text-sm mb-4">{t("room.waitingForOthers")}</p>
                <div 
                  className="bg-primary/10 rounded-lg px-6 py-3 cursor-pointer hover:bg-primary/20 transition-colors"
                  onClick={copyRoomCode}
                  data-testid="button-copy-room-code"
                >
                  <p className="text-xs text-muted-foreground mb-1">{t("room.shareLink")}:</p>
                  <p className="text-2xl font-bold tracking-wider text-primary">{roomCode}</p>
                  {codeCopied && <p className="text-xs text-primary mt-1">{t("room.codeCopied")}</p>}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {t("room.copyCode")}
                </p>
                {callTimeoutActive && (
                  <div className="mt-4 flex flex-col items-center gap-1" data-testid="call-timeout-indicator">
                    <div className="w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center">
                      <span className="text-amber-400 text-sm font-bold">{callTimeoutSeconds}</span>
                    </div>
                    <p className="text-xs text-amber-400/80">Auto-ending if no one joins</p>
                  </div>
                )}
              </div>
            ) : (
              /* Participant connected - show their info */
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-blue-600/15 rounded-full flex items-center justify-center">
                  <Users className="w-8 h-8 text-blue-600 dark:text-blue-500" />
                </div>
                <p className="text-lg font-medium text-blue-600 dark:text-blue-500">{t("room.connected")}</p>
                {otherRoomMembers.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1" data-testid="room-connected-members">
                    with {otherRoomMembers.map(m => safeDisplayName(m.user?.firstName, m.user?.lastName, m.username, "Member")).join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Bottom Half - Your Video */}
          <div className="relative h-1/2 bg-[#1a1a2e]">
            {/* Local Video Preview */}
            {!jitsiLoaded && !jitsiError && (
              <>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                />
                {/* Loading indicator overlay */}
                {!localStream && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
                    <div className="text-center space-y-3">
                      <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-white text-sm">{t("room.connecting")}</p>
                    </div>
                  </div>
                )}
                {/* Frosted overlay when video is paused - matte grey with blur */}
                {isVideoOff && (
                  <div className="absolute inset-0 bg-gray-300/60 backdrop-blur-md flex items-center justify-center">
                    <div className="text-center">
                      <VideoOff className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-700 text-sm font-medium">{t("room.videoOff")}</p>
                    </div>
                  </div>
                )}
              </>
            )}
            {/* "You" label */}
            <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded-full z-20">
              <span className="text-white text-xs font-medium">{t("room.videoOn")}</span>
            </div>
            {/* Language indicator badge - top right */}
            <div className="absolute top-2 right-2 bg-primary/80 backdrop-blur-sm px-2 py-0.5 rounded-full z-20 flex items-center gap-1">
              <Languages className="w-3 h-3 text-white" />
              <span className="text-white text-xs font-medium">
                {LANGUAGES.find(l => l.code === subtitleLanguage)?.name || "English"}
              </span>
            </div>
          </div>
        </div>

        {/* Jitsi Video - Only covers bottom half when loaded */}
        <div 
          ref={jitsiContainerRef} 
          className={`absolute bottom-0 left-0 right-0 h-1/2 ${jitsiLoaded ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}
          data-testid="jitsi-container"
        />
        
        {/* Frosted overlay for Jitsi when video is paused - matte grey with blur */}
        {jitsiLoaded && isVideoOff && (
          <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gray-300/60 backdrop-blur-md flex items-center justify-center z-15">
            <div className="text-center">
              <VideoOff className="w-12 h-12 text-gray-600 mx-auto mb-2" />
              <p className="text-gray-700 text-sm font-medium">{t("room.videoOff")}</p>
              <p className="text-gray-500 text-xs mt-1">{t("room.captionsOn")}</p>
            </div>
          </div>
        )}

        {/* Reconnecting overlay */}
        {isReconnecting && !jitsiError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 z-25" data-testid="reconnecting-overlay">
            <div className="text-center space-y-3 p-4">
              <RefreshCw className="w-10 h-10 text-amber-400 mx-auto animate-spin" />
              <p className="text-white text-lg font-medium">Reconnecting...</p>
              <p className="text-white/60 text-sm">Trying to restore your connection</p>
              <div className="flex justify-center gap-1 mt-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className={`w-2 h-2 rounded-full ${i < reconnectAttemptRef.current ? "bg-amber-400" : "bg-gray-600"}`} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {jitsiError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e] z-20">
            <div className="text-center space-y-4 p-4">
              <WifiOff className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-white text-lg">{jitsiError}</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => { setJitsiError(null); setJoinTimedOut(false); initJitsi(); }} data-testid="button-retry-connection">
                  <RefreshCw className="w-4 h-4 mr-2" />{t("room.retryConnection")}
                </Button>
                <Button variant="outline" onClick={endCall} data-testid="button-leave-call">
                  {t("room.endCall")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Join Timeout - Jitsi taking too long */}
        {joinTimedOut && !jitsiLoaded && !jitsiError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/90 z-20">
            <div className="text-center space-y-4 p-4">
              <div className="w-12 h-12 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-white text-base">{t("room.connecting")}</p>
              <p className="text-white/60 text-sm">{t("error.connectionLost")}</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => { setJoinTimedOut(false); setJitsiError(null); if (jitsiApiRef.current) { jitsiApiRef.current.dispose(); jitsiApiRef.current = null; } initJitsi(); }} data-testid="button-retry-join">
                  <RefreshCw className="w-4 h-4 mr-2" />{t("room.retryConnection")}
                </Button>
                <Button variant="outline" onClick={endCall}>
                  {t("room.endCall")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Permission Denied Overlay */}
        {permissionDenied && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e] z-30" data-testid="permission-denied-overlay">
            <div className="text-center space-y-4 p-6 max-w-xs">
              <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
                {permissionDenied === "mic" ? (
                  <MicOff className="w-8 h-8 text-red-400" />
                ) : permissionDenied === "both" ? (
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                ) : (
                  <CameraOff className="w-8 h-8 text-red-400" />
                )}
              </div>
              <h3 className="text-white text-lg font-semibold">
                {permissionDenied === "mic" ? "Microphone Access Denied" : permissionDenied === "both" ? "Camera & Mic Access Denied" : "Camera Access Denied"}
              </h3>
              <p className="text-white/60 text-sm">
                {permissionDenied === "mic"
                  ? "Please allow microphone access in your browser settings to use voice features."
                  : permissionDenied === "both"
                  ? "Please allow camera and microphone access in your browser settings to join the call."
                  : "Please allow camera access in your browser settings to share your video."}
              </p>
              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    const constraints = permissionDenied === "mic"
                      ? { audio: true }
                      : permissionDenied === "camera"
                      ? { video: true }
                      : { video: true, audio: true };
                    setPermissionDenied(null);
                    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
                      stream.getTracks().forEach(t => t.stop());
                      enumerateDevices();
                      initJitsi();
                    }).catch(() => {
                      setPermissionDenied(permissionDenied);
                    });
                  }}
                  data-testid="button-retry-permission"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />Try Again
                </Button>
                <Button variant="outline" className="w-full" onClick={endCall} data-testid="button-leave-permission">
                  Leave Call
                </Button>
              </div>
              <p className="text-white/40 text-xs">
                Tip: Check the lock icon in your browser's address bar to manage permissions
              </p>
            </div>
          </div>
        )}

        {/* Network Offline Overlay */}
        {networkOffline && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/90 z-35" data-testid="network-offline-overlay">
            <div className="text-center space-y-4 p-6 max-w-xs">
              <div className="w-16 h-16 mx-auto bg-amber-500/20 rounded-full flex items-center justify-center">
                <WifiOff className="w-8 h-8 text-amber-400" />
              </div>
              <h3 className="text-white text-lg font-semibold">No Internet Connection</h3>
              <p className="text-white/60 text-sm">
                Your device appears to be offline. The call will resume automatically when your connection is restored.
              </p>
              {bufferedCaptionCount > 0 && (
                <p className="text-amber-300 text-xs" data-testid="buffered-caption-count">
                  {bufferedCaptionCount} caption{bufferedCaptionCount !== 1 ? "s" : ""} buffered, syncing when reconnected
                </p>
              )}
              <div className="flex justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <Button variant="outline" onClick={endCall} data-testid="button-leave-offline">
                Leave Call
              </Button>
            </div>
          </div>
        )}

        {/* Caption History - Scrollable panel at the bottom */}
        {(captions.length > 0 || interimText) && (
          <SectionBoundary label="Captions">
          <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col" style={{ maxHeight: '100px' }}>
            <div
              ref={captionContainerRef}
              className="overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin" data-scrollable
              style={{ WebkitOverflowScrolling: "touch" }}
              data-testid="caption-history"
            >
              {captions.map((caption) => (
                <div
                  key={caption.id}
                  className={`px-1 py-0.5 text-sm max-w-[95%] ${
                    caption.speaker === "you"
                      ? "ml-auto text-right"
                      : "mr-auto text-left"
                  }`}
                >
                  <p className="font-semibold text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)' }}>
                    {caption.original}
                  </p>
                  {caption.isTranslating && (
                    <p className="text-yellow-300 text-xs italic mt-0.5 animate-pulse" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{t("room.translating")}</p>
                  )}
                  {caption.translated && caption.translated !== caption.original && !caption.isTranslating && (
                    <p className="text-yellow-300 text-xs italic mt-0.5" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)' }}>
                      {caption.translated}
                    </p>
                  )}
                </div>
              ))}
              {interimText && (
                <div className="ml-auto px-1 py-0.5 text-sm max-w-[95%] text-right">
                  <p className="font-semibold text-white/70" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)' }}>
                    {interimText}
                  </p>
                </div>
              )}
            </div>
          </div>
          </SectionBoundary>
        )}
      </div>

      {/* Bottom Control Bar - Compact */}
      <div className="bg-[#2d2d3a] px-2 py-2 safe-area-pb">
        {/* Control Buttons */}
        <div className="flex items-center justify-center gap-2 mb-1">
          {/* Mute - Muting stops captions */}
          <div className="flex flex-col items-center">
            <button
              onClick={toggleMute}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isMuted ? "bg-red-500/80" : "bg-white/10"
              }`}
              data-testid="button-toggle-mute"
            >
              {isMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
            </button>
            <span className="text-white/60 text-[10px] mt-0.5">{isMuted ? t("room.micOff") : t("room.micOn")}</span>
          </div>

          {/* Voice Only / Flip Camera */}
          <div className="flex flex-col items-center">
            {voiceOnlyMode ? (
              <button
                onClick={toggleVoiceOnly}
                className="w-10 h-10 rounded-full bg-blue-500/80 flex items-center justify-center"
                data-testid="button-voice-only"
              >
                <Headphones className="w-4 h-4 text-white" />
              </button>
            ) : (
              <button
                onClick={flipCamera}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
                data-testid="button-flip-camera"
              >
                <SwitchCamera className="w-4 h-4 text-white" />
              </button>
            )}
            <span className="text-white/60 text-[10px] mt-0.5">{voiceOnlyMode ? "Voice" : t("room.switchCamera")}</span>
          </div>

          {/* End Call */}
          <div className="flex flex-col items-center">
            <button
              onClick={endCall}
              className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center"
              data-testid="button-end-call"
            >
              <PhoneOff className="w-5 h-5 text-white" />
            </button>
            <span className="text-white/60 text-[10px] mt-0.5">{t("room.endCall")}</span>
          </div>

          {/* Video Toggle - Pausing video keeps captions working */}
          <div className="flex flex-col items-center">
            <button
              onClick={toggleVideo}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isVideoOff ? "bg-red-500/80" : "bg-white/10"
              }`}
              data-testid="button-toggle-video"
            >
              {isVideoOff ? <VideoOff className="w-4 h-4 text-white" /> : <Video className="w-4 h-4 text-white" />}
            </button>
            <span className="text-white/60 text-[10px] mt-0.5">{isVideoOff ? t("room.videoOff") : t("room.videoOn")}</span>
          </div>

          {/* Chat */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => setShowChat(!showChat)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                showChat ? "bg-white/20" : "bg-white/10"
              }`}
              data-testid="button-toggle-chat"
            >
              <MessageCircle className="w-4 h-4 text-white" />
            </button>
            <span className="text-white/60 text-[10px] mt-0.5">{t("room.chat")}</span>
          </div>

          {/* Settings */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => setShowSettings(true)}
              className="w-10 h-10 rounded-full bg-primary flex items-center justify-center transition-colors"
              data-testid="button-open-settings"
            >
              <Settings className="w-4 h-4 text-white" />
            </button>
            <span className="text-white/60 text-[10px] mt-0.5">{t("room.settings")}</span>
          </div>
        </div>
      </div>

      {/* Chat Panel - Small overlay at bottom */}
      {showChat && (
        <SectionBoundary label="Chat">
        <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm z-50 flex flex-col rounded-t-2xl border-t max-h-[40%]">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{t("room.chat")}</h3>
              {subtitleLanguage && subtitleLanguage !== "none" && subtitleLanguage !== "en" && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  → {LANGUAGES.find(l => l.code === subtitleLanguage)?.name || subtitleLanguage}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowChat(false)}
              data-testid="button-close-chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-[80px]" data-scrollable>
            {chatMessages.length === 0 ? (
              <p className="text-muted-foreground text-xs text-center py-2">
                {t("room.noOneHere")}
              </p>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-1.5 ${
                      msg.sender === "you"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {msg.translatedText ? (
                      <div className="space-y-1">
                        <p className="text-sm">{msg.text}</p>
                        <p className={`text-xs ${msg.sender === "you" ? "text-primary-foreground/70" : "text-amber-500"}`}>
                          → {msg.translatedText}
                        </p>
                      </div>
                    ) : msg.isTranslating ? (
                      <div className="space-y-1">
                        <p className="text-sm">{msg.text}</p>
                        <p className={`text-xs animate-pulse ${msg.sender === "you" ? "text-primary-foreground/70" : "text-amber-500"}`}>
                          {t("room.translating")}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm">{msg.text}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="px-4 py-2 border-t">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChatMessage();
              }}
              className="flex gap-2"
            >
              <Input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder={t("room.messagePlaceholder")}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button type="submit" size="icon" data-testid="button-send-message">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
        </SectionBoundary>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <SectionBoundary label="Settings">
        <div className="absolute inset-0 bg-background z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="font-semibold text-lg">{t("room.settings")}</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(false)}
              data-testid="button-close-settings"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6" data-scrollable>
            {/* Caption Language */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Languages className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">{t("settings.subtitleLanguage")}</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("room.translate")}
              </p>
              <Select value={subtitleLanguage} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-full" data-testid="settings-select-language">
                  <SelectValue>
                    {LANGUAGES.find(l => l.code === subtitleLanguage)?.name || "English"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Microphone Selection */}
            {audioDevices.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Mic className="w-5 h-5 text-primary" />
                  <Label className="text-base font-medium">Microphone</Label>
                </div>
                <Select value={selectedAudioInput} onValueChange={switchAudioInput}>
                  <SelectTrigger className="w-full" data-testid="settings-select-mic">
                    <SelectValue placeholder="Default Microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Speaker Selection */}
            {audioOutputDevices.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-primary" />
                  <Label className="text-base font-medium">Speaker</Label>
                </div>
                <Select value={selectedAudioOutput} onValueChange={switchAudioOutput}>
                  <SelectTrigger className="w-full" data-testid="settings-select-speaker">
                    <SelectValue placeholder="Default Speaker" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioOutputDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Speaker ${audioOutputDevices.indexOf(device) + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Camera Selection */}
            {videoDevices.length > 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-primary" />
                  <Label className="text-base font-medium">Camera</Label>
                </div>
                <Select value={selectedVideoInput} onValueChange={switchVideoInput}>
                  <SelectTrigger className="w-full" data-testid="settings-select-camera">
                    <SelectValue placeholder="Default Camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {videoDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${videoDevices.indexOf(device) + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Captions Status - Always On */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Subtitles className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">{t("room.captions")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-600/80 animate-pulse" />
                <p className="text-sm text-muted-foreground">
                  {t("room.captionsOn")}
                </p>
              </div>
            </div>

            {/* AI Caption Enhancement Toggle */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">AI Caption Enhancement</Label>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground pr-2">
                  Clean up speech-to-text with AI for better readability
                </p>
                <Switch
                  checked={aiCaptionEnhance}
                  onCheckedChange={setAiCaptionEnhance}
                  data-testid="switch-ai-caption-enhance"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${aiCaptionEnhance ? "bg-violet-600 dark:bg-violet-400 animate-pulse" : "bg-muted-foreground"}`} />
                <p className="text-xs text-muted-foreground">
                  {aiCaptionEnhance ? "Kimi AI enhancing captions in real-time" : "Showing raw speech-to-text"}
                </p>
              </div>
            </div>

            {/* Chat Messages Translation */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">{t("room.chat")}</Label>
              </div>
              <div className="flex items-center gap-2">
                {subtitleLanguage && subtitleLanguage !== "none" && subtitleLanguage !== "en" ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-blue-600/80 animate-pulse" />
                    <p className="text-sm text-muted-foreground">
                      {t("room.translatedText")}: {LANGUAGES.find(l => l.code === subtitleLanguage)?.name || subtitleLanguage}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t("room.translate")}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Low Data Mode */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">Low Data Mode</Label>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground pr-2">
                  Reduce video quality to save data on slow networks
                </p>
                <Switch
                  checked={lowDataMode}
                  onCheckedChange={toggleLowDataMode}
                  data-testid="switch-low-data-mode"
                />
              </div>
              {lowDataMode && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <p className="text-xs text-amber-500">Active, max 180p, 15fps</p>
                </div>
              )}
            </div>

            {/* Voice Only Mode */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Headphones className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">Voice Only</Label>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground pr-2">
                  Disable video completely, audio only call
                </p>
                <Switch
                  checked={voiceOnlyMode}
                  onCheckedChange={() => toggleVoiceOnly()}
                  data-testid="switch-voice-only"
                />
              </div>
              {voiceOnlyMode && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <p className="text-xs text-blue-500">Voice only, no video sent or received</p>
                </div>
              )}
            </div>

            {/* Display Size */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">{t("room.screenShare")}</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("room.settings")}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant={displaySize === "normal" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setDisplaySize("normal");
                    toast({ title: t("common.success") });
                  }}
                  data-testid="settings-size-normal"
                >
                  Normal
                </Button>
                <Button
                  variant={displaySize === "large" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setDisplaySize("large");
                    toast({ title: t("common.success") });
                  }}
                  data-testid="settings-size-large"
                >
                  Large
                </Button>
                <Button
                  variant={displaySize === "fullscreen" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setDisplaySize("fullscreen");
                    if (document.documentElement.requestFullscreen) {
                      document.documentElement.requestFullscreen();
                    }
                    toast({ title: t("common.success") });
                  }}
                  data-testid="settings-size-fullscreen"
                >
                  Fullscreen
                </Button>
              </div>
            </div>

            {/* Room Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <Label className="text-base font-medium">{t("room.roomCode")}</Label>
              </div>
              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("room.roomCode")}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{roomCode}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        navigator.clipboard.writeText(roomCode || "");
                        toast({ title: t("room.codeCopied") });
                      }}
                      data-testid="settings-copy-code"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("room.participants")}</span>
                  <span className="font-medium">{participantCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("room.connected")}</span>
                  <span className={`font-medium ${participantCount > 1 ? "text-blue-600 dark:text-blue-500" : "text-amber-500"}`}>
                    {participantCount > 1 ? t("room.connected") : t("room.waitingForOthers")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t">
            <Button 
              className="w-full" 
              onClick={() => setShowSettings(false)}
              data-testid="button-done-settings"
            >
              {t("common.ok")}
            </Button>
          </div>
        </div>
        </SectionBoundary>
      )}

      {showCallSummary && (
        <SectionBoundary label="Call Summary">
        <div className="fixed inset-0 z-[60] bg-background flex flex-col" data-testid="call-summary-overlay">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Call Summary</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setShowCallSummary(false); setLocation("/chat-rooms"); }}
              data-testid="button-close-summary"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4" data-scrollable>
            {callSummaryLoading && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4" data-testid="summary-loading">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-muted-foreground text-sm">Generating your call summary...</p>
                <p className="text-muted-foreground/60 text-xs">Powered by Kimi AI</p>
              </div>
            )}

            {callSummaryData && !callSummaryLoading && (
              <>
                {callSummaryData.mood && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {callSummaryData.duration && <span>{callSummaryData.duration}</span>}
                    {callSummaryData.duration && callSummaryData.mood && <span>·</span>}
                    <span className="capitalize">{callSummaryData.mood}</span>
                  </div>
                )}

                <Card className="p-4 space-y-2 border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="summary-overview">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-primary" />
                    <h3 className="font-medium text-sm">Overview</h3>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{callSummaryData.summary}</p>
                </Card>

                {callSummaryData.keyPoints.length > 0 && (
                  <Card className="p-4 space-y-2 border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="summary-key-points">
                    <div className="flex items-center gap-2 mb-1">
                      <ListChecks className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <h3 className="font-medium text-sm">Key Points</h3>
                    </div>
                    <ul className="space-y-1.5">
                      {callSummaryData.keyPoints.map((point, i) => (
                        <li key={i} className="text-sm text-foreground flex items-start gap-2">
                          <span className="text-blue-600 dark:text-blue-400 mt-1 shrink-0">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {callSummaryData.actionItems.length > 0 && (
                  <Card className="p-4 space-y-2 border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(120deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }} data-testid="summary-action-items">
                    <div className="flex items-center gap-2 mb-1">
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <h3 className="font-medium text-sm">Action Items</h3>
                    </div>
                    <ul className="space-y-1.5">
                      {callSummaryData.actionItems.map((item, i) => (
                        <li key={i} className="text-sm text-foreground flex items-start gap-2">
                          <span className="w-4 h-4 mt-0.5 shrink-0 rounded border border-green-600/40 dark:border-green-400/40 flex items-center justify-center text-[10px] text-green-600 dark:text-green-400">{i + 1}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            )}
          </div>

          {callSummaryData && !callSummaryLoading && (
            <div className="p-4 border-t space-y-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  const text = [
                    "Call Summary",
                    "",
                    callSummaryData.summary,
                    "",
                    callSummaryData.keyPoints.length > 0 ? "Key Points:\n" + callSummaryData.keyPoints.map(p => `- ${p}`).join("\n") : "",
                    callSummaryData.actionItems.length > 0 ? "\nAction Items:\n" + callSummaryData.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n") : "",
                  ].filter(Boolean).join("\n");
                  navigator.clipboard.writeText(text);
                  setSummaryCopied(true);
                  setTimeout(() => setSummaryCopied(false), 2000);
                }}
                data-testid="button-copy-summary"
              >
                {summaryCopied ? <Check className="w-4 h-4 mr-2" /> : <ClipboardCopy className="w-4 h-4 mr-2" />}
                {summaryCopied ? "Copied!" : "Copy Summary"}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={callAgain}
                data-testid="button-call-again"
              >
                <Phone className="w-4 h-4 mr-2" />Call Again
              </Button>
              <Button
                className="w-full"
                onClick={() => { setShowCallSummary(false); setLocation("/chat-rooms"); }}
                data-testid="button-done-summary"
              >
                Done
              </Button>
            </div>
          )}
        </div>
        </SectionBoundary>
      )}
    </div>
  );
}
