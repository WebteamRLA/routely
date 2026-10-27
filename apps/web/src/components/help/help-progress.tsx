"use client";

import { useTransition } from "react";
import Link from "next/link";

import { CheckIcon, Spinner } from "@/components/rt/icons";
import { btn, card } from "@/components/rt/styles";
import type { Checklist } from "@/lib/onboarding";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { showChecklistAction } from "@/server/actions/onboarding.actions";

/**
 * The top of `/help`: the workspace's "Getting started" progress — resume the next step, or bring
 * a hidden checklist back to the Dashboard. Nothing for a Viewer, who can't act on any step.
 */
export function HelpProgress({
  checklist,
  hidden,
  onDashboard,
}: {
  checklist: Checklist | null;
  hidden: boolean;
  /** The checklist is currently showing on the Dashboard. */
  onDashboard: boolean;
}) {
  const [showing, startShow] = useTransition();
  if (!checklist) return null;
  const next = checklist.steps.find((s) => s.key === checklist.current) ?? null;
  const nextAction = next?.actions.find((a) => a.kind === "link") ?? null;

  return (
    <section
      aria-labelledby="rt-help-progress"
      className={cn(card, "flex flex-wrap items-center gap-4 px-5 py-4")}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-10 flex-none items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          checklist.complete ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#E6F4FF] text-[#0060AD]",
        )}
      >
        {checklist.complete ? <CheckIcon size={18} strokeWidth={2.6} /> : checklist.doneCount}
      </span>
      <div className="flex min-w-0 flex-auto flex-col gap-0.5">
        <h2 id="rt-help-progress" className="m-0 text-sm leading-5 font-semibold text-[#111827]">
          {checklist.complete
            ? "You’ve completed Getting started"
            : `Getting started: ${checklist.doneCount} of ${checklist.steps.length} done`}
        </h2>
        <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
          {checklist.complete ? "Your first experiment is set up." : `Next: ${next?.title ?? ""}.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!checklist.complete && nextAction && nextAction.kind === "link" ? (
          <Link
            href={nextAction.href}
            className={cn(
              btn.primary,
              "h-auto min-h-9 py-2 text-left whitespace-normal no-underline",
            )}
          >
            {nextAction.label}
          </Link>
        ) : null}
        {!checklist.complete && hidden ? (
          <button
            type="button"
            disabled={showing}
            onClick={() => startShow(() => showChecklistAction())}
            className={btn.secondary}
          >
            {showing ? <Spinner size={13} /> : null}
            Show on Dashboard
          </button>
        ) : onDashboard ? (
          <Link href={routes.dashboard} className={cn(btn.secondary, "no-underline")}>
            Open checklist
          </Link>
        ) : null}
      </div>
    </section>
  );
}
