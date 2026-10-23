"use client";

import { Dialog as DialogPrimitive } from "radix-ui";

import { CheckIcon, Spinner } from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { ACCENT, btn } from "@/components/rt/styles";
import type { LaunchSummary } from "@/lib/launch-rules";
import { launchInfo } from "@/lib/mock/project-dashboard";
import { cn } from "@/lib/utils";

/**
 * "Launch “Free shipping banner”?" — the arms, the audience and a ready-to-launch checklist.
 *
 * Presentational: the caller runs `launchExperimentAction(id)` from `onConfirm` and owns the
 * busy / error / toast state. The facts come from `experiment.launch` — `launchSummary()` from
 * `lib/launch-rules.ts`, the same rules the wizards and the server use — falling back to the
 * design's mock for its `?view=` states.
 */
export function LaunchDialog({
  experiment,
  busy,
  error,
  errorMessage,
  pixelWarning,
  onCancel,
  onConfirm,
}: {
  experiment: { id: string; name: string; launch?: LaunchSummary | null } | null;
  busy: boolean;
  error: boolean;
  /** A rule failure's own message (tracking missing, another test on the page…). Without one the
   * failure block shows the design's "something went wrong" copy. */
  errorMessage?: string | null;
  /** Non-blocking heads-up shown above the checklist, e.g. the pixel hasn't reported lately. */
  pixelWarning?: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const li = experiment ? (experiment.launch ?? launchInfo(experiment.id)) : null;
  const colors = ["#6B7280", ACCENT];
  const hasError = error && !busy;
  const facts = li
    ? [
        {
          label: "Visitors included",
          value: li.include === 100 ? "All visitors (100%)" : `${li.include}% of visitors`,
        },
        { label: "Targeting", value: li.targeting },
        { label: "Goal", value: `Page view · ${li.goal}` },
      ]
    : [];
  const checks = li
    ? [
        "Setup is complete — all 5 steps are filled in",
        li.changes,
        "Traffic split adds up to 100%",
        "Goal page is set and different from the tested page",
      ]
    : [];

  return (
    <Modal
      open={!!experiment}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={null}
      busy={busy}
      width={500}
      className="gap-[18px] p-6"
    >
      {experiment && li ? (
        <>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogPrimitive.Title className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
              Launch “{experiment.name}”?
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="m-0 text-[13px] leading-5 text-pretty [overflow-wrap:anywhere] text-[#6B7280]">
              Visitors to {li.page} will start seeing one of {li.arms.length} versions. The Control
              stays exactly as it is, and you can pause at any time.
            </DialogPrimitive.Description>
          </div>

          {hasError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-3"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#B91C1C"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="mt-px flex-[0_0_18px]"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5" />
                <path d="M12 16.2v.3" />
              </svg>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm leading-[1.45] font-semibold text-[#B91C1C]">
                  We couldn’t launch the experiment
                </span>
                <span className="text-[13px] leading-[19px] text-[#B91C1C]">
                  {errorMessage ||
                    "Something went wrong on our side. Nothing changed and your draft is saved — try again."}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-xl border border-[#EEF0F3] bg-[#FAFBFC] p-3.5">
            {li.arms.map((a, i) => (
              <div
                key={`${i}-${a[0]}`}
                className="flex items-center justify-between gap-3 text-sm leading-[1.45]"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 flex-[0_0_8px] rounded-xs"
                    style={{ background: colors[i % colors.length] }}
                  />
                  <span className="font-medium text-[#374151]">{a[0]}</span>
                  <span className="truncate text-[#6B7280]">{a[1]}</span>
                </span>
                <span className="font-semibold text-[#111827] tabular-nums">{a[2]}</span>
              </div>
            ))}
            <div className="h-px bg-[#F3F4F6]" />
            {facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 text-[13px]">
                <span className="whitespace-nowrap text-[#6B7280]">{f.label}</span>
                <span className="text-right font-medium [overflow-wrap:anywhere] text-[#374151]">
                  {f.value}
                </span>
              </div>
            ))}
          </div>

          {pixelWarning ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FEF3C7] px-3.5 py-3 text-[13px] leading-[19px] text-[#92400E]">
              {pixelWarning}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-[#111827]">Ready to launch</span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {checks.map((t) => (
                <li
                  key={t}
                  className="flex items-start gap-2 text-[13px] leading-[19px] text-[#374151]"
                >
                  <CheckIcon
                    size={16}
                    strokeWidth={2.4}
                    stroke="#16A34A"
                    className="mt-0.5 flex-[0_0_16px]"
                  />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2 max-[641px]:w-full max-[641px]:[&>button]:h-11 max-[641px]:[&>button]:flex-auto">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className={cn(btn.secondary, "px-4")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={cn(btn.primary, "shadow-none")}
            >
              {busy ? <Spinner /> : null}
              {busy ? "Launching…" : error ? "Try again" : "Launch experiment"}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
