import { useState, useRef, useCallback, useEffect } from "react";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  AlertTriangle,
  TicketCheck,
  Bot,
  ChevronDown,
  HelpCircle,
  Mic,
  MicOff,
  Volume2,
  Video,
  MessageSquare,
  Shield,
  Smartphone,
  Globe,
  Eye,
  User,
  ArrowLeft,
  SquarePen,
  Sparkles,
  Clock,
  Trash2,
  Plus,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import BackTriangle from "@/components/BackTriangle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SupportTicket } from "@shared/schema";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useI18n } from "@/lib/i18n.jsx";

const FAQ_CATEGORIES = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: HelpCircle,
    color: "text-blue-400",
    items: [
      {
        q: "What is JunoTalk?",
        a: "JunoTalk is an all-in-one communication platform with AI-powered voice translation, encrypted video and voice calls, multilingual messaging, and travel eSIM. Everything is built around one goal: helping people communicate across any language barrier, securely.",
      },
      {
        q: "Do I need a phone number to sign up?",
        a: "No phone number required. JunoTalk uses a unique @username system. Just create an account, pick your username, and you're ready. No SIM card, no verification code, no personal data required to get started.",
      },
      {
        q: "How do I connect with someone?",
        a: "You can connect two ways: search for someone by their @username and send a message, or create a chat room and share the 6-character room code. Anyone with the code can join instantly.",
      },
      {
        q: "What languages does JunoTalk support?",
        a: "JunoTalk supports a wide range of languages for text and voice translation, including English, Spanish, French, German, Chinese (Simplified), Japanese, Korean, Arabic, Hindi, Portuguese, Italian, Russian, Dutch, Turkish, Vietnamese, and more.",
      },
    ],
  },
  {
    id: "juno-ai",
    label: "Juno AI Voice Translation",
    icon: Mic,
    color: "text-emerald-400",
    items: [
      {
        q: "How does Juno voice translation work?",
        a: "Tap the microphone button, speak naturally in your language, and Juno instantly transcribes, translates, and speaks the result in the target language using a natural AI voice. The translation appears on screen as both text and speech, no typing needed.",
      },
      {
        q: "What is the \"Hey Juno\" wake word?",
        a: "\"Hey Juno\" is a hands-free activation phrase. When wake word mode is on, just say \"Hey Juno\" and it will start listening automatically, no button tap needed. Useful when your hands are busy or your phone is across the room.",
      },
      {
        q: "Can I choose a different AI voice?",
        a: "Yes. JunoTalk offers 6 AI voices: Nova, Alloy, Echo, Fable, Onyx, and Shimmer. You can preview each voice before selecting it. The voice selection is saved to your preferences. You can also adjust the speech speed.",
      },
      {
        q: "Why isn't Juno speaking the translation out loud?",
        a: "On iPhone and iPad, audio requires a user gesture before it can play. Make sure you've tapped the microphone button first, which unlocks audio. Also ensure your device is not on silent/mute and your volume is turned up. If audio still doesn't play, check that your browser allows microphone access.",
      },
      {
        q: "Can I translate back and forth in a conversation?",
        a: "Yes. Use the swap button to flip the source and target languages mid-conversation. Juno keeps context from recent exchanges so translations stay natural and coherent, not robotic and literal.",
      },
    ],
  },
  {
    id: "juno-vision",
    label: "Juno Vision",
    icon: Eye,
    color: "text-purple-400",
    items: [
      {
        q: "What is Juno Vision?",
        a: "Juno Vision is JunoTalk's camera-based translator. Point your camera at any text: a sign, menu, document, label, or screen, and Juno identifies what it sees and translates it into your language instantly.",
      },
      {
        q: "What can Juno Vision translate?",
        a: "Juno Vision can translate printed text, handwritten signs, restaurant menus, product labels, street signs, and documents. It also provides context. For example, if you point at a food item, it may describe what it is and provide a translation.",
      },
      {
        q: "Do I need to take a photo or does it translate live?",
        a: "Juno Vision captures a frame from your camera and processes it. Tap the capture button to analyze what's in view. Results come back within a few seconds with the translated text displayed on screen.",
      },
    ],
  },
  {
    id: "calls-video",
    label: "Calls & Video",
    icon: Video,
    color: "text-cyan-400",
    items: [
      {
        q: "How do encrypted calls work?",
        a: "All JunoTalk calls use end-to-end encryption. Your audio and video are encrypted before they leave your device and can only be decrypted by the person you're calling. Nobody in between, including JunoTalk servers, can listen in.",
      },
      {
        q: "How do I start a video or voice call?",
        a: "Open a conversation with a contact and tap the video or phone icon at the top of the chat. If they're available, the call connects. For group calls, create or join a chat room and start the call from there.",
      },
      {
        q: "What are chat rooms?",
        a: "Chat rooms are shared spaces where multiple people can message and call together. Each room has a unique 6-character code; share that code with anyone and they can join instantly, no account required to receive the invite.",
      },
      {
        q: "Can calls be translated in real time?",
        a: "Yes. During calls, live translated captions appear on screen as each participant speaks. This lets two people have a full conversation in different languages: you hear them in their language, read it translated in yours.",
      },
    ],
  },
  {
    id: "messaging",
    label: "Messaging & Translation",
    icon: MessageSquare,
    color: "text-yellow-400",
    items: [
      {
        q: "How does message translation work?",
        a: "Every message sent in JunoTalk is automatically translated for the recipient based on their language preference. You write in your language, they read it in theirs, in real time, with no extra steps on either side.",
      },
      {
        q: "Can I send voice messages?",
        a: "Yes. Tap and hold the microphone icon in any chat to record a voice message. When delivered, it's automatically transcribed to text. The recipient can also translate the transcription into their language with one tap.",
      },
      {
        q: "Are my messages saved or deleted?",
        a: "Messages are stored securely and only visible to the participants in the conversation. You can manually delete messages at any time. JunoTalk never reads or uses your message content for any purpose other than delivering it.",
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy & Security",
    icon: Shield,
    color: "text-red-400",
    items: [
      {
        q: "How does JunoTalk protect my data?",
        a: "JunoTalk uses AES-256 encryption for stored personal data and HTTPS for all data in transit. Voice recordings are never permanently stored; they're processed for translation and discarded. No voice or video content is ever kept on our servers.",
      },
      {
        q: "Does JunoTalk sell my data?",
        a: "No. JunoTalk does not sell, rent, or share your personal data with third parties for marketing or advertising. Your data is only used to operate the service. See our Privacy Policy for the full details.",
      },
      {
        q: "Can I delete my account?",
        a: "Yes. You can delete your account and all associated data from Settings → Account. Once deleted, your messages, profile, and personal data are permanently removed from our systems within 30 days.",
      },
    ],
  },
  {
    id: "esim",
    label: "Travel eSIM",
    icon: Globe,
    color: "text-orange-400",
    items: [
      {
        q: "What is the Travel eSIM feature?",
        a: "JunoTalk offers instant travel eSIM data plans for countries worldwide. Instead of buying a local SIM or paying roaming fees, you activate a digital eSIM on your phone before or after you land and data starts working immediately.",
      },
      {
        q: "How do I activate a Travel eSIM?",
        a: "Go to Travel eSIM in the app, pick your destination, choose a data plan, complete the purchase, and scan the QR code with your phone's camera. The eSIM installs automatically. Compatible with any unlocked eSIM-enabled device.",
      },
      {
        q: "Which devices support eSIM?",
        a: "Most modern smartphones support eSIM, including iPhone XS and later, Google Pixel 3 and later, and many Samsung Galaxy models. Your device must be unlocked (not carrier-locked) to use a travel eSIM.",
      },
    ],
  },
  {
    id: "account",
    label: "Account & Settings",
    icon: User,
    color: "text-[#ff0000]",
    items: [
      {
        q: "How does the @username system work?",
        a: "Every JunoTalk account has a unique @username that others can use to find and contact you. Your username is public, but your contact details, phone number, and email are never visible to other users.",
      },
      {
        q: "Can I change my username?",
        a: "Yes. Go to Settings → Profile and tap your username to edit it. Usernames must be 3 to 20 characters and can only contain letters, numbers, and underscores. Availability is checked in real time as you type.",
      },
      {
        q: "What if I forget my password?",
        a: "On the login screen, tap \"Forgot password\" and enter your registered email. You'll receive a reset link within a few minutes. If you don't see it, check your spam folder. If you still can't access your account, contact support below.",
      },
    ],
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border-b border-white/5 last:border-0"
      data-testid={`faq-item-${q.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
    >
      <button
        className="w-full flex items-start justify-between gap-3 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-medium text-foreground leading-snug">{q}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="pb-3 text-sm text-muted-foreground leading-relaxed pr-6">{a}</p>
      )}
    </div>
  );
}

function FAQSection() {
  const [activeCategory, setActiveCategory] = useState("getting-started");
  const active = FAQ_CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        {FAQ_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const isActive = cat.id === activeCategory;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              data-testid={`faq-category-${cat.id}`}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className="w-3 h-3" />
              {cat.label.split(" ")[0]}
            </button>
          );
        })}
      </div>

      <Card
        className="border border-white/5"
        style={{ background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 60%, #1a3a6e 100%)" }}
      >
        <CardContent className="pt-4 pb-2 px-4">
          <div className="flex items-center gap-2 mb-3">
            {(() => { const Icon = active.icon; return <Icon className={`w-4 h-4 ${active.color}`} />; })()}
            <span className={`text-sm font-semibold ${active.color}`}>{active.label}</span>
          </div>
          <div>
            {active.items.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground pt-1">
        Didn't find your answer?{" "}
        <button
          className="text-primary underline underline-offset-2"
          onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="button-support-chat-tab"]')?.click()}
        >
          Ask our AI assistant
        </button>{" "}
        or{" "}
        <button
          className="text-primary underline underline-offset-2"
          onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="button-support-ticket-tab"]')?.click()}
        >
          submit a ticket
        </button>
        .
      </p>
    </div>
  );
}

export default function Support() {
  useSEO(SEO_CONFIGS.support);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const supportChatContainerRef = useRef<HTMLDivElement>(null);

  const [supportTab, setSupportTab] = useState<"faq" | "chat" | "ticket" | "history">("faq");

  // Lock body scroll when the full-screen chat panel is open so iOS keyboard doesn't jump the page
  useEffect(() => {
    if (supportTab !== "chat") return;
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, [supportTab]);

  const [chatMessages, setChatMessages] = useState<{role: "user" | "assistant"; content: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showConversationList, setShowConversationList] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [orbSpeaking, setOrbSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const orbAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const voiceRecognitionRef = useRef<any>(null);
  const [ticketCategory, setTicketCategory] = useState("other");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [ticketSubmitting, setTicketSubmitting] = useState(false);

  const { data: myTickets = [], isLoading: loadingTickets } = useQuery<SupportTicket[]>({
    queryKey: ["/api/support/tickets"],
    enabled: !!user,
  });

  const { data: junoConversations = [], refetch: refetchConversations } = useQuery<{
    id: string; title: string | null; updatedAt: string | null; createdAt: string | null; messageCount: number;
  }[]>({
    queryKey: ["/api/v1/juno/conversations"],
    enabled: !!user && showConversationList,
  });

  const deleteConversationMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/v1/juno/conversations/${id}`),
    onSuccess: () => { refetchConversations(); },
  });

  const unlockAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    } else if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
  }, []);

  const stopOrbSpeech = useCallback(() => {
    if (orbAudioSourceRef.current) {
      try { orbAudioSourceRef.current.stop(); } catch {}
      orbAudioSourceRef.current = null;
    }
    setOrbSpeaking(false);
  }, []);

  const playOrbSpeech = useCallback(async (text: string) => {
    stopOrbSpeech();
    try {
      setOrbSpeaking(true);
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, voice: "nova", speed: 0.95 }),
      });
      if (!res.ok) { setOrbSpeaking(false); return; }
      const arrayBuffer = await res.arrayBuffer();
      const ctx = audioContextRef.current || new AudioContext();
      audioContextRef.current = ctx;
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      orbAudioSourceRef.current = source;
      source.onended = () => { orbAudioSourceRef.current = null; setOrbSpeaking(false); };
      source.start(0);
    } catch {
      setOrbSpeaking(false);
    }
  }, [stopOrbSpeech]);

  const startNewChat = useCallback(() => {
    setChatMessages([]);
    setActiveConversationId(null);
    setChatInput("");
    setShowConversationList(false);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/juno/conversations/${id}`, { credentials: "include" });
      const data = await res.json();
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      setChatMessages(msgs.map((m: any) => ({ role: m.role, content: m.content })));
      setActiveConversationId(id);
      setShowConversationList(false);
    } catch {
      toast({ title: "Couldn't load conversation", variant: "destructive" });
    }
  }, [toast]);

  const sendSupportChat = useCallback(async (textOverride?: string, speakReply = false) => {
    const userMsg = (textOverride ?? chatInput).trim();
    if (!userMsg || chatLoading) return;
    if (!textOverride) setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    const scrollChat = () => {
      const container = supportChatContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    setTimeout(scrollChat, 50);
    try {
      const res = await fetch("/api/v1/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMsg, conversationId: activeConversationId }),
      });
      const data = await res.json();
      const reply = data.reply || t("error.somethingWentWrong");
      if (data.conversationId && !activeConversationId) {
        setActiveConversationId(data.conversationId);
      }
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
      if (speakReply) playOrbSpeech(reply);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: t("error.connectionLost") + ". " + t("error.tryAgain") }]);
    } finally {
      setChatLoading(false);
      setTimeout(scrollChat, 100);
    }
  }, [chatInput, chatLoading, t, playOrbSpeech, activeConversationId]);

  const startVoiceCapture = useCallback(() => {
    if (isVoiceListening) {
      if (voiceRecognitionRef.current) {
        try { voiceRecognitionRef.current.stop(); } catch {}
      }
      return;
    }
    unlockAudio();
    stopOrbSpeech();

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Not supported", description: "Voice input requires Chrome or Edge.", variant: "default" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let capturedText = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    recognition.onstart = () => { setIsVoiceListening(true); setVoiceTranscript(""); };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          capturedText = event.results[i][0].transcript.trim();
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setVoiceTranscript(capturedText || interim);
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => { try { recognition.stop(); } catch {} }, 2200);
    };

    recognition.onend = () => {
      setIsVoiceListening(false);
      setVoiceTranscript("");
      if (silenceTimer) clearTimeout(silenceTimer);
      if (capturedText) sendSupportChat(capturedText, true);
    };

    recognition.onerror = (event: any) => {
      setIsVoiceListening(false);
      setVoiceTranscript("");
      if (event.error !== "no-speech" && event.error !== "aborted") {
        toast({ title: "Mic error", description: "Please allow microphone access.", variant: "default" });
      }
    };

    voiceRecognitionRef.current = recognition;
    recognition.start();
  }, [isVoiceListening, unlockAudio, stopOrbSpeech, sendSupportChat, toast]);

  const submitTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim() || ticketSubmitting) return;
    setTicketSubmitting(true);
    try {
      await apiRequest("POST", "/api/support/tickets", {
        category: ticketCategory,
        subject: ticketSubject,
        description: ticketDescription,
        priority: ticketPriority,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setTicketSubject("");
      setTicketDescription("");
      setTicketCategory("other");
      setTicketPriority("medium");
      setSupportTab("history");
      toast({ title: t("support.ticketSubmitted"), description: t("support.ticketSubmitted") });
    } catch {
      toast({ title: t("common.error"), description: t("support.ticketError"), variant: "default" });
    } finally {
      setTicketSubmitting(false);
    }
  };

  if (!user) return null;

  // Full-screen Juno chat mode — completely separate layout
  if (supportTab === "chat") {
    return (
      <div className="fixed inset-0 bg-background flex flex-col z-50">
        {/* Minimal header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-border/40 shrink-0">
          <button
            onClick={() => setSupportTab("faq")}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-chat-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Support</span>
          </button>
          <div className="flex items-center gap-1 text-sm font-medium">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Juno
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowConversationList(v => !v); refetchConversations(); }}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-conversation-history"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={startNewChat}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-new-chat"
            >
              <SquarePen className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* History drawer */}
        {showConversationList && (
          <div className="border-b border-border/40 bg-background/98 overflow-hidden shrink-0" data-testid="conversation-list">
            <div className="max-h-56 overflow-y-auto">
              {junoConversations.length === 0 ? (
                <div className="px-4 py-5 text-center text-sm text-muted-foreground">No past conversations</div>
              ) : junoConversations.map(conv => (
                <div
                  key={conv.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-border/20 hover:bg-muted/30 cursor-pointer group transition-colors ${activeConversationId === conv.id ? "bg-primary/5" : ""}`}
                  onClick={() => loadConversation(conv.id)}
                  data-testid={`conversation-item-${conv.id}`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{conv.title || "Conversation"}</p>
                    <p className="text-xs text-muted-foreground">{conv.messageCount} messages</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteConversationMutation.mutate(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                    data-testid={`button-delete-conversation-${conv.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message stream */}
        <div
          ref={supportChatContainerRef}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-5"
          style={{ overflowAnchor: "none" }}
          data-testid="support-chat-messages"
        >
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 pb-8">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <p className="text-base font-medium">Hi, I'm Juno</p>
                <p className="text-sm text-muted-foreground text-center max-w-[260px]">Ask me anything about JunoTalk: translation, calls, settings, or anything else.</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[300px]">
                {[
                  "How do I change the translation language?",
                  "My audio isn't playing back",
                  "How do video calls work?",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendSupportChat(prompt)}
                    className="text-left text-sm px-4 py-2.5 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground"
                    data-testid={`prompt-${prompt.slice(0, 20)}`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chatMessages.map((msg, i) => (
              msg.role === "user" ? (
                <div key={i} className="flex justify-end" data-testid={`chat-msg-${i}`}>
                  <div className="bg-primary/10 border border-primary/20 text-foreground text-sm px-4 py-2 rounded-2xl rounded-tr-sm max-w-[80%]">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-3 items-start" data-testid={`chat-msg-${i}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2.5 shrink-0" />
                  <p className="text-sm leading-relaxed text-foreground/90 flex-1">{msg.content}</p>
                </div>
              )
            ))
          )}

          {chatLoading && (
            <div className="flex gap-3 items-start">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2.5 shrink-0 animate-pulse" />
              <div className="flex gap-1 pt-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Voice listening indicator */}
        {(isVoiceListening || voiceTranscript) && (
          <div className="px-4 py-2 bg-primary/5 border-t border-primary/10 flex items-center gap-2 shrink-0">
            <div className="flex gap-0.5 items-end">
              {[1,2,3].map(i => (
                <div key={i} className="w-1 bg-primary rounded-full animate-pulse" style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <p className="text-sm text-primary flex-1 min-w-0 truncate">{voiceTranscript || "Listening…"}</p>
          </div>
        )}

        {/* Speaking indicator */}
        {orbSpeaking && (
          <div className="px-4 py-2 bg-emerald-500/5 border-t border-emerald-500/10 flex items-center gap-2 shrink-0">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
            <p className="text-sm text-emerald-400 flex-1">Juno is speaking…</p>
            <button onClick={stopOrbSpeech} className="text-xs text-emerald-400/60 hover:text-emerald-400" data-testid="button-stop-orb-speech">stop</button>
          </div>
        )}

        {/* Pinned input bar */}
        <div className="px-4 py-3 border-t border-border/40 shrink-0">
          <div className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-2xl px-3 py-1">
            <button
              onClick={startVoiceCapture}
              disabled={chatLoading || orbSpeaking}
              className={`p-1.5 rounded-full transition-colors shrink-0 ${isVoiceListening ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-voice-input"
            >
              {isVoiceListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground py-2"
              placeholder="Ask Juno anything…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendSupportChat(); } }}
              disabled={chatLoading || isVoiceListening}
              data-testid="input-support-chat"
            />
            <button
              onClick={() => sendSupportChat()}
              disabled={!chatInput.trim() || chatLoading || isVoiceListening}
              className="p-1.5 rounded-full bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-opacity shrink-0"
              data-testid="button-send-support-chat"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4 flex items-center h-14 gap-0">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-home" label={t("support.title")} />
          {myTickets.filter(tk => tk.status === "open").length > 0 && (
            <Badge variant="secondary" data-testid="badge-open-tickets">
              {myTickets.filter(tk => tk.status === "open").length} {t("support.open").toLowerCase()}
            </Badge>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-20">
        <div className="flex gap-1 border-b pb-2 mb-4 overflow-x-auto scrollbar-none">
          <Button
            variant={supportTab === "faq" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSupportTab("faq")}
            data-testid="button-support-faq-tab"
            className="shrink-0"
          >
            <HelpCircle className="w-4 h-4 mr-1" />
            FAQ
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSupportTab("chat")}
            data-testid="button-support-chat-tab"
            className="shrink-0"
          >
            <Bot className="w-4 h-4 mr-1" />
            {t("support.aiChat")}
          </Button>
          <Button
            variant={supportTab === "ticket" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSupportTab("ticket")}
            data-testid="button-support-ticket-tab"
            className="shrink-0"
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            {t("support.submitTicket")}
          </Button>
          <Button
            variant={supportTab === "history" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSupportTab("history")}
            data-testid="button-support-history-tab"
            className="shrink-0"
          >
            <TicketCheck className="w-4 h-4 mr-1" />
            {t("support.ticketHistory")}
          </Button>
        </div>

        {supportTab === "faq" && <SectionBoundary label="FAQ"><FAQSection /></SectionBoundary>}

        {supportTab === "ticket" && (
          <SectionBoundary label="Submit Ticket">
          <Card className="border border-blue-500/15" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
            <CardContent className="space-y-3 pt-6">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">{t("support.category")}</label>
                  <Select value={ticketCategory} onValueChange={setTicketCategory}>
                    <SelectTrigger data-testid="select-ticket-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="translation">{t("support.translation")}</SelectItem>
                      <SelectItem value="video">{t("support.video")}</SelectItem>
                      <SelectItem value="audio">{t("support.audio")}</SelectItem>
                      <SelectItem value="text">{t("support.text")}</SelectItem>
                      <SelectItem value="account">{t("support.account")}</SelectItem>
                      <SelectItem value="other">{t("support.other")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">{t("support.priority")}</label>
                  <Select value={ticketPriority} onValueChange={setTicketPriority}>
                    <SelectTrigger data-testid="select-ticket-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t("support.low")}</SelectItem>
                      <SelectItem value="medium">{t("support.medium")}</SelectItem>
                      <SelectItem value="high">{t("support.high")}</SelectItem>
                      <SelectItem value="critical">{t("support.critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Input
                placeholder={t("support.subject")}
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                data-testid="input-ticket-subject"
              />
              <Textarea
                placeholder={t("support.description")}
                value={ticketDescription}
                onChange={(e) => setTicketDescription(e.target.value)}
                className="min-h-[150px]"
                data-testid="input-ticket-description"
              />
              <Button
                type="button"
                onClick={(e) => { e.preventDefault(); submitTicket(); }}
                disabled={!ticketSubject.trim() || !ticketDescription.trim() || ticketSubmitting}
                data-testid="button-submit-ticket"
              >
                <Send className="w-4 h-4 mr-2" />
                {ticketSubmitting ? t("support.submitting") : t("support.submit")}
              </Button>
            </CardContent>
          </Card>
          </SectionBoundary>
        )}

        {supportTab === "history" && (
          <SectionBoundary label="Ticket History">
          <div className="space-y-3">
            {loadingTickets ? (
              <div className="space-y-2">
                {[1, 2].map(i => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30 animate-pulse">
                    <div className="h-4 w-32 bg-muted rounded mb-2" />
                    <div className="h-3 w-full bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : myTickets.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <TicketCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("support.noTickets")}</p>
                <p className="text-sm mt-1">{t("support.submitTicket")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myTickets.map((ticket) => (
                  <Card
                    key={ticket.id}
                    data-testid={`ticket-${ticket.id}`}
                    className="border border-blue-500/15"
                    style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{ticket.subject}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-xs">{ticket.category}</Badge>
                          <Badge
                            variant={
                              ticket.status === "open" ? "default" :
                              ticket.status === "in_progress" ? "secondary" :
                              ticket.status === "resolved" ? "outline" : "secondary"
                            }
                            className="text-xs"
                          >
                            {ticket.status === "open" ? t("support.open") :
                             ticket.status === "in_progress" ? t("support.inProgress") :
                             ticket.status === "resolved" ? t("support.resolved") : t("support.closed")}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{ticket.description}</p>
                      {ticket.adminNotes && (
                        <div className="mt-2 p-2 rounded bg-primary/5 border border-primary/10">
                          <p className="text-xs font-medium text-primary">Team Response:</p>
                          <p className="text-xs text-foreground mt-0.5">{ticket.adminNotes}</p>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(ticket.createdAt!).toLocaleDateString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
          </SectionBoundary>
        )}
      </main>
      <div className="pb-20 sm:pb-3" />
      <MobileBottomNav />
    </div>
  );
}
