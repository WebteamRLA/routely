import "server-only";

import type { MemberRole } from "@/generated/prisma/client";
import type { MemberRoleKey } from "@/lib/domain";
import type { MemberView } from "@/lib/view-models";
import { db } from "@/server/db";
import { notFound, validationFailed } from "@/server/errors";
import { initialsOf } from "@/server/mappers";
import * as memberRepo from "@/server/repositories/member.repository";
import { requireProject } from "@/server/services/website.service";
import { parseOrThrow } from "@/server/validate";
import {
  changeMemberRoleSchema,
  inviteMemberSchema,
  removeMemberSchema,
} from "@/validation/member";

/**
 * Team members — a SERVICE SEAM.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────┐
 * │ Member rows GRANT NO ACCESS. Authorization everywhere is still owner-only: every       │
 * │ query is scoped by `Website.userId`. Inviting someone stores a row that Settings → Team │
 * │ shows; it sends no email and the invitee cannot see the project. Making membership      │
 * │ real means changing every ownership filter (`website: { userId }`) to a membership      │
 * │ check — deliberately not done here.                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Only the project's owner can read or change its member list (the same ownership check as
 * everything else), so this seam cannot be used to probe other projects.
 */

function roleKey(role: MemberRole): MemberRoleKey {
  return role === "VIEWER" ? "Viewer" : "Editor";
}

/** Owner first (from `User`), then member rows oldest first. */
export async function listMembers(actorUserId: string, projectId: string): Promise<MemberView[]> {
  const project = await requireProject(actorUserId, projectId);
  const [owner, members] = await Promise.all([
    db.user.findUnique({
      where: { id: project.userId },
      select: { name: true, email: true, createdAt: true },
    }),
    memberRepo.listMembers(project.id, actorUserId),
  ]);

  const ownerView: MemberView[] = owner
    ? [
        {
          id: null,
          name: owner.name?.trim() || owner.email.split("@")[0]!,
          email: owner.email,
          role: "Owner",
          isOwner: true,
          initials: initialsOf(owner.name, owner.email),
          invited: false,
          createdAt: project.createdAt.toISOString(),
        },
      ]
    : [];

  return [
    ...ownerView,
    ...members.map((member) => ({
      id: member.id,
      name: member.name?.trim() || member.email.split("@")[0]!,
      email: member.email,
      role: roleKey(member.role),
      isOwner: false,
      initials: initialsOf(member.name, member.email),
      invited: true,
      createdAt: member.createdAt.toISOString(),
    })),
  ];
}

/**
 * Stores an invitation row (SEAM — no email is sent, no access is granted). Refuses an invalid
 * email, the owner's own email, and an email already on the list.
 */
export async function inviteMember(actorUserId: string, input: unknown): Promise<MemberView[]> {
  const { projectId, email, role } = parseOrThrow(inviteMemberSchema, input, "Check the invite.");
  const project = await requireProject(actorUserId, projectId);

  const owner = await db.user.findUnique({
    where: { id: project.userId },
    select: { email: true },
  });
  const existing = await memberRepo.listMembers(project.id, actorUserId);
  if (owner?.email.toLowerCase() === email || existing.some((m) => m.email === email)) {
    throw validationFailed("Already a member.", { email: ["Already a member."] });
  }

  // A known Routely user's name is shown when there is one; otherwise the email's local part.
  const known = await db.user.findUnique({ where: { email }, select: { name: true } });

  try {
    await memberRepo.createMember({
      websiteId: project.id,
      email,
      name: known?.name ?? null,
      role,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw validationFailed("Already a member.", { email: ["Already a member."] });
    }
    throw error;
  }

  return listMembers(actorUserId, project.id);
}

export async function changeMemberRole(actorUserId: string, input: unknown): Promise<MemberView[]> {
  const { projectId, memberId, role } = parseOrThrow(changeMemberRoleSchema, input);
  const result = await memberRepo.updateMemberRole(memberId, projectId, actorUserId, role);
  if (result.count === 0) throw notFound("That member does not exist.");
  return listMembers(actorUserId, projectId);
}

/** Removes a member row. The owner is not a row and cannot be removed. */
export async function removeMember(actorUserId: string, input: unknown): Promise<MemberView[]> {
  const { projectId, memberId } = parseOrThrow(removeMemberSchema, input);
  const result = await memberRepo.deleteMember(memberId, projectId, actorUserId);
  if (result.count === 0) throw notFound("That member does not exist.");
  return listMembers(actorUserId, projectId);
}
