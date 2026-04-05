import { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import IncomingCallModal from "@/components/IncomingCallModal";
import OutgoingCallScreen from "@/components/OutgoingCallScreen";

type CallState = "idle" | "calling" | "ringing" | "in-call";

export interface IncomingCallInfo {
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  roomCode: string;
}

interface CallContextValue {
  callState: CallState;
  incomingCall: IncomingCallInfo | null;
  outgoingTarget: { name: string; avatar: string | null } | null;
  initiateCall: (targetId: string, targetName: string, targetAvatar?: string | null) => void;
  acceptCall: () => void;
  declineCall: () => void;
  cancelCall: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRingTone(type: "incoming" | "outgoing"): { stop: () => void } {
  let stopped = false;
  let ctx: AudioContext | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const playTone = (freq: number, startTime: number, duration: number, gain: number) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.02);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration - 0.02);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const schedulePattern = (base: number): number => {
      if (type === "incoming") {
        playTone(400, base, 0.4, 0.28);
        playTone(480, base + 0.4, 0.4, 0.28);
        return 2.2;
      } else {
        playTone(440, base, 1.0, 0.22);
        return 3.0;
      }
    };

    let currentTime = ctx.currentTime + 0.1;
    const cycleMs = schedulePattern(currentTime) * 1000;

    intervalId = setInterval(() => {
      if (stopped || !ctx) {
        if (intervalId) clearInterval(intervalId);
        return;
      }
      currentTime += cycleMs / 1000;
      schedulePattern(currentTime);
    }, cycleMs);
  } catch {
  }

  return {
    stop: () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
      try { ctx?.close(); } catch {}
    },
  };
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [callState, setCallState] = useState<CallState>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [outgoingTarget, setOutgoingTarget] = useState<{ name: string; avatar: string | null } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ringRef = useRef<{ stop: () => void } | null>(null);
  const outgoingTargetIdRef = useRef<string | null>(null);
  const outgoingRoomCodeRef = useRef<string | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectWsRef = useRef<() => void>(() => {});

  const isInCallPage = location.startsWith("/room/") && location.endsWith("/call");
  const isInCallPageRef = useRef(isInCallPage);
  isInCallPageRef.current = isInCallPage;

  const stopRing = useCallback(() => {
    if (ringRef.current) {
      ringRef.current.stop();
      ringRef.current = null;
    }
  }, []);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const sendWs = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const resetCallState = useCallback(() => {
    stopRing();
    clearCallTimeout();
    if (mountedRef.current) {
      setCallState("idle");
      setIncomingCall(null);
      setOutgoingTarget(null);
    }
    outgoingTargetIdRef.current = null;
    outgoingRoomCodeRef.current = null;
  }, [stopRing, clearCallTimeout]);

  const initiateCall = useCallback((targetId: string, targetName: string, targetAvatar?: string | null) => {
    if (callState !== "idle") return;
    const roomCode = generateRoomCode();
    outgoingTargetIdRef.current = targetId;
    outgoingRoomCodeRef.current = roomCode;
    setOutgoingTarget({ name: targetName, avatar: targetAvatar || null });
    setCallState("calling");
    sendWs({ type: "call-request", targetId, roomCode });
    try { ringRef.current = createRingTone("outgoing"); } catch {}
    callTimeoutRef.current = setTimeout(() => {
      sendWs({ type: "call-cancelled", targetId: outgoingTargetIdRef.current });
      resetCallState();
    }, 30000);
  }, [callState, sendWs, resetCallState]);

  const acceptCall = useCallback(() => {
    if (!incomingCall) return;
    stopRing();
    clearCallTimeout();
    sendWs({ type: "call-accepted", targetId: incomingCall.callerId, roomCode: incomingCall.roomCode });
    const roomCode = incomingCall.roomCode;
    setCallState("in-call");
    setIncomingCall(null);
    setLocation(`/room/${roomCode}/call`);
  }, [incomingCall, stopRing, clearCallTimeout, sendWs, setLocation]);

  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    sendWs({ type: "call-rejected", targetId: incomingCall.callerId });
    resetCallState();
  }, [incomingCall, sendWs, resetCallState]);

  const cancelCall = useCallback(() => {
    if (outgoingTargetIdRef.current) {
      sendWs({ type: "call-cancelled", targetId: outgoingTargetIdRef.current });
    }
    resetCallState();
  }, [sendWs, resetCallState]);

  const connectWs = useCallback(() => {
    if (!user || !mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "register", userId: user.id }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "incoming-call") {
          if (isInCallPage) {
            ws.send(JSON.stringify({ type: "call-rejected", targetId: msg.callerId }));
            return;
          }
          const roomCode = msg.roomCode || generateRoomCode();
          stopRing();
          clearCallTimeout();
          setIncomingCall({
            callerId: msg.callerId || msg.fromId,
            callerName: msg.callerName || "Someone",
            callerAvatar: msg.callerAvatar || null,
            roomCode,
          });
          setCallState("ringing");
          try { ringRef.current = createRingTone("incoming"); } catch {}
          callTimeoutRef.current = setTimeout(() => {
            ws.send(JSON.stringify({ type: "call-rejected", targetId: msg.callerId || msg.fromId }));
            resetCallState();
          }, 30000);
        }

        if (msg.type === "call-accepted") {
          stopRing();
          clearCallTimeout();
          const roomCode = msg.roomCode || outgoingRoomCodeRef.current;
          setCallState("in-call");
          setOutgoingTarget(null);
          if (roomCode) setLocation(`/room/${roomCode}/call`);
        }

        if (msg.type === "call-rejected" || msg.type === "call-cancelled" || msg.type === "call-unavailable") {
          resetCallState();
        }

        if (msg.type === "call-ended") {
          resetCallState();
        }
      } catch {}
    };

    ws.onclose = () => {
      if (!mountedRef.current || isInCallPageRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !isInCallPageRef.current) connectWsRef.current();
      }, 3000);
    };
  }, [user, isInCallPage, stopRing, clearCallTimeout, resetCallState, setLocation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  connectWsRef.current = connectWs;

  useEffect(() => {
    if (!user) return;
    if (isInCallPage) {
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }
    connectWs();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [user?.id, isInCallPage]);

  return (
    <CallContext.Provider value={{ callState, incomingCall, outgoingTarget, initiateCall, acceptCall, declineCall, cancelCall }}>
      {children}
      {callState === "ringing" && incomingCall && (
        <IncomingCallModal
          call={incomingCall}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}
      {callState === "calling" && outgoingTarget && (
        <OutgoingCallScreen
          target={outgoingTarget}
          onCancel={cancelCall}
        />
      )}
    </CallContext.Provider>
  );
}

export function useCallContext() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCallContext must be used within CallProvider");
  return ctx;
}
