"use client";

import type { ReactNode } from "react";

import { ArmSwatch, CardTitle, FieldError, Section } from "@/components/rl";
import { CountingControl } from "@/components/experiments/goal-controls";
import { armColor } from "@/lib/domain";
import { URL_RE, hostOf, pathOf } from "@/lib/domain-normalize";
import { changeCount } from "@/lib/editor";
import { resolveGoal } from "@/lib/qa";
import type { MetricRow } from "@/lib/view-models";
import { cn } from "@/lib/utils";

import type { StepProps } from "./types";
import { StepHeading } from "./ui";

interface GoalsProps extends StepProps {
  /** Project metrics — only to name a legacy metric goal. */
  metrics: MetricRow[];
}

/**
 * Step 5 — Goals (design v2 L1106–1180). Every experiment, of either type, is judged on a
 * conversion page: the visitor journey, the conversion URL (exact match), the primary-goal strip
 * and how it is counted. Design v2 removed the goal-type choice (custom events), the URL match
 * select, the "No code needed" note and secondary goals.
 */
export function StepGoals({ draft, update, err, metrics }: GoalsProps) {
  const R = draft.type === "redirect";
  const g = resolveGoal(draft, metrics);
  const conv = draft.convUrl.trim();
  const urlGoal = draft.goalMode === "url";
  const convOk = urlGoal && URL_RE.test(conv);
  // The strip and the counting card describe the URL goal once it is a full URL.
  const hasGoal = !!g && g.isUrl && convOk;
  // A draft made before v2 may still be judged on a metric until a conversion URL replaces it.
  const legacy = !urlGoal ? g : undefined;
  const errConv = err("goal", "conv");
  const matchText = draft.convMatch === "starts" ? "starts with" : "exactly matches";

  return (
    <>
      <StepHeading title="What counts as success?">
        The primary goal decides the winner. Conversion rate = visitors who triggered the goal ÷
        visitors in that variant.
      </StepHeading>

      <Section as="div" className="flex flex-col gap-3.5 px-5 py-[18px]">
        <div className="text-[11.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
          The visitor journey
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2.5">
          <JourneyTile
            n="01"
            title={R ? "Entry URL" : "Page URL"}
            sub="Where the experiment starts"
          >
            <JourneyLine color={armColor(0)}>
              {draft.url ? pathOf(draft.url) || draft.url : "Not set"}
            </JourneyLine>
          </JourneyTile>
          <JourneyTile
            n="02"
            title={R ? "Variant URL" : "Variants"}
            sub={R ? "Where visitors are redirected" : "Changes shown on the same page"}
          >
            <div className="flex flex-col gap-1">
              {draft.arms.slice(1).map((a, j) => (
                <JourneyLine key={j} color={armColor(j + 1)}>
                  {R
                    ? a.url
                      ? pathOf(a.url) || a.url
                      : "No URL yet"
                    : "Same page · " + changeCount(a.changes.length)}
                </JourneyLine>
              ))}
            </div>
          </JourneyTile>
          <div
            className="min-w-0 rounded-lg border-[1.5px] px-3.5 py-3"
            style={{
              borderColor: convOk ? "#13A06B" : "#E0A526",
              background: convOk ? "#F3FAF6" : "#FFFBF2",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="font-heading text-[13px] font-bold text-coral">03</span>
              <span className="text-[12.5px] font-extrabold">Conversion URL</span>
            </div>
            <div className="mt-0.5 text-xs text-ink-3">Reaching it counts as a conversion</div>
            <div className="mt-2 flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rotate-45"
                style={{ background: convOk ? "#13A06B" : "#E0A526" }}
              />
              <span
                className="truncate font-mono text-xs font-bold"
                style={{ color: convOk ? "#0F1B35" : "#94600A" }}
              >
                {convOk ? pathOf(conv) || conv : "Not set yet"}
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section as="div" padded className="gap-4">
        <CardTitle as="h3">Primary goal</CardTitle>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-extrabold">Goal type</span>
          <span className="inline-flex h-[26px] items-center rounded-sm bg-brand-tint-2 px-2.5 text-[12.5px] font-extrabold text-[#1F3FB0]">
            Page view
          </span>
          <span className="text-[12.5px] text-ink-3">Visitor views a conversion page</span>
        </div>
        {legacy ? (
          <div className="rounded-lg bg-warning-bg px-3 py-2.5 text-[13px] leading-normal font-semibold text-[#7A4E07]">
            This draft is judged on the custom event {legacy.name} ({legacy.key}). Custom-event
            goals can no longer be launched: enter a conversion URL to replace it.
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wizard-conv-url" className="text-[13px] font-extrabold">
            Conversion URL
          </label>
          <input
            id="wizard-conv-url"
            name="convUrl"
            inputMode="url"
            value={draft.convUrl}
            placeholder={`https://${hostOf(draft.url) || "example.com"}/thank-you`}
            onChange={(e) => {
              const v = e.target.value;
              // Typing a conversion URL makes it the goal (a legacy metric goal included).
              update((d) => ({ ...d, convUrl: v, goalMode: "url", goal: "" }));
            }}
            aria-invalid={errConv ? true : undefined}
            className={cn(
              "h-[42px] w-full min-w-0 rounded-md border bg-white px-3 font-mono text-[13.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15",
              errConv ? "border-danger" : "border-input",
            )}
          />
          <FieldError>{errConv}</FieldError>
          <span className="text-[12.5px] leading-normal text-ink-3">
            {convOk
              ? `A conversion is counted when a visitor in any version reaches a URL that ${matchText} ${pathOf(conv) || conv}.`
              : "Usually a thank-you, confirmation or success page that only appears after the action is completed."}
          </span>
        </div>
      </Section>

      {hasGoal && g ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg bg-navy px-[18px] py-3.5 text-white">
            <div className="flex min-w-0 flex-wrap items-baseline gap-3">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-coral">
                PRIMARY GOAL
              </span>
              <span className="font-heading text-base font-bold break-all">{g.name}</span>
              <span className="font-mono text-xs break-all text-white/65">{g.key}</span>
            </div>
            <span className="text-[12.5px] text-white/72">Decides the winner</span>
          </div>

          <Section as="div" padded className="gap-3.5">
            <CardTitle as="h3">How {g.name} is measured</CardTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-muted p-3">
                <div className="text-xs font-bold text-ink-3">Control</div>
                <div className="mt-1 text-[13px]">40 of 1,000 visitors</div>
                <div className="font-heading text-xl font-semibold">4.0%</div>
              </div>
              <div className="rounded-lg bg-brand-tint p-3">
                <div className="text-xs font-bold text-brand">Variant A</div>
                <div className="mt-1 text-[13px]">55 of 1,000 visitors</div>
                <div className="font-heading text-xl font-semibold">
                  5.5% <span className="text-[13px] text-success-text">+37.5%</span>
                </div>
              </div>
            </div>
            <div className="text-[11.5px] text-ink-3">Example numbers, for illustration.</div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-extrabold">Count conversions</span>
              <CountingControl
                value={draft.counting}
                onChange={(k) => update((d) => ({ ...d, counting: k }))}
              />
              <span className="text-[12.5px] text-ink-3">
                {draft.counting === "unique"
                  ? "A visitor who converts twice counts once. Recommended for conversion rate."
                  : "Every event counts. Useful for repeat actions like add to cart."}
              </span>
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

function JourneyTile({
  n,
  title,
  sub,
  children,
}: {
  n: string;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-[#FAFBFC] px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="font-heading text-[13px] font-bold text-coral">{n}</span>
        <span className="text-[12.5px] font-extrabold">{title}</span>
      </div>
      <div className="mt-0.5 text-xs text-ink-3">{sub}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function JourneyLine({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ArmSwatch position={0} size={8} color={color} />
      <span className="truncate font-mono text-xs">{children}</span>
    </div>
  );
}
