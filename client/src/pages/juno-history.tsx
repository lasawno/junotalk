import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MessageSquare, Mic, Pencil, Loader2, X, Plus } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { useAuth } from "@/hooks/use-auth";
import { isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";

type SessionTab = "chat" | "voice";

interface ConversationSummary {
  id: string;
  title: string;
  sessionType: string;
  durationSeconds: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

function groupByRelativeDate(items: ConversationSummary[]): Record<string, ConversationSummary[]> {
  const groups: Record<string, ConversationSummary[]> = {};
  for (const item of items) {
    const d = new Date(item.createdAt);
    let label: string;
    if (isToday(d)) label = "Today";
    else if (isYesterday(d)) label = "Yesterday";
    else if (isThisWeek(d)) label = "Previous 7 Days";
    else if (isThisMonth(d)) label = "This Month";
    else label = "Older";
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

const DATE_ORDER = ["Today", "Yesterday", "Previous 7 Days", "This Month", "Older"];

export default function JunoHistory() {
  const [tab, setTab] = useState<SessionTab>("chat");
  const [showNewChat, setShowNewChat] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: sessions = [], isLoading } = useQuery<ConversationSummary[]>({
    queryKey: ["/api/v1/juno/conversations", tab],
    queryFn: () =>
      fetch(`/api/v1/juno/conversations?type=${tab}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!user,
    staleTime: 30000,
  });

  const grouped = groupByRelativeDate(sessions);

  const handleStartChat = () => {
    setNewTopic("");
    setShowNewChat(false);
    setLocation("/juno");
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg, #050c1e 0%, #0e1f4a 100%)" }}>

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ background: "rgba(5,12,30,0.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3 mb-3">
          <BackTriangle />
          <h1 className="text-lg font-semibold text-white flex-1">History</h1>
          <button
            onClick={() => setLocation("/juno/edit-history")}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90"
            style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}
            data-testid="button-edit-history"
          >
            <Pencil className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex rounded-full p-1" style={{ background: "rgba(15,26,46,0.9)", border: "1px solid rgba(59,130,246,0.2)" }}>
          {(["chat", "voice"] as SessionTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: tab === t ? "rgba(59,130,246,0.22)" : "transparent",
                color: tab === t ? "#93c5fd" : "rgba(147,197,253,0.4)",
                border: tab === t ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
              }}
              data-testid={`tab-${t}-history`}
            >
              {t === "chat" ? <MessageSquare className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              {t === "chat" ? "Chat" : "Voice"}
            </button>
          ))}
        </div>
      </div>

      {/* Session list — ChatGPT style */}
      <div className="flex-1 overflow-y-auto px-5 py-4 pb-28">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <MessageSquare className="w-8 h-8 text-blue-400/20" />
            <p className="text-white/30 text-sm text-center">No {tab} sessions yet.<br />Tap Chat to start one.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {DATE_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <p className="text-[11px] font-semibold text-white/35 uppercase tracking-widest mb-2 px-1">{group}</p>
                <div className="space-y-0.5">
                  {grouped[group].map((session) => (
                    <button
                      key={session.id}
                      onClick={() => setLocation(`/juno?resume=${session.id}`)}
                      className="w-full text-left px-3 py-2.5 rounded-xl transition-all active:scale-[0.99] hover:bg-white/5"
                      data-testid={`row-session-${session.id}`}
                    >
                      <span className="text-[15px] text-white/85 leading-snug line-clamp-1">
                        {session.title || "Untitled session"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Chat button */}
      <div className="fixed bottom-6 right-5 z-20">
        <button
          onClick={() => setShowNewChat(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-full font-semibold text-sm shadow-lg active:scale-95 transition-transform"
          style={{
            background: "linear-gradient(135deg, rgba(55,115,215,0.97) 0%, rgba(40,90,190,0.98) 100%)",
            border: "1px solid rgba(120,180,255,0.35)",
            boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
            color: "#fff",
          }}
          data-testid="button-new-chat"
        >
          <Pencil className="w-4 h-4" />
          Chat
        </button>
      </div>

      {/* New chat popup */}
      {showNewChat && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm" onClick={() => setShowNewChat(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl p-5"
            style={{ background: "rgba(10,22,58,0.98)", border: "1px solid rgba(59,130,246,0.2)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">New {tab === "chat" ? "Chat" : "Voice"} Session</h2>
              <button onClick={() => setShowNewChat(false)} className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8">
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>
            <input
              autoFocus
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartChat()}
              placeholder="What do you want to talk about? (optional)"
              className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30 outline-none mb-4"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(59,130,246,0.25)" }}
              data-testid="input-new-session-topic"
            />
            <button
              onClick={handleStartChat}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, rgba(55,115,215,0.97) 0%, rgba(40,90,190,0.98) 100%)" }}
              data-testid="button-start-session"
            >
              Start {tab === "chat" ? "Chat" : "Voice Session"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
