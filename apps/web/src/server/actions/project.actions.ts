"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import type { InstallMethodKey } from "@/lib/domain";
import { LAST_PROJECT_COOKIE, routes } from "@/lib/routes";
import type { MemberView, ProjectSettings, ProjectSummary } from "@/lib/view-models";
import { type ActionResult, runResult } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as cdnService from "@/server/services/cdn.service";
import * as memberService from "@/server/services/member.service";
import * as websiteService from "@/server/services/website.service";

/**
 * Server Actions for projects (websites), their domains, team (SEAM) and CDN panel (SEAM).
 *
 * The actor always comes from the session — a Server Action is a public HTTP endpoint — and
 * every service call is scoped by that actor, so another customer's project id is "not found".
 */

/** Everything under `/p/<id>` (layout-level), plus the projects list. */
function revalidateProject(projectId: string): void {
  revalidatePath(routes.project(projectId).dashboard, "layout");
  revalidatePath(routes.projects);
}

export async function createProjectAction(input: {
  name: string;
  /** Whatever was typed: `https://www.example.com/x`, `example.com`, … */
  url: string;
  /** IANA zone, e.g. from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Optional. */
  timezone?: string;
}): Promise<ActionResult<ProjectSummary>> {
  const user = await requireUser();
  const result = await runResult(
    () => websiteService.createProject(user.id, input),
    `Project “${input.name?.trim()}” created`,
  );
  if (result.status === "success") revalidatePath(routes.projects);
  return result;
}

export async function updateProjectAction(input: {
  projectId: string;
  name?: string;
  url?: string;
  timezone?: string;
  significanceThreshold?: number;
  installMethod?: InstallMethodKey;
}): Promise<ActionResult<ProjectSettings>> {
  const user = await requireUser();
  const result = await runResult(
    () => websiteService.updateProject(user.id, input),
    "Project settings saved",
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await websiteService.archiveProject(user.id, projectId);
    return null;
  }, "Project archived");
  if (result.status === "success") revalidateProject(projectId);
  return result;
}

export async function restoreProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await websiteService.restoreProject(user.id, projectId);
    return null;
  }, "Project restored");
  if (result.status === "success") revalidateProject(projectId);
  return result;
}

/** Permanently deletes a project and all of its data. */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await websiteService.deleteProject(user.id, projectId);
    return null;
  }, "Project deleted");
  if (result.status === "success") {
    revalidatePath(routes.projects);
    const jar = await cookies();
    if (jar.get(LAST_PROJECT_COOKIE)?.value === projectId) jar.delete(LAST_PROJECT_COOKIE);
  }
  return result;
}

/**
 * Remembers the project the user is looking at (cookie `rl_project`) so `/` can return to it.
 * Ownership is checked first; the cookie holds only an id and grants nothing by itself.
 */
export async function selectProjectAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runResult(async () => {
    await websiteService.requireProject(user.id, projectId);
    return null;
  });
  if (result.status === "success") {
    (await cookies()).set(LAST_PROJECT_COOKIE, projectId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return result;
}

export async function addDomainAction(input: {
  projectId: string;
  domain: string;
}): Promise<ActionResult<string[]>> {
  const user = await requireUser();
  const result = await runResult(() => websiteService.addProjectDomain(user.id, input));
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

export async function removeDomainAction(input: {
  projectId: string;
  domain: string;
}): Promise<ActionResult<string[]>> {
  const user = await requireUser();
  const result = await runResult(
    () => websiteService.removeProjectDomain(user.id, input),
    `${input.domain} removed`,
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

// -------------------------------------------------------------------------------------------
// Team — SERVICE SEAM. Member rows are stored and shown but grant NO access.
// -------------------------------------------------------------------------------------------

export async function inviteMemberAction(input: {
  projectId: string;
  email: string;
  role: "Editor" | "Viewer";
}): Promise<ActionResult<MemberView[]>> {
  const user = await requireUser();
  const result = await runResult(
    () => memberService.inviteMember(user.id, input),
    `Invitation saved for ${input.email?.trim()}`,
  );
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

export async function changeMemberRoleAction(input: {
  projectId: string;
  memberId: string;
  role: "Editor" | "Viewer";
}): Promise<ActionResult<MemberView[]>> {
  const user = await requireUser();
  const result = await runResult(() => memberService.changeMemberRole(user.id, input));
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

export async function removeMemberAction(input: {
  projectId: string;
  memberId: string;
}): Promise<ActionResult<MemberView[]>> {
  const user = await requireUser();
  const result = await runResult(() => memberService.removeMember(user.id, input));
  if (result.status === "success") revalidateProject(input.projectId);
  return result;
}

// -------------------------------------------------------------------------------------------
// CDN — SERVICE SEAM. Records the purge time only; nothing is purged.
// -------------------------------------------------------------------------------------------

export async function purgeCdnAction(projectId: string): Promise<ActionResult<string>> {
  const user = await requireUser();
  const result = await runResult(
    () => cdnService.purgeCdn(user.id, projectId),
    "Purge recorded (placeholder — no CDN is connected)",
  );
  if (result.status === "success") revalidateProject(projectId);
  return result;
}
