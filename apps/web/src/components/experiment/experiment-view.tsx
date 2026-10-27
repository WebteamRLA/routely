"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { EditPausedDialog } from "@/components/experiment/edit-paused-dialog";
import { CAPTION, CARD, H2, ResultsPanel } from "@/components/experiment/results-panel";
import { ShareDialog } from "@/components/experiment/share-dialog";
import { WinnerDialog } from "@/components/experiment/winner-dialog";
import { useViewerTimeZone } from "@/components/experiment/use-viewer-time-zone";
import {
  ChartIcon,
  PauseIcon,
  PlayIcon,
} from "@/components/experiments-list/experiment-type-icons";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  KebabIcon,
  Spinner,
  Svg,
  WarningIcon,
} from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { PopoverMenu } from "@/components/rt/popover-menu";
import { focusRing, menuItem } from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import { CHECK_TONES, type ExperimentMode, type ExperimentModel } from "@/lib/experiment-model";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  checkTrackingAction,
  pauseExperimentAction,
  resumeExperimentAction,
} from "@/server/actions/experiment.actions";

type Tab = "results" | "review";
type Dialog = "pause" | "resume";

const BTN_OUTLINE = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-[13px] font-medium whitespace-nowrap text-[#374151] no-underline hover:enabled:bg-[#F9FAFB] disabled:cursor-default disabled:opacity-45 max-[641px]:h-11 ${focusRing}`;
const BTN_PRIMARY = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#0070C9] px-4 text-[13px] whitespace-nowrap text-white hover:enabled:brightness-[.8] disabled:cursor-default disabled:opacity-45 max-[641px]:h-11 ${focusRing}`;

const DIALOG_COPY: Record<
  Dialog,
  {
    title: (name: string) => string;
    button: string;
    busy: string;
    doneTitle: (name: string) => string;
    doneNote: string;
    failTitle: string;
  }
> = {
  pause: {
    title: (name) => `Pause “${name}”?`,
    button: "Pause experiment",
    busy: "Pausing…",
    doneTitle: (name) => `“${name}” is paused`,
    doneNote: "Visitors see the original page. Results so far are kept.",
    failTitle: "Couldn’t pause the experiment",
  },
  resume: {
    title: (name) => `Resume “${name}”?`,
    button: "Resume experiment",
    busy: "Resuming…",
    doneTitle: (name) => `“${name}” is running again`,
    doneNote: "Visitors are seeing the versions again.",
    failTitle: "Couldn’t resume the experiment",
  },
};

const PAUSE_BODY =
  "Visitors will see the original page while it’s paused. Results collected so far are kept, and you can resume at any time.";

/**
 * One experiment's Results and Review tabs, with pause, resume and end.
 *
 * Everything shown comes from the server's model (`lib/experiment-model.ts`); actions call the
 * lifecycle Server Actions and then refresh, so the page re-renders from the database — "Paused
 * just now", the new activity row and all. `canEdit` false (a Viewer) renders no control that
 * changes anything; the actions refuse them server-side regardless.
 */
export function ExperimentView({
  experimentId,
  model: m,
  mode,
  canEdit,
  canShare,
  shareUrl,
  timeZone,
}: {
  experimentId: string;
  model: ExperimentModel;
  mode: ExperimentMode;
  canEdit: boolean;
  canShare: boolean;
  shareUrl: string | null;
  /** The zone the server formatted dates in. */
  timeZone: string;
}) {
  useViewerTimeZone(timeZone);
  const router = useRouter();
  const allowed = (d: Dialog | "end") =>
    canEdit &&
    (d === "pause" ? m.header.canPause : d === "resume" ? m.header.canResume : m.header.canEnd);

  const [tab, setTab] = useState<Tab>(
    mode === "review" || mode === "resume" ? "review" : "results",
  );
  const [modal, setModal] = useState<Dialog | null>(
    (mode === "pause" || mode === "resume") && allowed(mode) ? mode : null,
  );
  // Ending always goes through "choose a winner" (with "End without choosing" inside); an ended
  // experiment opens the same dialog to record or change its winner.
  const [winnerOpen, setWinnerOpen] = useState(mode === "end" && allowed("end"));
  const decided = m.winnerChoice.currentKey !== null;
  const canChooseWinner = canEdit && m.status === "completed";
  const [shareOpen, setShareOpen] = useState(mode === "share" && canShare);
  // D7: a paused experiment's name and traffic share can change. Not in the design.
  const canEditPaused = canEdit && m.header.canResume;
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const { toast, notify } = useToast();
  const kebabRef = useRef<HTMLButtonElement>(null);
  // Keep the last dialog's copy while it animates closed.
  const [lastDialog, setLastDialog] = useState<Dialog>(modal ?? "pause");
  if (modal && modal !== lastDialog) setLastDialog(modal);
  const dialog = modal ?? lastDialog;
  const copy = DIALOG_COPY[dialog];
  const review = m.review;

  const confirm = async () => {
    if (busy || !modal) return;
    const which = modal;
    setBusy(true);
    const result =
      which === "pause"
        ? await pauseExperimentAction(experimentId)
        : await resumeExperimentAction(experimentId);
    setBusy(false);
    setModal(null);
    if (!result.ok) {
      notify(DIALOG_COPY[which].failTitle, result.message);
      return;
    }
    notify(DIALOG_COPY[which].doneTitle(m.name), DIALOG_COPY[which].doneNote);
    router.refresh();
  };

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    const result = await checkTrackingAction(experimentId, { force: true });
    setChecking(false);
    if (!result.ok) {
      notify("Couldn’t check tracking", result.message);
      return;
    }
    const failing = result.data.checks.filter((c) => c.result !== "OK").length;
    notify(
      failing === 0 ? "Tracking checked" : "Tracking checked — issues remain",
      failing === 0
        ? "Every page loaded with the Routely code."
        : `${failing} ${failing === 1 ? "page still needs" : "pages still need"} attention.`,
    );
    router.refresh();
  };

  const menuItems = [
    ...(allowed("end")
      ? [
          {
            key: "end",
            label: "End and choose winner",
            icon: <StopIcon />,
            act: () => setWinnerOpen(true),
          },
        ]
      : []),
    ...(canChooseWinner && decided
      ? [
          {
            key: "winner",
            label: "Change winner",
            icon: <TrophyIcon />,
            act: () => setWinnerOpen(true),
          },
        ]
      : []),
    ...(canShare
      ? [
          {
            key: "share",
            label: "Share results",
            icon: <ShareIcon />,
            act: () => setShareOpen(true),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5 leading-[1.45]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-[#6B7280]"
          >
            <Link
              href={routes.dashboard}
              className={cn(
                "font-medium text-[#4B5563] no-underline hover:text-[#111827]",
                focusRing,
              )}
            >
              Dashboard
            </Link>
            <ChevronRightIcon size={14} className="flex-[0_0_14px] text-[#9CA3AF]" />
            <span aria-current="page" className="truncate font-medium text-[#111827]">
              {m.name}
            </span>
          </nav>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#111827]">
              {m.name}
            </h1>
            <span
              aria-live="polite"
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs leading-[1.45] font-semibold whitespace-nowrap"
              style={{ background: m.header.badge.bg, color: m.header.badge.fg }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: m.header.badge.dot }}
              />
              {m.header.badge.label}
            </span>
          </div>
          <p className="m-0 text-sm leading-[22px] [overflow-wrap:anywhere] text-[#4B5563]">
            {m.header.sub}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 max-[641px]:w-full max-[641px]:[&>button]:flex-auto">
          {allowed("pause") ? (
            <button type="button" onClick={() => setModal("pause")} className={BTN_OUTLINE}>
              <PauseIcon />
              Pause experiment
            </button>
          ) : null}
          {allowed("resume") ? (
            <button
              type="button"
              onClick={() => setModal("resume")}
              className={cn(BTN_PRIMARY, "font-semibold")}
            >
              <PlayIcon />
              Resume experiment
            </button>
          ) : null}
          {canChooseWinner && !decided ? (
            <button
              type="button"
              onClick={() => setWinnerOpen(true)}
              className={cn(BTN_PRIMARY, "font-semibold")}
            >
              <TrophyIcon />
              Choose winner
            </button>
          ) : null}
          {menuItems.length > 0 ? (
            <div className="relative max-[641px]:flex-[0_0_44px]">
              <button
                ref={kebabRef}
                type="button"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className={cn(BTN_OUTLINE, "w-9 px-0 max-[641px]:w-11")}
              >
                <KebabIcon />
              </button>
              <PopoverMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                triggerRef={kebabRef}
                label="More actions"
                className="top-[calc(100%+6px)] min-w-[200px]"
              >
                {menuItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      item.act();
                    }}
                    className={cn(menuItem, "h-[34px] whitespace-nowrap")}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </PopoverMenu>
            </div>
          ) : null}
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Experiment views"
        className="inline-flex gap-0.5 self-start rounded-lg bg-[#F1F3F5] p-[3px] max-[641px]:w-full"
      >
        {(
          [
            ["results", "Results"],
            ["review", "Review"],
          ] as const
        ).map(([id, label]) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`exp-tab-${id}`}
              aria-selected={on}
              aria-controls="exp-panel"
              onClick={() => setTab(id)}
              className={cn(
                "h-[34px] cursor-pointer rounded-lg border-0 px-[18px] text-[13px] font-semibold whitespace-nowrap hover:text-[#111827] max-[641px]:flex-[1_1_0]",
                on
                  ? "bg-white text-[#111827] shadow-[0_1px_2px_#11182714]"
                  : "bg-transparent text-[#4B5563]",
                focusRing,
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        id="exp-panel"
        role="tabpanel"
        aria-labelledby={`exp-tab-${tab}`}
        className="flex min-w-0 flex-col gap-5"
      >
        {tab === "results" || !review ? (
          <ResultsPanel
            m={m}
            helpLinks
            onChooseWinner={
              allowed("end") || canChooseWinner ? () => setWinnerOpen(true) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,65fr)_minmax(0,35fr)] items-start gap-6 max-[961px]:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5">
              <section
                aria-labelledby="exp-health"
                className="flex min-w-0 flex-col rounded-xl border bg-white"
                style={{ borderColor: review.health.border }}
              >
                <div
                  className="flex items-start gap-3 rounded-t-[11px] border-b px-5 py-[18px]"
                  style={{ background: review.health.bg, borderColor: review.health.border }}
                >
                  <span
                    aria-hidden
                    className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg"
                    style={{ background: review.health.iconBg, color: review.health.fg }}
                  >
                    {review.health.tone === "ok" ? (
                      <CheckIcon strokeWidth={2.4} />
                    ) : review.health.tone === "warn" ? (
                      <WarningIcon strokeWidth={1.8} />
                    ) : review.health.tone === "fail" ? (
                      <AlertCircleIcon strokeWidth={1.8} />
                    ) : (
                      <InfoIcon strokeWidth={1.8} />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <h2
                      id="exp-health"
                      className="m-0 text-base leading-6 font-bold"
                      style={{ color: review.health.ink }}
                    >
                      {review.health.title}
                    </h2>
                    <p className="m-0 text-sm leading-[21px] text-pretty text-[#374151]">
                      {review.health.text}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col px-5 pt-1.5 pb-2">
                  <div className="flex items-center justify-between gap-3 pt-3 pb-1">
                    <h3 className="m-0 text-sm leading-5 font-semibold text-[#111827]">
                      Launch readiness &amp; issues
                    </h3>
                    <span className="text-[13px] text-[#6B7280]">{review.health.summary}</span>
                  </div>
                  <ul className="m-0 list-none p-0">
                    {review.checks.map((ck, i) => {
                      const t = CHECK_TONES[ck.tone];
                      return (
                        <li
                          key={ck.key}
                          className="flex items-start gap-3 border-t py-3.5"
                          style={{ borderColor: i === 0 ? "transparent" : "#EEF0F3" }}
                        >
                          <span
                            aria-hidden
                            className="mt-px inline-flex size-[22px] flex-[0_0_22px] items-center justify-center rounded-full"
                            style={{ background: t.iconBg, color: t.fg }}
                          >
                            <CheckToneIcon tone={ck.tone} />
                          </span>
                          <div className="flex min-w-0 flex-auto flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                              <span className="text-sm leading-5 font-semibold text-[#111827]">
                                {ck.title}
                              </span>
                              <span className="sr-only">({t.sr})</span>
                            </span>
                            <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#4B5563]">
                              {ck.text}
                            </span>
                            {ck.recheck && canEdit ? (
                              <button
                                type="button"
                                onClick={() => void recheck()}
                                disabled={checking}
                                className={cn(
                                  "mt-1 inline-flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-[#0070C9] hover:enabled:text-[#111827] disabled:cursor-default disabled:opacity-60",
                                  focusRing,
                                  "leading-[1.45]",
                                )}
                              >
                                {checking ? <Spinner size={13} /> : null}
                                {checking ? "Checking…" : "Check again →"}
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>

              <section aria-labelledby="exp-config" className={CARD}>
                <div className="flex flex-col gap-0.5 px-5 pt-[18px] pb-1.5">
                  <h2 id="exp-config" className={H2}>
                    Configuration
                  </h2>
                  {canEditPaused ? (
                    <p className={cn(CAPTION, "flex flex-wrap items-baseline gap-x-2")}>
                      {review.config.caption}
                      <button
                        type="button"
                        onClick={() => setEditOpen(true)}
                        className={cn(
                          "cursor-pointer border-0 bg-transparent p-0 text-[13px] leading-[19px] font-semibold text-[#0070C9] hover:text-[#111827]",
                          focusRing,
                        )}
                      >
                        Edit
                      </button>
                    </p>
                  ) : (
                    <p className={CAPTION}>{review.config.caption}</p>
                  )}
                </div>
                <div className="flex flex-col gap-3.5 px-5 pt-2 pb-5">
                  <dl className="m-0">
                    {review.config.rows.map((cr, i) => (
                      <div
                        key={cr.label}
                        className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 border-t py-[11px] max-[641px]:grid-cols-1 max-[641px]:gap-y-0.5"
                        style={{ borderColor: i === 0 ? "transparent" : "#EEF0F3" }}
                      >
                        <dt className="text-[13px] leading-5 text-[#6B7280]">{cr.label}</dt>
                        <dd className="m-0 text-sm leading-5 [overflow-wrap:anywhere] text-[#111827]">
                          {cr.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex flex-col gap-2">
                    <h3 className="m-0 text-sm leading-5 font-semibold text-[#111827]">Versions</h3>
                    {review.config.versions.map((vv) => (
                      <div
                        key={vv.key}
                        className="flex items-start gap-3 rounded-lg border border-[#EEF0F3] px-3.5 py-3"
                      >
                        <div className="flex min-w-0 flex-auto flex-col gap-[3px]">
                          <span className="flex justify-between gap-3">
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2 flex-[0_0_8px] rounded-full"
                                style={{ background: vv.color }}
                              />
                              <span className="text-sm leading-5 font-semibold text-[#111827]">
                                {vv.name}
                              </span>
                            </span>
                            <span className="text-[13px] leading-5 font-semibold whitespace-nowrap text-[#374151] tabular-nums">
                              {vv.pct} of traffic
                            </span>
                          </span>
                          {vv.lines.map((l, li) => (
                            <span
                              key={li}
                              className="text-[13px] leading-[19px] [overflow-wrap:anywhere] text-[#4B5563]"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <aside className="sticky top-6 flex min-w-0 flex-col gap-4 max-[1200px]:static">
              <section aria-labelledby="exp-glance" className={cn(CARD, "gap-3.5 px-5 py-[18px]")}>
                <h2 id="exp-glance" className={H2}>
                  At a glance
                </h2>
                <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3.5">
                  {review.glance.map((gl) => (
                    <div key={gl.label} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-xs leading-4 text-[#6B7280]">{gl.label}</dt>
                      <dd className="m-0 text-lg leading-[26px] font-semibold text-[#111827] tabular-nums">
                        {gl.value}
                      </dd>
                      <span className="text-xs leading-4 text-[#6B7280]">{gl.sub}</span>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={() => setTab("results")}
                  className={cn(BTN_OUTLINE, "w-full")}
                >
                  <ChartIcon />
                  View results
                </button>
              </section>
              <section aria-labelledby="exp-activity" className={cn(CARD, "gap-3 px-5 py-[18px]")}>
                <h2 id="exp-activity" className={H2}>
                  Activity
                </h2>
                <ol className="m-0 flex list-none flex-col p-0">
                  {review.events.map((ev, i) => {
                    const last = i === review.events.length - 1;
                    return (
                      <li key={ev.key} className="flex gap-3">
                        <span aria-hidden className="flex flex-[0_0_10px] flex-col items-center">
                          <span
                            className="mt-[5px] block size-2.5 rounded-full"
                            style={{
                              background: last ? "#0070C9" : "#D1D5DB",
                              boxShadow: `0 0 0 3px ${last ? "#E6F4FF" : "#F3F4F6"}`,
                            }}
                          />
                          <span
                            className="mt-1 block min-h-3.5 w-0.5 flex-auto"
                            style={{ background: last ? "transparent" : "#E5E7EB" }}
                          />
                        </span>
                        <div className="flex min-w-0 flex-col gap-px pb-3.5">
                          <span className="text-sm leading-5 font-medium text-[#111827]">
                            {ev.label}
                          </span>
                          <span className="text-[13px] leading-[18px] text-[#6B7280]">
                            {ev.when}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        onOpenChange={(o) => {
          if (!o) setModal(null);
        }}
        title={null}
        alert
        busy={busy}
        width={460}
        className="gap-[18px] p-6"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <AlertDialogPrimitive.Title className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
            {copy.title(m.name)}
          </AlertDialogPrimitive.Title>
          <p className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
            {dialog === "pause" ? PAUSE_BODY : m.resumeBody}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-[#EEF0F3] bg-[#FAFBFC] p-3.5">
          {(dialog === "pause" ? m.pauseFacts : m.resumeFacts).map((fc) => (
            <div key={fc.label} className="flex justify-between gap-3 text-[13px]">
              <span className="text-[#6B7280]">{fc.label}</span>
              <span className="text-right font-medium text-[#374151] tabular-nums">{fc.value}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-[641px]:w-full max-[641px]:[&>button]:flex-auto">
          <button
            type="button"
            onClick={() => setModal(null)}
            disabled={busy}
            className={BTN_OUTLINE}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={cn(BTN_PRIMARY, "font-medium")}
          >
            {busy ? <Spinner /> : null}
            {busy ? copy.busy : copy.button}
          </button>
        </div>
      </Modal>

      {canEditPaused ? (
        <EditPausedDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          experimentId={experimentId}
          name={m.name}
          include={m.include}
          notify={notify}
        />
      ) : null}

      {allowed("end") || canChooseWinner ? (
        <WinnerDialog
          open={winnerOpen}
          onOpenChange={setWinnerOpen}
          experimentId={experimentId}
          name={m.name}
          choice={m.winnerChoice}
          facts={m.endFacts}
          notify={notify}
        />
      ) : null}

      {canShare ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          experimentId={experimentId}
          shareUrl={shareUrl}
          notify={notify}
        />
      ) : null}

      <ToastHost toast={toast} />
    </div>
  );
}

function CheckToneIcon({ tone }: { tone: "ok" | "warn" | "fail" | "info" }) {
  const paths = {
    ok: ["M20 6 9 17l-5-5"],
    warn: ["M12 7v6", "M12 17v.5"],
    fail: ["M18 6 6 18", "m6 6 12 12"],
    info: ["M12 11v6", "M12 7v.5"],
  }[tone];
  return (
    <Svg size={13} strokeWidth={3}>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </Svg>
  );
}

function TrophyIcon() {
  return (
    <Svg size={16}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </Svg>
  );
}

function StopIcon() {
  return (
    <Svg size={16} strokeWidth={2}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}

function ShareIcon() {
  return (
    <Svg size={16} strokeWidth={2}>
      <path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </Svg>
  );
}
