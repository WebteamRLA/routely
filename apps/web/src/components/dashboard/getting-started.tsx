"use client";

import { useTransition } from "react";
import Link from "next/link";

import { CheckIcon, ChevronRightIcon, Spinner } from "@/components/rt/icons";
import { btn, card, focusRing } from "@/components/rt/styles";
import type { Checklist, ChecklistStep, SetupProject, StepAction } from "@/lib/onboarding";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { hideChecklistAction, skipSheetsStepAction } from "@/server/actions/onboarding.actions";

/**
 * "Getting started" on the Dashboard (not in the design; built in its card style). Each step is
 * read from the workspace's real state (`lib/onboarding.ts`), so it ticks itself off as the work is
 * done — by anyone in the workspace — and an unfinished step offers the exact action that finishes
 * it: the project missing its tracking code, the draft to resume. Hiding it is per browser; Help &
 * Guides brings it back.
 */
/** The dialogs a step's button opens on the Dashboard. */
interface Openers {
  /** Opens the Dashboard's "Add your first project" dialog; null when the reader can't add one. */
  onAddProject: (() => void) | null;
  /** Opens the tracking-code dialog for a project. */
  onPixel: (project: SetupProject) => void;
  /** Opens the Google Sheets setup dialog; null when it couldn't be loaded. */
  onSheets: (() => void) | null;
}

export function GettingStarted({
  checklist,
  ...openers
}: Openers & {
  checklist: Checklist;
}) {
  const [hiding, startHide] = useTransition();
  const { steps, doneCount, current } = checklist;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section aria-labelledby="rt-gs-title" className={cn(card, "flex flex-col")}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EEF0F3] px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id="rt-gs-title"
            className="m-0 text-base leading-6 font-semibold tracking-[-0.01em] text-[#111827]"
          >
            Getting started
          </h2>
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
            Run your first test. Steps tick off as you go.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={routes.help.index}
            className={cn(
              "text-[13px] font-medium text-[#0060AD] no-underline hover:underline",
              focusRing,
            )}
          >
            Help &amp; Guides
          </Link>
          <button
            type="button"
            disabled={hiding}
            onClick={() => startHide(() => hideChecklistAction())}
            className={cn(btn.link, "h-8 text-[13px]")}
          >
            {hiding ? <Spinner size={13} /> : null}
            Hide
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 pt-4">
        <div
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          className="h-2 flex-auto overflow-hidden rounded-full bg-[#F3F4F6]"
        >
          <span
            className="block h-full rounded-full bg-[#16A34A] transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[13px] font-medium whitespace-nowrap text-[#374151] tabular-nums">
          {doneCount} of {steps.length} done
        </span>
      </div>

      <ol className="m-0 flex list-none flex-col p-0 px-2 py-2">
        {steps.map((step, i) => (
          <Step
            key={step.key}
            step={step}
            n={i + 1}
            current={step.key === current}
            openers={openers}
          />
        ))}
      </ol>
    </section>
  );
}

function Step({
  step,
  n,
  current,
  openers,
}: {
  step: ChecklistStep;
  n: number;
  current: boolean;
  openers: Openers;
}) {
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={cn("flex items-start gap-3 rounded-lg px-3 py-3", current && "bg-[#F0F7FF]")}
    >
      <span
        aria-hidden
        className={cn(
          "mt-px inline-flex size-6 flex-[0_0_24px] items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          step.done
            ? "bg-[#DCFCE7] text-[#166534]"
            : step.skipped
              ? "bg-[#F3F4F6] text-[#9CA3AF]"
              : current
                ? "bg-[#0070C9] text-white"
                : "border border-[#D1D5DB] bg-white text-[#6B7280]",
        )}
      >
        {step.done ? <CheckIcon size={14} strokeWidth={2.6} /> : step.skipped ? "–" : n}
      </span>
      <div className="flex min-w-0 flex-auto flex-col gap-1">
        <span
          className={cn(
            "text-sm leading-5 font-semibold",
            step.done || step.skipped ? "text-[#6B7280]" : "text-[#111827]",
          )}
        >
          {step.title}
          {step.skipped ? (
            <span className="ml-2 text-xs font-medium text-[#9CA3AF]">Skipped</span>
          ) : null}
          <span className="sr-only">{step.done ? " (done)" : current ? " (next)" : ""}</span>
        </span>
        {!step.done && !step.skipped ? (
          <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#4B5563]">{step.text}</p>
        ) : null}
        {!step.done && !step.skipped ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {step.actions.map((action, i) => (
              <ActionButton
                key={action.label}
                action={action}
                primary={current && i === 0}
                openers={openers}
              />
            ))}
            <Link
              href={step.guide.href}
              className={cn(
                "inline-flex h-8 items-center gap-1 px-1 text-[13px] font-medium text-[#0060AD] no-underline hover:underline",
                focusRing,
              )}
            >
              {step.guide.label}
              <ChevronRightIcon size={14} />
            </Link>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActionButton({
  action,
  primary,
  openers,
}: {
  action: StepAction;
  primary: boolean;
  openers: Openers;
}) {
  // Labels name the draft or experiment, so they wrap on a phone rather than overflow the card.
  const cls = cn(
    primary ? btn.primary : btn.secondary,
    "h-auto min-h-8 py-1.5 text-left text-[13px] whitespace-normal",
  );
  if (action.kind === "skip") return <SkipButton label={action.label} />;
  if (action.kind === "link") {
    return (
      <Link href={action.href} className={cn(cls, "no-underline")}>
        {action.label}
      </Link>
    );
  }
  // The rest open a dialog on the Dashboard.
  const open =
    action.kind === "addProject"
      ? openers.onAddProject
      : action.kind === "pixel"
        ? () => openers.onPixel(action.project)
        : openers.onSheets;
  return open ? (
    <button type="button" onClick={open} className={cls}>
      {action.label}
    </button>
  ) : null;
}

/** Passes over the optional step on this browser; the page re-renders with it marked skipped. */
function SkipButton({ label }: { label: string }) {
  const [skipping, startSkip] = useTransition();
  return (
    <button
      type="button"
      disabled={skipping}
      onClick={() => startSkip(() => skipSheetsStepAction())}
      className={cn(btn.link, "h-8 text-[13px] text-[#4B5563]")}
    >
      {skipping ? <Spinner size={13} /> : null}
      {label}
    </button>
  );
}
