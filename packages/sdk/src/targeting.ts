import type { ConditionConfig, DeviceKind, TargetingConfig } from "./contract";
import { urlMatches } from "./url";

/**
 * Page and audience targeting, evaluated in the browser.
 *
 * `matches` mirrors `apps/web/src/lib/targeting.ts` (itself a port of the design prototype),
 * so a URL the wizard's "Test a URL" box accepts is a URL the SDK runs on. The SDK cannot
 * import the app, so the two are kept identical by mirrored test cases — change both together.
 *
 * Location is deliberately absent: the config endpoint resolves countries from the request's
 * geo headers and leaves out any experiment the visitor's country fails.
 */

/** No protocol, no query, no trailing slash — the prototype's `stripU`. */
export function stripU(x: unknown): string {
  return String(x || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .split("?")[0]!
    .replace(/\/$/, "");
}

/**
 * Whether `url` satisfies a page rule. `null` when either side is empty, `"invalid"` for a
 * regex that does not compile. Every mode but `regex` compares `stripU` forms; `regex` tests the
 * raw URL.
 */
export function matches(match: string, pattern: string, url: string): boolean | null | "invalid" {
  if (!pattern || !url) return null;
  const u = stripU(url);
  const p = stripU(pattern);
  switch (match) {
    case "exact":
      return u === p;
    case "contains":
      return u.indexOf(p) >= 0;
    case "starts":
      return u.indexOf(p) === 0;
    case "wildcard": {
      const re = new RegExp(
        "^" +
          p
            .split("*")
            .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
      );
      return re.test(u) || re.test(u + "/");
    }
    case "regex":
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return "invalid";
      }
  }
  return null;
}

/**
 * Whether the current page is one this experiment runs on.
 *
 * The fragment is dropped first — it never identifies a different page, and the prototype's
 * `stripU` only removes it when a query string happens to precede it. The uppercase legacy
 * modes use the normalised-URL rules the experiment was created under.
 */
export function pageMatches(
  rule: Pick<TargetingConfig, "match" | "pattern">,
  href: string,
): boolean {
  const url = String(href).split("#")[0]!;
  if (rule.match === "EXACT" || rule.match === "PREFIX") {
    return urlMatches(url, rule.pattern, rule.match);
  }
  return matches(rule.match, rule.pattern, url) === true;
}

/**
 * The visitor's device class, from the user agent, refined by the viewport on touch screens.
 *
 * iPadOS reports a desktop Safari user agent, so a "Macintosh" with a touch screen is a tablet.
 * The viewport is consulted only for touch devices: a narrow desktop window is still a desktop.
 */
export function detectDevice(ua: string, width: number, touchPoints: number): DeviceKind {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobi)/i.test(ua)) return "tablet";
  if (/Macintosh/.test(ua) && touchPoints > 1) return "tablet";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  if (touchPoints > 0 && width > 0)
    return width < 768 ? "mobile" : width < 1280 ? "tablet" : "desktop";
  return "desktop";
}

/** What a condition is evaluated against, read from the *raw* location — not a normalised URL,
 * which strips exactly the `utm_*` parameters a condition may be about. */
export interface VisitContext {
  href: string;
  referrer: string;
  device: DeviceKind;
  /** True when no visitor id existed before this page load. */
  isNewVisitor: boolean;
}

function conditionValue(condition: ConditionConfig, context: VisitContext): string | null {
  if (condition.field === "referrer") return context.referrer || null;
  try {
    return new URL(context.href).searchParams.get(
      condition.field === "query" ? condition.key : condition.field,
    );
  } catch {
    return null;
  }
}

/** One condition. Comparisons are case-insensitive: campaign tags are typed by hand. */
export function conditionHolds(condition: ConditionConfig, context: VisitContext): boolean {
  const raw = conditionValue(condition, context);
  const actual = (raw || "").toLowerCase();
  const expected = String(condition.value || "").toLowerCase();
  switch (condition.op) {
    case "exists":
      return actual !== "";
    case "equals":
      return raw !== null && actual === expected;
    case "not":
      return actual !== expected;
    case "contains":
      return raw !== null && actual.indexOf(expected) >= 0;
  }
  return false;
}

/**
 * Whether a visitor who is not yet in the experiment may enter it on this page load: audience,
 * device and conditions. The page rule is checked separately, because it applies on every load
 * whereas these gate entry only — an assigned visitor keeps their arm even after they stop
 * being "new", or come back without the campaign parameter that brought them.
 */
export function isTargeted(targeting: TargetingConfig, context: VisitContext): boolean {
  if (targeting.audience === "new" && !context.isNewVisitor) return false;
  if (targeting.audience === "returning" && context.isNewVisitor) return false;
  if (targeting.devices.indexOf(context.device) < 0) return false;

  const conditions = targeting.conditions;
  if (conditions.length === 0) return true;
  const results = conditions.map((condition) => conditionHolds(condition, context));
  return targeting.logic === "any" ? results.indexOf(true) >= 0 : results.indexOf(false) < 0;
}

/**
 * Crawlers, previewers and headless automation that identify themselves.
 *
 * A compact form of the server's `bot-filter.ts` pattern, without the HTTP libraries there
 * (`curl`, `python-requests`, …) that never execute a script. A bot gets no redirect, no element
 * change, no assignment and no events: search engines always index the control, and an arm is
 * never credited with a crawler's page views.
 */
const BOT =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|pinterest|vkshare|w3c_validator|whatsapp|telegram|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|monitoring/i;

export function isBotAgent(ua: string): boolean {
  return BOT.test(ua);
}
