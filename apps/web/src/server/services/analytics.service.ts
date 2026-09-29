import "server-only";

import { armLabel } from "@/lib/sheet-rows";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import * as assignmentRepo from "@/server/repositories/assignment.repository";
import * as conversionRepo from "@/server/repositories/conversion.repository";
import * as eventRepo from "@/server/repositories/event.repository";
import * as experimentRepo from "@/server/repositories/experiment.repository";
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

export interface ArmStats {
  /** Visitors bucketed into this arm, whether or not they went on to load a page. */
  assignedVisitors: number;
  /** Distinct visitors who actually loaded a page. */
  visitors: number;
  /** Total page views, including repeat visits by the same visitor. */
  pageViews: number;
  /** Page views per visitor, or null when there is nothing to divide. */
  viewsPerVisitor: number | null;
  /** Total reported visible time, in milliseconds. Approximate — see the note above. */
  totalVisibleMs: number;
  /**
   * Approximate visible time per page view, in milliseconds, or null when nothing has been
   * recorded. Averaged over page views rather than visitors, because that is the unit the
   * measurement is taken in.
   */
  avgVisibleMs: number | null;
  /** Visitors who reached the experiment's goal. At most one per assignment. */
  conversions: number;
  /**
   * Conversions divided by **assigned** visitors, as a fraction — or null when nobody has been
   * assigned yet.
   *
   * The denominator is deliberately the assigned count rather than the visitors who loaded a
   * page. Everyone bucketed had the opportunity to convert, and using a smaller denominator
   * would quietly inflate the rate for whichever arm loses more visitors before its page
   * renders — which is precisely the difference a redirect test is measuring.
   */
  conversionRate: number | null;
}

export interface ExperimentVariantStats {
  variantId: string;
  stats: ArmStats;
  /**
   * Relative change in conversion rate versus control, as a fraction: `0.42` means this
   * variant converts 42% better. Null when it cannot be computed (control has no conversions
   * to improve on, or either side has no rate yet).
   */
  lift: number | null;
}

export interface ExperimentStats {
  experimentId: string;
  control: ArmStats;
  variants: ExperimentVariantStats[];
  /**
   * True when nothing at all has been recorded — drives the dashboard's empty state.
   *
   * Checks assignments and conversions as well as page views: an experiment can have bucketed
   * visitors, or even conversions, before any page view arrives, and reporting that as empty
   * would tell the customer their installation is not working when it is.
   */
  isEmpty: boolean;
}

function armStats(
  variantId: string | null,
  assigned: Map<string | null, number>,
  visitors: Map<string | null, number>,
  views: Map<string | null, number>,
  visibleMs: Map<string | null, number>,
  conversions: Map<string | null, number>,
): ArmStats {
  const pageViews = views.get(variantId) ?? 0;
  const uniqueVisitors = visitors.get(variantId) ?? 0;
  const totalVisibleMs = visibleMs.get(variantId) ?? 0;
  const assignedVisitors = assigned.get(variantId) ?? 0;
  const converted = conversions.get(variantId) ?? 0;

  return {
    assignedVisitors,
    visitors: uniqueVisitors,
    pageViews,
    viewsPerVisitor: uniqueVisitors > 0 ? pageViews / uniqueVisitors : null,
    totalVisibleMs,
    // Guarded on page views, not on the total: a page with zero reported time is a legitimate
    // zero, whereas dividing by zero views would invent a number from nothing.
    avgVisibleMs: pageViews > 0 ? totalVisibleMs / pageViews : null,
    conversions: converted,
    conversionRate: assignedVisitors > 0 ? converted / assignedVisitors : null,
  };
}

/**
 * Page view and visitor counts for every arm.
 *
 * The five underlying queries are independent, so they are issued together: the dashboard
 * waits for the slowest rather than the sum.
 */
export async function getExperimentStats(
  actorUserId: string,
  experimentId: string,
  range?: DateRange,
): Promise<ExperimentStats> {
  const experiment = await experimentRepo.findExperimentForUser(experimentId, actorUserId);
  if (!experiment) {
    throw notFound("That experiment does not exist.");
  }

  return computeStats(
    experiment.id,
    experiment.variants.map((variant) => variant.id),
    range,
  );
}

/**
 * Stats for an experiment reached through a public share token.
 *
 * Takes no actor because the token *is* the authorisation, and the caller has already resolved
 * it (and its variant list, which is passed in rather than re-fetched here). Kept as a
 * separate, explicitly-named entry point rather than making `actorUserId` optional: an optional
 * owner check is one forgotten argument away from an unauthorised read, whereas a
 * differently-named function has to be chosen deliberately.
 */
export function getSharedExperimentStats(
  experimentId: string,
  variantIds: string[],
  range?: DateRange,
): Promise<ExperimentStats> {
  return computeStats(experimentId, variantIds, range);
}

async function computeStats(
  experimentId: string,
  variantIds: string[],
  range?: DateRange,
): Promise<ExperimentStats> {
  const [assigned, visitors, views, visibleMs, conversions] = await Promise.all([
    assignmentRepo.countAssignmentsByVariant(experimentId, range),
    eventRepo.countPageViewVisitorsByVariant(experimentId, range),
    eventRepo.countPageViewsByVariant(experimentId, range),
    eventRepo.sumVisibleMsByVariant(experimentId, range),
    conversionRepo.countConversionsByVariant(experimentId, range),
  ]);

  const armStatsFor = (variantId: string | null) =>
    armStats(variantId, assigned, visitors, views, visibleMs, conversions);

  const control = armStatsFor(null);
  const variants = variantIds.map((variantId) => {
    const stats = armStatsFor(variantId);
    return { variantId, stats, lift: relativeLift(control.conversionRate, stats.conversionRate) };
  });

  const recorded =
    control.assignedVisitors +
    control.pageViews +
    control.conversions +
    variants.reduce(
      (sum, variant) =>
        sum + variant.stats.assignedVisitors + variant.stats.pageViews + variant.stats.conversions,
      0,
    );

  return {
    experimentId,
    control,
    variants,
    isEmpty: recorded === 0,
  };
}

/** A variant's rate against control's, as a fraction. Null wherever the division is not meaningful. */
export function relativeLift(
  controlRate: number | null,
  variantRate: number | null,
): number | null {
  if (controlRate === null || variantRate === null) return null;
  // A control that has never converted gives no baseline to improve on. Reporting an infinite
  // lift — or quietly substituting a large number — would be worse than reporting nothing.
  if (controlRate === 0) return null;
  return (variantRate - controlRate) / controlRate;
}

/**
 * Stats for many experiments at once, for the experiments list.
 *
 * Two grouped queries in total, regardless of how many experiments are listed — the
 * alternative, calling `getExperimentStats` per row, is a query per experiment per metric and
 * degrades as a customer accumulates tests.
 *
 * Only the metrics the list actually shows are computed: visitors, conversions and a lift.
 * Page views and visible time are left to the detail page rather than fetched and discarded.
 */
export interface ExperimentSummary {
  experimentId: string;
  assignedVisitors: number;
  conversions: number;
  controlRate: number | null;
  /** The best-performing variant's conversion rate — with more than one variant, this is not
   * literally "the" variant, so it's labelled as the best one wherever it's rendered. */
  bestVariantRate: number | null;
  /** Relative change of the best-performing variant over control. */
  lift: number | null;
}

export async function getExperimentSummaries(
  actorUserId: string,
  experimentIds: string[],
  range?: DateRange,
): Promise<Map<string, ExperimentSummary>> {
  const summaries = new Map<string, ExperimentSummary>();
  if (experimentIds.length === 0) return summaries;

  // Ownership is enforced by scoping the aggregation itself, not by trusting the caller to
  // have filtered the ids: an id the actor does not own simply contributes no rows.
  const owned = { website: { userId: actorUserId } };

  const [assignments, conversions] = await Promise.all([
    db.assignment.groupBy({
      by: ["experimentId", "variantId"],
      where: {
        experimentId: { in: experimentIds },
        experiment: owned,
        // Same window as the conversions below, so the rate's numerator and denominator
        // always describe the same period.
        ...(range ? { assignedAt: { gte: range.from, lte: range.to } } : {}),
      },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["experimentId", "variantId"],
      where: {
        experimentId: { in: experimentIds },
        experiment: owned,
        ...(range ? { occurredAt: { gte: range.from, lte: range.to } } : {}),
      },
      _count: { _all: true },
    }),
  ]);

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

  for (const experimentId of experimentIds) {
    const assigned = assignedByExperiment.get(experimentId) ?? new Map<string | null, number>();
    const converted = convertedByExperiment.get(experimentId) ?? new Map<string | null, number>();

    const controlAssigned = assigned.get(null) ?? 0;
    const controlConverted = converted.get(null) ?? 0;
    const controlRate = controlAssigned > 0 ? controlConverted / controlAssigned : null;

    let bestVariantRate: number | null = null;
    for (const [variantId, variantAssigned] of assigned) {
      if (variantId === null || variantAssigned === 0) continue;
      const variantRate = (converted.get(variantId) ?? 0) / variantAssigned;
      if (bestVariantRate === null || variantRate > bestVariantRate) {
        bestVariantRate = variantRate;
      }
    }

    const totalAssigned = [...assigned.values()].reduce((sum, count) => sum + count, 0);
    const totalConverted = [...converted.values()].reduce((sum, count) => sum + count, 0);

    summaries.set(experimentId, {
      experimentId,
      assignedVisitors: totalAssigned,
      conversions: totalConverted,
      controlRate,
      bestVariantRate,
      lift: relativeLift(controlRate, bestVariantRate),
    });
  }

  return summaries;
}

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
      by: ["experimentId", "variantId"],
      where: {
        experiment: owned,
        // Same window as the assignments above, so the rate's numerator and denominator
        // always describe the same period.
        occurredAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    }),
  ]);

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
        // Identical to `armStats` — assigned visitors, not visitors who loaded a page. See the
        // note on `ArmStats.conversionRate` for why, and why this must not diverge.
        conversionRate: assignedVisitors > 0 ? conversionCount / assignedVisitors : null,
      });
    }
  }

  return rows;
}
