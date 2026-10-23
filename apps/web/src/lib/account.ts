/**
 * Settings → Profile & security and Notifications: the data the screen renders, and the pure
 * formatting rules behind it. No server imports — the server page builds a `AccountSettings`
 * and the client view renders it.
 */

import { formatMonthDayYear, relativeTime } from "@/lib/experiment-time";
import type { DeviceKind } from "@/lib/user-agent";

export type RoleName = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export const ROLE_LABEL: Record<RoleName, "Owner" | "Admin" | "Editor" | "Viewer"> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

export interface AccountSession {
  /** `sessions.id` — never the token. */
  id: string;
  device: string;
  kind: DeviceKind;
  /** "Portland, US", or null when the platform gave no location. */
  where: string | null;
  /** "Active now" / "2 hours ago" / "Oct 9, 2026". */
  when: string;
  current: boolean;
}

export interface AccountNotification {
  /** `NotificationKind`. */
  id: string;
  title: string;
  desc: string;
  on: boolean;
}

export interface AccountSettings {
  name: string;
  email: string;
  roleLabel: string;
  workspaceName: string;
  /** The address awaiting confirmation, if an email change is pending. */
  pendingEmail: string | null;
  hasPassword: boolean;
  /** "Last changed Aug 2, 2026." — or the set-a-password copy for a Google-only account. */
  passwordNote: string;
  sessions: AccountSession[];
  notifications: AccountNotification[];
}

const ACTIVE_NOW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Active now" within 5 minutes; "N minutes/hours ago" within a day; otherwise the date. */
export function sessionWhen(lastSeenAt: Date, now: Date, current: boolean): string {
  if (current) return "Active now";
  const age = now.getTime() - lastSeenAt.getTime();
  if (age < ACTIVE_NOW_MS) return "Active now";
  if (age < DAY_MS) return relativeTime(lastSeenAt, now, "long");
  return formatMonthDayYear(lastSeenAt);
}

/** "Portland, US", "US", or null. */
export function sessionWhere(city: string | null, country: string | null): string | null {
  if (city && country) return `${city}, ${country}`;
  return city || country || null;
}

export const SET_PASSWORD_NOTE =
  "You sign in with Google. Add a password to also sign in with your email.";

export function passwordNote(hasPassword: boolean, changedAt: Date | null, now: Date): string {
  if (!hasPassword) return SET_PASSWORD_NOTE;
  if (!changedAt) return "";
  if (now.getTime() - changedAt.getTime() < 60_000) return "Last changed just now.";
  return `Last changed ${formatMonthDayYear(changedAt)}.`;
}

/** Initials from a display name: first letter of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    (words[0] ?? "").charAt(0) + (words.length > 1 ? (words[words.length - 1] ?? "").charAt(0) : "")
  ).toUpperCase();
}
