import { db } from "./db";
import { users } from "@shared/models/auth";
import { userStatus, featureFlags, DEFAULT_FEATURE_FLAGS } from "@shared/schema";
import { eq } from "drizzle-orm";

const demoUsers = [
  {
    id: "demo-user-1",
    email: "sarah.chen@example.com",
    firstName: "Sarah",
    lastName: "Chen",
    profileImageUrl: null,
  },
  {
    id: "demo-user-2",
    email: "miguel.rodriguez@example.com",
    firstName: "Miguel",
    lastName: "Rodriguez",
    profileImageUrl: null,
  },
  {
    id: "demo-user-3",
    email: "emma.johnson@example.com",
    firstName: "Emma",
    lastName: "Johnson",
    profileImageUrl: null,
  },
  {
    id: "demo-user-4",
    email: "hiroshi.tanaka@example.com",
    firstName: "Hiroshi",
    lastName: "Tanaka",
    profileImageUrl: null,
  },
  {
    id: "demo-user-5",
    email: "marie.dupont@example.com",
    firstName: "Marie",
    lastName: "Dupont",
    profileImageUrl: null,
  },
  {
    id: "demo-user-ali",
    email: "ali@example.com",
    firstName: "Ali",
    lastName: "Ahmed",
    profileImageUrl: null,
  },
  {
    id: "demo-user-lasawno",
    email: "lasawno@example.com",
    firstName: "Lasawno",
    lastName: "Hassan",
    profileImageUrl: null,
  },
];

export async function seedDatabase() {
  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, "demo-user-1"));

    if (!existingUser) {
      console.log("Seeding demo users...");
      for (const user of demoUsers) {
        await db.insert(users).values(user).onConflictDoNothing();
      }
      const statuses = ["online", "online", "away", "offline", "online", "online", "away"];
      for (let i = 0; i < demoUsers.length; i++) {
        await db.insert(userStatus).values({
          userId: demoUsers[i].id,
          status: statuses[i],
        }).onConflictDoNothing();
      }
      console.log("Demo users seeded successfully");
    }

    await seedFeatureFlags();
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

async function seedFeatureFlags() {
  try {
    for (const key of DEFAULT_FEATURE_FLAGS) {
      await db.insert(featureFlags)
        .values({ key, enabled: false })
        .onConflictDoNothing();
    }
    console.log("Feature flags seeded successfully");
  } catch (error) {
    console.error("Error seeding feature flags:", error);
  }
}
