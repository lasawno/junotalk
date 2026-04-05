import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MessageSquare,
  Users,
  Video,
  Loader2,
} from "lucide-react";
import { safeInitials } from "@/lib/utils";
import BackTriangle from "@/components/BackTriangle";
import type { Room, RoomMember } from "@shared/schema";
import type { User } from "@shared/models/auth";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useI18n } from "@/lib/i18n.jsx";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";

export default function ChatRooms() {
  useSEO(SEO_CONFIGS.chatRooms);
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useI18n();
  const { pullY, refreshing } = usePullToRefresh([
    ["/api/my-rooms"],
    ["/api/joined-rooms"],
    ["/api/my-room-members"],
    ["/api/room-message-counts"],
  ]);

  const { data: myRooms = [], isLoading: loadingMyRooms } = useQuery<Room[]>({
    queryKey: ["/api/my-rooms"],
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: joinedRooms = [], isLoading: loadingJoined } = useQuery<Room[]>({
    queryKey: ["/api/joined-rooms"],
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: roomMembersData = {} } = useQuery<Record<string, (RoomMember & { user?: User })[]>>({
    queryKey: ["/api/my-room-members"],
    enabled: !!user && myRooms.length > 0,
    refetchInterval: 30000,
  });

  const { data: messageCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/room-message-counts"],
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (!user) return null;

  const connectedMyRooms = myRooms.filter((room) => {
    const members = roomMembersData[room.code] || [];
    const activeMembers = members.filter((m: any) => m.isActive);
    return activeMembers.length >= 2;
  });
  const allRooms = [...connectedMyRooms, ...joinedRooms];
  const isLoading = loadingMyRooms || loadingJoined;

  const renderRoomCard = (room: Room, isCreator: boolean) => {
    const totalMessages = messageCounts[room.code] || 0;
    const members = roomMembersData[room.code] || [];
    const memberCount = members.length;
    const otherMember = members.find((m: any) => m.userId !== user?.id);
    const otherDisplayName = otherMember
      ? ((otherMember as any).user?.firstName
          ? `${(otherMember as any).user.firstName}${(otherMember as any).user.lastName ? ` ${(otherMember as any).user.lastName}` : ""}`
          : (otherMember as any).username || null)
      : null;

    return (
      <div
        key={room.id}
        className="flex items-center gap-3 px-4 py-2 rounded-2xl border border-white/[0.06] dark:border-white/[0.04] bg-card/40 backdrop-blur-sm hover-elevate scroll-brighten"
        data-testid={`chat-room-card-${room.code}`}
      >
        {otherMember ? (
          <Avatar className="w-14 h-14 flex-shrink-0 border-2 border-background" data-testid={`member-avatar-${otherMember.userId}`}>
            <AvatarImage src={(otherMember as any).user?.profileImageUrl || undefined} />
            <AvatarFallback className="text-base bg-primary/10 text-white font-semibold">
              {safeInitials((otherMember as any).user?.firstName, (otherMember as any).user?.lastName)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <Avatar className="w-11 h-11 flex-shrink-0">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              <Users className="w-5 h-5" />
            </AvatarFallback>
          </Avatar>
        )}

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-base font-semibold truncate text-white" data-testid={`badge-partner-${room.code}`}>
            {otherDisplayName || room.code}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setLocation(`/chat-rooms/${room.code}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20"
            data-testid={`button-open-chat-${room.code}`}
          >
            <MessageSquare className="w-3.5 h-3.5" style={{ color: '#7aabf0' }} />
            <span className="text-sm font-semibold" style={{ color: '#7aabf0' }}>Text</span>
            {totalMessages > 0 && (
              <span className="text-xs font-bold text-white rounded-full px-1.5 min-w-[20px] text-center" style={{ backgroundColor: '#ef4444' }} data-testid={`msg-count-${room.code}`}>
                {totalMessages > 99 ? "99+" : totalMessages}
              </span>
            )}
          </button>
          <button
            onClick={() => setLocation(`/room/${room.code}/call`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/10"
            data-testid={`button-enter-room-${room.code}`}
          >
            <Video className="w-3.5 h-3.5" style={{ color: '#7aabf0' }} />
            <span className="text-sm font-semibold" style={{ color: '#7aabf0' }}>Video</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4 flex items-center h-14 gap-0">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-messages" label="Messages" />
        </div>
      </header>

      

      <main className="flex-1 w-full px-2 py-4 pb-24 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : allRooms.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">{t("home.noActiveRooms")}</p>
            <p className="text-sm mt-1">{t("home.noActiveRoomsDesc")}</p>
            <Button
              className="mt-4"
              onClick={() => setLocation("/")}
              data-testid="button-go-home"
            >
              {t("nav.home")}
            </Button>
          </div>
        ) : (
          <>
            {connectedMyRooms.length > 0 && (
              <div className="space-y-2">
                {connectedMyRooms.map((room) => renderRoomCard(room, true))}
              </div>
            )}
            {joinedRooms.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground" data-testid="text-joined-rooms-heading">{t("room.joinedRoom")}</h2>
                {joinedRooms.map((room) => renderRoomCard(room, false))}
              </div>
            )}
          </>
        )}
      </main>

      <div className="pb-20 sm:pb-3" />
      <MobileBottomNav />
    </div>
  );
}
