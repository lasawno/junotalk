import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, pgEnum, uniqueIndex, index, integer, real, jsonb, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";

// Re-export chat models for OpenAI integration
export * from "./models/chat";


// Contacts table - relationships between users
export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  contactId: varchar("contact_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").notNull(),
  receiverId: varchar("receiver_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  read: boolean("read").default(false),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  read: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Call logs table
export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callerId: varchar("caller_id").notNull(),
  receiverId: varchar("receiver_id").notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  status: varchar("status").notNull().default("pending"), // pending, active, ended, missed
  callType: varchar("call_type").notNull().default("video"), // voice, video
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  startedAt: true,
  endedAt: true,
});
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

// User preferences for language settings
export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  phoneNumber: varchar("phone_number"),
  spokenLanguage: varchar("spoken_language").default("auto"),
  subtitleLanguage: varchar("subtitle_language").default("en"),
  showOriginalText: boolean("show_original_text").default(true),
  showTranslatedText: boolean("show_translated_text").default(true),
  autoDetectLanguage: boolean("auto_detect_language").default(true),
  wakeWordEnabled: boolean("wake_word_enabled").default(false),
  spokenLanguages: text("spoken_languages").array().default(sql`ARRAY[]::text[]`),
  voiceIdentityEnabled: boolean("voice_identity_enabled").default(false),
  voiceIdentityVoice: varchar("voice_identity_voice"),
  junoStyle: varchar("juno_style").default("casual"),
});

// Voice profiles table -- one row per user, stores sample metadata
export const voiceProfiles = pgTable("voice_profiles", {
  userId: varchar("user_id").primaryKey(),
  samplePath: varchar("sample_path"),
  status: varchar("status").default("pending"),
  preferredVoice: varchar("preferred_voice").default("nova"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertVoiceProfileSchema = createInsertSchema(voiceProfiles).omit({ uploadedAt: true });
export type InsertVoiceProfile = z.infer<typeof insertVoiceProfileSchema>;
export type VoiceProfile = typeof voiceProfiles.$inferSelect;

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
});
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// User status tracking (online/away/offline)
export const userStatus = pgTable("user_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  status: varchar("status").notNull().default("offline"),
  lastSeen: timestamp("last_seen").defaultNow(),
});

export const insertUserStatusSchema = createInsertSchema(userStatus).omit({
  id: true,
  lastSeen: true,
});
export type InsertUserStatus = z.infer<typeof insertUserStatusSchema>;
export type UserStatus = typeof userStatus.$inferSelect;

// Video call rooms with room codes
export const rooms = pgTable("rooms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 6 }).notNull().unique(),
  hostId: varchar("host_id").notNull(),
  name: varchar("name"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  id: true,
  createdAt: true,
});
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof rooms.$inferSelect;

// Room members - tracks who has joined each room
export const roomMembers = pgTable("room_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: varchar("room_code").notNull(),
  userId: varchar("user_id").notNull(),
  username: varchar("username"),
  isActive: boolean("is_active").default(true),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const insertRoomMemberSchema = createInsertSchema(roomMembers).omit({
  id: true,
  joinedAt: true,
});
export type InsertRoomMember = z.infer<typeof insertRoomMemberSchema>;
export type RoomMember = typeof roomMembers.$inferSelect;

// Feedback table for user feedback
export const feedback = pgTable("feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  firstName: varchar("first_name").notNull(),
  comment: text("comment").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("needs_work"),
  aiReview: text("ai_review"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  status: true,
  aiReview: true,
  createdAt: true,
});
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedback.$inferSelect;

export const supportTicketCategoryEnum = pgEnum("support_ticket_category", [
  "translation",
  "video",
  "audio",
  "text",
  "account",
  "other",
]);

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

export const supportTicketPriorityEnum = pgEnum("support_ticket_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  username: varchar("username"),
  category: supportTicketCategoryEnum("category").notNull(),
  subject: varchar("subject").notNull(),
  description: text("description").notNull(),
  status: supportTicketStatusEnum("status").notNull().default("open"),
  priority: supportTicketPriorityEnum("priority").notNull().default("medium"),
  aiResponse: text("ai_response"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  aiResponse: true,
  adminNotes: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export const roomReadStatus = pgTable("room_read_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: varchar("room_code").notNull(),
  userId: varchar("user_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow(),
}, (table) => [
  uniqueIndex("room_read_status_room_user_idx").on(table.roomCode, table.userId),
]);

export const insertRoomReadStatusSchema = createInsertSchema(roomReadStatus).omit({
  id: true,
});
export type InsertRoomReadStatus = z.infer<typeof insertRoomReadStatusSchema>;
export type RoomReadStatus = typeof roomReadStatus.$inferSelect;

export const roomMessages = pgTable("room_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: varchar("room_code").notNull(),
  fromId: varchar("from_id").notNull(),
  fromName: varchar("from_name").notNull(),
  content: text("content").notNull(),
  translatedContent: text("translated_content"),
  translatedLang: varchar("translated_lang"),
  audioData: text("audio_data"),
  transcription: text("transcription"),
  replyToData: text("reply_to_data"),
  clientMessageId: varchar("client_message_id"),
  reactions: text("reactions"),
  edited: boolean("edited").default(false),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: varchar("deleted_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoomMessageSchema = createInsertSchema(roomMessages).omit({
  id: true,
  createdAt: true,
});
export type InsertRoomMessage = z.infer<typeof insertRoomMessageSchema>;
export type RoomMessage = typeof roomMessages.$inferSelect;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
]);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const voiceConversations = pgTable("voice_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  originalText: text("original_text").notNull(),
  translatedText: text("translated_text"),
  sourceLang: varchar("source_lang", { length: 10 }).notNull(),
  targetLang: varchar("target_lang", { length: 10 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVoiceConversationSchema = createInsertSchema(voiceConversations).omit({
  id: true,
  createdAt: true,
});
export type InsertVoiceConversation = z.infer<typeof insertVoiceConversationSchema>;
export type VoiceConversation = typeof voiceConversations.$inferSelect;

export const junoConversations = pgTable("juno_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: varchar("title", { length: 200 }).default("New conversation"),
  sessionType: varchar("session_type", { length: 10 }).default("chat"),
  durationSeconds: integer("duration_seconds").default(0),
  messages: jsonb("messages").notNull().$default(() => []),
  archived: boolean("archived").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("juno_conversations_user_id_idx").on(table.userId),
]);

export const insertJunoConversationSchema = createInsertSchema(junoConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJunoConversation = z.infer<typeof insertJunoConversationSchema>;
export type JunoConversation = typeof junoConversations.$inferSelect;

export const loginActivity = pgTable("login_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  username: varchar("username"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  deviceType: varchar("device_type"),
  browser: varchar("browser"),
  country: varchar("country"),
  flagged: boolean("flagged").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("login_activity_user_id_idx").on(table.userId),
  index("login_activity_created_at_idx").on(table.createdAt),
]);

export const insertLoginActivitySchema = createInsertSchema(loginActivity).omit({
  id: true,
  createdAt: true,
  flagged: true,
});
export type InsertLoginActivity = z.infer<typeof insertLoginActivitySchema>;
export type LoginActivity = typeof loginActivity.$inferSelect;

export const featureFlags = pgTable("feature_flags", {
  key: varchar("key").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  updatedAt: true,
});
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

export const translationMemory = pgTable("translation_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceLang: varchar("source_lang", { length: 10 }).notNull(),
  targetLang: varchar("target_lang", { length: 10 }).notNull(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  provider: varchar("provider", { length: 30 }),
  hitCount: varchar("hit_count").default("1"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tm_lang_pair_idx").on(table.sourceLang, table.targetLang),
  index("tm_source_text_idx").on(table.sourceText),
  uniqueIndex("tm_unique_pair_idx").on(table.sourceLang, table.targetLang, table.sourceText),
]);

export type TranslationMemoryEntry = typeof translationMemory.$inferSelect;

export const translationEmbeddings = pgTable("translation_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceLang: varchar("source_lang", { length: 10 }).notNull(),
  targetLang: varchar("target_lang", { length: 10 }).notNull(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  roomCode: varchar("room_code"),
  provider: varchar("provider", { length: 30 }),
  embeddingModel: varchar("embedding_model", { length: 50 }).default("text-embedding-3-small"),
  hitCount: integer("hit_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("te_lang_pair_idx").on(table.sourceLang, table.targetLang),
  index("te_room_code_idx").on(table.roomCode),
]);

export type TranslationEmbedding = typeof translationEmbeddings.$inferSelect;

export const conversationEmbeddings = pgTable("conversation_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  roomCode: varchar("room_code"),
  contentType: varchar("content_type", { length: 20 }).notNull().default("message"),
  content: text("content").notNull(),
  metadata: text("metadata"),
  embeddingModel: varchar("embedding_model", { length: 50 }).default("text-embedding-3-small"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ce_user_id_idx").on(table.userId),
  index("ce_room_code_idx").on(table.roomCode),
  index("ce_content_type_idx").on(table.contentType),
]);

export type ConversationEmbedding = typeof conversationEmbeddings.$inferSelect;

// ── User Reports (#3) ─────────────────────────────────────────────────────────
export const userReports = pgTable("user_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reporterId: varchar("reporter_id").notNull(),
  reportedId: varchar("reported_id").notNull(),
  reason: varchar("reason", { length: 50 }).notNull(),
  detail: text("detail"),
  status: varchar("status", { length: 20 }).default("pending"),
  resolvedBy: varchar("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("reports_reporter_idx").on(table.reporterId),
  index("reports_reported_idx").on(table.reportedId),
  index("reports_status_idx").on(table.status),
]);
export const insertUserReportSchema = createInsertSchema(userReports).omit({ id: true, status: true, resolvedBy: true, resolvedAt: true, createdAt: true });
export type InsertUserReport = z.infer<typeof insertUserReportSchema>;
export type UserReport = typeof userReports.$inferSelect;

// ── User Blocks and Mutes (#3) ────────────────────────────────────────────────
export const userBlocks = pgTable("user_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  blockerId: varchar("blocker_id").notNull(),
  blockedId: varchar("blocked_id").notNull(),
  type: varchar("type", { length: 10 }).default("block"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("blocks_pair_idx").on(table.blockerId, table.blockedId),
  index("blocks_blocker_idx").on(table.blockerId),
]);
export const insertUserBlockSchema = createInsertSchema(userBlocks).omit({ id: true, createdAt: true });
export type InsertUserBlock = z.infer<typeof insertUserBlockSchema>;
export type UserBlock = typeof userBlocks.$inferSelect;

// ── User Bans (#12) ───────────────────────────────────────────────────────────
export const userBans = pgTable("user_bans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  reason: text("reason").notNull(),
  bannedBy: varchar("banned_by").notNull(),
  type: varchar("type", { length: 15 }).default("temporary"),
  expiresAt: timestamp("expires_at"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("bans_user_idx").on(table.userId),
  index("bans_active_idx").on(table.active),
]);
export const insertUserBanSchema = createInsertSchema(userBans).omit({ id: true, active: true, createdAt: true });
export type InsertUserBan = z.infer<typeof insertUserBanSchema>;
export type UserBan = typeof userBans.$inferSelect;

// ── Audit Log (#14) ───────────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorId: varchar("actor_id"),
  targetId: varchar("target_id"),
  action: varchar("action", { length: 60 }).notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  detail: text("detail"),
  ipAddress: varchar("ip_address"),
  severity: varchar("severity", { length: 10 }).default("info"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("audit_actor_idx").on(table.actorId),
  index("audit_action_idx").on(table.action),
  index("audit_category_idx").on(table.category),
  index("audit_created_idx").on(table.createdAt),
]);
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ── User Risk Scores (#11) ────────────────────────────────────────────────────
export const userRiskScores = pgTable("user_risk_scores", {
  userId: varchar("user_id").primaryKey(),
  score: integer("score").default(0),
  flags: text("flags").array().default([]),
  lastViolation: varchar("last_violation", { length: 60 }),
  violations: integer("violations").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type UserRiskScore = typeof userRiskScores.$inferSelect;

// ── Registered Devices (#15) ──────────────────────────────────────────────────
export const devices = pgTable("devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  deviceName: varchar("device_name", { length: 100 }),
  deviceType: varchar("device_type", { length: 20 }),
  deviceFingerprint: varchar("device_fingerprint", { length: 255 }),
  lastActive: timestamp("last_active").defaultNow(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("devices_user_idx").on(table.userId),
  index("devices_fingerprint_idx").on(table.deviceFingerprint),
]);
export type Device = typeof devices.$inferSelect;

// ── Mobile Auth Tokens (#16) ──────────────────────────────────────────────────
export const mobileTokens = pgTable("mobile_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  deviceId: varchar("device_id"),
  accessToken: varchar("access_token", { length: 512 }).notNull(),
  refreshToken: varchar("refresh_token", { length: 512 }).notNull(),
  accessExpiresAt: timestamp("access_expires_at").notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("mobile_tokens_user_idx").on(table.userId),
  index("mobile_tokens_refresh_idx").on(table.refreshToken),
  index("mobile_tokens_access_idx").on(table.accessToken),
]);
export type MobileToken = typeof mobileTokens.$inferSelect;

// ── Carousel Items (Juno Tools cards) ────────────────────────────────────────
export const carouselItems = pgTable("carousel_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: varchar("category").notNull(),
  label: text("label").notNull(),
  videoSrc: text("video_src").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  isHD: boolean("is_hd").default(false),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertCarouselItemSchema = createInsertSchema(carouselItems).omit({ id: true, createdAt: true });
export type InsertCarouselItem = z.infer<typeof insertCarouselItemSchema>;
export type CarouselItem = typeof carouselItems.$inferSelect;

// ── Vision Scans (brand/product memory) ──────────────────────────────────────
export const visionScans = pgTable("vision_scans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  label: text("label").notNull(),
  brand: varchar("brand", { length: 200 }),
  translation: text("translation").notNull(),
  sentence: text("sentence"),
  englishDetails: text("english_details"),
  price: varchar("price", { length: 50 }),
  sourceLang: varchar("source_lang", { length: 10 }).notNull(),
  targetLang: varchar("target_lang", { length: 10 }).notNull(),
  engine: varchar("engine", { length: 30 }),
  scannedAt: timestamp("scanned_at").defaultNow(),
}, (table) => [
  index("vs_user_id_idx").on(table.userId),
  index("vs_label_idx").on(table.label),
  index("vs_scanned_at_idx").on(table.scannedAt),
]);
export const insertVisionScanSchema = createInsertSchema(visionScans).omit({ id: true, scannedAt: true });
export type InsertVisionScan = z.infer<typeof insertVisionScanSchema>;
export type VisionScan = typeof visionScans.$inferSelect;

// ── Conversation History — persisted sessions (chat + voice) ─────────────────
export const conversationSessions = pgTable("conversation_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull().default("New conversation"),
  mode: varchar("mode", { length: 10 }).notNull().default("chat"),
  messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ConversationSession = typeof conversationSessions.$inferSelect;
export type InsertConversationSession = typeof conversationSessions.$inferInsert;

export const DEFAULT_FEATURE_FLAGS = [
  "translation_v2_enabled",
  "juno_ai_beta",
  "video_pipeline_v2",
  "camera_ui_v2",
] as const;

export const V2_FEATURE_FLAGS = new Set<string>([
  "translation_v2_enabled",
  "juno_ai_beta",
  "video_pipeline_v2",
  "camera_ui_v2",
]);
