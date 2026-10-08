import "server-only";

import type { InstallMethod, Website } from "@/generated/prisma/client";
import type { InstallMethodKey, Threshold } from "@/lib/domain";
import type { ExperimentCounts, ProjectSettings, ProjectSummary } from "@/lib/view-models";
import { Prisma, db } from "@/server/db";
import { conflict, notFound, validationFailed } from "@/server/errors";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import * as metricRepo from "@/server/repositories/metric.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { detectFavicon } from "@/server/services/favicon";
import { parseOrThrow } from "@/server/validate";
import {
  addDomainSchema,
  createProjectSchema,
  protocolFromInput,
  removeDomainSchema,
  updateProjectSchema,
} from "@/validation/website";
import { isValidTimeZone } from "@/validation/common";

/**
 * Website business logic.
 *
 * Every function takes `actorUserId` as its first argument and passes it into the repository,
 * so authorization is structural rather than remembered: there is no code path that reads or
 * writes a website without a tenant filter. Anything the actor does not own reports
 * "not found" rather than "forbidden", so an id cannot be probed for existence.
 */

/** Retries for the astronomically unlikely case of a public site id collision. */
const PUBLIC_SITE_ID_ATTEMPTS = 3;

// ===========================================================================================
// Projects (the new UI's name for a website)
// ===========================================================================================

const DOMAIN_TAKEN = "Another project already uses this domain";

function installMethodKey(method: InstallMethod): InstallMethodKey {
  return method === "GTM" ? "gtm" : "direct";
}

function thresholdOf(percent: number): { pct: 90 | 95 | 99; fraction: Threshold } {
  if (percent === 90) return { pct: 90, fraction: 0.9 };
  if (percent === 99) return { pct: 99, fraction: 0.99 };
  return { pct: 95, fraction: 0.95 };
}

function countsOf(byStatus: Record<string, number> | undefined): ExperimentCounts {
  const draft = byStatus?.["DRAFT"] ?? 0;
  const running = byStatus?.["ACTIVE"] ?? 0;
  const paused = byStatus?.["PAUSED"] ?? 0;
  const completed = byStatus?.["ARCHIVED"] ?? 0;
  return { total: draft + running + paused + completed, draft, running, paused, completed };
}

function toSummary(
  website: websiteRepo.WebsiteWithDomains,
  extras: {
    counts: ExperimentCounts;
    lastActivityAt: Date | null;
    receivingData: boolean;
  },
): ProjectSummary {
  const threshold = thresholdOf(website.significanceThreshold);
  return {
    id: website.id,
    name: website.name,
    domain: website.domain,
    domains: [
      website.domain,
      ...website.domains.map((row) => row.domain).filter((d) => d !== website.domain),
    ],
    protocol: website.protocol === "HTTP" ? "http" : "https",
    iconUrl: website.iconUrl,
    publicSiteId: website.publicSiteId,
    timezone: website.timezone,
    significanceThreshold: threshold.pct,
    threshold: threshold.fraction,
    installMethod: installMethodKey(website.installMethod),
    installed: website.pixelVerifiedAt !== null || extras.receivingData,
    pixelVerifiedAt: website.pixelVerifiedAt?.toISOString() ?? null,
    receivingData: extras.receivingData,
    archived: website.archivedAt !== null,
    archivedAt: website.archivedAt?.toISOString() ?? null,
    createdAt: website.createdAt.toISOString(),
    lastActivityAt: extras.lastActivityAt?.toISOString() ?? null,
    counts: extras.counts,
  };
}

/**
 * Every project the actor owns, active and archived (filter on `archived`), newest first, with
 * experiment counts by status, install state and last activity.
 *
 * Counts and last-activity are one grouped query each for all projects; the receiving-data probe
 * is one indexed LIMIT 1 per project (see `listWebsitesWithStatus` for why that is cheaper).
 */
export async function listProjects(actorUserId: string): Promise<ProjectSummary[]> {
  const [websites, counts, lastActivity] = await Promise.all([
    websiteRepo.listProjectsForUser(actorUserId),
    experimentRepo.countExperimentsByWebsiteAndStatus(actorUserId),
    websiteRepo.lastExperimentActivity(actorUserId),
  ]);
  const receiving = await Promise.all(websites.map((w) => eventRepo.hasEvents(w.id)));

  return websites.map((website, index) =>
    toSummary(website, {
      counts: countsOf(counts.get(website.id)),
      lastActivityAt: lastActivity.get(website.id) ?? null,
      receivingData: receiving[index] ?? false,
    }),
  );
}

/**
 * The raw project row, ownership-checked. For other services that need the domains or settings
 * of a project before acting on it. NOT_FOUND when the actor does not own it.
 */
export async function requireProject(
  actorUserId: string,
  projectId: string,
): Promise<websiteRepo.WebsiteWithDomains> {
  const website = await websiteRepo.findProjectForUser(projectId, actorUserId);
  if (!website) throw notFound("That project does not exist.");
  return website;
}

/** All of a project's domains, primary first. */
export function projectDomains(website: websiteRepo.WebsiteWithDomains): string[] {
  return [
    website.domain,
    ...website.domains.map((row) => row.domain).filter((d) => d !== website.domain),
  ];
}

/** One project with its settings. NOT_FOUND when the actor does not own it. */
export async function getProject(actorUserId: string, projectId: string): Promise<ProjectSettings> {
  const website = await requireProject(actorUserId, projectId);
  const [byStatus, lastActivity, receivingData] = await Promise.all([
    db.experiment.groupBy({
      by: ["status"],
      where: { websiteId: website.id },
      _count: { _all: true },
    }),
    db.experiment.aggregate({ where: { websiteId: website.id }, _max: { updatedAt: true } }),
    eventRepo.hasEvents(website.id),
  ]);

  return {
    ...toSummary(website, {
      counts: countsOf(Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]))),
      lastActivityAt: lastActivity._max.updatedAt,
      receivingData,
    }),
    cdnPurgedAt: website.cdnPurgedAt?.toISOString() ?? null,
  };
}

async function assertDomainFree(
  actorUserId: string,
  domain: string,
  field: string,
  excludeId?: string,
): Promise<void> {
  const taken = await websiteRepo.findProjectUsingDomain(actorUserId, domain, excludeId);
  if (taken) {
    throw validationFailed(`${DOMAIN_TAKEN} (“${taken.name}”).`, { [field]: [DOMAIN_TAKEN] });
  }
}

/**
 * Creates a project: validates name and domain, refuses a domain another of the actor's
 * projects already uses, creates the system `page_view` metric, and looks for a favicon
 * (bounded, never fatal). `timezone` is optional — the UI may pass the browser's zone; an
 * invalid one falls back to UTC rather than failing the whole creation.
 */
export async function createProject(actorUserId: string, input: unknown): Promise<ProjectSummary> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = parseOrThrow(
    createProjectSchema,
    {
      name: raw["name"],
      domain: raw["domain"] ?? raw["url"],
      protocol: raw["protocol"] ?? protocolFromInput(raw["domain"] ?? raw["url"]),
    },
    "Check the project details.",
  );
  const timezone =
    typeof raw["timezone"] === "string" && isValidTimeZone(raw["timezone"])
      ? raw["timezone"]
      : "UTC";

  await assertDomainFree(actorUserId, data.domain, "domain");
  const iconUrl = await detectFavicon(data.domain);

  for (let attempt = 0; attempt < PUBLIC_SITE_ID_ATTEMPTS; attempt += 1) {
    try {
      const website = await db.$transaction(async (tx) => {
        const created = await websiteRepo.createWebsite(
          {
            userId: actorUserId,
            name: data.name,
            domain: data.domain,
            protocol: data.protocol,
            publicSiteId: websiteRepo.generatePublicSiteId(),
            timezone,
            iconUrl,
          },
          tx,
        );
        await metricRepo.ensurePageViewMetric(created.id, tx);
        return created;
      });
      const project = await requireProject(actorUserId, website.id);
      return toSummary(project, {
        counts: countsOf(undefined),
        lastActivityAt: null,
        receivingData: false,
      });
    } catch (error) {
      if (isUniqueViolation(error, "publicSiteId")) continue;
      throw error;
    }
  }

  throw conflict("Could not allocate a public site id. Please try again.");
}

/**
 * Updates any of: name, primary domain, protocol, timezone, significance threshold, install
 * method. A new primary domain must not be used by another project; if it was one of this
 * project's additional domains it is promoted (removed from the additional list). The favicon
 * is re-detected when the primary domain changes.
 *
 * Existing experiments are not re-validated against a changed domain — the same as before the
 * rebuild — so a domain change never silently stops a running test.
 */
export async function updateProject(actorUserId: string, input: unknown): Promise<ProjectSettings> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const { projectId, ...changes } = parseOrThrow(
    updateProjectSchema,
    { ...raw, domain: raw["domain"] ?? raw["url"] ?? undefined },
    "Check the project details.",
  );
  const existing = await requireProject(actorUserId, projectId);

  const data: Prisma.WebsiteUpdateInput = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.protocol !== undefined) data.protocol = changes.protocol;
  if (changes.timezone !== undefined) data.timezone = changes.timezone;
  if (changes.significanceThreshold !== undefined) {
    data.significanceThreshold = changes.significanceThreshold;
  }
  if (changes.installMethod !== undefined) data.installMethod = changes.installMethod;

  const domainChanged = changes.domain !== undefined && changes.domain !== existing.domain;
  if (domainChanged) {
    await assertDomainFree(actorUserId, changes.domain!, "domain", existing.id);
    data.domain = changes.domain!;
    data.iconUrl = await detectFavicon(changes.domain!);
  }

  await db.$transaction(async (tx) => {
    const result = await websiteRepo.updateWebsite(existing.id, actorUserId, data, tx);
    if (result.count === 0) throw notFound("That project does not exist.");
    if (domainChanged) {
      await websiteRepo.removeDomain(existing.id, actorUserId, changes.domain!, tx);
    }
  });

  return getProject(actorUserId, existing.id);
}

/** Hides a project from the switcher, keeping all of its data. */
export async function archiveProject(actorUserId: string, projectId: string): Promise<void> {
  const result = await websiteRepo.updateWebsite(projectId, actorUserId, {
    archivedAt: new Date(),
  });
  if (result.count === 0) throw notFound("That project does not exist.");
}

export async function restoreProject(actorUserId: string, projectId: string): Promise<void> {
  const result = await websiteRepo.updateWebsite(projectId, actorUserId, { archivedAt: null });
  if (result.count === 0) throw notFound("That project does not exist.");
}

/**
 * Deletes a project and everything under it (cascade). The tenant filter lives in the
 * `deleteMany` itself, so a project the actor does not own is "not found".
 */
export async function deleteProject(actorUserId: string, projectId: string): Promise<void> {
  const result = await websiteRepo.deleteWebsite(projectId, actorUserId);
  if (result.count === 0) throw notFound("That project does not exist.");
}

/**
 * Adds an additional domain. Experiments may use any of a project's domains (and their
 * subdomains). Refuses duplicates within the project and domains another project uses.
 * Returns every domain, primary first.
 */
export async function addProjectDomain(actorUserId: string, input: unknown): Promise<string[]> {
  const { projectId, domain } = parseOrThrow(addDomainSchema, input, "Check the domain.");
  const project = await requireProject(actorUserId, projectId);

  if (projectDomains(project).includes(domain)) {
    throw validationFailed("Already added.", { domain: ["Already added."] });
  }
  await assertDomainFree(actorUserId, domain, "domain", project.id);

  try {
    await websiteRepo.addDomain(project.id, domain);
  } catch (error) {
    if (isUniqueViolation(error, "domain")) {
      throw validationFailed("Already added.", { domain: ["Already added."] });
    }
    throw error;
  }

  return projectDomains(await requireProject(actorUserId, project.id));
}

/** Removes an additional domain. The primary domain cannot be removed — change it instead. */
export async function removeProjectDomain(actorUserId: string, input: unknown): Promise<string[]> {
  const { projectId, domain } = parseOrThrow(removeDomainSchema, input);
  const project = await requireProject(actorUserId, projectId);

  if (domain === project.domain) {
    throw validationFailed("The primary domain can’t be removed. Change it in project details.", {
      domain: ["The primary domain can’t be removed."],
    });
  }

  const result = await websiteRepo.removeDomain(project.id, actorUserId, domain);
  if (result.count === 0) throw notFound("That domain is not on this project.");

  return projectDomains(await requireProject(actorUserId, project.id));
}

/** Records how the snippet is installed (manual or Google Tag Manager). Display only. */
export async function setInstallMethod(
  actorUserId: string,
  projectId: string,
  method: InstallMethodKey,
): Promise<void> {
  const result = await websiteRepo.updateWebsite(projectId, actorUserId, {
    installMethod: method === "gtm" ? "GTM" : "MANUAL",
  });
  if (result.count === 0) throw notFound("That project does not exist.");
}

// ===========================================================================================
// Public SDK endpoints
// ===========================================================================================

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

  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}
