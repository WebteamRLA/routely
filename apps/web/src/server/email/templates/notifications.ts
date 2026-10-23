import { routes } from "@/lib/routes";
import {
  type Paragraph,
  type RenderedEmail,
  greeting,
  inlineText,
  renderEmail,
  subjectText,
} from "@/server/email/templates/layout";

/**
 * Opt-out notification emails (spec §5.5). Each carries a footer naming the workspace and a
 * link to `/settings?tab=notifications`, where the recipient can switch it off.
 *
 * Copy note: "A result is ready" deliberately does not name a winner or claim significance. The
 * results page decides what it may say about a leader (CLAUDE.md §7, spec D1); the email only
 * says there is enough data to look.
 */

/** Fields every notification shares; `notify()` fills them per recipient. */
export interface NotificationEnvelope {
  recipientName: string | null;
  workspaceName: string;
  /** `/settings?tab=notifications` — absolute. */
  preferencesUrl: string;
}

function footer(envelope: NotificationEnvelope, what: string): Paragraph[] {
  return [
    `You're getting this because you're a member of ${inlineText(envelope.workspaceName) || "a Routely workspace"} and have “${what}” emails turned on.`,
    ["Turn them off in ", { link: "Settings → Notifications", url: envelope.preferencesUrl }, "."],
  ];
}

// --- A result is ready -----------------------------------------------------------------------

export interface ResultReadyInput extends NotificationEnvelope {
  experimentName: string;
  projectName: string;
  /** `/experiments/<id>` — absolute. */
  experimentUrl: string;
}

export function resultReadyTemplate(input: ResultReadyInput): RenderedEmail {
  const experiment = inlineText(input.experimentName);
  return renderEmail(`A result is ready: ${subjectText(experiment)}`, {
    preheader: `${experiment} has enough data to review.`,
    heading: "A result is ready",
    paragraphs: [
      greeting(input.recipientName),
      [
        { strong: experiment },
        " in ",
        { strong: inlineText(input.projectName) },
        " has collected enough visitors and conversions to review its results.",
      ],
    ],
    action: { label: "View results", url: input.experimentUrl },
    footer: footer(input, "A result is ready"),
  });
}

// --- Tracking stops --------------------------------------------------------------------------

export interface TrackingStoppedInput extends NotificationEnvelope {
  projectName: string;
  /** The project's domain, e.g. "acme.com". */
  domain: string;
  /** The last hit Routely received. */
  lastSeenAt: Date;
  /** `/projects/<id>` — absolute. */
  projectUrl: string;
}

export function trackingStoppedTemplate(input: TrackingStoppedInput): RenderedEmail {
  const project = inlineText(input.projectName);
  const hours = Math.max(24, Math.floor((Date.now() - input.lastSeenAt.getTime()) / 3_600_000));
  return renderEmail(`Tracking stopped on ${subjectText(project)}`, {
    preheader: `No events from ${inlineText(input.domain)} for ${hours} hours.`,
    heading: "Tracking stopped",
    paragraphs: [
      greeting(input.recipientName),
      [
        "Routely hasn't received any events from ",
        { strong: inlineText(input.domain) },
        ` (${project}) for ${hours} hours. Running experiments there aren't recording visitors or conversions.`,
      ],
      "Check that the Routely snippet is still in the <head> of your pages and that the site is up.",
    ],
    action: { label: "Check the installation", url: input.projectUrl },
    footer: footer(input, "Tracking stops"),
  });
}

// --- Google Sheets sync fails ----------------------------------------------------------------

export interface SheetsSyncFailedInput extends NotificationEnvelope {
  projectName: string;
  /** The stored `lastError`, already customer-safe. */
  error: string;
  /** `/projects/<id>` — absolute. */
  projectUrl: string;
}

export function sheetsSyncFailedTemplate(input: SheetsSyncFailedInput): RenderedEmail {
  const project = inlineText(input.projectName);
  return renderEmail(`Google Sheets sync failed for ${subjectText(project)}`, {
    preheader: "Routely can't write to the linked spreadsheet.",
    heading: "Google Sheets sync failed",
    paragraphs: [
      greeting(input.recipientName),
      [
        "Routely can't write to the spreadsheet linked to ",
        { strong: project },
        ". The last attempt failed with:",
      ],
      [{ strong: inlineText(input.error) }],
      "Results are safe in Routely; the spreadsheet will catch up once the connection works again. Reconnecting Google or choosing the spreadsheet again usually fixes it.",
    ],
    action: { label: "Open the project", url: input.projectUrl },
    footer: footer(input, "Google Sheets sync fails"),
  });
}

// --- An experiment is paused -----------------------------------------------------------------

export interface ExperimentPausedInput extends NotificationEnvelope {
  experimentName: string;
  projectName: string;
  /** Who paused it. */
  actorName: string | null;
  experimentUrl: string;
}

export function experimentPausedTemplate(input: ExperimentPausedInput): RenderedEmail {
  const experiment = inlineText(input.experimentName);
  const actor = inlineText(input.actorName ?? "") || "A teammate";
  return renderEmail(`${subjectText(experiment)} was paused`, {
    preheader: `${actor} paused ${experiment}.`,
    heading: "An experiment was paused",
    paragraphs: [
      greeting(input.recipientName),
      [
        { strong: actor },
        " paused ",
        { strong: experiment },
        " in ",
        { strong: inlineText(input.projectName) },
        ". Visitors now see the original page until it's resumed.",
      ],
    ],
    action: { label: "View experiment", url: input.experimentUrl },
    footer: footer(input, "An experiment is paused"),
  });
}

// --- Dispatch by kind ------------------------------------------------------------------------

/**
 * What a caller of `notify()` supplies for each kind: ids and display values, never URLs or
 * recipients — those are derived, so a trigger cannot point an email somewhere else.
 */
export interface NotificationPayloads {
  RESULT_READY: { experimentId: string; experimentName: string; projectName: string };
  TRACKING_STOPPED: { websiteId: string; projectName: string; domain: string; lastSeenAt: Date };
  SHEETS_SYNC_FAILED: { websiteId: string; projectName: string; error: string };
  EXPERIMENT_PAUSED: {
    experimentId: string;
    experimentName: string;
    projectName: string;
    actorName: string | null;
  };
}

export type NotificationKindKey = keyof NotificationPayloads;

/** Absolute URL for an app path, on the configured origin. */
export function appLink(appUrl: string, path: string): string {
  return new URL(path, appUrl.replace(/\/+$/, "") + "/").toString();
}

/** `/settings?tab=notifications` — where every notification email sends its reader. */
export const NOTIFICATION_PREFERENCES_PATH = `${routes.settings}?tab=notifications`;

/** Renders the email for one notification and one recipient. */
export function renderNotificationEmail<K extends NotificationKindKey>(
  kind: K,
  payload: NotificationPayloads[K],
  recipient: { name: string | null; workspaceName: string },
  appUrl: string,
): RenderedEmail {
  const envelope: NotificationEnvelope = {
    recipientName: recipient.name,
    workspaceName: recipient.workspaceName,
    preferencesUrl: appLink(appUrl, NOTIFICATION_PREFERENCES_PATH),
  };

  // The casts are sound: `kind` and `payload` are tied by the generic signature, which a
  // `switch` on `kind` cannot narrow through.
  switch (kind) {
    case "RESULT_READY": {
      const p = payload as NotificationPayloads["RESULT_READY"];
      return resultReadyTemplate({
        ...envelope,
        experimentName: p.experimentName,
        projectName: p.projectName,
        experimentUrl: appLink(appUrl, routes.experiments.detail(p.experimentId)),
      });
    }
    case "TRACKING_STOPPED": {
      const p = payload as NotificationPayloads["TRACKING_STOPPED"];
      return trackingStoppedTemplate({
        ...envelope,
        projectName: p.projectName,
        domain: p.domain,
        lastSeenAt: p.lastSeenAt,
        projectUrl: appLink(appUrl, routes.projects.detail(p.websiteId)),
      });
    }
    case "SHEETS_SYNC_FAILED": {
      const p = payload as NotificationPayloads["SHEETS_SYNC_FAILED"];
      return sheetsSyncFailedTemplate({
        ...envelope,
        projectName: p.projectName,
        error: p.error,
        projectUrl: appLink(appUrl, routes.projects.detail(p.websiteId)),
      });
    }
    case "EXPERIMENT_PAUSED": {
      const p = payload as NotificationPayloads["EXPERIMENT_PAUSED"];
      return experimentPausedTemplate({
        ...envelope,
        experimentName: p.experimentName,
        projectName: p.projectName,
        actorName: p.actorName,
        experimentUrl: appLink(appUrl, routes.experiments.detail(p.experimentId)),
      });
    }
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown notification kind: ${String(unreachable)}`);
    }
  }
}
