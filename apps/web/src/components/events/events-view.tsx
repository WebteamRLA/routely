"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ProjectAvatar } from "@/components/common/project-avatar";
import { DeleteEventDialog } from "@/components/events/delete-event-dialog";
import { EventDialog } from "@/components/events/event-dialog";
import {
  type EventForm,
  blankForm,
  formFromEvent,
  formFromReceived,
  formFromTemplate,
  suggestedEvents,
} from "@/components/events/event-form";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  Spinner,
  TrashIcon,
  WarningIcon,
} from "@/components/rt/icons";
import { PopoverMenu } from "@/components/rt/popover-menu";
import { Skeleton, StatusPill, TONES, type Tone } from "@/components/rt/primitives";
import { btn, card, focusRing, menuItem } from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import {
  EVENT_ACTIVE_WINDOW_LABEL,
  type EventStatus,
  type EventTemplate,
  FORM_SUCCESS_LABELS,
  METHOD_LABELS,
} from "@/lib/events";
import { relativeTime } from "@/lib/experiment-time";
import { shortUrl } from "@/lib/launch-rules";
import { can } from "@/lib/permissions";
import type { PdProject } from "@/lib/project-dashboard";
import { routes, withGoalEvent } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { getEventLibraryAction } from "@/server/actions/event.actions";
import type {
  EventLibrary,
  EventUsage,
  LibraryEvent,
} from "@/server/services/custom-event.service";
import type { ProjectChoice } from "@/server/services/project.service";

export type EventsLoad = "data" | "loading" | "error";

type SavedEvent = LibraryEvent & { id: string };
type Dialog =
  | { kind: "form"; event: LibraryEvent | null; form: EventForm }
  | { kind: "delete"; event: SavedEvent };

const TONE: Record<EventStatus["tone"], Tone> = {
  ok: TONES.green,
  warn: TONES.amber,
  fail: TONES.red,
  idle: TONES.gray,
};

/**
 * One grid for the header, rows and skeleton. Seven columns need more room than the other tables,
 * so rows become cards below 1240px; a row's notes span its full width in both layouts.
 */
const GRID =
  "grid grid-cols-[minmax(190px,2fr)_minmax(120px,1fr)_minmax(190px,1.2fr)_minmax(66px,.6fr)_minmax(92px,.7fr)_minmax(100px,.8fr)_76px] gap-x-3 items-center";
const ROW = cn(
  GRID,
  "min-h-[66px] border-t border-[#EEF0F3] px-4 py-3",
  "max-[1241px]:grid-cols-3 max-[1241px]:items-start max-[1241px]:gap-y-3 max-[1241px]:p-4",
  "max-[1241px]:[grid-template-areas:'name_name_act'_'method_status_status'_'total_last_used']",
  "max-[641px]:[grid-template-areas:'name_name_name'_'method_method_method'_'status_status_status'_'total_last_used'_'act_act_act']",
);
const AREA = {
  name: "max-[1241px]:[grid-area:name]",
  method: "max-[1241px]:[grid-area:method]",
  status: "max-[1241px]:[grid-area:status]",
  total: "max-[1241px]:[grid-area:total]",
  last: "max-[1241px]:[grid-area:last]",
  used: "max-[1241px]:[grid-area:used]",
  act: "max-[1241px]:[grid-area:act]",
};
const cellLabel = "hidden text-[12px] leading-[1.45] text-[#6B7280] max-[1241px]:block";
const cellText = "text-[13px] leading-[19px] text-[#374151]";

/**
 * A project's Event Library: what it has set up, and what has actually arrived.
 *
 * The rows are the server's. Refresh reads them again in place, and a save or delete does too, so
 * the status a row shows is never one this screen assumed.
 */
export function EventsView({
  project,
  data,
  load,
  now: serverNow,
  projects,
  returnTo = null,
}: {
  project: PdProject;
  data: EventLibrary | null;
  load: EventsLoad;
  /** Epoch ms the server read the library at, so relative times render the same on both sides. */
  now: number;
  /** Set on the Metrics page: the workspace's projects, switched between in place of a breadcrumb. */
  projects?: ProjectChoice[];
  /** The wizard this visit came from (`wizardReturnPath`): offer the way back. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  // A newer server render replaces whatever a refresh read before it.
  const [source, setSource] = useState(data);
  const [library, setLibrary] = useState(data);
  const [now, setNow] = useState(serverNow);
  if (data !== source) {
    setSource(data);
    setLibrary(data);
    setNow(serverNow);
  }

  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Open by default: starting from a suggestion is the quickest way to an event (2026-11-09).
  const [showSuggested, setShowSuggested] = useState(true);
  const { toast, notify } = useToast();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await getEventLibraryAction(project.id).catch(() => null);
    setRefreshing(false);
    setRefreshFailed(!result?.ok);
    if (result?.ok) {
      setLibrary(result.data);
      setNow(Date.now());
    }
  }, [project.id]);

  const homepage = `${project.protocol === "HTTP" ? "http" : "https"}://${project.domain}/`;
  const installHref = `${routes.projects.detail(project.id)}?view=pixelSetup`;
  const canManage = library ? can(library.role, "events.manage") : false;
  const events = library?.events ?? [];
  const suggestions = suggestedEvents(events);
  const failed = load === "error" && !library;
  const loading = load === "loading" && !library;

  const create = (form: EventForm = blankForm(homepage)) =>
    setDialog({ kind: "form", event: null, form });
  const fromTemplate = (template: EventTemplate) => create(formFromTemplate(homepage, template));
  const edit = (event: LibraryEvent) =>
    setDialog({
      kind: "form",
      event,
      form: event.id ? formFromEvent(homepage, event) : formFromReceived(homepage, event.name),
    });

  return (
    <div aria-busy={loading || refreshing} className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2.5">
        {returnTo ? (
          <Link
            href={returnTo}
            className={cn(crumb, "inline-flex w-fit items-center gap-1 text-[13px]")}
          >
            <ArrowLeftIcon size={14} />
            Back to experiment
          </Link>
        ) : projects ? (
          <ProjectSwitcher projects={projects} current={project.id} />
        ) : (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-[#6B7280]"
          >
            <Link href={routes.projects.list} className={crumb}>
              Projects
            </Link>
            <ChevronRightIcon size={14} stroke="#9CA3AF" className="flex-[0_0_14px]" />
            <Link href={routes.projects.detail(project.id)} className={cn(crumb, "truncate")}>
              {project.name}
            </Link>
            <ChevronRightIcon size={14} stroke="#9CA3AF" className="flex-[0_0_14px]" />
            <span aria-current="page" className="font-medium text-[#111827]">
              Events
            </span>
          </nav>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <ProjectAvatar
              id={project.id}
              initial={project.initial}
              color={project.color}
              ink={project.ink}
              className="size-11 flex-[0_0_44px] rounded-xl text-[16px] font-bold max-[641px]:size-10 max-[641px]:basis-10"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#111827]">
                {projects ? "Metrics" : `${project.name} events`}
              </h1>
              <p className="m-0 text-[14px] leading-5 text-pretty text-[#4B5563]">
                Actions visitors take on your site, ready to use as experiment goals.
              </p>
            </div>
          </div>
          <div className="flex gap-2 max-[641px]:w-full max-[641px]:[&>*]:h-11 max-[641px]:[&>*]:flex-auto">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || loading}
              className={btn.secondary}
            >
              {refreshing ? <Spinner size={14} /> : <RefreshIcon />}
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            {/* Viewers read the library; they get nothing that would change it. */}
            {canManage ? (
              <button type="button" onClick={() => create()} className={btn.primary}>
                <PlusIcon size={16} />
                Create event
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {refreshFailed && !failed ? (
        <p
          role="alert"
          className="m-0 flex items-start gap-2 rounded-lg bg-[#FEF2F2] px-3 py-2.5 text-[13px] leading-[19px] text-[#B91C1C]"
        >
          <AlertCircleIcon size={15} className="mt-0.5 flex-none" />
          <span>We couldn’t refresh your events. What’s shown may be out of date.</span>
        </p>
      ) : null}

      <section aria-label="Event Library" className={card}>
        {failed ? (
          <LoadError busy={refreshing} onRetry={() => void refresh()} />
        ) : !loading && events.length === 0 ? (
          <Empty canManage={canManage} onCreate={() => create()}>
            {canManage ? <SuggestionGrid items={suggestions} onPick={fromTemplate} /> : null}
          </Empty>
        ) : (
          <div role="table" aria-label="Events">
            <div role="rowgroup" className="max-[1241px]:hidden">
              <div
                role="row"
                className={cn(
                  GRID,
                  "min-h-[38px] rounded-t-[11px] bg-[#FAFBFC] px-4 py-1.5 text-[12px] leading-4 font-medium text-[#6B7280]",
                )}
              >
                <span role="columnheader">Event</span>
                <span role="columnheader">Tracking</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Received</span>
                <span role="columnheader">Last received</span>
                <span role="columnheader">Used in</span>
                <span role="columnheader" className="text-right">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {loading
                ? [0, 1, 2].map((row) => <SkeletonRow key={row} />)
                : events.map((event) => (
                    <EventRow
                      key={event.id ?? `received:${event.name}`}
                      event={event}
                      now={now}
                      canManage={canManage}
                      onEdit={() => edit(event)}
                      onDelete={() => {
                        if (event.id) setDialog({ kind: "delete", event: event as SavedEvent });
                      }}
                    />
                  ))}
            </div>
          </div>
        )}
      </section>

      {!loading && events.length > 0 ? (
        <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
          Inactive means nothing was received in the last {EVENT_ACTIVE_WINDOW_LABEL}.
        </p>
      ) : null}

      {canManage && events.length > 0 && suggestions.length > 0 ? (
        <section
          aria-labelledby="rt-suggested-title"
          className={cn(card, "flex flex-col gap-4 border-[#B3DBFF] bg-[#F7FBFF] p-5")}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2
                id="rt-suggested-title"
                className="m-0 flex items-center gap-2 text-[16px] leading-6 font-semibold text-[#111827]"
              >
                Suggested events
                <span className="inline-flex h-5 items-center rounded-md bg-[#E6F4FF] px-1.5 text-[12px] font-semibold text-[#0060AD]">
                  {suggestions.length}
                </span>
              </h2>
              <p className="m-0 text-[13px] leading-[19px] text-[#4B5563]">
                Common events, ready to set up. Pick one to start from it.
              </p>
            </div>
            <button
              type="button"
              aria-expanded={showSuggested}
              onClick={() => setShowSuggested((open) => !open)}
              className={cn(btn.secondary, "h-8 gap-1.5 px-3")}
            >
              <ChevronDownIcon
                size={14}
                className={cn("transition-transform", !showSuggested && "-rotate-90")}
              />
              {showSuggested ? "Hide" : "Show"}
            </button>
          </div>
          {showSuggested ? <SuggestionGrid items={suggestions} onPick={fromTemplate} /> : null}
        </section>
      ) : null}

      {dialog?.kind === "form" ? (
        <EventDialog
          websiteId={project.id}
          domain={project.domain}
          installHref={installHref}
          event={dialog.event}
          initial={dialog.form}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
          onReturn={returnTo ? (id) => router.push(withGoalEvent(returnTo, id)) : undefined}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteEventDialog
          event={dialog.event}
          websiteId={project.id}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            notify(`${dialog.event.name} deleted`, "Routely has stopped listening for it.");
            void refresh();
          }}
        />
      ) : null}
      <ToastHost toast={toast} />
    </div>
  );
}

/** The Metrics page's project switcher: each project's library is its own URL. */
function ProjectSwitcher({ projects, current }: { projects: ProjectChoice[]; current: string }) {
  const router = useRouter();
  return (
    <label className="flex w-fit max-w-full items-center gap-2 text-[13px] leading-[18px] font-medium text-[#4B5563]">
      Project
      <select
        value={current}
        onChange={(e) => router.push(routes.metrics.project(e.target.value))}
        className={cn(
          "h-9 max-w-[280px] min-w-0 cursor-pointer truncate rounded-lg border border-[#E5E7EB] bg-white pr-8 pl-3 text-[14px] font-medium text-[#111827]",
          focusRing,
        )}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const crumb = cn(
  "font-medium whitespace-nowrap text-[#4B5563] no-underline hover:text-[#111827]",
  focusRing,
);

function EventRow({
  event,
  now,
  canManage,
  onEdit,
  onDelete,
}: {
  event: LibraryEvent;
  now: number;
  canManage: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const received = event.id === null;
  const { status } = event;

  return (
    <div role="row" className={cn(ROW, "hover:bg-[#FAFBFC]")}>
      <div role="cell" className={cn("flex min-w-0 flex-col gap-0.5", AREA.name)}>
        <span
          className={cn(
            // Not `mono`: `cn` reads its arbitrary font as a weight, and `font-semibold` would drop it.
            "font-mono text-[13px] leading-[19px] font-semibold [overflow-wrap:anywhere] text-[#111827]",
          )}
        >
          {event.name}
        </span>
        {event.category || event.description ? (
          <span className="text-[12px] leading-[17px] [overflow-wrap:anywhere] text-[#6B7280]">
            {[event.category, event.description].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>

      <div role="cell" className={cn("flex min-w-0 flex-col", AREA.method)}>
        <span className={cellLabel}>Tracking</span>
        <span className={cellText}>
          {event.method ? METHOD_LABELS[event.method] : "Not set up"}
        </span>
        {/* A code event is always stored with the pixel, so GTM here is a click or form tag. */}
        {(event.method === "FORM" && event.formSuccess) || event.install === "GTM" ? (
          <span className="text-[12px] leading-[17px] text-[#6B7280]">
            {[
              event.method === "FORM" && event.formSuccess
                ? FORM_SUCCESS_LABELS[event.formSuccess]
                : null,
              event.install === "GTM" ? "Google Tag Manager" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </div>

      <div role="cell" className={cn("flex min-w-0 flex-col items-start", AREA.status)}>
        <span className={cellLabel}>Status</span>
        {received ? (
          <StatusPill tone={TONES.blue}>Received · Not set up</StatusPill>
        ) : (
          <span title={status.note || undefined}>
            <StatusPill tone={TONE[status.tone]}>{status.label}</StatusPill>
            {status.note ? <span className="sr-only">. {status.note}</span> : null}
          </span>
        )}
      </div>

      <div role="cell" className={cn("flex flex-col", AREA.total)}>
        <span className={cellLabel}>Received</span>
        <span className={cellText}>{event.total.toLocaleString("en-US")}</span>
      </div>

      <div role="cell" className={cn("flex flex-col", AREA.last)}>
        <span className={cellLabel}>Last received</span>
        <span className={cellText}>
          {event.lastReceivedAt
            ? relativeTime(new Date(event.lastReceivedAt), new Date(now))
            : "Never"}
        </span>
      </div>

      <div role="cell" className={cn("flex min-w-0 flex-col", AREA.used)}>
        <span className={cellLabel}>Used in</span>
        <Usage usage={event.usage} />
      </div>

      <div
        role="cell"
        className={cn("flex items-center justify-end gap-1 max-[641px]:justify-start", AREA.act)}
      >
        {!canManage ? null : received ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Set up ${event.name}`}
            className={cn(btn.secondary, "h-8 px-2.5 max-[641px]:h-11 max-[641px]:flex-auto")}
          >
            Set up
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${event.name}`}
              className={cn(btn.icon, "max-[641px]:size-11")}
            >
              <PencilIcon size={15} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${event.name}`}
              className={cn(btn.icon, "max-[641px]:size-11")}
            >
              <TrashIcon size={15} />
            </button>
          </>
        )}
      </div>

      {status.state === "config_error" || event.unverifiedSubmission ? (
        <div role="cell" className="col-span-full mt-2 flex flex-col gap-1.5">
          {status.state === "config_error" ? (
            <RowNote tone="fail">
              {status.note}
              {event.issueUrl ? ` Seen on ${shortUrl(event.issueUrl)}.` : ""}
            </RowNote>
          ) : null}
          {event.unverifiedSubmission ? (
            <RowNote tone="warn">
              Successful submission not verified: this counts submits the browser sent, not ones
              your server accepted.
            </RowNote>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RowNote({ tone, children }: { tone: "fail" | "warn"; children: ReactNode }) {
  const Icon = tone === "fail" ? AlertCircleIcon : WarningIcon;
  return (
    <p
      className={cn(
        "m-0 flex items-start gap-1.5 text-[12px] leading-[17px] [overflow-wrap:anywhere]",
        tone === "fail" ? "text-[#B91C1C]" : "text-[#92400E]",
      )}
    >
      <Icon size={13} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

const usageLink = cn(
  "text-[13px] leading-[19px] font-medium text-[#0060AD] no-underline hover:underline",
  focusRing,
);

function Usage({ usage }: { usage: readonly EventUsage[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  if (usage.length === 0) return <span className={cn(cellText, "text-[#6B7280]")}>Not used</span>;
  const [only] = usage;
  if (usage.length === 1 && only) {
    return (
      <Link href={routes.experiments.detail(only.id)} title={only.name} className={usageLink}>
        1 experiment
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(usageLink, "cursor-pointer border-0 bg-transparent p-0")}
      >
        {usage.length} experiments
      </button>
      <PopoverMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={trigger}
        label="Experiments using this event"
        align="left"
        className="w-[260px]"
      >
        {usage.map((experiment) => (
          <Link
            key={experiment.id}
            role="menuitem"
            href={routes.experiments.detail(experiment.id)}
            className={menuItem}
          >
            <span className="truncate">{experiment.name}</span>
          </Link>
        ))}
      </PopoverMenu>
    </div>
  );
}

function SuggestionGrid({
  items,
  onPick,
}: {
  items: readonly EventTemplate[];
  onPick(template: EventTemplate): void;
}) {
  return (
    <div className="grid w-full grid-cols-3 gap-2.5 text-left max-[1101px]:grid-cols-2 max-[641px]:grid-cols-1">
      {items.map((template) => (
        <button
          key={template.name}
          type="button"
          onClick={() => onPick(template)}
          className={cn(
            "group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-left hover:border-[#B3DBFF] hover:bg-[#F0F7FF]",
            focusRing,
          )}
        >
          <span className="flex min-w-0 flex-auto flex-col gap-0.5">
            <span className="text-[13px] leading-[19px] font-semibold text-[#111827]">
              {template.label}
            </span>
            <span className="text-[12px] leading-[17px] text-[#6B7280]">
              {METHOD_LABELS[template.method]} · {template.category}
            </span>
          </span>
          <span
            aria-hidden
            className="inline-flex size-7 flex-none items-center justify-center rounded-md bg-[#E6F4FF] text-[#0060AD] group-hover:bg-[#0070C9] group-hover:text-white"
          >
            <PlusIcon size={14} />
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({
  canManage,
  onCreate,
  children,
}: {
  canManage: boolean;
  onCreate(): void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-12 text-center max-[641px]:px-4">
      <div className="flex max-w-[480px] flex-col gap-1">
        <h2 className="m-0 text-[16px] leading-6 font-semibold text-[#111827]">No events yet</h2>
        <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
          {canManage
            ? "An event is something a visitor does on your site, like clicking a button or sending a form. Start from a suggestion, or create your own."
            : "An event is something a visitor does on your site. An Editor can set them up here."}
        </p>
      </div>
      {canManage ? (
        <button
          type="button"
          onClick={onCreate}
          className={cn(btn.primary, "max-[641px]:h-11 max-[641px]:w-full")}
        >
          <PlusIcon size={16} />
          Create event
        </button>
      ) : null}
      {canManage ? (
        <div className="flex w-full flex-col gap-2.5">
          <h3 className="m-0 text-left text-[13px] leading-[18px] font-semibold text-[#374151]">
            Suggested events
          </h3>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function LoadError({ busy, onRetry }: { busy: boolean; onRetry(): void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3.5 px-6 py-14 text-center">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]"
      >
        <AlertCircleIcon size={24} />
      </span>
      <div className="flex max-w-[440px] flex-col gap-1">
        <h2 className="m-0 text-[16px] leading-6 font-semibold text-[#111827]">
          We couldn’t load your events
        </h2>
        <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
          Something went wrong on our side. Check your connection and try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className={cn(btn.primary, "shadow-none")}
      >
        {busy ? <Spinner size={14} /> : <RefreshIcon />}
        Try again
      </button>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div role="row" aria-hidden className={ROW}>
      <div className={cn("flex flex-col gap-1.5", AREA.name)}>
        <Skeleton className="h-3.5 w-[150px]" />
        <Skeleton className="h-3 w-[90px]" />
      </div>
      <Skeleton className={cn("h-3.5 w-[90px]", AREA.method)} />
      <Skeleton className={cn("h-6 w-[150px]", AREA.status)} />
      <Skeleton className={cn("h-3.5 w-10", AREA.total)} />
      <Skeleton className={cn("h-3.5 w-14", AREA.last)} />
      <Skeleton className={cn("h-3.5 w-16", AREA.used)} />
      <span className={AREA.act} />
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="15"
      height="15"
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
  );
}
