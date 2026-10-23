/**
 * A/B test wizard — mock state and the pure rules the screen runs on, ported from the design's
 * `ABTest` logic class so every seed, message and number matches the reference.
 *
 * Two modes. With a real draft (`ctx.live`) the form is loaded from and autosaved to the
 * experiment — including each variant's stored `VisualChange`s (`Variant.visual`), which the live
 * visual editor (`components/ab-test/live-editor`) makes on the customer's real page — and
 * tracking checks and launch go to the server, under `lib/launch-rules.ts`'s rules (the server's
 * own). The design's `?view=` states stay seeded and simulated, on the design's mock storefront
 * (`Variant.changes`), which never reaches the server.
 */

import {
  type LaunchIssue,
  type LaunchRuleExperiment,
  STEP_LABELS,
  isValidPageUrl,
  lowArms,
  setupIssues,
  splitTotal,
} from "@/lib/launch-rules";
import {
  type WizardCtx,
  devicesFromFlags,
  flagsFromDevices,
  savedAtPhrase,
  typedInt,
} from "@/lib/wizard-draft";
import type { VisualChange } from "@/validation/visual-change";

/**
 * The design's named states, addressable as `?view=`. Lives here, not in the client component:
 * a server page importing a value from a "use client" module gets a client reference.
 */
export const AB_TEST_VIEWS = [
  "new",
  "resume",
  "resumeShipping",
  "resumeAuthorBio",
  "setup",
  "setupErrors",
  "editor",
  "editorMobile",
  "original",
  "traffic",
  "targeting",
  "goal",
  "review",
  "checking",
  "tracking",
  "trackingVerify",
  "confirm",
  "launchError",
  "success",
  "collecting",
  "early",
  "results",
] as const;
export type AbTestViewName = (typeof AB_TEST_VIEWS)[number];

export type ElementId = "banner" | "h1" | "sub" | "cta" | "img" | "h2";
export type ImageId = "trail" | "camp" | "forest";
export type Device = "desktop" | "tablet" | "mobile";

/** One element's overrides in a variant. Only changed keys are present. */
export interface ElementChange {
  text?: string;
  bg?: string;
  img?: ImageId;
  alt?: string;
}
export type Changes = Partial<Record<ElementId, ElementChange>>;

export interface Variant {
  id: string;
  name: string;
  /** Index into the arm palette (0 is the Control's grey). */
  color: number;
  /** The mock storefront's overrides — the design's `?view=` states only. Empty on a real draft. */
  changes: Changes;
  /**
   * A real draft's stored changes, made on the customer's page by the live editor. Present (even
   * empty) on every variant of a real draft once loaded or edited; absent in the `?view=` states.
   */
  visual?: VisualChange[];
}

export interface AbForm {
  name: string;
  pageUrl: string;
  variants: Variant[];
  /** Percent of visitors included, as typed. */
  include: string;
  /** Percent per arm id ("control", "v1"…), as typed. */
  split: Record<string, string>;
  targeting: "all" | "specific";
  devices: { desktop: boolean; mobile: boolean; tablet: boolean };
  goalUrl: string;
  nextId: number;
}

export interface Arm {
  id: string;
  name: string;
  color: number;
  changes: Changes;
  visual?: VisualChange[];
}

/** Changed elements in an arm: the live editor's stored list, or the mock's overrides. */
export const changeCountOf = (a: { changes: Changes; visual?: readonly VisualChange[] }) =>
  a.visual ? a.visual.length : Object.keys(a.changes || {}).length;

export type TrackResult = "ok" | "missing";
export interface Tracking {
  status: "idle" | "checking" | "done" | "error";
  results: Partial<Record<"page" | "goal", TrackResult>>;
  /** Why a page counts as missing, from the server (e.g. a different project’s snippet). */
  details?: Record<string, string>;
  /** The page/goal pair the last check ran against; a different pair makes it stale. */
  key: string;
  attempts: number;
}

export interface VeState {
  target: string;
  draft: Changes;
  saved: Changes;
  selected: ElementId | null;
  device: Device;
  history: Changes[];
}

export interface AbState {
  /** The project and draft; a mock context for the design's `?view=` states. */
  ctx: WizardCtx;
  /** Problems only the server can see (another test on the page). Cleared by the next edit. */
  serverIssues: LaunchIssue[];
  phase: "edit" | "success" | "results";
  step: number;
  visited: number;
  attempted: Record<number, boolean>;
  form: AbForm;
  tracking: Tracking;
  modal: null | "install" | "confirm" | "pause";
  instStep: 1 | 2;
  copied: boolean;
  verify: "idle" | "checking" | "success";
  launching: boolean;
  launchError: boolean;
  paused: boolean;
  data: "none" | "early" | "mature";
  saving: boolean;
  savedLabel: string;
  hoverIdx: number | null;
  ve: VeState | null;
  veConfirm: { next: string | null } | null;
  rmConfirm: { id: string; name: string; n: number } | null;
  resumed: boolean;
  resumeInfo: { title: string; text: string } | null;
  project: "fernwood" | "journal" | "kestrel";
}

export interface ElementDef {
  typeLabel: "Text" | "Heading" | "Button" | "Image";
  label: string;
  text?: string;
  bg?: string;
  img?: ImageId;
  alt?: string;
}

export const ELEMENTS: Record<ElementId, ElementDef> = {
  banner: {
    typeLabel: "Text",
    label: "Announcement bar",
    text: "Free shipping on orders over $75",
  },
  h1: { typeLabel: "Heading", label: "Hero heading", text: "Gear up for fall" },
  sub: {
    typeLabel: "Text",
    label: "Hero text",
    text: "Layers, packs and trail essentials for cooler days outside.",
  },
  cta: { typeLabel: "Button", label: "Hero button", text: "Shop the sale", bg: "#1F3D2B" },
  img: { typeLabel: "Image", label: "Hero image", img: "trail", alt: "Hiker on an autumn trail" },
  h2: { typeLabel: "Heading", label: "Section heading", text: "Bestsellers this week" },
};

export const EL_ORDER: ElementId[] = ["banner", "h1", "sub", "cta", "img", "h2"];

export const IMAGES: Record<ImageId, { label: string; bg: string; ink: string }> = {
  trail: { label: "Autumn trail", bg: "#D9C9AE", ink: "#5E4E33" },
  camp: { label: "Campfire", bg: "#E6BB98", ink: "#6E3412" },
  forest: { label: "Forest path", bg: "#BACDB4", ink: "#34502F" },
};

export const BUTTON_COLORS: [string, string][] = [
  ["#1F3D2B", "Forest"],
  ["#B4532A", "Rust"],
  ["#14171F", "Ink"],
  ["#4D7C3A", "Moss"],
];

export const PRODUCTS = [
  { name: "Ridgeline 28L Daypack", price: "$89", bg: "#E4DCCB" },
  { name: "Alder Fleece Jacket", price: "$74", bg: "#D5DFD0" },
  { name: "Trailhead Thermos", price: "$32", bg: "#E8D5C4" },
];

/** How the mock page lays out at each preview width. */
export const DEVICE_FRAMES: Record<
  Device,
  {
    max: string;
    dir: "row" | "column";
    h1: string;
    pad: string;
    grid: string;
    imgH: string;
    nav: boolean;
  }
> = {
  desktop: {
    max: "1100px",
    dir: "row",
    h1: "40px",
    pad: "40px",
    grid: "repeat(3, minmax(0, 1fr))",
    imgH: "300px",
    nav: true,
  },
  tablet: {
    max: "768px",
    dir: "row",
    h1: "32px",
    pad: "28px",
    grid: "repeat(2, minmax(0, 1fr))",
    imgH: "240px",
    nav: true,
  },
  mobile: {
    max: "390px",
    dir: "column",
    h1: "28px",
    pad: "20px",
    grid: "minmax(0, 1fr)",
    imgH: "200px",
    nav: false,
  },
};

export const ACCENT = "#0070C9";
export const ACCENT_TINT = "#E6F4FF";
export const ACCENT_WASH = "#F0F7FF";
export const ACCENT_INK = "#0060AD";
export const ACCENT_LINE = "#B3DBFF";

/** Arm palette by `color` index, and the label ink that reads on each. */
export const ARM_COLORS = ["#6B7280", ACCENT, "#F97316", "#14B8A6", "#A855F7"];
export const ARM_LABEL_FG = ["#FFFFFF", "#FFFFFF", "#111827", "#111827", "#FFFFFF"];
export const colorOf = (a: { color: number }) => ARM_COLORS[a.color] ?? ACCENT;

export const MAX_VARIANTS = 4;

const PROJECT_KEYS = { fernwood: "prj_fws_4821", journal: "prj_fwj_1937", kestrel: "prj_kso_7720" };

export function snippetFor(project: AbState["project"]) {
  const key = PROJECT_KEYS[project] ?? PROJECT_KEYS.fernwood;
  return {
    key,
    snippet:
      '<!-- Routely anti-flicker: hides the page until variants load (max 2 s) -->\n<style id="routely-hide">body{opacity:0 !important}</style>\n<script>setTimeout(function(){var s=document.getElementById("routely-hide");if(s)s.remove();},2000);</script>\n\n<!-- Routely pixel -->\n<script src="[ROUTELY_SCRIPT_URL]" data-project="' +
      key +
      '"></script>',
  };
}

export const STEPS = [
  {
    n: 1,
    label: "Setup & variants",
    title: "Set up your test",
    desc: "Choose the page to test, then create your variants with the visual editor.",
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
    title: "Set your goal",
    desc: "Routely compares how often visitors to each version go on to view your goal page.",
  },
  {
    n: 5,
    label: "Review & launch",
    title: "Review and launch",
    desc: "Check your setup and tracking before the experiment goes live.",
  },
];

/** Results seeds: visitors (v) and goal page views (c) per arm, Control first. */
export const DATASETS = {
  early: {
    days: 3,
    start: [2026, 9, 11] as const,
    label: "Started Oct 11 · Day 3",
    rows: [
      { v: 612, c: 21 },
      { v: 598, c: 27 },
      { v: 605, c: 20 },
    ],
  },
  mature: {
    days: 14,
    start: [2026, 8, 30] as const,
    label: "Started Sep 30 · Day 14",
    rows: [
      { v: 4210, c: 151 },
      { v: 4187, c: 196 },
      { v: 4236, c: 158 },
    ],
  },
};
/** Each version needs this many visitors and goal views before a winner is suggested. */
export const MIN_VISITORS = 1000;
export const MIN_CONVERSIONS = 100;
/** Daily visitors to the tested page, for the traffic estimates. */
export const BASELINE_DAILY = 1240;

export const PROJECTS = [
  { id: "fernwood", name: "Fernwood Supply", domain: "fernwoodsupply.com" },
  { id: "journal", name: "Fernwood Journal", domain: "journal.fernwoodsupply.com" },
  { id: "kestrel", name: "Kestrel Outdoor", domain: "kestreloutdoor.co" },
] as const;

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o ?? {}));

export function describe(id: ElementId, ch: ElementChange) {
  const parts: string[] = [];
  if (ch.text != null) parts.push("“" + ch.text + "”");
  if (ch.bg) {
    const nm = BUTTON_COLORS.find((c) => c[0] === ch.bg);
    parts.push((nm ? nm[1] : "New") + " color");
  }
  if (ch.img) parts.push((IMAGES[ch.img] ? IMAGES[ch.img].label : "New") + " image");
  if (ch.alt != null) parts.push("alt text updated");
  return { label: ELEMENTS[id].label, detail: parts.join(" · ") };
}

export function sampleForm(): AbForm {
  return {
    name: "Fall homepage hero",
    pageUrl: "https://fernwoodsupply.com/",
    variants: [
      {
        id: "v1",
        name: "Variant A",
        color: 1,
        changes: {
          h1: { text: "Fall sale: up to 30% off trail gear" },
          cta: { text: "Shop fall deals", bg: "#B4532A" },
          img: { img: "camp" },
        },
      },
      {
        id: "v2",
        name: "Variant B",
        color: 2,
        changes: { banner: { text: "Fall sale ends Sunday · Free shipping over $75" } },
      },
    ],
    include: "100",
    split: { control: "34", v1: "33", v2: "33" },
    targeting: "all",
    devices: { desktop: false, mobile: false, tablet: false },
    goalUrl: "https://fernwoodsupply.com/collections/fall-sale",
    nextId: 3,
  };
}

export function emptyForm(): AbForm {
  return {
    name: "",
    pageUrl: "",
    variants: [{ id: "v1", name: "Variant A", color: 1, changes: {} }],
    include: "100",
    split: { control: "50", v1: "50" },
    targeting: "all",
    devices: { desktop: false, mobile: false, tablet: false },
    goalUrl: "",
    nextId: 2,
  };
}

export function veFor(target: string, device: Device, form: AbForm): VeState {
  const v = form.variants.find((x) => x.id === target);
  const ch = v ? clone(v.changes) : {};
  return {
    target: v ? target : "control",
    draft: ch,
    saved: clone(ch),
    selected: null,
    device,
    history: [],
  };
}

export function validUrl(u: string) {
  const t = String(u || "").trim();
  if (!t) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#][^\s]*)?$/i.test(t);
}

function norm(u: string) {
  let t = String(u || "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = "https://" + t;
  return t;
}

export const urlKey = (u: string) => norm(u).toLowerCase().replace(/\/+$/, "");

/** A URL without scheme, `www.` or trailing slash, for display. */
export const shortUrl = (u: string) =>
  norm(u)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");

export function evenSplit(ids: string[]) {
  const n = ids.length;
  const base = Math.floor(100 / n);
  const rem = 100 - base * n;
  const out: Record<string, string> = {};
  ids.forEach((id, i) => (out[id] = String(base + (i < rem ? 1 : 0))));
  return out;
}

/**
 * Sets one arm's share and spreads the remainder over the others in proportion to their current
 * shares (largest remainder), keeping every arm at 1% or more and the total at exactly 100.
 */
export function rebalance(split: Record<string, string>, ids: string[], id: string, value: number) {
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
  others.forEach((x, i) => (out[x] = String(1 + (floors[i] ?? 0))));
  return out;
}

export const armsOf = (f: AbForm): Arm[] => [
  { id: "control", name: "Control", color: 0, changes: {} },
  ...f.variants,
];

export const trackKey = (f: AbForm) => urlKey(f.pageUrl) + "|" + urlKey(f.goalUrl);

/** Standard normal CDF (Abramowitz–Stegun), for the "chance to beat Control" column. */
export function phi(z: number) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -y : y));
}

export interface StepErrors {
  1: { name: string; page: string; variants: Record<string, string>; count: number };
  2: { include: string; split: string; low: Record<string, boolean>; total: number; count: number };
  3: { devices: string; count: number };
  4: { url: string; count: number };
}

/** The form as the launch rules read it. */
export function ruleExperiment(f: AbForm): LaunchRuleExperiment {
  const pct = (id: string) => {
    const v = parseInt(f.split[id] ?? "", 10);
    return isNaN(v) ? 0 : v;
  };
  return {
    type: "AB_TEST",
    name: f.name,
    controlUrl: f.pageUrl,
    conversionUrl: f.goalUrl,
    controlWeight: pct("control"),
    trafficAllocation: typedInt(f.include) ?? NaN,
    targeting: f.targeting,
    targetDevices: devicesFromFlags(f.targeting, f.devices),
    variants: f.variants.map((v) => ({
      id: v.id,
      name: v.name,
      url: null,
      weight: pct(v.id),
      // The real list where there is one, so the rules can judge the changes themselves (a
      // placeholder from the sample page never launches); the mock's element ids otherwise.
      changes: v.visual ?? Object.keys(v.changes || {}),
    })),
  };
}

/**
 * Every step's problems, in the shape the screen renders. The rules and messages are
 * `setupIssues` (`lib/launch-rules.ts`), with the project's domain; `extra` adds what only the
 * server could tell (another test on the page).
 */
export function validate(
  f: AbForm,
  domain: string,
  extra: readonly LaunchIssue[] = [],
): StepErrors {
  const rule = ruleExperiment(f);
  const issues = [...setupIssues(rule, { domain })];
  for (const issue of extra) {
    if (!issues.some((other) => other.field === issue.field)) issues.push(issue);
  }
  const msg = (field: string) => issues.find((issue) => issue.field === field)?.message ?? "";
  const count = (step: number) => issues.filter((issue) => issue.step === step).length;

  const variants: Record<string, string> = {};
  f.variants.forEach((v) => {
    variants[v.id] = msg("variants." + v.id + ".changes");
  });
  const low: Record<string, boolean> = {};
  lowArms(rule).forEach((id) => {
    low[id] = true;
  });

  return {
    1: { name: msg("name"), page: msg("controlUrl"), variants, count: count(1) },
    2: {
      include: msg("trafficAllocation"),
      split: msg("split"),
      low,
      total: splitTotal(rule),
      count: count(2),
    },
    3: { devices: msg("devices"), count: count(3) },
    4: { url: msg("conversionUrl"), count: count(4) },
  };
}

// --- Real drafts ------------------------------------------------------------------------------

/** A stored A/B experiment, as the server page hands it over (changes already parsed). */
export interface AbDraftRow {
  name: string;
  controlUrl: string | null;
  conversionUrl: string | null;
  trafficAllocation: number;
  controlWeight: number;
  targetDevices: readonly ("DESKTOP" | "MOBILE" | "TABLET")[];
  variants: readonly {
    id: string;
    name: string;
    weight: number;
    colorIndex: number;
    changes: readonly VisualChange[];
  }[];
}

export function formFromDraft(row: AbDraftRow): AbForm {
  const { targeting, devices } = flagsFromDevices(row.targetDevices);
  const split: Record<string, string> = { control: String(row.controlWeight) };
  row.variants.forEach((v) => {
    split[v.id] = String(v.weight);
  });
  return {
    name: row.name,
    pageUrl: row.controlUrl ?? "",
    variants: row.variants.map((v) => ({
      id: v.id,
      name: v.name,
      color: v.colorIndex,
      changes: {},
      visual: [...v.changes],
    })),
    include: String(row.trafficAllocation),
    split,
    targeting,
    devices,
    goalUrl: row.conversionUrl ?? "",
    nextId: row.variants.length + 1,
  };
}

/** The autosave patch for the whole form (`draftPatchSchema`), the editor's changes included.
 * Only a real draft is saved, so the changes are always the live editor's (`visual`). */
export function draftPatch(f: AbForm, step: number, idFor: (key: string) => string | undefined) {
  const include = typedInt(f.include);
  return {
    name: f.name,
    controlUrl: f.pageUrl.trim() || null,
    conversionUrl: f.goalUrl.trim() || null,
    ...(include === null ? {} : { trafficAllocation: include }),
    controlWeight: typedInt(f.split.control) ?? 0,
    targetDevices: devicesFromFlags(f.targeting, f.devices),
    wizardStep: step,
    variants: f.variants.map((v) => ({
      ...(idFor(v.id) ? { id: idFor(v.id) } : {}),
      key: v.id,
      name: v.name,
      weight: typedInt(f.split[v.id]) ?? 0,
      colorIndex: v.color,
      changes: v.visual ?? [],
    })),
  };
}

/**
 * "Welcome back — you left off at Goal" / "… this draft is ready to launch", and the line under
 * it: when it was saved, what is already there, and what is left.
 */
export function resumeInfoFor(
  f: AbForm,
  step: number,
  updatedAt: Date,
  now: Date,
  domain: string,
): { title: string; text: string } {
  const errs = validate(f, domain);
  const firstBad = ([1, 2, 3, 4] as const).find((n) => errs[n].count > 0);
  const saved = "Last saved " + savedAtPhrase(updatedAt, now) + ".";
  if (!firstBad) {
    return {
      title: "Welcome back — this draft is ready to launch",
      text:
        saved +
        " Every step is filled in. Check tracking and launch when you’re ready, or go back to any step to make changes.",
    };
  }
  const have: string[] = [];
  if (isValidPageUrl(f.pageUrl)) have.push("Your page");
  const changed = f.variants.filter((v) => changeCountOf(v) > 0);
  if (changed.length === 1) have.push(changed[0]!.name + "’s changes");
  else if (changed.length > 1) have.push("your variants’ changes");
  if (firstBad > 2) have.push("traffic split");
  if (firstBad > 3) have.push("targeting");
  const list =
    have.length > 1 ? have.slice(0, -1).join(", ") + " and " + have[have.length - 1] : have[0];
  const present = list
    ? " " +
      list.charAt(0).toUpperCase() +
      list.slice(1) +
      (have.length > 1 ? " are" : " is") +
      " all here."
    : "";
  const next = {
    1: "Finish setting up your page and variants to continue.",
    2: "Adjust the traffic split to continue.",
    3: "Choose who can enter to continue.",
    4: "Add a goal page to finish setup.",
  }[firstBad];
  return {
    title: "Welcome back — you left off at " + STEP_LABELS[Math.min(step, 5) as 1 | 2 | 3 | 4 | 5],
    text: saved + present + " " + next,
  };
}

/** A live wizard's opening state. */
export function liveState(
  ctx: WizardCtx,
  form: AbForm,
  opening: {
    step: number;
    savedLabel: string;
    resumeInfo: { title: string; text: string } | null;
  },
): AbState {
  return {
    ...initState("new"),
    ctx,
    form,
    step: opening.step,
    visited: opening.step,
    savedLabel: opening.savedLabel,
    resumed: opening.resumeInfo !== null,
    resumeInfo: opening.resumeInfo,
  };
}

export const MOCK_CTX: WizardCtx = {
  live: false,
  draftId: null,
  projectId: "fernwood",
  domain: PROJECTS[0].domain,
  pixelKey: snippetFor("fernwood").key,
  snippet: snippetFor("fernwood").snippet,
  baseline: BASELINE_DAILY,
  readOnly: false,
};

/** The screen's state for each named view, exactly as the design's `init(view)` builds it. */
export function initState(view: AbTestViewName): AbState {
  const st: AbState = {
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
    data: "none",
    saving: false,
    savedLabel: "",
    hoverIdx: null,
    ve: null,
    veConfirm: null,
    rmConfirm: null,
    resumed: false,
    resumeInfo: null,
    project: "fernwood",
  };
  if (view === "new") return st;
  if (view === "resume") {
    st.form = {
      name: "Collection page filters",
      pageUrl: "https://fernwoodsupply.com/collections/all",
      variants: [
        {
          id: "v1",
          name: "Variant A",
          color: 1,
          changes: {
            h1: { text: "Find gear by activity" },
            h2: { text: "Filter by trail, camp or climb" },
          },
        },
      ],
      include: "100",
      split: { control: "50", v1: "50" },
      targeting: "specific",
      devices: { desktop: true, mobile: true, tablet: false },
      goalUrl: "",
      nextId: 2,
    };
    st.step = 4;
    st.visited = 4;
    st.resumed = true;
    st.savedLabel = "Draft saved Oct 9";
    st.resumeInfo = {
      title: "Welcome back — you left off at Goal",
      text: "Last saved Oct 9 at 2:48 PM. Your page, Variant A’s changes, traffic split and targeting are all here. Add a goal page to finish setup.",
    };
    return st;
  }
  if (view === "resumeShipping") {
    st.form = {
      name: "Free shipping banner",
      pageUrl: "https://fernwoodsupply.com/cart",
      variants: [
        {
          id: "v1",
          name: "Variant A",
          color: 1,
          changes: {
            banner: { text: "Free shipping on orders over $75" },
            cta: { text: "Check out with free shipping" },
          },
        },
      ],
      include: "100",
      split: { control: "50", v1: "50" },
      targeting: "all",
      devices: { desktop: false, mobile: false, tablet: false },
      goalUrl: "https://fernwoodsupply.com/checkout",
      nextId: 2,
    };
    st.step = 5;
    st.visited = 5;
    st.resumed = true;
    st.savedLabel = "Draft saved yesterday";
    st.resumeInfo = {
      title: "Welcome back — this draft is ready to launch",
      text: "Last saved yesterday at 4:05 PM. Every step is filled in. Check tracking and launch when you’re ready, or go back to any step to make changes.",
    };
    return st;
  }
  if (view === "resumeAuthorBio") {
    st.project = "journal";
    st.ctx = {
      ...MOCK_CTX,
      projectId: "journal",
      domain: PROJECTS[1].domain,
      pixelKey: snippetFor("journal").key,
      snippet: snippetFor("journal").snippet,
    };
    st.form = {
      name: "Author bio placement",
      pageUrl: "https://journal.fernwoodsupply.com/articles/gear-care-101",
      variants: [
        {
          id: "v1",
          name: "Variant A",
          color: 1,
          changes: { sub: { text: "By Jamie Lee — trail guide and gear tester for 12 years" } },
        },
      ],
      include: "50",
      split: { control: "50", v1: "50" },
      targeting: "specific",
      devices: { desktop: true, mobile: false, tablet: true },
      goalUrl: "https://journal.fernwoodsupply.com/newsletter/thanks",
      nextId: 2,
    };
    st.step = 5;
    st.visited = 5;
    st.resumed = true;
    st.savedLabel = "Draft saved Oct 13";
    st.resumeInfo = {
      title: "Welcome back — this draft is ready to launch",
      text: "Last saved Oct 13 at 5:30 PM. Every step is filled in. Check tracking and launch when you’re ready, or go back to any step to make changes.",
    };
    return st;
  }
  const S = sampleForm();
  st.form = S;
  st.savedLabel = "Draft saved";
  if (view === "setup") return st;
  if (view === "setupErrors") {
    st.form = { ...S, name: "", variants: [{ ...S.variants[0]!, changes: {} }, S.variants[1]!] };
    st.attempted = { 1: true };
    return st;
  }
  if (view === "editor" || view === "editorMobile") {
    const ve = veFor("v1", view === "editorMobile" ? "mobile" : "desktop", S);
    ve.history = [clone(ve.draft)];
    ve.draft.sub = { text: "Warm layers and trail essentials, now up to 30% off." };
    ve.selected = view === "editorMobile" ? "h1" : "cta";
    st.ve = ve;
    return st;
  }
  if (view === "original") {
    st.ve = veFor("control", "desktop", S);
    return st;
  }
  if (view === "traffic") {
    st.form = { ...S, split: { control: "50", v1: "25", v2: "25" }, include: "60" };
    st.step = 2;
    st.visited = 2;
    return st;
  }
  if (view === "targeting") {
    st.form = {
      ...S,
      targeting: "specific",
      devices: { desktop: true, mobile: true, tablet: false },
    };
    st.step = 3;
    st.visited = 3;
    return st;
  }
  if (view === "goal") {
    st.step = 4;
    st.visited = 4;
    return st;
  }
  st.step = 5;
  st.visited = 5;
  const key = trackKey(S);
  if (view === "checking") {
    st.tracking = { status: "checking", results: {}, key, attempts: 0 };
    return st;
  }
  if (view === "tracking" || view === "trackingVerify") {
    st.tracking = { status: "done", results: { page: "ok", goal: "missing" }, key, attempts: 1 };
    st.modal = "install";
    st.instStep = view === "trackingVerify" ? 2 : 1;
    return st;
  }
  st.tracking = { status: "done", results: { page: "ok", goal: "ok" }, key, attempts: 2 };
  if (view === "review") return st;
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
  st.data = view === "early" ? "early" : view === "results" ? "mature" : "none";
  return st;
}

export const fmt = (n: number) => Number(n).toLocaleString("en-US");
