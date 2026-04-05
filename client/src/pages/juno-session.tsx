import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Mic, MessageSquare, Trash2, Loader2, Clock } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ConversationMessage {
  role: string;
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  sessionType: string;
  durationSeconds: number;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

function formatDuration(secs: number): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m} min${s > 0 ? ` ${s}s` : ""}`;
}

export default function JunoSession() {
  const [, params] = useRoute("/juno/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = params?.id;

  const { data: conv, isLoading } = useQuery<Conversation>({
    queryKey: ["/api/v1/juno/conversations", id],
    queryFn: () =>
      fetch(`/api/v1/juno/conversations/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/v1/juno/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/juno/conversations"] });
      toast({ title: "Session deleted" });
      setLocation("/juno/history");
    },
    onError: () => toast({ title: "Failed to delete session", variant: "destructive" }),
  });

  const isVoice = conv?.sessionType === "voice";

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(180deg, #050c1e 0%, #152a58 100%)" }}
    >
      <div
        className="sticky top-0 z-10 px-4 pt-4 pb-3"
        style={{ background: "rgba(5,12,30,0.95)", backdropFilter: "blur(10px)" }}
      >
        <div className="flex items-center gap-3">
          <BackTriangle />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-white truncate">
              {conv?.title ?? "Session"}
            </h1>
            {conv && (
              <p className="text-xs text-blue-300/50 mt-0.5 flex items-center gap-1.5">
                {isVoice ? <Mic className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                {isVoice ? "Voice" : "Chat"} ·{" "}
                {format(new Date(conv.createdAt), "MMM d, yyyy h:mm a")}
                {conv.durationSeconds > 0 && (
                  <>
                    {" "}· <Clock className="w-3 h-3 inline" /> {formatDuration(conv.durationSeconds)}
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-90"
            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}
            data-testid="button-delete-session"
          >
            {deleteMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5 text-red-400" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          </div>
        ) : !conv?.messages?.length ? (
          <p className="text-center text-blue-300/40 text-sm py-12">
            No messages in this session.
          </p>
        ) : (
          conv.messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={i}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                data-testid={`bubble-message-${i}`}
              >
                <div
                  className="max-w-[82%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                  style={
                    isUser
                      ? {
                          background: "rgba(59,130,246,0.25)",
                          border: "1px solid rgba(59,130,246,0.35)",
                          color: "rgba(255,255,255,0.92)",
                          borderBottomRightRadius: 6,
                        }
                      : {
                          background: "rgba(15,26,46,0.9)",
                          border: "1px solid rgba(59,130,246,0.18)",
                          color: "rgba(255,255,255,0.85)",
                          borderBottomLeftRadius: 6,
                        }
                  }
                >
                  {msg.content}
                </div>
              </div>
            );
          })
        )}
      </div>
      {/* Continue button */}
      {conv && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3 z-10" style={{ background: "linear-gradient(to top, rgba(5,12,30,0.98) 60%, transparent)" }}>
          <button
            onClick={() => setLocation(`/juno?resume=${id}`)}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            style={{
              background: "linear-gradient(135deg, rgba(55,115,215,0.97) 0%, rgba(40,90,190,0.98) 100%)",
              border: "1px solid rgba(120,180,255,0.3)",
              boxShadow: "0 4px 20px rgba(59,130,246,0.3)",
            }}
            data-testid="button-continue-session"
          >
            {isVoice ? <Mic className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
            Continue this conversation
          </button>
        </div>
      )}
    </div>
  );
}
