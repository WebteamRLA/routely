"use client";

import { ArmSwatch, Section, TrafficBar } from "@/components/rl";
import { WIZARD_STEPS, type ExperimentDraft } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { cn } from "@/lib/utils";

/** Desktop stepper (L790–805): bars + "01"…"07", clickable up to `maxStep`. */
export function DesktopStepper({
  step,
  maxStep,
  bad,
  onGo,
}: {
  step: number;
  maxStep: number;
  /** Steps whose errors are revealed. */
  bad: (i: number) => boolean;
  onGo: (i: number) => void;
}) {
  const next = WIZARD_STEPS[step + 1];
  return (
    <nav aria-label="Wizard steps" className="hidden flex-col gap-3 pt-1 pb-0.5 nav:flex">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs font-extrabold tracking-[0.08em] text-ink-3 uppercase">
            Step {step + 1} of {WIZARD_STEPS.length}
          </span>
          <span className="text-[13.5px] font-extrabold">{WIZARD_STEPS[step]![1]}</span>
        </div>
        <span className="text-[12.5px] font-semibold text-ink-3">
          {next ? `Next: ${next[1]}` : "Final step"}
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-7 gap-1.5 p-0">
        {WIZARD_STEPS.map(([key, label], i) => {
          const done = i < step;
          const curr = i === step;
          const b = bad(i);
          const can = i <= maxStep;
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                disabled={!can}
                aria-current={curr ? "step" : undefined}
                onClick={() => can && onGo(i)}
                className={cn(
                  "flex w-full min-w-0 flex-col gap-2 border-0 bg-transparent p-0 text-left",
                  can ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className="h-1 rounded-[2px] transition-[background] duration-200"
                  style={{
                    background: b ? "#D13B3B" : curr ? "#2B59F0" : done ? "#0A1633" : "#DDE1E9",
                  }}
                />
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span
                    className="flex-none text-[11.5px] font-extrabold tabular-nums"
                    style={{
                      color: b ? "#D13B3B" : curr ? "#2B59F0" : done ? "#0F7A52" : "#8A93A6",
                    }}
                  >
                    {b ? "!" : done ? "✓" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "truncate text-[12.5px]",
                      curr ? "font-extrabold text-foreground" : "font-semibold text-ink-3",
                    )}
                  >
                    {label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Mobile stepper (L806–811). */
export function MobileStepper({ step }: { step: number }) {
  const pct = Math.round(((step + 1) / WIZARD_STEPS.length) * 100);
  return (
    <Section as="div" className="px-3.5 py-3 nav:hidden">
      <div className="text-[13px] font-extrabold">
        Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step]![1]}
      </div>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={WIZARD_STEPS.length}
        aria-valuenow={step + 1}
        aria-label="Wizard progress"
        className="mt-2 h-1 overflow-hidden rounded-[3px] bg-divider"
      >
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </Section>
  );
}

/** Live summary rail (L1324–1338), ≥1180px, every step but Review. */
export function SummaryRail({
  draft,
  goalName,
  showVariantErr,
}: {
  draft: ExperimentDraft;
  goalName: string | null;
  showVariantErr: boolean;
}) {
  const R = draft.type === "redirect";
  const t = draft.targeting;
  const target =
    t.devices.length === 3 && t.geo === "all" && !t.conditions.length
      ? t.audience === "all"
        ? "All visitors"
        : t.audience === "new"
          ? "New visitors"
          : "Returning visitors"
      : "Custom audience";
  return (
    <Section
      as="aside"
      aria-label="Summary"
      className="sticky top-6 hidden w-[290px] flex-none flex-col gap-3.5 p-[18px] min-[1180px]:flex"
    >
      <div className="text-[11px] font-extrabold tracking-[0.1em] text-ink-3">SUMMARY</div>
      <div>
        <div className="font-heading text-[15px] font-semibold break-words">
          {draft.name || "Untitled experiment"}
        </div>
        <div className="mt-[3px] text-[12.5px] break-all text-ink-3">
          {R ? "Split URL test" : "A/B test"} ·{" "}
          <span className="font-mono">{draft.url ? pathOf(draft.url) : "No URL yet"}</span>
        </div>
      </div>
      <TrafficBar
        size="md"
        segments={draft.arms.map((a, i) => ({ weight: Number(a.weight), position: i }))}
      />
      <div className="flex flex-col gap-2">
        {draft.arms.map((a, i) => {
          const n = a.changes.length;
          const detail = R
            ? pathOf(i ? a.url : draft.url) || "—"
            : i
              ? n
                ? `✓ ${n} change${n > 1 ? "s" : ""}`
                : "No changes yet"
              : "Original";
          const color =
            !R && i && !n
              ? showVariantErr
                ? "#B4361F"
                : "#94600A"
              : !R && i
                ? "#0F7A52"
                : "#5B6579";
          return (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <ArmSwatch position={i} size={8} />
              <span className="font-bold">{a.name}</span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[11.5px]",
                  R && "font-mono",
                  !R && i ? "font-bold" : "font-normal",
                )}
                style={{ color }}
              >
                {detail}
              </span>
              <span className="font-extrabold">{a.weight}%</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-divider pt-3 text-[13px]">
        <span className="text-ink-3">Goal</span>
        <span className="font-bold break-words">{goalName ?? "Not set"}</span>
        <span className="text-ink-3">Audience</span>
        <span className="font-bold">{target}</span>
        <span className="text-ink-3">Included</span>
        <span className="font-bold">{draft.coverage}%</span>
      </div>
    </Section>
  );
}
