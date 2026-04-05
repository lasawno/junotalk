const OFFLINE_LIMIT_MS = 3 * 60 * 1000; // 3 minutes
const SESSION_EXPIRY_MS = 10 * 60 * 1000; // clean up sessions idle > 10 min

interface OfflineSession {
  startedAt: number;
  lastHitAt: number;
}

class OfflineSessionTracker {
  private sessions = new Map<string, OfflineSession>();

  private cleanup() {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastHitAt > SESSION_EXPIRY_MS) {
        this.sessions.delete(userId);
      }
    }
  }

  markAiSuccess(userId: string): void {
    this.sessions.delete(userId);
  }

  markCacheFallback(userId: string): { allowed: boolean; remainingMs: number; elapsedMs: number } {
    const now = Date.now();
    let session = this.sessions.get(userId);

    if (!session) {
      session = { startedAt: now, lastHitAt: now };
      this.sessions.set(userId, session);
    }

    session.lastHitAt = now;
    const elapsedMs = now - session.startedAt;
    const remainingMs = Math.max(0, OFFLINE_LIMIT_MS - elapsedMs);
    const allowed = elapsedMs < OFFLINE_LIMIT_MS;

    if (Math.random() < 0.05) this.cleanup();

    return { allowed, remainingMs, elapsedMs };
  }

  getStatus(userId: string): { active: boolean; remainingMs: number; elapsedMs: number } {
    const session = this.sessions.get(userId);
    if (!session) return { active: false, remainingMs: OFFLINE_LIMIT_MS, elapsedMs: 0 };
    const elapsedMs = Date.now() - session.startedAt;
    return {
      active: true,
      remainingMs: Math.max(0, OFFLINE_LIMIT_MS - elapsedMs),
      elapsedMs,
    };
  }
}

export const offlineTracker = new OfflineSessionTracker();
export { OFFLINE_LIMIT_MS };
