import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";

let prefetchedPromise: Promise<User | null> | null = null;
let cachedUser: User | null = null;
let nullReturnCount = 0;
let NULL_TOLERANCE = 8; // overridden at runtime by /api/v1/auth/policy

// ─── Remote auth policy ───────────────────────────────────────────────────────
// Fetched once at module load from the GitHub-CDN-backed endpoint.
// Allows tuning stability thresholds without a code deploy.

export interface AuthPolicy {
  null_tolerance: number;
  visibility_logout_enabled: boolean;
  visibility_logout_delay_ms: number;
  auth_refetch_interval_ms: number;
}

const DEFAULT_POLICY: AuthPolicy = {
  null_tolerance: 8,
  visibility_logout_enabled: false,
  visibility_logout_delay_ms: 1_800_000,
  auth_refetch_interval_ms: 600_000,
};

let _authPolicy: AuthPolicy = { ...DEFAULT_POLICY };

async function loadAuthPolicy(): Promise<void> {
  try {
    const res = await fetch("/api/v1/auth/policy");
    if (res.ok) {
      const data: AuthPolicy = await res.json();
      _authPolicy = { ...DEFAULT_POLICY, ...data };
      NULL_TOLERANCE = _authPolicy.null_tolerance;
    }
  } catch {
    // keep defaults — no network at startup is fine
  }
}

// Fire-and-forget — result applied before first refetch cycle
loadAuthPolicy();

export function getAuthPolicy(): AuthPolicy {
  return _authPolicy;
}

// ─── User prefetch ─────────────────────────────────────────────────────────────

function prefetchUser(): Promise<User | null> {
  if (!prefetchedPromise) {
    prefetchedPromise = fetch("/api/auth/user", { credentials: "include" })
      .then(r => {
        if (r.ok) return r.json();
        if (r.status === 401) {
          cachedUser = null;
          nullReturnCount = 0;
          return null;
        }
        throw new Error(`Auth check failed: ${r.status}`);
      })
      .then((user: User | null) => {
        if (user) {
          cachedUser = user;
          nullReturnCount = 0;
        }
        return user;
      })
      .catch(() => {
        return cachedUser;
      });
  }
  return prefetchedPromise;
}

prefetchUser();

async function fetchUserFresh(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/user", { credentials: "include" });

    if (res.ok) {
      const user = await res.json();
      if (user) {
        cachedUser = user;
        nullReturnCount = 0;
        return user;
      }
      // Server returned 200 null (token refresh may have failed temporarily).
      // Only log the user out after consecutive null returns — not on the first one.
      nullReturnCount++;
      if (cachedUser && nullReturnCount < NULL_TOLERANCE) {
        console.warn(`[Auth] Server returned null (${nullReturnCount}/${NULL_TOLERANCE}). Keeping session alive.`);
        return cachedUser;
      }
      cachedUser = null;
      nullReturnCount = 0;
      return null;
    }

    if (res.status === 401) {
      cachedUser = null;
      nullReturnCount = 0;
      return null;
    }

    throw new Error(`Auth check failed: ${res.status}`);
  } catch {
    return cachedUser;
  }
}

async function logout(): Promise<void> {
  cachedUser = null;
  nullReturnCount = 0;
  try {
    // POST so the server responds with JSON after the session is fully destroyed
    // in the DB — only then do we navigate. This prevents a race where the page
    // reloads before the session row is gone and the auth check finds the user
    // still logged in.
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    // If the fetch itself fails (e.g. network error), proceed with navigation anyway
  }
  window.location.href = "/";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      if (prefetchedPromise) {
        const result = await prefetchedPromise;
        prefetchedPromise = null;
        if (result) cachedUser = result;
        return result;
      }
      return fetchUserFresh();
    },
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("401")) return false;
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 5000),
    staleTime: _authPolicy.auth_refetch_interval_ms,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev ?? undefined,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      prefetchedPromise = null;
      cachedUser = null;
      nullReturnCount = 0;
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
