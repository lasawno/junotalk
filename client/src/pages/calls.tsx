import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Phone, 
  PhoneIncoming, 
  PhoneOutgoing, 
  PhoneMissed,
  Home,
  MessageCircle,
  Video,
} from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n.jsx";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/models/auth";
import type { Call } from "@shared/schema";

type CallWithUsers = Call & {
  caller: User;
  receiver: User;
};

export default function Calls() {
  useSEO(SEO_CONFIGS.calls);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  const { data: calls = [], isLoading } = useQuery<CallWithUsers[]>({
    queryKey: ["/api/calls"],
  });

  const createRoomMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/rooms", {});
    },
    onSuccess: async (res) => {
      const room = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/my-rooms"] });
      setLocation(`/room/${room.code}/call`);
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("home.createRoomError"),
        variant: "default",
      });
    },
  });

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || "";
    const last = lastName?.charAt(0) || "";
    return (first + last).toUpperCase() || "?";
  };

  const formatCallTime = (date: Date | string | null) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return d.toLocaleDateString([], { weekday: "short" });
    } else {
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  const formatDuration = (start: Date | string | null, end: Date | string | null) => {
    if (!start || !end) return "";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
  };

  const getCallIcon = (status: string, isOutgoing: boolean) => {
    if (status === "missed") {
      return <PhoneMissed className="w-4 h-4 text-red-400" />;
    }
    return isOutgoing ? (
      <PhoneOutgoing className="w-4 h-4 text-blue-400" />
    ) : (
      <PhoneIncoming className="w-4 h-4 text-green-400" />
    );
  };

  const getStatusLabel = (status: string, isOutgoing: boolean) => {
    if (status === "missed") return "Missed";
    if (status === "ended") return isOutgoing ? "Outgoing" : "Incoming";
    if (status === "active") return "Active";
    return "Pending";
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-0 h-14">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back" label={t("nav.calls")} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4">
        <div className="space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 animate-pulse rounded-xl border border-blue-500/15" style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-blue-400/20 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-blue-400/20 rounded w-28" />
                      <div className="h-3 bg-blue-400/20 rounded w-20" />
                    </div>
                    <div className="flex gap-2">
                      <div className="w-9 h-9 rounded-full bg-blue-400/10" />
                      <div className="w-9 h-9 rounded-full bg-blue-400/10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : calls.length === 0 ? (
            <Card className="p-8 text-center border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
              <div className="w-16 h-16 rounded-full bg-blue-500/15 mx-auto mb-4 flex items-center justify-center">
                <Phone className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="font-semibold text-white mb-2" data-testid="text-no-calls">No call history</h3>
              <p className="text-blue-100/70 text-sm mb-4">
                Your call log will appear here when you make or receive calls.
              </p>
              <Button onClick={() => setLocation("/")} data-testid="button-go-home">
                <Home className="w-4 h-4 mr-2" />
                {t("nav.home")}
              </Button>
            </Card>
          ) : (
            calls.map((call) => {
              const currentUserId = user?.id;
              const isOutgoing = call.callerId === currentUserId;
              const otherUser = isOutgoing ? call.receiver : call.caller;
              const displayName = [otherUser?.firstName, otherUser?.lastName].filter(Boolean).join(" ") || "Unknown";
              
              return (
                <div 
                  key={call.id} 
                  className="px-3 py-3 rounded-xl border border-blue-500/10 hover:border-blue-500/25 transition-colors"
                  data-testid={`card-call-${call.id}`}
                  style={{ background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-11 h-11 flex-shrink-0">
                      <AvatarImage src={otherUser?.profileImageUrl || undefined} />
                      <AvatarFallback className="bg-blue-500/15 text-blue-300 text-sm border border-blue-400/20">
                        {getInitials(otherUser?.firstName, otherUser?.lastName)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white text-sm truncate" data-testid={`text-caller-name-${call.id}`}>
                        {displayName}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-blue-200/60 mt-0.5">
                        {getCallIcon(call.status, isOutgoing)}
                        <span>{getStatusLabel(call.status, isOutgoing)}</span>
                        <span className="text-blue-300/30">·</span>
                        <span className="text-blue-200/80 font-medium" data-testid={`text-call-type-${call.id}`}>
                          {call.callType === "video" ? t("calls.videoType") : t("calls.voiceType")}
                        </span>
                        {call.startedAt && call.endedAt && (
                          <>
                            <span className="text-blue-300/30">·</span>
                            <span>{formatDuration(call.startedAt, call.endedAt)}</span>
                          </>
                        )}
                        <span className="text-blue-300/30">·</span>
                        <span>{formatCallTime(call.startedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => {
                          if (otherUser?.id) {
                            setLocation(`/chat/${otherUser.id}`);
                          }
                        }}
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-500/10 border border-blue-400/20 hover:bg-blue-500/20 transition-colors"
                        data-testid={`button-message-${call.id}`}
                        title="Message"
                      >
                        <MessageCircle className="w-4 h-4 text-blue-400" />
                      </button>
                      <button
                        onClick={() => createRoomMutation.mutate()}
                        disabled={createRoomMutation.isPending}
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-500/10 border border-blue-400/20 hover:bg-blue-500/20 transition-colors"
                        data-testid={`button-video-${call.id}`}
                        title="Video Call"
                      >
                        <Video className="w-4 h-4 text-blue-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
