import { Home, Phone, MessageSquare, User, Mic } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n.jsx";

interface MobileBottomNavProps {
  onHomeClick?: () => void;
}

export default function MobileBottomNav({ onHomeClick }: MobileBottomNavProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useI18n();

  const { data: messageCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/room-message-counts"],
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const totalMessages = Object.values(messageCounts).reduce((sum, count) => sum + count, 0);

  const { data: callsData = [] } = useQuery<{ id: number; status: string; callerId: number; receiverId: number }[]>({
    queryKey: ["/api/calls"],
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const missedCallsCount = callsData.filter(c => c.status === "missed" && c.receiverId === (user as any)?.id).length;

  const isActive = (path: string) => {
    if (path === "/") return location === "/" || location === "/home";
    return location.startsWith(path);
  };

  const navItemClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md hover-elevate active-elevate-2 ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t border-white/10 sm:hidden z-50"
      style={{ background: "rgba(12,28,70,0.97)", backdropFilter: "blur(4px)" }}
      aria-label="Main navigation"
      data-testid="mobile-bottom-nav"
    >
      <div className="flex justify-around pt-0.5 pb-3.5 gap-0 px-1">
        <Link
          href="/"
          onClick={(e) => {
            if (onHomeClick) {
              e.preventDefault();
              onHomeClick();
            }
          }}
          className={navItemClass(isActive("/"))}
          aria-current={isActive("/") ? "page" : undefined}
          data-testid="nav-home"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          <span className="text-[11px] text-primary">{t("nav.home")}</span>
        </Link>
        <Link
          href="/juno"
          className={navItemClass(isActive("/juno") || isActive("/voice-translate"))}
          aria-current={(isActive("/juno") || isActive("/voice-translate")) ? "page" : undefined}
          data-testid="nav-voice-translate"
        >
          <Mic className="w-4 h-4" aria-hidden="true" />
          <span className="text-[11px] text-primary">Juno</span>
        </Link>
        <Link
          href="/calls"
          className={navItemClass(isActive("/calls"))}
          aria-current={isActive("/calls") ? "page" : undefined}
          data-testid="nav-calls"
        >
          <div className="relative">
            <Phone className="w-4 h-4" aria-hidden="true" />
            {missedCallsCount > 0 && (
              <span
                className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                style={{ backgroundColor: '#ef4444' }}
                data-testid="nav-calls-count"
              >
                {missedCallsCount > 99 ? "99+" : missedCallsCount}
              </span>
            )}
          </div>
          <span className="text-[11px] text-primary">{t("nav.calls")}</span>
        </Link>
        <Link
          href="/chat-rooms"
          className={navItemClass(isActive("/chat-rooms"))}
          aria-current={isActive("/chat-rooms") ? "page" : undefined}
          data-testid="nav-chat-rooms"
        >
          <div className="relative">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            {totalMessages > 0 && (
              <span
                className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                style={{ backgroundColor: '#ef4444' }}
                aria-label={`${totalMessages > 99 ? "99+" : totalMessages} unread messages`}
                data-testid="nav-chat-rooms-count"
              >
                {totalMessages > 99 ? "99+" : totalMessages}
              </span>
            )}
          </div>
          <span className="text-[11px] text-primary">{t("nav.chatRoom")}</span>
        </Link>
        <Link
          href="/profile"
          className={navItemClass(isActive("/profile"))}
          aria-current={isActive("/profile") ? "page" : undefined}
          data-testid="nav-settings"
        >
          <User className="w-4 h-4" aria-hidden="true" />
          <span className="text-[11px] text-primary">{t("nav.profile")}</span>
        </Link>
      </div>
    </nav>
  );
}
