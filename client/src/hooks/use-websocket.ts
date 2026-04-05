import { useRef, useState, useCallback, useEffect } from "react";
import { getClientConfig } from "@/lib/client-config";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";
export type ConnectionQuality = "excellent" | "good" | "fair" | "poor";

interface UseWebSocketOptions {
  userId: string | null;
  onMessage: (message: any) => void;
  onOpen?: (ws: WebSocket) => void;
  onReconnect?: (ws: WebSocket) => void;
  enabled?: boolean;
}

function getWsCfg() {
  const c = getClientConfig();
  return {
    HEARTBEAT_INTERVAL: c.ws_heartbeat_interval_ms,
    HEARTBEAT_TIMEOUT: c.ws_heartbeat_timeout_ms,
    MAX_RECONNECT_DELAY: c.ws_reconnect_max_delay_ms,
    INITIAL_RECONNECT_DELAY: c.ws_reconnect_initial_delay_ms,
  };
}
const MAX_QUEUED_MESSAGES = 100;
const BACKPRESSURE_THRESHOLD = 64 * 1024;
const RTT_SAMPLES_MAX = 20;

function classifyQuality(rttMs: number): ConnectionQuality {
  if (rttMs <= 100) return "excellent";
  if (rttMs <= 300) return "good";
  if (rttMs <= 800) return "fair";
  return "poor";
}

export function useWebSocket({
  userId,
  onMessage,
  onOpen,
  onReconnect,
  enabled = true,
}: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [quality, setQuality] = useState<ConnectionQuality>("good");
  const [rtt, setRtt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT, MAX_RECONNECT_DELAY, INITIAL_RECONNECT_DELAY } = getWsCfg();
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const messageQueueRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const isFirstConnectRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onReconnectRef = useRef(onReconnect);
  const pingSentAtRef = useRef(0);
  const rttSamplesRef = useRef<number[]>([]);

  onMessageRef.current = onMessage;
  onOpenRef.current = onOpen;
  onReconnectRef.current = onReconnect;

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    clearHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
          return;
        }
        pingSentAtRef.current = performance.now();
        ws.send(JSON.stringify({ type: "ping" }));
        heartbeatTimeoutRef.current = setTimeout(() => {
          console.warn("[WS] Heartbeat timeout — closing connection");
          ws.close();
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, [clearHeartbeat]);

  const flushQueue = useCallback((ws: WebSocket) => {
    while (messageQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) break;
      const msg = messageQueueRef.current.shift();
      if (msg) ws.send(msg);
    }
  }, []);

  const send = useCallback((data: string | object) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
        if (messageQueueRef.current.length < MAX_QUEUED_MESSAGES) {
          messageQueueRef.current.push(payload);
        }
        return;
      }
      ws.send(payload);
    } else {
      if (messageQueueRef.current.length < MAX_QUEUED_MESSAGES) {
        messageQueueRef.current.push(payload);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      setStatus("disconnected");
      return;
    }

    cancelledRef.current = false;
    isFirstConnectRef.current = true;

    function connect() {
      if (cancelledRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelledRef.current) { ws.close(); return; }
        setStatus("connected");
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

        ws.send(JSON.stringify({ type: "register", userId }));

        startHeartbeat(ws);

        if (isFirstConnectRef.current) {
          isFirstConnectRef.current = false;
          onOpenRef.current?.(ws);
        } else {
          onReconnectRef.current?.(ws);
        }

        flushQueue(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "pong") {
            if (heartbeatTimeoutRef.current) {
              clearTimeout(heartbeatTimeoutRef.current);
              heartbeatTimeoutRef.current = null;
            }
            if (pingSentAtRef.current > 0) {
              const measuredRtt = Math.round(performance.now() - pingSentAtRef.current);
              rttSamplesRef.current.push(measuredRtt);
              if (rttSamplesRef.current.length > RTT_SAMPLES_MAX) {
                rttSamplesRef.current = rttSamplesRef.current.slice(-RTT_SAMPLES_MAX);
              }
              const avgRtt = Math.round(
                rttSamplesRef.current.reduce((a, b) => a + b, 0) / rttSamplesRef.current.length
              );
              setRtt(avgRtt);
              setQuality(classifyQuality(avgRtt));
              pingSentAtRef.current = 0;
            }
            if (ws.bufferedAmount <= BACKPRESSURE_THRESHOLD && messageQueueRef.current.length > 0) {
              flushQueue(ws);
            }
            return;
          }
          onMessageRef.current(message);
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        clearHeartbeat();
        if (!cancelledRef.current) {
          setStatus("reconnecting");
          const delay = Math.min(reconnectDelayRef.current, MAX_RECONNECT_DELAY);
          reconnectDelayRef.current = Math.min(delay * 1.5, MAX_RECONNECT_DELAY);
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else {
          setStatus("disconnected");
        }
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    const handleRestored = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        connect();
      }
    };
    window.addEventListener("juno:page-restored", handleRestored);

    return () => {
      window.removeEventListener("juno:page-restored", handleRestored);
      cancelledRef.current = true;
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [userId, enabled, startHeartbeat, clearHeartbeat, flushQueue]);

  const getWs = useCallback(() => wsRef.current, []);

  return { status, send, getWs, quality, rtt };
}
