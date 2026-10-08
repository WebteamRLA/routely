import { notFound } from "next/navigation";

import { requireUser } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as websiteService from "@/server/services/website.service";

/**
 * Every `/p/[projectId]/…` page sits under this ownership check: a project the actor does not
 * own (or that does not exist) is "not found", never "forbidden". Pages still scope their own
 * service calls by the actor — this is the early exit, not the only check.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const [{ projectId }, user] = await Promise.all([params, requireUser()]);
  try {
    await websiteService.requireProject(user.id, projectId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return children;
}
