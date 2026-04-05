import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Phone,
  Video,
  Send,
  MoreVertical,
  Loader2,
  MapPin,
  Navigation,
  Check,
  CheckCheck,
} from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import LocationShareSheet, { type LocationPayload } from "@/components/LocationShareSheet";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/models/auth";
import type { Message } from "@shared/schema";
import { useI18n } from "@/lib/i18n.jsx";
import { useCallContext } from "@/contexts/call-context";
import { useDmSocket } from "@/hooks/use-dm-socket";

type ContactInfo = {
  user: User;
  status: string;
};

export default function Chat() {
  useWakeLock(true);
  const [, params] = useRoute("/chat/:contactId");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [showLocationSheet, setShowLocationSheet] = useState(false);
  const [isContactTyping, setIsContactTyping] = useState(false);
  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(new Set());
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contactId = params?.contactId;
  const { toast } = useToast();
  const { t } = useI18n();
  const { initiateCall } = useCallContext();

  // ── Initial history load (no polling — socket handles live updates) ───────
  const { isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", contactId],
    enabled: !!contactId,
    staleTime: Infinity,
    gcTime: 0,
  });

  // Sync query cache → local messages state on load
  useEffect(() => {
    const cached = queryClient.getQueryData<Message[]>(["/api/messages", contactId]);
    if (cached) setMessages(cached);
  }, [contactId]);

  // ── DM Socket ─────────────────────────────────────────────────────────────
  const handleIncoming = useCallback((msg: Message) => {
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleTyping = useCallback(({ senderId, isTyping }: { senderId: string; isTyping: boolean }) => {
    if (senderId !== contactId) return;
    setIsContactTyping(isTyping);
    if (isTyping) {
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = setTimeout(() => setIsContactTyping(false), 4000);
    }
  }, [contactId]);

  const handleDelivered = useCallback(({ messageId }: { messageId: string; receiverId: string }) => {
    setDeliveredIds(prev => new Set([...prev, messageId]));
  }, []);

  const handleReadAck = useCallback(({ readBy }: { readBy: string }) => {
    if (readBy !== contactId) return;
    setMessages(prev => {
      const ids = new Set(readIds);
      prev.forEach(m => { if (m.senderId === user?.id) ids.add(m.id); });
      setReadIds(ids);
      return prev;
    });
  }, [contactId, user?.id, readIds]);

  const { connected, sendMessage: dmSend, startTyping, stopTyping, markRead } = useDmSocket({
    contactId,
    onMessage: handleIncoming,
    onTyping: handleTyping,
    onDelivered: handleDelivered,
    onReadAck: handleReadAck,
  });

  // Mark messages as read when chat is opened / new messages arrive
  useEffect(() => {
    if (messages.length && contactId) markRead();
  }, [messages.length, contactId, markRead]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isContactTyping]);

  // ── Contact info ──────────────────────────────────────────────────────────
  const { data: contactInfo } = useQuery<ContactInfo>({
    queryKey: ["/api/users", contactId],
    enabled: !!contactId,
  });

  const handleCallViaRoom = useCallback(() => {
    if (!contactId || !contactInfo?.user) {
      toast({ title: t("room.startCall"), description: t("home.noActiveRoomsDesc") });
      return;
    }
    const target = contactInfo.user;
    const name = `${target.firstName || ""} ${target.lastName || ""}`.trim() || "Someone";
    initiateCall(contactId, name, target.profileImageUrl || null);
  }, [contactId, contactInfo, initiateCall, toast, t]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const [isSending, setIsSending] = useState(false);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const content = message.trim();
    if (!content || !user) return;

    // Optimistic local message
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      senderId: user.id,
      receiverId: contactId!,
      content,
      createdAt: new Date(),
      read: false,
    };
    setMessages(prev => [...prev, optimistic]);
    setMessage("");
    stopTyping();
    setIsSending(true);

    if (connected) {
      dmSend(content);
      setIsSending(false);
    } else {
      // Fallback: HTTP
      fetch("/api/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: contactId, content }),
      })
        .then(r => r.json())
        .then((saved: Message) => {
          setMessages(prev => prev.map(m => m.id === optimistic.id ? saved : m));
          queryClient.invalidateQueries({ queryKey: ["/api/messages", contactId] });
        })
        .catch(() => toast({ title: "Message failed", variant: "destructive" }))
        .finally(() => setIsSending(false));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    if (e.target.value) startTyping(); else stopTyping();
  };

  const handleSendLocation = (payload: LocationPayload) => {
    if (!contactId) return;
    const isLive = payload.expiresAt !== undefined;
    const prefix = isLive ? "[LiveLocation:" : "[Location:";
    const data = {
      lat: payload.lat, lng: payload.lng, name: payload.name,
      ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
    };
    const content = `${prefix}${JSON.stringify(data)}]`;
    setShowLocationSheet(false);
    setMessage("");
    if (connected) {
      dmSend(content);
    } else {
      fetch("/api/messages", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: contactId, content }),
      }).then(() => queryClient.invalidateQueries({ queryKey: ["/api/messages", contactId] }));
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function parseChatLocation(content: string) {
    try {
      const inner = content.replace(/^\[(Live)?Location:/, "").replace(/\]$/, "");
      const data = JSON.parse(inner) as { lat: number; lng: number; name: string; expiresAt?: number };
      const isLive = content.startsWith("[LiveLocation:");
      return { ...data, isLive };
    } catch { return null; }
  }

  function fmtLocTime(expiresAt: number): string {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    if (mins > 0) return `${mins}m remaining`;
    return "Expiring soon";
  }

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    return ((firstName?.charAt(0) || "") + (lastName?.charAt(0) || "")).toUpperCase() || "?";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online": return "bg-status-online";
      case "away": return "bg-status-away";
      default: return "bg-status-offline";
    }
  };

  const formatTime = (date: Date | string | null) => {
    if (!date) return "";
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getMsgStatus = (msg: Message) => {
    if (msg.senderId !== user?.id) return null;
    if (readIds.has(msg.id)) return "read";
    if (deliveredIds.has(msg.id)) return "delivered";
    return "sent";
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-[100dvh] flex flex-col bg-background">
      <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 h-16 gap-4">
          <div className="flex items-center gap-3">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back" />
            <div className="relative">
              <Avatar className="w-10 h-10">
                <AvatarImage src={contactInfo?.user?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary">
                  {getInitials(contactInfo?.user?.firstName, contactInfo?.user?.lastName)}
                </AvatarFallback>
              </Avatar>
              <span
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(contactInfo?.status || "offline")}`}
              />
            </div>
            <div>
              <h1 className="font-semibold">
                {contactInfo?.user?.firstName} {contactInfo?.user?.lastName}
              </h1>
              <p className="text-xs text-muted-foreground">
                {isContactTyping
                  ? <span className="text-primary animate-pulse">typing…</span>
                  : contactInfo?.status || "offline"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleCallViaRoom} data-testid="button-video-call">
              <Video className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleCallViaRoom} data-testid="button-voice-call">
              <Phone className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" data-testid="button-more">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="py-4 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted mb-4 flex items-center justify-center">
                <Send className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-2">{t("room.noOneHere")}</h3>
              <p className="text-muted-foreground text-sm max-w-xs">{t("room.sendMessage")}</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.senderId === user?.id;
              const isLocMsg = msg.content?.startsWith("[Location:") || msg.content?.startsWith("[LiveLocation:");
              const status = getMsgStatus(msg);

              if (isLocMsg) {
                const loc = parseChatLocation(msg.content!);
                const expired = loc?.isLive && loc?.expiresAt ? Date.now() > loc.expiresAt : false;
                const mapsUrl = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : "#";
                return (
                  <div key={msg.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.id}`}>
                    <button
                      className="block rounded-2xl overflow-hidden text-left max-w-[220px]"
                      style={{
                        border: isOwn ? "1px solid hsla(215,80%,82%,0.5)" : "1px solid hsl(var(--border))",
                        boxShadow: isOwn ? "0 1px 10px 1px hsla(215,70%,55%,0.2)" : "0 1px 4px rgba(0,0,0,0.1)",
                      }}
                      onClick={() => window.open(mapsUrl, "_blank")}
                      data-testid={`msg-location-${msg.id}`}
                    >
                      <div className="relative bg-[#1a2840] overflow-hidden" style={{ height: 100 }}>
                        {loc && (
                          <img
                            src={`https://staticmap.openstreetmap.de/staticmap.php?center=${loc.lat},${loc.lng}&zoom=15&size=220x100&markers=${loc.lat},${loc.lng},lightblue`}
                            alt="Location map" className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="relative flex items-center justify-center">
                            {loc?.isLive && !expired && <div className="absolute w-10 h-10 rounded-full bg-blue-400/30 animate-ping" />}
                            <div className="w-7 h-7 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center z-10">
                              <Navigation className="w-3 h-3 text-white fill-white" />
                            </div>
                          </div>
                        </div>
                        {loc?.isLive && (
                          <div className="absolute top-1.5 left-1.5">
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white ${expired ? "bg-gray-600/80" : "bg-red-500/90"}`}>
                              {!expired && <span className="w-1 h-1 rounded-full bg-white animate-pulse" />}
                              {expired ? "Expired" : "LIVE"}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2" style={{ background: isOwn ? "hsl(215 70% 55%)" : "hsl(var(--card))" }}>
                        <div className="flex items-center gap-1">
                          <MapPin className={`w-3 h-3 flex-shrink-0 ${isOwn ? "text-white/80" : "text-primary"}`} />
                          <p className={`text-[11px] font-semibold truncate ${isOwn ? "text-white" : "text-foreground"}`}>{loc?.name || "Location"}</p>
                        </div>
                        {loc?.isLive && loc?.expiresAt && (
                          <p className={`text-[10px] mt-0.5 ${isOwn ? "text-white/60" : "text-muted-foreground"}`}>
                            {expired ? "Location expired" : fmtLocTime(loc.expiresAt)}
                          </p>
                        )}
                        <p className={`text-[10px] mt-0.5 ${isOwn ? "text-white/50" : "text-muted-foreground/70"}`}>Tap to open in Maps</p>
                        <p className={`text-[10px] mt-0.5 ${isOwn ? "text-white/50" : "text-muted-foreground"}`}>{formatTime(msg.createdAt)}</p>
                      </div>
                    </button>
                  </div>
                );
              }

              return (
                <div key={msg.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.id}`}>
                  <div
                    className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2 ${
                      isOwn ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border rounded-bl-md"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <div className={`flex items-center gap-1 mt-1 ${isOwn ? "justify-end" : "justify-start"}`}>
                      <p className={`text-xs ${isOwn ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {formatTime(msg.createdAt)}
                      </p>
                      {isOwn && status && (
                        status === "read"
                          ? <CheckCheck className="w-3 h-3 text-blue-300" data-testid={`status-read-${msg.id}`} />
                          : status === "delivered"
                            ? <CheckCheck className="w-3 h-3 text-primary-foreground/50" data-testid={`status-delivered-${msg.id}`} />
                            : <Check className="w-3 h-3 text-primary-foreground/50" data-testid={`status-sent-${msg.id}`} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {isContactTyping && (
            <div className="flex justify-start">
              <div className="bg-card border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {contactInfo?.status === "online" && (
        <div className="flex-shrink-0 px-4 py-2 border-t bg-muted/30">
          <Button className="w-full" onClick={handleCallViaRoom} data-testid="button-start-call">
            <Video className="w-4 h-4 mr-2" />
            {t("home.videoCall")}
          </Button>
        </div>
      )}

      <form onSubmit={handleSendMessage} className="flex-shrink-0 border-t bg-background p-4">
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="ghost" size="icon"
            onClick={() => setShowLocationSheet(true)}
            data-testid="button-share-location"
            className="flex-shrink-0 text-blue-400 hover:text-blue-300"
          >
            <MapPin className="w-5 h-5" />
          </Button>
          <Input
            type="text"
            placeholder={t("room.messagePlaceholder")}
            value={message}
            onChange={handleInputChange}
            className="flex-1"
            data-testid="input-message"
          />
          <Button
            type="submit" size="icon"
            disabled={!message.trim() || isSending}
            data-testid="button-send"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </form>

      {showLocationSheet && (
        <LocationShareSheet onShare={handleSendLocation} onClose={() => setShowLocationSheet(false)} />
      )}
    </div>
  );
}
