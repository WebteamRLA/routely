import "server-only";

import { installInfoFor } from "@/components/tracking/data";
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

/** `?step=` accepts a step key ("goal") or a 1-based number ("6"). */
export function parseStep(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const keys = ["type", "basics", "variants", "traffic", "targeting", "goal", "review"];
  const byKey = keys.indexOf(v);
  if (byKey >= 0) return byKey;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= keys.length ? n - 1 : null;
}
