"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";

import {
  AbIcon,
  ChartIcon,
  FlaskIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
  SplitIcon,
} from "@/components/experiments-list/experiment-type-icons";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  KebabIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { PopoverMenu } from "@/components/rt/popover-menu";
import { focusRing, menuItem } from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import { useViewerTimeZone } from "@/components/experiment/use-viewer-time-zone";
import {
  STATUS_META,
  formatCount,
  tileFor,
  type ExperimentListItem,
  type ExperimentListStatus,
  type ExperimentType,
  type ExperimentsView as View,
} from "@/lib/experiment-list";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { pauseExperimentAction, resumeExperimentAction } from "@/server/actions/experiment.actions";

type TypeFilter = "all" | ExperimentType;
type StatusFilter = "all" | ExperimentListStatus;
type Menu = "new" | "type" | "status";
interface Confirm {
  kind: "pause" | "resume";
  id: string;
}

const TYPES: [TypeFilter, string, string][] = [
  ["all", "All types", "All"],
  ["ab", "A/B Testing", "A/B Testing"],
  ["split", "Split URL Testing", "Split URL"],
];
const STATUSES: [StatusFilter, string, string][] = [
  ["all", "All statuses", "All"],
  ["draft", "Draft", "Draft"],
  ["running", "Running", "Running"],
  ["paused", "Paused", "Paused"],
  ["completed", "Completed", "Completed"],
];

const SKELETON_ROWS: [string, string][] = [
  ["62%", "40%"],
  ["48%", "56%"],
  ["70%", "34%"],
  ["54%", "44%"],
  ["66%", "38%"],
  ["44%", "50%"],
  ["58%", "42%"],
  ["50%", "36%"],
];

/**
 * One grid for the header, rows and skeleton. Below 1280px the Type column folds into the name
 * cell's second line; below 960px each row becomes a three-column card with named areas.
 */
const GRID = cn(
  "grid grid-cols-[minmax(170px,2fr)_minmax(100px,1fr)_100px_minmax(72px,.8fr)_minmax(88px,.9fr)_minmax(88px,.9fr)_minmax(86px,.9fr)_148px] items-center gap-x-3",
  "max-[1280px]:grid-cols-[minmax(170px,2.2fr)_100px_minmax(72px,.8fr)_minmax(88px,.9fr)_minmax(88px,.9fr)_minmax(86px,.9fr)_148px]",
);
const ROW = cn(
  GRID,
  "min-h-[66px] border-t border-[#EEF0F3] px-4 py-3",
  "max-[961px]:grid-cols-3 max-[961px]:items-start max-[961px]:gap-y-3.5 max-[961px]:p-4",
  "max-[961px]:[grid-template-areas:'name_name_status'_'vis_share_conv'_'upd_act_act']",
);
const C = {
  name: "max-[961px]:[grid-area:name]",
  type: "max-[1280px]:hidden",
  status: "max-[961px]:[grid-area:status] max-[961px]:justify-end",
  vis: "max-[961px]:[grid-area:vis]",
  share: "max-[961px]:[grid-area:share]",
  conv: "max-[961px]:[grid-area:conv]",
  upd: "max-[961px]:[grid-area:upd] max-[961px]:self-end",
  act: "max-[961px]:[grid-area:act] max-[961px]:self-end",
};
const MLABEL = "hidden text-xs text-[#6B7280] max-[961px]:block leading-[1.45]";
const ACT_BTN =
  "inline-flex h-[34px] items-center justify-center rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap no-underline max-[961px]:h-11 max-[961px]:flex-auto";
const ACT_OUTLINE = "border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]";
const ACT_DARK = "border-[#0070C9] bg-[#0070C9] text-white hover:brightness-[.8]";
const KEBAB_SIZE = "size-[34px] flex-[0_0_34px] max-[961px]:size-11 max-[961px]:flex-[0_0_44px]";
const FILTER_BTN = `inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border pr-2.5 pl-3 text-[13px] whitespace-nowrap text-[#111827] hover:enabled:bg-[#F9FAFB] disabled:cursor-default disabled:opacity-45 max-[961px]:h-11 ${focusRing}`;
const SKEL = "block animate-[rt-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none";

/**
 * The experiments list. `items` is every experiment in scope (one project, or the workspace);
 * search and the type and status filters run here, over that full list, because each filter
 * option shows a count of the unfiltered set.
 *
 * Pause and resume call the lifecycle actions; the row flips at once and the server's copy
 * replaces it when the refreshed list arrives. A Viewer (`canEdit` false) gets no action that
 * would change anything — only "View results".
 */
export function ExperimentsView({
  view: initialView,
  items: serverItems,
  canEdit,
  projectId,
  timeZone,
  failed = false,
}: {
  view: View;
  items: ExperimentListItem[];
  canEdit: boolean;
  /** The project the list is narrowed to; new experiments are created there. */
  projectId: string | null;
  /** The zone the server formatted "Last updated" in. */
  timeZone: string;
  /** The list could not be loaded: the error panel, whose Retry re-requests the page. */
  failed?: boolean;
}) {
  useViewerTimeZone(timeZone);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState("");
  const [typeF, setTypeF] = useState<TypeFilter>(initialView === "noResults" ? "split" : "all");
  const [statusF, setStatusF] = useState<StatusFilter>(
    initialView === "noResults" ? "draft" : "all",
  );
  const [overrides, setOverrides] = useState<Record<string, ExperimentListStatus>>({});
  // Overrides only bridge the moment between an action and the refreshed list.
  const [shownItems, setShownItems] = useState(serverItems);
  if (shownItems !== serverItems) {
    setShownItems(serverItems);
    setOverrides({});
  }
  const [confirm, setConfirm] = useState<Confirm | null>(() => {
    if (initialView !== "confirm" || !canEdit) return null;
    const running = serverItems.find((e) => e.status === "running");
    return running ? { kind: "pause", id: running.id } : null;
  });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const { toast, notify: rawNotify } = useToast(3200);

  const newRef = useRef<HTMLButtonElement>(null);
  const typeRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLButtonElement>(null);

  const notify = (title: string, note: string) => {
    setMenu(null);
    setRowMenu(null);
    rawNotify(title, note);
  };

  const isLoading = view === "loading" || refreshing;
  const isError = (view === "error" || failed) && !refreshing;
  const ready = !isLoading && !isError;
  const base = ready && view !== "empty" ? serverItems : [];
  const newAbHref = routes.experiments.wizard("AB_TEST", undefined, projectId ?? undefined);
  const newSplitHref = routes.experiments.wizard("SPLIT_URL", undefined, projectId ?? undefined);
  const items: ExperimentListItem[] = base.map((e) => {
    const o = overrides[e.id];
    return o ? { ...e, status: o, updLabel: "Just now", updTime: "by you" } : e;
  });
  const hasExps = items.length > 0;
  const noExps = ready && !hasExps;

  const q = query.trim().toLowerCase();
  const filtersActive = q !== "" || typeF !== "all" || statusF !== "all";
  const filtered = items.filter(
    (e) =>
      (!q || e.name.toLowerCase().includes(q)) &&
      (typeF === "all" || e.type === typeF) &&
      (statusF === "all" || e.status === statusF),
  );

  const countText = isLoading
    ? "Loading experiments…"
    : filtersActive
      ? `Showing ${filtered.length} of ${items.length}`
      : `${items.length} ${items.length === 1 ? "experiment" : "experiments"}`;

  const toggle = (m: Menu) => {
    setRowMenu(null);
    setMenu((cur) => (cur === m ? null : m));
  };
  const closeMenu = () => setMenu(null);
  const clearFilters = () => {
    setQuery("");
    setTypeF("all");
    setStatusF("all");
    setMenu(null);
  };
  const retry = () => {
    startRefresh(() => {
      setView("data");
      router.refresh();
    });
  };
  const openConfirm = (kind: Confirm["kind"], id: string) => {
    setRowMenu(null);
    setMenu(null);
    setConfirm({ kind, id });
  };

  const confItem = confirm ? (items.find((e) => e.id === confirm.id) ?? null) : null;
  const isPause = confirm?.kind === "pause";
  const doConfirm = () => {
    if (!confItem) return;
    const item = confItem;
    const pause = isPause;
    setOverrides((o) => ({ ...o, [item.id]: pause ? "paused" : "running" }));
    setConfirm(null);
    void (async () => {
      const result = pause
        ? await pauseExperimentAction(item.id)
        : await resumeExperimentAction(item.id);
      if (!result.ok) {
        setOverrides((o) => {
          const { [item.id]: _undone, ...rest } = o;
          return rest;
        });
        notify(
          pause ? "Couldn’t pause the experiment" : "Couldn’t resume the experiment",
          result.message,
        );
        return;
      }
      notify(
        pause ? "Experiment paused" : "Experiment resumed",
        `“${item.name}” ${pause ? "is no longer receiving traffic." : "is receiving traffic again."}`,
      );
      router.refresh();
    })();
  };

  const typeLabel = TYPES.find((t) => t[0] === typeF)![2];
  const statusLabel = STATUSES.find((t) => t[0] === statusF)![2];
  const countBy = (key: "type" | "status", val: string) =>
    items.filter((e) => e[key] === val).length;

  return (
    <>
      <header
        className="flex flex-wrap items-end justify-between gap-4 leading-[1.45]"
        aria-busy={isLoading}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] text-[#111827]">
            Experiments
          </h1>
          <p className="m-0 text-sm leading-[22px] text-[#4B5563]">
            Create, manage, and monitor your website experiments.
          </p>
        </div>
        {canEdit ? (
          <div className="relative z-[45] max-[641px]:w-full">
            <button
              ref={newRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu === "new"}
              onClick={() => toggle("new")}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#0070C9] pr-3 pl-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_#11182714] hover:brightness-[.8] max-[641px]:w-full max-[641px]:justify-center",
                focusRing,
              )}
            >
              <PlusIcon />
              <span>New experiment</span>
              <span aria-hidden className="mx-0.5 h-[18px] w-px bg-white/35" />
              <ChevronDownIcon />
            </button>
            <PopoverMenu
              open={menu === "new"}
              onClose={closeMenu}
              triggerRef={newRef}
              label="Choose experiment type"
              className="top-[calc(100%+8px)] flex w-[340px] flex-col gap-0.5 max-[641px]:right-0 max-[641px]:left-0 max-[641px]:w-auto"
            >
              <p className="m-0 px-2.5 pt-2 pb-1.5 text-xs leading-[1.45] font-medium text-[#6B7280]">
                Choose an experiment type
              </p>
              <NewTypeItem
                href={newAbHref}
                icon={<AbIcon />}
                title="A/B Testing"
                body="Test variations of elements on the same page URL."
              />
              <NewTypeItem
                href={newSplitHref}
                icon={<SplitIcon />}
                title="Split URL Testing"
                body="Split traffic between different page URLs and compare them."
              />
            </PopoverMenu>
          </div>
        ) : null}
      </header>

      <section aria-label="All experiments" className="flex min-w-0 flex-col gap-3 leading-[1.45]">
        {isLoading || hasExps ? (
          <div role="search" className="relative z-[42] flex flex-wrap items-center gap-2">
            <div className="relative max-w-[340px] min-w-0 flex-[1_1_240px] max-[641px]:max-w-none max-[641px]:flex-[1_1_100%]">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]"
                size={16}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!ready}
                placeholder="Search experiments"
                aria-label="Search experiments by name"
                className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-9 text-sm leading-[1.45] text-[#111827] outline-none placeholder:text-[#6B7280] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] disabled:opacity-45 max-[961px]:h-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {query !== "" ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className={cn(
                    "absolute top-1/2 right-1 inline-flex size-[30px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[#6B7280] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
                    focusRing,
                  )}
                >
                  <XIcon size={14} strokeWidth={2.2} />
                </button>
              ) : null}
            </div>

            <div className="relative">
              <button
                ref={typeRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu === "type"}
                disabled={!ready}
                onClick={() => toggle("type")}
                className={cn(
                  FILTER_BTN,
                  typeF !== "all" ? "border-[#B3DBFF] bg-[#E6F4FF]" : "border-[#E5E7EB] bg-white",
                )}
              >
                <span className="text-[#6B7280]">Type</span>
                <span className="font-semibold">{typeLabel}</span>
                <ChevronDownIcon className="text-[#6B7280]" />
              </button>
              <PopoverMenu
                open={menu === "type"}
                onClose={closeMenu}
                triggerRef={typeRef}
                label="Filter by type"
                align="left"
                className="top-[calc(100%+6px)] flex min-w-[232px] flex-col gap-0.5"
              >
                {TYPES.map(([key, label]) => (
                  <FilterOption
                    key={key}
                    selected={key === typeF}
                    label={label}
                    count={key === "all" ? items.length : countBy("type", key)}
                    onPick={() => {
                      setTypeF(key);
                      setMenu(null);
                    }}
                  />
                ))}
              </PopoverMenu>
            </div>

            <div className="relative">
              <button
                ref={statusRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu === "status"}
                disabled={!ready}
                onClick={() => toggle("status")}
                className={cn(
                  FILTER_BTN,
                  statusF !== "all" ? "border-[#B3DBFF] bg-[#E6F4FF]" : "border-[#E5E7EB] bg-white",
                )}
              >
                <span className="text-[#6B7280]">Status</span>
                <span className="font-semibold">{statusLabel}</span>
                <ChevronDownIcon className="text-[#6B7280]" />
              </button>
              <PopoverMenu
                open={menu === "status"}
                onClose={closeMenu}
                triggerRef={statusRef}
                label="Filter by status"
                className="top-[calc(100%+6px)] flex min-w-[220px] flex-col gap-0.5"
              >
                {STATUSES.map(([key, label]) => (
                  <FilterOption
                    key={key}
                    selected={key === statusF}
                    label={label}
                    dot={key === "all" ? "#D1D5DB" : STATUS_META[key].dot}
                    count={key === "all" ? items.length : countBy("status", key)}
                    onPick={() => {
                      setStatusF(key);
                      setMenu(null);
                    }}
                  />
                ))}
              </PopoverMenu>
            </div>

            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[13px] font-medium whitespace-nowrap text-[#4B5563] hover:text-[#111827]",
                  focusRing,
                )}
              >
                <XIcon size={14} strokeWidth={2.2} />
                Clear filters
              </button>
            ) : null}

            <span
              aria-live="polite"
              className="ml-auto text-[13px] whitespace-nowrap text-[#6B7280]"
            >
              {countText}
            </span>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#EEF0F3] bg-white">
          {isLoading || filtered.length > 0 ? (
            <div role="table" aria-label="Experiments" aria-rowcount={filtered.length + 1}>
              <div role="rowgroup" className="max-[961px]:hidden">
                <div
                  role="row"
                  className={cn(
                    GRID,
                    "min-h-[38px] rounded-t-[11px] bg-[#FAFBFC] px-4 py-1.5 text-xs leading-4 font-medium text-[#6B7280]",
                  )}
                >
                  <span role="columnheader">Experiment name</span>
                  <span role="columnheader" className={C.type}>
                    Type
                  </span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Visitors</span>
                  <span role="columnheader">Traffic share</span>
                  <span role="columnheader">Conversion rate</span>
                  <span role="columnheader">Last updated</span>
                  <span role="columnheader" className="text-right">
                    Actions
                  </span>
                </div>
              </div>
              <div role="rowgroup">
                {isLoading
                  ? SKELETON_ROWS.map(([w1, w2], i) => <SkeletonRow key={i} w1={w1} w2={w2} />)
                  : filtered.map((e, i) => (
                      <ExperimentRow
                        key={e.id}
                        e={e}
                        menuOpen={rowMenu === e.id}
                        menuUp={filtered.length > 3 && i >= filtered.length - 2}
                        onToggleMenu={() => {
                          setMenu(null);
                          setRowMenu((cur) => (cur === e.id ? null : e.id));
                        }}
                        onCloseMenu={() => setRowMenu(null)}
                        onConfirm={openConfirm}
                        canEdit={canEdit}
                      />
                    ))}
              </div>
            </div>
          ) : null}

          {hasExps && filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3.5 px-6 pt-14 pb-[60px] text-center">
              <span
                aria-hidden
                className="inline-flex size-11 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563]"
              >
                <SearchIcon size={22} strokeWidth={1.8} />
              </span>
              <div className="flex max-w-[440px] flex-col gap-1">
                <h2 className="m-0 text-base leading-[23px] font-semibold text-[#111827]">
                  {q
                    ? `No experiments match “${query.trim()}”`
                    : "No experiments match your filters"}
                </h2>
                <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                  Try a different search term or remove some filters to see all {items.length}{" "}
                  experiments.
                </p>
              </div>
              <button
                type="button"
                onClick={clearFilters}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-[13px] font-medium text-[#374151] hover:bg-[#F9FAFB]",
                  focusRing,
                )}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {noExps ? (
            <EmptyState newAbHref={canEdit ? newAbHref : null} newSplitHref={newSplitHref} />
          ) : null}

          {isError ? (
            <div role="alert" className="flex flex-col items-center gap-3.5 px-6 py-14 text-center">
              <span
                aria-hidden
                className="inline-flex size-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]"
              >
                <AlertCircleIcon size={24} strokeWidth={1.8} />
              </span>
              <div className="flex max-w-[440px] flex-col gap-1">
                <h2 className="m-0 text-base leading-6 font-semibold text-[#111827]">
                  We couldn’t load your experiments
                </h2>
                <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                  Something went wrong while fetching your experiment list. Check your connection
                  and try again.
                </p>
              </div>
              <button
                type="button"
                onClick={retry}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#0070C9] px-4 text-[13px] font-semibold text-white hover:brightness-[.8]",
                  focusRing,
                )}
              >
                <RetryIcon />
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={!!confItem}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={null}
        width={440}
        className="gap-5 p-6"
      >
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden
            className="inline-flex size-10 flex-[0_0_40px] items-center justify-center rounded-full"
            style={
              isPause
                ? { background: "#FEF3C7", color: "#92400E" }
                : { background: "#E6F4FF", color: "#0060AD" }
            }
          >
            {isPause ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogPrimitive.Title className="m-0 text-base leading-6 font-semibold text-[#111827]">
              {isPause ? "Pause this experiment?" : "Resume this experiment?"}
            </DialogPrimitive.Title>
            <p className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
              {confItem
                ? isPause
                  ? `“${confItem.name}” will stop receiving traffic, and every visitor will see the original page. Data collected so far is kept, and you can resume at any time.`
                  : `“${confItem.name}” will start receiving traffic again at its ${confItem.alloc}% traffic share.`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-[641px]:[&>button]:flex-auto">
          <button
            type="button"
            onClick={() => setConfirm(null)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[#E5E7EB] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F9FAFB]",
              focusRing,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doConfirm}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-[#0070C9] px-4 text-[13px] font-medium text-white hover:brightness-[.8]",
              focusRing,
            )}
          >
            {isPause ? "Pause experiment" : "Resume experiment"}
          </button>
        </div>
      </Modal>

      <ToastHost toast={toast} />
    </>
  );
}

function NewTypeItem({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex w-full items-start gap-3 rounded-md bg-white p-2.5 text-left text-[#111827] no-underline outline-none hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]"
    >
      <span
        aria-hidden
        className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg bg-[#E6F4FF] text-[#0060AD]"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-[1.45] font-semibold">{title}</span>
        <span className="text-[13px] leading-[18px] text-[#4B5563]">{body}</span>
      </span>
    </Link>
  );
}

function FilterOption({
  selected,
  label,
  count,
  dot,
  onPick,
}: {
  selected: boolean;
  label: string;
  count: number;
  dot?: string;
  onPick(): void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onPick}
      className={cn(
        menuItem,
        "h-[34px] text-[#111827]",
        selected ? "font-semibold" : "font-normal",
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className="size-2 flex-[0_0_8px] rounded-full"
          style={{ background: dot }}
        />
      ) : null}
      <span className="flex-auto whitespace-nowrap">{label}</span>
      <span className="text-[13px] font-normal text-[#6B7280] tabular-nums">{count}</span>
      <span aria-hidden className="inline-flex size-4">
        {selected ? <CheckIcon size={16} strokeWidth={2.2} className="text-[#0070C9]" /> : null}
      </span>
    </button>
  );
}

function ExperimentRow({
  e,
  menuOpen,
  menuUp,
  onToggleMenu,
  onCloseMenu,
  onConfirm,
  canEdit,
}: {
  e: ExperimentListItem;
  menuOpen: boolean;
  menuUp: boolean;
  onToggleMenu(): void;
  onCloseMenu(): void;
  onConfirm(kind: Confirm["kind"], id: string): void;
  /** False for a Viewer: no editing, pausing or resuming — results only. */
  canEdit: boolean;
}) {
  const kebabRef = useRef<HTMLButtonElement>(null);
  const st = STATUS_META[e.status];
  const [tile, tileInk] = tileFor(e.id);
  const live = e.status === "running" || e.status === "paused";
  const resultsHref = e.resultsHref;

  let primaryLabel: string | null;
  let primaryHref: string | null = null;
  let primary: () => void = () => {};
  let dark = false;
  let menu: { label: string; icon: ReactNode; href: string | null; act(): void } | null = null;
  if (e.status === "draft") {
    primaryLabel = canEdit ? "Continue editing" : null;
    primaryHref = e.editHref;
  } else if (e.status === "running") {
    primaryLabel = "View results";
    primaryHref = resultsHref;
    if (canEdit) {
      menu = {
        label: "Pause experiment",
        icon: <PauseIcon />,
        href: null,
        act: () => onConfirm("pause", e.id),
      };
    }
  } else if (e.status === "paused" && canEdit) {
    primaryLabel = "Resume";
    dark = true;
    primary = () => onConfirm("resume", e.id);
    menu = { label: "View results", icon: <ChartIcon />, href: resultsHref, act: () => {} };
  } else {
    primaryLabel = "View results";
    primaryHref = resultsHref;
  }

  const noteFg = e.note.startsWith("+")
    ? "#166534"
    : e.note.startsWith("−")
      ? "#B91C1C"
      : "#6B7280";
  const note = e.rate != null ? e.note : e.status === "draft" ? "" : "no data yet";
  const actCls = cn(ACT_BTN, dark ? ACT_DARK : ACT_OUTLINE, focusRing);
  const typeLabel = e.type === "ab" ? "A/B Testing" : "Split URL";
  const menuItemCls = cn(menuItem, "h-[34px] whitespace-nowrap");

  return (
    <div role="row" className={cn(ROW, "hover:bg-[#FAFBFC]")}>
      <div role="cell" className={cn("flex min-w-0 items-center gap-3", C.name)}>
        <span
          aria-hidden
          className="inline-flex size-8 flex-[0_0_32px] items-center justify-center rounded-lg text-[13px] font-bold"
          style={{ background: tile, color: tileInk }}
        >
          {e.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-5 font-semibold text-[#111827]">{e.name}</span>
          <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">
            {e.path}
            <span className="hidden max-[1280px]:inline"> · {typeLabel}</span>
          </span>
        </span>
      </div>
      <div
        role="cell"
        className={cn(
          "flex min-w-0 items-center gap-2 text-sm leading-[1.45] text-[#374151]",
          C.type,
        )}
      >
        {e.type === "ab" ? (
          <AbIcon size={16} className="flex-[0_0_16px] text-[#6B7280]" />
        ) : (
          <SplitIcon size={16} className="flex-[0_0_16px] text-[#6B7280]" />
        )}
        <span className="truncate">{typeLabel}</span>
      </div>
      <div role="cell" className={cn("flex", C.status)}>
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs leading-[1.45] font-semibold whitespace-nowrap"
          style={{ background: st.bg, color: st.fg }}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: st.dot }} />
          {st.label}
        </span>
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", C.vis)}>
        <span className={MLABEL}>Visitors</span>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: e.visitors == null ? "#6B7280" : "#111827" }}
        >
          {e.visitors == null ? "—" : formatCount(e.visitors)}
        </span>
        <span className="text-[13px] leading-[18px] whitespace-nowrap text-[#6B7280]">
          {e.variants} {e.variants === 1 ? "variant" : "variants"}
        </span>
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", C.share)}>
        <span className={MLABEL}>Traffic share</span>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: live ? "#111827" : "#6B7280" }}
        >
          {live ? `${e.alloc}%` : "—"}
        </span>
        {live ? (
          <span
            aria-hidden
            className="my-[7px] block h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-[#F3F4F6]"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${e.alloc}%`,
                background: e.status === "running" ? "#0070C9" : "#D1D5DB",
              }}
            />
          </span>
        ) : (
          <span className="text-[13px] leading-[18px] whitespace-nowrap text-[#6B7280]">
            {e.status === "draft" ? "not launched" : "ended"}
          </span>
        )}
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", C.conv)}>
        <span className={MLABEL}>Conv. rate</span>
        <span
          className="text-sm leading-5 font-semibold tabular-nums"
          style={{ color: e.rate == null ? "#6B7280" : "#111827" }}
        >
          {e.rate == null ? "—" : `${e.rate.toFixed(1)}%`}
        </span>
        <span className="truncate text-[13px] leading-[18px]" style={{ color: noteFg }}>
          {note}
        </span>
      </div>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", C.upd)}>
        <span className={MLABEL}>Last updated</span>
        <span className="text-sm leading-5 whitespace-nowrap text-[#374151]">{e.updLabel}</span>
        <span className="text-[13px] leading-[18px] whitespace-nowrap text-[#6B7280]">
          {e.updTime}
        </span>
      </div>
      <div role="cell" className={cn("relative flex items-center justify-end gap-2", C.act)}>
        {primaryLabel === null ? null : primaryHref ? (
          <Link href={primaryHref} aria-label={`${primaryLabel}: ${e.name}`} className={actCls}>
            {primaryLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={primary}
            aria-label={`${primaryLabel}: ${e.name}`}
            className={cn(actCls, "cursor-pointer")}
          >
            {primaryLabel}
          </button>
        )}
        {menu ? (
          <button
            ref={kebabRef}
            type="button"
            aria-label={`More actions for ${e.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center rounded-lg border border-[#E5E7EB] bg-white p-0 text-[#374151] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
              KEBAB_SIZE,
              focusRing,
            )}
          >
            <KebabIcon />
          </button>
        ) : (
          <span aria-hidden className={cn("block", KEBAB_SIZE)} />
        )}
        {menu ? (
          <PopoverMenu
            open={menuOpen}
            onClose={onCloseMenu}
            triggerRef={kebabRef}
            label={`Actions for ${e.name}`}
            className={cn("min-w-[200px]", menuUp && "top-auto bottom-[calc(100%+4px)]")}
          >
            {menu.href ? (
              <Link role="menuitem" href={menu.href} className={menuItemCls}>
                {menu.icon}
                {menu.label}
              </Link>
            ) : (
              <button type="button" role="menuitem" onClick={menu.act} className={menuItemCls}>
                {menu.icon}
                {menu.label}
              </button>
            )}
          </PopoverMenu>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonRow({ w1, w2 }: { w1: string; w2: string }) {
  const bar = (w: number | string, h: number, r: number, light = false) => (
    <span
      className={SKEL}
      style={{ width: w, height: h, borderRadius: r, background: light ? "#F3F4F6" : "#EEF0F3" }}
    />
  );
  return (
    <div role="row" className={ROW}>
      <div role="cell" className={cn("flex items-center gap-3", C.name)}>
        <span className={cn(SKEL, "size-8 flex-[0_0_32px] rounded-lg bg-[#EEF0F3]")} />
        <span className="flex flex-auto flex-col gap-2">
          {bar(w1, 12, 6)}
          {bar(w2, 10, 5, true)}
        </span>
      </div>
      <div role="cell" className={C.type}>
        {bar(76, 12, 6)}
      </div>
      <div role="cell" className={cn("flex", C.status)}>
        {bar(76, 22, 999)}
      </div>
      <div role="cell" className={cn("flex flex-col gap-2", C.vis)}>
        {bar(48, 12, 6)}
        {bar(60, 10, 5, true)}
      </div>
      <div role="cell" className={cn("flex flex-col gap-2.5", C.share)}>
        {bar(36, 12, 6)}
        <span className={cn(SKEL, "h-1 w-full max-w-[120px] rounded-full bg-[#F3F4F6]")} />
      </div>
      <div role="cell" className={cn("flex flex-col gap-2", C.conv)}>
        {bar(40, 12, 6)}
        {bar(70, 10, 5, true)}
      </div>
      <div role="cell" className={cn("flex flex-col gap-2", C.upd)}>
        {bar(52, 12, 6)}
        {bar(44, 10, 5, true)}
      </div>
      <div role="cell" className={cn("flex justify-end gap-2", C.act)}>
        <span
          className={cn(
            SKEL,
            "h-[34px] w-24 rounded-lg bg-[#F3F4F6] max-[961px]:h-11 max-[961px]:flex-auto",
          )}
        />
        <span className={cn(SKEL, "rounded-lg bg-[#F3F4F6]", KEBAB_SIZE)} />
      </div>
    </div>
  );
}

function EmptyState({
  newAbHref,
  newSplitHref,
}: {
  /** Null for a Viewer, who cannot create experiments: the type cards are left out. */
  newAbHref: string | null;
  newSplitHref: string;
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-16 text-center">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-full bg-[#E6F4FF] text-[#0060AD]"
      >
        <FlaskIcon />
      </span>
      <div className="flex max-w-[500px] flex-col gap-1.5">
        <h2 className="m-0 text-base leading-6 font-semibold text-[#111827]">
          Start your first experiment
        </h2>
        <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
          Experiments show which version of a page gets more of your visitors to convert, so you can
          ship changes based on results instead of guesses.
        </p>
      </div>
      {newAbHref ? (
        <div className="flex w-full max-w-[600px] flex-col gap-2.5">
          <p className="m-0 text-[13px] font-medium text-[#6B7280]">Choose an experiment type</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            <EmptyTypeCard
              href={newAbHref}
              icon={<AbIcon />}
              title="A/B Testing"
              body="Test variations of headlines, buttons or images on the same page."
            />
            <EmptyTypeCard
              href={newSplitHref}
              icon={<SplitIcon />}
              title="Split URL Testing"
              body="Send visitors to different page URLs and compare which converts better."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyTypeCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 text-left text-[#111827] no-underline hover:bg-[#F9FAFB]",
        focusRing,
      )}
    >
      <span
        aria-hidden
        className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg bg-[#E6F4FF] text-[#0060AD]"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-sm leading-[1.45] font-semibold">{title}</span>
        <span className="text-[13px] leading-[19px] text-[#4B5563]">{body}</span>
      </span>
    </Link>
  );
}
