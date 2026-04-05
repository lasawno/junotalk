import { Router } from "express";
import { WebSocket } from "ws";
import { insertMessageSchema, insertContactSchema } from "@shared/schema";

export function createMessagingRouter(deps: {
  isAuthenticated: any;
  storage: any;
  sanitizeUser: (u: any) => any;
  connectedClients: Map<string, WebSocket>;
}) {
  const router = Router();
  const { isAuthenticated, storage, sanitizeUser, connectedClients } = deps;

  router.get("/users/:id", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const status = await storage.getStatus(id);
      res.json({ user: sanitizeUser(user), status: status?.status || "offline" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  router.get("/users/search/:query", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const users = await storage.searchUsers(req.params.query, userId);
      const sanitized = users.map((u: any) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName ? u.lastName.charAt(0) + "." : null,
        profileImageUrl: u.profileImageUrl,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error searching users:", error);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  router.get("/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const contacts = await storage.getContacts(userId);
      const sanitized = contacts.map((c: any) => ({
        ...c,
        contactUser: sanitizeUser(c.contactUser),
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  router.post("/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = insertContactSchema.safeParse({
        userId,
        contactId: req.body.contactId,
      });

      if (!result.success) {
        return res.status(400).json({ message: "Invalid contact data" });
      }

      const contact = await storage.addContact(result.data);
      res.status(201).json(contact);
    } catch (error) {
      console.error("Error adding contact:", error);
      res.status(500).json({ message: "Failed to add contact" });
    }
  });

  router.delete("/contacts/:contactId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.removeContact(userId, req.params.contactId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing contact:", error);
      res.status(500).json({ message: "Failed to remove contact" });
    }
  });

  router.get("/messages/:contactId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const messages = await storage.getMessages(userId, req.params.contactId);
      await storage.markMessagesAsRead(userId, req.params.contactId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  router.post("/messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = insertMessageSchema.safeParse({
        senderId: userId,
        receiverId: req.body.receiverId,
        content: req.body.content,
      });

      if (!result.success) {
        return res.status(400).json({ message: "Invalid message data" });
      }

      const message = await storage.sendMessage(result.data);

      const recipientWs = connectedClients.get(req.body.receiverId);
      if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
        recipientWs.send(JSON.stringify({
          type: "new-message",
          message,
        }));
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  router.get("/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const calls = await storage.getCalls(userId);
      const sanitized = calls.map((c: any) => ({
        ...c,
        caller: c.caller ? sanitizeUser(c.caller) : undefined,
        receiver: c.receiver ? sanitizeUser(c.receiver) : undefined,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching calls:", error);
      res.status(500).json({ message: "Failed to fetch calls" });
    }
  });

  router.post("/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const call = await storage.createCall({
        callerId: userId,
        receiverId: req.body.receiverId,
        status: "pending",
      });
      res.status(201).json(call);
    } catch (error) {
      console.error("Error creating call:", error);
      res.status(500).json({ message: "Failed to create call" });
    }
  });

  router.patch("/calls/:id", isAuthenticated, async (req, res) => {
    try {
      const callId = req.params.id as string;
      const call = await storage.updateCall(callId, req.body);
      res.json(call);
    } catch (error) {
      console.error("Error updating call:", error);
      res.status(500).json({ message: "Failed to update call" });
    }
  });

  return router;
}
