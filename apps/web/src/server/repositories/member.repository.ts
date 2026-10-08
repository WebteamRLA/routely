import "server-only";

import type { MemberRole, Prisma, ProjectMember } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Team member rows — a SERVICE SEAM. Stored and shown; they grant no access (authorization is
 * still `Website.userId`). Scoped by the owner through the parent website like everything else.
 */

export function listMembers(
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<ProjectMember[]> {
  return client.projectMember.findMany({
    where: { websiteId, website: { userId } },
    orderBy: { createdAt: "asc" },
  });
}

export function createMember(
  data: { websiteId: string; email: string; name: string | null; role: MemberRole },
  client: DbClient = db,
): Promise<ProjectMember> {
  return client.projectMember.create({ data });
}

export function updateMemberRole(
  memberId: string,
  websiteId: string,
  userId: string,
  role: MemberRole,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.projectMember.updateMany({
    where: { id: memberId, websiteId, website: { userId } },
    data: { role },
  });
}

export function deleteMember(
  memberId: string,
  websiteId: string,
  userId: string,
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.projectMember.deleteMany({
    where: { id: memberId, websiteId, website: { userId } },
  });
}
