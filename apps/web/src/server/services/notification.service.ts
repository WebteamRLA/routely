import "server-only";

import { env } from "@/env";
import type { MemberRole, NotificationKind } from "@/generated/prisma/client";
import {
  type MemberRoleName,
  type NotificationKindName,
  type RecipientOptions,
  resolveRecipients,
} from "@/lib/notifications";
import { db } from "@/server/db";
import { type EmailMessage, runAfter, sendEmails } from "@/server/email/resend";
import {
  type NotificationPayloads,
  renderNotificationEmail,
} from "@/server/email/templates/notifications";

/**
 * Opt-out notification emails to a workspace's members (spec §5.5).
 *
 * Triggers (WP9: result-ready, tracking-stopped; WP8: Sheets failure; WP6a: pause) call
 * `notify()` and move on. Everything else happens after the response: reading the members and
 * their preferences, choosing recipients, rendering one email per person, sending.
 *
 * Recipients are derived here, never supplied by the caller — the same principle as ownership
 * in the repositories: a trigger says *what happened in which workspace*, and membership decides
 * who hears about it.
 *
 * Latching (send each alert once) is the trigger's job, done with a compare-and-set on its own
 * column (`resultReadyAt`, `trackingAlertSentAt`, `errorNotifiedAt`) *before* calling `notify`.
 * This service does not deduplicate across calls.
 */

// Compile-time guards that the pure module's string unions still match the Prisma enums. If the
// schema gains a kind or role, these lines stop compiling until `lib/notifications.ts` follows.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const kindsMatch: Same<NotificationKind, NotificationKindName> = true;
const rolesMatch: Same<MemberRole, MemberRoleName> = true;
void kindsMatch;
void rolesMatch;

export type NotifyOptions = RecipientOptions;

export interface NotificationSummary {
  /** Members who passed preference, role and exclusion rules. */
  recipients: number;
  sent: number;
  failed: number;
}

/**
 * Resolves recipients, renders and sends — now, in the caller's time. Never throws: a database
 * or delivery failure is logged and reflected in the summary. Cron jobs that want a count use
 * this; request handlers use `notify`.
 */
export async function deliverNotification<K extends NotificationKindName>(
  kind: K,
  workspaceId: string,
  payload: NotificationPayloads[K],
  options: NotifyOptions = {},
): Promise<NotificationSummary> {
  try {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        memberships: {
          select: {
            role: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                emailVerified: true,
                disabledAt: true,
                notificationPrefs: { where: { kind }, select: { enabled: true } },
                _count: { select: { accounts: true } },
              },
            },
          },
        },
      },
    });

    if (!workspace) return { recipients: 0, sent: 0, failed: 0 };

    const candidates = workspace.memberships.flatMap(({ role, user }) =>
      user.email
        ? [
            {
              userId: user.id,
              email: user.email,
              name: user.name,
              role,
              // Google proved the address at sign-in; accounts created before Google sign-ups recorded
              // `emailVerified` would otherwise never be notified (same rule as team.service's inviter check).
              emailVerified: user.emailVerified ?? (user._count.accounts > 0 ? new Date(0) : null),
              disabledAt: user.disabledAt,
              preference: user.notificationPrefs[0]?.enabled ?? null,
            },
          ]
        : [],
    );

    const recipients = resolveRecipients(kind, candidates, options);
    if (recipients.length === 0) return { recipients: 0, sent: 0, failed: 0 };

    const messages: EmailMessage[] = recipients.map((recipient) => ({
      to: recipient.email,
      ...renderNotificationEmail(
        kind,
        payload,
        { name: recipient.name, workspaceName: workspace.name },
        env.NEXT_PUBLIC_APP_URL,
      ),
    }));

    const results = await sendEmails(messages);
    const sent = results.filter((result) => result.ok).length;
    return { recipients: recipients.length, sent, failed: results.length - sent };
  } catch (error) {
    console.error(`[routely] ${kind} notification for workspace ${workspaceId} failed:`, error);
    return { recipients: 0, sent: 0, failed: 0 };
  }
}

/**
 * Schedules a notification to go out after the current response. Returns immediately and never
 * throws, so a trigger inside an action or `/api/v1/events` cannot be slowed or failed by email.
 *
 * Outside a request scope (a CLI script) it runs detached instead; see `runAfter`.
 */
export function notify<K extends NotificationKindName>(
  kind: K,
  workspaceId: string,
  payload: NotificationPayloads[K],
  options: NotifyOptions = {},
): void {
  runAfter(`${kind} notification`, () => deliverNotification(kind, workspaceId, payload, options));
}
