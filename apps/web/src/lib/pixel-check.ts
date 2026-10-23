/**
 * What the pixel dialogs' "Verify your installation" step shows for one install check.
 *
 * Both dialogs (Projects' "Tracking code" and the project dashboard's) render the same three rows
 * and result header from the server's check (`verifyProjectPixelAction` →
 * `pixel.service.verifyInstallation`). The rules live here, once, and pure:
 *
 *  - The verdict rests on the script being in the fetched page's HTML. A server-side fetch runs no
 *    JavaScript, so it cannot itself cause an event — the third row therefore shows the project's
 *    real last hit, never the design's fabricated "Event received just now" (spec §8 row 10).
 *  - The design has no screen for a page that failed to load or a snippet carrying another
 *    project's id; both get their own rows here (spec §2.3 "NEW copy needed").
 */

import { relativeTime } from "@/lib/experiment-time";

export type PixelVerify = "idle" | "checking" | "found" | "missing";

/** The check as the action returns it. */
export interface PixelCheckResult {
  pageLoaded: boolean;
  loadError: string | null;
  scriptFound: boolean;
  antiFlickerFound: boolean;
  wrongSiteId: boolean;
  /** ISO time of the project's last SDK hit, or null when none has arrived. */
  lastSeenAt: string | null;
}

export type CheckTone = "ok" | "fail" | "pending" | "running";

export interface CheckRow {
  title: string;
  text: string;
  tone: CheckTone;
}

export interface CheckHeader {
  title: string;
  label: string;
  kind: "found" | "missing" | "checking" | "idle";
}

/** The dialog state a finished check lands in. */
export function verifyFromResult(result: PixelCheckResult): "found" | "missing" {
  return result.pageLoaded && result.scriptFound ? "found" : "missing";
}

/** "acme.com/pricing" — the URL as the dialog names it. */
export function shortCheckUrl(url: string, domain: string): string {
  return (
    url
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "") || domain
  );
}

function eventsRow(
  result: PixelCheckResult,
  key: string,
  now: Date,
  missTone: CheckTone,
): CheckRow {
  if (result.lastSeenAt) {
    return {
      title: `Event received ${relativeTime(new Date(result.lastSeenAt), now)}`,
      text: `Project ${key} is recording visitors.`,
      tone: "ok",
    };
  }
  return missTone === "fail"
    ? {
        title: "No events received",
        text: `Routely hasn’t received an event for project ${key}.`,
        tone: "fail",
      }
    : {
        title: "No events yet",
        text: "Events arrive when someone visits a page with the script.",
        tone: "pending",
      };
}

/** The three check rows for the dialog's current state. */
export function checkRows(
  verify: PixelVerify,
  result: PixelCheckResult | null,
  ctx: { shortUrl: string; key: string; now: Date },
): CheckRow[] {
  const { shortUrl, key, now } = ctx;
  if (verify === "idle" || verify === "checking" || !result) {
    const tone: CheckTone = verify === "checking" ? "running" : "pending";
    return [
      { title: "Page loads", text: `Routely opens ${shortUrl}.`, tone },
      { title: "Script found", text: "The Routely script is in the page’s <head>.", tone },
      { title: "Events received", text: `Project ${key} sends data to Routely.`, tone },
    ];
  }

  if (!result.pageLoaded) {
    return [
      {
        title: "Page didn’t load",
        text: result.loadError ?? `Routely couldn’t open ${shortUrl}.`,
        tone: "fail",
      },
      {
        title: "Script not checked",
        text: "Routely needs a page that loads to look for the script.",
        tone: "pending",
      },
      eventsRow(result, key, now, "pending"),
    ];
  }

  const loaded: CheckRow = {
    title: "Page loaded",
    text: `${shortUrl} responded normally.`,
    tone: "ok",
  };

  if (result.scriptFound) {
    return [
      loaded,
      {
        title: "Pixel found",
        text: result.antiFlickerFound
          ? "The Routely code is in the page’s <head>, with the anti-flicker snippet above it."
          : "The Routely code is in the page’s <head>.",
        tone: "ok",
      },
      eventsRow(result, key, now, "pending"),
    ];
  }

  if (result.wrongSiteId) {
    return [
      loaded,
      {
        title: "Different Project ID",
        text: "The page has a Routely script for another project. Copy this project’s script and replace it.",
        tone: "fail",
      },
      eventsRow(result, key, now, "fail"),
    ];
  }

  return [
    loaded,
    {
      title: "Pixel not found",
      text: "The page loaded, but the Routely code wasn’t in its <head>.",
      tone: "fail",
    },
    eventsRow(result, key, now, "fail"),
  ];
}

/** The result box's heading and pill. */
export function checkHeader(
  verify: PixelVerify,
  result: PixelCheckResult | null,
  ctx: { shortUrl: string; domain: string },
): CheckHeader {
  if (verify === "checking") {
    return { title: `Checking ${ctx.shortUrl}…`, label: "Checking", kind: "checking" };
  }
  if (verify === "found") {
    return { title: `The pixel is working on ${ctx.domain}`, label: "Verified", kind: "found" };
  }
  if (verify === "missing") {
    if (result && !result.pageLoaded) {
      return { title: `We couldn’t load ${ctx.shortUrl}`, label: "Not loaded", kind: "missing" };
    }
    return {
      title: `We couldn’t find the pixel on ${ctx.shortUrl}`,
      label: "Not found",
      kind: "missing",
    };
  }
  return { title: "Verification status", label: "Not checked yet", kind: "idle" };
}

/** The "Things to check" tips belong to a page that loaded without our script. */
export function showTips(verify: PixelVerify, result: PixelCheckResult | null): boolean {
  return verify === "missing" && (!result || result.pageLoaded);
}
