import type { Express } from "express";
import { authStorage } from "./storage";
import * as client from "openid-client";

const GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days

let _getOidcConfig: (() => Promise<client.Configuration>) | null = null;

async function getOidcConfig(): Promise<client.Configuration> {
  if (!_getOidcConfig) {
    const memoizee = (await import("memoizee")).default;
    _getOidcConfig = memoizee(
      async () => {
        return await client.discovery(
          new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
          process.env.REPL_ID!
        );
      },
      { maxAge: 3600 * 1000 }
    );
  }
  return _getOidcConfig();
}

function updateUserSession(user: any, tokens: client.TokenEndpointResponse) {
  user.claims = (tokens as any).claims?.();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
  delete user.token_expired_at;
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", async (req: any, res) => {
    // Never cache auth responses — stale 304s cause the frontend to show
    // the wrong auth state after session expiry or redeployment.
    // Strip conditional-GET headers so Express never computes req.fresh=true
    // and never short-circuits with a 304 (which would bypass our headers).
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    try {
      if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.claims?.sub) {
        return res.status(200).json(null);
      }

      const user = req.user as any;
      const now = Math.floor(Date.now() / 1000);

      if (user.expires_at && now > user.expires_at) {
        const refreshToken = user.refresh_token;
        let refreshSucceeded = false;

        if (refreshToken) {
          try {
            const config = await getOidcConfig();
            const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
            updateUserSession(user, tokenResponse);
            refreshSucceeded = true;
            req.session.save((err: any) => {
              if (err) console.error("[Auth] Session save after refresh failed:", err);
            });
          } catch (refreshError) {
            console.error("[Auth] Token refresh failed on /api/auth/user:", refreshError);
          }
        }

        if (!refreshSucceeded) {
          // Record when the token first failed so we can enforce the grace period
          if (!user.token_expired_at) {
            user.token_expired_at = now;
            req.session.save((err: any) => {
              if (err) console.error("[Auth] Session save after token_expired_at failed:", err);
            });
          }

          const expiredFor = now - (user.token_expired_at ?? now);
          if (expiredFor < GRACE_PERIOD_SECONDS) {
            console.log(`[Auth] Token expired/missing — within grace period (${Math.round(expiredFor / 3600)}h elapsed). Keeping session alive.`);
          } else {
            console.log("[Auth] Grace period exceeded. Requiring re-login.");
            return res.status(200).json(null);
          }
        }
      }

      const userId = user.claims.sub;
      const dbUser = await authStorage.getUser(userId);
      if (dbUser) {
        const { email, ...safeUser } = dbUser;
        res.json({ ...safeUser, emailLinked: !!email });
      } else {
        res.json(null);
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
