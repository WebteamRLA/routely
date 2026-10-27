"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  FirstProjectDialog,
  type FirstProjectForm,
} from "@/components/dashboard/first-project-dialog";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  PlusIcon,
  Svg,
} from "@/components/rt/icons";
import { ProjectAvatar } from "@/components/common/project-avatar";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { PixelDialog } from "@/components/project-dashboard/pixel-dialog";
import { ProjectSheetsDialog } from "@/components/project-dashboard/sheets-dialog";
import { Skeleton } from "@/components/rt/primitives";
import { ACCENT, ACCENT_INK, ACCENT_TINT, btn, card } from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import {
  experimentsCaption,
  formatCount,
  sparkPaths,
  type AccountOverview,
  type DashboardProject,
  type DashboardViewName,
} from "@/lib/dashboard";
import { type SetupProject, showsChecklist } from "@/lib/onboarding";
import { SHEETS_OUTCOME_PARAM, type ProjectSheetsCard } from "@/lib/sheets-card";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { createProjectAction } from "@/server/actions/website.actions";

/** The form each onboarding `?view=` opens with — mirrors the reference's `NP_VIEWS`. */
const FORM_FOR: Partial<Record<DashboardViewName, FirstProjectForm>> = {
  noProjectsCreate: { name: "", url: "", attempted: false, busy: false, failed: false },
  noProjectsErrors: { name: "", url: "fernwood", attempted: true, busy: false, failed: false },
};

const TRACK = {
  active: { label: "Active", bg: "#DCFCE7", border: "#BBF7D0", fg: "#166534", dot: "#16A34A" },
  stale: { label: "Not seen", bg: "#FEF3C7", border: "#FDE68A", fg: "#92400E", dot: "#F59E0B" },
  none: { label: "Not installed", bg: "#F3F4F6", border: "#D1D5DB", fg: "#4B5563", dot: "#9CA3AF" },
};

/** The project table's columns, shared by the header and every row so they cannot drift. */
const COLS =
  "grid grid-cols-[minmax(200px,1.6fr)_minmax(150px,1fr)_minmax(120px,0.9fr)_minmax(150px,1fr)_124px] gap-x-4 items-center";

/**
 * Below 960px each row becomes a card laid out in named areas, and the per-cell labels that are
 * screen-reader-only in the table become visible.
 */
const ROW = cn(
  COLS,
  "group relative min-h-[76px] px-5 py-4 transition-colors duration-[120ms] hover:bg-[#F9FAFB] focus-within:bg-[#F9FAFB]",
  "max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3 max-[961px]:p-4",
  "max-[961px]:[grid-template-areas:'name_name_act'_'exp_vis_track']",
  "max-[641px]:grid-cols-2 max-[641px]:[grid-template-areas:'name_name'_'exp_vis'_'track_track'_'act_act']",
);
const MLABEL =
  "sr-only text-xs leading-[1.45] text-[#6B7280] max-[961px]:not-sr-only max-[961px]:whitespace-normal";

const STAT_ICONS: Record<string, ReactNode> = {
  projects: (
    <Svg size={16} className="flex-none">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  ),
  exps: (
    <Svg size={16} className="flex-none">
      <path d="M9 3h6" />
      <path d="M10 3v6.2L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3" />
      <path d="M7.5 15h9" />
    </Svg>
  ),
  running: (
    <Svg size={16} className="flex-none">
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5.5 3.5-5.5 3.5z" />
    </Svg>
  ),
};

export type Load = "ready" | "loading" | "error";

export function DashboardView({
  view,
  data,
  load: loadProp,
  guideHidden = false,
  sdkUrl = "",
  sheetsCard = null,
}: {
  view: DashboardViewName;
  data: AccountOverview | null;
  load: Load;
  /** The reader hid "Getting started" on this browser. */
  guideHidden?: boolean;
  /** For the checklist's tracking dialog (`env.SDK_URL`). */
  sdkUrl?: string;
  /** For the checklist's Google Sheets dialog; null when there is no Sheets step to act on. */
  sheetsCard?: ProjectSheetsCard | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // "Try again" shows the loading state until the refreshed page arrives, as in the design.
  const load: Load = refreshing && loadProp === "error" ? "loading" : loadProp;
  const onboarding = load === "ready" && data !== null && data.projectCount === 0;
  const [form, setForm] = useState<FirstProjectForm | null>(
    onboarding ? (FORM_FOR[view] ?? null) : null,
  );
  const { toast, notify } = useToast(3200);
  const checklist =
    load === "ready" && data && showsChecklist(data.role, data.checklist, guideHidden)
      ? data.checklist
      : null;
  const openFirst = () =>
    setForm({ name: "", url: "", attempted: false, busy: false, failed: false });

  // The checklist's tracking and Google Sheets dialogs open here, over the Dashboard. Each refreshes
  // the page when its work lands (pixel found, spreadsheet attached), so the step ticks off behind it.
  // Kept mounted once opened and closed through `open`, like the Sheets dialog: unmounting the open
  // dialog here left its portal on screen (seen in a production build, 2026-10-27).
  const [pixel, setPixel] = useState<{ project: SetupProject; open: boolean } | null>(null);
  // Back from Google's consent screen (`?sheets=…`): straight into the dialog again.
  const [sheetsOpen, setSheetsOpen] = useState(sheetsCard?.outcome != null);

  // Say how Google went once, then drop the outcome from the URL so a reload doesn't repeat it.
  const outcome = sheetsCard?.outcome ?? null;
  const accountEmail = sheetsCard?.account?.email ?? null;
  const sheetsProjectName = sheetsCard?.projectName ?? "";
  useEffect(() => {
    if (!outcome) return;
    if (outcome.kind === "connected") {
      notify(
        "Google Sheets connected",
        `${accountEmail ?? "Your Google account"} is now connected to ${sheetsProjectName}.`,
      );
    }
    const url = new URL(window.location.href);
    for (const param of [SHEETS_OUTCOME_PARAM, "reason", "project"]) url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [outcome, accountEmail, sheetsProjectName, notify]);

  const retry = () => startRefresh(() => router.refresh());

  const submitFirst = async (f: FirstProjectForm) => {
    setForm({ ...f, attempted: true, busy: true, failed: false, serverErrors: undefined });
    const res = await createProjectAction({ name: f.name, url: f.url }).catch(() => null);
    if (res?.ok) {
      // The action revalidated this page, so the dashboard arrives with the new project.
      setForm(null);
      notify(
        "Project created",
        `${res.data.name} is ready. Install its tracking script to start testing.`,
      );
      return;
    }
    const fields = res?.fieldErrors ?? {};
    setForm({
      ...f,
      attempted: true,
      busy: false,
      failed: !fields.name && !fields.url,
      serverErrors: fields.name || fields.url ? { name: fields.name, url: fields.url } : undefined,
      failure:
        res && res.code !== "INTERNAL" && !fields.name && !fields.url ? res.message : undefined,
    });
  };

  return (
    <>
      <div aria-busy={load === "loading"} className="contents">
        <h1 className="sr-only">Dashboard</h1>
        <Stats data={data} load={load} />
        {checklist ? (
          <GettingStarted
            checklist={checklist}
            onAddProject={onboarding && data?.canManage ? openFirst : null}
            onPixel={(project) => setPixel({ project, open: true })}
            onSheets={sheetsCard ? () => setSheetsOpen(true) : null}
          />
        ) : null}
        {onboarding ? (
          // The checklist's first step already says "Add a project"; the empty state is only for
          // a reader without it (hidden on this browser, or a Viewer).
          checklist ? null : (
            <Onboarding onAdd={data.canManage ? openFirst : null} />
          )
        ) : (
          <ProjectsSection data={data} load={load} onRetry={retry} />
        )}
      </div>

      <FirstProjectDialog
        form={onboarding ? form : null}
        onChange={setForm}
        onClose={() => setForm(null)}
        onSubmit={(f) => void submitFirst(f)}
      />
      {pixel ? (
        <PixelDialog
          key={pixel.project.id}
          open={pixel.open}
          project={pixel.project}
          sdkUrl={sdkUrl}
          onVerified={() => router.refresh()}
          onCheckingChange={() => {}}
          onClose={() => setPixel({ ...pixel, open: false })}
        />
      ) : null}
      {sheetsCard ? (
        <ProjectSheetsDialog
          key={sheetsCard.websiteId}
          card={sheetsCard}
          open={sheetsOpen}
          onClose={() => setSheetsOpen(false)}
          notify={notify}
          fromDashboard
        />
      ) : null}
      <ToastHost toast={toast} />
    </>
  );
}

function Stats({ data, load }: { data: AccountOverview | null; load: Load }) {
  const ready = load === "ready" && data !== null;
  const n = data?.projectCount ?? 0;
  const running = data?.experiments.running ?? 0;
  const runProjects = data?.runningProjects ?? 0;

  const stats = [
    {
      key: "projects",
      label: "Projects",
      value: String(n),
      caption: n ? `Tracking active on ${data?.trackingActive ?? 0} of ${n}` : "None added yet",
      border: "#EEF0F3",
    },
    {
      key: "exps",
      label: "Experiments",
      value: formatCount(data?.experiments.total ?? 0),
      caption: data ? experimentsCaption(data.experiments) : "",
      border: "#EEF0F3",
    },
    {
      key: "running",
      label: "Running now",
      value: String(running),
      caption: running
        ? `Across ${runProjects} ${runProjects === 1 ? "project" : "projects"}`
        : "Nothing live right now",
      border: "#E3F1FF",
    },
  ];
  return (
    <section
      aria-label="Account overview"
      className="grid grid-cols-3 gap-4 max-[641px]:grid-cols-2 max-[641px]:gap-3"
    >
      {stats.map((st) => (
        <div
          key={st.key}
          className="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-white px-5 py-4 max-[641px]:px-4 max-[641px]:py-3.5 max-[641px]:last:col-span-full"
          style={{ borderColor: st.border }}
        >
          <span className="flex items-center gap-2 text-[13px] leading-5 font-medium text-[#6B7280]">
            {STAT_ICONS[st.key]}
            {st.label}
          </span>
          {load === "loading" ? (
            <>
              <Skeleton className="my-0.5 h-[26px] w-14 rounded-md" />
              <Skeleton className="my-1 h-2.5 w-[60%] rounded-[5px] bg-[#F3F4F6]" />
            </>
          ) : (
            <>
              <span className="text-[26px] leading-[30px] font-semibold tracking-[-0.02em] text-[#111827] tabular-nums">
                {ready ? st.value : "—"}
              </span>
              <span className="truncate text-[13px] leading-[18px] text-[#6B7280] max-[641px]:whitespace-normal">
                {ready ? st.caption : "Unavailable"}
              </span>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function ProjectsSection({
  data,
  load,
  onRetry,
}: {
  data: AccountOverview | null;
  load: Load;
  onRetry(): void;
}) {
  const ready = load === "ready" && data !== null;
  // Already the top five, most running experiments first, then most experiments overall.
  const rows = data?.projects ?? [];
  const total = data?.projectCount ?? 0;

  return (
    <section aria-labelledby="rt-proj-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2
            id="rt-proj-title"
            className="m-0 text-base leading-6 font-semibold tracking-[-0.01em] text-[#111827]"
          >
            Projects
          </h2>
          {ready ? (
            <span className="inline-flex h-[22px] items-center rounded-md bg-[#F3F4F6] px-2 text-xs font-semibold whitespace-nowrap text-[#4B5563] tabular-nums">
              {total}
            </span>
          ) : null}
        </div>
        <Link
          href={routes.projects.list}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-0.5 text-[13px] font-medium whitespace-nowrap text-[#4B5563] no-underline outline-none hover:text-[#111827] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
        >
          View all projects
          <ArrowRightIcon />
        </Link>
      </div>

      <div className={cn(card, "overflow-hidden")}>
        {ready ? (
          <>
            <div
              aria-hidden
              className={cn(
                COLS,
                "h-10 border-b border-[#EEF0F3] bg-[#F9FAFB] px-5 text-xs leading-4 font-medium text-[#6B7280] max-[961px]:hidden",
              )}
            >
              <span>Project</span>
              <span>Experiments</span>
              <span>Visitors · 30 days</span>
              <span>Tracking</span>
              <span />
            </div>
            <div role="list" aria-label="Projects">
              {rows.map((p, i) => (
                <ProjectRow key={p.id} project={p} first={i === 0} />
              ))}
            </div>
            {total > rows.length ? (
              <Link
                href={routes.projects.list}
                className="flex h-11 items-center justify-center gap-1.5 border-t border-[#EEF0F3] text-[13px] font-medium text-[#4B5563] no-underline hover:text-[#111827]"
              >
                View all {total} projects
              </Link>
            ) : null}
          </>
        ) : null}

        {load === "loading" ? (
          <div aria-hidden>
            {["38%", "30%", "34%"].map((w, i) => (
              <div
                key={w}
                className={cn(
                  "flex min-h-[76px] items-center gap-3 border-t px-5 py-4",
                  i > 0 ? "border-[#EEF0F3]" : "border-transparent",
                )}
              >
                <Skeleton className="size-10 flex-none rounded-lg" />
                <span className="flex flex-auto flex-col gap-2">
                  <Skeleton className="h-3 rounded-md" style={{ width: w }} />
                  <Skeleton className="h-2.5 w-[24%] rounded-[5px] bg-[#F3F4F6]" />
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {load === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3.5 px-6 py-14 text-center">
            <span
              aria-hidden
              className="inline-flex size-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]"
            >
              <AlertCircleIcon size={24} strokeWidth={1.8} />
            </span>
            <div className="flex max-w-[440px] flex-col gap-1">
              <h3 className="m-0 text-base leading-6 font-semibold text-[#111827]">
                We couldn’t load your dashboard
              </h3>
              <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                Something went wrong while fetching your projects and experiments. Check your
                connection and try again.
              </p>
            </div>
            <button type="button" onClick={onRetry} className={cn(btn.primary, "shadow-none")}>
              <Svg size={16}>
                <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
                <path d="M20 3.5v5h-5" />
              </Svg>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectRow({ project: p, first }: { project: DashboardProject; first: boolean }) {
  const run = p.running;
  const need = p.needAction;
  const base = { status: p.track, when: p.when ?? "" };
  const tm = TRACK[base.status];
  const v30 = p.visitors30;
  const spark = p.series ? sparkPaths(p.series) : null;
  const projectId = p.id;
  const total = p.experiments;

  return (
    <div
      role="listitem"
      className={cn(ROW, "border-t", first ? "border-transparent" : "border-[#EEF0F3]")}
    >
      <div className="flex min-w-0 items-center gap-3 max-[961px]:[grid-area:name]">
        <ProjectAvatar
          id={p.id}
          initial={p.initial}
          color={p.color}
          ink={p.ink}
          className="size-10 flex-none rounded-lg text-[15px] font-bold"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-5 font-semibold text-[#111827]">{p.name}</span>
          <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">{p.domain}</span>
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 max-[961px]:[grid-area:exp]">
        <span className={MLABEL}>Experiments</span>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: total ? "#111827" : "#4B5563" }}
        >
          {total ? `${total} ${total === 1 ? "experiment" : "experiments"}` : "No experiments"}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 text-[13px] leading-[18px] text-[#6B7280] tabular-nums">
          {total ? (
            <>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className="size-1.5 flex-none rounded-full"
                  style={{ background: run ? "#16A34A" : "#C2C8D0" }}
                />
                {run} running
              </span>
              {need ? (
                <span className="font-medium whitespace-nowrap text-[#B54708]">
                  {need} need action
                </span>
              ) : null}
            </>
          ) : (
            <span>
              {base.status === "none" ? "Install tracking to start" : "Create one to start testing"}
            </span>
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 max-[961px]:[grid-area:vis]">
        <span className={MLABEL}>Visitors · 30 days</span>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: v30 != null ? "#111827" : "#6B7280" }}
        >
          {v30 != null ? formatCount(v30) : "—"}
        </span>
        {spark ? (
          <svg
            width="96"
            height="18"
            viewBox="0 0 96 18"
            fill="none"
            role="img"
            aria-label={`Daily visitors for ${p.name} over the last 30 days`}
            className="block overflow-visible"
          >
            <path d={spark.area} fill={ACCENT} fillOpacity="0.10" />
            <path
              d={spark.line}
              stroke={ACCENT}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="text-[13px] leading-[18px] text-[#6B7280]">
            {base.status === "none"
              ? "No tracking yet"
              : total
                ? "Collecting data"
                : "No visitors yet"}
          </span>
        )}
      </div>

      <div className="relative flex min-w-0 flex-col items-start gap-0.5 max-[961px]:[grid-area:track]">
        <span className={MLABEL}>Tracking</span>
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap"
          style={{
            background: tm.bg,
            boxShadow: `inset 0 0 0 1px ${tm.border}`,
            color: tm.fg,
          }}
        >
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full"
            style={{ background: tm.dot }}
          />
          {tm.label}
        </span>
        <span className="text-[13px] leading-[18px] text-[#6B7280]">
          {base.status === "active"
            ? `Last event ${base.when}`
            : base.status === "stale"
              ? `Last seen ${base.when}`
              : "Snippet not installed"}
        </span>
      </div>

      <div className="flex justify-end max-[961px]:[grid-area:act]">
        <Link
          href={routes.projects.detail(projectId)}
          aria-label={`View project ${p.name}`}
          className={cn(
            "inline-flex h-[34px] items-center justify-center gap-1 rounded-lg border border-[#E5E7EB] bg-white py-0 pr-2.5 pl-3 text-[13px] font-medium whitespace-nowrap text-[#374151] no-underline transition-[border-color,color] duration-[120ms]",
            "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
            "group-hover:border-[#C4CAD3] group-hover:text-[#111827]",
            // The whole row is the link's hit area.
            "after:absolute after:inset-0 after:content-['']",
            "max-[641px]:h-11 max-[641px]:flex-auto",
          )}
        >
          View project
          <ChevronRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}

function Onboarding({ onAdd }: { onAdd: (() => void) | null }) {
  return (
    <section
      aria-labelledby="rt-empty-title"
      className={cn(
        card,
        // The viewport minus the stat cards above it (114px + the 24px gap), so it still fits.
        "flex min-h-[max(440px,calc(100vh-222px))] flex-auto items-center justify-center px-6 py-14",
        "max-[1200px]:min-h-[max(400px,calc(100vh-278px))]",
        "max-[641px]:min-h-0 max-[641px]:items-start max-[641px]:px-5 max-[641px]:py-10",
      )}
    >
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
        <span
          aria-hidden
          className="inline-flex size-16 items-center justify-center rounded-[18px]"
          style={{
            background: ACCENT_TINT,
            color: ACCENT_INK,
            boxShadow: `0 0 0 8px color-mix(in srgb, ${ACCENT_TINT} 45%, #FFFFFF)`,
          }}
        >
          <Svg size={28} strokeWidth={1.7}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
          </Svg>
        </span>
        <div className="flex flex-col gap-2">
          <h2
            id="rt-empty-title"
            className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]"
          >
            No projects yet
          </h2>
          <p className="m-0 text-sm leading-[22px] text-pretty text-[#4B5563]">
            Projects represent the websites you test in Routely. Add your first project to get a
            tracking code and start running experiments.
          </p>
        </div>
        {/* Only an Owner or Admin can add one; a Viewer or Editor sees the explanation alone. */}
        {onAdd ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onAdd}
            className={cn(btn.primary, "h-11 px-5 text-[15px] max-[641px]:h-12 max-[641px]:w-full")}
          >
            <PlusIcon />
            Add project
          </button>
        ) : null}
      </div>
    </section>
  );
}
