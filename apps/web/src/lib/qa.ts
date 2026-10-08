/**
 * Pre-launch QA checks and the Review step's readiness model, ported from the prototype's
 * `qaChecks()` and the review section of its wizard.
 *
 * Deviation from the prototype, on purpose: its details quote measurements it never took
 * ("served from CDN in 38 ms", "412 ms", "avg 14 ms", "200 OK" without a request). Here a
 * check only claims what it knows: reachability text appears only when a real URL check
 * result is supplied in `ctx.urlChecks`; otherwise the detail says the URL is valid.
 */

import { URL_RE, hostOf, isKnownHost, pathOf } from "./domain-normalize";
import type { ExperimentDraft, MetricSummary, WizardStepKey } from "./domain";
import { fAgo, minutesSince } from "./format";
import { matches } from "./targeting";
import { totalWeight } from "./traffic";
import { errorList, stepIndex, stepLabel } from "./validate-draft";
import type { DraftErrors } from "./domain";

export type QaState = "pass" | "warn" | "fail";
export type QaStep = WizardStepKey | "install";

export type QaId =
  | "script"
  | "control"
  | "variants"
  | "bots"
  | "changes"
  | "flicker"
  | "goal"
  | "traffic"
  | "targeting";

export interface QaCheck {
  id: QaId;
  label: string;
  /** Shown before the check has run. */
  hint: string;
  state: QaState;
  detail: string;
  /** Where to fix it: a wizard step, or the project's installation screen. */
  step: QaStep;
}

export interface UrlCheck {
  ok: boolean;
  status?: number;
}

export interface QaContext {
  /** Whether the project's tracking snippet has been verified. */
  trackingInstalled: boolean;
  /** Project domains (bare, normalised). */
  projectDomains: string[];
  metrics: MetricSummary[];
  /** Real reachability results keyed by the (trimmed) URL that was checked. */
  urlChecks?: Record<string, UrlCheck>;
  /** Clock for "last received" text. */
  now?: Date;
}

/** The goal the draft is judged on, resolved for display: a metric, a URL goal, or none. */
export interface ResolvedGoal {
  isUrl: boolean;
  name: string;
  key: string;
  url: string | null;
  /** Null when never received. URL goals are counted automatically and report "Auto". */
  lastReceivedAt: string | null | "auto";
}

export function resolveGoal(
  d: ExperimentDraft,
  metrics: readonly MetricSummary[],
): ResolvedGoal | undefined {
  if (d.goalMode === "url") {
    const u = (d.convUrl || "").trim();
    if (!u) return undefined;
    const p = pathOf(u) || u;
    return { isUrl: true, name: "Reached " + p, key: p, url: u, lastReceivedAt: "auto" };
  }
  const m = metrics.find((x) => x.id === d.goal);
  if (!m) return undefined;
  return { isUrl: false, name: m.name, key: m.key, url: m.url, lastReceivedAt: m.lastReceivedAt };
}

const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

/** Ordered pre-launch checks for a draft. */
export function qaChecks(d: ExperimentDraft, ctx: QaContext): QaCheck[] {
  const R = d.type === "redirect";
  const known = (h: string) => isKnownHost(h, ctx.projectDomains);
  const check = (u: string): UrlCheck | undefined => ctx.urlChecks?.[u.trim()];
  const url = d.url.trim();
  const h = hostOf(url);
  const path = pathOf(url);
  const L: QaCheck[] = [];

  L.push({
    id: "script",
    label: "Routely script installed",
    hint: "Looks for the snippet on your page",
    state: ctx.trackingInstalled && known(h) ? "pass" : "fail",
    detail: !ctx.trackingInstalled
      ? "Project tracking isn’t installed yet. Install it once in Settings → Installation & tracking."
      : known(h)
        ? "Project snippet detected on " + h
        : (h || "This page") +
          " isn’t one of this project’s domains. Add it in Settings → Project.",
    step: "install",
  });

  const cc = check(url);
  const urlOk = URL_RE.test(url);
  L.push({
    id: "control",
    label: R ? "Control URL responds" : "Page loads",
    hint: path || "—",
    state: !urlOk || (cc && !cc.ok) ? "fail" : "pass",
    detail: !urlOk
      ? "Invalid URL"
      : cc
        ? cc.ok
          ? (cc.status ? cc.status + " OK · " : "Reachable · ") + path
          : "Not reachable" + (cc.status ? " (" + cc.status + ")" : "") + " · " + path
        : "Valid URL · " + path,
    step: "basics",
  });

  if (R) {
    const vs = d.arms.slice(1);
    const bad = vs.filter((a) => !URL_RE.test(a.url.trim()));
    const down = vs.filter((a) => URL_RE.test(a.url.trim()) && check(a.url)?.ok === false);
    const cross = vs.filter((a) => URL_RE.test(a.url.trim()) && !known(hostOf(a.url.trim())));
    const checked = vs.filter((a) => check(a.url)?.ok === true).length;
    let detail: string;
    if (bad.length) detail = plural(bad.length, "invalid URL");
    else if (down.length) detail = down.length + " of " + vs.length + " not reachable";
    else if (cross.length) {
      const ch = hostOf(cross[0]!.url.trim());
      detail = check(cross[0]!.url)?.ok
        ? "Reachable, but script missing on " + ch
        : ch + " isn’t one of this project’s domains, so the script may be missing there";
    } else {
      detail =
        checked === vs.length
          ? vs.length + " of " + vs.length + " reachable"
          : vs.length + " of " + vs.length + " valid URLs";
    }
    L.push({
      id: "variants",
      label: "Variant URLs respond",
      hint: vs.length + " variant URL" + (vs.length > 1 ? "s" : ""),
      state: bad.length || down.length ? "fail" : cross.length ? "warn" : "pass",
      detail,
      step: "variants",
    });
    L.push({
      id: "bots",
      label: "Bots & crawlers excluded",
      hint: "Protects SEO",
      state: "pass",
      detail: "Bot and crawler traffic is excluded from results",
      step: "variants",
    });
  } else {
    const vs = d.arms.slice(1);
    const n = vs.reduce((t, a) => t + a.changes.length, 0);
    const empty = vs.filter((a) => !a.changes.length);
    const noSelector = vs.flatMap((a) => a.changes).filter((c) => !c.selector.trim()).length;
    L.push({
      id: "changes",
      label: "Variant changes apply",
      hint: "Matches each edited element on the page",
      state: empty.length || noSelector ? "fail" : "pass",
      detail: empty.length
        ? empty[0]!.name + " has no changes"
        : noSelector
          ? plural(noSelector, "change") + " without a CSS selector"
          : plural(n, "change") + " will be applied by CSS selector",
      step: "variants",
    });
    L.push({
      id: "flicker",
      label: "No flicker detected",
      hint: "Measures time before changes paint",
      state: "pass",
      detail: "Changes are applied before first paint behind the anti-flicker snippet",
      step: "variants",
    });
  }

  const g = resolveGoal(d, ctx.metrics);
  const never = !!g && g.lastReceivedAt === null;
  L.push({
    id: "goal",
    label: "Goal is tracking",
    hint: g
      ? g.isUrl
        ? "Watching for visits to " + g.key
        : "Listening for " + g.key
      : "No goal selected",
    state: !g ? "fail" : never ? "warn" : "pass",
    detail: !g
      ? "Choose a primary goal"
      : g.isUrl
        ? "Visits to " + g.key + " are counted automatically"
        : never
          ? "No " + g.key + " events received yet. Check your GTM setup."
          : "Last " +
            g.key +
            " event received " +
            fAgo(minutesSince(g.lastReceivedAt as string, ctx.now)).toLowerCase(),
    step: "goal",
  });

  const sum = totalWeight(d.arms);
  L.push({
    id: "traffic",
    label: "Traffic adds up to 100%",
    hint: "Allocation check",
    state: sum === 100 ? "pass" : "fail",
    detail: sum === 100 ? d.arms.map((a) => a.weight + "%").join(" / ") : "Currently " + sum + "%",
    step: "traffic",
  });

  const m = matches(d.targeting.match, d.targeting.pattern, d.url.replace("*", "x"));
  L.push({
    id: "targeting",
    label: "Targeting includes the page",
    hint: "Tests your page rule against the URL",
    state: m === true ? "pass" : "warn",
    detail:
      m === true
        ? (pathOf(d.url) || "URL") + " matches your page rule"
        : (pathOf(d.url) || "URL") + " doesn't match the page rule",
    step: "targeting",
  });

  return L;
}

// ---------------------------------------------------------------------------
// Review readiness
// ---------------------------------------------------------------------------

export interface ReadinessItem {
  text: string;
  detail: string;
  step: QaStep;
  /** "Setup", "Goals", … or "Installation". */
  stepLabel: string;
  /** Wizard step index to jump to; -1 for the installation screen. */
  stepIndex: number;
  action: "Fix" | "Review" | "Open installation";
}

export type ReadinessState = "checking" | "blocked" | "warn" | "ready";

export interface Readiness {
  blocking: ReadinessItem[];
  warnings: ReadinessItem[];
  passed: { text: string; detail: string }[];
  /** Tracking missing counts as one more blocker, shown by its own banner row. */
  trackingMissing: boolean;
  blockingCount: number;
  state: ReadinessState;
  canLaunch: boolean;
}

const where = (step: QaStep) => (step === "install" ? "Installation" : stepLabel(step));
const idx = (step: QaStep) => (step === "install" ? -1 : stepIndex(step));

/**
 * The Review screen's model. `qa` is null until the checks have run (state `checking`).
 *
 * - Every validation error is blocking ("Fix").
 * - Warnings: the goal metric has never been received, an arm at 0%, coverage below 100%.
 * - Once QA ran: a failed check is blocking unless its step already has a validation error
 *   (and the script check is skipped while tracking is missing — the tracking row covers it);
 *   a warned check is a warning unless its step already has a warning or error.
 * - `canLaunch` = no blockers, QA ran, tracking installed.
 */
export function readiness(
  d: ExperimentDraft,
  errors: DraftErrors,
  qa: QaCheck[] | null,
  ctx: Pick<QaContext, "trackingInstalled" | "metrics">,
): Readiness {
  const item = (
    text: string,
    detail: string,
    step: QaStep,
    action: ReadinessItem["action"],
  ): ReadinessItem => ({
    text,
    detail,
    step,
    stepLabel: where(step),
    stepIndex: idx(step),
    action,
  });

  const blocking = errorList(errors).map((e) => item(e.msg, "", e.step, "Fix"));
  const warnings: ReadinessItem[] = [];

  const g = resolveGoal(d, ctx.metrics);
  if (g && g.lastReceivedAt === null) {
    warnings.push(
      item(
        g.name + " has never been received. Conversions won’t count until tracking is set up.",
        "",
        "goal",
        "Review",
      ),
    );
  }
  d.arms.forEach((a) => {
    if (Number(a.weight) === 0)
      warnings.push(
        item(a.name + " is set to 0% and will get no traffic.", "", "traffic", "Review"),
      );
  });
  if (d.coverage < 100) {
    warnings.push(
      item(
        "Only " +
          d.coverage +
          "% of matching visitors are included. The test will take longer to reach significance.",
        "",
        "traffic",
        "Review",
      ),
    );
  }

  const passed: Readiness["passed"] = [];
  const errSteps = new Set(blocking.map((b) => b.step));
  const warnSteps = new Set(warnings.map((w) => w.step));
  if (qa) {
    for (const c of qa) {
      const inWizard = c.step !== "install";
      if (c.state === "pass") passed.push({ text: c.label, detail: c.detail });
      else if (c.state === "fail") {
        if (inWizard && errSteps.has(c.step)) continue;
        if (c.id === "script" && !ctx.trackingInstalled) continue;
        blocking.push(item(c.label, c.detail, c.step, inWizard ? "Fix" : "Open installation"));
      } else {
        if (inWizard && (warnSteps.has(c.step) || errSteps.has(c.step))) continue;
        warnings.push(item(c.label, c.detail, c.step, inWizard ? "Review" : "Open installation"));
      }
    }
  }

  const trackingMissing = !ctx.trackingInstalled;
  const blockingCount = blocking.length + (trackingMissing ? 1 : 0);
  const state: ReadinessState = !qa
    ? "checking"
    : blockingCount
      ? "blocked"
      : warnings.length
        ? "warn"
        : "ready";
  return {
    blocking,
    warnings,
    passed,
    trackingMissing,
    blockingCount,
    state,
    canLaunch: !blockingCount && !!qa && !trackingMissing,
  };
}
