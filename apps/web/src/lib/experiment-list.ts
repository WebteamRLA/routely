/**
 * The Experiments list's rows, as plain data: what `/experiments` renders for each experiment,
 * built from its stored fields and per-arm counts.
 *
 * Notes and rates come from `lib/verdict.ts` (`resultNote(…, "list")`, the pooled rate), so the
 * list can never disagree with the experiment's own results page. Pure — the results service
 * calls `buildListItem` with facts it read, and the tests call it with fixtures.
 */

import {
  formatClockTime,
  formatMonthDay,
  formatMonthDayYear,
  isJustNow,
} from "@/lib/experiment-time";
import { shortUrl } from "@/lib/launch-rules";
import { type WinnerDecision, analyzeResults, resultNote, resultStatusOf } from "@/lib/verdict";

export type ExperimentType = "ab" | "split";
export type ExperimentListStatus = "draft" | "running" | "paused" | "completed";

export interface ExperimentListItem {
  id: string;
  name: string;
  /** A/B: the tested page's path; Split URL: "/pricing → /pricing-b". */
  path: string;
  type: ExperimentType;
  status: ExperimentListStatus;
  /** `null` for drafts, which have never had a visitor. */
  visitors: number | null;
  /** Arms including Control ("2 variants" for a plain A/B test, as the design counts them). */
  variants: number;
  /** `trafficAllocation`. */
  alloc: number;
  /** Pooled conversion rate as a percentage (3.8 for 3.8%); null when there is nothing to divide. */
  rate: number | null;
  note: string;
  updLabel: string;
  updTime: string;
  /** Where "View results" goes; null for a draft. */
  resultsHref: string | null;
  /** Where "Continue editing" goes; null unless a draft. */
  editHref: string | null;
}

/** The facts one row is built from. */
export interface ListItemInput {
  id: string;
  name: string;
  type: "SPLIT_URL" | "AB_TEST";
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  controlUrl: string | null;
  /** The first variant's URL (Split URL). */
  variantUrl: string | null;
  trafficAllocation: number;
  updatedAt: Date;
  /** Control first, then variants by position. */
  arms: { name: string; visitors: number; conversions: number }[];
  /** The chosen winner (`storedDecision`), when one was chosen. */
  decision?: Pick<WinnerDecision, "armIndex" | "basis"> | null;
  /** True when the latest activity was the viewer's own, under a minute ago. */
  changedByViewerJustNow: boolean;
  resultsHref: string;
  editHref: string;
}

export interface ListContext {
  now: Date;
  /** IANA zone for "Today" / "Yesterday" / "Oct 10" and the time beside it. */
  timeZone?: string;
}

/** Shown in place of an empty draft name. */
export const UNTITLED = "Untitled experiment";

function pathOf(url: string | null): string | null {
  if (!url?.trim()) return null;
  const s = shortUrl(url);
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i) : "/";
}

export function listPath(
  input: Pick<ListItemInput, "type" | "controlUrl" | "variantUrl"> & { variantCount?: number },
): string {
  const control = pathOf(input.controlUrl);
  if (input.type === "AB_TEST") return control ?? "No page set yet";
  if (!control && !input.variantUrl) return "No pages set yet";
  // With several variants, naming only the first would misdescribe the test.
  if ((input.variantCount ?? 1) > 1) return `${control ?? "…"} → ${input.variantCount} variants`;
  return `${control ?? "…"} → ${pathOf(input.variantUrl) ?? "…"}`;
}

/** `YYYY-MM-DD` of an instant in a time zone. */
function dayIn(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
  return parts;
}

/**
 * "Last updated": "Just now" under a minute, then "Today" / "Yesterday" / "Oct 10" (with the year
 * when it is not this year), each with the clock time beside it — in the viewer's zone.
 */
export function updatedLabel(
  at: Date,
  ctx: ListContext & { byViewer?: boolean },
): { label: string; time: string } {
  const tz = ctx.timeZone ?? "UTC";
  if (isJustNow(at, ctx.now)) {
    return { label: "Just now", time: ctx.byViewer ? "by you" : formatClockTime(at, tz) };
  }
  const time = formatClockTime(at, tz);
  const today = dayIn(ctx.now, tz);
  const day = dayIn(at, tz);
  if (day === today) return { label: "Today", time };
  if (day === dayIn(new Date(ctx.now.getTime() - 86_400_000), tz)) {
    return { label: "Yesterday", time };
  }
  return {
    label:
      day.slice(0, 4) === today.slice(0, 4) ? formatMonthDay(at, tz) : formatMonthDayYear(at, tz),
    time,
  };
}

export function buildListItem(input: ListItemInput, ctx: ListContext): ExperimentListItem {
  const status = resultStatusOf(input.status);
  const isDraft = status === "draft";
  const analysis = analyzeResults(
    input.arms.length > 0 ? input.arms : [{ name: "Control", visitors: 0, conversions: 0 }],
  );
  const updated = updatedLabel(input.updatedAt, { ...ctx, byViewer: input.changedByViewerJustNow });

  return {
    id: input.id,
    name: input.name.trim() || UNTITLED,
    path: listPath({ ...input, variantCount: input.arms.length - 1 }),
    type: input.type === "AB_TEST" ? "ab" : "split",
    status,
    visitors: isDraft ? null : analysis.totalVisitors,
    variants: Math.max(1, input.arms.length),
    alloc: input.trafficAllocation,
    rate: isDraft || analysis.pooledRate === null ? null : analysis.pooledRate * 100,
    note: resultNote(analysis, status, "list", input.decision ?? null),
    updLabel: updated.label,
    updTime: updated.time,
    resultsHref: isDraft ? null : input.resultsHref,
    editHref: isDraft ? input.editHref : null,
  };
}

export const STATUS_META: Record<
  ExperimentListStatus,
  { label: string; dot: string; bg: string; fg: string }
> = {
  draft: { label: "Draft", dot: "#9CA3AF", bg: "#F3F4F6", fg: "#374151" },
  running: { label: "Running", dot: "#0091FF", bg: "#E6F4FF", fg: "#0060AD" },
  paused: { label: "Paused", dot: "#F59E0B", bg: "#FEF3C7", fg: "#92400E" },
  completed: { label: "Completed", dot: "#16A34A", bg: "#DCFCE7", fg: "#166534" },
};

/** Letter-tile colours. */
export const TILES: [string, string][] = [
  ["#CCFBF1", "#115E59"],
  ["#E6F4FF", "#0060AD"],
  ["#DCFCE7", "#166534"],
  ["#FCE7F3", "#9D174D"],
  ["#F3E8FF", "#6B21A8"],
  ["#FEF3C7", "#92400E"],
];

/** A row keeps its tile colour: picked by a hash of the id (no stored colour exists). */
export function tileFor(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[hash % TILES.length]!;
}

export const formatCount = (n: number) => n.toLocaleString("en-US");

/**
 * The design's named states for this screen, addressable as `?view=`. `data` is the real list;
 * the rest are visual states (a skeleton, the error panel, the confirm dialog, the empty and
 * no-results panels) kept so each can be compared with the prototype.
 */
export const EXPERIMENTS_VIEWS = [
  "data",
  "confirm",
  "empty",
  "noResults",
  "loading",
  "error",
] as const;
export type ExperimentsView = (typeof EXPERIMENTS_VIEWS)[number];
