import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { storage } from "../../storage";
import { resolveConnectionString } from "../../db";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 30 * 24 * 60 * 60; // 30 days in seconds
  const pgStore = connectPg(session);
  const dbUrl = resolveConnectionString();
  const isSupabase = dbUrl.includes("supabase.com");
  const pgConnConfig = isSupabase
    ? { conObject: { connectionString: dbUrl, ssl: { rejectUnauthorized: false } } }
    : { conString: dbUrl };
  const sessionStore = new pgStore({
    ...pgConnConfig,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: "lax",
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

function extractName(claims: any): { firstName: string | null; lastName: string | null } {
  const genericNames = new Set(["user", "guest", "anonymous", "unknown"]);
  
  const isValid = (name: string | undefined | null): name is string => {
    return !!name && !!name.trim() && !genericNames.has(name.trim().toLowerCase());
  };

  if (isValid(claims["first_name"])) {
    return { firstName: claims["first_name"], lastName: isValid(claims["last_name"]) ? claims["last_name"] : null };
  }

  const fullName = claims["name"];
  if (isValid(fullName)) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
    }
    return { firstName: parts[0], lastName: null };
  }

  if (isValid(claims["preferred_username"])) {
    return { firstName: claims["preferred_username"], lastName: null };
  }

  return { firstName: null, lastName: null };
}

async function upsertUser(claims: any) {
  const { firstName, lastName } = extractName(claims);
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName,
    lastName,
    profileImageUrl: claims["profile_image_url"] || claims["picture"] || null,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    const returnTo = req.query.returnTo as string | undefined;
    if (returnTo && req.session) {
      (req.session as any).returnTo = returnTo;
    }
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    const returnTo = (req.session as any)?.returnTo || "/";
    passport.authenticate(`replitauth:${req.hostname}`, {
      failureRedirect: "/api/login",
    })(req, res, async (err: any) => {
      if (!err && req.session) {
        delete (req.session as any).returnTo;
      }
      if (!err && req.user) {
        try {
          const securityEnabled = await storage.getFeatureFlag("security_monitoring");
          if (securityEnabled) {
            const user = req.user as any;
            const rawUa = (req.headers["user-agent"] || "").toString();
            const ua = rawUa.slice(0, 500);

            let deviceType = "Desktop";
            if (/mobile|android|iphone|ipad/i.test(ua)) deviceType = "Mobile";
            else if (/tablet/i.test(ua)) deviceType = "Tablet";

            let browser = "Unknown";
            if (/firefox/i.test(ua)) browser = "Firefox";
            else if (/edg/i.test(ua)) browser = "Edge";
            else if (/chrome/i.test(ua)) browser = "Chrome";
            else if (/safari/i.test(ua)) browser = "Safari";
            else if (/opera|opr/i.test(ua)) browser = "Opera";

            const rawIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
            const ipAddress = /^[\d.:a-fA-F]{1,45}$/.test(rawIp) ? rawIp : "invalid";

            const userId = user.claims?.sub || user.id;
            if (!userId || typeof userId !== "string") {
              console.warn("[SECURITY] Login activity skipped — no valid userId");
            } else {
              const rawUsername = user.claims?.username || user.username || null;
              const username = typeof rawUsername === "string" ? rawUsername.slice(0, 100) : null;

              await storage.logLoginActivity({
                userId: userId.slice(0, 100),
                username,
                ipAddress,
                userAgent: ua,
                deviceType,
                browser,
                country: null,
              });
              console.log(`[SECURITY] Login recorded: user=[internal], device=${deviceType}, browser=${browser}, ip=[private]`);
            }
          }
        } catch (e) {
          console.error("[SECURITY] Failed to log login activity:", e);
        }
      }
      if (!err) {
        return res.redirect(returnTo);
      }
      next(err);
    });
  });

  // Supports both GET (legacy redirect) and POST (preferred API call).
  // The POST variant lets the client wait for full session destruction before
  // navigating, which prevents the race where the auth check fires before the
  // DB delete has committed and the user appears still logged-in.
  const handleLogout = (req: any, res: any) => {
    const wantsJson = req.method === "POST" || (req.headers.accept || "").includes("application/json");

    const finish = (err?: Error) => {
      if (err) console.error("[Auth] Session destroy error:", err);
      res.clearCookie("connect.sid", { path: "/" });
      if (wantsJson) {
        res.json({ ok: true });
      } else {
        res.redirect("/");
      }
    };

    if (req.session) {
      req.session.destroy((err: Error) => finish(err));
    } else {
      finish();
    }
  };

  app.get("/api/logout", handleLogout);
  app.post("/api/logout", handleLogout);
}

const GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches /api/auth/user

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    delete user.token_expired_at;
    req.session.save((err) => {
      if (err) console.error("[Auth] Session save after refresh failed:", err);
    });
    return next();
  } catch (error) {
    console.error("[Auth] Token refresh failed:", error);

    if (!user.token_expired_at) {
      user.token_expired_at = now;
      req.session.save((err) => {
        if (err) console.error("[Auth] Session save after token_expired_at failed:", err);
      });
    }

    const expiredFor = now - (user.token_expired_at ?? now);
    if (expiredFor < GRACE_PERIOD_SECONDS) {
      console.log(`[Auth] Token refresh failed but within grace period (${Math.round(expiredFor / 60)}m elapsed). Allowing request.`);
      return next();
    }

    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
