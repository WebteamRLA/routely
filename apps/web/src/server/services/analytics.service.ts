import "server-only";

import type { CountingMode } from "@/generated/prisma/client";
import { armColor, armName, type CountingKey } from "@/lib/domain";
import { armLabel } from "@/lib/sheet-rows";
import type {
  ArmSeries,
  ArmTotals,
  DailyPoint,
  ExperimentResults,
  GoalPerformance,
  ResultsRange,
} from "@/lib/view-models";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { countingKey, metricGoalView, primaryGoalKey, primaryGoalView } from "@/server/mappers";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
import { addDays, dayKeyInZone, daysBetween, startOfDayInZone } from "@/server/time/zoned-day";
import type { DateRange } from "@/validation/common";

/**
 * Read-only analytics for an experiment.
 *
 * Every function takes `actorUserId` and resolves the experiment through the ownership chain
 * first, so a caller cannot read another customer's results by supplying an id — the same rule
 * as everywhere else, applied to reads that are otherwise easy to treat as harmless.
 *
 * Page views, visitor counts, approximate visible time and conversions are computed here.
 *
 * ## Visible time is approximate
 *
 * `avgVisibleMs` is derived from what a browser is willing to report, which is document
 * visibility — not attention. A tab left open on a monitor nobody is looking at counts; a
 * person reading carefully while the window sits behind another may not. Time after the last
 * beacon is lost entirely, so a crash or a force-quit truncates the measurement silently, and
 * that truncation is more likely on slower devices.
 *
 * It is meaningful **as a comparison between the arms of one experiment**, because all of them
 * are measured the same way and the bias is shared. It is not a session-duration figure, and
 * presenting it as one — or comparing it against a number from another tool — would be wrong.
 * The UI must label it as approximate wherever it appears.
 */

/**
 * Every arm of every experiment an account owns that saw activity in a window, flattened into
 * one row per arm.
 *
 * Written for the daily Google Sheets sync, and deliberately placed here rather than in
 * `sheets-sync.service.ts`: the conversion rate it reports has to be the *same* number the
 * dashboard shows for the same window, and the surest way to keep two definitions identical is
 * to keep them in one file. A customer who compares the spreadsheet against the experiment page
 * and finds a different rate has found a bug, not a rounding difference.
 *
 * Three grouped queries regardless of account size. The third is not avoidable: the variant
 * *label* comes from `ExperimentVariant.position`, and only the experiments that actually appear
 * in the first two are fetched, so it does not scale with the number of experiments an account
 * has — only with the number that were live that day.
 *
 * Pass `websiteId` to restrict the result to one website — which the Sheets sync always does,
 * because each website writes to its own spreadsheet.
 *
 * ## What is and is not included
 *
 * - **Status is ignored.** DRAFT, ACTIVE, PAUSED and ARCHIVED all contribute. An experiment
 *   paused this morning still collected real data yesterday, and filtering on today's status
 *   would make yesterday's numbers depend on when the sync happened to run. In practice this
 *   only reaches PAUSED and ARCHIVED, because only ACTIVE experiments accept events at all.
 * - **An experiment with no activity in the window contributes no rows**, rather than a row of
 *   zeroes per arm. The sheet is an append-only daily log; emitting every arm of every
 *   experiment every day would grow it without bound and bury the signal, and a spreadsheet
 *   treats a missing row and a zero row identically when summing.
 * - **But every arm of an experiment that *did* see activity is emitted, including arms with
 *   zero.** Otherwise a variant that got no traffic yesterday vanishes from the sheet and
 *   control looks like the whole test.
 */
export interface DailyArmRow {
  experimentId: string;
  experimentName: string;
  /** Null for control — control is not a row in `ExperimentVariant`. */
  variantId: string | null;
  /** "Control", or "Variant N" by position — the same label the dashboard renders. */
  variantLabel: string;
  assignedVisitors: number;
  conversions: number;
  /** Conversions ÷ assigned visitors, as a fraction. Null when nobody was assigned. */
  conversionRate: number | null;
}

/**
 * Every arm of every experiment on one website, for each day in a window, oldest day first.
 *
 * This is what the Google Sheets tab is rebuilt from. A tab that is overwritten on every refresh has
 * to be recomputed from source data each time, which is precisely what makes it impossible for the
 * spreadsheet to disagree with the dashboard — there is no accumulated state to drift.
 *
 * Buckets by UTC day in memory rather than in SQL. Prisma cannot group by a date-truncated column,
 * and the alternative — one pair of grouped queries per day — is sixty round trips for a thirty-day
 * window. The caveat: this is a place that has to become raw SQL if a single website's traffic over the window
 * ever outgrows memory. At the volumes this product is built for, it does not.
 */
export interface DatedArmRow extends DailyArmRow {
  /** The UTC day this row describes, as `YYYY-MM-DD`. */
  day: string;
}

export async function getArmRowsByDay(
  actorUserId: string,
  range: DateRange,
  websiteId?: string,
): Promise<DatedArmRow[]> {
  const owned = {
    website: { userId: actorUserId, ...(websiteId ? { id: websiteId } : {}) },
  };

  const [assignments, conversions] = await Promise.all([
    db.assignment.findMany({
      where: { experiment: owned, assignedAt: { gte: range.from, lte: range.to } },
      select: { experimentId: true, variantId: true, assignedAt: true },
    }),
    db.conversion.findMany({
      where: { experiment: owned, occurredAt: { gte: range.from, lte: range.to } },
      select: { experimentId: true, variantId: true, occurredAt: true, goalKey: true },
    }),
  ]).then(async ([assignedRows, conversionRows]) => {
    // Primary goal only, the same number the dashboard shows.
    const keys = await primaryGoalKeys([...new Set(conversionRows.map((r) => r.experimentId))]);
    return [
      assignedRows,
      conversionRows.filter((row) => row.goalKey === (keys.get(row.experimentId) ?? "url")),
    ] as const;
  });

  const touchedIds = [
    ...new Set([
      ...assignments.map((row) => row.experimentId),
      ...conversions.map((row) => row.experimentId),
    ]),
  ];

  if (touchedIds.length === 0) return [];

  const experiments = await db.experiment.findMany({
    where: { id: { in: touchedIds }, ...owned },
    select: {
      id: true,
      name: true,
      variants: { select: { id: true }, orderBy: { position: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

  // day -> experimentId -> variantId -> count
  const assigned = new Map<string, Map<string, Map<string | null, number>>>();
  const converted = new Map<string, Map<string, Map<string | null, number>>>();

  const bump = (
    into: Map<string, Map<string, Map<string | null, number>>>,
    day: string,
    experimentId: string,
    variantId: string | null,
  ): void => {
    const byExperiment = into.get(day) ?? new Map<string, Map<string | null, number>>();
    const byVariant = byExperiment.get(experimentId) ?? new Map<string | null, number>();
    byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + 1);
    byExperiment.set(experimentId, byVariant);
    into.set(day, byExperiment);
  };

  for (const row of assignments)
    bump(assigned, utcDay(row.assignedAt), row.experimentId, row.variantId);
  for (const row of conversions)
    bump(converted, utcDay(row.occurredAt), row.experimentId, row.variantId);

  const days = [...new Set([...assigned.keys(), ...converted.keys()])].sort();
  const rows: DatedArmRow[] = [];

  for (const day of days) {
    for (const experiment of experiments) {
      const dayAssigned = assigned.get(day)?.get(experiment.id) ?? new Map<string | null, number>();
      const dayConverted =
        converted.get(day)?.get(experiment.id) ?? new Map<string | null, number>();

      // An experiment with no activity on this day contributes no rows to it — the same rule as the
      // single-day query, applied per day rather than once.
      if (dayAssigned.size === 0 && dayConverted.size === 0) continue;

      const orderedVariantIds = experiment.variants.map((variant) => variant.id);
      const configuredArms: (string | null)[] = [null, ...orderedVariantIds];
      const strayArms = [...new Set([...dayAssigned.keys(), ...dayConverted.keys()])].filter(
        (variantId) => !configuredArms.includes(variantId),
      );

      for (const variantId of [...configuredArms, ...strayArms]) {
        const assignedVisitors = dayAssigned.get(variantId) ?? 0;
        const conversionCount = dayConverted.get(variantId) ?? 0;

        rows.push({
          day,
          experimentId: experiment.id,
          experimentName: experiment.name,
          variantId,
          variantLabel: armLabel(variantId, orderedVariantIds),
          assignedVisitors,
          conversions: conversionCount,
          // Assigned visitors, not visitors who loaded a page — same as the results page.
          conversionRate: assignedVisitors > 0 ? conversionCount / assignedVisitors : null,
        });
      }
    }
  }

  return rows;
}

export async function getDailyArmRows(
  actorUserId: string,
  range: DateRange,
  websiteId?: string,
): Promise<DailyArmRow[]> {
  /*
   * Same structural rule as `getExperimentSummaries`: ownership is folded into each aggregation's
   * own `where`, so there is no prior read to forget and nothing to trust.
   *
   * `websiteId` narrows it further, and is how the Sheets sync keeps one website's rows out of
   * another website's spreadsheet. It is applied *alongside* the user filter rather than instead of
   * it — a website id is a caller-supplied value, and on its own it would be an id to probe.
   */
  const owned = {
    website: { userId: actorUserId, ...(websiteId ? { id: websiteId } : {}) },
  };

  const [assignments, conversions] = await Promise.all([
    db.assignment.groupBy({
      by: ["experimentId", "variantId"],
      where: {
        experiment: owned,
        assignedAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["experimentId", "variantId", "goalKey"],
      where: {
        experiment: owned,
        // Same window as the assignments above, so the rate's numerator and denominator
        // always describe the same period.
        occurredAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    }),
  ]).then(async ([assignedRows, conversionRows]) => {
    const keys = await primaryGoalKeys([...new Set(conversionRows.map((r) => r.experimentId))]);
    return [
      assignedRows,
      conversionRows.filter((row) => row.goalKey === (keys.get(row.experimentId) ?? "url")),
    ] as const;
  });

  const touchedIds = [
    ...new Set([
      ...assignments.map((row) => row.experimentId),
      ...conversions.map((row) => row.experimentId),
    ]),
  ];

  if (touchedIds.length === 0) return [];

  // The label depends on variant *position*, which neither aggregation carries. Scoped by
  // ownership again rather than trusting ids derived from the queries above — cheap, and it
  // means this query is correct in isolation.
  const experiments = await db.experiment.findMany({
    where: { id: { in: touchedIds }, ...owned },
    select: {
      id: true,
      name: true,
      variants: { select: { id: true }, orderBy: { position: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  const assignedByExperiment = new Map<string, Map<string | null, number>>();
  const convertedByExperiment = new Map<string, Map<string | null, number>>();

  for (const row of assignments) {
    const inner = assignedByExperiment.get(row.experimentId) ?? new Map<string | null, number>();
    inner.set(row.variantId, row._count._all);
    assignedByExperiment.set(row.experimentId, inner);
  }

  for (const row of conversions) {
    const inner = convertedByExperiment.get(row.experimentId) ?? new Map<string | null, number>();
    inner.set(row.variantId, row._count._all);
    convertedByExperiment.set(row.experimentId, inner);
  }

  const rows: DailyArmRow[] = [];

  for (const experiment of experiments) {
    const assigned = assignedByExperiment.get(experiment.id) ?? new Map<string | null, number>();
    const converted = convertedByExperiment.get(experiment.id) ?? new Map<string | null, number>();

    const orderedVariantIds = experiment.variants.map((variant) => variant.id);

    // Control first, then variants in position order — the order the experiment page uses. Any
    // arm carrying data but no longer configured (a variant deleted since) is appended last, so
    // its visitors are still reported rather than silently dropped.
    const configuredArms: (string | null)[] = [null, ...orderedVariantIds];
    const strayArms = [...new Set([...assigned.keys(), ...converted.keys()])].filter(
      (variantId) => !configuredArms.includes(variantId),
    );

    for (const variantId of [...configuredArms, ...strayArms]) {
      const assignedVisitors = assigned.get(variantId) ?? 0;
      const conversionCount = converted.get(variantId) ?? 0;

      rows.push({
        experimentId: experiment.id,
        experimentName: experiment.name,
        variantId,
        variantLabel: armLabel(variantId, orderedVariantIds),
        assignedVisitors,
        conversions: conversionCount,
        // Assigned visitors, not visitors who loaded a page — the same denominator as the
        // results page (everyone bucketed had the opportunity to convert). Must not diverge.
        conversionRate: assignedVisitors > 0 ? conversionCount / assignedVisitors : null,
      });
    }
  }

  return rows;
}

// ===========================================================================================
// New UI: per-goal, per-day, project-timezone results
// ===========================================================================================

/** Primary-goal key ("url" or a metric id) per experiment. */
async function primaryGoalKeys(experimentIds: string[]): Promise<Map<string, string>> {
  if (experimentIds.length === 0) return new Map();
  const rows = await db.experiment.findMany({
    where: { id: { in: experimentIds } },
    select: { id: true, goalMetricId: true },
  });
  return new Map(rows.map((row) => [row.id, primaryGoalKey(row)]));
}

/**
 * All-time per-arm totals on each experiment's primary goal (unique conversions), for lists and
 * the dashboard. Two grouped queries however many experiments; ownership is folded into both.
 */
export async function primaryTotalsFor(
  actorUserId: string,
  experiments: readonly {
    id: string;
    goalMetricId: string | null;
    variants: readonly { id: string; position: number }[];
  }[],
): Promise<Map<string, ArmTotals[]>> {
  const result = new Map<string, ArmTotals[]>();
  if (experiments.length === 0) return result;
  const ids = experiments.map((e) => e.id);
  const owned = { website: { userId: actorUserId } };

  const [assigned, converted] = await Promise.all([
    db.assignment.groupBy({
      by: ["experimentId", "variantId"],
      where: { experimentId: { in: ids }, experiment: owned },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["experimentId", "variantId", "goalKey"],
      where: { experimentId: { in: ids }, experiment: owned },
      _count: { _all: true },
    }),
  ]);

  for (const experiment of experiments) {
    const position = (variantId: string | null) =>
      variantId === null
        ? 0
        : (experiment.variants.find((v) => v.id === variantId)?.position ?? -1);
    const arms: ArmTotals[] = [
      { position: 0, v: 0, c: 0 },
      ...[...experiment.variants]
        .sort((a, b) => a.position - b.position)
        .map((v) => ({ position: v.position, v: 0, c: 0 })),
    ];
    const goalKey = primaryGoalKey(experiment);
    for (const row of assigned) {
      if (row.experimentId !== experiment.id) continue;
      const arm = arms.find((a) => a.position === position(row.variantId));
      if (arm) arm.v += row._count._all;
    }
    for (const row of converted) {
      if (row.experimentId !== experiment.id || row.goalKey !== goalKey) continue;
      const arm = arms.find((a) => a.position === position(row.variantId));
      if (arm) arm.c += row._count._all;
    }
    result.set(experiment.id, arms);
  }
  return result;
}

export interface ResultsOptions {
  range?: ResultsRange;
  /** "url" or a metric id; defaults to the primary goal. */
  goal?: string;
  /** Defaults to the experiment's counting mode. */
  counting?: CountingKey;
}

type ExperimentForResults = experimentRepo.ExperimentWithWebsite;

function windowDays(
  experiment: ExperimentForResults,
  firstDataAt: Date | null,
  range: ResultsRange,
  now: Date,
): string[] {
  const tz = experiment.website.timezone;
  const starts = [experiment.publishedAt, firstDataAt].filter((d): d is Date => d !== null);
  if (starts.length === 0) return [];
  const first = dayKeyInZone(new Date(Math.min(...starts.map((d) => d.getTime()))), tz);
  const end = dayKeyInZone(
    experiment.status === "ARCHIVED" && experiment.stoppedAt ? experiment.stoppedAt : now,
    tz,
  );
  const all = daysBetween(first, end < first ? first : end);
  return range === "all" ? all : all.slice(-Number(range));
}

async function computeResults(
  experiment: ExperimentForResults,
  options: ResultsOptions,
  now: Date,
): Promise<ExperimentResults> {
  const tz = experiment.website.timezone;
  const range = options.range ?? "all";
  const goalKey = options.goal ?? primaryGoalKey(experiment);
  const counting = options.counting ?? countingKey(experiment.countingMode);
  const mode: CountingMode = counting === "all" ? "ALL" : "UNIQUE";

  const variants = [...experiment.variants].sort((a, b) => a.position - b.position);
  const positionOf = (variantId: string | null) =>
    variantId === null ? 0 : (variants.find((v) => v.id === variantId)?.position ?? -1);

  const firstAssignment = await db.assignment.findFirst({
    where: { experimentId: experiment.id },
    orderBy: { assignedAt: "asc" },
    select: { assignedAt: true },
  });
  const days = windowDays(experiment, firstAssignment?.assignedAt ?? null, range, now);

  const emptyArm = (position: number, variantId: string | null): ArmSeries => ({
    position,
    variantId,
    name: armName(position),
    color: armColor(position),
    daily: days.map(() => ({ v: 0, c: 0 })),
    v: 0,
    c: 0,
    pageViews: 0,
    pageVisitors: 0,
    visibleMs: 0,
    avgVisibleMs: null,
  });
  const arms: ArmSeries[] = [
    emptyArm(0, null),
    ...variants.map((variant) => emptyArm(variant.position, variant.id)),
  ];

  if (days.length > 0) {
    const from = startOfDayInZone(days[0]!, tz);
    const to = new Date(startOfDayInZone(addDays(days[days.length - 1]!, 1), tz).getTime() - 1);
    const dayIndex = new Map(days.map((day, index) => [day, index]));
    const window = { from, to };

    const conversionsQuery =
      mode === "UNIQUE"
        ? db.conversion.findMany({
            where: { experimentId: experiment.id, goalKey, occurredAt: { gte: from, lte: to } },
            select: { variantId: true, occurredAt: true },
          })
        : db.event.findMany({
            where: {
              experimentId: experiment.id,
              type: "conversion",
              occurredAt: { gte: from, lte: to },
              // Rows recorded before goals were keyed have no key; they were URL-goal conversions.
              ...(goalKey === "url"
                ? { OR: [{ goalKey: "url" }, { goalKey: null }] }
                : { goalKey }),
            },
            select: { variantId: true, occurredAt: true },
          });

    const [assignments, conversions, views, visitors, visible] = await Promise.all([
      db.assignment.findMany({
        where: { experimentId: experiment.id, assignedAt: { gte: from, lte: to } },
        select: { variantId: true, assignedAt: true },
      }),
      conversionsQuery,
      eventRepo.countPageViewsByVariant(experiment.id, window),
      eventRepo.countPageViewVisitorsByVariant(experiment.id, window),
      eventRepo.sumVisibleMsByVariant(experiment.id, window),
    ]);

    const bump = (variantId: string | null, at: Date, field: "v" | "c") => {
      const arm = arms.find((a) => a.position === positionOf(variantId));
      const index = dayIndex.get(dayKeyInZone(at, tz));
      if (!arm || index === undefined) return;
      arm.daily[index]![field] += 1;
      arm[field] += 1;
    };
    for (const row of assignments) bump(row.variantId, row.assignedAt, "v");
    for (const row of conversions) bump(row.variantId, row.occurredAt, "c");

    for (const arm of arms) {
      arm.pageViews = views.get(arm.variantId) ?? 0;
      arm.pageVisitors = visitors.get(arm.variantId) ?? 0;
      arm.visibleMs = visible.get(arm.variantId) ?? 0;
      arm.avgVisibleMs = arm.pageViews > 0 ? arm.visibleMs / arm.pageViews : null;
    }
  }

  const totals: DailyPoint = {
    v: arms.reduce((sum, arm) => sum + arm.v, 0),
    c: arms.reduce((sum, arm) => sum + arm.c, 0),
  };

  return {
    experimentId: experiment.id,
    goalKey,
    counting,
    range,
    timezone: tz,
    days,
    arms,
    totals,
    isEmpty: totals.v + totals.c + arms.reduce((sum, arm) => sum + arm.pageViews, 0) === 0,
  };
}

/**
 * Per-arm, per-day `{v, c}` for one goal and counting mode, zero-filled in the project's time
 * zone from launch (or the first data, if earlier) to today — or to the end date for a completed
 * experiment — narrowed to the last 7/14/30 days or all. Plus window totals, page views and
 * approximate visible time per arm. Feed `arms[i].daily` / `{v, c}` to `lib/stats`.
 *
 * `goal` must be the primary goal, `url`, or one of the experiment's secondary metric ids;
 * anything else falls back to the primary goal.
 */
export async function getExperimentResults(
  actorUserId: string,
  projectId: string,
  experimentId: string,
  options: ResultsOptions = {},
  now: Date = new Date(),
): Promise<ExperimentResults> {
  const experiment = await experimentRepo.findExperimentInProject(
    experimentId,
    projectId,
    actorUserId,
  );
  if (!experiment) throw notFound("That experiment does not exist.");
  return computeResults(
    experiment,
    { ...options, goal: allowedGoal(experiment, options.goal) },
    now,
  );
}

function allowedGoal(experiment: ExperimentForResults, goal: string | undefined): string {
  const primary = primaryGoalKey(experiment);
  if (!goal) return primary;
  const allowed = new Set([
    primary,
    ...experiment.secondaryMetricIds,
    ...(experiment.conversionUrl ? ["url"] : []),
  ]);
  return allowed.has(goal) ? goal : primary;
}

/**
 * Results for an experiment reached through a public share token — no actor, because the token
 * is the authorisation and the caller resolved it with `findSharedExperiment`.
 */
export function getSharedResults(
  experiment: ExperimentForResults,
  options: ResultsOptions = {},
  now: Date = new Date(),
): Promise<ExperimentResults> {
  return computeResults(
    experiment,
    { ...options, goal: allowedGoal(experiment, options.goal) },
    now,
  );
}

/**
 * "Goal performance": per-arm `{v, c}` for the primary goal and every secondary goal, over the
 * same window, unique counting. Visitors are the same for every goal (assigned visitors).
 */
export async function getGoalPerformance(
  actorUserId: string,
  projectId: string,
  experimentId: string,
  range: ResultsRange = "all",
  now: Date = new Date(),
): Promise<GoalPerformance[]> {
  const experiment = await experimentRepo.findExperimentInProject(
    experimentId,
    projectId,
    actorUserId,
  );
  if (!experiment) throw notFound("That experiment does not exist.");

  const metrics = await db.metric.findMany({
    where: {
      websiteId: experiment.websiteId,
      id: {
        in: [
          ...experiment.secondaryMetricIds,
          ...(experiment.goalMetricId ? [experiment.goalMetricId] : []),
        ],
      },
    },
  });
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const primary = primaryGoalView(experiment, byId);
  const goals = [
    ...(primary ? [{ goal: primary, primary: true }] : []),
    ...experiment.secondaryMetricIds.flatMap((id) => {
      const metric = byId.get(id);
      return metric && id !== experiment.goalMetricId
        ? [{ goal: metricGoalView(metric), primary: false }]
        : [];
    }),
  ];

  return Promise.all(
    goals.map(async ({ goal, primary: isPrimary }) => {
      const results = await computeResults(
        experiment,
        { range, goal: goal.key, counting: "unique" },
        now,
      );
      return {
        goal,
        primary: isPrimary,
        arms: results.arms.map((arm) => ({ position: arm.position, v: arm.v, c: arm.c })),
      };
    }),
  );
}
