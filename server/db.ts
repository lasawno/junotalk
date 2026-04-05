import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

export function resolveConnectionString(): string {
  const candidates = [
    process.env.SUPABASE_POOLER_URL,
    process.env.SUPABASE_DATABASE_URL,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    let cleaned = raw.trim();
    const pgIdx = cleaned.indexOf("postgresql://");
    if (pgIdx > 0) cleaned = cleaned.substring(pgIdx);
    const pg2Idx = cleaned.indexOf("postgres://");
    if (pg2Idx > 0) cleaned = cleaned.substring(pg2Idx);
    if (cleaned.startsWith("postgresql://") || cleaned.startsWith("postgres://")) {
      try {
        const parsed = new URL(cleaned);
        parsed.pathname = "/postgres";
        if (parsed.hostname.includes("pooler.supabase.com") && parsed.port === "5432") {
          parsed.port = "6543";
        }
        console.log("[DB] Using Supabase PostgreSQL");
        return parsed.toString();
      } catch {
        console.log("[DB] Using Supabase PostgreSQL (raw)");
        return cleaned;
      }
    }
  }

  const replitUrl = process.env.DATABASE_URL;
  if (replitUrl) {
    console.log("[DB] Using Replit PostgreSQL");
    return replitUrl;
  }

  throw new Error("No database connection string found. Set SUPABASE_POOLER_URL, SUPABASE_DATABASE_URL, or DATABASE_URL.");
}

const connectionString = resolveConnectionString();
const isSupabase = connectionString.includes("supabase.com");

const pool = new pg.Pool({
  connectionString,
  ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(pool, { schema });
