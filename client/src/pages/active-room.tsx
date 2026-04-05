import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BackTriangle from "@/components/BackTriangle";
import {
  Video,
  MessageSquare,
  Copy,
  Check,
  Users,
  Send,
  X,
  Languages,
  LogOut,
  UserMinus,
  ImageIcon,
  Camera,
  ArrowLeft,
} from "lucide-react";
import type { Room, RoomMember } from "@shared/schema";
import type { User } from "@shared/models/auth";
import { useToast } from "@/hooks/use-toast";
import CameraModal from "@/components/CameraModal";

import { LANGUAGES } from "@/lib/languages";

type CaptionSegment = {
  start: number;
  end: number;
  text: string;
};

type ChatMessage = {
  id: string;
  sender: "you" | "them";
  senderName?: string;
  text: string;
  translatedText?: string;
  isTranslating?: boolean;
  timestamp: number;
  imageData?: string;
  videoData?: string;
  mediaType?: "image" | "video";
  imageExpiresAt?: number;
  imageViewed?: boolean;
};

type RoomWithHost = Room & { host: User };

import { safeDisplayName, isGenericName, isEmailAddress } from "@/lib/utils";

function getValidName(name: string | null | undefined): string | null {
  if (!name || !name.trim() || isGenericName(name) || isEmailAddress(name)) return null;
  return name.trim();
}

export default function ActiveRoom() {
  const [, params] = useRoute("/room/:code");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const roomCode = params?.code?.toUpperCase();
  const { toast } = useToast();
  const { t } = useI18n();

  const [codeCopied, setCodeCopied] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [showWsDisconnected, setShowWsDisconnected] = useState(false);
  const wsDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subtitleLanguage, setSubtitleLanguage] = useState("en");

  const [rejoinDone, setRejoinDone] = useState(false);

  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const viewingImageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  const [videoCaptions, setVideoCaptions] = useState<CaptionSegment[]>([]);
  const [videoCaptionStatus, setVideoCaptionStatus] = useState<"idle" | "extracting" | "transcribing" | "translating" | "done" | "no-speech" | "error">("idle");
  const [activeCaption, setActiveCaption] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captionAnimRef = useRef<number | null>(null);
  const captionRequestIdRef = useRef<string>("");

  const wsRef = useRef<WebSocket | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const wsReconnectDelayRef = useRef(1000);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsCancelledRef = useRef(false);
  const subtitleLanguageRef = useRef(subtitleLanguage);

  useEffect(() => {
    subtitleLanguageRef.current = subtitleLanguage;
  }, [subtitleLanguage]);

  const { data: userPrefs } = useQuery<{ subtitleLanguage?: string }>({
    queryKey: ["/api/preferences"],
    enabled: !!user,
  });

  useEffect(() => {
    if (userPrefs?.subtitleLanguage) {
      setSubtitleLanguage(userPrefs.subtitleLanguage);
    }
  }, [userPrefs]);

  const { data: roomData, isLoading: loadingRoom, error: roomError } = useQuery<RoomWithHost>({
    queryKey: ["/api/rooms", roomCode],
    enabled: !!roomCode,
  });


  useEffect(() => {
    if (roomCode && user) {
      setRejoinDone(false);
      fetch(`/api/room-members/${roomCode}/rejoin`, {
        method: "POST",
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[Rejoin] Failed:", res.status, data);
          if (data.roomFull) {
            toast({ title: t("room.roomFull") || "Room is full", variant: "default" });
            setLocation("/");
            return;
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/room-members", roomCode] });
        queryClient.invalidateQueries({ queryKey: ["/api/joined-rooms"] });
      }).catch((err) => {
        console.error("[Rejoin] Network error:", err);
      }).finally(() => {
        setRejoinDone(true);
      });
    } else if (roomCode && !user) {
      setRejoinDone(true);
    }
  }, [roomCode, user]);

  const { data: roomMembersList = [] } = useQuery<(RoomMember & { user?: User })[]>({
    queryKey: ["/api/room-members", roomCode],
    enabled: !!roomCode && rejoinDone,
    refetchInterval: 60000,
  });

  const activeMembers = roomMembersList.filter(m => m.isActive !== false);

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

  useEffect(() => {
    if (roomCode && user) {
      fetch(`/api/room-messages/${roomCode}`, { credentials: "include" })
        .then(res => res.ok ? res.json() : [])
        .then((msgs: Array<{ id: string; fromId: string; fromName: string; text: string; timestamp: number }>) => {
          if (msgs.length > 0) {
            const loadedMessages: ChatMessage[] = msgs.map(m => ({
              id: m.id,
              sender: String(m.fromId) === String(user.id) ? "you" as const : "them" as const,
              senderName: m.fromName,
              text: m.text,
              timestamp: m.timestamp,
            }));
            setChatMessages(loadedMessages.slice(-50));
          }
        })
        .catch(() => {});
    }
  }, [roomCode, user]);

  const connectWebSocket = useCallback(() => {
    if (!roomCode || !user || wsCancelledRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setShowWsDisconnected(false);
      if (wsDisconnectTimerRef.current) clearTimeout(wsDisconnectTimerRef.current);
      wsReconnectDelayRef.current = 1000;
      ws.send(JSON.stringify({
        type: "register",
        userId: user.id,
        username: safeDisplayName(user.firstName, user.lastName),
      }));
      ws.send(JSON.stringify({ type: "join-room", roomCode }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "room-chat") {
          const isMe = String(data.userId) === String(user.id);
          if (isMe) return;

          const msgId = `chat-${Date.now()}-${Math.random()}`;
          const newMsg: ChatMessage = {
            id: msgId,
            sender: "them",
            senderName: data.username,
            text: data.message,
            isTranslating: subtitleLanguageRef.current !== "en",
            timestamp: data.timestamp || Date.now(),
          };
          setChatMessages(prev => [...prev.slice(-49), newMsg]);

          if (subtitleLanguageRef.current && subtitleLanguageRef.current !== "en") {
            const translated = await translateText(data.message, subtitleLanguageRef.current);
            setChatMessages(prev =>
              prev.map(m => m.id === msgId ? { ...m, translatedText: translated, isTranslating: false } : m)
            );
          }
        } else if (data.type === "room-image" || data.type === "room-video") {
          const isMe = String(data.userId) === String(user.id);
          if (isMe) return;

          const isVideo = data.type === "room-video";
          const mediaMsg: ChatMessage = {
            id: `${isVideo ? "vid" : "img"}-${Date.now()}-${Math.random()}`,
            sender: "them",
            senderName: data.username,
            text: "",
            ...(isVideo ? { videoData: data.videoData } : { imageData: data.imageData }),
            mediaType: isVideo ? "video" : "image",
            imageExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
            imageViewed: false,
            timestamp: data.timestamp || Date.now(),
          };
          setChatMessages(prev => [...prev.slice(-49), mediaMsg]);
        } else if (data.type === "user-joined" || data.type === "user-left") {
          queryClient.invalidateQueries({ queryKey: ["/api/room-members", roomCode] });
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsConnected(false);
      if (wsDisconnectTimerRef.current) clearTimeout(wsDisconnectTimerRef.current);
      wsDisconnectTimerRef.current = setTimeout(() => setShowWsDisconnected(true), 3000);
      if (!wsCancelledRef.current) {
        const delay = Math.min(wsReconnectDelayRef.current, 10000);
        wsReconnectTimerRef.current = setTimeout(() => {
          wsReconnectDelayRef.current = delay * 1.5;
          connectWebSocket();
        }, delay);
      }
    };

    ws.onerror = () => ws.close();
  }, [roomCode, user, translateText]);

  useEffect(() => {
    wsCancelledRef.current = false;
    connectWebSocket();
    return () => {
      wsCancelledRef.current = true;
      if (wsReconnectTimerRef.current) clearTimeout(wsReconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const sendChatMessage = useCallback(() => {
    const msg = messageInput.trim();
    if (!msg || !wsRef.current || !roomCode || !user) return;

    const payload = {
      type: "room-chat",
      roomCode,
      userId: user.id,
      username: safeDisplayName(user.firstName, user.lastName),
      message: msg,
    };

    const localMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random()}`,
      sender: "you",
      text: msg,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev.slice(-49), localMsg]);

    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      fetch("/api/room-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
    setMessageInput("");
  }, [messageInput, roomCode, user]);

  const sendImageMessage = useCallback((base64Data: string) => {
    if (!wsRef.current || !roomCode || !user) return;

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const payload = {
      type: "room-image",
      roomCode,
      userId: user.id,
      username: safeDisplayName(user.firstName, user.lastName),
      imageData: base64Data,
      expiresAt,
    };

    const localMsg: ChatMessage = {
      id: `img-${Date.now()}-${Math.random()}`,
      sender: "you",
      text: "",
      imageData: base64Data,
      mediaType: "image" as const,
      imageExpiresAt: expiresAt,
      imageViewed: false,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev.slice(-49), localMsg]);

    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, [roomCode, user]);

  const sendVideoMessage = useCallback((base64Data: string) => {
    if (!wsRef.current || !roomCode || !user) return;

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const payload = {
      type: "room-video",
      roomCode,
      userId: user.id,
      username: safeDisplayName(user.firstName, user.lastName),
      videoData: base64Data,
      expiresAt,
    };

    const localMsg: ChatMessage = {
      id: `vid-${Date.now()}-${Math.random()}`,
      sender: "you",
      text: "",
      videoData: base64Data,
      mediaType: "video" as const,
      imageExpiresAt: expiresAt,
      imageViewed: false,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev.slice(-49), localMsg]);

    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, [roomCode, user]);

  const handleMediaPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast({ title: "Please select an image or video", variant: "default" });
      e.target.value = "";
      return;
    }
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const maxSize = isMobile ? 15.5 * 1024 * 1024 : 25 * 1024 * 1024;
    const maxLabel = isMobile ? "15.5MB" : "25MB";
    if (file.size > maxSize) {
      toast({ title: `${isVideo ? "Video" : "Image"} too large`, description: `Max ${maxLabel} allowed`, variant: "default" });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (isVideo) {
        sendVideoMessage(result);
      } else {
        sendImageMessage(result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [sendImageMessage, sendVideoMessage, toast]);

  const handleCameraCapture = useCallback((file: File, _captions?: any) => {
    setShowCamera(false);
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) return;

    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const maxSize = isMobile ? 15.5 * 1024 * 1024 : 25 * 1024 * 1024;
    const maxLabel = isMobile ? "15.5MB" : "25MB";
    if (file.size > maxSize) {
      toast({ title: `${isVideo ? "Video" : "Image"} too large`, description: `Max ${maxLabel} allowed`, variant: "default" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (isVideo) {
        sendVideoMessage(result);
      } else {
        sendImageMessage(result);
      }
    };
    reader.readAsDataURL(file);
  }, [sendImageMessage, sendVideoMessage, toast]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChatMessages(prev => {
        const filtered = prev.map(msg => {
          if ((msg.imageData || msg.videoData) && msg.imageExpiresAt && now >= msg.imageExpiresAt) {
            const label = msg.mediaType === "video" ? "Video expired" : "Image expired";
            return { ...msg, imageData: undefined, videoData: undefined, text: label };
          }
          return msg;
        });
        return filtered;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleViewImage = useCallback((msgId: string, imageData: string) => {
    setViewingImage(imageData);
    if (viewingImageTimerRef.current) clearTimeout(viewingImageTimerRef.current);
    viewingImageTimerRef.current = setTimeout(() => {
      setViewingImage(null);
    }, 10000);
    setChatMessages(prev => prev.map(msg => {
      if (msg.id === msgId && !msg.imageViewed) {
        return { ...msg, imageViewed: true, imageExpiresAt: Date.now() + 10000 };
      }
      return msg;
    }));
  }, []);

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

      const targetLang = subtitleLanguageRef.current;
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
      console.error("Video caption error:", err);
      if (captionRequestIdRef.current === requestId) setVideoCaptionStatus("error");
    }
  }, []);

  const handleViewVideo = useCallback((msgId: string, videoData: string) => {
    setViewingVideo(videoData);
    setViewingVideoMsgId(msgId);
    setChatMessages(prev => prev.map(msg => {
      if (msg.id === msgId && !msg.imageViewed) {
        return { ...msg, imageViewed: true };
      }
      return msg;
    }));
    loadVideoCaptions(msgId, videoData);
  }, [loadVideoCaptions]);

  const [viewingVideoMsgId, setViewingVideoMsgId] = useState<string | null>(null);

  const handleVideoEnded = useCallback(() => {
    if (captionAnimRef.current) {
      cancelAnimationFrame(captionAnimRef.current);
      captionAnimRef.current = null;
    }
    setTimeout(() => {
      setViewingVideo(null);
      setVideoCaptions([]);
      setVideoCaptionStatus("idle");
      setActiveCaption("");
      if (viewingVideoMsgId) {
        setChatMessages(prev => prev.map(msg => {
          if (msg.id === viewingVideoMsgId) {
            return { ...msg, imageExpiresAt: Date.now() + 3000 };
          }
          return msg;
        }));
        setViewingVideoMsgId(null);
      }
    }, 1500);
  }, [viewingVideoMsgId]);

  useEffect(() => {
    return () => {
      if (viewingImageTimerRef.current) clearTimeout(viewingImageTimerRef.current);
    };
  }, []);

  const isHost = roomData && user && String(roomData.hostId) === String(user.id);

  const handleDisconnect = useCallback(async () => {
    if (!roomCode || isDisconnecting) return;
    setIsDisconnecting(true);
    try {
      await apiRequest("DELETE", `/api/room-members/${roomCode}/leave`);
      queryClient.invalidateQueries({ queryKey: ["/api/joined-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/room-members", roomCode] });
      toast({ title: t("room.disconnected"), description: t("room.leftRoom") });
      setLocation("/");
    } catch {
      toast({ title: t("common.error"), description: t("error.tryAgain"), variant: "default" });
    } finally {
      setIsDisconnecting(false);
    }
  }, [roomCode, isDisconnecting, toast, setLocation]);

  const handleRemoveMember = useCallback(async (memberId: string, memberName: string) => {
    if (!roomCode) return;
    try {
      await apiRequest("DELETE", `/api/room-members/${roomCode}/${memberId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/room-members", roomCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-room-members"] });
      toast({ title: t("common.success"), description: `${memberName} has been disconnected from this room.` });
    } catch {
      toast({ title: t("common.error"), description: t("error.tryAgain"), variant: "default" });
    }
  }, [roomCode, toast]);

  if (loadingRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (roomError || !roomData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-6 text-center max-w-sm w-full space-y-4">
          <h2 className="font-semibold text-lg">{t("room.roomNotFound")}</h2>
          <p className="text-muted-foreground text-sm">{t("room.roomExpired")}</p>
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-home" />
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back" />
          <div>
            <h1 className="font-semibold text-base leading-tight" data-testid="text-room-name">
              {roomData.name || "Room"}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <button
                onClick={copyRoomCode}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-copy-code"
              >
                {codeCopied ? <Check className="h-3 w-3 text-blue-600 dark:text-blue-500" /> : <Copy className="h-3 w-3" />}
                {roomCode}
              </button>
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border border-primary/20">
                {activeMembers.length} {t("room.connected").toLowerCase()}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(wsConnected || !showWsDisconnected) ? (
            <Badge className="text-[10px] px-2 py-0.5 bg-blue-600/8 text-blue-700 dark:text-blue-500 border-blue-600/15">
              {t("room.connected")}
            </Badge>
          ) : (
            <Badge className="text-[10px] px-2 py-0.5 bg-red-500/8 text-red-600/90 border-red-500/15">
              {t("room.reconnecting")}
            </Badge>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4 pb-24 md:pb-8 space-y-6">
        <div className="w-full max-w-md space-y-4">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold" data-testid="text-room-title">
              {roomData.name || `Room ${roomCode}`}
            </h2>
            <p className="text-muted-foreground text-sm">
              Created by {safeDisplayName(roomData.host?.firstName, roomData.host?.lastName, undefined, "Unknown")}
            </p>
          </div>

          {activeMembers.length > 0 && (
            <Card className="p-3">
              <p className="text-xs text-muted-foreground mb-2 font-medium">{t("room.participants")}</p>
              <div className="flex flex-wrap gap-2">
                {activeMembers.map((member) => {
                  const isMe = String(member.userId) === String(user?.id);
                  const memberName = safeDisplayName(member.user?.firstName, member.user?.lastName, member.username);
                  return (
                    <div key={member.id} className="flex items-center gap-1">
                      <Badge className="text-xs bg-muted text-foreground border-border">
                        {memberName}
                        {isMe && " (you)"}
                      </Badge>
                      {isHost && !isMe && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveMember(member.userId, memberName)}
                          data-testid={`button-remove-member-${member.userId}`}
                        >
                          <UserMinus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div className="space-y-3">
            <Button
              className="w-full h-14 text-base gap-3"
              onClick={() => setShowChat(true)}
              data-testid="button-text-chat"
            >
              <MessageSquare className="h-5 w-5" />
              {t("room.chat")}
            </Button>

            <Button
              variant="outline"
              className="w-full h-14 text-base gap-3"
              onClick={() => setLocation(`/room/${roomCode}/call`)}
              data-testid="button-join-video"
            >
              <Video className="h-5 w-5" />
              {t("home.videoCall")}
            </Button>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Languages className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={subtitleLanguage} onValueChange={async (lang) => {
              setSubtitleLanguage(lang);
              try {
                await apiRequest("PATCH", "/api/preferences", { subtitleLanguage: lang });
              } catch {}
            }}>
              <SelectTrigger className="flex-1" data-testid="select-language">
                <SelectValue placeholder={t("settings.subtitleLanguage")} />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            className="w-full gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 mt-4"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            data-testid="button-disconnect-room"
          >
            <LogOut className="h-4 w-4" />
            {isDisconnecting ? t("room.connecting") : t("room.leaveRoom")}
          </Button>
        </div>
      </div>

      {showChat && (
        <div className="fixed inset-0 bg-background z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowChat(false)}
                data-testid="button-close-chat"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h3 className="font-semibold text-sm">{t("room.chat")} · {roomCode}</h3>
                {subtitleLanguage && subtitleLanguage !== "en" && (
                  <span className="text-xs text-muted-foreground">
                    {t("room.translating")} {LANGUAGES.find(l => l.code === subtitleLanguage)?.name}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                setShowChat(false);
                setLocation(`/room/${roomCode}/call`);
              }}
              data-testid="button-switch-video"
            >
              <Video className="h-4 w-4" />
              {t("home.videoCall")}
            </Button>
          </div>

          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chatMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center space-y-2 py-12">
                  <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">{t("room.noOneHere")}</p>
                  <p className="text-muted-foreground text-xs">{t("room.waitingForOthers")}</p>
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[80%] space-y-0.5`}>
                    {msg.sender === "them" && msg.senderName && (
                      <p className="text-[10px] text-muted-foreground px-1">{msg.senderName}</p>
                    )}
                    <div
                      className={`rounded-2xl px-3 py-2 ${
                        msg.sender === "you"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm"
                      }`}
                    >
                      {(msg.imageData || msg.videoData) ? (
                        <div className="space-y-1">
                          <button
                            onClick={() => {
                              if (msg.videoData) {
                                handleViewVideo(msg.id, msg.videoData);
                              } else if (msg.imageData) {
                                handleViewImage(msg.id, msg.imageData);
                              }
                            }}
                            className="block w-full"
                            data-testid={msg.videoData ? "button-view-video" : "button-view-image"}
                          >
                            {msg.videoData ? (
                              <div className="flex flex-col items-center gap-1.5 py-2 px-2">
                                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                                  <Video className="w-5 h-5 text-primary" />
                                </div>
                                <p className={`text-xs font-semibold tracking-wide ${msg.sender === "you" ? "text-primary-foreground" : "text-foreground"}`}>
                                  Video only
                                </p>
                                <p className={`text-[10px] ${msg.sender === "you" ? "text-primary-foreground/50" : "text-muted-foreground"}`}>
                                  {msg.imageViewed ? `Disappears in ${Math.max(0, Math.ceil(((msg.imageExpiresAt || 0) - Date.now()) / 1000))}s` : "Tap to view"}
                                </p>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 py-1">
                                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                                  <ImageIcon className="h-7 w-7 text-white" />
                                </div>
                                <div className="text-left">
                                  <p className={`text-sm font-medium ${msg.sender === "you" ? "text-primary-foreground" : "text-foreground"}`}>
                                    Photo
                                  </p>
                                  <p className={`text-[11px] ${msg.sender === "you" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                                    {msg.imageViewed ? `Disappears in ${Math.max(0, Math.ceil(((msg.imageExpiresAt || 0) - Date.now()) / 1000))}s` : "Tap to view"}
                                  </p>
                                </div>
                              </div>
                            )}
                          </button>
                        </div>
                      ) : msg.translatedText ? (
                        <div className="space-y-1">
                          <p className="text-sm">{msg.text}</p>
                          <p className={`text-xs ${msg.sender === "you" ? "text-primary-foreground/70" : "text-amber-600 dark:text-amber-400"}`}>
                            {msg.translatedText}
                          </p>
                        </div>
                      ) : msg.isTranslating ? (
                        <div className="space-y-1">
                          <p className="text-sm">{msg.text}</p>
                          <p className={`text-xs animate-pulse ${msg.sender === "you" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {t("room.translating")}
                          </p>
                        </div>
                      ) : (msg.text === "Image expired" || msg.text === "Video expired") ? (
                        <p className="text-sm italic text-muted-foreground">{msg.text}</p>
                      ) : (
                        <p className="text-sm">{msg.text}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t pb-safe">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChatMessage();
              }}
              className="flex gap-2"
            >
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleMediaPick}
                data-testid="input-media-file"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => mediaInputRef.current?.click()}
                data-testid="button-send-media"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowCamera(true)}
                data-testid="button-camera"
              >
                <Camera className="h-4 w-4" />
              </Button>
              <Input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder={t("room.messagePlaceholder")}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button type="submit" size="icon" disabled={!messageInput.trim()} data-testid="button-send-message">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}

      {viewingImage && (
        <div
          className="fixed inset-0 z-[60] bg-black flex flex-col animate-in fade-in duration-200"
          data-testid="overlay-view-image"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={() => {
                  setViewingImage(null);
                  if (viewingImageTimerRef.current) clearTimeout(viewingImageTimerRef.current);
                }}
                data-testid="button-close-image-viewer"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <p className="text-white text-sm font-medium">Photo</p>
                <p className="text-white/50 text-xs">Disappears after viewing</p>
              </div>
            </div>
          </div>

          <div
            className="flex-1 flex items-center justify-center p-4"
            onClick={() => {
              setViewingImage(null);
              if (viewingImageTimerRef.current) clearTimeout(viewingImageTimerRef.current);
            }}
          >
            <img
              src={viewingImage}
              alt="Full view"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="px-4 py-4 bg-black/80 text-center">
            <div className="w-full bg-white/20 rounded-full h-1 overflow-hidden">
              <div className="bg-white h-full rounded-full animate-[shrink_10s_linear_forwards]" />
            </div>
          </div>
        </div>
      )}

      {viewingVideo && (
        <div
          className="fixed inset-0 z-[60] bg-black flex flex-col animate-in fade-in duration-200"
          data-testid="overlay-view-video"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="text-white no-default-hover-elevate"
                onClick={() => {
                  if (captionAnimRef.current) cancelAnimationFrame(captionAnimRef.current);
                  setViewingVideo(null);
                  setVideoCaptions([]);
                  setVideoCaptionStatus("idle");
                  setActiveCaption("");
                }}
                data-testid="button-close-video-viewer"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <p className="text-white text-sm font-medium">Video</p>
                <p className="text-white/50 text-xs">Disappears after watching</p>
              </div>
            </div>
            {videoCaptionStatus !== "idle" && videoCaptionStatus !== "done" && videoCaptionStatus !== "no-speech" && videoCaptionStatus !== "error" && (
              <div className="flex items-center gap-2" data-testid="caption-loading-indicator">
                <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span className="text-white/60 text-xs">
                  {videoCaptionStatus === "extracting" && t("common.loading")}
                  {videoCaptionStatus === "transcribing" && t("room.captions")}
                  {videoCaptionStatus === "translating" && t("room.translating")}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center p-4 relative">
            <video
              ref={videoRef}
              src={viewingVideo}
              className="max-w-full max-h-full rounded-lg"
              autoPlay
              playsInline
              controls={false}
              onEnded={handleVideoEnded}
              onTimeUpdate={(e) => {
                if (videoCaptions.length === 0) return;
                const currentMs = e.currentTarget.currentTime * 1000;
                const segment = videoCaptions.find(
                  (s) => currentMs >= s.start && currentMs <= s.end
                );
                setActiveCaption(segment?.text || "");
              }}
              onClick={(e) => {
                const vid = e.currentTarget;
                if (vid.paused) vid.play(); else vid.pause();
              }}
              data-testid="video-player-disappearing"
            />

            {activeCaption && (
              <div
                className="absolute bottom-8 left-4 right-4 flex justify-center pointer-events-none"
                data-testid="video-caption-overlay"
              >
                <div className="bg-black/75 backdrop-blur-sm rounded-md px-4 py-2 max-w-[90%]">
                  <p className="text-white text-sm sm:text-base font-medium text-center leading-snug">
                    {activeCaption}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-4 bg-black/80 text-center">
            {videoCaptionStatus === "no-speech" ? (
              <p className="text-white/50 text-xs" data-testid="caption-no-speech">No speech detected in this video</p>
            ) : videoCaptionStatus === "error" ? (
              <p className="text-white/50 text-xs" data-testid="caption-error">Captions unavailable</p>
            ) : videoCaptionStatus === "done" && videoCaptions.length > 0 ? (
              <p className="text-white/50 text-xs" data-testid="caption-active">
                Auto-captions {subtitleLanguage !== "en" ? `translated to ${LANGUAGES.find(l => l.code === subtitleLanguage)?.name || subtitleLanguage}` : "enabled"}
              </p>
            ) : (
              <p className="text-white/50 text-xs">Video will disappear when finished</p>
            )}
          </div>
        </div>
      )}

      {showCamera && (
        <CameraModal
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
