// Lightweight in-memory tracker for platform-wide activity.
// Call bumpPlatformActivity() whenever a meaningful event happens
// (new message, room update, call, contact added, etc.).
// The platform-activity endpoint uses this alongside the GitHub CDN check.

let lastActivityAt: number = 0;
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function bumpPlatformActivity(): void {
  lastActivityAt = Date.now();
}

export function isPlatformRecentlyActive(): boolean {
  if (!lastActivityAt) return false;
  return Date.now() - lastActivityAt < ACTIVE_WINDOW_MS;
}

export function getLastPlatformActivityTs(): number {
  return lastActivityAt;
}
