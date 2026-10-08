"use client";

import {
  ArmSwatch,
  CardTitle,
  Diamond,
  FieldError,
  RadioCard,
  RadioDot,
  Section,
  Tag,
} from "@/components/rl";
import { CountingControl, SecondaryGoalPills } from "@/components/experiments/goal-controls";
import { armColor } from "@/lib/domain";
import { URL_RE, hostOf, pathOf } from "@/lib/domain-normalize";
import { fAgo, fN, minutesSince } from "@/lib/format";
import { resolveGoal } from "@/lib/qa";
import type { MetricRow } from "@/lib/view-models";
import { cn } from "@/lib/utils";

import type { StepProps } from "./types";
import { StepHeading } from "./ui";

interface GoalsProps extends StepProps {
  metrics: MetricRow[];
  onNewMetric: () => void;
  installed: boolean;
  primaryDomain: string;
  onOpenInstall: () => void;
}

export function metricLastText(m: Pick<MetricRow, "lastReceivedAt" | "count24h">): string {
  if (!m.lastReceivedAt) return "No events received yet";
  return (
    "Last event " +
    fAgo(minutesSince(m.lastReceivedAt)).toLowerCase() +
    " · " +
    fN(m.count24h) +
    " in 24h"
  );
}

/** Step 6 — Goals (design L1084–1170). */
export function StepGoals({
  draft,
  update,
  err,
  metrics,
  onNewMetric,
  installed,
  primaryDomain,
  onOpenInstall,
}: GoalsProps) {
  const R = draft.type === "redirect";
  const urlGoal = R && draft.goalMode === "url";
  const g = resolveGoal(draft, metrics);
  const conv = draft.convUrl.trim();
  const convOk = URL_RE.test(conv);
  const hasGoal = !!g && (!g.isUrl || convOk);
  const never = !!g && g.lastReceivedAt === null;
  const errConv = err("goal", "conv");
  const errGoal = err("goal", "goal");
  const errSecondary = err("goal", "secondary");
  const matchText = draft.convMatch === "starts" ? "starts with" : "exactly matches";
  const domain = primaryDomain || "this site";

  return (
    <>
      <StepHeading title="What counts as success?">
        The primary goal decides the winner. Conversion rate = visitors who triggered the goal ÷
        visitors in that variant.
      </StepHeading>

      {R ? (
        <>
          <Section as="div" className="flex flex-col gap-3.5 px-5 py-[18px]">
            <div className="text-[11.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
              The visitor journey
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2.5">
              <JourneyTile n="01" title="Entry URL" sub="Where the experiment starts">
                <JourneyLine color={armColor(0)}>
                  {draft.url ? pathOf(draft.url) || draft.url : "Not set"}
                </JourneyLine>
              </JourneyTile>
              <JourneyTile n="02" title="Variant URL" sub="Where visitors are redirected">
                <div className="flex flex-col gap-1">
                  {draft.arms.slice(1).map((a, j) => (
                    <JourneyLine key={j} color={armColor(j + 1)}>
                      {a.url ? pathOf(a.url) || a.url : "No URL yet"}
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
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-extrabold">Goal type</span>
              <div
                role="radiogroup"
                aria-label="Goal type"
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5"
              >
                {(
                  [
                    ["url", "Page visit", "Visitor reaches a conversion URL"],
                    ["event", "Custom event", "Tracked event or existing metric"],
                  ] as const
                ).map(([k, label, sub]) => {
                  const on = draft.goalMode === k;
                  return (
                    <RadioCard
                      key={k}
                      selected={on}
                      onSelect={() => update((d) => ({ ...d, goalMode: k }))}
                      className="flex gap-2.5 px-3.5 py-3"
                    >
                      <RadioDot on={on} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13.5px] font-extrabold">{label}</span>
                          {k === "url" ? <Tag tone="green">Recommended</Tag> : null}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] text-ink-3">{sub}</span>
                      </span>
                    </RadioCard>
                  );
                })}
              </div>
            </div>
            {urlGoal ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-extrabold">Conversion URL</span>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Conversion URL match"
                      value={draft.convMatch}
                      onChange={(e) => {
                        const v = e.target.value === "starts" ? "starts" : "exact";
                        update((d) => ({ ...d, convMatch: v }));
                      }}
                      className="h-[42px] cursor-pointer rounded-md border border-input bg-white px-2.5 text-[13.5px] outline-none focus:border-brand"
                    >
                      <option value="exact">Exact URL</option>
                      <option value="starts">URL starts with</option>
                    </select>
                    <input
                      aria-label="Conversion URL"
                      name="convUrl"
                      inputMode="url"
                      value={draft.convUrl}
                      placeholder={`https://${hostOf(draft.url) || "example.com"}/thank-you`}
                      onChange={(e) => {
                        const v = e.target.value;
                        update((d) => ({ ...d, convUrl: v }));
                      }}
                      aria-invalid={errConv ? true : undefined}
                      className={cn(
                        "h-[42px] min-w-0 flex-[1_1_280px] rounded-md border bg-white px-3 font-mono text-[13.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15",
                        errConv ? "border-danger" : "border-input",
                      )}
                    />
                  </div>
                  <FieldError>{errConv}</FieldError>
                  <span className="text-[12.5px] leading-normal text-ink-3">
                    {convOk
                      ? `A conversion is counted when a visitor in any version reaches a URL that ${matchText} ${pathOf(conv) || conv}.`
                      : "Usually a thank-you, confirmation or success page that only appears after the action is completed."}
                  </span>
                </div>
                <div className="flex items-start gap-2.5 rounded-md bg-brand-tint px-3.5 py-3 text-[13px] leading-normal text-[#1F3FB0]">
                  <Diamond className="mt-1.5 bg-brand" />
                  <span>
                    No code needed. The Routely snippet on the conversion page records the visit and
                    credits it to the version the visitor was assigned, whether that was Control or
                    a variant.
                  </span>
                </div>
              </>
            ) : null}
          </Section>
        </>
      ) : null}

      {hasGoal && g ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg bg-navy px-[18px] py-3.5 text-white">
          <div className="flex min-w-0 flex-wrap items-baseline gap-3">
            <span className="text-[11px] font-extrabold tracking-[0.12em] text-coral">
              PRIMARY GOAL
            </span>
            <span className="font-heading text-base font-bold">{g.name}</span>
            <span className="font-mono text-xs break-all text-white/65">{g.key}</span>
          </div>
          <span className="text-[12.5px] text-white/72">
            Decides the winner ·{" "}
            {draft.secondary.length
              ? `${draft.secondary.length} secondary goal${draft.secondary.length > 1 ? "s" : ""} reported`
              : "no secondary goals"}
          </span>
        </div>
      ) : null}

      {!urlGoal ? (
        <Section as="div" padded className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <CardTitle as="h3">Primary goal</CardTitle>
            <button
              type="button"
              onClick={onNewMetric}
              className="h-8 cursor-pointer rounded-md border border-input bg-white px-3 text-[12.5px] font-bold hover:bg-muted"
            >
              + New metric
            </button>
          </div>
          {metrics.length ? (
            <div
              role="radiogroup"
              aria-label="Primary goal metric"
              className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-2.5"
            >
              {metrics.map((m) => {
                const on = draft.goal === m.id;
                return (
                  <RadioCard
                    key={m.id}
                    selected={on}
                    onSelect={() =>
                      update((d) => ({
                        ...d,
                        goal: m.id,
                        goalMode: "event",
                        secondary: d.secondary.filter((z) => z !== m.id),
                      }))
                    }
                    className="flex gap-2.5 p-3.5"
                  >
                    <RadioDot on={on} className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
                        {m.kind === "page" ? "Page visit" : "Custom event"}
                      </div>
                      <div className="mt-0.5 font-extrabold">{m.name}</div>
                      <div className="mt-0.5 font-mono text-xs break-all text-ink-2">{m.key}</div>
                      <div
                        className={cn(
                          "mt-1.5 text-xs",
                          m.lastReceivedAt ? "text-ink-3" : "text-danger-text",
                        )}
                      >
                        {metricLastText(m)}
                      </div>
                    </div>
                  </RadioCard>
                );
              })}
            </div>
          ) : (
            <div className="text-[13px] text-ink-3">
              This project has no metrics yet. Create one to use it as the goal.
            </div>
          )}
          {errGoal ? (
            <span role="alert" className="text-[13px] font-bold text-danger-text">
              {errGoal}
            </span>
          ) : null}
          {never && g && !g.isUrl ? (
            <div className="rounded-lg bg-[#FDF3E1] px-3 py-2.5 text-[13px] font-semibold text-[#7A4E07]">
              Routely hasn’t received any {g.key} events yet. You can still launch, but conversions
              will show as zero until tracking fires.
            </div>
          ) : null}
        </Section>
      ) : null}

      {hasGoal && g ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
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
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-extrabold">
                Secondary goals{" "}
                <span className="font-medium text-ink-3">· reported, don’t decide the winner</span>
              </span>
              <SecondaryGoalPills
                metrics={metrics.filter((m) => urlGoal || m.id !== draft.goal)}
                selected={draft.secondary}
                onChange={(ids) => update((d) => ({ ...d, secondary: ids }))}
              />
              <FieldError>{errSecondary}</FieldError>
            </div>
          </Section>
          {!urlGoal ? (
            <Section as="div" className="flex flex-col gap-2 self-start px-[18px] py-4">
              <div className="text-[11px] font-extrabold tracking-[0.1em] text-ink-3">TRACKING</div>
              <div
                className={cn(
                  "flex items-center gap-2 text-[13.5px] font-extrabold",
                  installed ? "text-success-strong" : "text-danger-text",
                )}
              >
                <span>{installed ? "✓" : "✕"}</span>
                {installed ? `Installed on ${domain}` : "Not installed yet"}
              </div>
              <div className="text-[12.5px] leading-normal text-ink-2">
                {installed
                  ? `Uses the project snippet installed on ${domain}. Fire the goal event with routely.track('${g.key}') or from GTM.`
                  : "Goals are tracked by the project-level Routely snippet. Install it once and every experiment can use it."}
              </div>
              <button
                type="button"
                onClick={onOpenInstall}
                className="cursor-pointer self-start border-0 bg-transparent p-0 text-[12.5px] font-bold text-brand hover:underline"
              >
                {installed ? "View installation" : "Install tracking"} →
              </button>
            </Section>
          ) : null}
        </div>
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
  children: React.ReactNode;
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

function JourneyLine({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ArmSwatch position={0} size={8} color={color} />
      <span className="truncate font-mono text-xs">{children}</span>
    </div>
  );
}
