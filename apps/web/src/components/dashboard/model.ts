/**
 * The dashboard ("Overview") view model, after the design's v2 `isDash` view: the header's
 * tracking pill and summary line, the Experiments table (each row's needs-action reason and
 * button), the conversions and visitors cards, the activity feed, the integrations list and the
 * rows the Export button writes — computed from real data with `lib/stats` and `lib/verdict`, so
 * the dashboard and the results page agree about the same numbers.
 *
 * Pure: no server imports. The page builds it and hands plain strings to the client components.
 */
import type { DisplayStatusKey, Threshold } from "@/lib/domain";
import { fAgo, fDate, fN, fP, fS, minutesSince } from "@/lib/format";
import { routes } from "@/lib/routes";
import { computeStats, type ArmStat, type ExperimentStats } from "@/lib/stats";
import { STATUS, TYPE_LABEL, verdict, type Verdict } from "@/lib/verdict";
import type { DashboardData, ExperimentListItem } from "@/lib/view-models";

import type { ExportRow } from "./export-csv";

/** The Experiments section's tabs. */
export type DashTab = "all" | "running" | "needs";

/** A row's button: a link, or "Install" (opens the install modal). */
export type RowAction = { label: string; href: string } | { label: string; install: true };

/** One row of the dashboard's Experiments table. */
export interface OverviewRow {
  id: string;
  name: string;
  /** Letter tile: A/B blue, Split URL coral. */
  initial: string;
  avBg: string;
  avColor: string;
  typeLabel: string;
  status: DisplayStatusKey;
  statusLabel: string;
  glyph: string;
  glyphColor: string;
  /** "day 18", "launched today", "2d ago", "edited 2h ago", "ended Oct 3". */
  when: string;
  running: boolean;
  /** Why this experiment needs a decision; false rows show "—" / "On track". */
  needsAction: boolean;
  na: string;
  naSub: string;
  naColor: string;
  visitors: string;
  variants: string;
  /** Share of running + paused experiments' visitors, e.g. "76%". */
  share: string;
  /** Best variant's conversion rate, its lift vs control (or "no result yet"). */
  cr: string;
  crSub: string;
  crSubColor: string;
  liftShort: string;
  action: RowAction;
  /** Navy button when the row needs action, white outlined otherwise. */
  primary: boolean;
  href: string;
}

export interface ConversionBar {
  id: string;
  name: string;
  conversions: string;
  cr: string;
  /** Bar width, e.g. "64%". */
  width: string;
  href: string;
}

export interface VisitorBar {
  /** Bar height, e.g. "42%". */
  height: string;
  /** Day of month on every other bar, else "". */
  label: string;
  tip: string;
  today: boolean;
}

export interface FeedItem {
  id: string;
  who: string;
  initials: string;
  avBg: string;
  text: string;
  experiment: string;
  when: string;
  href: string;
}

export interface IntegrationItem {
  key: "snippet" | "gtm" | "sheets" | "cdn";
  mark: string;
  name: string;
  desc: string;
  bg: string;
  fg: string;
  status: { text: string; color: string } | null;
  /** Null: opens the install modal. */
  href: string | null;
}

export interface DashboardView {
  tracking: { live: boolean; label: string; sub: string };
  /** "Last 14 days · 2 ready to call". */
  sub: string;
  counts: Record<DashTab, number>;
  /** Every experiment, needs-action first, then running · paused · draft · completed. */
  rows: OverviewRow[];
  conversions: { total: string; sub: string; bars: ConversionBar[] };
  visitors: {
    total: string;
    delta: string;
    deltaColor: string;
    avg: string;
    bars: VisitorBar[];
    has: boolean;
  };
  feed: FeedItem[];
  integrations: IntegrationItem[];
  exportRows: ExportRow[];
}

export interface DashboardContext {
  projectId: string;
  /** Primary domain. */
  domain: string;
  /** Snippet seen on a page, or tracking data has arrived (`ProjectSummary.installed`). */
  installed: boolean;
  threshold: Threshold;
  /** Draft id → number of wizard steps with validation errors. */
  draftIncomplete: Record<string, number>;
  /** The signed-in user as activity rows record them (name, else email) — shown as "You". */
  actorName: string;
  now?: Date;
}

const GOOD = "#0F7A52";
const BAD = "#B4361F";
const MUTED = "#5B6579";
/** Activity avatar colours (prototype `AV`). */
const AV = ["#0A1633", "#2B59F0", "#F0603F", "#11A08F", "#B7860B"];

/** Stats over an experiment's all-time per-arm totals (arms in position order). */
export function statsOf(e: ExperimentListItem): ExperimentStats {
  const arms = [...e.arms].sort((a, b) => a.position - b.position);
  return computeStats(
    arms.map((a) => {
      const t = e.totals.find((x) => x.position === a.position);
      return { name: a.name, v: t?.v ?? 0, c: t?.c ?? 0 };
    }),
  );
}

/** The variant with the highest conversion rate (prototype `b`), or null with no variants. */
function bestVariant(st: ExperimentStats): ArmStat | null {
  return st.arms
    .slice(1)
    .reduce<ArmStat | null>((best, a) => (!best || a.cr > best.cr ? a : best), null);
}

/** Two-letter initials: "Marcus Lee" → "ML", "dev@routely.local" → "DR". */
export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Project-local `YYYY-MM-DD` for an instant. */
function dayKey(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone });
}

interface Need {
  na: string;
  naSub: string;
  color: string;
  fix?: RowAction;
}

export function buildDashboard(data: DashboardData, ctx: DashboardContext): DashboardView {
  const now = ctx.now ?? new Date();
  const tz = data.timezone;
  const p = routes.project(ctx.projectId);
  const domain = ctx.domain || "your site";
  const silent = new Map(data.silentMetrics.map((m) => [m.id, m]));

  const all = data.experiments.map((e) => {
    const st = statsOf(e);
    return { e, st, vd: verdict(e.status, e.winnerPosition, st, ctx.threshold) as Verdict };
  });
  const ready = all.filter((x) => x.e.status === "running" && x.vd.ready).length;

  // Why a row needs a decision — the prototype's `need()`, in its order.
  const need = ({ e, st, vd }: (typeof all)[number]): Need | null => {
    if (e.status === "draft") {
      const n = ctx.draftIncomplete[e.id] ?? 0;
      return n
        ? { na: "Setup incomplete", naSub: `${n} step${n > 1 ? "s" : ""} left`, color: "#4B5568" }
        : { na: "Ready to launch", naSub: "Run QA and launch", color: "#1F3FB0" };
    }
    if (e.status === "paused")
      return { na: "Paused", naSub: "Visitors see Control", color: "#94600A" };
    if (e.status !== "running") return null;
    if (!ctx.installed)
      return {
        na: "Tracking not installed",
        naSub: "No data can be collected",
        color: BAD,
        fix: { label: "Install", install: true },
      };
    const metric = e.goal?.metricId ? silent.get(e.goal.metricId) : undefined;
    if (metric)
      return {
        na: "Goal never fired",
        naSub: `${metric.key} not received`,
        color: BAD,
        fix: { label: "Fix goal", href: p.metrics("gtm", { metric: metric.id }) },
      };
    if (!st.v) return { na: "No traffic", naSub: "Check targeting", color: "#94600A" };
    if (vd.ready)
      return {
        na: "Ready to call",
        naSub: vd.kind === "control" ? "Control is ahead" : "Winner found",
        color: GOOD,
      };
    return null;
  };

  const rank: Record<string, number> = { running: 0, paused: 1, draft: 2, completed: 3 };
  const enriched = all
    .map((x) => ({ ...x, n: need(x) }))
    .sort(
      (a, b) =>
        Number(!!b.n) - Number(!!a.n) ||
        rank[a.e.status]! - rank[b.e.status]! ||
        b.e.updatedAt.localeCompare(a.e.updatedAt),
    );
  const liveVisitors = all
    .filter((x) => x.e.status === "running" || x.e.status === "paused")
    .reduce((t, x) => t + x.st.v, 0);

  const rows: OverviewRow[] = enriched.map(({ e, st, n }) => {
    const has = st.v > 0;
    const best = bestVariant(st);
    const S = STATUS[e.displayStatus];
    const ago = fAgo(minutesSince(e.updatedAt, now)).toLowerCase();
    const when =
      e.status === "running"
        ? e.daysRunning
          ? `day ${e.daysRunning}`
          : "launched today"
        : e.status === "paused"
          ? ago
          : e.status === "draft"
            ? `edited ${ago}`
            : `ended ${fDate(e.stoppedAt ?? e.updatedAt, tz)}`;
    const isAB = e.type === "ab";
    const nv = e.arms.length - 1;
    const href = e.status === "draft" ? p.editExperiment(e.id) : p.experiment(e.id);
    const action: RowAction = n?.fix
      ? n.fix
      : {
          label:
            e.status === "draft" ? "Continue" : e.status === "completed" ? "Results" : "Review",
          href,
        };
    const live = e.status === "running" || e.status === "paused";
    return {
      id: e.id,
      name: e.name,
      initial: e.name.trim().charAt(0).toUpperCase() || "?",
      avBg: isAB ? "#E8EEFE" : "#FDEBE6",
      avColor: isAB ? "#1F3FB0" : "#B4361F",
      typeLabel: TYPE_LABEL[e.type],
      status: e.displayStatus,
      statusLabel: S.label,
      glyph: S.glyph,
      glyphColor: S.gc,
      when,
      running: e.status === "running",
      needsAction: !!n,
      na: n ? n.na : "—",
      naSub: n ? n.naSub : "On track",
      naColor: n ? n.color : "#8A93A6",
      visitors: has ? fN(st.v) : "0",
      variants: `${nv} variant${nv === 1 ? "" : "s"}`,
      share: liveVisitors && live ? `${Math.round((st.v / liveVisitors) * 100)}%` : "0%",
      cr: has && best ? fP(best.cr, 2) : "—",
      crSub: has && best ? `${fS(best.lift)} vs control` : "no result yet",
      crSubColor: has && best ? (best.lift >= 0 ? GOOD : BAD) : MUTED,
      liftShort: has && best ? fS(best.lift) : "",
      action,
      primary: !!n,
      href,
    };
  });

  // Conversions by running experiment: all-time primary-goal conversions, top five.
  const runs = all
    .filter((x) => x.e.status === "running" && x.st.v > 0)
    .sort((a, b) => b.st.c - a.st.c);
  const maxC = Math.max(1, ...runs.map((x) => x.st.c));
  const sumC = runs.reduce((t, x) => t + x.st.c, 0);
  const sumV = runs.reduce((t, x) => t + x.st.v, 0);

  // Visitors over time: 14 project-local days; delta = last 7 vs the 7 before.
  const v7 = data.daily.slice(-7).reduce((t, d) => t + d.v, 0);
  const pv7 = data.daily.slice(-14, -7).reduce((t, d) => t + d.v, 0);
  const dv = pv7 ? (v7 - pv7) / pv7 : 0;
  const maxV = Math.max(1, ...data.daily.map((d) => d.v));
  const sumDaily = data.daily.reduce((t, d) => t + d.v, 0);
  const last = data.days.length - 1;

  // Team activity.
  const byId = new Map(data.experiments.map((e) => [e.id, e]));
  const today = dayKey(now, tz);
  const feed: FeedItem[] = data.activity.flatMap((a) => {
    const e = byId.get(a.experimentId);
    if (!e) return [];
    const who = !a.actorName ? "Routely" : a.actorName === ctx.actorName ? "You" : a.actorName;
    const ini = who === "You" ? initialsOf(ctx.actorName) : initialsOf(who);
    return [
      {
        id: a.id,
        who,
        initials: ini,
        avBg: AV[(ini.charCodeAt(0) + (ini.charCodeAt(1) || 0)) % AV.length]!,
        text: a.text.replace(/^./, (c) => c.toLowerCase()),
        experiment: e.name,
        when: dayKey(a.createdAt, tz) === today ? "Today" : fDate(a.createdAt, tz),
        href: e.status === "draft" ? p.editExperiment(e.id) : p.experiment(e.id),
      },
    ];
  });

  return {
    tracking: ctx.installed
      ? { live: true, label: "Tracking live", sub: domain }
      : { live: false, label: "Script not seen", sub: `Install on ${domain}` },
    sub: `Last 14 days · ${ready ? `${ready} ready to call` : "no experiment ready to call yet"}`,
    counts: {
      all: data.experiments.length,
      running: all.filter((x) => x.e.status === "running").length,
      needs: enriched.filter((x) => x.n).length,
    },
    rows,
    conversions: {
      total: fN(sumC),
      sub: runs.length
        ? `${fP(sumV ? sumC / sumV : 0, 2)} conversion rate across ${runs.length} running experiment${runs.length > 1 ? "s" : ""}`
        : "No running experiment has data yet",
      bars: runs.slice(0, 5).map((x) => ({
        id: x.e.id,
        name: x.e.name,
        conversions: fN(x.st.c),
        cr: fP(x.st.c / x.st.v, 2),
        width: `${Math.max(2, Math.round((x.st.c / maxC) * 100))}%`,
        href: p.experiment(x.e.id),
      })),
    },
    visitors: {
      total: fN(data.uniqueVisitors),
      delta: pv7 ? `${dv >= 0 ? "▲" : "▼"} ${Math.abs(dv * 100).toFixed(1)}%` : "",
      deltaColor: dv >= 0 ? GOOD : BAD,
      avg: fN(Math.round(sumDaily / Math.max(1, data.days.length))),
      bars: data.days.map((day, i) => ({
        height: `${Math.max(2, Math.round(((data.daily[i]?.v ?? 0) / maxV) * 100))}%`,
        label: i % 2 === 1 ? String(Number(day.slice(8))) : "",
        tip: `${fDate(`${day}T12:00:00Z`)} · ${fN(data.daily[i]?.v ?? 0)} visitors · ${fN(data.daily[i]?.c ?? 0)} conversions`,
        today: i === last,
      })),
      has: sumDaily > 0,
    },
    feed,
    integrations: [
      {
        key: "snippet",
        mark: "RT",
        name: "Routely snippet",
        desc: ctx.installed ? `Installed on ${domain}` : "Install once per website",
        bg: "#0A1633",
        fg: "#FFFFFF",
        status: ctx.installed
          ? { text: "Live", color: GOOD }
          : { text: "Not installed", color: BAD },
        href: null,
      },
      {
        key: "gtm",
        mark: "GTM",
        name: "Google Tag Manager",
        desc: "Send conversion events from GTM",
        bg: "#E8EEFE",
        fg: "#1F3FB0",
        status: null,
        href: p.metrics("gtm"),
      },
      {
        key: "sheets",
        mark: "GS",
        name: "Google Sheets",
        desc: "Daily results export for reporting",
        bg: "#EAF7F1",
        fg: "#0B6B47",
        status: data.sheetsConnected ? { text: "Connected", color: GOOD } : null,
        href: p.integrations(),
      },
      {
        // The CDN panel is a labelled service seam with placeholder figures, so no status here.
        key: "cdn",
        mark: "CDN",
        name: "CDN delivery",
        desc: "Edge caching for scripts & variants",
        bg: "#FDF5E6",
        fg: "#8A5A06",
        status: null,
        href: p.integrations("cdn"),
      },
    ],
    exportRows: enriched.map(({ e, st, n }) => {
      const best = bestVariant(st);
      return {
        name: e.name,
        type: TYPE_LABEL[e.type],
        status: STATUS[e.displayStatus].label,
        visitors: st.v,
        conversions: st.c,
        conversionRate: st.v ? st.c / st.v : null,
        bestVariantRate: st.v && best ? best.cr : null,
        lift: st.v && best ? best.lift : null,
        needsAction: n ? `${n.na} — ${n.naSub}` : "",
      };
    }),
  };
}
