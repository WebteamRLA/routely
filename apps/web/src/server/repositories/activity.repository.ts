import "server-only";

import type { ExperimentActivity, ExperimentActivityType, Prisma } from "@/generated/prisma/client";
import { type DbClient, db } from "@/server/db";
import { experimentAccess } from "@/server/repositories/access";

/**
 * The experiment activity log (spec §1.6): Created, Launched, Paused, Resumed, Ended, Edited and
 * the system's Result ready.
 *
 * Rows are written by `experiment.service` **inside the same transaction as the change they
 * record** — pass the transaction handle as `client` — so the log can never claim a launch that
 * rolled back, or miss one that committed. Reads are tenant-scoped like everything else.
 */

export interface ActivityInput {
  experimentId: string;
  type: ExperimentActivityType;
  /** Null for system entries. */
  actorId: string | null;
  /** EDITED: `{ fields, changes: { field: { from, to } } }`. */
  meta?: Prisma.InputJsonValue;
}

export function createActivity(
  input: ActivityInput,
  client: DbClient = db,
): Promise<ExperimentActivity> {
  return client.experimentActivity.create({
    data: {
      experimentId: input.experimentId,
      type: input.type,
      actorId: input.actorId,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    },
  });
}

export type ActivityWithActor = Prisma.ExperimentActivityGetPayload<{
  include: { actor: { select: { id: true; name: true; email: true } } };
}>;

/**
 * An experiment's log, newest first — only if `userId` is a member of its workspace (an empty
 * list otherwise, which the caller cannot tell from "no activity"; resolve the experiment through
 * an access-checked read first when the difference matters).
 */
export function listActivity(
  experimentId: string,
  userId: string,
  options: { take?: number } = {},
  client: DbClient = db,
): Promise<ActivityWithActor[]> {
  return client.experimentActivity.findMany({
    where: { experimentId, experiment: experimentAccess(userId) },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 50,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}
