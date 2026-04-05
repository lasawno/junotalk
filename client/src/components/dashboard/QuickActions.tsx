import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n.jsx";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import SectionBoundary from "./SectionBoundary";
import { UserPlus } from "lucide-react";
import speechBubbleImg from "@assets/speech_bubble_v2_nobg.png";

function QuickActionsInner() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: messageCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/room-message-counts"],
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const totalUnread = Object.values(messageCounts).reduce((s, c) => s + c, 0);

  const { data: callsData = [] } = useQuery<{ id: number; status: string; callerId: number; receiverId: number; callType: string }[]>({
    queryKey: ["/api/calls"],
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const missedCalls = callsData.filter(c => c.status === "missed" && c.receiverId === (user as any)?.id).length;

  const createCodeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/rooms", {}),
    onSuccess: async (res) => {
      const room = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/my-rooms"] });
      toast({ title: "Code created!", description: `Share code ${room.code} to connect` });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("home.createRoomError"), variant: "default" });
    },
  });

  const actions = [
    {
      icon: (
        <div className="relative flex items-center justify-center" style={{ width: 56, height: 56 }}>
          <img src={speechBubbleImg} alt="Messages" className="w-full h-full object-contain" />
          {totalUnread > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center z-10"
              data-testid="badge-unread-messages"
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
      ),
      label: t("nav.chatRoom"),
      onClick: () => setLocation("/chat-rooms"),
      testId: "quick-chat-rooms",
      disabled: false,
    },
    {
      icon: (
        <div className="relative flex items-center justify-center" style={{ width: 56, height: 56 }}>
          <svg viewBox="0 0 28 24" style={{ width: 36, height: 32 }} xmlns="http://www.w3.org/2000/svg">
            {/* Phone handset */}
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.46-5.15-3.76-6.61-6.61l1.96-1.58c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-1-.99H4c-.54 0-1 .45-1 1 0 9.39 7.61 17 17 17 .54 0 1-.45 1-1v-3.49c0-.54-.45-.99-1-.99z" fill="#ffffff"/>
            {/* Speech waves — rotated 25° around the earpiece */}
            <g transform="rotate(-25, 17, 7)">
              <path d="M17 5 C18.3 6 18.3 8.5 17 9.5" stroke="#ffffff" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              <path d="M18.5 3.8 C20.5 5.2 20.5 9 18.5 10.4" stroke="#ffffff" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              <path d="M20 2.6 C22.7 4.4 22.7 9.6 20 11.4" stroke="#ffffff" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </g>
          </svg>
          {missedCalls > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
              data-testid="badge-missed-calls"
            >
              {missedCalls > 99 ? "99+" : missedCalls}
            </span>
          )}
        </div>
      ),
      label: t("nav.calls"),
      onClick: () => setLocation("/calls"),
      testId: "quick-call-history",
      disabled: false,
    },
    {
      icon: (
        <div className="flex items-center justify-center" style={{ width: 56, height: 56 }}>
          <UserPlus size={32} color="#7dcfff" />
        </div>
      ),
      label: createCodeMutation.isPending ? "..." : "Add Contact",
      onClick: () => createCodeMutation.mutate(),
      testId: "quick-add-contact",
      disabled: createCodeMutation.isPending,
    },
  ];

  return (
    <div className="shrink-0 mt-1 px-3">

      {/* Frosted border — icons only */}
      <div
        className="flex justify-around items-center px-4 py-0.5"
        style={{
          background: "rgba(40,80,180,0.13)",
          border: "none",
          borderRadius: 40,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          boxShadow: "inset 0 2px 0 rgba(160,210,255,0.45), inset 0 -2px 0 rgba(160,210,255,0.45)",
        }}
      >
        {actions.map((action, i) => (
          <button
            key={action.testId}
            onClick={action.onClick}
            disabled={action.disabled}
            className="flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60"
            data-testid={action.testId}
            style={i === 0 ? { marginLeft: -28 } : i === actions.length - 1 ? { marginRight: -28 } : undefined}
          >
            {action.icon}
          </button>
        ))}
      </div>


    </div>
  );
}

export default function QuickActions() {
  return (
    <SectionBoundary label="Quick Actions">
      <QuickActionsInner />
    </SectionBoundary>
  );
}
