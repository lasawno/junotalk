import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getClientConfig } from "@/lib/client-config";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface UseSocketChatOptions {
  userId: string | null;
  enabled?: boolean;
  onMessage?: (event: string, data: any) => void;
}

export function useSocketChat({ userId, enabled = true, onMessage }: UseSocketChatOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const socketRef = useRef<Socket | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!userId || !enabled) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setStatus("disconnected");
      return;
    }

    const cfg = getClientConfig();
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const socket = io(`${protocol}//${window.location.host}/chat`, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: cfg.socket_chat_reconnect_delay_ms,
      reconnectionDelayMax: cfg.socket_chat_reconnect_delay_max_ms,
      timeout: cfg.socket_chat_timeout_ms,
    });

    socketRef.current = socket;
    setStatus("connecting");

    socket.on("connect", () => {
      setStatus("connected");
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
    });

    socket.on("reconnect_attempt", () => {
      setStatus("reconnecting");
    });

    socket.on("connect_error", () => {
      setStatus("reconnecting");
    });

    // Server signals an imminent restart — broadcast globally so the
    // ConnectionBanner can show immediately (before the TCP drop is detected).
    socket.on("server:restarting", () => {
      window.dispatchEvent(new CustomEvent("jt:server:restarting"));
    });

    const chatEvents = [
      "new-message",
      "message-sent",
      "typing",
      "reaction-update",
      "message-edited",
      "message-deleted",
      "verified",
      "msg-status-update",
      "chat-presence",
      "error-msg",
      "user-presence-update",
      "presence-batch",
      "message-translated",
    ];

    chatEvents.forEach(event => {
      socket.on(event, (data: any) => {
        onMessageRef.current?.(event, data);
      });
    });

    const handleRestored = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      }
    };
    window.addEventListener("juno:page-restored", handleRestored);

    return () => {
      window.removeEventListener("juno:page-restored", handleRestored);
      socket.disconnect();
      socketRef.current = null;
      setStatus("disconnected");
    };
  }, [userId, enabled]);

  const emit = useCallback((event: string, data: any): boolean => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
      return true;
    }
    return false;
  }, []);

  const subscribe = useCallback((roomCode: string) => {
    emit("subscribe", { roomCode });
  }, [emit]);

  const unsubscribe = useCallback((roomCode: string) => {
    emit("unsubscribe", { roomCode });
  }, [emit]);

  return {
    status,
    emit,
    subscribe,
    unsubscribe,
    connected: status === "connected",
    socket: socketRef,
  };
}
