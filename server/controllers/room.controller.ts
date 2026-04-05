import { Router } from "express";
import { WebSocket } from "ws";
import type { RoomChatMsg } from "../routes";

export function createRoomRouter(deps: {
  isAuthenticated: any;
  storage: any;
  sanitizeUser: (u: any) => any;
  getValidDisplayName: (firstName?: string | null, lastName?: string | null) => string;
  trackAction: (action: string, feature: string) => void;
  metrics: any;
  roomMessages: any;
  connectedClients: Map<string, WebSocket>;
  homeChatSubscribers: Map<string, Set<WebSocket>>;
  wsToUserId: Map<WebSocket, string>;
  roomParticipants: Map<string, Set<string>>;
  addRoomMessage: (roomCode: string, msg: RoomChatMsg) => void;
  notifyMessageCountUpdate: (roomCode: string, senderId: string) => void;
  broadcastHomeChat: (roomCode: string, msg: RoomChatMsg, excludeWs?: WebSocket) => void;
  checkRoomCreationRate: (userId: string) => boolean;
  generateRoomCode: () => string;
  recordRoomCodeAttempt: (userId: string, code: string, success: boolean) => any;
  isAdminRequest: (req: any) => boolean;
  roomCodeAttempts: any;
  roomLangProfiles: any;
  getUserLearnedLang: (profile: any) => string | null;
  recordUserSettingLang: (roomCode: string, userId: string, lang: string) => void;
}) {
  const router = Router();
  const {
    isAuthenticated, storage, sanitizeUser, getValidDisplayName, trackAction, metrics,
    roomMessages, connectedClients, homeChatSubscribers, wsToUserId, roomParticipants,
    addRoomMessage, notifyMessageCountUpdate, broadcastHomeChat, checkRoomCreationRate,
    generateRoomCode, recordRoomCodeAttempt, isAdminRequest, roomCodeAttempts,
    roomLangProfiles, getUserLearnedLang, recordUserSettingLang,
  } = deps;

  router.post("/rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      trackAction("create_room", "rooms");

      if (!checkRoomCreationRate(userId)) {
        return res.status(429).json({ message: "Too many rooms created. Please wait before creating more." });
      }

      let code = generateRoomCode();
      let existingRoom = await storage.getRoomByCode(code);
      while (existingRoom) {
        code = generateRoomCode();
        existingRoom = await storage.getRoomByCode(code);
      }

      const room = await storage.createRoom({
        code,
        hostId: userId,
        name: req.body.name || null,
        isActive: true,
        expiresAt: null,
      });

      const hostUser = await storage.getUser(userId);
      const hostName = getValidDisplayName(hostUser?.firstName, hostUser?.lastName);
      await storage.addRoomMember({ roomCode: code, userId, username: hostName });

      metrics.rooms.totalCreated++;
      res.status(201).json(room);
    } catch (error) {
      console.error("Error creating room:", error);
      res.status(500).json({ message: "Failed to create room" });
    }
  });

  router.get("/rooms/:code", isAuthenticated, async (req, res) => {
    try {
      const code = (req.params.code as string).toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found or expired" });
      }

      const host = await storage.getUser(room.hostId);
      const memberCount = await storage.getActiveRoomMemberCount(code);
      res.json({ ...room, host: sanitizeUser(host), memberCount });
    } catch (error) {
      console.error("Error fetching room:", error);
      res.status(500).json({ message: "Failed to fetch room" });
    }
  });

  router.get("/my-rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rooms = await storage.getRoomsByHost(userId);
      res.json(rooms);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      res.status(500).json({ message: "Failed to fetch rooms" });
    }
  });

  router.get("/joined-rooms", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rooms = await storage.getJoinedRooms(userId);
      const roomsWithHost = await Promise.all(rooms.map(async (room: any) => {
        const hostUser = await storage.getUser(room.hostId);
        const hostName = getValidDisplayName(hostUser?.firstName, hostUser?.lastName);
        return { ...room, hostName, hostProfileImage: hostUser?.profileImageUrl || null };
      }));
      res.json(roomsWithHost);
    } catch (error) {
      console.error("Error fetching joined rooms:", error);
      res.status(500).json({ message: "Failed to fetch joined rooms" });
    }
  });

  router.delete("/rooms/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const allRooms = await storage.getRoomsByHost(userId);
      const roomToDelete = allRooms.find((r: any) => r.id === req.params.id);
      if (!roomToDelete) {
        return res.status(403).json({ message: "Only the room host can delete a room" });
      }
      await storage.deactivateRoom(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deactivating room:", error);
      res.status(500).json({ message: "Failed to deactivate room" });
    }
  });

  router.get("/room-messages/:code", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const userId = req.user.claims.sub;
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room to view messages" });
      }
      const dbMessages = await storage.getRoomMessages(code, 100);
      const cachedMsgs = roomMessages.get(code) || [];
      const verifiedIds = new Set(cachedMsgs.filter((cm: any) => (cm as any).verified).map((cm: any) => cm.id));
      const editedMap = new Map(cachedMsgs.filter((cm: any) => cm.edited).map((cm: any) => [cm.id, { text: cm.text, editedAt: cm.editedAt }]));
      const cachedReactionsMap = new Map(cachedMsgs.filter((cm: any) => cm.reactions && Object.keys(cm.reactions).length > 0).map((cm: any) => [cm.id, cm.reactions]));
      const otherReadAt = await storage.getOtherReadStatus(code, userId);
      const otherReadTs = otherReadAt ? otherReadAt.getTime() : 0;
      const messages = dbMessages.map((m: any) => {
        const ts = m.createdAt ? new Date(m.createdAt).getTime() : Date.now();
        const base: any = { id: m.id, roomCode: m.roomCode, fromId: m.fromId, fromName: m.fromName, timestamp: ts };
        if (m.fromId === userId) {
          base.status = otherReadTs >= ts ? "seen" : "delivered";
        }
        if (verifiedIds.has(m.id)) base.verified = true;
        const editInfo = editedMap.get(m.clientMessageId || m.id);
        if (editInfo) {
          base.edited = true;
          base.editedAt = (editInfo as any).editedAt;
        } else if (m.edited) {
          base.edited = true;
          base.editedAt = m.editedAt ? new Date(m.editedAt).getTime() : ts;
        }
        const cachedReactions = m.clientMessageId ? cachedReactionsMap.get(m.clientMessageId) : undefined;
        if (cachedReactions && Object.keys(cachedReactions).length > 0) {
          base.reactions = cachedReactions;
        } else if (m.reactions) {
          try { base.reactions = JSON.parse(m.reactions); } catch {}
        }
        if (m.replyToData) {
          try { base.replyTo = JSON.parse(m.replyToData); } catch {}
        }
        const emojiMatch = m.content.match(/^\[Emoji:(https:\/\/fonts\.gstatic\.com\/[^\]]+)\]$/);
        if (emojiMatch) {
          return { ...base, text: "[Emoji]", imageData: emojiMatch[1], mediaType: "image" };
        }
        const gifMatch = m.content.match(/^\[GIF:(https:\/\/media[^\]]+giphy\.com\/[^\]]+)\]$/);
        if (gifMatch) {
          return { ...base, text: "[GIF]", imageData: gifMatch[1], mediaType: "image" };
        }
        if (m.audioData && m.content === "[Voice]") {
          return { ...base, text: "[Voice]", audioData: m.audioData, mediaType: "audio", ...(m.transcription ? { transcription: m.transcription } : {}) };
        }
        const rawContent = editInfo ? (editInfo as any).text : (m.edited && m.content ? m.content : m.content);
        if (rawContent.startsWith("[E2EE]")) {
          return { ...base, text: rawContent.slice(6), e2ee: true };
        }
        if (m.translatedContent && m.translatedLang && m.fromId !== userId) {
          base.serverTranslatedText = m.translatedContent;
          base.serverTranslatedLang = m.translatedLang;
        }
        return { ...base, text: rawContent };
      });
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  router.post("/room-messages/:code", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const userId = req.user.claims.sub;
      const { text, fromName, imageData, audioData, transcription, replyTo, vanish } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ message: "Text is required" });
      }
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room to send messages" });
      }
      const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isEmojiMsg = imageData && typeof imageData === "string" && imageData.startsWith("https://fonts.gstatic.com/");
      const isAudioMsg = audioData && typeof audioData === "string" && audioData.startsWith("data:audio/") && audioData.length <= 5 * 1024 * 1024;
      const roomMsg: RoomChatMsg = {
        id: msgId,
        roomCode: code,
        fromId: userId,
        fromName: fromName || "Unknown",
        text: text.slice(0, 500),
        timestamp: Date.now(),
        ...(isEmojiMsg ? { imageData, mediaType: "image" } : {}),
        ...(isAudioMsg ? { audioData, mediaType: "audio", ...(transcription && typeof transcription === "string" ? { transcription: transcription.slice(0, 2000) } : {}) } : {}),
      };
      if (replyTo && typeof replyTo === "object" && replyTo.id) {
        roomMsg.replyTo = {
          id: replyTo.id,
          fromName: String(replyTo.fromName || ""),
          text: String(replyTo.text || "").slice(0, 200),
          ...(replyTo.imageData ? { imageData: String(replyTo.imageData) } : {}),
          ...(replyTo.videoData ? { videoData: String(replyTo.videoData) } : {}),
        };
      }
      if (vanish) {
        (roomMsg as any).vanish = true;
      }
      addRoomMessage(code, roomMsg);
      notifyMessageCountUpdate(code, userId);
      broadcastHomeChat(code, roomMsg);

      res.json(roomMsg);
    } catch (error) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  router.delete("/room-messages/:code/:messageId", isAuthenticated, async (req: any, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const messageId = req.params.messageId;
      const userId = req.user.claims.sub;
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room" });
      }
      const delMsgs = roomMessages.get(code);
      if (delMsgs) {
        const targetMsg = delMsgs.find((m: any) => m.id === messageId);
        if (targetMsg && targetMsg.fromId !== userId) {
          return res.status(403).json({ message: "You can only delete your own messages" });
        }
        const delIdx = delMsgs.findIndex((m: any) => m.id === messageId);
        if (delIdx >= 0) {
          delMsgs.splice(delIdx, 1);
        }
      }
      await storage.softDeleteRoomMessage(messageId, userId);
      const delPayload = JSON.stringify({
        type: "home-chat-message-deleted",
        roomCode: code,
        messageId: messageId,
      });
      const delSubs = homeChatSubscribers.get(code);
      delSubs?.forEach((s) => {
        if (s.readyState === WebSocket.OPEN) s.send(delPayload);
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  router.get("/room-message-counts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const hostRooms = await storage.getRoomsByHost(userId);
      const joinedRooms = await storage.getJoinedRooms(userId);
      const codeSet = new Set<string>();
      hostRooms.forEach((r: any) => codeSet.add(r.code));
      joinedRooms.forEach((r: any) => codeSet.add(r.code));
      const allRoomCodes = Array.from(codeSet);
      if (allRoomCodes.length === 0) return res.json({});
      const counts: Record<string, number> = {};
      for (const code of allRoomCodes) {
        counts[code] = await storage.countUnreadMessages(code, userId);
      }
      res.json(counts);
    } catch (error) {
      res.status(500).json({ message: "Failed to get message counts" });
    }
  });

  router.post("/room-read/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      await storage.markRoomAsRead(roomCode, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark room as read" });
    }
  });

  router.post("/room-members/:code/rejoin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(roomCode);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isAlreadyActiveMember = await storage.isRoomMember(roomCode, userId);
      if (!isAlreadyActiveMember) {
        const activeCount = await storage.getActiveRoomMemberCount(roomCode);
        if (activeCount >= 2) {
          return res.status(403).json({ message: "Room is full", roomFull: true });
        }
      }
      const user = await storage.getUser(userId);
      const username = getValidDisplayName(user?.firstName, user?.lastName);
      const member = await storage.addRoomMember({ roomCode, userId, username });

      const joinNotif = JSON.stringify({
        type: "member-joined",
        roomCode,
        userId,
        username,
      });
      const subs = homeChatSubscribers.get(roomCode);
      if (subs) {
        subs.forEach((s) => {
          const subUserId = wsToUserId.get(s);
          if (s.readyState === WebSocket.OPEN && subUserId !== userId) {
            s.send(joinNotif);
          }
        });
      }
      const roomParts = roomParticipants.get(roomCode);
      if (roomParts) {
        roomParts.forEach((pid) => {
          if (pid !== userId) {
            const pWs = connectedClients.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
              pWs.send(joinNotif);
            }
          }
        });
      }

      res.json(member);
    } catch (error) {
      console.error("[Rejoin] Error rejoining room:", error);
      res.status(500).json({ message: "Failed to rejoin room" });
    }
  });

  router.get("/room-members/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const code = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      const isMember = await storage.isRoomMember(code, userId);
      if (room.hostId !== userId && !isMember) {
        return res.status(403).json({ message: "You must be a member of this room" });
      }
      const members = await storage.getRoomMembers(code);
      const sanitizedMembers = members.map((m: any) => ({
        ...m,
        user: m.user ? sanitizeUser(m.user) : undefined,
      }));
      res.json(sanitizedMembers);
    } catch (error) {
      console.error("Error fetching room members:", error);
      res.status(500).json({ message: "Failed to fetch room members" });
    }
  });

  router.get("/room-partner-lang/:code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const code = req.params.code.toUpperCase();
      const room = await storage.getRoomByCode(code);
      if (!room) return res.status(404).json({ message: "Room not found" });
      const members = await storage.getRoomMembers(code);
      const activeMembers = members.filter((m: any) => m.isActive);
      const partner = activeMembers.find((m: any) => m.userId !== userId);
      if (!partner) return res.json({ partnerLang: null, partnerName: null });
      const prefs = await storage.getPreferences(partner.userId);
      const partnerUser = await storage.getUser(partner.userId);
      const partnerName = getValidDisplayName(partnerUser?.firstName, partnerUser?.lastName);
      let spokenLang = prefs?.spokenLanguage && prefs.spokenLanguage !== "auto"
        ? prefs.spokenLanguage
        : prefs?.subtitleLanguage || "en";
      if (spokenLang === "en" && prefs?.spokenLanguage === "auto") {
        const roomProfile = roomLangProfiles.get(code);
        const partnerProfile = roomProfile?.users[partner.userId];
        if (partnerProfile) {
          const learnedLang = getUserLearnedLang(partnerProfile);
          if (learnedLang) spokenLang = learnedLang;
        }
      }
      recordUserSettingLang(code, partner.userId, spokenLang);
      const myPrefs = await storage.getPreferences(userId);
      let mySpokenLang = myPrefs?.spokenLanguage && myPrefs.spokenLanguage !== "auto"
        ? myPrefs.spokenLanguage
        : myPrefs?.subtitleLanguage || "en";
      if (mySpokenLang === "en" && myPrefs?.spokenLanguage === "auto") {
        const roomProfile = roomLangProfiles.get(code);
        const myProfile = roomProfile?.users[userId];
        if (myProfile) {
          const learnedLang = getUserLearnedLang(myProfile);
          if (learnedLang) mySpokenLang = learnedLang;
        }
      }
      recordUserSettingLang(code, userId, mySpokenLang);
      res.json({
        partnerLang: spokenLang,
        partnerName,
      });
    } catch (error) {
      console.error("Error fetching partner language:", error);
      res.status(500).json({ message: "Failed to fetch partner language" });
    }
  });

  router.get("/my-room-members", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userRoomsList = await storage.getRoomsByHost(userId);
      const joinedRooms = await storage.getJoinedRooms(userId);
      const codeSet = new Set<string>();
      userRoomsList.forEach((r: any) => codeSet.add(r.code));
      joinedRooms.forEach((r: any) => codeSet.add(r.code));
      const codes = Array.from(codeSet);
      const members = await storage.getRoomMembersForMultipleRooms(codes);
      const sanitized: Record<string, any[]> = {};
      for (const [code, mList] of Object.entries(members)) {
        sanitized[code] = (mList as any[]).map(m => ({
          ...m,
          user: m.user ? sanitizeUser(m.user) : undefined,
        }));
      }
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching room members:", error);
      res.status(500).json({ message: "Failed to fetch room members" });
    }
  });

  router.delete("/room-members/:code/leave", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      await storage.deactivateRoomMember(roomCode, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error leaving room:", error);
      res.status(500).json({ message: "Failed to leave room" });
    }
  });

  router.delete("/room-members/:code/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const hostId = req.user.claims.sub;
      const roomCode = req.params.code.toUpperCase();
      const targetUserId = req.params.userId;

      const room = await storage.getRoomByCode(roomCode);
      if (!room || room.hostId !== hostId) {
        return res.status(403).json({ message: "Only the room host can remove members" });
      }

      await storage.removeRoomMember(roomCode, targetUserId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing room member:", error);
      res.status(500).json({ message: "Failed to remove member" });
    }
  });

  router.get("/room-code-security", isAuthenticated, (req: any, res) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    const now = Date.now();
    roomCodeAttempts.blockedUsers.forEach((expiry: number, uid: string) => {
      if (now >= expiry) roomCodeAttempts.blockedUsers.delete(uid);
    });
    const recentFailed = roomCodeAttempts.failedAttempts.filter((a: any) => now - a.timestamp < 3600_000);
    const uniqueAttackers = new Set(recentFailed.map((a: any) => a.userId));
    const topOffenders = Array.from(
      recentFailed.reduce((acc: Map<string, number>, a: any) => {
        acc.set(a.userId, (acc.get(a.userId) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, count]: any) => ({ userId, failedAttempts: count }));

    res.json({
      totalFailed: roomCodeAttempts.totalFailed,
      totalSuccessful: roomCodeAttempts.totalSuccessful,
      failedLastHour: recentFailed.length,
      uniqueAttackersLastHour: uniqueAttackers.size,
      currentlyBlocked: roomCodeAttempts.blockedUsers.size,
      blockedUsers: Array.from(roomCodeAttempts.blockedUsers.entries()).map(([userId, expiry]: any) => ({
        userId,
        blockedUntil: new Date(expiry).toISOString(),
        remainingMs: expiry - now,
      })),
      recentAlerts: roomCodeAttempts.alerts.slice(-10).reverse(),
      topOffenders,
      config: {
        windowMs: 60_000,
        threshold: 10,
        blockDurationMs: 300_000,
      },
    });
  });

  return router;
}
