/**
 * What both creation wizards share once they edit a real draft rather than the design's mock:
 * the project context, the draft ↔ form conversions that are the same for both, and the
 * "Draft saved …" / resume copy.
 *
 * Pure and client-safe: the server page builds the initial state with it, and the wizard builds
 * its autosave patches with it.
 */

import { formatClockTime, formatMonthDay } from "@/lib/experiment-time";
import {
  type DeviceTypeName,
  type LaunchIssue,
  normalizeDevices,
  pageKey,
} from "@/lib/launch-rules";
import { utcDayKey } from "@/lib/utc-day";

/** The project and draft a wizard is working on. */
export interface WizardCtx {
  /** False for the design's `?view=` demo states, which keep their simulated behaviour. */
  live: boolean;
  /** Null until the first edit creates the draft. */
  draftId: string | null;
  projectId: string;
  domain: string;
  /** The website's public site id, shown beside the snippet. */
  pixelKey: string;
  /** The install snippet (`lib/snippet.ts`). */
  snippet: string;
  /** Visitors a day to the tested page over 30 days; null = no estimate. */
  baseline: number | null;
  /** A Viewer: the draft is shown, nothing is saved or launched. */
  readOnly: boolean;
}

/** A device-flags record, as both wizards hold targeting. */
export interface DeviceFlags {
  desktop: boolean;
  mobile: boolean;
  tablet: boolean;
}

export function devicesFromFlags(
  targeting: "all" | "specific",
  flags: DeviceFlags,
): DeviceTypeName[] {
  if (targeting === "all") return [];
  const list: DeviceTypeName[] = [];
  if (flags.desktop) list.push("DESKTOP");
  if (flags.mobile) list.push("MOBILE");
  if (flags.tablet) list.push("TABLET");
  return list;
}

export function flagsFromDevices(devices: readonly DeviceTypeName[]): {
  targeting: "all" | "specific";
  devices: DeviceFlags;
} {
  const list = normalizeDevices(devices);
  return {
    targeting: list.length > 0 ? "specific" : "all",
    devices: {
      desktop: list.includes("DESKTOP"),
      mobile: list.includes("MOBILE"),
      tablet: list.includes("TABLET"),
    },
  };
}

/** A typed percentage as a whole number for storage; null when it isn't one yet. */
export function typedInt(value: string | undefined): number | null {
  const n = parseInt(value ?? "", 10);
  return Number.isNaN(n) ? null : Math.min(999, Math.max(0, n));
}

/** `Draft saved` (today) / `Draft saved yesterday` / `Draft saved Oct 9` — UTC days. */
export function savedLabelFor(updatedAt: Date, now: Date): string {
  const day = utcDayKey(updatedAt);
  if (day === utcDayKey(now)) return "Draft saved";
  if (day === utcDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) {
    return "Draft saved yesterday";
  }
  return `Draft saved ${formatMonthDay(updatedAt)}`;
}

/** `Oct 9 at 2:48 PM` / `yesterday at 4:05 PM` / `today at 9:12 AM`, for the resume banner. */
export function savedAtPhrase(updatedAt: Date, now: Date): string {
  const day = utcDayKey(updatedAt);
  const when =
    day === utcDayKey(now)
      ? "today"
      : day === utcDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
        ? "yesterday"
        : formatMonthDay(updatedAt);
  return `${when} at ${formatClockTime(updatedAt)}`;
}

/**
 * The step a draft reopens at: where it was left, but never past the first step with a problem
 * (the wizard only lets a customer forward through valid steps).
 */
export function resumeStep(wizardStep: number, issues: readonly LaunchIssue[]): number {
  const stored = Math.min(5, Math.max(1, Math.trunc(wizardStep) || 1));
  const firstBad = issues.reduce((min, issue) => Math.min(min, issue.step), 5);
  return Math.min(stored, firstBad);
}

/**
 * Tracking-check results mapped onto a wizard's pages: `ok` / `missing` per page id, plus the
 * server's reason for each missing page (e.g. a snippet for a different project), or `error`
 * when any page couldn't be checked (the design's "We couldn't check your pages").
 *
 * A page with no URL yet (the goal page before step 4) isn't checked and gets no result, so it
 * neither passes nor blocks verification.
 */
export function trackingFromChecks(
  pages: readonly { id: string; url: string }[],
  checks: readonly {
    urlKey: string | null;
    result: "OK" | "MISSING" | "ERROR";
    detail?: string | null;
  }[],
):
  | { status: "done"; results: Record<string, "ok" | "missing">; details: Record<string, string> }
  | { status: "error" } {
  const byKey = new Map(checks.map((check) => [check.urlKey, check]));
  const results: Record<string, "ok" | "missing"> = {};
  const details: Record<string, string> = {};
  for (const page of pages) {
    if (!page.url.trim()) continue;
    const key = pageKey(page.url);
    const check = key ? byKey.get(key) : undefined;
    if (!check || check.result === "ERROR") return { status: "error" };
    results[page.id] = check.result === "OK" ? "ok" : "missing";
    if (check.result === "MISSING" && check.detail) details[page.id] = check.detail;
  }
  return { status: "done", results, details };
}
