/**
 * What an install check concluded, from everything it observed. Pure, shared by the service and
 * the dialog, so a status and its guidance cannot drift apart.
 *
 * A check has three witnesses, and each can only say what it saw:
 *
 *  - **The server** fetched the page and, for GTM, the published container (`StaticLook`). It can
 *    see a tag, never a running SDK.
 *  - **The backend signal**: the SDK on the page, opened in the customer's own browser with
 *    `#_rt_verify=<token>`, POSTed to `/api/v1/verify`. Only this confirms an installation, because
 *    it is the correct project's SDK running and reaching Routely.
 *  - **The browser message**: the same SDK told the window that opened it. It is what separates
 *    "the SDK never ran" from "the SDK ran but its signal never arrived".
 *
 * Ordinary site-wide hits deliberately do not count. Any visitor on any page could send one, so a
 * hit says nothing about the page being checked, and an old tag elsewhere would pass a page that
 * has none. Only a signal carrying this run's token can verify it.
 */

/** How long a check waits before reading silence as an answer. GTM commonly fires a few seconds
 * into a page load; a slow page plus consent tools can take well over ten. */
export const VERIFY_WINDOW_MS = 25_000;
/** How long the raw token stays valid, so a slow "Check again" still lands on the same run. */
export const VERIFY_TOKEN_TTL_MS = 10 * 60 * 1000;
/** How often the dialog asks. */
export const VERIFY_POLL_MS = 2_000;
/** Extra time for the backend signal once the browser says the SDK has finished. */
export const SIGNAL_GRACE_MS = 8_000;

import type { AntiFlickerPlacement } from "@/lib/gtm";

export type InstallMethodName = "MANUAL" | "GTM";

export type InstallStatus =
  | "not_installed"
  | "waiting"
  | "in_progress"
  | "verified"
  | "wrong_site_id"
  | "sdk_failed_to_load"
  | "sdk_not_initialized"
  | "backend_signal_missing"
  | "anti_flicker"
  | "failed";

export interface StaticLook {
  pageLoaded: boolean;
  loadError: string | null;
  /** This project's id is in the page's HTML. */
  inHtml: boolean;
  /** Another project's id is in the HTML, and this one's is not. */
  otherInHtml: boolean;
  /** GTM containers the page loads. */
  containers: string[];
  /** This project's id is in a published container. */
  inContainer: boolean;
  /** Another project's id is in a published container, and this one's is not. */
  otherInContainer: boolean;
  /** The containers could not be read, so nothing can be said about them. */
  containerUnreadable: boolean;
  /** Where the anti-flicker block sits (`lib/gtm.ts`). Absent on looks stored before it existed. */
  antiFlicker?: AntiFlickerPlacement | undefined;
  /** The published container holding this project's tag also holds the anti-flicker block. */
  antiFlickerInContainer?: boolean | undefined;
}

/** The SDK's report through `postMessage`, passed along by the dialog. Advisory: it only ever
 * refines a failure message, it can never verify anything. */
export interface BrowserReport {
  stage: "loaded" | "ready" | "failed";
  reason?: "config" | "no_site_id" | undefined;
}

export interface VerifyObservation {
  method: InstallMethodName;
  look: StaticLook | null;
  loadedAt: Date | null;
  readyAt: Date | null;
  failReason: string | null;
  /** The SDK ran under another project's id. */
  otherSiteIds: string[];
  tagCount: number | null;
  browser: BrowserReport | null;
  elapsedMs: number;
}

export interface VerifyOutcome {
  status: InstallStatus;
  /** The check has its answer and polling can stop. */
  final: boolean;
  title: string;
  /** What happened, in a sentence. */
  detail: string;
  /** What to do about it. */
  steps: string[];
  /** Something to fix on an otherwise working install. */
  warnings: string[];
}

const GTM_PUBLISH_STEP =
  "In Google Tag Manager, open Submit, then Publish. Saving a tag does not put it live.";
const CACHE_STEP = "Clear your website and CDN cache, then check again.";

function warningsFor(o: VerifyObservation): string[] {
  const warnings: string[] = [];
  if (o.otherSiteIds.length > 0) {
    warnings.push("Another project’s Routely code is also on this page. Remove it.");
  } else if ((o.tagCount ?? 0) > 1) {
    warnings.push(
      "The Routely code is on this page more than once. It still runs once, but remove the extra copy.",
    );
  }
  return warnings;
}

const outcome = (
  status: InstallStatus,
  final: boolean,
  title: string,
  detail: string,
  steps: string[] = [],
  warnings: string[] = [],
): VerifyOutcome => ({ status, final, title, detail, steps, warnings });

export function readVerification(o: VerifyObservation): VerifyOutcome {
  const { look, method } = o;
  const gtm = method === "GTM";

  if (o.readyAt) {
    return outcome(
      "verified",
      true,
      "Installation verified",
      "The Routely code for this project loaded, started and reached Routely.",
      [],
      warningsFor(o),
    );
  }

  if (o.otherSiteIds.length > 0 && !o.loadedAt) {
    return outcome(
      "wrong_site_id",
      true,
      "Incorrect Project ID",
      "Routely detected a different project ID. The code running on this page belongs to another project.",
      [
        gtm
          ? "In Google Tag Manager, replace the tag’s contents with this project’s code, then publish."
          : "Replace the code on your site with this project’s code.",
        "Keep only one Routely code on the page.",
      ],
    );
  }

  const timedOut = o.elapsedMs >= VERIFY_WINDOW_MS;

  if (o.failReason === "no_site_id" || o.browser?.reason === "no_site_id") {
    return outcome(
      "sdk_not_initialized",
      true,
      "SDK loaded but not initialized",
      "The Routely script loaded, but its tag has no project ID.",
      [
        gtm
          ? "Paste this project’s code into the tag again without editing it, then publish."
          : "Paste this project’s code again without editing it.",
      ],
    );
  }

  if (o.failReason === "config" || (o.browser?.stage === "failed" && !o.loadedAt)) {
    return outcome(
      "sdk_not_initialized",
      true,
      "SDK loaded but not initialized",
      "The SDK loaded but could not finish starting, because it could not fetch its settings from Routely.",
      [
        "Open your browser’s console and network tabs on that page and look for errors from Routely.",
        "Check that a Content Security Policy, firewall or ad blocker isn’t blocking requests to Routely.",
      ],
    );
  }

  // The browser says it finished, and the backend has nothing: something between them dropped it.
  if (o.browser?.stage === "ready" && o.elapsedMs >= SIGNAL_GRACE_MS) {
    return outcome(
      "backend_signal_missing",
      true,
      "Backend signal not received",
      "The SDK initialized, but Routely has not received a verification signal yet.",
      [
        "Check that your site’s Content Security Policy allows connections to Routely (connect-src).",
        "Turn off any ad blocker or privacy extension in this browser, then check again.",
      ],
    );
  }

  if (!timedOut) {
    const seen = !!(o.loadedAt || o.browser || look?.inHtml || look?.inContainer);
    return seen
      ? outcome(
          "in_progress",
          false,
          "Verification in progress",
          o.loadedAt || o.browser
            ? "The SDK has started on your page. Waiting for it to finish."
            : "Your code is in place. Waiting for it to run in the page we opened.",
        )
      : outcome(
          "waiting",
          false,
          "Waiting for installation",
          gtm
            ? "Waiting for Google Tag Manager to load the Routely code in the page we opened. This can take a few seconds."
            : "Waiting for the Routely code to run in the page we opened.",
        );
  }

  if (o.loadedAt) {
    return outcome(
      "sdk_not_initialized",
      true,
      "SDK loaded but not initialized",
      "The SDK loaded but did not finish starting.",
      [
        "Check your browser’s console and network tabs for errors on that page.",
        "Check that nothing on the page is blocking requests to Routely.",
      ],
    );
  }

  if (o.browser?.stage === "ready") {
    return outcome(
      "backend_signal_missing",
      true,
      "Backend signal not received",
      "The SDK initialized, but Routely has not received a verification signal yet.",
      ["Check network access to Routely from that page, then check again."],
    );
  }

  if (look && !look.pageLoaded) {
    return outcome(
      "failed",
      true,
      "Verification failed",
      look.loadError ?? "Routely couldn’t load that page.",
      ["Check the URL opens in a private window, then check again."],
    );
  }

  if (look?.otherInHtml || look?.otherInContainer) {
    return outcome(
      "wrong_site_id",
      true,
      "Incorrect Project ID",
      look.otherInContainer
        ? "Your published Google Tag Manager container holds another project’s Routely code."
        : "Routely detected a different project ID in this page.",
      [
        "Confirm that you copied this project’s installation snippet.",
        look.otherInContainer ? GTM_PUBLISH_STEP : CACHE_STEP,
      ],
    );
  }

  if (look?.inHtml || look?.inContainer) {
    return outcome(
      "sdk_failed_to_load",
      true,
      "SDK failed to load",
      look.inContainer
        ? "The tag is published in Google Tag Manager, but the SDK did not run on the page we opened."
        : "The Routely code is in the page, but the SDK did not run.",
      [
        look.inContainer
          ? "Check the tag’s trigger fires on this page. Tag Assistant (Preview in GTM) shows whether it fired."
          : "Check the browser’s network tab for the Routely script, and what blocked it.",
        "Check that a cookie banner isn’t holding the code back until visitors accept.",
        "Turn off any ad blocker in this browser, then check again.",
      ],
    );
  }

  if (gtm) {
    if (!look || look.containers.length === 0) {
      return outcome(
        "not_installed",
        true,
        "Routely pixel not detected",
        "Google Tag Manager wasn’t found on this page, and the Routely code didn’t run.",
        [
          "Check this page has the Google Tag Manager container installed.",
          "Check you are testing a page on the same site as that container.",
        ],
      );
    }
    return outcome(
      "not_installed",
      true,
      "Routely pixel not detected",
      look.containerUnreadable
        ? "Check whether your GTM tag is published. Google Tag Manager is on the page, but the Routely code didn’t run."
        : `Check whether your GTM tag is published. ${look.containers.join(", ")} is on the page, but its live version doesn’t contain this project’s code.`,
      [
        GTM_PUBLISH_STEP,
        "Check you added the tag to the container this site uses.",
        "Then check again.",
      ],
    );
  }

  return outcome(
    "not_installed",
    true,
    "Routely pixel not detected",
    "The page loaded, but the Routely code wasn’t in it and didn’t run.",
    [
      "Make sure your changes are published, not just saved as a draft.",
      "If you use a caching plugin or CDN, clear the cache.",
      "Check that a cookie banner isn’t blocking the code until visitors accept.",
    ],
  );
}

/**
 * The dialog's check, read from the server's look alone (user decision 2026-11-09: the dialog no
 * longer opens the customer's page in a tab). Always final.
 *
 * It verifies on the same evidence the launch's tracking check accepts: this project's code in the
 * page's HTML, or in the published version of a Google Tag Manager container the page loads. That
 * proves the code is on the site, not that it runs: a GTM trigger that never fires on this page
 * still passes. The project's tracking status, from real visitors' page hits, is what shows that.
 */
export function readServerCheck(method: InstallMethodName, look: StaticLook): VerifyOutcome {
  const tag = readServerTag(method, look);
  // Google Tag Manager installs also need the anti-flicker block (2026-11-09): in the published tag
  // (the GTM tab's code includes it), or in <head> above Tag Manager. A manual install pastes it as
  // part of the snippet, so only the GTM tab asks.
  if (method !== "GTM" || !look.pageLoaded || tag.status === "failed") return tag;
  const placement = look.antiFlicker ?? "missing";
  if (placement === "ok") return tag;
  // In the Tag Manager tag itself (the code the GTM tab gives, 2026-11-09): accepted, with a note,
  // because there it starts only after the page is visible.
  if (look.antiFlickerInContainer) {
    return tag.status === "verified" ? { ...tag, warnings: [...tag.warnings, IN_GTM_NOTE] } : tag;
  }

  const fix = ANTI_FLICKER_FIX[placement];
  if (tag.status === "verified") {
    return outcome(
      "anti_flicker",
      true,
      fix.title,
      `Your Google Tag Manager tag is published. ${fix.detail}`,
      fix.steps,
    );
  }
  // Both are wrong: the tag's own answer leads, and the block's fix follows it.
  return { ...tag, detail: `${tag.detail} ${fix.detail}`, steps: [...tag.steps, ...fix.steps] };
}

const IN_GTM_NOTE =
  "The anti-flicker block runs inside Google Tag Manager, which starts after the page shows, so visitors briefly see the original page before a Split URL redirect. For no flash, install the code in your site’s <head> (Manual installation).";
const ANTI_FLICKER_STEP =
  "Replace your Custom HTML tag’s contents with this project’s Tag Manager code. It includes the anti-flicker block.";
const OR_USE_TAG =
  "Or use this project’s Tag Manager code in your tag instead. It includes the anti-flicker block.";

const ANTI_FLICKER_FIX: Record<
  Exclude<AntiFlickerPlacement, "ok">,
  { title: string; detail: string; steps: string[] }
> = {
  missing: {
    title: "Anti-flicker block not found",
    detail: "The anti-flicker block isn’t in your published tag or in this page’s <head>.",
    steps: [ANTI_FLICKER_STEP, GTM_PUBLISH_STEP],
  },
  outside_head: {
    title: "Anti-flicker block in the wrong place",
    detail: "The anti-flicker block is in the page’s <body>, so it can’t hide the page in time.",
    steps: [
      "Move the anti-flicker block into your site’s <head>, above the Google Tag Manager snippet.",
      OR_USE_TAG,
    ],
  },
  below_gtm: {
    title: "Anti-flicker block in the wrong place",
    detail:
      "The anti-flicker block comes after the Google Tag Manager snippet, so it runs too late.",
    steps: [
      "Move the anti-flicker block above the Google Tag Manager snippet in your site’s <head>.",
      OR_USE_TAG,
    ],
  },
};

/** Is this project's code on the page, by hand or in a published container? */
function readServerTag(method: InstallMethodName, look: StaticLook): VerifyOutcome {
  const gtm = method === "GTM";

  if (!look.pageLoaded) {
    return outcome(
      "failed",
      true,
      "Verification failed",
      look.loadError ?? "Routely couldn’t load that page.",
      ["Check the URL opens in a private window, then check again."],
    );
  }

  if (look.inHtml || look.inContainer) {
    return outcome(
      "verified",
      true,
      "Installation verified",
      look.inContainer
        ? "This page loads your Google Tag Manager container, and its published version holds this project’s Routely code."
        : "This project’s Routely code is in this page.",
    );
  }

  if (look.otherInHtml || look.otherInContainer) {
    return outcome(
      "wrong_site_id",
      true,
      "Incorrect Project ID",
      look.otherInContainer
        ? "Your published Google Tag Manager container holds another project’s Routely code."
        : "Routely found a different project ID in this page.",
      [
        "Confirm that you copied this project’s installation snippet.",
        look.otherInContainer ? GTM_PUBLISH_STEP : CACHE_STEP,
      ],
    );
  }

  if (look.containers.length > 0) {
    return outcome(
      "not_installed",
      true,
      "Routely pixel not detected",
      look.containerUnreadable
        ? "Google Tag Manager is on this page, but Routely couldn’t read its published container, and the Routely code isn’t in the page."
        : `${look.containers.join(", ")} is on this page, but its published version doesn’t contain this project’s code.`,
      [
        GTM_PUBLISH_STEP,
        "Check you added the tag to the container this site uses.",
        "Then check again.",
      ],
    );
  }

  if (gtm) {
    return outcome(
      "not_installed",
      true,
      "Routely pixel not detected",
      "Google Tag Manager wasn’t found on this page.",
      [
        "Check this page has the Google Tag Manager container installed.",
        "Check you are testing a page on the same site as that container.",
      ],
    );
  }

  return outcome(
    "not_installed",
    true,
    "Routely pixel not detected",
    "The page loaded, but the Routely code wasn’t in it.",
    [
      "Make sure your changes are published, not just saved as a draft.",
      "If you use a caching plugin or CDN, clear the cache.",
    ],
  );
}
