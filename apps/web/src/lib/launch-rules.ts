/**
 * The rules an experiment must pass before it can launch, as a pure function — the one place
 * they are written.
 *
 * Every screen that asks "can this launch?" reads this module: both wizards (live, as the
 * customer types), the project dashboard ("Not launched" vs "Setup incomplete"), and
 * `experiment.service`'s `validateForLaunch`, which adds the rules that need the database (one
 * running experiment per page, the tracking check). The messages are the design's, verbatim, so
 * the wizard and the server can never disagree about what is wrong.
 *
 * Pure and dependency-free apart from `lib/url.ts`, so a client component can import it.
 *
 * Drafts are stored leniently (spec §3.6): a URL may be blank, unschemed or invalid, a weight 0,
 * a name empty. Everything here therefore takes the stored, raw values and judges them.
 */

import { isSameSite, normalizeUrl } from "@/lib/url";

export type ExperimentTypeName = "SPLIT_URL" | "AB_TEST";
export type DeviceTypeName = "DESKTOP" | "MOBILE" | "TABLET";

/** Arms besides the Control. */
export const MAX_VARIANTS = 4;
/** Design caps the server enforces even on a draft. */
export const NAME_MAX = 120;
export const URL_MAX = 2048;

/** Device order everywhere they are listed. */
export const DEVICE_ORDER: readonly DeviceTypeName[] = ["DESKTOP", "MOBILE", "TABLET"];

/** What the rules read — an experiment row with its variants, or the wizard's form mapped to it. */
export interface LaunchRuleExperiment {
  type: ExperimentTypeName;
  name: string;
  controlUrl: string | null;
  conversionUrl: string | null;
  /** Integer share of included traffic; null or NaN when not a number yet. */
  controlWeight: number | null;
  /** 1–100; null or NaN when not a number yet. */
  trafficAllocation: number | null;
  /** Empty = every device (all three is stored as empty too). */
  targetDevices: readonly DeviceTypeName[];
  /**
   * Only the wizard can express "Specific devices, none ticked" — the database stores that as
   * "every device". Defaults to `specific` when `targetDevices` is non-empty, else `all`.
   */
  targeting?: "all" | "specific";
  variants: readonly LaunchRuleVariant[];
}

export interface LaunchRuleVariant {
  /** Anything unique within the experiment: the row id, or the wizard's local id. */
  id: string;
  name: string;
  /** SPLIT_URL only. */
  url: string | null;
  weight: number | null;
  /**
   * AB_TEST only: the stored `changes` JSON (`{schemaVersion, changes}` or a bare array), or any
   * array whose length is the number of changed elements.
   */
  changes: unknown;
}

export type LaunchStep = 1 | 2 | 3 | 4;

/**
 * One problem. `field` names what it is about:
 * `name` · `controlUrl` · `variants.<id>.name` · `variants.<id>.url` · `variants.<id>.changes` ·
 * `trafficAllocation` · `split` · `devices` · `conversionUrl`.
 */
export interface LaunchIssue {
  step: LaunchStep;
  field: string;
  message: string;
}

export interface LaunchRuleContext {
  /** The project's domain. Drives the same-site rule (D9) and the examples in the messages. */
  domain: string;
}

/** Step labels, as the wizards' steppers and the review's issue list name them. */
export const STEP_LABELS: Record<LaunchStep | 5, string> = {
  1: "Setup & variants",
  2: "Traffic",
  3: "Targeting",
  4: "Goal",
  5: "Review & launch",
};

// --- URLs -------------------------------------------------------------------------------------

/**
 * The shape the wizards accept: an optional http(s) scheme, a dotted host with a TLD-like last
 * label, an optional port and path. `localhost`, bare IPs and single-label hosts are refused —
 * none of them can be a customer's public page.
 */
const PAGE_URL = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#][^\s]*)?$/i;

/** `acme.com/x` → `https://acme.com/x`; a URL that already has a scheme is returned trimmed. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** True when `url` is a usable page URL (scheme optional). */
export function isValidPageUrl(url: string | null | undefined): boolean {
  const trimmed = (url ?? "").trim();
  return (
    trimmed !== "" &&
    trimmed.length <= URL_MAX &&
    PAGE_URL.test(trimmed) &&
    normalizeUrl(withScheme(trimmed)) !== null
  );
}

/** The comparison key two URLs are "the same page" under, or null for an unusable URL. */
export function pageKey(url: string | null | undefined): string | null {
  return isValidPageUrl(url) ? normalizeUrl(withScheme(url ?? "")) : null;
}

/** A URL without scheme, `www.` or trailing slash, for display: `acme.com/pricing`. */
export function shortUrl(url: string | null | undefined): string {
  return withScheme(url ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function onSite(url: string, domain: string): boolean {
  return !domain.trim() || isSameSite(withScheme(url), domain);
}

/** Server-only rule worded for the wizards (spec §2.7). */
export function sameSiteMessage(domain: string): string {
  return `Use a page on ${domain} or one of its subdomains.`;
}

// --- Changes ----------------------------------------------------------------------------------

/** Number of changed elements in a stored `changes` value (envelope, bare array, or null). */
export function changeCount(changes: unknown): number {
  if (Array.isArray(changes)) return changes.length;
  if (changes && typeof changes === "object" && "changes" in changes) {
    const inner = (changes as { changes: unknown }).changes;
    return Array.isArray(inner) ? inner.length : 0;
  }
  return 0;
}

/**
 * The design's mock storefront addressed its elements as `[data-routely-preview="…"]` and its
 * preset images under `https://example.com/routely-preview/` — changes made on a page that is not
 * the customer's. Drafts saved before the real editor existed may still hold them. They would
 * match nothing on a real page (or show a stock image), so they must never reach a live test.
 */
const PLACEHOLDER_SELECTOR = /\[\s*data-routely-preview\b/i;
/** RFC 2606 example domains, and anything under `.example`. */
const PLACEHOLDER_HOSTS = ["example.com", "example.net", "example.org"];

function isPlaceholderHost(src: unknown): boolean {
  if (typeof src !== "string") return false;
  try {
    const host = new URL(src).hostname.toLowerCase();
    return (
      host.endsWith(".example") ||
      host === "example" ||
      PLACEHOLDER_HOSTS.some((base) => host === base || host.endsWith(`.${base}`))
    );
  } catch {
    return false;
  }
}

/** True for a stored change made on the design's sample page rather than the customer's. */
export function isPlaceholderChange(change: unknown): boolean {
  if (!change || typeof change !== "object") return false;
  const { selector, set } = change as { selector?: unknown; set?: unknown };
  if (typeof selector === "string" && PLACEHOLDER_SELECTOR.test(selector)) return true;
  return !!set && typeof set === "object" && isPlaceholderHost((set as { src?: unknown }).src);
}

/** True when a stored `changes` value (envelope or bare array) holds any placeholder change. */
export function hasPlaceholderChanges(changes: unknown): boolean {
  const list = Array.isArray(changes)
    ? changes
    : changes && typeof changes === "object" && "changes" in changes
      ? (changes as { changes: unknown }).changes
      : [];
  return Array.isArray(list) && list.some(isPlaceholderChange);
}

export function placeholderMessage(variantName: string): string {
  return `${variantName} has changes made on a sample page, not yours. Remove them in the visual editor and make them on your page.`;
}

// --- Traffic ----------------------------------------------------------------------------------

function asInt(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** Each arm's typed share, Control first; a missing number counts as 0. */
export function armWeights(exp: Pick<LaunchRuleExperiment, "controlWeight" | "variants">): {
  id: string;
  weight: number;
}[] {
  return [
    { id: "control", weight: asInt(exp.controlWeight) ?? 0 },
    ...exp.variants.map((variant) => ({ id: variant.id, weight: asInt(variant.weight) ?? 0 })),
  ];
}

/** The sum of every arm's share — the design's "Total N%". */
export function splitTotal(exp: Pick<LaunchRuleExperiment, "controlWeight" | "variants">): number {
  return armWeights(exp).reduce((sum, arm) => sum + arm.weight, 0);
}

/** Arm ids ("control" or the variant id) below 1%. */
export function lowArms(exp: Pick<LaunchRuleExperiment, "controlWeight" | "variants">): string[] {
  return armWeights(exp)
    .filter((arm) => arm.weight < 1)
    .map((arm) => arm.id);
}

// --- The rules --------------------------------------------------------------------------------

/**
 * Every launch-blocking problem the experiment's own fields can show, in display order (step by
 * step, top to bottom). Empty means steps 1–4 are complete.
 *
 * Not covered, because they need the database: one running experiment per page, and the
 * tracking check. `experiment.service` adds both.
 */
export function setupIssues(exp: LaunchRuleExperiment, ctx: LaunchRuleContext): LaunchIssue[] {
  const issues: LaunchIssue[] = [];
  const domain = ctx.domain.trim();
  const example = domain || "example.com";
  const split = exp.type === "SPLIT_URL";
  const add = (step: LaunchStep, field: string, message: string) =>
    issues.push({ step, field, message });

  // Step 1 — setup & variants.
  if (!exp.name.trim()) add(1, "name", "Give your experiment a name.");

  const control = (exp.controlUrl ?? "").trim();
  const testedKeys = new Set<string>();
  const controlKey = pageKey(control);
  if (!control) {
    add(1, "controlUrl", "Enter the URL of the page you want to test.");
  } else if (!controlKey) {
    add(
      1,
      "controlUrl",
      split
        ? `Enter a valid URL, like https://${example}/fall-sale.`
        : `Enter a valid URL, like https://${example}/.`,
    );
  } else {
    testedKeys.add(controlKey);
    if (!onSite(control, domain)) add(1, "controlUrl", sameSiteMessage(domain));
  }

  for (const variant of exp.variants) {
    const field = `variants.${variant.id}`;

    if (!split) {
      if (changeCount(variant.changes) === 0) {
        add(
          1,
          `${field}.changes`,
          `Make at least one change to ${variant.name} in the visual editor.`,
        );
      } else if (hasPlaceholderChanges(variant.changes)) {
        add(1, `${field}.changes`, placeholderMessage(variant.name));
      }
      continue;
    }

    if (!variant.name.trim()) add(1, `${field}.name`, "Give this variant a name.");

    const url = (variant.url ?? "").trim();
    const key = pageKey(url);
    if (!url) {
      add(1, `${field}.url`, "Enter the URL visitors in this variant will see.");
    } else if (!key) {
      add(1, `${field}.url`, `Enter a valid URL, like https://${example}/fall-sale-v2.`);
    } else if (!onSite(url, domain)) {
      add(1, `${field}.url`, sameSiteMessage(domain));
      testedKeys.add(key);
    } else if (key === controlKey) {
      add(1, `${field}.url`, "Use a different URL from the Control page.");
    } else if (testedKeys.has(key)) {
      add(1, `${field}.url`, "Each variant needs its own URL.");
    } else {
      testedKeys.add(key);
    }
  }

  // Step 2 — traffic.
  const include = asInt(exp.trafficAllocation);
  if (include === null || include < 1 || include > 100) {
    add(2, "trafficAllocation", "Enter a percentage between 1 and 100.");
  }
  const total = splitTotal(exp);
  if (lowArms(exp).length > 0) {
    add(2, "split", "Every version needs at least 1% of traffic.");
  } else if (total !== 100) {
    add(
      2,
      "split",
      !split
        ? "The split must add up to 100%."
        : total < 100
          ? `${100 - total}% of traffic isn’t assigned. Adjust the split so it adds up to 100%.`
          : `The split adds up to ${total}%. Reduce it by ${total - 100}% so it totals 100%.`,
    );
  }

  // Step 3 — targeting.
  const targeting = exp.targeting ?? (exp.targetDevices.length > 0 ? "specific" : "all");
  if (targeting === "specific" && exp.targetDevices.length === 0) {
    add(3, "devices", "Choose at least one device type.");
  }

  // Step 4 — goal.
  const goal = (exp.conversionUrl ?? "").trim();
  const goalKey = pageKey(goal);
  if (!goal) {
    add(4, "conversionUrl", "Enter the page that counts as a conversion.");
  } else if (!goalKey) {
    add(
      4,
      "conversionUrl",
      split
        ? `Enter a valid URL, like https://${example}/checkout/thank-you.`
        : `Enter a valid URL, like https://${example}/collections/fall-sale.`,
    );
  } else if (!onSite(goal, domain)) {
    add(4, "conversionUrl", sameSiteMessage(domain));
  } else if (testedKeys.has(goalKey)) {
    add(
      4,
      "conversionUrl",
      split
        ? "The conversion page must be different from the pages you’re testing."
        : "The goal page must be different from the page you’re testing, or every visitor would count as a conversion.",
    );
  }

  return issues;
}

/** Issues grouped by step, with a count per step — what the review's "Fix" list renders. */
export function issuesByStep(issues: readonly LaunchIssue[]): Record<LaunchStep, LaunchIssue[]> {
  const grouped: Record<LaunchStep, LaunchIssue[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const issue of issues) grouped[issue.step].push(issue);
  return grouped;
}

/** "Setup & variants: 2 issues" lines for every step with a problem. */
export function issueLines(issues: readonly LaunchIssue[]): string[] {
  const grouped = issuesByStep(issues);
  return ([1, 2, 3, 4] as const)
    .filter((step) => grouped[step].length > 0)
    .map((step) => {
      const n = grouped[step].length;
      return `${STEP_LABELS[step]}: ${n} ${n === 1 ? "issue" : "issues"}`;
    });
}

/** True when steps 1–4 are complete — the project dashboard's "Not launched" (vs "Setup incomplete"). */
export function isSetupComplete(exp: LaunchRuleExperiment, ctx: LaunchRuleContext): boolean {
  return setupIssues(exp, ctx).length === 0;
}

// --- Summaries --------------------------------------------------------------------------------

const DEVICE_LABEL: Record<DeviceTypeName, string> = {
  DESKTOP: "Desktop",
  MOBILE: "Mobile",
  TABLET: "Tablet",
};

/** Devices in display order, without duplicates; all three collapses to "every device" (empty). */
export function normalizeDevices(devices: readonly DeviceTypeName[]): DeviceTypeName[] {
  const set = new Set(devices);
  const ordered = DEVICE_ORDER.filter((device) => set.has(device));
  return ordered.length === DEVICE_ORDER.length ? [] : ordered;
}

/**
 * Targeting in words.
 * - `list` (wizards): "All visitors" / "Desktop, Mobile only"
 * - `sentence` (launch dialog, detail): "All visitors" / "Desktop only" / "Desktop and tablet"
 */
export function targetingSummary(
  devices: readonly DeviceTypeName[],
  style: "list" | "sentence" = "sentence",
): string {
  const list = normalizeDevices(devices);
  if (list.length === 0) return "All visitors";
  const labels = list.map((device) => DEVICE_LABEL[device]);
  if (style === "list") return `${labels.join(", ")} only`;
  if (labels.length === 1) return `${labels[0]} only`;
  return `${labels[0]} and ${labels.slice(1).join(" and ").toLowerCase()}`;
}

/** The launch confirm's facts — the project dashboard mock's `LaunchInfo`, field for field. */
export interface LaunchSummary {
  /** Tested page without scheme: "acme.com/cart". */
  page: string;
  /** `trafficAllocation`. */
  include: number;
  /** "All visitors" / "Desktop and tablet". */
  targeting: string;
  /** Goal page without scheme. */
  goal: string;
  /** [name, meta, "50%"] per arm, Control first. Meta: "Original page" / "2 saved changes" for
   * an A/B test; the page without scheme for a Split URL test. */
  arms: [string, string, string][];
  /** The checklist line about the variants. */
  changes: string;
}

function percentages(exp: Pick<LaunchRuleExperiment, "controlWeight" | "variants">): number[] {
  const weights = armWeights(exp).map((arm) => Math.max(0, arm.weight));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // A launched experiment's weights total 100; older ones may be relative (50/50/50).
  return weights.map((weight) =>
    total === 100 ? weight : total > 0 ? Math.round((weight * 100) / total) : 0,
  );
}

function savedChanges(n: number): string {
  return n === 0 ? "No changes yet" : `${n} saved ${n === 1 ? "change" : "changes"}`;
}

/** What the launch confirm lists for an experiment (pure; the same data the wizards hold). */
export function launchSummary(exp: LaunchRuleExperiment): LaunchSummary {
  const pct = percentages(exp);
  const split = exp.type === "SPLIT_URL";
  const arms: [string, string, string][] = [
    ["Control", split ? shortUrl(exp.controlUrl) : "Original page", `${pct[0] ?? 0}%`],
    ...exp.variants.map((variant, index): [string, string, string] => [
      variant.name.trim() || "Unnamed variant",
      split ? shortUrl(variant.url) : savedChanges(changeCount(variant.changes)),
      `${pct[index + 1] ?? 0}%`,
    ]),
  ];

  let changes: string;
  if (split) {
    changes = "Every variant has its own URL";
  } else if (exp.variants.length === 1) {
    const only = exp.variants[0]!;
    changes = `${only.name} has ${savedChanges(changeCount(only.changes)).toLowerCase()}`;
  } else {
    changes = "Every variant has at least one saved change";
  }

  return {
    page: shortUrl(exp.controlUrl),
    include: asInt(exp.trafficAllocation) ?? 0,
    targeting: targetingSummary(exp.targetDevices, "sentence"),
    goal: shortUrl(exp.conversionUrl),
    arms,
    changes,
  };
}
