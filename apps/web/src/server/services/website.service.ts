import "server-only";

import type { MemberRole, Website } from "@/generated/prisma/client";
import { type Capability, can, rolesWith } from "@/lib/permissions";
import { type TrackingStatus, trackingStatus } from "@/lib/pixel-status";
import {
  type ProjectIdentity,
  duplicateDomain,
  duplicateName,
  fixIssuesMessage,
  nextColorIndex,
} from "@/lib/projects";
import { findRole } from "@/server/auth/workspace";
import { Prisma } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as projectRepo from "@/server/repositories/project.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { parseOrThrow } from "@/server/validate";
import {
  createProjectSchema,
  createWebsiteSchema,
  deleteProjectSchema,
  updateProjectSchema,
  updateWebsiteSchema,
} from "@/validation/website";

/**
 * Website business logic.
 *
 * Every function takes `actorUserId` as its first argument and passes it into the repository,
 * so authorization is structural rather than remembered: there is no code path that reads or
 * writes a website without a workspace-membership filter. A website in a workspace the actor is
 * not a member of reports "not found", so an id cannot be probed for existence; a member whose
 * role does not allow the change gets "forbidden" (they can already see the website, so that
 * leaks nothing).
 */

/** Retries for the astronomically unlikely case of a public site id collision. */
const PUBLIC_SITE_ID_ATTEMPTS = 3;

/** The websites of the actor's workspace. `workspaceId` is the session's active workspace. */
export function listWebsites(actorUserId: string, workspaceId: string): Promise<Website[]> {
  return websiteRepo.listWebsitesInWorkspace(workspaceId, actorUserId);
}

export interface WebsiteWithStatus {
  website: Website;
  /** Not installed / Active / Not seen — `lib/pixel-status.ts`. */
  tracking: TrackingStatus;
  experiments: { total: number; active: number };
}

/**
 * Every website in the workspace, with the two facts the Get started table shows beside each:
 * its tracking status and how many experiments it has. Both come from columns and one grouped
 * query — tracking status is derived from `lastSeenAt` (the SDK's site-wide hit) and
 * `pixelVerifiedAt`, so no per-website probe of the events table is needed any more.
 */
export async function listWebsitesWithStatus(
  actorUserId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WebsiteWithStatus[]> {
  const [websites, experimentCounts] = await Promise.all([
    websiteRepo.listWebsitesInWorkspace(workspaceId, actorUserId),
    experimentRepo.countExperimentsByWebsite(workspaceId, actorUserId),
  ]);

  return websites.map((website) => ({
    website,
    tracking: trackingStatus(website, now),
    experiments: experimentCounts.get(website.id) ?? { total: 0, active: 0 },
  }));
}

/** Number of experiments on a website the actor owns. Used by the delete confirmation. */
export async function countExperiments(actorUserId: string, websiteId: string): Promise<number> {
  await getWebsite(actorUserId, websiteId);
  return websiteRepo.countExperiments(websiteId);
}

export async function getWebsite(actorUserId: string, websiteId: string): Promise<Website> {
  return (await getWebsiteAccess(actorUserId, websiteId)).website;
}

/**
 * A website and the actor's role in its workspace. NOT_FOUND for a non-member; with `capability`,
 * FORBIDDEN for a member whose role lacks it.
 */
export async function getWebsiteAccess(
  actorUserId: string,
  websiteId: string,
  capability?: Capability,
): Promise<{ website: Website; role: MemberRole }> {
  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);

  if (!access) {
    throw notFound("That website does not exist.");
  }

  if (capability && !can(access.role, capability)) {
    throw forbidden();
  }

  return access;
}

/** Adds a website to `workspaceId` — the actor's active workspace, where they must be an Admin+. */
export async function createWebsite(
  actorUserId: string,
  workspaceId: string,
  input: unknown,
): Promise<Website> {
  const data = parseOrThrow(createWebsiteSchema, input, "Check the website details.");

  const role = await findRole(workspaceId, actorUserId);
  if (!role) throw notFound("That workspace does not exist.");
  if (!can(role, "project.manage")) throw forbidden();

  for (let attempt = 0; attempt < PUBLIC_SITE_ID_ATTEMPTS; attempt += 1) {
    try {
      return await websiteRepo.createWebsite({
        workspaceId,
        createdById: actorUserId,
        name: data.name,
        domain: data.domain,
        protocol: data.protocol,
        publicSiteId: websiteRepo.generatePublicSiteId(),
      });
    } catch (error) {
      if (isUniqueViolation(error, "publicSiteId")) {
        continue;
      }
      throw duplicateError(error) ?? error;
    }
  }

  throw conflict("Could not allocate a public site id. Please try again.");
}

export async function updateWebsite(actorUserId: string, input: unknown): Promise<Website> {
  const { websiteId, ...changes } = parseOrThrow(
    updateWebsiteSchema,
    input,
    "Check the website details.",
  );

  await getWebsiteAccess(actorUserId, websiteId, "project.manage");

  const result = await websiteRepo
    .updateWebsite(websiteId, actorUserId, rolesWith("project.manage"), changes)
    .catch((error: unknown) => {
      throw duplicateError(error) ?? error;
    });

  if (result.count === 0) {
    throw notFound("That website does not exist.");
  }

  return getWebsite(actorUserId, websiteId);
}

export async function deleteWebsite(actorUserId: string, websiteId: string): Promise<void> {
  await getWebsiteAccess(actorUserId, websiteId, "project.manage");

  const result = await websiteRepo.deleteWebsite(
    websiteId,
    actorUserId,
    rolesWith("project.manage"),
  );

  if (result.count === 0) {
    throw notFound("That website does not exist.");
  }
}

/**
 * Deletes several websites at once, returning how many were actually removed.
 *
 * The tenant filter lives in the `deleteMany` itself, so ids the actor does not own simply
 * match nothing rather than raising — which is what keeps a crafted list of ids from telling
 * an attacker which of them exist. Unlike the single-website version this does not throw on a
 * miss: a partial selection is a normal outcome when a row was removed in another tab.
 */
export async function deleteWebsites(actorUserId: string, websiteIds: string[]): Promise<number> {
  if (websiteIds.length === 0) return 0;
  const result = await websiteRepo.deleteWebsites(
    websiteIds,
    actorUserId,
    rolesWith("project.manage"),
  );
  return result.count;
}

// ---------------------------------------------------------------------------------------------
// Projects — the new design's create / edit / delete dialogs (Owner and Admin)
// ---------------------------------------------------------------------------------------------

/** Copy for a domain change while an experiment is still live (spec §8 row 13). */
export const DOMAIN_LOCKED_MESSAGE =
  "End this project’s running and paused experiments before changing its domain.";

/**
 * The design's duplicate rules against the workspace's other projects: a name may not repeat
 * (ignoring case) and a domain may not repeat. Throws one VALIDATION error carrying every failure,
 * field by field, so the dialog can show each beside its box.
 */
function assertNoDuplicates(
  name: string,
  domain: string,
  others: readonly ProjectIdentity[],
  mode: "create" | "edit",
): void {
  const fieldErrors: Record<string, string[]> = {};
  const sameName = duplicateName(name, others);
  if (sameName) fieldErrors.name = [`You already have a project called “${sameName.name}”.`];
  const sameDomain = duplicateDomain(domain, others);
  if (sameDomain) fieldErrors.url = [`${domain} is already used by “${sameDomain.name}”.`];

  const count = Object.keys(fieldErrors).length;
  if (count === 0) return;
  const first = Object.values(fieldErrors)[0]![0]!;
  throw validationFailed(
    count > 1 && mode === "create" ? fixIssuesMessage(count) : first,
    fieldErrors,
  );
}

/**
 * Creates a project in `workspaceId` — the actor's active workspace, where they must be Owner or
 * Admin. Name and address follow `lib/projects.ts`; a project gets the next avatar colour
 * (`count % 5`) and a fresh public site id. Returns the new id.
 *
 * The duplicate checks run before the insert for the design's messages; the database's unique
 * indexes (`[workspaceId, domain]`, `lower(name)`) still decide a race, and a lost race is
 * reported with the same messages.
 */
export async function createProject(
  actorUserId: string,
  workspaceId: string,
  input: unknown,
): Promise<{ id: string }> {
  const role = await findRole(workspaceId, actorUserId);
  if (!role) throw notFound("That workspace does not exist.");
  if (!can(role, "project.manage")) throw forbidden();

  const data = parseOrThrow(createProjectSchema, input, "Check the project details.");
  const others = await projectRepo.listProjectIdentities(workspaceId, actorUserId);
  assertNoDuplicates(data.name, data.url.domain, others, "create");

  for (let attempt = 0; attempt < PUBLIC_SITE_ID_ATTEMPTS; attempt += 1) {
    try {
      return await projectRepo.createProject({
        workspaceId,
        createdById: actorUserId,
        name: data.name,
        domain: data.url.domain,
        protocol: data.url.protocol,
        publicSiteId: websiteRepo.generatePublicSiteId(),
        colorIndex: nextColorIndex(others.length),
      });
    } catch (error) {
      if (isUniqueViolation(error, "publicSiteId")) continue;
      if (isDuplicate(error)) {
        // Lost a race with another create: report it the way the dialog words it.
        const now = await projectRepo.listProjectIdentities(workspaceId, actorUserId);
        assertNoDuplicates(data.name, data.url.domain, now, "create");
      }
      throw duplicateError(error) ?? error;
    }
  }

  throw conflict("Could not allocate a public site id. Please try again.");
}

/**
 * Renames a project and/or changes its address. Same rules as creating, excluding itself.
 *
 * A **domain** change is refused while any of its experiments is running or paused: their URLs
 * were checked against the old domain and are fixed once launched, so a silent move would break
 * them (spec §8 row 13 — a deliberate deviation from the design, which only warned). The
 * condition is part of the write itself. A domain change also clears `pixelVerifiedAt` and
 * `lastSeenAt`: both were evidence about the old site, and keeping them would show the new domain
 * as "Active" before it has sent a single hit.
 */
export async function updateProject(actorUserId: string, input: unknown): Promise<{ id: string }> {
  const websiteId =
    input && typeof input === "object" && "websiteId" in input
      ? String((input as { websiteId: unknown }).websiteId ?? "")
      : "";
  // Access first, so a viewer is told FORBIDDEN whatever they typed.
  const { website } = await getWebsiteAccess(actorUserId, websiteId, "project.manage");

  const data = parseOrThrow(updateProjectSchema, input, "Check the project details.");
  const domainChanged = data.url.domain !== website.domain;
  // The scheme is not shown in the edit dialog, so it only moves with the domain.
  if (!domainChanged && data.name === website.name) return { id: website.id };

  const others = (await projectRepo.listProjectIdentities(website.workspaceId, actorUserId)).filter(
    (p) => p.id !== website.id,
  );
  assertNoDuplicates(data.name, data.url.domain, others, "edit");

  if (domainChanged && (await projectRepo.countLiveExperiments(website.id, actorUserId)) > 0) {
    throw validationFailed(DOMAIN_LOCKED_MESSAGE, { url: [DOMAIN_LOCKED_MESSAGE] });
  }

  const result = await projectRepo
    .updateProject(
      website.id,
      actorUserId,
      rolesWith("project.manage"),
      {
        name: data.name,
        ...(domainChanged
          ? {
              domain: data.url.domain,
              protocol: data.url.protocol,
              pixelVerifiedAt: null,
              lastSeenAt: null,
            }
          : {}),
      },
      { requireNoLiveExperiments: domainChanged },
    )
    .catch(async (error: unknown) => {
      if (isDuplicate(error)) {
        const now = await projectRepo.listProjectIdentities(website.workspaceId, actorUserId);
        assertNoDuplicates(
          data.name,
          data.url.domain,
          now.filter((p) => p.id !== website.id),
          "edit",
        );
      }
      throw duplicateError(error) ?? error;
    });

  if (result.count === 0) {
    // Either it vanished, or an experiment went live between the check and the write.
    await getWebsiteAccess(actorUserId, website.id, "project.manage");
    throw validationFailed(DOMAIN_LOCKED_MESSAGE, { url: [DOMAIN_LOCKED_MESSAGE] });
  }

  return { id: website.id };
}

/**
 * Deletes a project and everything recorded for it. `confirmName` must equal the project's name
 * exactly (case-sensitive, trimmed) — the dialog enables its button on the same rule, and the
 * server repeats it because a Server Action is a public endpoint. Returns the deleted name.
 */
export async function deleteProject(
  actorUserId: string,
  input: unknown,
): Promise<{ name: string }> {
  const websiteId =
    input && typeof input === "object" && "websiteId" in input
      ? String((input as { websiteId: unknown }).websiteId ?? "")
      : "";
  const { website } = await getWebsiteAccess(actorUserId, websiteId, "project.manage");

  const data = parseOrThrow(deleteProjectSchema, input, "Type the project’s name to confirm.");
  if (data.confirmName.trim() !== website.name) {
    throw validationFailed(`Type ${website.name} exactly to confirm.`, {
      confirmName: [`Type ${website.name} exactly to confirm.`],
    });
  }

  const result = await projectRepo.deleteProject(
    website.id,
    actorUserId,
    rolesWith("project.manage"),
    website.name,
  );
  if (result.count === 0) throw notFound("That project does not exist.");

  return { name: website.name };
}

/**
 * Issues a new public site id. This invalidates every already-installed snippet for the
 * website, so it is an explicit action rather than a side effect of editing details.
 */
export async function rotatePublicSiteId(actorUserId: string, websiteId: string): Promise<Website> {
  await getWebsiteAccess(actorUserId, websiteId, "project.manage");

  await websiteRepo.updateWebsite(websiteId, actorUserId, rolesWith("project.manage"), {
    publicSiteId: websiteRepo.generatePublicSiteId(),
  });

  return getWebsite(actorUserId, websiteId);
}

/**
 * Whether this website's tracking snippet has reported at least one event.
 *
 * **This is not the same as "the snippet is installed."** The SDK only reports events once an
 * active experiment matches a page a visitor is actually viewing, so a correctly installed
 * snippet reports nothing until a test is running — the normal state for a website that was
 * just set up. Calling that "pixel not detected" is what let the Get started guide say
 * "You're all set" while the website list said the opposite, both truthfully.
 *
 * Whether the snippet is *present* is a different question, answered by fetching the page —
 * see `pixel.service.verifyInstallation`. Neither is stored as a flag, so neither can go stale
 * against a snippet the customer later removed.
 */
export async function isReceivingData(actorUserId: string, websiteId: string): Promise<boolean> {
  await getWebsite(actorUserId, websiteId);
  return eventRepo.hasEvents(websiteId);
}

/**
 * Resolves the website behind a public site id for the unauthenticated SDK endpoints. Returns
 * null rather than throwing: an unknown id is a normal condition on a public endpoint, not an
 * exceptional one.
 */
export function resolveWebsiteByPublicSiteId(publicSiteId: string): Promise<Website | null> {
  return websiteRepo.findWebsiteByPublicSiteId(publicSiteId);
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  // Through a driver adapter the violated fields are reported under `driverAdapterError` rather
  // than `target`, and an expression index (the case-insensitive name) reports its index name —
  // so the field is looked for anywhere in the metadata rather than in one known slot.
  const target = error.meta?.target;
  if (Array.isArray(target) ? target.includes(field) : target === field) return true;
  return JSON.stringify(error.meta ?? {}).includes(field);
}

/** A unique violation on the workspace's domain or case-insensitive name index. */
function isDuplicate(error: unknown): boolean {
  return (
    isUniqueViolation(error, "domain") ||
    isUniqueViolation(error, "websites_ws_name_ci") ||
    isUniqueViolation(error, "name")
  );
}

/**
 * The per-workspace uniqueness rules (one website per domain, names unique ignoring case) as a
 * readable validation error, or null when `error` is something else.
 */
function duplicateError(error: unknown) {
  if (isUniqueViolation(error, "domain")) {
    return validationFailed("A website for that domain already exists in this workspace.", {
      domain: ["A website for this domain already exists."],
    });
  }
  if (isUniqueViolation(error, "websites_ws_name_ci") || isUniqueViolation(error, "name")) {
    return validationFailed("A website with that name already exists in this workspace.", {
      name: ["Choose a name that isn’t already used."],
    });
  }
  return null;
}
