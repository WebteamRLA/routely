import "server-only";

import type { Conversion } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";

/**
 * Data access for conversions.
 */

export interface ConversionInput {
  experimentId: string;
  visitorId: string;
  assignmentId: string;
  /** `null` is the control arm — see schema.prisma's header comment. */
  variantId: string | null;
  url: string;
  /** `"url"` for the URL goal, otherwise the metric id. */
  goalKey: string;
  occurredAt: Date;
}

/**
 * Records a conversion, ignoring repeats.
 *
 * Idempotency is enforced by the database, not by a read-then-write check: the unique
 * constraint on `(assignmentId, goalKey)` means a duplicate beacon, a reloaded thank-you page, or two
 * concurrent requests all collapse to the first conversion. `skipDuplicates` turns the
 * resulting constraint violation into a no-op instead of an error the caller must interpret.
 *
 * Returns true when this call was the one that recorded the conversion.
 */
export async function recordConversion(
  input: ConversionInput,
  client: DbClient = db,
): Promise<boolean> {
  const result = await client.conversion.createMany({
    data: [input],
    skipDuplicates: true,
  });

  return result.count === 1;
}

export function findConversion(
  assignmentId: string,
  goalKey: string,
  client: DbClient = db,
): Promise<Conversion | null> {
  return client.conversion.findUnique({
    where: { assignmentId_goalKey: { assignmentId, goalKey } },
  });
}
