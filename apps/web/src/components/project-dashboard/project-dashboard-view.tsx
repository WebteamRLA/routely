"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ConversionsChart, VisitorsChart } from "@/components/project-dashboard/charts";
import { DeleteExperimentDialog } from "@/components/project-dashboard/delete-experiment-dialog";
import { LaunchDialog } from "@/components/project-dashboard/launch-dialog";
import { PixelDialog, type PixelStep } from "@/components/project-dashboard/pixel-dialog";
import {
  ConnectForm,
  MailIcon,
  ProjectSheetsDialog,
  type SheetsPanel,
} from "@/components/project-dashboard/sheets-dialog";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Spinner,
  TrashIcon,
  XIcon,
} from "@/components/rt/icons";
import {
  ACCENT,
  ACCENT_INK,
  ACCENT_LINE,
  ACCENT_TINT,
  btn,
  focusRing,
} from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import {
  dayPoints,
  fmt,
  newExperimentHref,
  type ExpStatus,
  type ExpType,
  type PdExperiment,
  type PdView,
  type ProjectHeader,
  type ProjectVisitors,
} from "@/lib/project-dashboard";
import { routes } from "@/lib/routes";
import {
  SHEETS_COPY,
  SHEETS_OUTCOME_PARAM,
  lastErrorCopy,
  sheetsStatus,
  type ProjectSheetsCard,
} from "@/lib/sheets-card";
import { cn } from "@/lib/utils";
import { launchExperimentAction } from "@/server/actions/experiment.actions";

type LoadState = "data" | "loading" | "error";
type Menu = "new" | "pixel" | "fType" | "fStatus" | null;
type TypeFilter = "all" | ExpType;
type StatusFilter = "all" | ExpStatus;

const LIMIT = 6;
const TILES: [string, string][] = [
  ["#CCFBF1", "#115E59"],
  ["#E6F4FF", "#0060AD"],
  ["#DCFCE7", "#166534"],
  ["#FCE7F3", "#9D174D"],
  ["#F3E8FF", "#6B21A8"],
  ["#FEF3C7", "#92400E"],
];
const STATUS: Record<ExpStatus, { label: string; dot: string }> = {
  running: { label: "Running", dot: "#0091FF" },
  paused: { label: "Paused", dot: "#F59E0B" },
  draft: { label: "Draft", dot: "#9CA3AF" },
  completed: { label: "Completed", dot: "#16A34A" },
};
const TYPE_OPTS: [TypeFilter, string][] = [
  ["all", "All types"],
  ["ab", "A/B test"],
  ["split", "Split URL test"],
];
const STATUS_OPTS: [StatusFilter, string][] = [
  ["all", "All statuses"],
  ["draft", "Draft"],
  ["running", "Running"],
  ["paused", "Paused"],
  ["completed", "Completed"],
];

const PXT = {
  stale: { label: "Pixel not detected", bg: "#FDF4E3", border: "#F2E3BF", fg: "#7D5E10" },
  none: { label: "Pixel not installed", bg: "#F3F4F6", border: "#D1D5DB", fg: "#4B5563" },
  active: { label: "Pixel active", bg: "#DCFCE7", border: "#BBF7D0", fg: "#166534" },
  checking: { label: "Checking pixel…", bg: "#F3F4F6", border: "#D1D5DB", fg: "#4B5563" },
};

/** One grid for header, rows and skeleton; below 960px each row re-flows into a card. */
const GRID =
  "grid grid-cols-[minmax(180px,2fr)_minmax(104px,1fr)_minmax(80px,0.8fr)_minmax(104px,1fr)_minmax(100px,1fr)_var(--pd-act,108px)] gap-x-4 items-center";
const ROW = cn(
  GRID,
  "min-h-[66px] border-t border-[#EEF0F3] px-5 py-3",
  "max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3.5 max-[961px]:p-4",
  "max-[961px]:[grid-template-areas:'name_name_name'_'need_need_need'_'vis_share_conv'_'act_act_act']",
);
const AREA = {
  name: "max-[961px]:[grid-area:name]",
  need: "max-[961px]:[grid-area:need]",
  vis: "max-[961px]:[grid-area:vis]",
  share: "max-[961px]:[grid-area:share]",
  conv: "max-[961px]:[grid-area:conv]",
  act: "max-[961px]:[grid-area:act] max-[961px]:justify-stretch",
};
const mlabel = "hidden text-xs leading-[1.45] text-[#6B7280] max-[961px]:block";
const skel = "block animate-[rt-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none";
const popClass =
  "absolute animate-[rt-in_.14s_ease-out] rounded-xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_#11182724]";
const menuRow = `flex w-full cursor-pointer items-center rounded-md border-0 bg-white text-left text-[13px] font-medium text-[#374151] hover:!bg-[#F3F4F6] ${focusRing}`;
const whiteBtn = `inline-flex cursor-pointer items-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-white text-[13px] font-medium text-[#374151] no-underline hover:!bg-[#F9FAFB] disabled:cursor-default disabled:opacity-45 ${focusRing}`;

/** The pixel dialog a `?view=` opens on. */
function initialPixel(view: PdView): { step: PixelStep } | null {
  if (view === "pixelSetup") return { step: 1 };
  if (view === "pixelVerify") return { step: 2 };
  return null;
}

/** The Sheets dialog panel a `?view=` opens on. */
function initialPanel(view: PdView): Partial<SheetsPanel> | null {
  if (view === "sheetsPanel") return {};
  if (view === "sheetsCreate") return { mode: "create" };
  return null;
}

/** "both versions" for two arms, "all 3 versions" beyond. */
function versionsPhrase(arms: number): string {
  return arms <= 2 ? "both versions" : `all ${arms} versions`;
}

/** A stable tile colour per experiment id (the design's `hash(id) % 6`). */
function tileFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length]!;
}

/** Everything below the header: loaded in one pass after the page shell streams. */
export interface ProjectDashboardData {
  experiments: PdExperiment[];
  /** Null when no visitor was recorded in the last 90 days (the chart's empty state). */
  visitors: ProjectVisitors | null;
  /** The visitors query failed: that chart alone shows its error. */
  visitorsFailed?: boolean;
  /** WP8's Google Sheets card; null when it could not be loaded. */
  sheets: ProjectSheetsCard | null;
}

export function ProjectDashboardView({
  header,
  data,
  load: loadProp,
  view,
}: {
  header: ProjectHeader;
  data: ProjectDashboardData | null;
  load: LoadState;
  view: PdView;
}) {
  const { project, permissions } = header;
  const pid = project.id;
  const router = useRouter();
  const { toast, notify } = useToast(3200);
  const [refreshing, startRefresh] = useTransition();
  const load: LoadState = refreshing && loadProp === "error" ? "loading" : loadProp;
  const [menu, setMenu] = useState<Menu>(null);
  const [deleting, setDeleting] = useState<PdExperiment | null>(null);
  // Admins delete any experiment, an Editor only a draft (`lib/permissions.ts`); the action
  // re-checks. The action column widens for the icon only when someone can use it.
  const canDelete = (e: PdExperiment) =>
    e.status === "draft" ? permissions.editExperiments : permissions.deleteExperiments;
  const deleteColumn = permissions.editExperiments || permissions.deleteExperiments;
  const [fType, setFType] = useState<TypeFilter>(
    view === "filtered" || view === "filterNone" ? "split" : "all",
  );
  const [fStatus, setFStatus] = useState<StatusFilter>(
    view === "filtered" ? "running" : view === "filterNone" ? "draft" : "all",
  );
  const [fNeeds, setFNeeds] = useState(false);
  const [fq, setFq] = useState("");
  const [more, setMore] = useState(false);

  const firstLaunchable =
    data?.experiments.find((e) => e.action === "Launch" && e.launch)?.id ?? null;
  const [launchId, setLaunchId] = useState<string | null>(
    view === "launchConfirm" ? firstLaunchable : null,
  );
  const [launchErr, setLaunchErr] = useState(false);
  const [launchErrMsg, setLaunchErrMsg] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const base = header.pixel;
  // A found snippet stamps pixelVerifiedAt on the server, which makes the project Active; this
  // shows that at once, before the refreshed header arrives.
  const [pxVerified, setPxVerified] = useState(false);
  const [pxChecking, setPxChecking] = useState(false);
  const [pixelModal, setPixelModal] = useState(() => initialPixel(view));
  const [pixelOpenId, setPixelOpenId] = useState(0);

  const sheets = data?.sheets ?? null;
  const panel0 = initialPanel(view);
  const [sheetsOpen, setSheetsOpen] = useState(panel0 !== null && sheets !== null);
  const [sheetsPanel, setSheetsPanel] = useState<Partial<SheetsPanel> | undefined>(
    panel0 ?? undefined,
  );
  const [gsWaiting, setGsWaiting] = useState(false);

  // Menus close on any press outside their own wrapper, and on Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-menu]");
      if (el?.getAttribute("data-menu") !== menu) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const toggle = (m: Exclude<Menu, null>) => setMenu((cur) => (cur === m ? null : m));

  // Back from Google's consent screen: say how it went once, then drop `?sheets=…` from the URL
  // so a reload does not repeat it.
  const outcome = sheets?.outcome ?? null;
  const accountEmail = sheets?.account?.email ?? null;
  useEffect(() => {
    if (!outcome) return;
    if (outcome.kind === "connected") {
      notify(
        "Google Sheets connected",
        `${accountEmail ?? "Your Google account"} is now connected to ${project.name}.`,
      );
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(SHEETS_OUTCOME_PARAM);
    url.searchParams.delete("reason");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [outcome, accountEmail, notify, project.name]);

  // Back-forward cache: a page restored after leaving for Google must not stay "Connecting…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setGsWaiting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const ready = load === "data" && data !== null;
  const isLoading = load === "loading";
  const exps: PdExperiment[] = ready ? data.experiments : [];
  const hasExps = exps.length > 0;
  const noExps = ready && !hasExps;

  // ---- Filters ----
  const q = fq.trim().toLowerCase();
  const passes = (e: PdExperiment, t: TypeFilter, st: StatusFilter, nd: boolean) =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (t === "all" || e.type === t) &&
    (st === "all" || e.status === st) &&
    (!nd || !!e.need);
  const matching = exps.filter((e) => passes(e, fType, fStatus, fNeeds));
  const shown = more ? matching : matching.slice(0, LIMIT);
  const anyFilter = ready && (fType !== "all" || fStatus !== "all" || fNeeds || !!q);
  const clearFilters = () => {
    setFType("all");
    setFStatus("all");
    setFNeeds(false);
    setFq("");
    setMore(false);
    setMenu(null);
  };
  const onlyNeeds = fNeeds && fType === "all" && fStatus === "all" && !q;
  const onlyQ = !!q && fType === "all" && fStatus === "all" && !fNeeds;
  const noMatch = onlyQ
    ? {
        isNeeds: false,
        title: `No experiments match “${fq.trim()}”`,
        body: "Search looks at experiment names. Check the spelling, or clear the search to see every experiment in this project.",
      }
    : onlyNeeds
      ? {
          isNeeds: true,
          title: "Nothing needs your attention",
          body: "Every experiment in this project is running smoothly or finished. Nothing is waiting in draft, paused, or missing traffic.",
        }
      : {
          isNeeds: false,
          title: "No experiments match these filters",
          body: "Try a different type or status, or clear the filters to see every experiment in this project.",
        };

  // ---- Pixel ----
  const pxStatus = pxVerified ? "active" : base.status;
  const pxWhen = pxVerified ? "just now" : base.when;
  const pt = PXT[pxChecking ? "checking" : pxStatus];
  const pxHint = pxChecking
    ? `Looking for the pixel on ${project.domain}…`
    : pxStatus === "active"
      ? `Receiving events · last event ${pxWhen}`
      : pxStatus === "stale"
        ? `No data from ${project.domain} since ${base.since}`
        : "Install the script to start recording visitors";
  const pxMenuText =
    pxStatus === "active"
      ? `Routely received an event from ${project.domain} ${pxWhen}. Tracking is working.`
      : pxStatus === "stale"
        ? `Routely hasn’t received data from ${project.domain} since ${base.since}. The script may have been removed, so experiments can’t record visitors.`
        : `Routely hasn’t received any data from ${project.domain} yet. Install the script to start running experiments.`;
  const pxAria =
    pt.label +
    (pxWhen && !pxChecking
      ? `, ${pxStatus === "active" ? "last event " : "last seen "}${pxWhen}`
      : "") +
    (pxStatus === "none" ? ". Set up tracking" : ". Show tracking details");
  const openPixel = (step: PixelStep) => {
    setMenu(null);
    setPixelModal({ step });
    setPixelOpenId((n) => n + 1);
  };

  // ---- Google Sheets ----
  const gsStatus = sheets
    ? sheetsStatus({
        configured: sheets.configured,
        account: sheets.account,
        failing: Boolean(sheets.destination?.lastError),
      })
    : null;
  const gsConnected = gsStatus === "connected" || gsStatus === "sync_stopped";
  const gsError = !gsConnected && outcome?.kind === "error";
  const canConnect =
    !!sheets &&
    sheets.permissions.manage &&
    (gsStatus === "none" || gsStatus === "needs_reconnect");
  const openSheets = () => {
    if (!sheets) return;
    setMenu(null);
    setSheetsPanel(undefined);
    setSheetsOpen(true);
  };

  // ---- Launch ----
  const launchExp = launchId ? (exps.find((x) => x.id === launchId) ?? null) : null;
  const pixelWarning =
    pxStatus === "active"
      ? null
      : pxStatus === "stale"
        ? `Routely hasn’t received data from ${project.domain} since ${base.since}. Visitors can’t be recorded until the pixel is back.`
        : `The Routely pixel isn’t installed on ${project.domain} yet, so this experiment can’t record visitors.`;
  const confirmLaunch = async () => {
    if (launching || !launchExp) return;
    const e = launchExp;
    setLaunching(true);
    setLaunchErr(false);
    setLaunchErrMsg(null);
    const res = await launchExperimentAction(e.id).catch(() => null);
    setLaunching(false);
    if (!res || !res.ok) {
      setLaunchErr(true);
      setLaunchErrMsg(res && res.code !== "INTERNAL" ? res.message : null);
      return;
    }
    setLaunchId(null);
    notify(
      `“${e.name}” is live`,
      `Visitors on ${e.launch?.page ?? project.domain} will start seeing ${versionsPhrase(e.variants)}. Results appear as visitors arrive.`,
    );
    // The action revalidated this page, so the row arrives as running with this response.
  };

  const retry = () => {
    setMore(false);
    startRefresh(() => router.refresh());
  };

  const seriesOwn = data?.visitors ? dayPoints(data.visitors.days) : null;
  const visitorsState: LoadState = data?.visitorsFailed && load === "data" ? "error" : load;

  return (
    <div aria-busy={isLoading} className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2.5">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-[#6B7280]"
        >
          <Link
            href={routes.projects.list}
            className={cn(
              "font-medium whitespace-nowrap text-[#4B5563] no-underline hover:text-[#111827]",
              focusRing,
            )}
          >
            Projects
          </Link>
          <ChevronRightIcon size={14} stroke="#9CA3AF" className="flex-[0_0_14px]" />
          <span aria-current="page" className="truncate font-medium text-[#111827]">
            {project.name}
          </span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="inline-flex size-11 flex-[0_0_44px] items-center justify-center rounded-xl text-base font-bold max-[641px]:size-10 max-[641px]:basis-10"
              style={{ background: project.color, color: project.ink }}
            >
              {project.initial}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#111827] max-[641px]:text-[22px]">
                {project.name}
              </h1>
              <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm leading-5 text-[#4B5563] max-[641px]:flex-col max-[641px]:items-start">
                <span className="[overflow-wrap:anywhere]">{project.domain}</span>
                <span
                  aria-hidden
                  className="size-[3px] flex-[0_0_3px] rounded-full bg-[#9CA3AF] max-[641px]:hidden"
                />
                <span>
                  Created {project.created} by {project.by}
                </span>
              </p>
            </div>
          </div>
          {/* Viewers can't create experiments, so they get no button to start one. */}
          {permissions.editExperiments ? (
            <div data-menu="new" className="relative z-[45] max-[641px]:w-full">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu === "new"}
                onClick={() => toggle("new")}
                className={cn(btn.primary, "gap-2 pr-3 pl-3.5 max-[641px]:w-full")}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                <span>New experiment</span>
                <span aria-hidden className="mx-0.5 h-[18px] w-px bg-[rgba(255,255,255,0.35)]" />
                <ChevronDownIcon />
              </button>
              {menu === "new" ? (
                <div
                  role="menu"
                  aria-label="Choose experiment type"
                  className={cn(
                    popClass,
                    "top-[calc(100%+8px)] right-0 flex w-[340px] flex-col gap-0.5 p-1.5 max-[641px]:left-0 max-[641px]:w-auto",
                  )}
                >
                  <p className="m-0 px-2.5 pt-2 pb-1.5 text-xs leading-[1.45] font-medium text-[#6B7280]">
                    Choose an experiment type
                  </p>
                  <TypeLink
                    href={newExperimentHref("ab", pid)}
                    role="menuitem"
                    icon={<AbIcon />}
                    title="A/B Testing"
                    body="Test variations of elements on the same page URL."
                    menu
                  />
                  <TypeLink
                    href={newExperimentHref("split", pid)}
                    role="menuitem"
                    icon={<SplitIcon />}
                    title="Split URL Testing"
                    body="Split traffic between different page URLs and compare them."
                    menu
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 items-stretch gap-4 max-[901px]:grid-cols-[minmax(0,1fr)]">
        <section
          aria-labelledby="rt-px-title"
          className="relative z-[46] flex min-w-0 flex-col gap-2.5 rounded-xl border border-[#EEF0F3] bg-white px-[18px] py-4"
        >
          <div className="flex min-h-6 items-center">
            <h2 id="rt-px-title" className="m-0 text-sm leading-5 font-semibold text-[#374151]">
              Tracking pixel
            </h2>
          </div>
          <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative z-[46] flex flex-wrap items-center gap-x-7 gap-y-3 max-[641px]:w-full">
              <div data-menu="pixel" className="relative max-[641px]:flex-[1_1_100%]">
                <button
                  type="button"
                  aria-haspopup={pxStatus === "none" ? "dialog" : "menu"}
                  aria-expanded={menu === "pixel"}
                  aria-label={pxAria}
                  onClick={() => (pxStatus === "none" ? openPixel(1) : toggle("pixel"))}
                  className={cn(
                    "inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border px-2.5 text-[13px] whitespace-nowrap transition-shadow duration-150 hover:brightness-[.98]",
                    focusRing,
                  )}
                  style={{
                    borderColor: pt.border,
                    background: pt.bg,
                    color: pt.fg,
                    boxShadow: menu === "pixel" ? "0 0 0 3px rgba(146,64,14,0.18)" : "none",
                  }}
                >
                  {pxChecking ? (
                    <Spinner className="flex-[0_0_15px]" />
                  ) : pxStatus === "active" ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                      className="flex-[0_0_16px]"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="m8.5 12 2.5 2.5 4.5-5" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                      className="flex-[0_0_16px]"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7.5v5" />
                      <path d="M12 16.2v.3" />
                    </svg>
                  )}
                  <span className="font-semibold">{pt.label}</span>
                  <ChevronDownIcon
                    size={14}
                    strokeWidth={2.2}
                    className="flex-[0_0_14px] transition-transform duration-150"
                    style={{ transform: menu === "pixel" ? "rotate(180deg)" : "none" }}
                  />
                </button>
                {menu === "pixel" ? (
                  <div
                    role="menu"
                    aria-label="Tracking details"
                    className={cn(
                      popClass,
                      "top-[calc(100%+8px)] left-0 w-[300px] pb-1.5 max-[641px]:w-[min(300px,calc(100vw-32px))]",
                    )}
                  >
                    <p className="m-0 border-b border-[#F3F4F6] px-3.5 py-3 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
                      {pxMenuText}
                    </p>
                    <div className="flex flex-col gap-0.5 px-1.5 pt-1.5">
                      <PixelMenuItem onClick={() => openPixel(1)} label="Show tracking code">
                        <path d="m8 8-4 4 4 4" />
                        <path d="m16 8 4 4-4 4" />
                      </PixelMenuItem>
                      <PixelMenuItem
                        onClick={() => openPixel(2)}
                        label={pxStatus === "active" ? "Verify again" : "Verify installation"}
                      >
                        <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3z" />
                        <path d="m9 12 2 2 4-4" />
                      </PixelMenuItem>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <span className="text-[13px] leading-[19px] text-pretty text-[#6B7280]">{pxHint}</span>
          </div>
        </section>

        <section
          aria-labelledby="rt-int-title"
          className="relative flex min-w-0 flex-col gap-2.5 rounded-xl border border-[#EEF0F3] bg-white px-[18px] py-4 transition-colors duration-[120ms] hover:border-[#D1D5DB] hover:bg-[#FAFBFC]"
        >
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Set up Google Sheets for ${project.name}`}
            onClick={openSheets}
            className={cn(
              "absolute inset-0 z-0 cursor-pointer rounded-xl border-0 bg-transparent p-0",
              focusRing,
            )}
          />
          <div className="flex items-center justify-between gap-3">
            <h2 id="rt-int-title" className="m-0 text-sm leading-5 font-semibold text-[#374151]">
              Integrations
            </h2>
            <Link
              href={routes.integrations}
              aria-label="View all integrations"
              className={cn(
                "relative z-[1] inline-flex h-6 items-center gap-1.5 px-0.5 text-[13px] font-medium whitespace-nowrap text-[#4B5563] no-underline hover:text-[#111827]",
                focusRing,
              )}
            >
              View all
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </Link>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="inline-flex size-10 flex-[0_0_40px] items-center justify-center rounded-lg bg-[#DCFCE7] text-[#166534]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M4 9h16" />
                <path d="M4 15h16" />
                <path d="M10 9v12" />
              </svg>
            </span>
            <div aria-live="polite" className="flex min-w-0 flex-auto flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm leading-5 font-semibold text-[#111827]">
                  Google Sheets
                </span>
                {gsConnected ? (
                  <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md bg-[#DCFCE7] px-2 text-xs font-semibold whitespace-nowrap text-[#166534]">
                    <span aria-hidden className="size-1.5 rounded-full bg-[#16A34A]" />
                    Connected
                  </span>
                ) : null}
              </div>
              {gsConnected && gsStatus === "connected" ? (
                <span
                  title={accountEmail ?? undefined}
                  className="truncate text-[13px] leading-[18px] text-[#374151]"
                >
                  {accountEmail ?? "Google account connected"}
                </span>
              ) : (
                <span
                  className="text-[13px] leading-[18px] text-pretty"
                  style={{
                    color:
                      gsError || gsStatus === "needs_reconnect" || gsStatus === "sync_stopped"
                        ? "#B91C1C"
                        : "#6B7280",
                  }}
                >
                  {!sheets
                    ? isLoading
                      ? "Loading…"
                      : "Google Sheets status unavailable"
                    : gsStatus === "sync_stopped"
                      ? lastErrorCopy(sheets.destination?.lastError ?? "")
                      : gsWaiting
                        ? "Connecting…"
                        : gsStatus === "not_configured"
                          ? SHEETS_COPY.notConfigured
                          : gsStatus === "needs_reconnect"
                            ? SHEETS_COPY.needsReconnect
                            : gsError && outcome?.kind === "error"
                              ? outcome.message
                              : "No email connected"}
                </span>
              )}
            </div>
            {canConnect && sheets ? (
              <ConnectForm
                websiteId={sheets.websiteId}
                disabled={gsWaiting}
                busy={gsWaiting}
                onSubmit={() => setGsWaiting(true)}
                className={cn(
                  whiteBtn,
                  "relative z-[1] h-[34px] min-w-[132px] flex-none justify-center gap-1.5 px-3 max-[641px]:h-10",
                )}
              >
                {gsWaiting ? (
                  <Spinner />
                ) : (
                  <>
                    <MailIcon />
                    Connect email
                  </>
                )}
              </ConnectForm>
            ) : null}
          </div>
        </section>
      </div>

      <section aria-labelledby="rt-exp-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2
              id="rt-exp-title"
              className="m-0 text-base leading-6 font-semibold tracking-[-0.01em] text-[#111827]"
            >
              Experiments
            </h2>
            {hasExps && matching.length > 0 ? (
              <span className="inline-flex h-[22px] items-center rounded-md bg-[#F3F4F6] px-2 text-xs font-semibold whitespace-nowrap text-[#4B5563] tabular-nums">
                {shown.length < matching.length
                  ? `${shown.length} of ${matching.length}`
                  : String(matching.length)}
              </span>
            ) : null}
          </div>
        </div>

        {isLoading || hasExps ? (
          <div
            role="group"
            aria-label="Search and filter experiments"
            className="flex flex-wrap items-center gap-2"
          >
            <div
              role="search"
              className="relative min-w-[200px] flex-[0_1_300px] max-[641px]:min-w-0 max-[641px]:flex-[1_1_100%]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6B7280"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                type="search"
                value={fq}
                onChange={(e) => {
                  setFq(e.target.value);
                  setMore(false);
                  setMenu(null);
                }}
                disabled={!ready}
                placeholder="Search experiments"
                aria-label="Search experiments by name"
                className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-9 text-sm text-[#111827] outline-none placeholder:text-[#6B7280] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] disabled:opacity-45 max-[641px]:h-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {fq ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setFq("");
                    setMore(false);
                  }}
                  className={cn(
                    btn.icon,
                    "absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-md",
                  )}
                >
                  <XIcon size={14} strokeWidth={2.2} />
                </button>
              ) : null}
            </div>
            <FilterDropdown
              menuKey="fType"
              noun="type"
              open={menu === "fType"}
              onToggle={() => toggle("fType")}
              disabled={!ready}
              options={TYPE_OPTS}
              current={fType}
              count={(t) => exps.filter((e) => passes(e, t, fStatus, fNeeds)).length}
              onPick={(v) => {
                setFType(v);
                setMenu(null);
                setMore(false);
              }}
            />
            <FilterDropdown
              menuKey="fStatus"
              noun="status"
              open={menu === "fStatus"}
              onToggle={() => toggle("fStatus")}
              disabled={!ready}
              options={STATUS_OPTS}
              current={fStatus}
              count={(st) => exps.filter((e) => passes(e, fType, st, fNeeds)).length}
              onPick={(v) => {
                setFStatus(v);
                setMenu(null);
                setMore(false);
              }}
              dots
              alignRightOnPhone
            />
            {anyFilter ? (
              <button
                type="button"
                onClick={clearFilters}
                className={cn(
                  "h-9 cursor-pointer border-0 bg-transparent px-1.5 text-[13px] font-medium whitespace-nowrap text-[#4B5563] hover:text-[#111827]",
                  focusRing,
                )}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-[#EEF0F3] bg-white">
          {isLoading || (hasExps && shown.length > 0) ? (
            <div className="overflow-x-auto">
              <div
                role="table"
                aria-label="Experiments"
                className="min-w-[790px] max-[961px]:min-w-0"
                style={deleteColumn ? ({ "--pd-act": "152px" } as React.CSSProperties) : undefined}
              >
                <div role="rowgroup" className="max-[961px]:hidden">
                  <div
                    role="row"
                    className={cn(
                      GRID,
                      "h-[38px] bg-[#FAFBFC] px-5 text-xs font-medium text-[#6B7280]",
                    )}
                  >
                    <span role="columnheader">Experiment</span>
                    <span role="columnheader">Needs action</span>
                    <span role="columnheader">Visitors</span>
                    <span role="columnheader">Traffic share</span>
                    <span role="columnheader">Conversion rate</span>
                    <span role="columnheader" className="relative">
                      <span className="sr-only">Action</span>
                    </span>
                  </div>
                </div>
                <div role="rowgroup">
                  {!isLoading
                    ? shown.map((e) => (
                        <ExperimentRow
                          key={e.id}
                          e={e}
                          onLaunch={() => {
                            setLaunchId(e.id);
                            setLaunchErr(false);
                            setLaunchErrMsg(null);
                            setLaunching(false);
                            setMenu(null);
                          }}
                          onDelete={canDelete(e) ? () => setDeleting(e) : undefined}
                        />
                      ))
                    : null}
                  {isLoading ? <SkeletonRows /> : null}
                </div>
              </div>
            </div>
          ) : null}

          {!isLoading && hasExps && matching.length > LIMIT ? (
            <div className="flex justify-center border-t border-[#EEF0F3] px-4 py-2">
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore((m) => !m)}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-white px-3 text-[13px] font-medium whitespace-nowrap text-[#374151] hover:!bg-[#F9FAFB]",
                  focusRing,
                )}
              >
                {more ? "Show fewer" : `Show all ${matching.length} experiments`}
                <ChevronDownIcon
                  className="transition-transform duration-150"
                  style={{ transform: more ? "rotate(180deg)" : "none" }}
                />
              </button>
            </div>
          ) : null}

          {hasExps && shown.length === 0 ? (
            <div className="flex flex-col items-center gap-3.5 px-6 pt-14 pb-[60px] text-center">
              <span
                aria-hidden
                className="inline-flex size-11 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563]"
              >
                {noMatch.isNeeds ? (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8 12.5 2.5 2.5L16 9.5" />
                  </svg>
                ) : (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4-4" />
                  </svg>
                )}
              </span>
              <div className="flex max-w-[420px] flex-col gap-1">
                <h3 className="m-0 text-base leading-[23px] font-semibold text-[#111827]">
                  {noMatch.title}
                </h3>
                <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                  {noMatch.body}
                </p>
              </div>
              <button type="button" onClick={clearFilters} className={cn(whiteBtn, "h-9 px-3.5")}>
                Clear filters
              </button>
            </div>
          ) : null}

          {noExps ? (
            <div className="flex flex-col items-center gap-5 px-6 py-14 text-center">
              <span
                aria-hidden
                className="inline-flex size-12 items-center justify-center rounded-full"
                style={{ background: ACCENT_TINT, color: ACCENT_INK }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 3h6" />
                  <path d="M10 3v6.2L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3" />
                  <path d="M7.5 15h9" />
                </svg>
              </span>
              <div className="flex max-w-[460px] flex-col gap-1.5">
                <h3 className="m-0 text-base leading-6 font-semibold text-[#111827]">
                  Create your first experiment
                </h3>
                <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                  This project has no experiments yet. Pick an experiment type to get started — you
                  can save it as a draft and launch it when you’re ready.
                </p>
              </div>
              <div className="grid w-full max-w-[600px] grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
                <TypeLink
                  href={newExperimentHref("ab", pid)}
                  icon={<AbIcon />}
                  title="A/B Testing"
                  body="Test variations of headlines, buttons or images on the same page."
                />
                <TypeLink
                  href={newExperimentHref("split", pid)}
                  icon={<SplitIcon />}
                  title="Split URL Testing"
                  body="Send visitors to different page URLs and compare which converts better."
                />
              </div>
            </div>
          ) : null}

          {load === "error" ? (
            <div role="alert" className="flex flex-col items-center gap-3.5 px-6 py-14 text-center">
              <span
                aria-hidden
                className="inline-flex size-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5" />
                  <path d="M12 16.2v.3" />
                </svg>
              </span>
              <div className="flex max-w-[440px] flex-col gap-1">
                <h3 className="m-0 text-base leading-6 font-semibold text-[#111827]">
                  We couldn’t load this project
                </h3>
                <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                  Something went wrong while fetching your experiment data. Check your connection
                  and try again.
                </p>
              </div>
              <button type="button" onClick={retry} className={cn(btn.primary, "shadow-none")}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
                  <path d="M20 3.5v5h-5" />
                </svg>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5">
        <ConversionsChart state={load} experiments={exps} noExps={noExps} />
        <VisitorsChart
          state={visitorsState}
          series={seriesOwn}
          totals={data?.visitors?.totals ?? null}
          domain={project.domain}
          onSetUpPixel={() => openPixel(pxStatus === "none" ? 1 : 2)}
        />
      </div>

      {pixelModal ? (
        <PixelDialog
          key={pixelOpenId}
          open
          project={{
            id: pid,
            domain: project.domain,
            key: project.key,
            protocol: project.protocol,
          }}
          initialStep={pixelModal.step}
          sdkUrl={header.sdkUrl}
          onVerified={() => setPxVerified(true)}
          onCheckingChange={setPxChecking}
          onClose={() => {
            setPixelModal(null);
            setPxChecking(false);
          }}
        />
      ) : null}

      {sheets ? (
        <ProjectSheetsDialog
          card={sheets}
          open={sheetsOpen}
          onClose={() => setSheetsOpen(false)}
          notify={notify}
          initialPanel={sheetsPanel}
        />
      ) : null}

      <LaunchDialog
        experiment={launchExp}
        busy={launching}
        error={launchErr}
        errorMessage={launchErrMsg}
        pixelWarning={pixelWarning}
        onCancel={() => {
          if (launching) return;
          setLaunchId(null);
          setLaunchErr(false);
          setLaunchErrMsg(null);
        }}
        onConfirm={() => void confirmLaunch()}
      />

      <DeleteExperimentDialog
        experiment={deleting}
        onClose={() => setDeleting(null)}
        notify={notify}
      />

      <ToastHost toast={toast} />
    </div>
  );
}

function ExperimentRow({
  e,
  onLaunch,
  onDelete,
}: {
  e: PdExperiment;
  onLaunch(): void;
  /** Present only when the viewer may delete this experiment. */
  onDelete?: () => void;
}) {
  const st = STATUS[e.status];
  const typeLabel = e.type === "ab" ? "A/B Testing" : "Split URL";
  const when = e.justLaunched
    ? " · launched just now"
    : e.status === "running" || e.status === "paused"
      ? ` · day ${e.day}`
      : e.status === "completed"
        ? ` · ended ${e.ended}`
        : "";
  const href = e.href;
  const [tile, tileInk] = tileFor(e.id);
  const noteFg = /^\+/.test(e.note) ? "#166534" : /^−/.test(e.note) ? "#B91C1C" : "#6B7280";
  const launch = e.action === "Launch";
  const actClass = cn(
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border px-3.5 text-[13px] font-medium no-underline",
    focusRing,
    launch
      ? "cursor-pointer border-[#0070C9] bg-[#0070C9] text-white hover:brightness-[.8]"
      : "cursor-pointer border-[#E5E7EB] bg-white text-[#374151] hover:!bg-[#F9FAFB]",
  );
  const aria = `${e.action}: ${e.name}`;

  return (
    <div role="row" className={cn(ROW, "hover:bg-[#FAFBFC]")}>
      <div role="cell" className={cn("flex min-w-0 items-center gap-3", AREA.name)}>
        <span
          aria-hidden
          className="inline-flex size-8 flex-[0_0_32px] items-center justify-center rounded-lg text-[13px] font-bold"
          style={{ background: tile, color: tileInk }}
        >
          {e.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-5 font-semibold text-[#111827]">{e.name}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-[#6B7280]">
            <span
              aria-hidden
              className="size-1.5 flex-[0_0_6px] rounded-full"
              style={{ background: st.dot }}
            />
            <span className="truncate">
              {st.label}
              {when} · {typeLabel}
            </span>
          </span>
        </span>
      </div>
      <div
        role="cell"
        className={cn(
          "min-w-0 text-sm leading-5",
          AREA.need,
          e.need ? "font-semibold text-[#111827]" : "font-normal text-[#6B7280] max-[961px]:hidden",
        )}
      >
        {/* Inherits the cell’s 20px line height, as in the design. */}
        <span className={cn(mlabel, "mb-0.5 leading-5 font-normal")}>Needs action</span>
        {e.need ?? "—"}
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", AREA.vis)}>
        <span className={mlabel}>Visitors</span>
        <span className="text-sm leading-5 font-semibold text-[#111827] tabular-nums">
          {fmt(e.visitors)}
        </span>
        <span className="text-[13px] leading-[18px] text-[#6B7280]">
          {e.variants} {e.variants === 1 ? "variant" : "variants"}
        </span>
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-[7px]", AREA.share)}>
        <span className={mlabel}>Traffic share</span>
        <span className="text-sm leading-5 font-semibold text-[#111827] tabular-nums">
          {e.share}%
        </span>
        <span
          aria-hidden
          className="block h-1 w-full max-w-[168px] overflow-hidden rounded-full bg-[#F3F4F6]"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${e.share}%`, background: ACCENT }}
          />
        </span>
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", AREA.conv)}>
        <span className={mlabel}>Conv. rate</span>
        <span className="text-sm leading-5 font-semibold text-[#111827] tabular-nums">
          {e.rate == null ? "—" : `${e.rate.toFixed(1)}%`}
        </span>
        <span className="truncate text-[13px] leading-[18px]" style={{ color: noteFg }}>
          {e.note}
        </span>
      </div>
      <div role="cell" className={cn("flex items-center justify-end gap-1.5", AREA.act)}>
        {!launch && href ? (
          <Link href={href} aria-label={aria} className={cn(actClass, "max-[961px]:flex-1")}>
            {e.action}
          </Link>
        ) : (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={aria}
            onClick={onLaunch}
            className={cn(actClass, "max-[961px]:h-11 max-[961px]:flex-1")}
          >
            {e.action}
          </button>
        )}
        {onDelete ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Delete experiment: ${e.name}`}
            title="Delete experiment"
            onClick={onDelete}
            className={cn(btn.icon, "size-9 hover:text-[#B91C1C] max-[961px]:size-11")}
          >
            <TrashIcon size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonRows() {
  const rows = [
    ["62%", "40%"],
    ["48%", "56%"],
    ["70%", "34%"],
    ["54%", "44%"],
    ["66%", "38%"],
    ["44%", "50%"],
  ];
  return rows.map(([w1, w2], i) => (
    <div key={i} role="row" className={ROW}>
      <div role="cell" className={cn("flex items-center gap-3", AREA.name)}>
        <span className={cn(skel, "size-8 flex-[0_0_32px] rounded-lg bg-[#EEF0F3]")} />
        <span className="flex flex-auto flex-col gap-2">
          <span className={cn(skel, "h-3 rounded-md bg-[#EEF0F3]")} style={{ width: w1 }} />
          <span className={cn(skel, "h-2.5 rounded-[5px] bg-[#F3F4F6]")} style={{ width: w2 }} />
        </span>
      </div>
      <div role="cell" className={AREA.need}>
        <span className={cn(skel, "h-3 w-[84px] rounded-md bg-[#EEF0F3]")} />
      </div>
      <div role="cell" className={cn("flex flex-col gap-2", AREA.vis)}>
        <span className={cn(skel, "h-3 w-12 rounded-md bg-[#EEF0F3]")} />
        <span className={cn(skel, "h-2.5 w-16 rounded-[5px] bg-[#F3F4F6]")} />
      </div>
      <div role="cell" className={cn("flex flex-col gap-2.5", AREA.share)}>
        <span className={cn(skel, "h-3 w-9 rounded-md bg-[#EEF0F3]")} />
        <span className={cn(skel, "h-1 w-full max-w-[168px] rounded-full bg-[#F3F4F6]")} />
      </div>
      <div role="cell" className={cn("flex flex-col gap-2", AREA.conv)}>
        <span className={cn(skel, "h-3 w-10 rounded-md bg-[#EEF0F3]")} />
        <span className={cn(skel, "h-2.5 w-[76px] rounded-[5px] bg-[#F3F4F6]")} />
      </div>
      <div role="cell" className={cn("flex justify-end", AREA.act)}>
        <span
          className={cn(
            skel,
            "h-9 w-[84px] rounded-lg bg-[#F3F4F6] max-[961px]:h-11 max-[961px]:w-full",
          )}
        />
      </div>
    </div>
  ));
}

function FilterDropdown<T extends string>({
  menuKey,
  noun,
  open,
  onToggle,
  disabled,
  options,
  current,
  count,
  onPick,
  dots = false,
  alignRightOnPhone = false,
}: {
  menuKey: string;
  noun: string;
  open: boolean;
  onToggle(): void;
  disabled: boolean;
  options: [T, string][];
  current: T;
  count(v: T): number;
  onPick(v: T): void;
  dots?: boolean;
  alignRightOnPhone?: boolean;
}) {
  const on = current !== "all";
  const label = options.find((o) => o[0] === current)![1];
  return (
    <div
      data-menu={menuKey}
      className="relative z-[31] max-[641px]:min-w-0 max-[641px]:flex-[1_1_calc(50%-4px)]"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filter by ${noun}: ${label}`}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "inline-flex h-9 cursor-pointer items-center justify-between gap-2 rounded-lg border pr-2.5 pl-3 text-[13px] whitespace-nowrap hover:!bg-[#F9FAFB] disabled:cursor-default disabled:opacity-45 max-[641px]:h-11 max-[641px]:w-full",
          focusRing,
        )}
        style={{
          borderColor: on ? ACCENT_LINE : "#E5E7EB",
          background: on ? ACCENT_TINT : "#FFFFFF",
          color: on ? ACCENT_INK : "#374151",
          fontWeight: on ? 600 : 500,
        }}
      >
        <span>{label}</span>
        <ChevronDownIcon
          className="flex-[0_0_16px] transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`Filter by ${noun}`}
          className={cn(
            popClass,
            "top-[calc(100%+6px)] left-0 z-[41] w-[232px] p-1.5 max-[641px]:w-[min(240px,calc(100vw-32px))]",
            alignRightOnPhone && "max-[641px]:right-0 max-[641px]:left-auto",
          )}
        >
          {options.map(([v, text]) => {
            const sel = v === current;
            return (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={sel}
                onClick={() => onPick(v)}
                className={cn(menuRow, "h-9 gap-2.5 pr-2 pl-2.5")}
              >
                {dots && v !== "all" ? (
                  <span
                    aria-hidden
                    className="size-2 flex-[0_0_8px] rounded-full"
                    style={{ background: STATUS[v as ExpStatus].dot }}
                  />
                ) : null}
                <span className="min-w-0 flex-auto truncate">{text}</span>
                <span className="text-[13px] text-[#6B7280] tabular-nums">{count(v)}</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="flex-[0_0_16px]"
                  style={{ visibility: sel ? "visible" : "hidden", color: ACCENT }}
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PixelMenuItem({
  onClick,
  label,
  children,
}: {
  onClick(): void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(menuRow, "h-[34px] gap-3 px-2")}
    >
      <span
        aria-hidden
        className="inline-flex size-7 flex-[0_0_28px] items-center justify-center rounded-md bg-[#F3F4F6] text-[#374151]"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {children}
        </svg>
      </span>
      {label}
    </button>
  );
}

function AbIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12h6" />
      <path d="M9 12l4-6h7" />
      <path d="M9 12l4 6h7" />
      <path d="m17 3 3 3-3 3" />
      <path d="m17 15 3 3-3 3" />
    </svg>
  );
}

/** An experiment-type choice: a menu item in the split button, a card in the empty state. */
function TypeLink({
  href,
  icon,
  title,
  body,
  role,
  menu = false,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
  role?: "menuitem";
  menu?: boolean;
}) {
  return (
    <Link
      href={href}
      role={role}
      className={cn(
        "flex w-full items-start gap-3 bg-white text-left text-[#111827] no-underline",
        focusRing,
        menu
          ? "rounded-md p-2.5 hover:!bg-[#F3F4F6]"
          : "rounded-xl border border-[#E5E7EB] p-4 hover:!bg-[#F9FAFB]",
      )}
    >
      <span
        aria-hidden
        className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg"
        style={{ background: ACCENT_TINT, color: ACCENT_INK }}
      >
        {icon}
      </span>
      <span className={cn("flex min-w-0 flex-col", menu ? "gap-0.5" : "gap-[3px]")}>
        <span className="text-sm leading-[1.45] font-semibold">{title}</span>
        <span
          className={cn("text-[13px] text-[#4B5563]", menu ? "leading-[18px]" : "leading-[19px]")}
        >
          {body}
        </span>
      </span>
    </Link>
  );
}
