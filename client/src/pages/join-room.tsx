import { useState, useEffect } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n.jsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  LogIn,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { safeDisplayName } from "@/lib/utils";

export default function JoinRoom() {
  const [, params] = useRoute("/join/:code");
  const [, setLocation] = useLocation();
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const roomCode = params?.code?.toUpperCase() || "";

  const [autoJoining, setAutoJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !roomCode || autoJoining) return;
    setAutoJoining(true);

    try { localStorage.removeItem(STORAGE_KEYS.pendingRoom); } catch {}

    const username = safeDisplayName(user.firstName, user.lastName, undefined, "Guest");
    fetch(`/api/room-members/${roomCode}/rejoin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username }),
    })
      .then(async (res) => {
        if (res.ok) {
          setLocation(`/chat-rooms/${roomCode}`);
        } else {
          const data = await res.json().catch(() => ({}));
          if (data.roomFull) {
            setJoinError(t("room.roomFull") || "This room is full. Only 2 people can be in a room at a time.");
          } else {
            setJoinError(t("room.roomNotFound") || "Room not found");
          }
        }
      })
      .catch(() => {
        setJoinError(t("common.retry") || "Something went wrong");
      });
  }, [user, roomCode, autoJoining, setLocation, t]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="relative w-16 h-16 rounded-2xl bg-primary mx-auto flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-primary-foreground" />
              <span className="absolute -top-1 -right-2 text-[8px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded uppercase tracking-wider">Beta</span>
            </div>
            <CardTitle className="text-2xl">{t("room.joinRoom")}</CardTitle>
            <p className="text-muted-foreground mt-2">
              {t("room.joinedRoom")} <span className="font-mono font-bold">{roomCode}</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              Sign in with your email to join the video call
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                try { localStorage.setItem(STORAGE_KEYS.pendingRoom, roomCode); } catch {}
                window.location.href = `/api/login?returnTo=/join/${roomCode}`;
              }}
              data-testid="button-sign-in-join"
            >
              <LogIn className="w-5 h-5 mr-2" />
              Sign in with Email
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Free and secure video calls with real-time translated captions
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 flex-shrink-0 flex items-center justify-center rounded-full bg-destructive/10"><AlertCircle className="w-8 h-8 text-destructive" /></div>
            <CardTitle className="text-xl">{joinError}</CardTitle>
            <p className="text-muted-foreground mt-2">
              Room <span className="font-mono font-bold">{roomCode}</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => {
                setJoinError(null);
                setAutoJoining(false);
              }}
              data-testid="button-retry-join"
            >
              {t("common.retry")}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation("/")}
              data-testid="button-go-home"
            >
              {t("common.goHome") || "Go Home"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">{t("room.joinRoom")}...</p>
      </div>
    </div>
  );
}
