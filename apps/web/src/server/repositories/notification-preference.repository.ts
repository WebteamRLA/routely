import "server-only";

import type { NotificationKind } from "@/generated/prisma/enums";
import { type DbClient, db } from "@/server/db";

/**
 * The actor's own email-notification switches. A missing row means the kind's default
 * (`lib/notifications.ts`), so only explicit choices are stored.
 */

export function listPreferences(userId: string, client: DbClient = db) {
  return client.notificationPreference.findMany({
    where: { userId },
    select: { kind: true, enabled: true },
  });
}

export async function setPreference(
  userId: string,
  kind: NotificationKind,
  enabled: boolean,
  client: DbClient = db,
): Promise<void> {
  await client.notificationPreference.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, enabled },
    update: { enabled },
  });
}
