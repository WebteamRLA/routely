import "server-only";

import { retentionCutoff, VISITOR_DAY_RETENTION_DAYS } from "@/lib/notification-triggers";
import { utcDayKey } from "@/lib/utc-day";
import { prunePageVisitorDays } from "@/server/repositories/page-visitor-day.repository";
import { pruneWebsiteVisitorDays } from "@/server/repositories/visitor-day.repository";

/**
 * Retention for the site-wide hit tables (spec §1.4): rows older than 400 days are deleted by the
 * daily cron. Every screen reads the last 30 days at most; the rest is kept as history, and
 * dropped after that so two tables that grow with every visitor of every customer stay bounded.
 *
 * Only these two tables. Experiment data (assignments, events, conversions) is the customer's
 * results and has no retention policy yet (CLAUDE.md §11).
 */

export interface RetentionSummary {
  /** The first UTC day kept; everything before it was deleted. */
  keptFrom: string;
  retentionDays: number;
  websiteVisitorDays: number;
  pageVisitorDays: number;
}

export async function pruneVisitorDays(now: Date = new Date()): Promise<RetentionSummary> {
  const before = retentionCutoff(now);
  // One after the other: on serverless the pool is a single connection anyway, and two large
  // deletes at once would only contend for it.
  const websiteVisitorDays = await pruneWebsiteVisitorDays(before);
  const pageVisitorDays = await prunePageVisitorDays(before);
  return {
    keptFrom: utcDayKey(before),
    retentionDays: VISITOR_DAY_RETENTION_DAYS,
    websiteVisitorDays,
    pageVisitorDays,
  };
}
