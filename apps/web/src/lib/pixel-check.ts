/**
 * What the pixel dialogs' "Verify your installation" step shows for one install check.
 *
 * Both dialogs (Projects' "Tracking code" and the project dashboard's) render the same two rows
 * and result header from the server's check (`verifyProjectPixelAction` →
 * `pixel.service.verifyInstallation`). The rules live here, once, and pure:
 *
 *  - The verdict rests on the script being in the fetched page's HTML: the page loads, the script
 *    is in it. The design's third "Events received" row was removed at the user's request
 *    (2026-10-27) — a server-side fetch runs no JavaScript, so it could never cause an event.
 *  - The design has no screen for a page that failed to load or a snippet carrying another
 *    project's id; both get their own rows here (spec §2.3 "NEW copy needed").
 */

export type PixelVerify = "idle" | "checking" | "found" | "missing";

/** The check as the action returns it. */
export interface PixelCheckResult {
  pageLoaded: boolean;
  loadError: string | null;
  scriptFound: boolean;
  antiFlickerFound: boolean;
  wrongSiteId: boolean;
  /** Other projects' IDs found in the page, so a mismatch can name them. */
  foundSiteIds?: string[];
  /** Found only past the page cache: installed, the cache still serves an older copy. */
  staleCache?: boolean;
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

/**
 * Names both IDs — the one on the page and this project's — so the mismatch can be seen at a
 * glance (a deleted and re-created project gets a new ID; its old code still carries the old one).
 */
function differentIdText(found: string[], key: string): string {
  const fix = "Copy this project’s script from step 1 and replace the old code.";
  if (found.length === 0 || !key) {
    return `The page has a Routely script for another project. ${fix}`;
  }
  const theirs = found.length === 1 ? found[0] : found.join(", ");
  return `Your page has the code for project ${theirs}, but this project’s ID is ${key}. ${fix}`;
}

/** The check rows for the dialog's current state. */
export function checkRows(
  verify: PixelVerify,
  result: PixelCheckResult | null,
  ctx: { shortUrl: string; key: string },
): CheckRow[] {
  const { shortUrl, key } = ctx;
  if (verify === "idle" || verify === "checking" || !result) {
    const tone: CheckTone = verify === "checking" ? "running" : "pending";
    return [
      { title: "Page loads", text: `Routely opens ${shortUrl}.`, tone },
      { title: "Script found", text: "The Routely script is in the page’s <head>.", tone },
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
    ];
  }

  const loaded: CheckRow = {
    title: "Page loaded",
    text: `${shortUrl} responded normally.`,
    tone: "ok",
  };

  if (result.scriptFound && result.staleCache) {
    return [
      loaded,
      {
        title: "Pixel found — cache not refreshed yet",
        text: "Your site has the code, but your server’s cache is still showing visitors an older copy of this page. Visitors get the code when the cache refreshes; clear your server cache to make it immediate.",
        tone: "ok",
      },
    ];
  }

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
    ];
  }

  if (result.wrongSiteId) {
    return [
      loaded,
      {
        title: "Different Project ID",
        text: differentIdText(result.foundSiteIds ?? [], key),
        tone: "fail",
      },
    ];
  }

  return [
    loaded,
    {
      title: "Pixel not found",
      text: "The page loaded, but the Routely code wasn’t in its <head>.",
      tone: "fail",
    },
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

export interface CheckTips {
  title: string;
  items: string[];
  /** Show "More fixes for a missing pixel" under the tips. */
  moreFixes: boolean;
}

/**
 * The tips under a failed check, for a page that loaded without this project's script; null
 * otherwise. Another project's ID usually means a cache still serving an older copy of the page
 * (a re-created project gets a new ID), so that case leads with clearing the caches.
 */
export function checkTips(verify: PixelVerify, result: PixelCheckResult | null): CheckTips | null {
  if (verify !== "missing" || (result && !result.pageLoaded)) return null;
  if (result?.wrongSiteId) {
    return {
      title: "Clear your website and server cache",
      items: [
        "Your site may still be serving an old cached copy with an earlier Routely code.",
        "Clear your website cache in your caching plugin — for example LiteSpeed Cache → Purge All, WP Rocket or W3 Total Cache.",
        "Clear your server cache in your hosting panel, and your CDN (such as Cloudflare) if you use one.",
      ],
      moreFixes: false,
    };
  }
  return {
    title: "Things to check",
    items: [
      "Make sure your changes are published, not just saved as a draft.",
      "If you use a caching plugin or CDN, clear the cache and check again.",
      "Check that a cookie banner isn’t blocking the code until visitors accept.",
    ],
    moreFixes: true,
  };
}
