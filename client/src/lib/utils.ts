import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const GENERIC_NAMES = new Set(["user", "guest", "anonymous", "unknown"]);

export function isGenericName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return GENERIC_NAMES.has(name.trim().toLowerCase());
}

export function isEmailAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.includes("@");
}

export function safeDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  username?: string | null,
  fallback = "Guest"
): string {
  if (firstName && !isGenericName(firstName) && !isEmailAddress(firstName)) {
    return firstName.trim();
  }
  if (lastName && !isGenericName(lastName) && !isEmailAddress(lastName)) {
    return lastName.trim();
  }
  if (username && !isGenericName(username) && !isEmailAddress(username)) {
    return username.trim();
  }
  const emailSource = [firstName, lastName, username].find(v => isEmailAddress(v));
  if (emailSource) {
    return emailSource.charAt(0).toUpperCase();
  }
  return fallback;
}

export function formatUsername(username?: string | null, usernameCode?: string | null): string | null {
  if (!username) return null;
  return username;
}

export function safeInitials(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const validFirst = firstName && !isGenericName(firstName) && !isEmailAddress(firstName) ? firstName.trim() : null;
  const validLast = lastName && !isGenericName(lastName) && !isEmailAddress(lastName) ? lastName.trim() : null;
  if (validFirst || validLast) {
    return ((validFirst?.charAt(0) || "") + (validLast?.charAt(0) || "")).toUpperCase() || "?";
  }
  const emailSource = [firstName, lastName].find(v => isEmailAddress(v));
  if (emailSource) {
    return emailSource.charAt(0).toUpperCase();
  }
  return "?";
}
