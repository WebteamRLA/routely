/**
 * Notification kinds, their defaults, and who may receive each one (spec §5.5).
 *
 * Pure — no database, no `env` — so the recipient rules are unit-testable and the Settings
 * screen can read the same titles and defaults the sender uses. The string unions mirror the
 * Prisma enums `NotificationKind` and `MemberRole`; `notification.service.ts` checks at compile
 * time that they still match.
 */

export const NOTIFICATION_KINDS = [
  "RESULT_READY",
  "TRACKING_STOPPED",
  "SHEETS_SYNC_FAILED",
  "EXPERIMENT_PAUSED",
] as const;
export type NotificationKindName = (typeof NOTIFICATION_KINDS)[number];

/** Most to least privileged. */
export const MEMBER_ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type MemberRoleName = (typeof MEMBER_ROLES)[number];

export interface NotificationSetting {
  title: string;
  description: string;
  /** What a missing `NotificationPreference` row means. No backfill is needed for a new kind. */
  defaultEnabled: boolean;
  /** The least-privileged role that may receive it at all, whatever their preference says. */
  minRole: MemberRoleName;
}

export const NOTIFICATION_SETTINGS: Record<NotificationKindName, NotificationSetting> = {
  RESULT_READY: {
    title: "A result is ready",
    description: "An experiment has enough data for Routely to suggest a winner.",
    defaultEnabled: true,
    minRole: "VIEWER",
  },
  TRACKING_STOPPED: {
    title: "Tracking stops",
    description: "Routely hasn’t received any events from a project’s site for 24 hours.",
    defaultEnabled: true,
    minRole: "VIEWER",
  },
  SHEETS_SYNC_FAILED: {
    title: "Google Sheets sync fails",
    description: "Routely can’t write to a project’s linked spreadsheet.",
    defaultEnabled: true,
    // Only an Owner or Admin can reconnect Google or re-pick the spreadsheet (spec §1.2), so
    // telling anyone else would be an alert they cannot act on.
    minRole: "ADMIN",
  },
  EXPERIMENT_PAUSED: {
    title: "An experiment is paused",
    description: "Someone on your team pauses a running experiment.",
    defaultEnabled: false,
    minRole: "VIEWER",
  },
};

/** True when `role` is `min` or more privileged. */
export function isRoleAtLeast(role: MemberRoleName, min: MemberRoleName): boolean {
  return MEMBER_ROLES.indexOf(role) <= MEMBER_ROLES.indexOf(min);
}

/** The stricter of two role floors. */
function stricter(a: MemberRoleName, b: MemberRoleName): MemberRoleName {
  return MEMBER_ROLES.indexOf(a) <= MEMBER_ROLES.indexOf(b) ? a : b;
}

/** One workspace member as the resolver sees them. */
export interface RecipientCandidate {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRoleName;
  emailVerified: Date | null;
  disabledAt: Date | null;
  /** The stored preference for this kind, or null when the member never touched it. */
  preference: boolean | null;
}

export interface RecipientOptions {
  /** Leave this user out — the person who caused the event (e.g. the one who paused). */
  excludeUserId?: string;
  /** Raise the role floor for this send. It can only tighten the kind's own floor. */
  minRole?: MemberRoleName;
}

/**
 * Who gets a notification of `kind`, out of a workspace's members.
 *
 * A member receives it when all of these hold:
 * - their preference is on — the stored row if there is one, otherwise the kind's default;
 * - their role meets the kind's floor and any stricter floor the caller asked for;
 * - they are not the excluded actor;
 * - their account is not disabled;
 * - their email address is verified. An unverified address may be a typo that belongs to
 *   somebody else, and these emails name the workspace's projects and experiments.
 *
 * Duplicate addresses collapse to one email.
 */
export function resolveRecipients(
  kind: NotificationKindName,
  candidates: readonly RecipientCandidate[],
  options: RecipientOptions = {},
): RecipientCandidate[] {
  const setting = NOTIFICATION_SETTINGS[kind];
  const floor = options.minRole ? stricter(setting.minRole, options.minRole) : setting.minRole;
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const enabled = candidate.preference ?? setting.defaultEnabled;
    if (!enabled) return false;
    if (!isRoleAtLeast(candidate.role, floor)) return false;
    if (options.excludeUserId && candidate.userId === options.excludeUserId) return false;
    if (candidate.disabledAt) return false;
    if (!candidate.emailVerified) return false;

    const address = candidate.email.trim().toLowerCase();
    if (!address || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}
