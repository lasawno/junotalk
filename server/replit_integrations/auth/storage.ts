import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq } from "drizzle-orm";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  private isTestMode(): boolean {
    const issuer = process.env.ISSUER_URL;
    return !!issuer && !issuer.includes("replit.com");
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      const existing = userData.id ? await this.getUser(userData.id) : undefined;
      const updateData: Partial<UpsertUser> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (userData.email) updateData.email = userData.email;
      if (userData.profileImageUrl && !existing?.profileImageUrl) updateData.profileImageUrl = userData.profileImageUrl;
      if (userData.firstName && (!existing?.firstName || !existing.firstName.trim())) {
        updateData.firstName = userData.firstName;
      }
      if (userData.lastName && (!existing?.lastName || !existing.lastName.trim())) {
        updateData.lastName = userData.lastName;
      }

      const insertValues = { ...userData };
      if (this.isTestMode() && !existing) {
        (insertValues as any).onboardingComplete = true;
      }

      const [user] = await db
        .insert(users)
        .values(insertValues)
        .onConflictDoUpdate({
          target: users.id,
          set: existing ? updateData : { ...insertValues, updatedAt: new Date() },
        })
        .returning();
      return user;
    } catch (err: any) {
      if (err?.constraint === "users_email_unique" && userData.email) {
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, userData.email));
        if (existing) {
          const [updated] = await db
            .update(users)
            .set({ ...userData, id: existing.id, updatedAt: new Date() })
            .where(eq(users.id, existing.id))
            .returning();
          return updated;
        }
      }
      throw err;
    }
  }
}

export const authStorage = new AuthStorage();
