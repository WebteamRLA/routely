import "server-only";

import type { ExperimentStatus, UrlMatchType } from "@/generated/prisma/enums";
import { rolesAtLeast } from "@/lib/permissions";
import { db } from "@/server/db";
import { experimentAccess } from "@/server/repositories/access";

/**
 * Conversion goals, presented as a list of measurable actions.
 *
 * **There is no `Metric` table.** A metric in Routely is an experiment's conversion goal — the
 * URL that counts as success — so this reads the goals that already exist rather than
 * introducing a second place for the same fact to live. That keeps one rule intact: reaching
 * the goal URL is what a conversion means, and it means it in exactly one definition.
 *
 * The consequence, which the page states plainly: goals are created and edited on the
 * experiment they belong to, not here.
 */

export type MetricKind = "PAGEVIEW";

/** Every goal type Routely can record today. Click, form and custom-JS goals are not built. */
export const METRIC_TYPES: { key: string; label: string; match?: UrlMatchType }[] = [
  { key: "all", label: "All types" },
  { key: "exact", label: "Pageview (Exact)", match: "EXACT" },
  { key: "prefix", label: "Pageview (Prefix)", match: "PREFIX" },
];

export type MetricState = "collecting" | "waiting" | "paused" | "draft" | "archived";

export interface Metric {
  /** The experiment the goal belongs to — a goal has no identity of its own. */
  experimentId: string;
  /** The goal's own label, falling back to the experiment's name when unset. */
  name: string;
  /** The experiment's name, always — shown as the row's second line. */
  experimentName: string;
  websiteId: string;
  websiteName: string;
  kind: MetricKind;
  matchType: UrlMatchType;
  url: string;
  status: ExperimentStatus;
  state: MetricState;
  /** URLs are frozen once an experiment leaves DRAFT, so the goal can only be renamed. */
  urlEditable: boolean;
  conversions24h: number;
  conversionsTotal: number;
  lastConversionAt: Date | null;
  createdAt: Date;
}

export interface MetricsQuery {
  /** `summary` lists every goal; `live` narrows to the ones a running experiment is feeding. */
  tab?: "summary" | "live";
  search?: string;
  /** A key from `METRIC_TYPES`. */
  type?: string;
  sort?: "recent" | "conversions" | "name";
}

function stateOf(status: ExperimentStatus, conversionsTotal: number): MetricState {
  if (status === "COMPLETED") return "archived";
  if (status === "DRAFT") return "draft";
  if (status === "PAUSED") return "paused";
  return conversionsTotal > 0 ? "collecting" : "waiting";
}

/**
 * Every goal in the actor's workspace (`workspaceId`, the session's active one). With
 * `experimentId`, the one goal of that experiment in any workspace the actor belongs to.
 */
export async function listMetrics(
  actorUserId: string,
  workspaceId: string | null,
  query: MetricsQuery & { experimentId?: string } = {},
  now: Date = new Date(),
): Promise<Metric[]> {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const matchType = METRIC_TYPES.find((type) => type.key === query.type)?.match;
  const search = query.search?.trim();

  // Ownership is folded into the `where` rather than checked afterwards, as everywhere else
  // that reads a customer's data.
  const experiments = await db.experiment.findMany({
    where: {
      ...experimentAccess(actorUserId, workspaceId ? { workspaceId } : {}),
      ...(query.experimentId ? { id: query.experimentId } : {}),
      // A draft without a goal yet has no metric to list.
      conversionUrl: { not: null },
      ...(matchType ? { conversionMatchType: matchType } : {}),
      ...(query.tab === "live" ? { status: "ACTIVE" } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { conversionName: { contains: search, mode: "insensitive" as const } },
              { conversionUrl: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      conversionName: true,
      conversionUrl: true,
      conversionMatchType: true,
      createdAt: true,
      website: { select: { id: true, name: true } },
    },
  });

  if (experiments.length === 0) return [];

  const ids = experiments.map((experiment) => experiment.id);

  // Two grouped aggregations for the whole page rather than a pair of counts per row: the list
  // costs the same whether a customer has three goals or three hundred.
  const [totals, recent, latest] = await Promise.all([
    db.conversion.groupBy({
      by: ["experimentId"],
      where: { experimentId: { in: ids } },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["experimentId"],
      where: { experimentId: { in: ids }, occurredAt: { gte: since24h } },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["experimentId"],
      where: { experimentId: { in: ids } },
      _max: { occurredAt: true },
    }),
  ]);

  const totalById = new Map(totals.map((row) => [row.experimentId, row._count._all]));
  const recentById = new Map(recent.map((row) => [row.experimentId, row._count._all]));
  const latestById = new Map(latest.map((row) => [row.experimentId, row._max.occurredAt]));

  const metrics: Metric[] = experiments.map((experiment) => {
    const conversionsTotal = totalById.get(experiment.id) ?? 0;

    return {
      experimentId: experiment.id,
      name: experiment.conversionName?.trim() || experiment.name,
      experimentName: experiment.name,
      websiteId: experiment.website.id,
      websiteName: experiment.website.name,
      kind: "PAGEVIEW",
      matchType: experiment.conversionMatchType,
      url: experiment.conversionUrl ?? "",
      status: experiment.status,
      state: stateOf(experiment.status, conversionsTotal),
      urlEditable: experiment.status === "DRAFT",
      conversions24h: recentById.get(experiment.id) ?? 0,
      conversionsTotal,
      lastConversionAt: latestById.get(experiment.id) ?? null,
      createdAt: experiment.createdAt,
    };
  });

  // Sorted in memory because two of the three keys are aggregates the database cannot order by
  // in the same query that produced them.
  const sort = query.sort ?? "recent";
  metrics.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "conversions") return b.conversions24h - a.conversions24h;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return metrics;
}

/**
 * Goal URLs used by more than one experiment.
 *
 * Surfaced as a note rather than as a "delete duplicates" action: two experiments legitimately
 * sharing a goal is a normal thing to do — a checkout page is the goal of every test on the
 * way to it — and deleting one would delete a whole experiment along with its results.
 */
export function countDuplicateGoals(metrics: Metric[]): number {
  const seen = new Map<string, number>();
  for (const metric of metrics) {
    const key = `${metric.url}|${metric.matchType}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).length;
}

/** One goal, for the setup page. `null` when the actor does not own it. */
export async function getMetric(actorUserId: string, experimentId: string): Promise<Metric | null> {
  const [metric] = await listMetrics(actorUserId, null, { experimentId });
  return metric ?? null;
}

/**
 * Deletes the experiments behind the given goals.
 *
 * Named for what it does rather than for the row the customer clicked. A goal is a required
 * field on an experiment — an experiment without one can never record a conversion — so there
 * is no "delete the goal but keep the test". Every surface that offers this says so before
 * asking for confirmation.
 */
export async function deleteMetrics(actorUserId: string, experimentIds: string[]): Promise<number> {
  if (experimentIds.length === 0) return 0;

  // The tenant filter participates in the write itself rather than in a prior read, so an id
  // the actor does not own deletes nothing instead of being caught by a check that could be
  // skipped.
  const result = await db.experiment.deleteMany({
    where: {
      id: { in: experimentIds },
      // Admins and the Owner may delete any experiment; an Editor only drafts. Folded into the
      // delete itself, so an id the actor may not delete simply matches nothing.
      OR: [
        experimentAccess(actorUserId, { roles: rolesAtLeast("ADMIN") }),
        { status: "DRAFT", ...experimentAccess(actorUserId, { roles: ["EDITOR"] }) },
      ],
    },
  });

  return result.count;
}
