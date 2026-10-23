import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { env } from "@/env";
import type { MemberRole } from "@/generated/prisma/client";
import { can, canChangeRole, canManageMember } from "@/lib/permissions";
import {
  INVITES_PER_DAY,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  type RoleLabel,
  type TeamOverview,
  formatInviteExpiry,
  formatLastActive,
  formatSentAt,
  initialsOf,
  inviteErrors,
  invitePath,
  parseInviteEmails,
  roleFromLabel,
  roleLabel,
} from "@/lib/team";
import { resolveActiveMembership } from "@/server/auth/workspace";
import { type DbClient, db } from "@/server/db";
import { inviteTemplate } from "@/server/email/templates";
import { appLink } from "@/server/email/templates/notifications";
import { sendEmailAfter } from "@/server/email/resend";
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  rateLimited,
  validationFailed,
} from "@/server/errors";
import * as invites from "@/server/repositories/invite.repository";
import * as memberships from "@/server/repositories/membership.repository";
import * as workspaces from "@/server/repositories/workspace.repository";
import { parseOrThrow } from "@/server/validate";

/**
 * Team members and invitations (spec §5.4).
 *
 * Every function that acts for a signed-in user takes `actorUserId` first. The record's workspace
 * is always derived from the record (or from the actor's active workspace) — never from a form —
 * and the actor's membership there decides existence: a non-member gets NOT_FOUND, a member without
 * the role gets FORBIDDEN. The repository writes repeat the role rule in their own `where` clause.
 *
 * Invite tokens are 32 random bytes; only their SHA-256 is stored.
 */

// --- Tokens ----------------------------------------------------------------------------------

const TOKEN_BYTES = 32;

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

/** SHA-256 hex of a raw invite token — what `workspace_invites.tokenHash` holds. */
export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Shape check before any database read: a base64url string of the right length. */
function plausibleToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

// --- Read model ------------------------------------------------------------------------------

/**
 * The Team tab for the actor's workspace — `workspaceId` when given (pass the session's), else the
 * actor's active one. NOT_FOUND when the actor is not a member of it.
 */
export async function getTeamOverview(
  actorUserId: string,
  workspaceId?: string,
  /** The viewer's zone (`readViewerTimeZone`) for "Today, 9:12 AM" style labels. */
  timeZone = "UTC",
): Promise<TeamOverview> {
  const targetId = workspaceId ?? (await activeWorkspaceId(actorUserId));
  const workspace = await workspaces.findWorkspaceForMember(targetId, actorUserId);
  if (!workspace) throw notFound();

  const [members, pending] = await Promise.all([
    memberships.listMembers(workspace.id, actorUserId),
    invites.listPendingInvites(workspace.id, actorUserId),
  ]);

  const now = new Date();
  const manageTeam = can(workspace.role, "team.manage");

  const rows = members.map((m) => {
    const name = m.user.name?.trim() || m.user.email;
    const isYou = m.userId === actorUserId;
    return {
      id: m.id,
      userId: m.userId,
      name,
      email: m.user.email,
      initials: initialsOf(name),
      role: roleLabel(m.role),
      lastActive: formatLastActive(m.lastActiveAt, now, timeZone),
      isYou,
      isOwner: m.role === "OWNER",
      manageable: canManageMember(workspace.role, m.role, { isSelf: isYou }),
    };
  });
  // The Owner first, then everyone in the order they joined.
  rows.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    projectCount: workspace.projectCount,
    actorRole: roleLabel(workspace.role),
    capabilities: { manageTeam },
    members: rows,
    invites: pending.map((i) => ({
      id: i.id,
      email: i.email,
      role: roleLabel(i.role) as Exclude<RoleLabel, "Owner">,
      invitedBy: i.invitedBy ? i.invitedBy.name?.trim() || i.invitedBy.email : "a former member",
      sentAt: formatSentAt(i.sentAt, timeZone),
      expiresAt: formatInviteExpiry(i.expiresAt, now),
      expired: i.expiresAt.getTime() <= now.getTime(),
    })),
  };
}

async function activeWorkspaceId(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, currentWorkspaceId: true },
  });
  if (!user) throw notFound();
  return (await resolveActiveMembership(user)).workspaceId;
}

// --- Invitations -----------------------------------------------------------------------------

const inviteInput = z.object({
  emails: z.string().max(5000, "That’s too much text."),
  role: z.enum(["Admin", "Editor", "Viewer"], "Choose a role.").default("Editor"),
});

/** Throws NOT_FOUND for a non-member and FORBIDDEN for a member who may not manage the team. */
async function requireTeamManager(workspaceId: string, actorUserId: string) {
  const workspace = await workspaces.findWorkspaceForMember(workspaceId, actorUserId);
  if (!workspace) throw notFound();
  if (!can(workspace.role, "team.manage")) throw forbidden();
  return workspace;
}

/**
 * An inviter must have a proven address, so Routely's invite email cannot be sent from an
 * unverified account. A Google sign-in counts — Google has verified the address — which covers
 * accounts created before `emailVerified` was recorded for Google sign-ups.
 */
async function requireVerifiedInviter(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      _count: { select: { accounts: { where: { provider: "google" } } } },
    },
  });
  if (!user) throw notFound();
  if (!user.emailVerified && user._count.accounts === 0) {
    throw forbidden("Verify your email address before inviting teammates.");
  }
  return user;
}

export interface InviteResult {
  emails: string[];
}

/**
 * Invites up to 10 addresses to `workspaceId` (the actor's active workspace) as Admin, Editor or
 * Viewer. Addresses already on the team, or holding a live invite, are refused with the design's
 * messages; an *expired* pending invite is replaced. One email per address, after the response.
 */
export async function inviteMembers(
  actorUserId: string,
  workspaceId: string,
  input: unknown,
): Promise<InviteResult> {
  const parsed = parseOrThrow(inviteInput, input);
  const workspace = await requireTeamManager(workspaceId, actorUserId);
  const inviter = await requireVerifiedInviter(actorUserId);
  const role = roleFromLabel(parsed.role)!;
  const list = parseInviteEmails(parsed.emails);

  const now = new Date();
  const [members, pending] = await Promise.all([
    memberships.memberEmails(workspace.id),
    list.length ? invites.findPendingByEmails(workspace.id, list) : Promise.resolve([]),
  ]);
  const live = pending.filter((p) => p.expiresAt.getTime() > now.getTime());
  const expired = pending.filter((p) => p.expiresAt.getTime() <= now.getTime());

  const errors = inviteErrors(
    parsed.emails,
    members,
    live.map((p) => p.email),
  );
  if (errors.length) {
    throw validationFailed(errors[0]!, { emails: errors });
  }

  const sentToday = await invites.countSentSince(
    workspace.id,
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  );
  if (sentToday + list.length > INVITES_PER_DAY) {
    throw rateLimited(
      `You can send up to ${INVITES_PER_DAY} invites a day. Try again tomorrow, or resend an existing invite later.`,
    );
  }

  const tokens = list.map((email) => ({ email, ...newToken() }));
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  try {
    await db.$transaction(async (tx) => {
      await invites.revokePendingByIds(
        workspace.id,
        expired.map((p) => p.id),
        tx,
      );
      await invites.createInvites(
        workspace.id,
        actorUserId,
        tokens.map((t) => ({ email: t.email, role, tokenHash: t.hash, expiresAt })),
        tx,
      );
    });
  } catch (error) {
    // The partial unique index: another request invited one of these addresses in between.
    if (isUniqueViolation(error)) {
      throw validationFailed("Someone just invited one of these addresses. Refresh and try again.");
    }
    throw error;
  }

  for (const t of tokens) {
    sendInviteEmail(t.email, t.raw, {
      inviterName: inviter.name?.trim() || inviter.email,
      workspaceName: workspace.name,
      roleLabel: roleLabel(role),
    });
  }

  return { emails: list };
}

function sendInviteEmail(
  to: string,
  rawToken: string,
  input: { inviterName: string; workspaceName: string; roleLabel: string },
) {
  const email = inviteTemplate({
    ...input,
    inviteUrl: appLink(env.NEXT_PUBLIC_APP_URL, invitePath(rawToken)),
    expiresInDays: INVITE_TTL_DAYS,
  });
  sendEmailAfter({ to, ...email });
}

/** Re-sends with a new link (the old one stops working) and a fresh 7-day expiry. */
export async function resendInvite(
  actorUserId: string,
  inviteId: string,
): Promise<{ email: string }> {
  const id = parseOrThrow(z.string().min(1).max(64), inviteId);
  const invite = await invites.findPendingInviteForActor(id, actorUserId);
  if (!invite) throw notFound("That invite no longer exists.");
  if (!can(invite.actorRole, "team.manage")) throw forbidden();
  const inviter = await requireVerifiedInviter(actorUserId);

  const now = new Date();
  // One click is enough; a burst of resends to one inbox is not.
  if (now.getTime() - invite.sentAt.getTime() < 60_000) {
    throw rateLimited("That invite was just sent. Wait a minute before sending it again.");
  }
  const sentToday = await invites.countSentSince(
    invite.workspaceId,
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  );
  if (sentToday + 1 > INVITES_PER_DAY) {
    throw rateLimited(`You can send up to ${INVITES_PER_DAY} invites a day. Try again tomorrow.`);
  }

  const token = newToken();
  const ok = await invites.rotateInvite(id, actorUserId, ["OWNER", "ADMIN"], {
    tokenHash: token.hash,
    sentAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });
  if (!ok) throw notFound("That invite no longer exists.");

  sendInviteEmail(invite.email, token.raw, {
    inviterName: inviter.name?.trim() || inviter.email,
    workspaceName: invite.workspaceName,
    roleLabel: roleLabel(invite.role),
  });
  return { email: invite.email };
}

export async function revokeInvite(
  actorUserId: string,
  inviteId: string,
): Promise<{ email: string }> {
  const id = parseOrThrow(z.string().min(1).max(64), inviteId);
  const invite = await invites.findPendingInviteForActor(id, actorUserId);
  if (!invite) throw notFound("That invite no longer exists.");
  if (!can(invite.actorRole, "team.manage")) throw forbidden();

  const ok = await invites.revokeInvite(id, actorUserId, ["OWNER", "ADMIN"]);
  if (!ok) throw notFound("That invite no longer exists.");
  return { email: invite.email };
}

// --- Members ---------------------------------------------------------------------------------

const MANAGERS: MemberRole[] = ["OWNER", "ADMIN"];

export async function changeMemberRole(
  actorUserId: string,
  membershipId: string,
  roleInput: unknown,
): Promise<{ name: string; role: RoleLabel }> {
  const { id, role: label } = parseOrThrow(
    z.object({
      id: z.string().min(1).max(64),
      role: z.enum(["Admin", "Editor", "Viewer"], "Choose a role."),
    }),
    { id: membershipId, role: roleInput },
  );
  const role = roleFromLabel(label)!;

  const target = await memberships.findMembershipForActor(id, actorUserId);
  if (!target) throw notFound("That member is no longer on the team.");
  const isSelf = target.userId === actorUserId;
  if (!can(target.actorRole, "team.manage")) throw forbidden();
  if (!canChangeRole(target.actorRole, target.role, role, { isSelf })) {
    throw forbidden(
      target.role === "OWNER"
        ? "The Owner’s role can’t be changed."
        : "You can’t change your own role.",
    );
  }

  const name = target.user.name?.trim() || target.user.email;
  if (target.role === role) return { name, role: label };

  const ok = await memberships.updateMemberRole(id, actorUserId, role, MANAGERS);
  if (!ok) throw notFound("That member is no longer on the team.");
  return { name, role: label };
}

/**
 * Removes a member: deletes the membership only. The user keeps their account, sessions and own
 * workspace; if this was their current workspace, the session seam moves them to their oldest
 * remaining membership on their next request (it re-checks membership every time).
 */
export async function removeMember(
  actorUserId: string,
  membershipId: string,
): Promise<{ name: string; workspaceName: string }> {
  const id = parseOrThrow(z.string().min(1).max(64), membershipId);
  const target = await memberships.findMembershipForActor(id, actorUserId);
  if (!target) throw notFound("That member is no longer on the team.");
  const isSelf = target.userId === actorUserId;
  if (!can(target.actorRole, "team.manage")) throw forbidden();
  if (!canManageMember(target.actorRole, target.role, { isSelf })) {
    throw forbidden(
      target.role === "OWNER" ? "The Owner can’t be removed." : "You can’t remove yourself.",
    );
  }

  const ok = await memberships.deleteMember(id, actorUserId, MANAGERS);
  if (!ok) throw notFound("That member is no longer on the team.");

  // Point them back at a workspace they still belong to now, rather than on their next request.
  await db.user.updateMany({
    where: { id: target.userId, currentWorkspaceId: target.workspaceId },
    data: { currentWorkspaceId: null },
  });

  return {
    name: target.user.name?.trim() || target.user.email,
    workspaceName: target.workspace.name,
  };
}

// --- Accepting -------------------------------------------------------------------------------

export type InviteStatus = "pending" | "expired" | "revoked" | "accepted";

export interface InviteLookup {
  id: string;
  status: InviteStatus;
  email: string;
  role: RoleLabel;
  workspaceId: string;
  workspaceName: string;
  inviterName: string | null;
  expiresAt: Date;
  acceptedById: string | null;
}

/** Any invite by raw token, with its state — for the `/invite/[token]` page. Null when unknown. */
export async function lookupInvite(rawToken: string): Promise<InviteLookup | null> {
  if (!plausibleToken(rawToken)) return null;
  const row = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      acceptedById: true,
      revokedAt: true,
      workspace: { select: { id: true, name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;
  const status: InviteStatus = row.acceptedAt
    ? "accepted"
    : row.revokedAt
      ? "revoked"
      : row.expiresAt.getTime() <= Date.now()
        ? "expired"
        : "pending";
  return {
    id: row.id,
    status,
    email: row.email,
    role: roleLabel(row.role),
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    inviterName: row.invitedBy ? row.invitedBy.name?.trim() || row.invitedBy.email : null,
    expiresAt: row.expiresAt,
    acceptedById: row.acceptedById,
  };
}

/**
 * A usable invite — pending and unexpired — by raw token, or null. What sign-up checks before
 * creating a user without a personal workspace: when this returns an invite whose `email` equals
 * the address being registered, create the user and then call `acceptInvite`.
 */
export async function findPendingInvite(rawToken: string): Promise<InviteLookup | null> {
  const invite = await lookupInvite(rawToken);
  return invite?.status === "pending" ? invite : null;
}

/**
 * Accepts an invite for `userId`, whose email must be the invited address (the token proves inbox
 * control only together with that). Creates the membership with the invited role — an existing
 * membership keeps its role — marks the invite accepted, records the address as verified, and makes
 * the workspace current. Exactly one concurrent accept wins.
 *
 * Accepting an invite the same user already accepted is a no-op that returns the workspace, so a
 * double-submit or a reload after accepting lands in the right place.
 */
export async function acceptInvite(
  userId: string,
  rawToken: string,
  client?: DbClient,
): Promise<{ workspaceId: string; workspaceName: string }> {
  const invite = await lookupInvite(String(rawToken ?? ""));
  if (!invite) throw notFound("This invite link isn’t valid.");

  const run = async (tx: DbClient) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!user) throw notFound();

    if (invite.status === "accepted") {
      if (invite.acceptedById === userId) {
        await tx.user.update({
          where: { id: userId },
          data: { currentWorkspaceId: invite.workspaceId },
        });
        return { workspaceId: invite.workspaceId, workspaceName: invite.workspaceName };
      }
      throw conflict("This invite has already been used.");
    }
    if (invite.status === "revoked") throw conflict("This invite was revoked.");
    if (invite.status === "expired") throw conflict("This invite has expired.");
    if (user.email.toLowerCase() !== invite.email) {
      throw new AppError("FORBIDDEN", `This invite was sent to ${invite.email}.`);
    }

    const now = new Date();
    if (!(await invites.markAccepted(invite.id, userId, now, tx))) {
      throw conflict("This invite is no longer valid.");
    }
    const role = roleFromLabel(invite.role) ?? "VIEWER";
    await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
      create: { workspaceId: invite.workspaceId, userId, role, lastActiveAt: now },
      update: {},
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        currentWorkspaceId: invite.workspaceId,
        ...(user.emailVerified ? {} : { emailVerified: now }),
      },
    });
    return { workspaceId: invite.workspaceId, workspaceName: invite.workspaceName };
  };

  return client ? run(client) : db.$transaction(run);
}

// --- Workspace switcher ----------------------------------------------------------------------

export function listMyWorkspaces(actorUserId: string) {
  return workspaces.listWorkspacesForUser(actorUserId);
}

/** Makes `workspaceId` current. NOT_FOUND unless the actor is a member of it. */
export async function switchWorkspace(actorUserId: string, workspaceId: unknown): Promise<void> {
  const id = parseOrThrow(z.string().min(1).max(64), workspaceId);
  if (!(await workspaces.setCurrentWorkspace(actorUserId, id))) throw notFound();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
