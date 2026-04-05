import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function toV1Url(url: string): string {
  if (url.startsWith("/api/v1/") || url.startsWith("/api/v2/")) return url;
  if (
    url.startsWith("/api/auth/") ||
    url.startsWith("/api/login") ||
    url.startsWith("/api/logout") ||
    url.startsWith("/api/callback") ||
    url.startsWith("/api/uploads/")
  ) return url;
  if (url.startsWith("/api/")) return "/api/v1/" + url.slice(5);
  return url;
}

let _reauthTimeout: ReturnType<typeof setTimeout> | null = null;

function handle401() {
  if (_reauthTimeout) return;
  // Wait 3 seconds before acting on a 401 — gives the token refresh grace period
  // time to respond and avoids false logouts from transient failures
  _reauthTimeout = setTimeout(() => {
    _reauthTimeout = null;
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  }, 3000);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) handle401();
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(toV1Url(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.startsWith("500:") || msg.startsWith("502:") || msg.startsWith("503:") || msg.startsWith("504:")) return true;
    if (msg === "Failed to fetch" || msg === "Load failed" || msg === "NetworkError when attempting to fetch resource.") return true;
  }
  return false;
}

type UnauthorizedBehavior = "returnNull" | "throw";
// Default timeout for all dashboard/API queries.
// Prevents the fetch from hanging forever when the server is cold-booting
// or under heavy startup load — after this window the query fails cleanly,
// isLoading becomes false, and the UI shows an empty/error state instead of
// an endless skeleton.
const QUERY_TIMEOUT_MS = 12_000;

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("Query timeout")), QUERY_TIMEOUT_MS);
    const res = await fetch(toV1Url(queryKey.join("/") as string), {
      credentials: "include",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") return null;
      handle401();
      throw new Error("401: Unauthorized");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 30 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false;
        return isRetryableError(error);
      },
      retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 8000),
      placeholderData: (prev: unknown) => prev ?? undefined,
      throwOnError: false,
    },
    mutations: {
      retry: false,
    },
  },
});
