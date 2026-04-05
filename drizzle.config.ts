import { defineConfig } from "drizzle-kit";

function resolveDbUrl(): string {
  const candidates = [
    process.env.SUPABASE_POOLER_URL,
    process.env.SUPABASE_DATABASE_URL,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    let cleaned = raw.trim();
    const idx = cleaned.indexOf("postgresql://");
    if (idx > 0) cleaned = cleaned.substring(idx);
    const idx2 = cleaned.indexOf("postgres://");
    if (idx2 > 0) cleaned = cleaned.substring(idx2);
    if (cleaned.startsWith("postgresql://") || cleaned.startsWith("postgres://")) {
      try {
        const parsed = new URL(cleaned);
        parsed.pathname = "/postgres";
        if (parsed.hostname.includes("pooler.supabase.com") && parsed.port === "5432") {
          parsed.port = "6543";
        }
        return parsed.toString();
      } catch {
        return cleaned;
      }
    }
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("No database URL found. Set SUPABASE_POOLER_URL, SUPABASE_DATABASE_URL, or DATABASE_URL.");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDbUrl(),
  },
});
