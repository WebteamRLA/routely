import "server-only";

import type { Prisma, SheetsSyncRun, SheetsSyncStatus } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for the per-day sync claim.
 *
 * The unique key on `[websiteId, day]` is what makes a day's rows land once. This module owns
 * the two operations that depend on it being enforced by the database rather than by a check:
 * `claimRun`, which relies on the insert failing, and `reclaimRun`, which relies on a
 * compare-and-set.
 *
 * No `userId` anywhere. A run belongs to a website, and the website is what was already resolved
 * through the actor — the same division as the analytics aggregation functions, where ownership is
 * the caller's job precisely so it is done once, visibly, at the top.
 */

/** Prisma's unique-constraint-violation code. */
const UNIQUE_VIOLATION = "P2002";

/** How long a PENDING run is assumed to be held by a live worker before it is fair game. */
export const LEASE_MS = 10 * 60_000;

/** Attempts after which a day is abandoned rather than retried forever. */
export const MAX_ATTEMPTS = 5;

export type ClaimResult =
  /** The caller holds the claim and must write, then complete it. */
  | { outcome: "claimed"; run: SheetsSyncRun }
  /** Someone already wrote this day successfully. */
  | { outcome: "already-synced"; run: SheetsSyncRun }
  /** Another worker holds an unexpired lease, or the row is in a state only a human may resolve. */
  | { outcome: "skipped"; run: SheetsSyncRun; reason: string };

/**
 * Claims one day for one connection, or explains why it cannot be claimed.
 *
 * The insert is attempted first and the unique violation is *expected* rather than avoided. A
 * read-then-insert would leave a window between the two in which a second worker inserts, and
 * two appends of the same day is the one outcome this design exists to prevent. Letting the
 * database arbitrate removes the window entirely.
 */
export async function claimRun(
  websiteId: string,
  day: string,
  destination: { spreadsheetId: string | null; sheetTitle: string | null },
  now: Date = new Date(),
  client: DbClient = db,
): Promise<ClaimResult> {
  try {
    const run = await client.sheetsSyncRun.create({
      data: {
        websiteId,
        day,
        status: "PENDING",
        attempts: 1,
        startedAt: now,
        spreadsheetId: destination.spreadsheetId,
        sheetTitle: destination.sheetTitle,
      },
    });

    return { outcome: "claimed", run };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await client.sheetsSyncRun.findUnique({
    where: { websiteId_day: { websiteId, day } },
  });

  // Gone between the failed insert and this read — another worker deleted it, which nothing does
  // today. Reported as skipped rather than retried, because a loop here could spin.
  if (!existing) {
    throw new Error(`Sync run for ${day} vanished between insert and read`);
  }

  if (existing.status === "SUCCEEDED") {
    return { outcome: "already-synced", run: existing };
  }

  /*
   * UNKNOWN means the append may or may not have landed — a timeout, or a process killed in
   * flight. Retrying would risk appending the day twice, and Sheets' append API has no
   * idempotency key with which to deduplicate it. So this is never reclaimed automatically; the
   * UI surfaces it and a human who has looked at the spreadsheet decides.
   */
  if (existing.status === "UNKNOWN") {
    return {
      outcome: "skipped",
      run: existing,
      reason: "A previous attempt was interrupted and may have written this day already.",
    };
  }

  if (existing.status === "PENDING" && now.getTime() - existing.startedAt.getTime() < LEASE_MS) {
    return { outcome: "skipped", run: existing, reason: "Another sync is already running." };
  }

  if (existing.attempts >= MAX_ATTEMPTS) {
    return {
      outcome: "skipped",
      run: existing,
      reason: `Gave up after ${existing.attempts} attempts.`,
    };
  }

  const reclaimed = await reclaimRun(existing, destination, now, client);

  return reclaimed
    ? { outcome: "claimed", run: reclaimed }
    : { outcome: "skipped", run: existing, reason: "Another sync claimed this day first." };
}

/**
 * Takes over a FAILED run, or a PENDING one whose lease has expired.
 *
 * The compare-and-set is what makes this safe between processes without a lock: `status` and
 * `updatedAt` are both in the `where`, so of two workers that read the same row, only one
 * `updateMany` matches and the other sees `count === 0`. That is the same structural trick the
 * other repositories use for tenant filters — put the condition in the write, not before it.
 */
async function reclaimRun(
  observed: SheetsSyncRun,
  destination: { spreadsheetId: string | null; sheetTitle: string | null },
  now: Date,
  client: DbClient,
): Promise<SheetsSyncRun | null> {
  const result = await client.sheetsSyncRun.updateMany({
    where: {
      id: observed.id,
      status: observed.status,
      updatedAt: observed.updatedAt,
    },
    data: {
      status: "PENDING",
      startedAt: now,
      finishedAt: null,
      attempts: { increment: 1 },
      error: null,
      spreadsheetId: destination.spreadsheetId,
      sheetTitle: destination.sheetTitle,
    },
  });

  if (result.count !== 1) return null;

  return client.sheetsSyncRun.findUnique({ where: { id: observed.id } });
}

/** Records the outcome of a claimed run. */
export function completeRun(
  runId: string,
  outcome: {
    status: Exclude<SheetsSyncStatus, "PENDING">;
    rowsWritten?: number | null;
    updatedRange?: string | null;
    error?: string | null;
  },
  now: Date = new Date(),
  client: DbClient = db,
): Promise<Prisma.BatchPayload> {
  return client.sheetsSyncRun.updateMany({
    where: { id: runId },
    data: {
      status: outcome.status,
      rowsWritten: outcome.rowsWritten ?? null,
      updatedRange: outcome.updatedRange ?? null,
      error: outcome.error ?? null,
      finishedAt: now,
    },
  });
}

/** The most recent runs for one website, newest first. Feeds the integrations page. */
export function listRecentRuns(
  websiteId: string,
  limit = 7,
  client: DbClient = db,
): Promise<SheetsSyncRun[]> {
  // `day` is ISO-8601 text, so lexicographic order is chronological order.
  return client.sheetsSyncRun.findMany({
    where: { websiteId },
    orderBy: { day: "desc" },
    take: limit,
  });
}

/**
 * Days within a window whose write definitely failed and which are still worth retrying.
 *
 * Deliberately excludes UNKNOWN and PENDING: the first might already have been written, and the
 * second may be held by a live worker. Only FAILED is provably safe to repeat, because Sheets
 * applies an append atomically per request — a rejection is evidence that nothing landed.
 */
export function listRetryableRuns(
  websiteId: string,
  days: string[],
  client: DbClient = db,
): Promise<SheetsSyncRun[]> {
  if (days.length === 0) return Promise.resolve([]);

  return client.sheetsSyncRun.findMany({
    where: {
      websiteId,
      day: { in: days },
      status: "FAILED",
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { day: "asc" },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
