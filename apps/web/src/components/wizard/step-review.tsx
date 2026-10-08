"use client";

import { useState } from "react";

import {
  ArmSwatch,
  CardTitle,
  Diamond,
  IssueIcon,
  Section,
  Spinner,
  SummaryRow,
  TrafficBar,
} from "@/components/rl";
import type { ExperimentDraft } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { changeCount } from "@/lib/editor";
import type { QaCheck, Readiness, ReadinessItem, ResolvedGoal } from "@/lib/qa";
import { targetSummary } from "@/lib/targeting";
import type { MetricRow } from "@/lib/view-models";
import { cn } from "@/lib/utils";

const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

interface ReviewProps {
  draft: ExperimentDraft;
  readiness: Readiness;
  checks: QaCheck[];
  qa: { running: boolean; ran: boolean };
  /** Whether a check row is still waiting for its real URL check. */
  rowPending: (c: QaCheck) => boolean;
  goal: ResolvedGoal | undefined;
  metrics: MetricRow[];
  installed: boolean;
  primaryDomain: string;
  onGoStep: (index: number) => void;
  onFix: (item: ReadinessItem) => void;
  onOpenInstall: () => void;
  onRunQa: () => void;
  onPreview: (arm: number) => void;
  onCopyLink: (arm: number) => void;
  copying: number | null;
}

/** Step 7 — Review & launch (design L1172–1311). The launch button lives in the footer. */
export function StepReview(p: ReviewProps) {
  const { draft: d, readiness: rd, checks, qa } = p;
  const R = d.type === "redirect";
  const [passedOpen, setPassedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const domain = p.primaryDomain || "this site";

  const typeDesc = R
    ? `Split URL test · visitors are redirected between ${d.arms.length} URLs`
    : `A/B test · ${d.arms.length - 1} variant${d.arms.length > 2 ? "s" : ""} edited in the visual editor`;

  const nB = rd.blockingCount;
  const nW = rd.warnings.length;
  const banner = {
    checking: {
      title: "Checking your experiment…",
      sub: `Running ${checks.length} pre-launch checks. This takes a few seconds.`,
      cls: "bg-card border-border",
    },
    blocked: {
      title: "Action required before launch",
      sub:
        `${pl(nB, "issue")} must be fixed before this experiment can go live.` +
        (nW ? ` ${pl(nW, "warning")} to review as well.` : ""),
      cls: "bg-[#FFF7F5] border-danger-border",
    },
    warn: {
      title: "Ready to launch",
      sub: `Nothing is blocking launch, but ${pl(nW, "warning")} ${nW === 1 ? "is" : "are"} worth a look first.`,
      cls: "bg-[#FFFBF2] border-[#F1DDB6]",
    },
    ready: {
      title: "Ready to launch",
      sub: `All ${checks.length} pre-launch checks passed. Traffic starts splitting the moment you launch.`,
      cls: "bg-[#F3FAF6] border-[#BFE3D1]",
    },
  }[rd.state];

  let pc = 0;
  let wc = 0;
  let fc = 0;
  if (qa.ran) {
    for (const c of checks) {
      if (c.state === "pass") pc++;
      else if (c.state === "warn") wc++;
      else fc++;
    }
  }
  const qaLine = qa.running
    ? "Running checks…"
    : qa.ran
      ? `${pc} passed · ${pl(wc, "warning")} · ${fc} failed`
      : "Not run yet";
  const qaColor = qa.ran
    ? fc
      ? "text-danger-text"
      : wc
        ? "text-[#94600A]"
        : "text-success-text"
    : "text-ink-3";

  const secondaryNames =
    d.secondary
      .map((id) => p.metrics.find((m) => m.id === id)?.name)
      .filter(Boolean)
      .join(", ") || "None";

  return (
    <>
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="text-xs font-extrabold tracking-[0.08em] text-coral">
          REVIEW &amp; LAUNCH
        </div>
        <h1 className="m-0 font-heading text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.02em] text-pretty">
          {d.name || "—"}
        </h1>
        <div className="text-sm leading-normal text-ink-2">
          {typeDesc}. Nothing goes live until you confirm.
        </div>
      </div>

      <section
        aria-label="Readiness"
        className={cn("overflow-hidden rounded-[10px] border", banner.cls)}
      >
        <div className="flex items-start gap-4 px-[22px] py-5">
          {rd.state === "checking" ? (
            <Spinner size={36} className="[animation-duration:.8s]" />
          ) : (
            <span
              aria-hidden
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full text-[17px] font-black text-white",
                rd.state === "blocked" ? "bg-danger" : "bg-success",
              )}
            >
              {rd.state === "blocked" ? "!" : "✓"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div role="status" className="font-heading text-xl font-bold tracking-[-0.015em]">
              {banner.title}
            </div>
            <div className="mt-1 text-sm leading-normal text-pretty text-[#2E3A52]">
              {banner.sub}
            </div>
          </div>
        </div>
        {rd.blocking.length ? (
          <IssueGroup
            tone="block"
            title={`${pl(rd.blocking.length, "blocking issue")} · must fix`}
            items={rd.blocking}
            onAct={p.onFix}
          />
        ) : null}
        {nW ? (
          <IssueGroup
            tone="warn"
            title={`${pl(nW, "warning")} · won’t block launch`}
            items={rd.warnings}
            onAct={p.onFix}
          />
        ) : null}
        {rd.passed.length ? (
          <div className="border-t border-border bg-white">
            <button
              type="button"
              aria-expanded={passedOpen}
              onClick={() => setPassedOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-[18px] py-3 text-left hover:bg-[#FAFBFC]"
            >
              <span className="flex items-center gap-2.5">
                <IssueIcon kind="pass" />
                <span className="text-[13.5px] font-bold">
                  {pl(rd.passed.length, "check")} passed
                </span>
              </span>
              <span className="text-[12.5px] font-bold text-brand">
                {passedOpen ? "Hide" : "Show"}
              </span>
            </button>
            {passedOpen ? (
              <div className="flex flex-col gap-2 pr-[18px] pb-3 pl-12">
                {rd.passed.map((x, i) => (
                  <div key={i} className="text-[13px]">
                    <span className="font-bold">{x.text}</span>{" "}
                    <span className="text-ink-3">· {x.detail}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[10px] border px-[18px] py-3",
          p.installed
            ? "border-success-border bg-success-bg-2"
            : "border-danger-border bg-[#FDF5F3]",
        )}
      >
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-black text-white",
            p.installed ? "bg-success" : "bg-danger",
          )}
        >
          {p.installed ? "✓" : "✕"}
        </span>
        <div className="min-w-0 flex-[1_1_280px]">
          <div
            className={cn(
              "text-[13.5px] font-extrabold",
              p.installed ? "text-success-strong" : "text-danger-text",
            )}
          >
            {p.installed ? "Tracking installed — ready to launch" : "Tracking not installed"}
          </div>
          <div className="mt-px text-[12.5px] text-ink-2">
            {p.installed
              ? `Routely snippet verified on ${domain}. Shared by every experiment in this project.`
              : `Install the Routely snippet once on ${domain} to launch any experiment in this project.`}
          </div>
        </div>
        {p.installed ? (
          <button
            type="button"
            onClick={p.onOpenInstall}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold text-brand hover:underline"
          >
            View installation
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onOpenInstall}
            className="h-[34px] cursor-pointer rounded-md border border-danger-text bg-white px-3.5 text-[13px] font-extrabold text-danger-text hover:bg-danger-bg"
          >
            Install tracking →
          </button>
        )}
      </div>

      <Section clip className="rounded-[10px]">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <CardTitle size={16}>Experiment summary</CardTitle>
        </div>
        <SummaryRow label={R ? "Control URL" : "Page"} onEdit={() => p.onGoStep(1)}>
          <div className="flex min-w-0 items-baseline gap-2">
            <ArmSwatch position={0} size={8} />
            <span className="font-mono text-[13px] break-all">{d.url || "Not set"}</span>
          </div>
        </SummaryRow>
        <SummaryRow label="Variants" onEdit={() => p.onGoStep(2)}>
          <div className="flex flex-col gap-1.5">
            {d.arms.slice(1).map((a, j) => (
              <div key={j} className="flex min-w-0 items-baseline gap-2">
                <ArmSwatch position={j + 1} size={8} />
                <span className="shrink-0 text-[13px] font-extrabold">{a.name}</span>
                <span className={cn("min-w-0 text-[13px] break-all text-ink-2", R && "font-mono")}>
                  {R
                    ? a.url || "No URL yet"
                    : a.changes.length
                      ? changeCount(a.changes.length)
                      : "No changes"}
                </span>
              </div>
            ))}
          </div>
        </SummaryRow>
        {R && d.goalMode === "url" ? (
          <SummaryRow label="Conversion URL" onEdit={() => p.onGoStep(5)}>
            <div className="flex min-w-0 items-baseline gap-2">
              <Diamond className="bg-success" />
              <span className="font-mono text-[13px] break-all">
                {d.convUrl.trim() || "Not set"}
              </span>
            </div>
            <div className="mt-[3px] text-[12.5px] text-ink-3">
              {d.convMatch === "starts" ? "URL starts with" : "Exact match"} · reaching this page
              counts as a conversion
            </div>
          </SummaryRow>
        ) : null}
        <SummaryRow label="Traffic split" onEdit={() => p.onGoStep(3)}>
          <TrafficBar
            size="sm"
            className="max-w-[360px]"
            segments={d.arms.map((a, i) => ({ weight: Number(a.weight), position: i }))}
          />
          <div className="mt-2 flex flex-wrap gap-3.5">
            {d.arms.map((a, i) => (
              <span key={i} className="text-[13px] text-ink-2">
                <span className="font-extrabold text-foreground">{a.weight}%</span> {a.name}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[12.5px] text-ink-3">
            {d.coverage === 100
              ? "All matching visitors are included"
              : `${d.coverage}% of matching visitors are included`}
          </div>
        </SummaryRow>
        <SummaryRow label="Audience" onEdit={() => p.onGoStep(4)}>
          <div className="text-[13.5px] leading-normal">{targetSummary(d.targeting)}</div>
        </SummaryRow>
        <SummaryRow label="Primary goal" onEdit={() => p.onGoStep(5)}>
          <div className="text-[13.5px] font-extrabold">
            {p.goal
              ? p.goal.isUrl
                ? "Page visit · conversion URL reached"
                : p.goal.name
              : "Not set"}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {p.goal
              ? d.counting === "unique"
                ? "Counted once per visitor"
                : "Every conversion counted"
              : "Choose the action that decides the winner"}
          </div>
        </SummaryRow>
        <div className="border-t border-divider">
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className="w-full cursor-pointer border-0 bg-[#FAFBFC] px-5 py-3 text-left text-[13px] font-bold text-brand hover:bg-muted"
          >
            {moreOpen ? "Hide details" : "Show all details"}
          </button>
          {moreOpen ? (
            <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-5 gap-y-2.5 bg-[#FAFBFC] px-5 pt-1 pb-4 text-[13px] sm:grid-cols-[140px_minmax(0,1fr)]">
              <span className="font-bold text-ink-3">Type</span>
              <span>{R ? "Split URL test (redirect)" : "A/B test (visual editor)"}</span>
              <span className="font-bold text-ink-3">Hypothesis</span>
              <span className="text-ink-2 italic">{d.hypothesis || "No hypothesis added"}</span>
              <span className="font-bold text-ink-3">Goal event</span>
              <span className="font-mono text-[12.5px] break-all">
                {p.goal ? `${p.goal.name} · ${p.goal.key}` : "Not set"}
              </span>
              <span className="font-bold text-ink-3">Counting</span>
              <span>{d.counting === "unique" ? "Once per visitor" : "Every conversion"}</span>
              <span className="font-bold text-ink-3">Secondary goals</span>
              <span>{secondaryNames}</span>
              {R ? (
                <>
                  <span className="font-bold text-ink-3">Delivery</span>
                  <span>Query parameters preserved · bots &amp; crawlers excluded (automatic)</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>

      <Section clip className="rounded-[10px]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <CardTitle size={16}>Preview &amp; QA</CardTitle>
            <div className="mt-[3px] text-[13px] text-ink-3">
              Open each version before launch. Preview visits are never counted.
            </div>
          </div>
          <button
            type="button"
            onClick={p.onRunQa}
            disabled={qa.running}
            className="h-8 cursor-pointer rounded-md border border-input bg-white px-3 text-[12.5px] font-bold hover:border-brand hover:text-brand disabled:cursor-wait"
          >
            {qa.running ? "Checking…" : qa.ran ? "Run checks again" : "Run QA checks"}
          </button>
        </div>
        {d.arms.map((a, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-divider px-5 py-2.5">
            <ArmSwatch position={i} size={8} />
            <span className="min-w-[76px] shrink-0 text-[13.5px] font-extrabold">{a.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
              {R
                ? pathOf(i ? a.url : d.url) || "—"
                : i
                  ? changeCount(a.changes.length)
                  : "Original page"}
            </span>
            <button
              type="button"
              onClick={() => p.onCopyLink(i)}
              disabled={p.copying !== null}
              title="Copies a link that shows this version on your site without recording the visit"
              className="shrink-0 cursor-pointer border-0 bg-transparent px-1 text-[12.5px] font-bold text-ink-3 hover:text-brand disabled:cursor-wait"
            >
              {p.copying === i ? "Saving…" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => p.onPreview(i)}
              className="h-[30px] shrink-0 cursor-pointer rounded-md border border-navy bg-navy px-3 text-[12.5px] font-bold text-white"
            >
              Preview
            </button>
          </div>
        ))}
        <div className="border-t border-divider bg-[#FAFBFC]">
          <button
            type="button"
            aria-expanded={qaOpen}
            onClick={() => setQaOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-5 py-3 text-left hover:bg-muted"
          >
            <span className={cn("text-[13px] font-bold", qaColor)}>QA checks · {qaLine}</span>
            <span className="shrink-0 text-[12.5px] font-bold text-brand">
              {qaOpen ? "Hide check details" : "View check details"}
            </span>
          </button>
          {qaOpen ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-5 px-5 pb-2.5">
              {checks.map((c) => {
                const st = !qa.ran && !qa.running ? "idle" : p.rowPending(c) ? "running" : c.state;
                const icon = {
                  idle: ["", "bg-divider text-ink-3"],
                  running: ["", ""],
                  pass: ["✓", "bg-[#E6F5EE] text-success-text"],
                  warn: ["!", "bg-[#FDF3E1] text-[#94600A]"],
                  fail: ["×", "bg-[#FCE9E6] text-danger-text"],
                }[st];
                return (
                  <div key={c.id} className="flex items-start gap-2.5 border-t border-divider py-2">
                    {st === "running" ? (
                      <Spinner size={18} thickness={2} />
                    ) : (
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-black",
                          icon![1],
                        )}
                      >
                        {icon![0]}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold">{c.label}</div>
                      <div
                        className={cn(
                          "mt-px text-xs leading-[1.4]",
                          st === "fail"
                            ? "text-danger-text"
                            : st === "warn"
                              ? "text-[#94600A]"
                              : "text-ink-3",
                        )}
                      >
                        {st === "idle" ? c.hint : st === "running" ? "Checking…" : c.detail}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}

function IssueGroup({
  tone,
  title,
  items,
  onAct,
}: {
  tone: "block" | "warn";
  title: string;
  items: ReadinessItem[];
  onAct: (item: ReadinessItem) => void;
}) {
  return (
    <div
      className={cn(
        "border-t bg-white",
        tone === "block" ? "border-danger-border" : "border-[#F1DDB6]",
      )}
    >
      <div
        className={cn(
          "px-[18px] py-2.5 text-[11.5px] font-extrabold tracking-[0.08em] uppercase",
          tone === "block" ? "text-danger-text" : "text-[#94600A]",
        )}
      >
        {title}
      </div>
      {items.map((e, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start gap-3 border-t px-[18px] py-3",
            tone === "block" ? "border-[#F8E1DC]" : "border-[#F7EBD3]",
          )}
        >
          <IssueIcon kind={tone} className="mt-px" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] leading-[1.45] font-bold">{e.text}</div>
            {e.detail ? (
              <div className="mt-0.5 text-[12.5px] leading-[1.45] text-ink-2">{e.detail}</div>
            ) : null}
            <div className="mt-[3px] text-xs text-ink-3">{e.stepLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => onAct(e)}
            className="h-[30px] shrink-0 cursor-pointer rounded-md border border-input bg-white px-3 text-[12.5px] font-bold hover:border-brand hover:text-brand"
          >
            {e.action} →
          </button>
        </div>
      ))}
    </div>
  );
}
