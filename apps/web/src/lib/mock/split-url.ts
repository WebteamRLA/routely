/**
 * Split URL test wizard — mock state and the pure rules the screen runs on, ported from the
 * design's `SplitURL` logic class so every seed, message and number matches the reference.
 *
 * Two modes. With a real draft (`ctx.live`) the form is loaded from and autosaved to the
 * experiment, tracking checks and launch go to the server, and the rules are
 * `lib/launch-rules.ts`'s — the same ones the server applies at launch. The design's `?view=`
 * states stay as they were: seeded, simulated, for comparing against the prototype.
 */

import {
  type LaunchIssue,
  type LaunchRuleExperiment,
  lowArms,
  setupIssues,
  splitTotal,
} from "@/lib/launch-rules";
import { type WizardCtx, devicesFromFlags, flagsFromDevices, typedInt } from "@/lib/wizard-draft";

/**
 * The design's named states, addressable as `?view=`. Lives here, not in the client component:
 * a server page importing a value from a "use client" module gets a client reference.
 */
export const SPLIT_URL_VIEWS = [
  "new",
  "setup",
  "setupErrors",
  "traffic",
  "targeting",
  "goal",
  "review",
  "checking",
  "checkError",
  "install",
  "installVerify",
  "confirm",
  "launchError",
  "success",
  "collecting",
  "results",
] as const;
export type SplitUrlViewName = (typeof SPLIT_URL_VIEWS)[number];

export const ACCENT = "#0070C9";
export const ACCENT_TINT = "#E6F4FF";
export const ACCENT_WASH = "#F0F7FF";
export const ACCENT_INK = "#0060AD";
export const ACCENT_LINE = "#B3DBFF";

/** Arm palette; index 0 is the Control's grey. Label ink on each, for the split bar. */
export const COLORS = ["#6B7280", ACCENT, "#F97316", "#14B8A6", "#A855F7"];
export const LABEL_FG = ["#FFFFFF", "#FFFFFF", "#111827", "#111827", "#FFFFFF"];

/** The project the draft belongs to. The design hard-codes Fernwood Supply. */
export const PROJECT_DOMAIN = "fernwoodsupply.com";
export const PIXEL_KEY = "prj_fws_4821";
export const SNIPPET =
  "<!-- Routely anti-flicker: hides the page until variants load (max 2 s) -->\n" +
  '<style id="routely-hide">body{opacity:0 !important}</style>\n' +
  '<script>setTimeout(function(){var s=document.getElementById("routely-hide");if(s)s.remove();},2000);</script>\n\n' +
  "<!-- Routely pixel -->\n" +
  `<script src="[ROUTELY_SCRIPT_URL]" data-project="${PIXEL_KEY}"></script>`;

export const MAX_VARIANTS = 4;
/** Visitors/day to the Control page over 30 days — the mock traffic estimate's base. */
export const BASELINE = 1240;
/** Seeded results (visitors, conversions) per arm for the `results` view. */
export const RESULT_DATA = [
  { v: 6124, c: 171 },
  { v: 6087, c: 208 },
  { v: 6050, c: 175 },
];
export const RESULT_DAYS = 15;

export interface Variant {
  id: string;
  name: string;
  url: string;
  /** Index into `COLORS`. */
  color: number;
}

export type Arm = Variant;

export interface SplitForm {
  name: string;
  controlUrl: string;
  variants: Variant[];
  keepParams: boolean;
  /** Percent of visitors included, as typed. */
  include: string;
  /** Percent per arm id ("control", "v1"…), as typed. */
  split: Record<string, string>;
  targeting: "all" | "specific";
  devices: { desktop: boolean; mobile: boolean; tablet: boolean };
  goalName: string;
  goalUrl: string;
  goalMatch: "exact" | "starts" | "contains";
  nextId: number;
}

export type TrackResult = "ok" | "missing";
export interface Tracking {
  status: "idle" | "checking" | "done" | "error";
  results: Record<string, TrackResult>;
  /** Why a page counts as missing, from the server (e.g. a different project’s snippet). */
  details?: Record<string, string>;
  /** The URLs the last check ran against; a change makes the result stale. */
  key: string;
  attempts: number;
}

export interface SplitState {
  /** The project and draft; a mock context for the design's `?view=` states. */
  ctx: WizardCtx;
  /** Problems only the server can see (another test on the page), shown on their step. Cleared
   * by the next edit. */
  serverIssues: LaunchIssue[];
  phase: "edit" | "success" | "results";
  step: number;
  visited: number;
  attempted: Record<number, boolean>;
  form: SplitForm;
  tracking: Tracking;
  modal: "install" | "confirm" | "pause" | null;
  instStep: 1 | 2;
  copied: boolean;
  verify: "idle" | "checking" | "success";
  launching: boolean;
  launchError: boolean;
  paused: boolean;
  hasData: boolean;
  saving: boolean;
  savedLabel: string;
  hoverIdx: number | null;
}

export function sampleForm(): SplitForm {
  return {
    name: "Fall sale landing page",
    controlUrl: "https://fernwoodsupply.com/fall-sale",
    variants: [
      { id: "v1", name: "Variant A", url: "https://fernwoodsupply.com/fall-sale-v2", color: 1 },
      { id: "v2", name: "Variant B", url: "https://fernwoodsupply.com/fall-sale-v3", color: 2 },
    ],
    keepParams: true,
    include: "100",
    split: { control: "34", v1: "33", v2: "33" },
    targeting: "all",
    devices: { desktop: false, mobile: false, tablet: false },
    goalName: "",
    goalUrl: "https://fernwoodsupply.com/checkout/thank-you",
    goalMatch: "exact",
    nextId: 3,
  };
}

export function emptyForm(): SplitForm {
  return {
    name: "",
    controlUrl: "",
    variants: [{ id: "v1", name: "Variant A", url: "", color: 1 }],
    keepParams: true,
    include: "100",
    split: { control: "50", v1: "50" },
    targeting: "all",
    devices: { desktop: false, mobile: false, tablet: false },
    goalName: "",
    goalUrl: "",
    goalMatch: "exact",
    nextId: 2,
  };
}

/** The state each `?view=` opens in, exactly as the reference's `init(view)`. */
export const MOCK_CTX: WizardCtx = {
  live: false,
  draftId: null,
  projectId: "fernwood",
  domain: PROJECT_DOMAIN,
  pixelKey: PIXEL_KEY,
  snippet: SNIPPET,
  baseline: BASELINE,
  readOnly: false,
};

export function initState(view: SplitUrlViewName): SplitState {
  const st: SplitState = {
    ctx: MOCK_CTX,
    serverIssues: [],
    phase: "edit",
    step: 1,
    visited: 1,
    attempted: {},
    form: emptyForm(),
    tracking: { status: "idle", results: {}, key: "", attempts: 0 },
    modal: null,
    instStep: 1,
    copied: false,
    verify: "idle",
    launching: false,
    launchError: false,
    paused: false,
    hasData: false,
    saving: false,
    savedLabel: "",
    hoverIdx: null,
  };
  if (view === "new") return st;
  const S = sampleForm();
  st.form = S;
  st.savedLabel = "Draft saved";
  if (view === "setup") return st;
  if (view === "setupErrors") {
    st.form = {
      ...S,
      name: "",
      variants: [
        { id: "v1", name: "Variant A", url: "https://fernwoodsupply.com/fall-sale", color: 1 },
        { id: "v2", name: "Variant B", url: "", color: 2 },
      ],
    };
    st.attempted = { 1: true };
    return st;
  }
  if (view === "traffic") {
    st.form = { ...S, split: { control: "50", v1: "25", v2: "25" }, include: "60" };
    st.step = st.visited = 2;
    return st;
  }
  if (view === "targeting") {
    st.form = {
      ...S,
      targeting: "specific",
      devices: { desktop: true, mobile: true, tablet: false },
    };
    st.step = st.visited = 3;
    return st;
  }
  if (view === "goal") {
    st.step = st.visited = 4;
    return st;
  }
  st.step = st.visited = 5;
  const key = trackKey(S);
  if (view === "review" || view === "install" || view === "installVerify") {
    st.tracking = { status: "done", results: missingResults(S), key, attempts: 1 };
    if (view !== "review") {
      st.modal = "install";
      st.instStep = view === "installVerify" ? 2 : 1;
    }
    return st;
  }
  if (view === "checking") {
    st.tracking = { status: "checking", results: {}, key, attempts: 0 };
    return st;
  }
  if (view === "checkError") {
    st.tracking = { status: "error", results: {}, key, attempts: 0 };
    return st;
  }
  st.tracking = { status: "done", results: okResults(S), key, attempts: 2 };
  if (view === "confirm") {
    st.modal = "confirm";
    return st;
  }
  if (view === "launchError") {
    st.launchError = true;
    return st;
  }
  if (view === "success") {
    st.phase = "success";
    return st;
  }
  st.phase = "results";
  st.hasData = view === "results";
  return st;
}

// --- URL helpers ------------------------------------------------------------------------------

export function validUrl(u: string): boolean {
  const t = String(u || "").trim();
  if (!t) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#][^\s]*)?$/i.test(t);
}

export function norm(u: string): string {
  let t = String(u || "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = "https://" + t;
  return t;
}

export const urlKey = (u: string) => norm(u).toLowerCase().replace(/\/+$/, "");

export const host = (u: string) =>
  norm(u)
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]!
    .toLowerCase()
    .replace(/^www\./, "");

export function shortUrl(u: string): string {
  return norm(u)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

// --- Traffic split ----------------------------------------------------------------------------

export function evenSplit(ids: string[]): Record<string, string> {
  const n = ids.length;
  const base = Math.floor(100 / n);
  const rem = 100 - base * n;
  const out: Record<string, string> = {};
  ids.forEach((id, i) => {
    out[id] = String(base + (i < rem ? 1 : 0));
  });
  return out;
}

/**
 * Set one arm's share and spread the rest over the others in proportion to their current
 * shares (largest remainder), so the total stays at 100 and nobody drops below 1%.
 */
export function rebalance(
  split: Record<string, string>,
  ids: string[],
  id: string,
  value: number,
): Record<string, string> {
  const n = ids.length;
  const out: Record<string, string> = {};
  if (n === 1) {
    out[id] = "100";
    return out;
  }
  const v = Math.max(1, Math.min(100 - (n - 1), Math.round(value)));
  const others = ids.filter((x) => x !== id);
  const pool = 100 - v - others.length;
  let weights = others.map((x) => {
    const c = parseInt(split[x] ?? "", 10);
    return isNaN(c) ? 0 : Math.max(0, c - 1);
  });
  let wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum === 0) {
    weights = others.map(() => 1);
    wsum = others.length;
  }
  const raw = weights.map((w) => (pool * w) / wsum);
  const floors = raw.map((r) => Math.floor(r));
  const left = pool - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; k < left; k++) {
    const o = order[k % order.length];
    if (o) floors[o.i] = (floors[o.i] ?? 0) + 1;
  }
  out[id] = String(v);
  others.forEach((x, i) => {
    out[x] = String(1 + (floors[i] ?? 0));
  });
  return out;
}

export function armsOf(f: SplitForm): Arm[] {
  return [{ id: "control", name: "Control", url: f.controlUrl, color: 0 }, ...f.variants];
}

export const colorOf = (a: { color: number }) => COLORS[a.color] ?? ACCENT;

export function pctOf(f: SplitForm, id: string): number {
  const v = parseInt(f.split[id] ?? "", 10);
  return isNaN(v) ? 0 : v;
}

// --- Tracking ---------------------------------------------------------------------------------

export function trackKey(f: SplitForm): string {
  return [f.controlUrl, ...f.variants.map((v) => v.url), f.goalUrl]
    .map((u) => urlKey(u || ""))
    .join("|");
}

export function okResults(f: SplitForm): Record<string, TrackResult> {
  const r: Record<string, TrackResult> = { control: "ok", goal: "ok" };
  f.variants.forEach((v) => {
    r[v.id] = "ok";
  });
  return r;
}

/** The mock's first check misses the last variant, so the install flow is reachable. */
export function missingResults(f: SplitForm): Record<string, TrackResult> {
  const r = okResults(f);
  const last = f.variants[f.variants.length - 1];
  if (last) r[last.id] = "missing";
  return r;
}

// --- Validation -------------------------------------------------------------------------------

export interface StepErrors {
  1: {
    name: string;
    control: string;
    warn: string;
    variants: Record<string, { name: string; url: string }>;
    count: number;
  };
  2: { include: string; split: string; low: Record<string, boolean>; total: number; count: number };
  3: { devices: string; count: number };
  4: { url: string; count: number };
}

/** The form as the launch rules read it. */
export function ruleExperiment(f: SplitForm): LaunchRuleExperiment {
  return {
    type: "SPLIT_URL",
    name: f.name,
    controlUrl: f.controlUrl,
    conversionUrl: f.goalUrl,
    controlWeight: pctOf(f, "control"),
    trafficAllocation: typedInt(f.include) ?? NaN,
    targeting: f.targeting,
    targetDevices: devicesFromFlags(f.targeting, f.devices),
    variants: f.variants.map((v) => ({
      id: v.id,
      name: v.name,
      url: v.url,
      weight: pctOf(f, v.id),
      changes: null,
    })),
  };
}

/**
 * Every step's problems, in the shape the screen renders. The rules and messages are
 * `setupIssues` (`lib/launch-rules.ts`) — the server's — with the project's domain; `extra` adds
 * what only the server could tell (another test on the page). Off-domain URLs are errors (D9),
 * so `warn` is always empty now.
 */
export function validate(
  f: SplitForm,
  domain: string,
  extra: readonly LaunchIssue[] = [],
): StepErrors {
  const issues = [...setupIssues(ruleExperiment(f), { domain })];
  for (const issue of extra) {
    if (!issues.some((other) => other.field === issue.field)) issues.push(issue);
  }
  const msg = (field: string) => issues.find((issue) => issue.field === field)?.message ?? "";
  const count = (step: number) => issues.filter((issue) => issue.step === step).length;

  const e1: StepErrors[1] = {
    name: msg("name"),
    control: msg("controlUrl"),
    warn: "",
    variants: {},
    count: count(1),
  };
  f.variants.forEach((v) => {
    e1.variants[v.id] = {
      name: msg("variants." + v.id + ".name"),
      url: msg("variants." + v.id + ".url"),
    };
  });

  const rule = ruleExperiment(f);
  const low: Record<string, boolean> = {};
  lowArms(rule).forEach((id) => {
    low[id] = true;
  });
  const e2: StepErrors[2] = {
    include: msg("trafficAllocation"),
    split: msg("split"),
    low,
    total: splitTotal(rule),
    count: count(2),
  };

  return {
    1: e1,
    2: e2,
    3: { devices: msg("devices"), count: count(3) },
    4: { url: msg("conversionUrl"), count: count(4) },
  };
}

// --- Real drafts ------------------------------------------------------------------------------

/** A stored Split URL experiment, as the server page hands it over. */
export interface SplitDraftRow {
  name: string;
  controlUrl: string | null;
  conversionUrl: string | null;
  keepQueryParams: boolean;
  trafficAllocation: number;
  controlWeight: number;
  targetDevices: readonly ("DESKTOP" | "MOBILE" | "TABLET")[];
  /** In position order. */
  variants: readonly {
    id: string;
    name: string;
    url: string | null;
    weight: number;
    colorIndex: number;
  }[];
}

/** The wizard's form for a stored draft. Variant ids are the stored ids. */
export function formFromDraft(row: SplitDraftRow): SplitForm {
  const { targeting, devices } = flagsFromDevices(row.targetDevices);
  const split: Record<string, string> = { control: String(row.controlWeight) };
  row.variants.forEach((v) => {
    split[v.id] = String(v.weight);
  });
  return {
    name: row.name,
    controlUrl: row.controlUrl ?? "",
    variants: row.variants.map((v) => ({
      id: v.id,
      name: v.name,
      url: v.url ?? "",
      color: v.colorIndex,
    })),
    keepParams: row.keepQueryParams,
    include: String(row.trafficAllocation),
    split,
    targeting,
    devices,
    goalName: "",
    goalUrl: row.conversionUrl ?? "",
    goalMatch: "exact",
    nextId: row.variants.length + 1,
  };
}

/**
 * The autosave patch for the whole form (`draftPatchSchema`). `idFor` maps a row's local id to
 * its stored id once it has one. Values are stored as they stand — validity is launch's job.
 */
export function draftPatch(f: SplitForm, step: number, idFor: (key: string) => string | undefined) {
  const include = typedInt(f.include);
  return {
    name: f.name,
    controlUrl: f.controlUrl.trim() || null,
    conversionUrl: f.goalUrl.trim() || null,
    keepQueryParams: f.keepParams,
    ...(include === null ? {} : { trafficAllocation: include }),
    controlWeight: typedInt(f.split.control) ?? 0,
    targetDevices: devicesFromFlags(f.targeting, f.devices),
    wizardStep: step,
    variants: f.variants.map((v) => ({
      ...(idFor(v.id) ? { id: idFor(v.id) } : {}),
      key: v.id,
      name: v.name,
      url: v.url.trim() || null,
      weight: typedInt(f.split[v.id]) ?? 0,
      colorIndex: v.color,
    })),
  };
}

/** A live wizard's opening state. */
export function liveState(
  ctx: WizardCtx,
  form: SplitForm,
  opening: { step: number; savedLabel: string },
): SplitState {
  return {
    ...initState("new"),
    ctx,
    form,
    step: opening.step,
    visited: opening.step,
    savedLabel: opening.savedLabel,
  };
}

/** Normal CDF (Abramowitz–Stegun erf), for the mock's "chance to beat Control". */
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  const erf = z < 0 ? -y : y;
  return 0.5 * (1 + erf);
}

export const fmt = (n: number) => Number(n).toLocaleString("en-US");

export const STEPS = [
  {
    n: 1,
    label: "Setup & variants",
    title: "Set up your pages",
    desc: "Choose the page you want to test and the pages to compare it with.",
  },
  {
    n: 2,
    label: "Traffic",
    title: "Allocate traffic",
    desc: "Decide how many visitors enter the experiment and how they’re split between versions.",
  },
  {
    n: 3,
    label: "Targeting",
    title: "Choose who can enter",
    desc: "Include every visitor, or limit the experiment to specific devices.",
  },
  {
    n: 4,
    label: "Goal",
    title: "Set a conversion goal",
    desc: "Pick the page that counts as a conversion. Routely compares how often visitors to each version reach it.",
  },
  {
    n: 5,
    label: "Review & launch",
    title: "Review and launch",
    desc: "Check your setup and tracking before the experiment goes live.",
  },
] as const;
