import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import passport from "passport";
import { getSession } from "./replit_integrations/auth";
import { storage } from "./storage";
import {
  RoomChatMsg,
  roomMessages,
  addRoomMessage,
  notifyMessageCountUpdate,
  trackParticipantActivity,
  trackSocketEvent,
  socketMetrics,
  connectedClients,
  roomParticipants,
  userRooms,
  homeChatSubscribers,
  wsToUserId,
} from "./routes";
import { WebSocket } from "ws";
import { processMessageTranslation, processEditedMessageTranslation } from "./juno-bridge";
import { enqueueTranslation, enqueueEditTranslation, isQueueAvailable } from "./agent-queue";
import { recordClientSendTime, recordServerReceiveTime, recordTranscriptionStart, recordTranscriptionEnd, getLatencyStats } from "./latency-tracker";
import { structuredLog } from "./structured-logger";
import { bumpPlatformActivity } from "./platform-activity-tracker";

let io: SocketIOServer | null = null;

const chatSocketUsers = new Map<string, Socket>();
const socketToUserId = new Map<string, string>();
const userPresenceStatus = new Map<string, "online" | "in-call">();

// ── /dm namespace — dedicated, isolated from /chat ──────────────────────────
const dmSocketUsers = new Map<string, Socket>();
const dmSocketToUser = new Map<string, string>();

export function getDmSocket(userId: string): Socket | undefined {
  return dmSocketUsers.get(userId);
}

export function pushDmMessage(message: any): void {
  const recipientSocket = dmSocketUsers.get(String(message.receiverId));
  if (recipientSocket) {
    recipientSocket.emit("dm:message", message);
  }
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function getChatSocketUsers(): Map<string, Socket> {
  return chatSocketUsers;
}

export function getUserPresenceStatus(): Map<string, "online" | "in-call"> {
  return userPresenceStatus;
}

export function broadcastPresenceToWs(userId: string, status: string): void {
  const payload = JSON.stringify({ type: "user-presence-update", userId, status });
  homeChatSubscribers.forEach((subscribers) => {
    subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  });
}

export function setUserCallStatus(userId: string, inCall: boolean): void {
  if (inCall) {
    userPresenceStatus.set(userId, "in-call");
  } else if (chatSocketUsers.has(userId)) {
    userPresenceStatus.set(userId, "online");
  } else {
    userPresenceStatus.delete(userId);
  }
  const status = userPresenceStatus.get(userId) || "offline";
  const chatNs = io?.of("/chat");
  if (chatNs) {
    chatNs.emit("user-presence-update", { userId, status });
  }
  broadcastPresenceToWs(userId, status);
}

export function setupSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 15000,
    pingTimeout: 10000,
    maxHttpBufferSize: 25 * 1024 * 1024,
  });

  const sessionMiddleware = getSession();

  const chatNs = io.of("/chat");

  chatNs.use((socket, next) => {
    const req = socket.request as any;
    const res = {
      end: () => {},
      setHeader: () => res,
      getHeader: () => "",
      writeHead: () => res,
      on: () => res,
      removeListener: () => res,
      emit: () => res,
    } as any;
    try {
      sessionMiddleware(req, res, () => {
        passport.initialize()(req, res, () => {
          passport.session()(req, res, () => {
            const user = req.user as any;
            if (user && user.claims && user.claims.sub) {
              (socket as any).userId = user.claims.sub;
              next();
            } else {
              next(new Error("Authentication required"));
            }
          });
        });
      });
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  chatNs.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId as string;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    const oldSocket = chatSocketUsers.get(userId);
    if (oldSocket && oldSocket.id !== socket.id) {
      oldSocket.disconnect(true);
    }
    chatSocketUsers.set(userId, socket);
    socketToUserId.set(socket.id, userId);

    if (userPresenceStatus.get(userId) !== "in-call") {
      userPresenceStatus.set(userId, "online");
    }
    console.log(`[Socket.IO/chat] User ${userId} connected (${chatSocketUsers.size} total)`);
    structuredLog("info", "socket_connect", "Socket.IO client connected", { userId, metadata: { totalConnected: chatSocketUsers.size } });

    const connectStatus = userPresenceStatus.get(userId) || "online";
    chatNs.emit("user-presence-update", {
      userId,
      status: connectStatus,
    });
    broadcastPresenceToWs(userId, connectStatus);

    socket.on("get-presence", (data: any) => {
      const userIds: string[] = Array.isArray(data?.userIds) ? data.userIds : [];
      const result: Record<string, string> = {};
      userIds.forEach(uid => {
        result[uid] = userPresenceStatus.get(uid) || "offline";
      });
      socket.emit("presence-batch", result);
    });

    socket.on("subscribe", async (data: any) => {
      if (!data?.roomCode) return;
      const roomCode = String(data.roomCode).toUpperCase();
      try {
        const roomData = await storage.getRoomByCode(roomCode);
        if (!roomData) return;
        if (roomData.hostId !== userId) {
          const isMember = await storage.isRoomMember(roomCode, userId);
          if (!isMember) return;
        }
      } catch { return; }
      socket.join(roomCode);
      trackParticipantActivity(roomCode, userId);
      socketMetrics.presenceUpdates++;

      const room = chatNs.adapter.rooms.get(roomCode);
      const activeUserIds: string[] = [];
      if (room) {
        for (const sid of room) {
          const uid = socketToUserId.get(sid);
          if (uid) activeUserIds.push(uid);
        }
      }
      chatNs.to(roomCode).emit("chat-presence", {
        roomCode,
        count: room?.size || 0,
        activeUserIds,
      });
    });

    socket.on("unsubscribe", (data: any) => {
      if (!data?.roomCode) return;
      const roomCode = String(data.roomCode).toUpperCase();
      socket.leave(roomCode);

      const room = chatNs.adapter.rooms.get(roomCode);
      const activeUserIds: string[] = [];
      if (room) {
        for (const sid of room) {
          const uid = socketToUserId.get(sid);
          if (uid) activeUserIds.push(uid);
        }
      }
      chatNs.to(roomCode).emit("chat-presence", {
        roomCode,
        count: room?.size || 0,
        activeUserIds,
      });
    });

    socket.on("send-message", async (data: any) => {
      if (!data?.roomCode || !data?.text) return;
      const hcRoomCode = String(data.roomCode).toUpperCase();
      try {
        const hcRoom = await storage.getRoomByCode(hcRoomCode);
        if (!hcRoom) return;
        const isChatMember = await storage.isRoomMember(hcRoomCode, userId);
        if (hcRoom.hostId !== userId && !isChatMember) return;
      } catch { return; }

      trackParticipantActivity(hcRoomCode, userId);
      const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isE2ee = !!data.e2ee;
      const textLimit = isE2ee ? 2000 : 500;
      const roomMsg: RoomChatMsg = {
        id: msgId,
        roomCode: hcRoomCode,
        fromId: userId,
        fromName: data.fromName || "Unknown",
        text: String(data.text).slice(0, textLimit),
        timestamp: Date.now(),
        ...(isE2ee ? { e2ee: true } : {}),
      };

      if (data.imageData && typeof data.imageData === "string" && data.imageData.startsWith("https://fonts.gstatic.com/")) {
        roomMsg.imageData = data.imageData;
        roomMsg.mediaType = "image";
      }
      if (data.audioData && typeof data.audioData === "string" && data.audioData.startsWith("data:audio/")) {
        if (data.audioData.length <= 5 * 1024 * 1024) {
          roomMsg.audioData = data.audioData;
          roomMsg.mediaType = "audio";
          if (data.transcription && typeof data.transcription === "string") {
            roomMsg.transcription = data.transcription.slice(0, 2000);
          }
        }
      }
      if (data.replyTo && typeof data.replyTo === "object" && data.replyTo.id) {
        roomMsg.replyTo = {
          id: data.replyTo.id,
          fromName: String(data.replyTo.fromName || ""),
          text: String(data.replyTo.text || "").slice(0, 200),
          ...(data.replyTo.imageData ? { imageData: String(data.replyTo.imageData) } : {}),
          ...(data.replyTo.videoData ? { videoData: String(data.replyTo.videoData) } : {}),
        };
      }
      if (data.vanish) {
        (roomMsg as any).vanish = true;
      }

      addRoomMessage(hcRoomCode, roomMsg);
      
      notifyMessageCountUpdate(hcRoomCode, userId);
      socket.to(hcRoomCode).emit("new-message", roomMsg);
      socket.emit("message-sent", roomMsg);
      structuredLog("info", "message_send", "Message sent via Socket.IO", { userId, roomId: hcRoomCode, metadata: { messageId: msgId, hasAudio: !!roomMsg.audioData, hasImage: !!roomMsg.imageData } });

      // Record latency metrics
      if (data.clientTimestamp) {
        recordClientSendTime(roomMsg.id, data.clientTimestamp);
        recordServerReceiveTime(roomMsg.id);
      }

      if (!data.vanish && !data.e2ee && roomMsg.text && !roomMsg.imageData && !roomMsg.videoData) {
        recordTranscriptionStart(roomMsg.id);
        const queued = isQueueAvailable()
          ? await enqueueTranslation(hcRoomCode, roomMsg, userId, socket.id)
          : false;
        if (queued) {
          recordTranscriptionEnd(roomMsg.id);
        } else {
          processMessageTranslation(hcRoomCode, roomMsg, userId).then(result => {
            recordTranscriptionEnd(roomMsg.id);
            if (result) {
              socket.to(hcRoomCode).emit("message-translated", {
                messageId: roomMsg.id,
                roomCode: hcRoomCode,
                translatedText: result.translatedText,
                targetLang: result.targetLang,
              });
            }
          }).catch(() => {
            recordTranscriptionEnd(roomMsg.id);
          });
        }
      }
    });

    socket.on("send-image", async (data: any) => {
      await handleMediaMessage(socket, userId, data, "image", chatNs);
    });

    socket.on("send-video", async (data: any) => {
      await handleMediaMessage(socket, userId, data, "video", chatNs);
    });

    socket.on("typing", (data: any) => {
      if (!data?.roomCode) return;
      const typingRoom = String(data.roomCode).toUpperCase();
      socket.to(typingRoom).emit("typing", {
        roomCode: typingRoom,
        userId,
        userName: data.userName || "Someone",
        isTyping: !!data.isTyping,
      });
      socketMetrics.typingEventsRouted++;
    });

    socket.on("react", async (data: any) => {
      if (!data?.roomCode || !data?.messageId || !data?.emoji) return;
      const reactRoom = String(data.roomCode).toUpperCase();
      const reactMsgs = roomMessages.get(reactRoom);
      if (!reactMsgs) return;
      const targetMsg = reactMsgs.find(m => m.id === data.messageId);
      if (!targetMsg) return;
      if (!targetMsg.reactions) targetMsg.reactions = {};
      const emoji = data.emoji as string;
      if (!targetMsg.reactions[emoji]) targetMsg.reactions[emoji] = [];
      const idx = targetMsg.reactions[emoji].indexOf(userId);
      if (idx >= 0) {
        targetMsg.reactions[emoji].splice(idx, 1);
        if (targetMsg.reactions[emoji].length === 0) delete targetMsg.reactions[emoji];
      } else {
        targetMsg.reactions[emoji] = [userId];
        Object.keys(targetMsg.reactions).forEach(k => {
          if (k !== emoji) {
            targetMsg.reactions![k] = targetMsg.reactions![k].filter(u => u !== userId);
            if (targetMsg.reactions![k].length === 0) delete targetMsg.reactions![k];
          }
        });
      }
      chatNs.to(reactRoom).emit("reaction-update", {
        roomCode: reactRoom,
        messageId: data.messageId,
        reactions: targetMsg.reactions,
      });
    });

    socket.on("edit", async (data: any) => {
      if (!data?.roomCode || !data?.messageId || !data?.newText) return;
      const editRoomCode = String(data.roomCode).toUpperCase();
      const editWindowMs = 15 * 60 * 1000;
      const msgs = roomMessages.get(editRoomCode);
      if (!msgs) return;
      const targetMsg = msgs.find(m => m.id === data.messageId);
      if (!targetMsg) return;
      if (targetMsg.fromId !== userId) return;
      if ((Date.now() - targetMsg.timestamp) > editWindowMs) return;
      if (targetMsg.imageData || targetMsg.videoData || targetMsg.audioData) return;
      const newText = String(data.newText).slice(0, 500);
      targetMsg.text = newText;
      targetMsg.edited = true;
      targetMsg.editedAt = Date.now();
      storage.editRoomMessage(data.messageId, newText, userId).catch(err => {
        console.error("[Socket.IO Edit] DB persist failed:", err);
      });
      chatNs.to(editRoomCode).emit("message-edited", {
        roomCode: editRoomCode,
        messageId: data.messageId,
        newText,
        editedAt: targetMsg.editedAt,
      });
      const editQueued = isQueueAvailable()
        ? await enqueueEditTranslation(editRoomCode, data.messageId, newText, userId, socket.id)
        : false;
      if (!editQueued) {
        processEditedMessageTranslation(editRoomCode, data.messageId, newText, userId).then(result => {
          if (result) {
            socket.to(editRoomCode).emit("message-translated", {
              messageId: data.messageId,
              roomCode: editRoomCode,
              translatedText: result.translatedText,
              targetLang: result.targetLang,
            });
          }
        }).catch(() => {});
      }
    });

    socket.on("delete", async (data: any) => {
      if (!data?.roomCode || !data?.messageId) return;
      const delRoom = String(data.roomCode).toUpperCase();
      const room = await storage.getRoomByCode(delRoom);
      if (!room) return;
      const isMemberDel = await storage.isRoomMember(delRoom, userId);
      if (room.hostId !== userId && !isMemberDel) return;
      const delMsgs = roomMessages.get(delRoom);
      if (delMsgs) {
        const targetMsg = delMsgs.find(m => m.id === data.messageId);
        if (targetMsg && targetMsg.fromId !== userId) return;
        const delIdx = delMsgs.findIndex(m => m.id === data.messageId);
        if (delIdx >= 0) delMsgs.splice(delIdx, 1);
      }
      storage.softDeleteRoomMessage(String(data.messageId), userId).catch(() => {});
      chatNs.to(delRoom).emit("message-deleted", {
        roomCode: delRoom,
        messageId: data.messageId,
      });
    });

    socket.on("verified", (data: any) => {
      if (!data?.roomCode || !data?.messageId) return;
      const vRoomCode = String(data.roomCode).toUpperCase();
      const msgs = roomMessages.get(vRoomCode);
      if (msgs) {
        const targetMsg = msgs.find(m => m.id === data.messageId);
        if (targetMsg) (targetMsg as any).verified = true;
      }
      socket.to(vRoomCode).emit("verified", {
        roomCode: vRoomCode,
        messageId: data.messageId,
      });
    });

    socket.on("msg-delivered", (data: any) => {
      const delMsgIds = Array.isArray(data?.messageIds) ? data.messageIds : (data?.messageId ? [data.messageId] : []);
      const delRoomCode = data?.roomCode?.toUpperCase();
      if (!delRoomCode || delMsgIds.length === 0) return;

      const statusPayload = {
        roomCode: delRoomCode,
        messageIds: delMsgIds,
        status: "delivered",
        byUserId: userId,
      };
      socket.to(delRoomCode).emit("msg-status-update", statusPayload);

      const notified = new Set<string>();
      notified.add(userId);
      const room = chatNs.adapter.rooms.get(delRoomCode);
      if (room) {
        for (const sid of room) {
          const uid = socketToUserId.get(sid);
          if (uid) notified.add(uid);
        }
      }

      const parts = roomParticipants.get(delRoomCode);
      if (parts) {
        parts.forEach(pid => {
          if (!notified.has(pid)) {
            notified.add(pid);
            const pWs = connectedClients.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
              pWs.send(JSON.stringify({ type: "msg-status-update", ...statusPayload }));
            }
          }
        });
      }
    });

    socket.on("msg-seen", (data: any) => {
      const seenMsgIds = Array.isArray(data?.messageIds) ? data.messageIds : (data?.messageId ? [data.messageId] : []);
      const seenRoomCode = data?.roomCode?.toUpperCase();
      if (!seenRoomCode || seenMsgIds.length === 0) return;

      const statusPayload = {
        roomCode: seenRoomCode,
        messageIds: seenMsgIds,
        status: "seen",
        byUserId: userId,
      };
      socket.to(seenRoomCode).emit("msg-status-update", statusPayload);

      const notified = new Set<string>();
      notified.add(userId);
      const room = chatNs.adapter.rooms.get(seenRoomCode);
      if (room) {
        for (const sid of room) {
          const uid = socketToUserId.get(sid);
          if (uid) notified.add(uid);
        }
      }

      const parts = roomParticipants.get(seenRoomCode);
      if (parts) {
        parts.forEach(pid => {
          if (!notified.has(pid)) {
            notified.add(pid);
            const pWs = connectedClients.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
              pWs.send(JSON.stringify({ type: "msg-status-update", ...statusPayload }));
            }
          }
        });
      }
    });

    socket.on("disconnect", (reason) => {
      const currentSocket = chatSocketUsers.get(userId);
      if (currentSocket?.id === socket.id) {
        chatSocketUsers.delete(userId);
        const wasInCall = userPresenceStatus.get(userId) === "in-call";
        if (!wasInCall) {
          userPresenceStatus.delete(userId);
        }
        chatNs.emit("user-presence-update", {
          userId,
          status: wasInCall ? "in-call" : "offline",
        });
        broadcastPresenceToWs(userId, wasInCall ? "in-call" : "offline");
      }
      socketToUserId.delete(socket.id);
      console.log(`[Socket.IO/chat] User ${userId} disconnected: ${reason} (${chatSocketUsers.size} remaining)`);
      structuredLog("info", "socket_disconnect", "Socket.IO client disconnected", { userId, metadata: { reason, remaining: chatSocketUsers.size } });
    });
  });

  // ── /dm namespace — dedicated direct-message socket, fully isolated ────────
  const dmNs = io.of("/dm");

  dmNs.use((socket, next) => {
    const req = socket.request as any;
    const res = {
      end: () => {}, setHeader: () => res, getHeader: () => "",
      writeHead: () => res, on: () => res, removeListener: () => res, emit: () => res,
    } as any;
    try {
      sessionMiddleware(req, res, () => {
        passport.initialize()(req, res, () => {
          passport.session()(req, res, () => {
            const user = req.user as any;
            if (user?.claims?.sub) {
              (socket as any).userId = user.claims.sub;
              next();
            } else {
              next(new Error("Authentication required"));
            }
          });
        });
      });
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  dmNs.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId as string;
    if (!userId) { socket.disconnect(true); return; }

    // Replace any stale socket for this user
    const old = dmSocketUsers.get(userId);
    if (old && old.id !== socket.id) old.disconnect(true);
    dmSocketUsers.set(userId, socket);
    dmSocketToUser.set(socket.id, userId);
    console.log(`[Socket.IO/dm] User ${userId} connected (${dmSocketUsers.size} total)`);

    // ── send a direct message ────────────────────────────────────────────────
    socket.on("dm:send", async (data: { receiverId: string; content: string; clientId?: string }) => {
      try {
        if (!data?.receiverId || !data?.content?.trim()) return;
        const message = await storage.sendMessage({
          senderId: userId,
          receiverId: data.receiverId,
          content: data.content.trim(),
        });
        // Echo back to sender
        socket.emit("dm:sent", { ...message, clientId: data.clientId });
        // Push to recipient if online
        const recipientSocket = dmSocketUsers.get(String(data.receiverId));
        if (recipientSocket) {
          recipientSocket.emit("dm:message", message);
          // Auto-acknowledge delivery
          socket.emit("dm:delivered", { messageId: message.id, receiverId: data.receiverId });
        }
      } catch (err) {
        socket.emit("dm:error", { event: "dm:send", reason: "Failed to send" });
      }
    });

    // ── typing indicator ─────────────────────────────────────────────────────
    socket.on("dm:typing", (data: { receiverId: string; isTyping: boolean }) => {
      const recipientSocket = dmSocketUsers.get(String(data?.receiverId));
      if (recipientSocket) {
        recipientSocket.emit("dm:typing", { senderId: userId, isTyping: !!data.isTyping });
      }
    });

    // ── mark messages read ───────────────────────────────────────────────────
    socket.on("dm:read", async (data: { senderId: string }) => {
      try {
        if (!data?.senderId) return;
        await storage.markMessagesAsRead(userId, data.senderId);
        // Notify original sender that messages were read
        const senderSocket = dmSocketUsers.get(String(data.senderId));
        if (senderSocket) {
          senderSocket.emit("dm:read-ack", { readBy: userId });
        }
      } catch { /* non-critical */ }
    });

    socket.on("disconnect", () => {
      dmSocketUsers.delete(userId);
      dmSocketToUser.delete(socket.id);
      console.log(`[Socket.IO/dm] User ${userId} disconnected (${dmSocketUsers.size} remaining)`);
    });
  });

  console.log("[Socket.IO] Server initialized with /chat namespace");
  return io;
}

async function handleMediaMessage(
  socket: Socket,
  userId: string,
  data: any,
  mediaType: "image" | "video",
  chatNs: ReturnType<SocketIOServer["of"]>,
) {
  if (!data?.roomCode) return;
  const mediaRoomCode = String(data.roomCode).toUpperCase();
  try {
    const mediaRoom = await storage.getRoomByCode(mediaRoomCode);
    if (!mediaRoom) return;
    const isMediaMember = await storage.isRoomMember(mediaRoomCode, userId);
    if (mediaRoom.hostId !== userId && !isMediaMember) return;
  } catch { return; }

  const isImg = mediaType === "image";
  const mediaData = isImg ? data.imageData : data.videoData;
  if (!mediaData || typeof mediaData !== "string") return;

  if (isImg) {
    const allowedPrefixes = ["data:image/png;", "data:image/jpeg;", "data:image/jpg;", "data:image/webp;", "data:image/gif;"];
    const isNotoEmoji = mediaData.startsWith("https://fonts.gstatic.com/s/e/notoemoji/");
    const isGiphyGif = mediaData.startsWith("https://media") && mediaData.includes("giphy.com/");
    if (!isNotoEmoji && !isGiphyGif && !allowedPrefixes.some(p => mediaData.startsWith(p))) {
      socket.emit("error-msg", { message: "Invalid image format" });
      return;
    }
  } else {
    if (!mediaData.startsWith("data:video/")) {
      socket.emit("error-msg", { message: "Invalid video format" });
      return;
    }
  }

  const maxBytes = 25 * 1024 * 1024;
  if (mediaData.length > maxBytes) {
    socket.emit("error-msg", { message: "File too large" });
    return;
  }

  const isEmojiMsg = isImg && mediaData.startsWith("https://fonts.gstatic.com/s/e/notoemoji/");
  const isGifMsg = isImg && mediaData.startsWith("https://media") && mediaData.includes("giphy.com/");
  const msgText = isEmojiMsg ? "[Emoji]" : isGifMsg ? "[GIF]" : (isImg ? "[Image]" : "[Video]");
  const isVanish = !!data.vanish && !isEmojiMsg && !isGifMsg;

  const mediaMsg: any = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomCode: mediaRoomCode,
    fromId: userId,
    fromName: data.fromName || "Unknown",
    text: msgText,
    ...(isImg ? { imageData: mediaData } : { videoData: mediaData }),
    mediaType: isImg ? "image" : "video",
    timestamp: Date.now(),
    ...(isVanish ? { vanish: true } : {}),
    ...(!isImg && Array.isArray(data.liveCaptions) && data.liveCaptions.length > 0
      ? { liveCaptions: data.liveCaptions }
      : {}),
    ...(!isImg && data.hasBurnedCaptions ? { hasBurnedCaptions: true } : {}),
  };

  addRoomMessage(mediaRoomCode, {
    id: mediaMsg.id,
    roomCode: mediaRoomCode,
    fromId: userId,
    fromName: mediaMsg.fromName,
    text: mediaMsg.text,
    timestamp: mediaMsg.timestamp,
    ...((isEmojiMsg || isGifMsg) ? { imageData: mediaData, mediaType: "image" } : {}),
    ...(isVanish ? { vanish: true } : {}),
  });

  notifyMessageCountUpdate(mediaRoomCode, userId);
  socket.to(mediaRoomCode).emit("new-message", mediaMsg);
  socket.emit("message-sent", mediaMsg);
}
