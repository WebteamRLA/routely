"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DeleteProjectDialog } from "@/components/projects/delete-project-dialog";
import { PixelSetupDialog } from "@/components/projects/pixel-setup-dialog";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ToastHost } from "@/components/rt/toast";
import { type ProjectsViewName, formatCount, trackMeta, type Project } from "@/lib/projects";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type LoadState = "ready" | "loading" | "error";

/** What the server hands the screen (`project.service.listProjectsWithStats`). */
export interface ProjectsData {
  workspaceName: string;
  canManage: boolean;
  projects: Project[];
  /** The SDK URL the install snippet loads. */
  sdkUrl: string;
}

/** Dialogs hold the project itself, so one opened for a just-created row needs no lookup. */
type Modal =
  | { kind: "create" }
  | { kind: "edit"; project: Project }
  | { kind: "delete"; project: Project }
  | { kind: "pixel"; project: Project };

interface Toast {
  title: string;
  note: string;
}

/**
 * One grid definition for the header, the rows and the skeleton, so the columns cannot drift
 * apart. Below 960px the table becomes a stack of cards: the column header hides and each row
 * re-flows into named areas — and below 640px the tracking badge gets a line of its own, since
 * three columns no longer fit beside the name.
 */
const GRID =
  "grid grid-cols-[minmax(220px,2.2fr)_minmax(150px,1.2fr)_minmax(110px,0.9fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_168px] gap-x-3 items-center";
const ROW_GRID = cn(
  GRID,
  "min-h-[74px] border-t border-[#EEF0F3] px-4 py-3",
  "max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3.5 max-[961px]:p-4",
  "max-[961px]:[grid-template-areas:'name_name_track'_'exp_vis_created'_'act_act_act']",
  "max-[641px]:[grid-template-areas:'name_name_name'_'track_track_track'_'exp_vis_created'_'act_act_act']",
);
const AREA = {
  name: "max-[961px]:[grid-area:name]",
  track:
    "max-[961px]:[grid-area:track] max-[961px]:items-end max-[961px]:text-right max-[641px]:items-start max-[641px]:text-left",
  exp: "max-[961px]:[grid-area:exp]",
  vis: "max-[961px]:[grid-area:vis]",
  created: "max-[961px]:[grid-area:created]",
  act: "max-[961px]:[grid-area:act]",
};

const btnPrimary =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 bg-[#0070C9] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_#11182714] outline-none hover:brightness-[.8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:opacity-45";
const btnSecondary =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-[13px] font-medium text-[#374151] outline-none hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:opacity-45";

/**
 * The dialog a `?view=` opens with — only the purely visual states; the rows are always real.
 * Edit, delete and tracking open on the first project the workspace has (if any); "created" on
 * the newest one, as if it had just been created.
 */
function initialState(view: ProjectsViewName, data: ProjectsData | null) {
  const projects = data?.projects ?? [];
  const manage = data?.canManage ?? false;
  const first = projects[0];
  const newest = projects[projects.length - 1];
  let modal: Modal | null = null;
  if ((view === "create" || view === "createErrors") && manage) modal = { kind: "create" };
  if (view === "created" && newest) modal = { kind: "pixel", project: newest };
  if (view === "edit" && first && manage) modal = { kind: "edit", project: first };
  if (view === "tracking" && first) modal = { kind: "pixel", project: first };
  if (view === "delete" && first && manage) modal = { kind: "delete", project: first };
  return { modal, query: view === "noResults" ? "wholesale" : "" };
}

export function ProjectsView({
  view,
  data,
  load: loadProp,
}: {
  view: ProjectsViewName;
  data: ProjectsData | null;
  load: LoadState;
}) {
  const router = useRouter();
  const [init] = useState(() => initialState(view, data));
  // The rows are the server's; a successful action patches this copy at once and the revalidated
  // page that follows replaces it.
  const [source, setSource] = useState(data?.projects ?? []);
  const [projects, setProjects] = useState(source);
  if (data && data.projects !== source) {
    setSource(data.projects);
    setProjects(data.projects);
  }
  const [retrying, startRetry] = useTransition();
  const load: LoadState = loadProp;
  const canManage = data?.canManage ?? false;
  const workspaceName = data?.workspaceName ?? "";
  const [query, setQuery] = useState(init.query);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(init.modal);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const notify = useCallback((title: string, note: string) => {
    clearTimeout(toastTimer.current);
    setToast({ title, note });
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);

  const closeMenu = useCallback(() => setMenuFor(null), []);

  const q = query.trim().toLowerCase();
  const filtered = projects.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.domain.includes(q),
  );
  const ready = load === "ready";
  const isEmpty = ready && projects.length === 0;
  const countText = !ready
    ? ""
    : q
      ? `${filtered.length} of ${projects.length} projects`
      : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;

  function retry() {
    if (retrying) return;
    startRetry(() => router.refresh());
  }

  const openCreate = () => {
    setMenuFor(null);
    setModal({ kind: "create" });
  };
  const closeModal = () => setModal(null);

  const editTarget = modal?.kind === "edit" ? modal.project : null;
  const deleteTarget = modal?.kind === "delete" ? modal.project : null;
  const pixelTarget = modal?.kind === "pixel" ? modal.project : null;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] leading-[18px] font-medium text-[#6B7280]">
            {workspaceName || "\u00a0"}
          </span>
          <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] text-[#111827]">
            Projects
          </h1>
          <p className="m-0 text-sm leading-[22px] text-pretty text-[#4B5563]">
            Each project is one website with its own tracking code, experiments and integrations.
          </p>
        </div>
        {/* Shown while loading too, as in the design; hidden once the role is known to lack it. */}
        {!isEmpty && (canManage || !data) ? (
          <div className="flex gap-3 max-[641px]:w-full">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={openCreate}
              className={cn(btnPrimary, "h-9 max-[641px]:h-11 max-[641px]:flex-auto")}
            >
              <PlusIcon />
              New project
            </button>
          </div>
        ) : null}
      </header>

      <section
        aria-label="Projects"
        aria-busy={load === "loading"}
        className={cn("flex min-w-0 flex-col gap-3", isEmpty ? "flex-auto" : "flex-none")}
      >
        {isEmpty ? (
          <EmptyState onCreate={canManage ? openCreate : null} />
        ) : (
          <>
            <div role="search" className="flex flex-wrap items-center gap-2">
              <div className="relative max-w-[340px] min-w-0 flex-[1_1_240px] max-[641px]:max-w-none max-[641px]:flex-[1_1_100%]">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setMenuFor(null);
                  }}
                  disabled={!ready}
                  placeholder="Search projects"
                  aria-label="Search projects by name or domain"
                  className={cn(
                    "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-9 text-sm text-[#111827] outline-none max-[961px]:h-11",
                    "placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] disabled:opacity-45",
                    "[&::-webkit-search-cancel-button]:hidden",
                  )}
                />
                {q ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="absolute top-1/2 right-1 inline-flex size-[30px] -translate-y-1/2 items-center justify-center rounded-md text-[#6B7280] outline-none hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] focus-visible:outline-2 focus-visible:outline-[#0091FF]"
                  >
                    <XIcon size={14} strokeWidth={2.2} />
                  </button>
                ) : null}
              </div>
              <span
                aria-live="polite"
                className="ml-auto text-[13px] whitespace-nowrap text-[#6B7280]"
              >
                {countText}
              </span>
            </div>

            <div className="rounded-xl border border-[#EEF0F3] bg-white">
              {load === "loading" || (ready && filtered.length > 0) ? (
                <div role="table" aria-label="Projects">
                  <div role="rowgroup" className="max-[961px]:hidden">
                    <div
                      role="row"
                      className={cn(
                        GRID,
                        "min-h-[38px] rounded-t-[11px] bg-[#FAFBFC] px-4 py-1.5 text-xs leading-4 font-medium text-[#6B7280]",
                      )}
                    >
                      <span role="columnheader">Project</span>
                      <span role="columnheader">Tracking</span>
                      <span role="columnheader">Experiments</span>
                      <span role="columnheader">Visitors</span>
                      <span role="columnheader">Created</span>
                      <span role="columnheader" className="text-right">
                        Actions
                      </span>
                    </div>
                  </div>
                  <div role="rowgroup">
                    {load === "loading"
                      ? SKELETON.map((sk, i) => <SkeletonRow key={i} w1={sk[0]} w2={sk[1]} />)
                      : filtered.map((p) => (
                          <ProjectRow
                            key={p.id}
                            project={p}
                            canManage={canManage}
                            menuOpen={menuFor === p.id}
                            onToggleMenu={() => setMenuFor((cur) => (cur === p.id ? null : p.id))}
                            onCloseMenu={closeMenu}
                            onEdit={() => {
                              setMenuFor(null);
                              setModal({ kind: "edit", project: p });
                            }}
                            onDelete={() => {
                              setMenuFor(null);
                              setModal({ kind: "delete", project: p });
                            }}
                          />
                        ))}
                  </div>
                </div>
              ) : null}

              {load === "error" ? (
                <div
                  role="alert"
                  className="flex flex-col items-center gap-3 px-6 py-14 text-center"
                >
                  <IconTile bg="#FEF2F2" fg="#B91C1C">
                    <AlertIcon />
                  </IconTile>
                  <div className="flex max-w-[420px] flex-col gap-1">
                    <h2 className="m-0 text-base leading-6 font-semibold text-[#111827]">
                      We couldn’t load your projects
                    </h2>
                    <p className="m-0 text-sm leading-[21px] text-[#4B5563]">
                      Something went wrong on our side. Your projects and experiments are safe — try
                      again in a moment.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={retry}
                    disabled={retrying}
                    className={cn(btnSecondary, "h-9 max-[641px]:h-11")}
                  >
                    {retrying ? <Spinner /> : null}
                    {retrying ? "Trying again…" : "Try again"}
                  </button>
                </div>
              ) : null}

              {ready && projects.length > 0 && filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
                  <IconTile bg="#F3F4F6" fg="#4B5563">
                    <SearchIcon size={22} strokeWidth={1.8} stroke="currentColor" />
                  </IconTile>
                  <h2 className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
                    No projects match “{query}”
                  </h2>
                  <p className="m-0 max-w-[420px] text-sm leading-[21px] text-[#4B5563]">
                    Search looks at project names and domains. Check the spelling or clear the
                    search.
                  </p>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className={cn(btnSecondary, "h-9 max-[641px]:h-11")}
                  >
                    Clear search
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* Transparent catcher behind an open row menu: a click anywhere else closes it without
       * also activating whatever was underneath. */}
      {menuFor ? (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setMenuFor(null)}
          className="fixed inset-0 z-30 cursor-default border-0 bg-transparent p-0"
        />
      ) : null}

      <ProjectFormDialog
        mode="create"
        open={modal?.kind === "create"}
        onOpenChange={(open) => !open && closeModal()}
        projects={projects}
        initial={
          view === "createErrors"
            ? { name: "", url: "fernwoodsupply.com", attempted: true }
            : undefined
        }
        onSaved={(created) => {
          setProjects((list) => [...list.filter((p) => p.id !== created.id), created]);
          setModal({ kind: "pixel", project: created });
          notify(
            "Project created",
            `${created.name} is ready. Add its tracking script to start testing.`,
          );
        }}
      />
      <ProjectFormDialog
        mode="edit"
        open={modal?.kind === "edit" && editTarget !== null}
        onOpenChange={(open) => !open && closeModal()}
        project={editTarget ?? undefined}
        projects={projects}
        onSaved={(saved) => {
          setProjects((list) => list.map((p) => (p.id === saved.id ? saved : p)));
          closeModal();
          notify("Project updated", `${saved.name} was saved.`);
        }}
      />
      <DeleteProjectDialog
        project={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && closeModal()}
        onDeleted={(project) => {
          setProjects((list) => list.filter((p) => p.id !== project.id));
          closeModal();
          notify(`${project.name} deleted`, "Its experiments and results were removed.");
        }}
      />
      <PixelSetupDialog
        project={pixelTarget}
        open={pixelTarget !== null}
        onOpenChange={(open) => !open && closeModal()}
        sdkUrl={data?.sdkUrl ?? ""}
        onVerified={(id) => {
          setProjects((list) =>
            list.map((p) =>
              p.id === id && p.track !== "active"
                ? { ...p, track: "active", seen: "Last seen just now" }
                : p,
            ),
          );
        }}
      />

      <ToastHost toast={toast} />
    </>
  );
}

function ProjectRow({
  project: p,
  canManage,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onEdit,
  onDelete,
}: {
  project: Project;
  /** Owner/Admin: the row's Edit / Delete menu. Others only get "View project". */
  canManage: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tm = trackMeta(p.track);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);

  // Keyboard users land on the first item, and Escape returns them to the button that opened
  // the menu — otherwise focus would be stranded on the transparent click-catcher.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseMenu();
        kebabRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, onCloseMenu]);

  const expMain = p.running ? `${p.running} running` : p.total ? "None running" : "No experiments";
  const expSub = p.total
    ? `${p.total} ${p.total === 1 ? "experiment" : "experiments"} total`
    : "Nothing created yet";

  return (
    <div role="row" className={cn(ROW_GRID, "hover:bg-[#FAFBFC]")}>
      <div role="cell" className={cn("flex min-w-0 items-center gap-3", AREA.name)}>
        <span
          aria-hidden
          className="inline-flex size-[34px] flex-none items-center justify-center rounded-lg text-[14px] font-bold"
          style={{ background: p.color, color: p.ink }}
        >
          {p.initial}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-5 font-semibold text-[#111827]">{p.name}</span>
          <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">{p.domain}</span>
        </span>
      </div>

      <div role="cell" className={cn("flex min-w-0 flex-col items-start gap-1", AREA.track)}>
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap"
          style={{ background: tm.bg, color: tm.fg }}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: tm.dot }} />
          {tm.label}
        </span>
        <span className="text-[13px] leading-[18px] whitespace-nowrap text-[#6B7280]">
          {p.seen}
        </span>
      </div>

      <StatCell label="Experiments" className={AREA.exp}>
        <span
          className="text-sm leading-5 font-semibold whitespace-nowrap max-[641px]:whitespace-normal"
          style={{ color: p.running ? "#111827" : "#6B7280" }}
        >
          {expMain}
        </span>
        <Sub>{expSub}</Sub>
      </StatCell>

      <StatCell label="Visitors" className={AREA.vis}>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: p.visitors == null ? "#9CA3AF" : "#111827" }}
        >
          {formatCount(p.visitors)}
        </span>
        <Sub>Last 30 days</Sub>
      </StatCell>

      <StatCell label="Created" className={AREA.created}>
        <span className="text-sm leading-5 whitespace-nowrap text-[#374151] max-[641px]:whitespace-normal">
          {p.created}
        </span>
        <Sub truncate>by {p.createdBy}</Sub>
      </StatCell>

      <div role="cell" className={cn("relative flex items-center justify-end gap-2", AREA.act)}>
        <Link
          href={routes.projects.detail(p.id)}
          aria-label={`View project ${p.name}`}
          className={cn(
            btnSecondary,
            "h-[34px] px-3 no-underline max-[961px]:h-11 max-[961px]:flex-auto",
          )}
        >
          View project
        </Link>
        {canManage ? (
          <button
            ref={kebabRef}
            type="button"
            aria-label={`More actions for ${p.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            className="relative z-[31] inline-flex size-[34px] flex-none items-center justify-center rounded-lg border border-[#E5E7EB] bg-white p-0 text-[#374151] outline-none hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] max-[961px]:h-11"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="12" cy="5" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="12" cy="19" r="1.7" />
            </svg>
          </button>
        ) : null}
        {menuOpen && canManage ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${p.name}`}
            className="absolute top-[calc(100%+4px)] right-0 z-[41] w-60 animate-[rt-in_.14s_ease-out] rounded-xl border border-[#E5E7EB] bg-white p-1.5 text-left shadow-[0_12px_32px_#11182724]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={onEdit}
              className="flex h-[34px] w-full items-center gap-2.5 rounded-md border-0 bg-white px-2.5 text-left text-[13px] font-medium text-[#374151] outline-none hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]"
            >
              <PencilIcon />
              Edit details
            </button>
            <div role="separator" className="mx-1 my-1.5 h-px bg-[#F3F4F6]" />
            <button
              type="button"
              role="menuitem"
              onClick={onDelete}
              className="flex w-full items-start gap-2.5 rounded-md border-0 bg-white px-2.5 py-[9px] text-left text-[13px] font-medium text-[#B91C1C] outline-none hover:bg-[#FEF2F2] focus-visible:bg-[#FEF2F2]"
            >
              <TrashIcon className="mt-0.5 flex-none" />
              <span>Delete project</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCell({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {/* Column headers hide in the card layout, so each value carries its own label there. */}
      <span className="hidden text-xs leading-[1.45] text-[#6B7280] max-[961px]:block">
        {label}
      </span>
      {children}
    </div>
  );
}

function Sub({ children, truncate = false }: { children: ReactNode; truncate?: boolean }) {
  return (
    <span
      className={cn(
        "text-[13px] leading-[18px] text-[#6B7280]",
        truncate ? "truncate" : "whitespace-nowrap max-[641px]:whitespace-normal",
      )}
    >
      {children}
    </span>
  );
}

const SKELETON: [string, string][] = [
  ["52%", "38%"],
  ["64%", "46%"],
  ["44%", "34%"],
];

function Skel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={cn(
        "block animate-[rt-pulse_1.4s_ease-in-out_infinite] rounded-md bg-[#EEF0F3] motion-reduce:animate-none",
        className,
      )}
      style={style}
    />
  );
}

function SkeletonRow({ w1, w2 }: { w1: string; w2: string }) {
  return (
    <div role="row" aria-hidden className={ROW_GRID}>
      <div className={cn("flex items-center gap-3", AREA.name)}>
        <Skel className="size-[34px] flex-none rounded-[9px]" />
        <span className="flex flex-auto flex-col gap-2">
          <Skel className="h-3" style={{ width: w1 }} />
          <Skel className="h-2.5 bg-[#F3F4F6]" style={{ width: w2 }} />
        </span>
      </div>
      <div className={AREA.track}>
        <Skel className="h-[22px] w-[92px] rounded-full" />
      </div>
      <div className={AREA.exp}>
        <Skel className="h-3 w-[70px]" />
      </div>
      <div className={AREA.vis}>
        <Skel className="h-3 w-[60px]" />
      </div>
      <div className={AREA.created}>
        <Skel className="h-3 w-[84px]" />
      </div>
      <div className={cn("flex justify-end gap-2", AREA.act)}>
        <Skel className="h-[34px] w-[110px] rounded-lg" />
        <Skel className="size-[34px] rounded-lg" />
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: (() => void) | null }) {
  return (
    <section
      aria-labelledby="projects-empty-title"
      className={cn(
        "flex flex-auto items-center justify-center rounded-xl border border-[#EEF0F3] bg-white px-6 py-14",
        "min-h-[max(440px,calc(100vh-176px))] max-[1200px]:min-h-[max(400px,calc(100vh-232px))]",
        "max-[641px]:min-h-0 max-[641px]:items-start max-[641px]:px-5 max-[641px]:py-10",
      )}
    >
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
        <span
          aria-hidden
          className="inline-flex size-16 items-center justify-center rounded-[18px] bg-[#E6F4FF] text-[#0060AD] shadow-[0_0_0_8px_color-mix(in_srgb,#E6F4FF_45%,#FFFFFF)]"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
          </svg>
        </span>
        <div className="flex flex-col gap-2">
          <h2
            id="projects-empty-title"
            className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]"
          >
            No projects yet
          </h2>
          <p className="m-0 text-sm leading-[22px] text-pretty text-[#4B5563]">
            Projects represent the websites you test in Routely. Create your first project to get a
            tracking code and start running experiments.
          </p>
        </div>
        {onCreate ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onCreate}
            className={cn(btnPrimary, "h-11 px-5 text-[15px] max-[641px]:h-12 max-[641px]:w-full")}
          >
            <PlusIcon />
            Create project
          </button>
        ) : null}
      </div>
    </section>
  );
}

function IconTile({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-11 items-center justify-center rounded-xl"
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  );
}

// Icons are the design's own strokes, kept inline so they match it exactly.

function Svg({
  size = 18,
  strokeWidth = 2,
  stroke = "currentColor",
  className,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  stroke?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

function PlusIcon() {
  return (
    <Svg>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

function SearchIcon({
  className,
  size = 16,
  strokeWidth = 2,
  stroke = "#6B7280",
}: {
  className?: string;
  size?: number;
  strokeWidth?: number;
  stroke?: string;
}) {
  return (
    <Svg size={size} strokeWidth={strokeWidth} stroke={stroke} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Svg>
  );
}

function XIcon({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <Svg size={size} strokeWidth={strokeWidth}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

function AlertIcon() {
  return (
    <Svg size={22} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2v.3" />
    </Svg>
  );
}

function PencilIcon() {
  return (
    <Svg size={16} strokeWidth={1.8}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <Svg size={16} strokeWidth={1.8} className={className}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </Svg>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin motion-reduce:animate-none"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}
