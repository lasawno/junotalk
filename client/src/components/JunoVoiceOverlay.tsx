/**
 * JunoVoiceOverlay — fully self-contained voice conversation UI.
 *
 * All voice logic (hook), all state, and all overlay JSX live here.
 * home.tsx wraps this in an <ErrorBoundary> so a crash here never
 * takes the home page down.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X, Clock, MessageSquare, Mic, ChevronRight, Archive, Loader2 } from "lucide-react";
import { useJunoConversation, type JunoSessionConfig } from "@/hooks/use-juno-conversation";
import { useAuth } from "@/hooks/use-auth";
import { format, isToday, isYesterday } from "date-fns";
import planetOrbImg from "@assets/Untitled_design_1774637544301.png";

export interface JunoVoiceOverlayHandle {
  handleMicTap: () => void;
  handleTextSubmit: (text: string) => void;
}

interface Props {
  userLang?: string;
  config?: JunoSessionConfig;
}

interface ConversationSummary {
  id: string; title: string; sessionType: string;
  durationSeconds: number; messageCount: number; createdAt: string;
}

type HistoryTab = "chat" | "voice";

function formatDuration(secs: number) {
  if (!secs) return "";
  const m = Math.floor(secs / 60), s = secs % 60;
  return m === 0 ? `${s}s` : `${m}min${s > 0 ? ` ${s}s` : ""}`;
}

function groupByDate(items: { createdAt: string }[]): Record<string, typeof items> {
  const groups: Record<string, typeof items> = {};
  for (const item of items) {
    const d = new Date(item.createdAt);
    const label = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, MMM d");
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

const DOTS = ["junoD1", "junoD2", "junoD3", "junoD4"] as const;

const JunoVoiceOverlay = forwardRef<JunoVoiceOverlayHandle, Props>(
  ({ userLang, config }, ref) => {
    const [
      { showOverlay, listeningState, currentMessage, isSpeaking },
      { handleMicTap, handleTextSubmit, closeOverlay },
    ] = useJunoConversation(userLang, config);

    const [showHistory, setShowHistory] = useState(false);
    const [historyTab, setHistoryTab] = useState<HistoryTab>("chat");
    const [showArchived, setShowArchived] = useState(false);
    const [, setLocation] = useLocation();
    const { user } = useAuth();

    useImperativeHandle(ref, () => ({ handleMicTap, handleTextSubmit }), [handleMicTap, handleTextSubmit]);

    const { data: liveSessions = [], isLoading: sessionsLoading } = useQuery<ConversationSummary[]>({
      queryKey: ["/api/v1/juno/conversations", historyTab],
      queryFn: () =>
        fetch(`/api/v1/juno/conversations?type=${historyTab}`, { credentials: "include" }).then(r => r.json()),
      enabled: showHistory && !!user,
      staleTime: 30000,
    });

    const { data: archivedSessions = [], isLoading: archiveLoading } = useQuery<ConversationSummary[]>({
      queryKey: ["/api/v1/juno/conversations/archived"],
      queryFn: () =>
        fetch("/api/v1/juno/conversations/archived", { credentials: "include" }).then(r => r.json()),
      enabled: showHistory && showArchived && !!user,
      staleTime: 60000,
    });

    const filteredArchived = archivedSessions.filter(s => s.sessionType === historyTab);

    if (!showOverlay) return null;

    return (
      <>
        {/* Voice overlay */}
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center"
          style={{ background: "rgba(5,10,25,0.50)" }}
          onClick={closeOverlay}
          data-testid="overlay-juno-listening"
        >
          <style>{`
            @keyframes junoD1 {
              0%,  32%, 46%, 100% { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; }
              39%                 { transform: scaleY(3.4); border-radius: 30%; opacity: 1;    }
            }
            @keyframes junoD2 {
              0%                  { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; }
              6%                  { transform: scaleY(3.4); border-radius: 30%; opacity: 1;    }
              13%, 49%            { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; }
              56%                 { transform: scaleY(3.4); border-radius: 30%; opacity: 1;    }
              63%, 100%           { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; }
            }
            @keyframes junoD3 {
              0%,  66%, 80%, 100% { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; }
              73%                 { transform: scaleY(3.4); border-radius: 30%; opacity: 1;    }
            }
            @keyframes junoD4 {
              0%,  16%  { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; background: rgba(255,255,255,0.95); box-shadow: 0 0 6px rgba(255,255,255,0.7); }
              23%        { transform: scaleY(3.4); border-radius: 30%; opacity: 1;   background: rgb(186,230,253);        box-shadow: 0 0 10px rgba(186,230,253,0.85); }
              30%, 82%  { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; background: rgba(255,255,255,0.95); box-shadow: 0 0 6px rgba(255,255,255,0.7); }
              89%        { transform: scaleY(3.4); border-radius: 30%; opacity: 1;   background: rgb(186,230,253);        box-shadow: 0 0 10px rgba(186,230,253,0.85); }
              96%, 100% { transform: scaleY(1);   border-radius: 50%; opacity: 0.92; background: rgba(255,255,255,0.95); box-shadow: 0 0 6px rgba(255,255,255,0.7); }
            }
          `}</style>

          {/* History button — top right */}
          <button
            onClick={e => { e.stopPropagation(); setShowHistory(true); }}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all active:scale-90"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(10px)",
              color: "rgba(255,255,255,0.7)",
              fontSize: 12,
              fontWeight: 500,
            }}
            data-testid="button-juno-history"
          >
            <Clock size={13} strokeWidth={2} />
            History
          </button>

          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Planet orb */}
            <div style={{
              width: 130, height: 130, borderRadius: "50%",
              position: "relative", flexShrink: 0, overflow: "hidden",
              backgroundImage: `url(${planetOrbImg})`,
              backgroundSize: "cover", backgroundPosition: "center center",
              backgroundRepeat: "no-repeat",
            }}>
              {/* Four bouncing dots */}
              <div style={{
                position: "absolute", left: "50%", top: "50%",
                transform: "translate(-50%, calc(-50% + 8px))",
                display: "flex", alignItems: "center", gap: 5,
                zIndex: 1, pointerEvents: "none",
              }}>
                {DOTS.map((anim, i) => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(255,255,255,0.95)",
                    boxShadow: "0 0 6px rgba(255,255,255,0.7)",
                    animation: `${anim} 3.2s ease-in-out infinite`,
                    animationPlayState: (listeningState === "responding" || (listeningState === "listening" && isSpeaking)) ? "running" : "paused",
                  }} />
                ))}
              </div>
            </div>

            {/* Message bubble + state label */}
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "none" }}>
              {currentMessage && (
                <div style={{
                  maxWidth: 260,
                  background: "rgba(255,255,255,0.11)",
                  backdropFilter: "blur(12px)",
                  borderRadius: 18,
                  padding: "10px 16px",
                  color: "rgba(255,255,255,0.94)",
                  fontSize: 14, fontWeight: 500,
                  textAlign: "center", lineHeight: 1.45,
                  border: "1px solid rgba(255,255,255,0.16)",
                }}>
                  {currentMessage}
                </div>
              )}

              <div style={{
                fontSize: 11, fontWeight: 500,
                letterSpacing: "0.06em", textTransform: "uppercase",
                color: listeningState === "listening"
                  ? "rgba(186,230,253,0.85)"
                  : listeningState === "processing"
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.0)",
                transition: "color 0.3s ease",
                height: 16,
              }}>
                {listeningState === "listening" ? "Listening…" : listeningState === "processing" ? "Thinking…" : ""}
              </div>
            </div>

            {/* Stop button */}
            <button
              onClick={closeOverlay}
              data-testid="button-juno-stop"
              style={{
                marginTop: 28,
                width: 44, height: 44,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                backdropFilter: "blur(10px)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                color: "rgba(255,255,255,0.65)",
                transition: "background 0.2s ease, color 0.2s ease",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.16)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.95)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.65)";
              }}
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Full-page history panel */}
        {showHistory && (
          <div
            className="fixed inset-0 z-[70] flex flex-col"
            style={{ background: "linear-gradient(180deg, #050c1e 0%, #152a58 100%)" }}
            data-testid="panel-juno-history"
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 pt-5 pb-4 flex-shrink-0"
              style={{ borderBottom: "1px solid rgba(59,130,246,0.15)", background: "rgba(5,12,30,0.95)", backdropFilter: "blur(10px)" }}
            >
              <img src={planetOrbImg} className="w-9 h-9 object-contain flex-shrink-0" alt="Juno" />
              <div className="flex-1">
                <p className="text-base font-semibold text-white">Juno History</p>
                <p className="text-[10px] text-blue-300/45 mt-0.5">All your past conversations</p>
              </div>
              <button
                onClick={() => { setShowHistory(false); setShowArchived(false); }}
                className="w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                data-testid="button-close-history-panel"
              >
                <X className="w-4 h-4 text-white/55" />
              </button>
            </div>

            {/* Chat / Voice tabs */}
            <div className="px-4 pt-4 pb-3 flex-shrink-0">
              <div
                className="flex rounded-full p-1"
                style={{ background: "rgba(15,26,46,0.9)", border: "1px solid rgba(59,130,246,0.22)" }}
              >
                {(["chat", "voice"] as HistoryTab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setHistoryTab(t)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-all"
                    style={{
                      background: historyTab === t ? "rgba(59,130,246,0.25)" : "transparent",
                      color: historyTab === t ? "#93c5fd" : "rgba(147,197,253,0.4)",
                      border: historyTab === t ? "1px solid rgba(59,130,246,0.35)" : "1px solid transparent",
                    }}
                    data-testid={`tab-history-panel-${t}`}
                  >
                    {t === "chat" ? <MessageSquare className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    {t === "chat" ? "Chat History" : "Voice History"}
                  </button>
                ))}
              </div>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
              {sessionsLoading ? (
                <div className="flex justify-center py-14">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
              ) : liveSessions.length === 0 && !showArchived ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  {historyTab === "chat"
                    ? <MessageSquare className="w-10 h-10 text-blue-400/25" />
                    : <Mic className="w-10 h-10 text-blue-400/25" />}
                  <p className="text-blue-300/45 text-sm text-center">
                    No {historyTab} sessions yet.<br />Start a conversation with Juno to see it here.
                  </p>
                </div>
              ) : (
                Object.entries(groupByDate(liveSessions)).map(([label, group]) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold text-blue-300/45 uppercase tracking-widest px-1 mb-2.5">{label}</p>
                    <div className="space-y-2">
                      {group.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => { setShowHistory(false); closeOverlay(); setLocation(`/juno/session/${s.id}`); }}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-[0.98]"
                          style={{ background: "rgba(28,52,108,0.65)", border: "1px solid rgba(59,130,246,0.15)" }}
                          data-testid={`row-history-panel-${s.id}`}
                        >
                          <div
                            className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center"
                            style={{
                              background: s.sessionType === "voice"
                                ? "radial-gradient(circle at 35% 35%, #4fa8f7 0%, #1a6fd4 55%, #1560b8 100%)"
                                : "rgba(59,130,246,0.18)",
                              border: s.sessionType === "voice" ? "none" : "1px solid rgba(59,130,246,0.3)",
                            }}
                          >
                            {s.sessionType === "voice"
                              ? <Mic className="w-4 h-4 text-white" />
                              : <MessageSquare className="w-4 h-4 text-blue-300" />}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-medium text-white truncate">{s.title || "Untitled session"}</p>
                            <div className="flex items-center gap-2.5 mt-0.5">
                              <span className="text-xs text-blue-300/45">{format(new Date(s.createdAt), "h:mm a")}</span>
                              {s.durationSeconds > 0 && (
                                <span className="text-xs text-blue-300/40 flex items-center gap-0.5">
                                  <Clock className="w-3 h-3" />{formatDuration(s.durationSeconds)}
                                </span>
                              )}
                              {s.messageCount > 0 && (
                                <span className="text-xs text-blue-300/40">{s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-blue-400/35 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Archived */}
              <button
                onClick={() => setShowArchived(v => !v)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-full text-sm font-medium text-blue-300/50 transition-all active:scale-[0.97]"
                style={{ border: "1px solid rgba(59,130,246,0.18)" }}
                data-testid="button-show-archived-panel"
              >
                <Archive className="w-4 h-4" />
                {showArchived ? "Hide" : "Show"} Archived Sessions
              </button>

              {showArchived && (
                <div className="space-y-2">
                  {archiveLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    </div>
                  ) : filteredArchived.length === 0 ? (
                    <p className="text-center text-blue-300/35 text-sm py-6">No archived {historyTab} sessions.</p>
                  ) : (
                    filteredArchived.map(s => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl opacity-50"
                        style={{ background: "rgba(15,26,46,0.4)", border: "1px solid rgba(59,130,246,0.1)" }}
                        data-testid={`row-archived-panel-${s.id}`}
                      >
                        <Archive className="w-4 h-4 text-blue-400/40 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/55 truncate">{s.title || "Untitled"}</p>
                          <p className="text-xs text-blue-300/35 mt-0.5">{format(new Date(s.createdAt), "MMM d, yyyy")}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }
);

JunoVoiceOverlay.displayName = "JunoVoiceOverlay";
export default JunoVoiceOverlay;
