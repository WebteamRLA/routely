import "server-only";

import { installInfoFor } from "@/components/tracking/data";
import { WIZARD_STEPS } from "@/lib/domain";
import * as metricService from "@/server/services/metric.service";
import * as websiteService from "@/server/services/website.service";

import type { WizardProps } from "./wizard";

/** What both wizard routes load for a project the actor owns (NOT_FOUND otherwise). */
export async function loadWizardContext(
  actorUserId: string,
  projectId: string,
): Promise<Omit<WizardProps, "start">> {
  const [project, metrics] = await Promise.all([
    websiteService.getProject(actorUserId, projectId),
    metricService.listProjectMetrics(actorUserId, projectId),
  ]);
  return {
    project: {
      id: project.id,
      name: project.name,
      domain: project.domain,
      domains: project.domains,
    },
    install: installInfoFor(project),
    metrics,
  };
}

/**
 * `?step=` accepts a step key ("goal") or a 1-based number ("5"). The Variants step was merged
 * into Setup in design v2, so an old `?step=variants` link opens Setup, and a number past the
 * last step (old 7-step links) opens the last one.
 */
export function parseStep(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const keys: string[] = WIZARD_STEPS.map(([k]) => k);
  const byKey = keys.indexOf(v === "variants" ? "basics" : v);
  if (byKey >= 0) return byKey;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, keys.length) - 1 : null;
}
