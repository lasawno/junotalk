import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { Message } from "@shared/schema";
import { getClientConfig } from "@/lib/client-config";

interface DmTypingEvent { senderId: string; isTyping: boolean; }
interface DmReadAckEvent { readBy: string; }

interface UseDmSocketOptions {
  contactId: string | undefined;
  onMessage: (msg: Message) => void;
  onTyping?: (ev: DmTypingEvent) => void;
  onReadAck?: (ev: DmReadAckEvent) => void;
  onDelivered?: (ev: { messageId: string; receiverId: string }) => void;
}

export function useDmSocket({
  contactId,
  onMessage,
  onTyping,
  onReadAck,
  onDelivered,
}: UseDmSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientIdRef = useRef(0);

  useEffect(() => {
    const cfg = getClientConfig();
    const socket = io("/dm", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: cfg.socket_dm_reconnect_attempts,
      reconnectionDelay: cfg.socket_dm_reconnect_delay_ms,
      reconnectionDelayMax: cfg.socket_dm_reconnect_delay_max_ms,
      timeout: cfg.socket_dm_timeout_ms,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("dm:message", (msg: Message) => onMessage(msg));
    socket.on("dm:sent", (msg: Message & { clientId?: number }) => onMessage(msg));
    socket.on("dm:typing", (ev: DmTypingEvent) => onTyping?.(ev));
    socket.on("dm:read-ack", (ev: DmReadAckEvent) => onReadAck?.(ev));
    socket.on("dm:delivered", (ev: { messageId: string; receiverId: string }) => onDelivered?.(ev));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback((content: string): number => {
    const clientId = ++clientIdRef.current;
    socketRef.current?.emit("dm:send", {
      receiverId: contactId,
      content,
      clientId,
    });
    return clientId;
  }, [contactId]);

  const sendTyping = useCallback((isTyping: boolean) => {
    if (!contactId) return;
    socketRef.current?.emit("dm:typing", { receiverId: contactId, isTyping });
  }, [contactId]);

  const markRead = useCallback(() => {
    if (!contactId) return;
    socketRef.current?.emit("dm:read", { senderId: contactId });
  }, [contactId]);

  const startTyping = useCallback(() => {
    sendTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => sendTyping(false), 3000);
  }, [sendTyping]);

  const stopTyping = useCallback(() => {
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
    sendTyping(false);
  }, [sendTyping]);

  return { connected, sendMessage, startTyping, stopTyping, markRead };
}
