/**
 * Team members and invitations — the read model the Settings → Team tab renders, and the pure rules
 * both the invite dialog and `team.service.ts` apply.
 *
 * Pure and dependency-free (no "use client", no server imports), so the client dialog can validate
 * as the user types with exactly the messages the server would return, and a server page can
 * import the types. Validation on the client is a convenience; the service re-runs it against the
 * database, which is the only check that counts.
 */

import { type MemberRole } from "@/lib/permissions";

// --- Read model ------------------------------------------------------------------------------

/** The design's role labels. */
export type RoleLabel = "Owner" | "Admin" | "Editor" | "Viewer";
export type AssignableRoleLabel = Exclude<RoleLabel, "Owner">;

export interface TeamMember {
  /** The membership id — what role changes and removals address. */
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  role: RoleLabel;
  /** "Active now" / "Today, 9:12 AM" / "Yesterday, 4:40 PM" / "Oct 8, 2026" / "—". */
  lastActive: string;
  isYou: boolean;
  isOwner: boolean;
  /** Whether the actor may change this member's role or remove them. */
  manageable: boolean;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: AssignableRoleLabel;
  /** The inviter's display name, "a former member" when they have since left. */
  invitedBy: string;
  /** "Oct 11" — when the current link was sent. */
  sentAt: string;
  /** "Expires in 5 days" / "Expires today" / "Expired". */
  expiresAt: string;
  expired: boolean;
}

export interface TeamCapabilities {
  /** Invite, resend, revoke, change roles and remove members. */
  manageTeam: boolean;
}

export interface TeamOverview {
  workspaceId: string;
  workspaceName: string;
  /** The workspace's project count, for "will lose access to all {N} projects". */
  projectCount: number;
  actorRole: RoleLabel;
  capabilities: TeamCapabilities;
  /** Owner first, then by join date. */
  members: TeamMember[];
  /** Unrevoked, unaccepted invites — expired ones included, labelled "Expired". */
  invites: TeamInvite[];
}

// --- Roles -----------------------------------------------------------------------------------

const LABEL: Record<MemberRole, RoleLabel> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

export function roleLabel(role: MemberRole): RoleLabel {
  return LABEL[role];
}

/** "Admin" → "ADMIN"; never yields OWNER, so an assignable label cannot grant ownership. */
export function roleFromLabel(label: string): Exclude<MemberRole, "OWNER"> | null {
  if (label === "Admin") return "ADMIN";
  if (label === "Editor") return "EDITOR";
  if (label === "Viewer") return "VIEWER";
  return null;
}

/** The roles an invite or a role change can grant, with the design's descriptions. */
export const ASSIGNABLE_ROLES: readonly { label: AssignableRoleLabel; desc: string }[] = [
  {
    label: "Admin",
    desc: "Manages projects, team members and integrations, plus everything Editors can do.",
  },
  { label: "Editor", desc: "Creates, edits, launches and pauses experiments." },
  { label: "Viewer", desc: "Sees experiments and results but can’t change anything." },
];

/** All four roles, for "What each role can do". */
export const ROLE_DESCRIPTIONS: readonly { label: RoleLabel; desc: string }[] = [
  {
    label: "Owner",
    desc: "Everything Admins can do. There’s one owner, and they can’t be removed.",
  },
  ...ASSIGNABLE_ROLES,
];

/** "an Admin" / "a Viewer". */
export function withArticle(role: string): string {
  return /^[AEIOU]/.test(role) ? `an ${role}` : `a ${role}`;
}

// --- Invitations -----------------------------------------------------------------------------

/** How long an invite link stays valid. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Most addresses one invite submission accepts. */
export const INVITE_BATCH_MAX = 10;
/** Invites one workspace may send (new + resent) per rolling 24 hours — stops email abuse. */
export const INVITES_PER_DAY = 50;

/** The design's address rule, shared with the profile form. */
export function validEmail(email: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(String(email || "").trim());
}

/** Splits on commas, semicolons and whitespace; lower-cased and de-duplicated. */
export function parseInviteEmails(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => {
      if (!x || seen.has(x)) return false;
      seen.add(x);
      return true;
    });
}

/**
 * The invite dialog's messages, verbatim from the design, in the design's order. Empty when the
 * submission is acceptable.
 *
 * `memberEmails` and `pendingEmails` are lower-cased. Only *live* invites count as pending: an
 * expired one is replaced by a new invite instead of blocking it.
 */
export function inviteErrors(
  raw: string,
  memberEmails: readonly string[],
  pendingEmails: readonly string[],
): string[] {
  const list = parseInviteEmails(raw);
  if (!list.length) return ["Enter at least one email address."];
  const out: string[] = [];
  const bad = list.filter((x) => !validEmail(x));
  if (bad.length)
    out.push(
      `${bad.length === 1 ? "Check this address: " : "Check these addresses: "}${bad.join(", ")}`,
    );
  if (list.length > INVITE_BATCH_MAX)
    out.push(`You can invite up to ${INVITE_BATCH_MAX} people at a time.`);
  const members = new Set(memberEmails);
  const onTeam = list.filter((x) => members.has(x));
  if (onTeam.length)
    out.push(
      onTeam.length === 1
        ? `${onTeam[0]} is already on the team.`
        : `Already on the team: ${onTeam.join(", ")}`,
    );
  const pending = new Set(pendingEmails);
  const invited = list.filter((x) => pending.has(x));
  if (invited.length)
    out.push(
      invited.length === 1
        ? `${invited[0]} already has a pending invite.`
        : `Already invited: ${invited.join(", ")}`,
    );
  return out;
}

// --- Labels ----------------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** "Active now" covers the last five minutes — the same window the activity write is throttled to. */
export const ACTIVE_NOW_MS = 5 * MINUTE_MS;

/** "AM" for "Alex Morgan", "A" for "alex". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    (words[0] ?? "").charAt(0) + (words.length > 1 ? (words[words.length - 1] ?? "").charAt(0) : "")
  ).toUpperCase();
}

function fmt(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(value);
}

function dayKey(value: Date, timeZone: string): string {
  return fmt(value, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * The Team tab's "Last active": "Active now" (≤ 5 min), "Today, 9:12 AM", "Yesterday, 4:40 PM",
 * else "Oct 8, 2026". "—" for someone who has never been active since joining.
 */
export function formatLastActive(at: Date | null, now: Date, timeZone = "UTC"): string {
  if (!at) return "—";
  if (now.getTime() - at.getTime() <= ACTIVE_NOW_MS) return "Active now";
  const time = fmt(at, timeZone, { hour: "numeric", minute: "2-digit", hour12: true });
  if (dayKey(at, timeZone) === dayKey(now, timeZone)) return `Today, ${time}`;
  if (dayKey(at, timeZone) === dayKey(new Date(now.getTime() - DAY_MS), timeZone))
    return `Yesterday, ${time}`;
  return fmt(at, timeZone, { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 11". */
export function formatSentAt(at: Date, timeZone = "UTC"): string {
  return fmt(at, timeZone, { month: "short", day: "numeric" });
}

/** "Expires in N days" with N = ceil((expiresAt − now) / 1 day); "Expired" once past. */
export function formatInviteExpiry(expiresAt: Date, now: Date): string {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return "Expired";
  const days = Math.ceil(left / DAY_MS);
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

/** Path of an invite's accept page. */
export function invitePath(rawToken: string): string {
  return `/invite/${encodeURIComponent(rawToken)}`;
}
