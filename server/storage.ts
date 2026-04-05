import { 
  type User, 
  type InsertContact, 
  type Contact, 
  type InsertMessage,
  type Message,
  type InsertCall,
  type Call,
  type InsertUserPreferences,
  type UserPreferences,
  type InsertUserStatus,
  type UserStatus,
  type InsertRoom,
  type Room,
  type InsertFeedback,
  type Feedback,
  type InsertRoomMember,
  type RoomMember,
  type InsertSupportTicket,
  type SupportTicket,
  type InsertRoomMessage,
  type RoomMessage as DBRoomMessage,
  type InsertVoiceConversation,
  type VoiceConversation,
  type InsertJunoConversation,
  type JunoConversation,
  type InsertLoginActivity,
  type LoginActivity,
  type Device,
  type MobileToken,
  type CarouselItem,
  type InsertCarouselItem,
  type VisionScan,
  type InsertVisionScan,
  contacts,
  messages as messagesTable,
  calls,
  userPreferences,
  userStatus,
  rooms,
  roomMembers,
  feedback,
  supportTickets,
  roomMessages as roomMessagesTable,
  featureFlags,
  roomReadStatus,
  pushSubscriptions,
  voiceConversations,
  junoConversations,
  loginActivity,
  translationMemory,
  devices,
  mobileTokens,
  voiceProfiles,
  carouselItems,
  visionScans,
  type VoiceProfile,
  type InsertVoiceProfile,
} from "@shared/schema";
import { users, sessions } from "@shared/models/auth";
import { db } from "./db";
import { eq, or, and, desc, ilike, ne, inArray, lt, gt, asc, sql, isNull } from "drizzle-orm";
import { encryptPhone, decryptPhone, maskPhone, isEncrypted } from "./encryption";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  searchUsers(query: string, currentUserId: string): Promise<User[]>;
  getAllUsers(): Promise<User[]>;
  
  // Contacts
  getContacts(userId: string): Promise<(Contact & { contactUser: User; status: string })[]>;
  addContact(data: InsertContact): Promise<Contact>;
  removeContact(userId: string, contactId: string): Promise<void>;
  deactivateSharedRooms(userId: string, contactId: string): Promise<void>;
  
  // Messages
  getMessages(userId: string, contactId: string): Promise<Message[]>;
  sendMessage(data: InsertMessage): Promise<Message>;
  markMessagesAsRead(userId: string, senderId: string): Promise<void>;
  
  // Calls
  getCalls(userId: string): Promise<(Call & { caller: User; receiver: User })[]>;
  createCall(data: InsertCall): Promise<Call>;
  updateCall(id: string, data: Partial<Call>): Promise<Call | undefined>;
  
  // User Preferences
  getPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertPreferences(data: InsertUserPreferences): Promise<UserPreferences>;

  // Voice Profiles
  getVoiceProfile(userId: string): Promise<VoiceProfile | undefined>;
  upsertVoiceProfile(data: InsertVoiceProfile): Promise<VoiceProfile>;
  deleteVoiceProfile(userId: string): Promise<void>;
  
  // User Status
  getStatus(userId: string): Promise<UserStatus | undefined>;
  updateStatus(userId: string, status: string): Promise<UserStatus>;
  
  // Rooms
  createRoom(data: InsertRoom): Promise<Room>;
  getRoomByCode(code: string): Promise<Room | undefined>;
  getRoomsByHost(hostId: string): Promise<Room[]>;
  getJoinedRooms(userId: string): Promise<Room[]>;
  deactivateRoom(roomId: string): Promise<void>;
  
  // Room Members
  addRoomMember(data: InsertRoomMember): Promise<RoomMember>;
  deactivateRoomMember(roomCode: string, userId: string): Promise<void>;
  removeRoomMember(roomCode: string, userId: string): Promise<void>;
  getRoomMembers(roomCode: string): Promise<(RoomMember & { user?: User })[]>;
  getRoomMembersForMultipleRooms(roomCodes: string[]): Promise<Record<string, (RoomMember & { user?: User })[]>>;
  
  // Feedback
  getAllFeedback(): Promise<Feedback[]>;
  createFeedback(data: InsertFeedback): Promise<Feedback>;
  updateFeedbackStatus(id: string, status: string, aiReview?: string): Promise<Feedback | null>;

  // Support Tickets
  createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket>;
  getSupportTicketsByUser(userId: string): Promise<SupportTicket[]>;
  getAllSupportTickets(): Promise<SupportTicket[]>;
  updateSupportTicket(id: string, data: Partial<SupportTicket>): Promise<SupportTicket | undefined>;

  // Onboarding
  completeOnboarding(userId: string, email: string, phoneNumber: string, firstName?: string, lastName?: string | null): Promise<User>;

  // Room membership check
  isRoomMember(roomCode: string, userId: string): Promise<boolean>;
  getActiveRoomMemberCount(roomCode: string): Promise<number>;

  // Profile
  updateProfileImage(userId: string, imageUrl: string): Promise<void>;
  updateUserProfile(userId: string, data: { firstName?: string; lastName?: string | null; username?: string; usernameCode?: string; email?: string }): Promise<User | undefined>;
  updateUser(userId: string, data: Partial<{ voiceTranslationCount: number; premiumVoiceTranslation: boolean; captchaVerified: boolean }>): Promise<User | undefined>;

  // Username
  findUsersByUsername(username: string): Promise<User[]>;
  setUsername(userId: string, username: string, code: string): Promise<User | undefined>;

  // Room Messages (persistent, permanently saved — NO AUTO-DELETION)
  // IMPORTANT: Messages must be kept indefinitely. Do NOT add deleteOldRoomMessages() or auto-cleanup.
  // User-triggered deletion is SOFT DELETE only — sets deleted_at timestamp, message stays in DB.
  saveRoomMessage(data: InsertRoomMessage): Promise<DBRoomMessage>;
  getRoomMessages(roomCode: string, limit?: number): Promise<DBRoomMessage[]>;
  updateMessageReactions(messageId: string, reactions: Record<string, string[]>): Promise<void>;
  getReactionsByMessageId(messageId: string): Promise<Record<string, string[]> | null>;
  editRoomMessage(clientMessageId: string, newContent: string, userId: string): Promise<boolean>;
  saveMessageTranslation(clientMessageId: string, translatedContent: string, translatedLang: string): Promise<boolean>;
  softDeleteRoomMessage(clientMessageId: string, userId: string): Promise<boolean>;
  countTotalRoomMessages(roomCode: string): Promise<number>;
  countUnreadMessages(roomCode: string, userId: string): Promise<number>;
  markRoomAsRead(roomCode: string, userId: string): Promise<void>;
  getOtherReadStatus(roomCode: string, currentUserId: string): Promise<Date | null>;

  getFeatureFlag(key: string): Promise<boolean>;
  setFeatureFlag(key: string, enabled: boolean): Promise<boolean>;
  getAllFeatureFlags(): Promise<{ key: string; enabled: boolean; updatedAt: Date | null }[]>;

  logLoginActivity(data: InsertLoginActivity): Promise<LoginActivity>;
  getLoginActivity(userId: string, limit?: number): Promise<LoginActivity[]>;
  getAllLoginActivity(limit?: number): Promise<LoginActivity[]>;
  flagLoginActivity(id: string, flagged: boolean): Promise<void>;
  cleanupOldLoginActivity(cutoffDate: Date): Promise<void>;

  // GDPR Compliance
  exportUserData(userId: string): Promise<{
    profile: User;
    preferences: UserPreferences | undefined;
    contacts: Contact[];
    messages: Message[];
    calls: Call[];
    rooms: Room[];
    roomMemberships: RoomMember[];
    roomMessages: any[];
    feedback: Feedback[];
    supportTickets: SupportTicket[];
    status: UserStatus | undefined;
  }>;
  deleteUserAccount(userId: string): Promise<void>;

  // Voice Conversations
  saveVoiceConversation(data: InsertVoiceConversation): Promise<VoiceConversation>;
  getVoiceConversations(userId: string, limit?: number): Promise<VoiceConversation[]>;

  // Juno Conversations
  createJunoConversation(data: InsertJunoConversation): Promise<JunoConversation>;
  getJunoConversations(userId: string, limit?: number, sessionType?: string): Promise<JunoConversation[]>;
  getJunoConversation(id: string, userId: string): Promise<JunoConversation | undefined>;
  updateJunoConversation(id: string, userId: string, messages: any[], title?: string): Promise<JunoConversation | undefined>;
  deleteJunoConversation(id: string, userId: string): Promise<void>;
  getConversationsOlderThan(days: number): Promise<JunoConversation[]>;
  markConversationsArchived(ids: string[]): Promise<void>;
  bulkDeleteJunoConversations(ids: string[]): Promise<void>;

  // Translation Memory
  lookupTranslationMemory(sourceText: string, sourceLang: string, targetLang: string): Promise<string | null>;
  saveTranslationMemory(sourceText: string, sourceLang: string, targetLang: string, translatedText: string, provider: string): Promise<void>;

  // Vector Memory
  storeTranslationWithEmbedding(sourceText: string, translatedText: string, sourceLang: string, targetLang: string, roomCode?: string, provider?: string): Promise<void>;
  searchSimilarTranslations(queryText: string, sourceLang: string, targetLang: string, limit?: number, roomCode?: string): Promise<{ sourceText: string; translatedText: string; similarity: number }[]>;
  storeConversationContext(content: string, userId: string, contentType?: string, roomCode?: string, metadata?: Record<string, any>): Promise<void>;
  searchConversationContext(queryText: string, userId?: string, roomCode?: string, limit?: number): Promise<{ content: string; contentType: string; similarity: number; metadata: any }[]>;

  // Devices
  registerDevice(userId: string, data: { deviceName?: string; deviceType?: string; deviceFingerprint?: string }): Promise<Device>;
  getDevices(userId: string): Promise<Device[]>;
  revokeDevice(deviceId: string, userId: string): Promise<void>;
  getDeviceByFingerprint(userId: string, fingerprint: string): Promise<Device | undefined>;

  // Mobile Tokens
  createMobileTokens(data: { userId: string; deviceId?: string; accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date }): Promise<MobileToken>;
  getMobileTokenByRefresh(refreshToken: string): Promise<MobileToken | undefined>;
  getMobileTokenByAccess(accessToken: string): Promise<MobileToken | undefined>;
  updateMobileTokenAccess(id: string, accessToken: string, accessExpiresAt: Date): Promise<void>;
  revokeMobileToken(refreshToken: string): Promise<void>;
  revokeMobileTokensByUser(userId: string): Promise<void>;

  // Carousel (Juno Tools cards)
  getCarouselItems(category?: string): Promise<CarouselItem[]>;
  replaceCarouselItems(items: InsertCarouselItem[]): Promise<void>;

  // Vision Scan memory
  saveVisionScan(scan: InsertVisionScan): Promise<VisionScan>;
  getRecentVisionScans(limit: number): Promise<VisionScan[]>;
  searchVisionScans(query: string, limit: number): Promise<VisionScan[]>;
}

const GENERIC_NAMES = new Set(["user", "guest", "anonymous", "unknown", "null", "undefined", ""]);

function isValidName(name: string | null | undefined): name is string {
  if (!name || !name.trim()) return false;
  return !GENERIC_NAMES.has(name.trim().toLowerCase());
}

function getDisplayName(firstName?: string | null, lastName?: string | null, fallbackUsername?: string | null): string {
  if (isValidName(firstName)) return firstName.trim();
  if (isValidName(lastName)) return lastName.trim();
  if (fallbackUsername && isValidName(fallbackUsername) && !fallbackUsername.includes("@")) return fallbackUsername.trim();
  return "Guest";
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async searchUsers(query: string, currentUserId: string): Promise<User[]> {
    const userResults = await db
      .select()
      .from(users)
      .where(
        and(
          ne(users.id, currentUserId),
          or(
            ilike(users.firstName, `%${query}%`),
            ilike(users.lastName, `%${query}%`)
          )
        )
      )
      .limit(20);

    return userResults;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  // Contacts
  async getContacts(userId: string): Promise<(Contact & { contactUser: User; status: string })[]> {
    const userContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, userId));

    const result = [];
    for (const contact of userContacts) {
      const [contactUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, contact.contactId));
      
      const [status] = await db
        .select()
        .from(userStatus)
        .where(eq(userStatus.userId, contact.contactId));
      
      if (contactUser) {
        result.push({
          ...contact,
          contactUser,
          status: status?.status || "offline",
        });
      }
    }
    return result;
  }

  async addContact(data: InsertContact): Promise<Contact> {
    const [contact] = await db.insert(contacts).values(data).returning();
    return contact;
  }

  async removeContact(userId: string, contactId: string): Promise<void> {
    await db
      .delete(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.contactId, contactId)
        )
      );
  }

  async deactivateSharedRooms(userId: string, contactId: string): Promise<void> {
    // Find all room codes where userId is a member
    const userMemberships = await db
      .select({ roomCode: roomMembers.roomCode })
      .from(roomMembers)
      .where(eq(roomMembers.userId, userId));

    const userRoomCodes = userMemberships.map(m => m.roomCode);
    if (userRoomCodes.length === 0) return;

    // Among those, find codes where contactId is also a member (= shared rooms)
    const sharedMemberships = await db
      .select({ roomCode: roomMembers.roomCode })
      .from(roomMembers)
      .where(and(
        eq(roomMembers.userId, contactId),
        inArray(roomMembers.roomCode, userRoomCodes)
      ));

    const sharedCodes = sharedMemberships.map(m => m.roomCode);
    if (sharedCodes.length === 0) return;

    // Deactivate the shared rooms so the codes are dead
    await db
      .update(rooms)
      .set({ isActive: false })
      .where(inArray(rooms.code, sharedCodes));

    // Mark all members in those rooms as inactive
    await db
      .update(roomMembers)
      .set({ isActive: false })
      .where(inArray(roomMembers.roomCode, sharedCodes));

    console.log(`[Contacts] Deactivated ${sharedCodes.length} shared room(s) on disconnect: ${sharedCodes.join(", ")}`);
  }

  // Messages
  async getMessages(userId: string, contactId: string): Promise<Message[]> {
    return db
      .select()
      .from(messagesTable)
      .where(
        or(
          and(
            eq(messagesTable.senderId, userId),
            eq(messagesTable.receiverId, contactId)
          ),
          and(
            eq(messagesTable.senderId, contactId),
            eq(messagesTable.receiverId, userId)
          )
        )
      )
      .orderBy(messagesTable.createdAt);
  }

  async sendMessage(data: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messagesTable).values(data).returning();
    return message;
  }

  async markMessagesAsRead(userId: string, senderId: string): Promise<void> {
    await db
      .update(messagesTable)
      .set({ read: true })
      .where(
        and(
          eq(messagesTable.senderId, senderId),
          eq(messagesTable.receiverId, userId),
          eq(messagesTable.read, false)
        )
      );
  }

  // Calls
  async getCalls(userId: string): Promise<(Call & { caller: User; receiver: User })[]> {
    const userCalls = await db
      .select()
      .from(calls)
      .where(
        or(
          eq(calls.callerId, userId),
          eq(calls.receiverId, userId)
        )
      )
      .orderBy(desc(calls.startedAt));

    const result = [];
    for (const call of userCalls) {
      const [caller] = await db
        .select()
        .from(users)
        .where(eq(users.id, call.callerId));
      const [receiver] = await db
        .select()
        .from(users)
        .where(eq(users.id, call.receiverId));
      
      if (caller && receiver) {
        result.push({ ...call, caller, receiver });
      }
    }
    return result;
  }

  async createCall(data: InsertCall): Promise<Call> {
    const [call] = await db.insert(calls).values(data).returning();
    return call;
  }

  async updateCall(id: string, data: Partial<Call>): Promise<Call | undefined> {
    const [call] = await db
      .update(calls)
      .set(data)
      .where(eq(calls.id, id))
      .returning();
    return call;
  }

  // User Preferences
  async getPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    if (prefs && prefs.phoneNumber) {
      if (isEncrypted(prefs.phoneNumber)) {
        const decrypted = decryptPhone(prefs.phoneNumber);
        prefs.phoneNumber = decrypted || prefs.phoneNumber;
      }
    }
    return prefs;
  }

  async getPreferencesMasked(userId: string): Promise<(UserPreferences & { phoneMasked: string | null; phoneLinked: boolean }) | undefined> {
    const prefs = await this.getPreferences(userId);
    if (!prefs) return undefined;
    return {
      ...prefs,
      phoneNumber: null,
      phoneMasked: prefs.phoneNumber ? maskPhone(prefs.phoneNumber) : null,
      phoneLinked: !!prefs.phoneNumber,
    };
  }

  async upsertPreferences(data: InsertUserPreferences): Promise<UserPreferences> {
    const encData = { ...data };
    if (encData.phoneNumber && !isEncrypted(encData.phoneNumber)) {
      encData.phoneNumber = encryptPhone(encData.phoneNumber);
    }
    const [prefs] = await db
      .insert(userPreferences)
      .values(encData)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: encData,
      })
      .returning();
    return prefs;
  }

  // Voice Profiles
  async getVoiceProfile(userId: string): Promise<VoiceProfile | undefined> {
    const [profile] = await db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId));
    return profile;
  }

  async upsertVoiceProfile(data: InsertVoiceProfile): Promise<VoiceProfile> {
    const [profile] = await db
      .insert(voiceProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: voiceProfiles.userId,
        set: data,
      })
      .returning();
    return profile;
  }

  async deleteVoiceProfile(userId: string): Promise<void> {
    await db.delete(voiceProfiles).where(eq(voiceProfiles.userId, userId));
  }

  // User Status
  async getStatus(userId: string): Promise<UserStatus | undefined> {
    const [status] = await db
      .select()
      .from(userStatus)
      .where(eq(userStatus.userId, userId));
    return status;
  }

  async updateStatus(userId: string, status: string): Promise<UserStatus> {
    const [existing] = await db
      .select()
      .from(userStatus)
      .where(eq(userStatus.userId, userId));

    if (existing) {
      const [updated] = await db
        .update(userStatus)
        .set({ status, lastSeen: new Date() })
        .where(eq(userStatus.userId, userId))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(userStatus)
      .values({ userId, status })
      .returning();
    return created;
  }

  // Rooms
  async createRoom(data: InsertRoom): Promise<Room> {
    const [room] = await db.insert(rooms).values(data).returning();
    return room;
  }

  async getRoomByCode(code: string): Promise<Room | undefined> {
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.code, code.toUpperCase()), eq(rooms.isActive, true)));
    return room;
  }

  async getRoomsByHost(hostId: string): Promise<Room[]> {
    return db
      .select()
      .from(rooms)
      .where(and(eq(rooms.hostId, hostId), eq(rooms.isActive, true)))
      .orderBy(desc(rooms.createdAt));
  }

  async getJoinedRooms(userId: string): Promise<Room[]> {
    const memberRecords = await db.select().from(roomMembers)
      .where(and(eq(roomMembers.userId, userId), eq(roomMembers.isActive, true)));
    const roomCodes = Array.from(new Set(memberRecords.map(m => m.roomCode)));
    if (roomCodes.length === 0) return [];
    const allRooms = await db.select().from(rooms).where(eq(rooms.isActive, true));
    return allRooms
      .filter(r => roomCodes.includes(r.code) && r.hostId !== userId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async deactivateRoom(roomId: string): Promise<void> {
    await db.update(rooms).set({ isActive: false }).where(eq(rooms.id, roomId));
  }

  // Room Members
  async addRoomMember(data: InsertRoomMember): Promise<RoomMember> {
    const existing = await db.select().from(roomMembers)
      .where(and(eq(roomMembers.roomCode, data.roomCode), eq(roomMembers.userId, data.userId)));
    if (existing.length > 0) {
      const updates: Partial<RoomMember> = { isActive: true };
      if (data.username) updates.username = data.username;
      await db.update(roomMembers).set(updates).where(eq(roomMembers.id, existing[0].id));
      return { ...existing[0], ...updates };
    }
    try {
      const [member] = await db.insert(roomMembers).values({ ...data, isActive: true }).returning();
      return member;
    } catch (err: any) {
      if (err?.code === '23505') {
        const [existing2] = await db.select().from(roomMembers)
          .where(and(eq(roomMembers.roomCode, data.roomCode), eq(roomMembers.userId, data.userId)));
        if (existing2) {
          await db.update(roomMembers).set({ isActive: true }).where(eq(roomMembers.id, existing2.id));
          return { ...existing2, isActive: true };
        }
      }
      throw err;
    }
  }

  async deactivateRoomMember(roomCode: string, userId: string): Promise<void> {
    await db.update(roomMembers)
      .set({ isActive: false })
      .where(and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.userId, userId)));
  }

  async removeRoomMember(roomCode: string, userId: string): Promise<void> {
    await db.delete(roomMembers)
      .where(and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.userId, userId)));
  }

  async getRoomMembers(roomCode: string): Promise<(RoomMember & { user?: User })[]> {
    const members = await db.select().from(roomMembers).where(eq(roomMembers.roomCode, roomCode));
    const results: (RoomMember & { user?: User })[] = [];
    for (const m of members) {
      const [user] = await db.select().from(users).where(eq(users.id, m.userId));
      const displayName = getDisplayName(user?.firstName, user?.lastName, m.username);
      const safeUser = user ? { ...user, email: undefined } : undefined;
      results.push({ ...m, username: displayName, user: safeUser as User | undefined });
    }
    return results;
  }

  async getRoomMembersForMultipleRooms(roomCodes: string[]): Promise<Record<string, (RoomMember & { user?: User })[]>> {
    if (roomCodes.length === 0) return {};
    const allMembers = await db.select().from(roomMembers);
    const filtered = allMembers.filter(m => roomCodes.includes(m.roomCode));
    const userIds = Array.from(new Set(filtered.map(m => m.userId)));
    const userMap = new Map<string, User>();
    for (const uid of userIds) {
      const [user] = await db.select().from(users).where(eq(users.id, uid));
      if (user) userMap.set(uid, user);
    }
    const result: Record<string, (RoomMember & { user?: User })[]> = {};
    for (const code of roomCodes) result[code] = [];
    for (const m of filtered) {
      if (!result[m.roomCode]) result[m.roomCode] = [];
      const u = userMap.get(m.userId);
      const displayName = getDisplayName(u?.firstName, u?.lastName, m.username);
      const safeUser = u ? { ...u, email: undefined } : undefined;
      result[m.roomCode].push({ ...m, username: displayName, user: safeUser as User | undefined });
    }
    return result;
  }

  // Feedback
  async getAllFeedback(): Promise<Feedback[]> {
    return db
      .select()
      .from(feedback)
      .orderBy(desc(feedback.createdAt));
  }

  async createFeedback(data: InsertFeedback): Promise<Feedback> {
    const [newFeedback] = await db.insert(feedback).values(data).returning();
    return newFeedback;
  }

  async updateFeedbackStatus(id: string, status: string, aiReview?: string): Promise<Feedback | null> {
    const updates: Record<string, any> = { status };
    if (aiReview !== undefined) updates.aiReview = aiReview;
    const [updated] = await db.update(feedback).set(updates).where(eq(feedback.id, id)).returning();
    return updated || null;
  }

  // Support Tickets
  async createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket> {
    const [ticket] = await db.insert(supportTickets).values(data).returning();
    return ticket;
  }

  async getSupportTicketsByUser(userId: string): Promise<SupportTicket[]> {
    return db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId))
      .orderBy(desc(supportTickets.createdAt));
  }

  async getAllSupportTickets(): Promise<SupportTicket[]> {
    return db
      .select()
      .from(supportTickets)
      .orderBy(desc(supportTickets.createdAt));
  }

  async updateSupportTicket(id: string, data: Partial<SupportTicket>): Promise<SupportTicket | undefined> {
    const [updated] = await db
      .update(supportTickets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(supportTickets.id, id))
      .returning();
    return updated;
  }

  async completeOnboarding(userId: string, email: string, phoneNumber: string, firstName?: string, lastName?: string | null): Promise<User> {
    const updateData: any = { onboardingComplete: true, updatedAt: new Date() };
    if (email && email.trim()) {
      updateData.email = email;
    }
    if (firstName) {
      updateData.firstName = firstName;
    }
    if (lastName !== undefined) {
      updateData.lastName = lastName;
    }
    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async isRoomMember(roomCode: string, userId: string): Promise<boolean> {
    const [member] = await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.userId, userId), eq(roomMembers.isActive, true)))
      .limit(1);
    return !!member;
  }

  async getActiveRoomMemberCount(roomCode: string): Promise<number> {
    const members = await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.isActive, true)));
    return members.length;
  }

  async updateProfileImage(userId: string, imageUrl: string): Promise<void> {
    await db
      .update(users)
      .set({ profileImageUrl: imageUrl, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updateUser(userId: string, data: Partial<{ voiceTranslationCount: number; premiumVoiceTranslation: boolean; captchaVerified: boolean }>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async updateUserProfile(userId: string, data: { firstName?: string; lastName?: string | null; username?: string; usernameCode?: string; email?: string }): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async findUsersByUsername(username: string): Promise<User[]> {
    return db
      .select()
      .from(users)
      .where(eq(users.username, username.toLowerCase()));
  }

  async setUsername(userId: string, username: string, code: string = ""): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ username, usernameCode: code, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async saveRoomMessage(data: InsertRoomMessage): Promise<DBRoomMessage> {
    const [msg] = await db.insert(roomMessagesTable).values(data).returning();
    return msg;
  }

  async getRoomMessages(roomCode: string, limit: number = 100): Promise<DBRoomMessage[]> {
    const rows = await db.select().from(roomMessagesTable)
      .where(and(eq(roomMessagesTable.roomCode, roomCode), isNull(roomMessagesTable.deletedAt)))
      .orderBy(desc(roomMessagesTable.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  async updateMessageReactions(messageId: string, reactions: Record<string, string[]>): Promise<void> {
    const hasReactions = Object.keys(reactions).length > 0;
    const reactionsJson = hasReactions ? JSON.stringify(reactions) : null;
    const result = await db.update(roomMessagesTable)
      .set({ reactions: reactionsJson })
      .where(eq(roomMessagesTable.clientMessageId, messageId))
      .returning({ id: roomMessagesTable.id });
    if (result.length === 0) {
      await db.update(roomMessagesTable)
        .set({ reactions: reactionsJson })
        .where(eq(roomMessagesTable.id, messageId));
    }
  }

  async getReactionsByMessageId(messageId: string): Promise<Record<string, string[]> | null> {
    const rows = await db.select({ reactions: roomMessagesTable.reactions })
      .from(roomMessagesTable)
      .where(eq(roomMessagesTable.id, messageId))
      .limit(1);
    if (rows.length === 0) {
      const byClient = await db.select({ reactions: roomMessagesTable.reactions })
        .from(roomMessagesTable)
        .where(eq(roomMessagesTable.clientMessageId, messageId))
        .limit(1);
      if (byClient.length === 0) return null;
      return byClient[0].reactions ? JSON.parse(byClient[0].reactions) : {};
    }
    return rows[0].reactions ? JSON.parse(rows[0].reactions) : {};
  }

  async editRoomMessage(clientMessageId: string, newContent: string, userId: string): Promise<boolean> {
    const result = await db.update(roomMessagesTable)
      .set({ content: newContent, edited: true, editedAt: new Date() })
      .where(and(eq(roomMessagesTable.clientMessageId, clientMessageId), eq(roomMessagesTable.fromId, userId)))
      .returning({ id: roomMessagesTable.id });
    return result.length > 0;
  }

  async saveMessageTranslation(clientMessageId: string, translatedContent: string, translatedLang: string): Promise<boolean> {
    const result = await db.update(roomMessagesTable)
      .set({ translatedContent, translatedLang })
      .where(eq(roomMessagesTable.clientMessageId, clientMessageId))
      .returning({ id: roomMessagesTable.id });
    return result.length > 0;
  }

  async softDeleteRoomMessage(clientMessageId: string, userId: string): Promise<boolean> {
    const result = await db.update(roomMessagesTable)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(eq(roomMessagesTable.clientMessageId, clientMessageId), eq(roomMessagesTable.fromId, userId)))
      .returning({ id: roomMessagesTable.id });
    return result.length > 0;
  }

  async countTotalRoomMessages(roomCode: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(roomMessagesTable)
      .where(eq(roomMessagesTable.roomCode, roomCode));
    return result[0]?.count || 0;
  }

  async countUnreadMessages(roomCode: string, userId: string): Promise<number> {
    const [status] = await db.select()
      .from(roomReadStatus)
      .where(and(
        eq(roomReadStatus.roomCode, roomCode),
        eq(roomReadStatus.userId, userId),
      ));
    const conditions = [
      eq(roomMessagesTable.roomCode, roomCode),
      ne(roomMessagesTable.fromId, userId),
    ];
    if (status?.lastReadAt) {
      conditions.push(gt(roomMessagesTable.createdAt, status.lastReadAt));
    }
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(roomMessagesTable)
      .where(and(...conditions));
    return result[0]?.count || 0;
  }

  async markRoomAsRead(roomCode: string, userId: string): Promise<void> {
    const [existing] = await db.select()
      .from(roomReadStatus)
      .where(and(
        eq(roomReadStatus.roomCode, roomCode),
        eq(roomReadStatus.userId, userId),
      ));
    if (existing) {
      await db.update(roomReadStatus)
        .set({ lastReadAt: new Date() })
        .where(eq(roomReadStatus.id, existing.id));
    } else {
      await db.insert(roomReadStatus).values({
        roomCode,
        userId,
        lastReadAt: new Date(),
      });
    }
  }

  async getOtherReadStatus(roomCode: string, currentUserId: string): Promise<Date | null> {
    const rows = await db.select()
      .from(roomReadStatus)
      .where(and(
        eq(roomReadStatus.roomCode, roomCode),
        sql`${roomReadStatus.userId} != ${currentUserId}`,
      ));
    if (rows.length === 0) return null;
    let latest: Date | null = null;
    for (const row of rows) {
      if (row.lastReadAt && (!latest || row.lastReadAt > latest)) {
        latest = row.lastReadAt;
      }
    }
    return latest;
  }

  async getFeatureFlag(key: string): Promise<boolean> {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key));
    return row?.enabled ?? false;
  }

  async setFeatureFlag(key: string, enabled: boolean): Promise<boolean> {
    await db.insert(featureFlags)
      .values({ key, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: new Date() } });
    return enabled;
  }

  async getAllFeatureFlags(): Promise<{ key: string; enabled: boolean; updatedAt: Date | null }[]> {
    return db.select().from(featureFlags);
  }

  async logLoginActivity(data: InsertLoginActivity): Promise<LoginActivity> {
    const [row] = await db.insert(loginActivity).values(data).returning();
    return row;
  }

  async getLoginActivity(userId: string, limit = 20): Promise<LoginActivity[]> {
    return db.select().from(loginActivity).where(eq(loginActivity.userId, userId)).orderBy(desc(loginActivity.createdAt)).limit(limit);
  }

  async getAllLoginActivity(limit = 50): Promise<LoginActivity[]> {
    return db.select().from(loginActivity).orderBy(desc(loginActivity.createdAt)).limit(limit);
  }

  async flagLoginActivity(id: string, flagged: boolean): Promise<void> {
    await db.update(loginActivity).set({ flagged }).where(eq(loginActivity.id, id));
  }

  async cleanupOldLoginActivity(cutoffDate: Date): Promise<void> {
    await db.delete(loginActivity).where(lt(loginActivity.createdAt, cutoffDate));
  }

  async exportUserData(userId: string) {
    const [profile] = await db.select().from(users).where(eq(users.id, userId));
    if (!profile) throw new Error("User not found");
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    const userContacts = await db.select().from(contacts).where(or(eq(contacts.userId, userId), eq(contacts.contactId, userId)));
    const userMessages = await db.select().from(messagesTable).where(or(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, userId)));
    const userCalls = await db.select().from(calls).where(or(eq(calls.callerId, userId), eq(calls.receiverId, userId)));
    const userRooms = await db.select().from(rooms).where(eq(rooms.hostId, userId));
    const memberships = await db.select().from(roomMembers).where(eq(roomMembers.userId, userId));
    const userFeedback = await db.select().from(feedback).where(eq(feedback.userId, userId));
    const userTickets = await db.select().from(supportTickets).where(eq(supportTickets.userId, userId));
    const [status] = await db.select().from(userStatus).where(eq(userStatus.userId, userId));
    const userLoginActivity = await db.select().from(loginActivity).where(eq(loginActivity.userId, userId)).orderBy(desc(loginActivity.createdAt)).limit(100);
    const roomCodes = [...userRooms.map(r => r.code), ...memberships.map(m => m.roomCode)];
    const uniqueRoomCodes = [...new Set(roomCodes)];
    let userRoomMessages: any[] = [];
    for (const code of uniqueRoomCodes) {
      const msgs = await db.select().from(roomMessagesTable).where(eq(roomMessagesTable.roomCode, code));
      const userMsgs = msgs.filter(m => m.fromId === userId);
      userRoomMessages = [...userRoomMessages, ...userMsgs];
    }
    return {
      profile,
      preferences: prefs,
      contacts: userContacts,
      messages: userMessages,
      calls: userCalls,
      rooms: userRooms,
      roomMemberships: memberships,
      roomMessages: userRoomMessages,
      feedback: userFeedback,
      supportTickets: userTickets,
      status,
      loginActivity: userLoginActivity,
    };
  }

  async deleteUserAccount(userId: string): Promise<void> {
    await db.update(mobileTokens).set({ revokedAt: new Date() }).where(eq(mobileTokens.userId, userId));
    await db.delete(devices).where(eq(devices.userId, userId));
    await db.delete(loginActivity).where(eq(loginActivity.userId, userId));
    await db.delete(roomReadStatus).where(eq(roomReadStatus.userId, userId));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await db.delete(roomMessagesTable).where(eq(roomMessagesTable.fromId, userId));
    await db.delete(roomMembers).where(eq(roomMembers.userId, userId));
    await db.delete(supportTickets).where(eq(supportTickets.userId, userId));
    await db.update(feedback).set({ userId: "deleted", firstName: "Deleted User" }).where(eq(feedback.userId, userId));
    await db.delete(messagesTable).where(or(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, userId)));
    await db.delete(contacts).where(or(eq(contacts.userId, userId), eq(contacts.contactId, userId)));
    await db.delete(calls).where(or(eq(calls.callerId, userId), eq(calls.receiverId, userId)));
    await db.delete(userStatus).where(eq(userStatus.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
    const userRooms = await db.select({ id: rooms.id, code: rooms.code }).from(rooms).where(eq(rooms.hostId, userId));
    for (const room of userRooms) {
      await db.delete(roomMembers).where(eq(roomMembers.roomCode, room.code));
      await db.delete(roomMessagesTable).where(eq(roomMessagesTable.roomCode, room.code));
      await db.delete(roomReadStatus).where(eq(roomReadStatus.roomCode, room.code));
    }
    await db.delete(rooms).where(eq(rooms.hostId, userId));
    await db.delete(sessions).where(sql`sess->>'userId' = ${userId}`);
    await db.delete(users).where(eq(users.id, userId));
  }

  async saveVoiceConversation(data: InsertVoiceConversation): Promise<VoiceConversation> {
    const [conv] = await db.insert(voiceConversations).values(data).returning();
    return conv;
  }

  async getVoiceConversations(userId: string, limit = 50): Promise<VoiceConversation[]> {
    return db.select().from(voiceConversations)
      .where(eq(voiceConversations.userId, userId))
      .orderBy(desc(voiceConversations.createdAt))
      .limit(limit);
  }

  async createJunoConversation(data: InsertJunoConversation): Promise<JunoConversation> {
    const [conv] = await db.insert(junoConversations).values(data).returning();
    return conv;
  }

  async getJunoConversations(userId: string, limit = 50, sessionType?: string): Promise<JunoConversation[]> {
    const conditions = [eq(junoConversations.userId, userId)];
    if (sessionType) conditions.push(eq(junoConversations.sessionType, sessionType));
    return db.select().from(junoConversations)
      .where(and(...conditions))
      .orderBy(desc(junoConversations.updatedAt))
      .limit(limit);
  }

  async getJunoConversation(id: string, userId: string): Promise<JunoConversation | undefined> {
    const [conv] = await db.select().from(junoConversations)
      .where(and(eq(junoConversations.id, id), eq(junoConversations.userId, userId)));
    return conv;
  }

  async updateJunoConversation(id: string, userId: string, messages: any[], title?: string): Promise<JunoConversation | undefined> {
    const updateData: any = { messages, updatedAt: new Date() };
    if (title) updateData.title = title;
    const [conv] = await db.update(junoConversations)
      .set(updateData)
      .where(and(eq(junoConversations.id, id), eq(junoConversations.userId, userId)))
      .returning();
    return conv;
  }

  async deleteJunoConversation(id: string, userId: string): Promise<void> {
    await db.delete(junoConversations)
      .where(and(eq(junoConversations.id, id), eq(junoConversations.userId, userId)));
  }

  async getConversationsOlderThan(days: number): Promise<JunoConversation[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return db.select().from(junoConversations)
      .where(and(
        lt(junoConversations.createdAt, cutoff),
        eq(junoConversations.archived, false)
      ))
      .orderBy(desc(junoConversations.createdAt));
  }

  async markConversationsArchived(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await db.update(junoConversations)
      .set({ archived: true })
      .where(inArray(junoConversations.id, ids));
  }

  async bulkDeleteJunoConversations(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await db.delete(junoConversations)
      .where(inArray(junoConversations.id, ids));
  }

  async lookupTranslationMemory(sourceText: string, sourceLang: string, targetLang: string): Promise<string | null> {
    try {
      const [exactEntry] = await db.select()
        .from(translationMemory)
        .where(and(
          eq(translationMemory.sourceLang, sourceLang),
          eq(translationMemory.targetLang, targetLang),
          eq(translationMemory.sourceText, sourceText),
        ))
        .limit(1);
      if (exactEntry) {
        db.update(translationMemory)
          .set({ hitCount: String(parseInt(exactEntry.hitCount || "1") + 1), updatedAt: new Date() })
          .where(eq(translationMemory.id, exactEntry.id))
          .catch(() => {});
        return exactEntry.translatedText;
      }

      const [ciEntry] = await db.select()
        .from(translationMemory)
        .where(and(
          eq(translationMemory.sourceLang, sourceLang),
          eq(translationMemory.targetLang, targetLang),
          sql`LOWER(${translationMemory.sourceText}) = LOWER(${sourceText})`,
        ))
        .limit(1);
      if (ciEntry) {
        db.update(translationMemory)
          .set({ hitCount: String(parseInt(ciEntry.hitCount || "1") + 1), updatedAt: new Date() })
          .where(eq(translationMemory.id, ciEntry.id))
          .catch(() => {});
        return ciEntry.translatedText;
      }

      return null;
    } catch {
      return null;
    }
  }

  async saveTranslationMemory(sourceText: string, sourceLang: string, targetLang: string, translatedText: string, provider: string): Promise<void> {
    try {
      await db.insert(translationMemory)
        .values({ sourceLang, targetLang, sourceText, translatedText, provider })
        .onConflictDoUpdate({
          target: [translationMemory.sourceLang, translationMemory.targetLang, translationMemory.sourceText],
          set: { translatedText, provider, updatedAt: new Date() },
        });
    } catch (err) {
      console.error("[TranslationMemory] Save failed:", err);
    }
  }

  async storeTranslationWithEmbedding(sourceText: string, translatedText: string, sourceLang: string, targetLang: string, roomCode?: string, provider?: string): Promise<void> {
    try {
      const { storeTranslationEmbedding, isVectorReady } = await import("./embedding-service");
      if (!isVectorReady()) return;
      await storeTranslationEmbedding(sourceText, translatedText, sourceLang, targetLang, roomCode, provider);
    } catch (err) {
      console.error("[VectorMemory] Store translation embedding failed:", err);
    }
  }

  async searchSimilarTranslations(queryText: string, sourceLang: string, targetLang: string, limit: number = 5, roomCode?: string): Promise<{ sourceText: string; translatedText: string; similarity: number }[]> {
    try {
      const { searchSimilarTranslations: search, isVectorReady } = await import("./embedding-service");
      if (!isVectorReady()) return [];
      const results = await search(queryText, sourceLang, targetLang, Math.min(limit, 20), 0.75, roomCode);
      return results.map(r => ({ sourceText: r.sourceText, translatedText: r.translatedText, similarity: r.similarity }));
    } catch (err) {
      console.error("[VectorMemory] Search similar translations failed:", err);
      return [];
    }
  }

  async storeConversationContext(content: string, userId: string, contentType: string = "message", roomCode?: string, metadata?: Record<string, any>): Promise<void> {
    try {
      const { storeConversationEmbedding, isVectorReady } = await import("./embedding-service");
      if (!isVectorReady()) return;
      await storeConversationEmbedding(content, userId, contentType, roomCode, metadata);
    } catch (err) {
      console.error("[VectorMemory] Store conversation context failed:", err);
    }
  }

  async searchConversationContext(queryText: string, userId?: string, roomCode?: string, limit: number = 10): Promise<{ content: string; contentType: string; similarity: number; metadata: any }[]> {
    try {
      const { searchSimilarConversations, isVectorReady } = await import("./embedding-service");
      if (!isVectorReady()) return [];
      const results = await searchSimilarConversations(queryText, userId, roomCode, undefined, limit);
      return results.map(r => ({ content: r.content, contentType: r.contentType, similarity: r.similarity, metadata: r.metadata }));
    } catch (err) {
      console.error("[VectorMemory] Search conversation context failed:", err);
      return [];
    }
  }

  // ── Devices ──────────────────────────────────────────────────────────────────

  async registerDevice(userId: string, data: { deviceName?: string; deviceType?: string; deviceFingerprint?: string }): Promise<Device> {
    if (data.deviceFingerprint) {
      const existing = await this.getDeviceByFingerprint(userId, data.deviceFingerprint);
      if (existing && !existing.revokedAt) {
        await db.update(devices).set({ lastActive: new Date() }).where(eq(devices.id, existing.id));
        return { ...existing, lastActive: new Date() };
      }
    }
    const [device] = await db.insert(devices).values({
      userId,
      deviceName: data.deviceName,
      deviceType: data.deviceType,
      deviceFingerprint: data.deviceFingerprint,
    }).returning();
    return device;
  }

  async getDevices(userId: string): Promise<Device[]> {
    return db.select().from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .orderBy(desc(devices.lastActive));
  }

  async revokeDevice(deviceId: string, userId: string): Promise<void> {
    await db.update(devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
    const revokedDevice = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId));
    if (revokedDevice.length > 0) {
      await db.update(mobileTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(mobileTokens.deviceId, deviceId), isNull(mobileTokens.revokedAt)));
    }
  }

  async getDeviceByFingerprint(userId: string, fingerprint: string): Promise<Device | undefined> {
    const [device] = await db.select().from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.deviceFingerprint, fingerprint)));
    return device;
  }

  // ── Mobile Tokens ─────────────────────────────────────────────────────────────

  async createMobileTokens(data: { userId: string; deviceId?: string; accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date }): Promise<MobileToken> {
    const [token] = await db.insert(mobileTokens).values(data).returning();
    return token;
  }

  async getMobileTokenByRefresh(refreshToken: string): Promise<MobileToken | undefined> {
    const [token] = await db.select().from(mobileTokens).where(eq(mobileTokens.refreshToken, refreshToken));
    return token;
  }

  async getMobileTokenByAccess(accessToken: string): Promise<MobileToken | undefined> {
    const [token] = await db.select().from(mobileTokens).where(eq(mobileTokens.accessToken, accessToken));
    return token;
  }

  async updateMobileTokenAccess(id: string, accessToken: string, accessExpiresAt: Date): Promise<void> {
    await db.update(mobileTokens).set({ accessToken, accessExpiresAt }).where(eq(mobileTokens.id, id));
  }

  async revokeMobileToken(refreshToken: string): Promise<void> {
    await db.update(mobileTokens)
      .set({ revokedAt: new Date() })
      .where(eq(mobileTokens.refreshToken, refreshToken));
  }

  async revokeMobileTokensByUser(userId: string): Promise<void> {
    await db.update(mobileTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(mobileTokens.userId, userId), isNull(mobileTokens.revokedAt)));
  }

  async getCarouselItems(category?: string): Promise<CarouselItem[]> {
    if (category) {
      return db.select().from(carouselItems)
        .where(and(eq(carouselItems.category, category), eq(carouselItems.active, true)))
        .orderBy(asc(carouselItems.createdAt));
    }
    return db.select().from(carouselItems)
      .where(eq(carouselItems.active, true))
      .orderBy(asc(carouselItems.category), asc(carouselItems.createdAt));
  }

  async replaceCarouselItems(items: InsertCarouselItem[]): Promise<void> {
    await db.delete(carouselItems);
    if (items.length > 0) {
      await db.insert(carouselItems).values(items);
    }
  }

  async saveVisionScan(scan: InsertVisionScan): Promise<VisionScan> {
    const [row] = await db.insert(visionScans).values(scan).returning();
    return row;
  }

  async getRecentVisionScans(limit: number): Promise<VisionScan[]> {
    return db.select().from(visionScans)
      .orderBy(desc(visionScans.scannedAt))
      .limit(limit);
  }

  async searchVisionScans(query: string, limit: number): Promise<VisionScan[]> {
    return db.select().from(visionScans)
      .where(ilike(visionScans.label, `%${query}%`))
      .orderBy(desc(visionScans.scannedAt))
      .limit(limit);
  }

}

export const storage = new DatabaseStorage();
