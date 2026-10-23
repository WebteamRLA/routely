"use client";

import {
  ArrowRightIcon,
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  Spinner,
  XIcon,
} from "@/components/rt/icons";
import { ACCENT, ACCENT_INK, ACCENT_LINE, ACCENT_TINT, type AbState } from "@/lib/mock/ab-test";

import { AbDialog, AbDialogTitle, DialogActions } from "./dialog";
import { CodeIcon } from "./icons";
import type { Derived } from "./model";
import { cls, Swatch } from "./ui";
import { cn } from "@/lib/utils";

const MONO = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

type RowLook = { iconBg: string; fg: string; kind: "ok" | "fail" | "running" | "pending" };
const OK: RowLook = { iconBg: "#DCFCE7", fg: "#166534", kind: "ok" };
const FAIL: RowLook = { iconBg: "#FEE2E2", fg: "#B91C1C", kind: "fail" };
const RUN: RowLook = { iconBg: ACCENT_TINT, fg: ACCENT_INK, kind: "running" };
const PEND: RowLook = { iconBg: "#F3F4F6", fg: "#9CA3AF", kind: "pending" };

/**
 * Install tracking → verify it, for the experiment's two pages (tested and goal). Not the
 * Projects screen's `PixelSetupDialog`: that one verifies a single site URL the user types,
 * while this one checks the experiment's own pages and feeds the result back into the launch
 * checklist.
 */
export function InstallModal({
  open,
  s,
  d,
  pixelKey,
  snippet,
  onClose,
  onStep,
  onCopy,
  onVerify,
}: {
  open: boolean;
  s: AbState;
  d: Derived;
  pixelKey: string;
  snippet: string;
  onClose(): void;
  onStep(n: 1 | 2): void;
  onCopy(): void;
  onVerify(): void;
}) {
  const vstate = s.verify;
  const istep = s.instStep;
  const tr = s.tracking;
  const lastOk = tr.status === "done" && !d.stale;
  const nP = d.pages.length;
  const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
  const lastMissing = vstate === "idle" && d.missing.length > 0;
  const allFound = vstate === "success" || (vstate === "idle" && lastOk && d.missing.length === 0);
  const checking = vstate === "checking";

  const flow = (
    [
      [1, "Install pixel"],
      [2, "Verify"],
    ] as const
  ).map(([n, label]) => {
    const cur = n === istep;
    const done = n < istep || vstate === "success";
    return {
      n,
      label,
      cur,
      done,
      ring: done ? "#16A34A" : cur ? ACCENT : "#D1D5DB",
      bg: done ? "#16A34A" : cur ? ACCENT_TINT : "#FFFFFF",
      fg: done ? "#FFFFFF" : cur ? ACCENT_INK : "#6B7280",
      labelFg: done ? "#166534" : cur ? "#111827" : "#4B5563",
    };
  });

  const rows = d.pages.map((pg) => {
    const r = tr.results ? tr.results[pg.id] : null;
    const reason = r === "missing" ? tr.details?.[pg.id] : undefined;
    // A page with no URL yet (the goal before step 4) isn't checked, so it never passes or fails.
    if (!pg.set) {
      return { id: pg.id, title: pg.label, text: "No URL yet · Checked once it’s set", ...PEND };
    }
    const look = checking
      ? RUN
      : vstate === "success"
        ? OK
        : lastOk
          ? r === "missing"
            ? FAIL
            : OK
          : PEND;
    const text = checking
      ? "Checking " + pg.url + "…"
      : vstate === "success"
        ? pg.url + " · Script found"
        : lastOk
          ? pg.url +
            (r === "missing"
              ? " · " + (reason ?? "Not found in the last check")
              : " · Found in the last check")
          : pg.url + " · Not checked yet";
    return { id: pg.id, title: pg.label, text, ...look };
  });

  const rTitle = checking
    ? "Checking " + plural(nP, "page") + "…"
    : allFound
      ? "Script found on " + (nP === 2 ? "both pages" : "all " + nP + " pages")
      : lastMissing
        ? "We couldn’t find the script on " + plural(d.missing.length, "page")
        : "Verification status";
  const tone = checking
    ? {
        ink: "#111827",
        bg: "#FAFBFC",
        border: "#E5E7EB",
        label: "Checking",
        pillBg: ACCENT_TINT,
        pillFg: ACCENT_INK,
        dot: ACCENT,
      }
    : allFound
      ? {
          ink: "#166534",
          bg: "#ECFDF5",
          border: "#BBF7D0",
          label: "Verified",
          pillBg: "#DCFCE7",
          pillFg: "#166534",
          dot: "#16A34A",
        }
      : lastMissing
        ? {
            ink: "#B91C1C",
            bg: "#FEF2F2",
            border: "#FECACA",
            label: "Not found",
            pillBg: "#FEE2E2",
            pillFg: "#B91C1C",
            dot: "#DC2626",
          }
        : {
            ink: "#111827",
            bg: "#FAFBFC",
            border: "#E5E7EB",
            label: "Not checked yet",
            pillBg: "#F3F4F6",
            pillFg: "#4B5563",
            dot: "#9CA3AF",
          };

  return (
    <AbDialog
      open={open}
      onClose={onClose}
      width={680}
      className="h-[720px] max-h-[calc(100vh-32px)] overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F3] py-3 pr-3.5 pl-5 max-[641px]:py-2.5 max-[641px]:pr-2.5 max-[641px]:pl-3">
        <ol
          aria-label="Setup steps"
          className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0"
        >
          {flow.map((fl) => (
            <li key={fl.n} className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                onClick={() => onStep(fl.n)}
                aria-current={fl.cur ? "step" : "false"}
                disabled={checking}
                className="flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 pr-3 pl-1.5 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:cursor-default disabled:opacity-45"
                style={{
                  background: fl.cur ? "#F3F4F6" : "transparent",
                  color: fl.labelFg,
                  fontWeight: fl.cur ? 600 : 500,
                }}
              >
                <span
                  aria-hidden
                  className="inline-flex size-[22px] flex-none items-center justify-center rounded-full border-[1.5px] text-[12px] font-semibold"
                  style={{ borderColor: fl.ring, background: fl.bg, color: fl.fg }}
                >
                  {fl.done ? <CheckIcon size={11} strokeWidth={3.2} /> : fl.n}
                </span>
                {fl.label}
              </button>
              {fl.n < 2 ? (
                <span
                  aria-hidden
                  className="block h-0.5 w-6 rounded-sm"
                  style={{ background: istep > 1 ? ACCENT_LINE : "#E5E7EB" }}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(cls.ghost, "size-8 flex-none text-[#6B7280]")}
        >
          <XIcon />
        </button>
      </div>

      <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto px-7 py-6 max-[641px]:px-4 max-[641px]:py-5">
        {istep === 1 ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold"
                  style={{ background: ACCENT_TINT, color: ACCENT_INK }}
                >
                  <CodeIcon size={12} strokeWidth={2.4} />
                  Manual installation
                </span>
                <span className="text-[13px] text-[#6B7280]">About 5 minutes</span>
              </span>
              <AbDialogTitle className="text-[18px] leading-[26px] tracking-[-0.01em]">
                Add the Routely script to your site
              </AbDialogTitle>
              <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
                It goes on the page you’re testing and on your goal page, so Routely can show
                variants and count conversions.
              </p>
            </div>
            <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
              <li className="relative flex min-w-0 items-start gap-3">
                <StepRail />
                <StepNum n={1} />
                <div className="flex min-w-0 flex-auto flex-col gap-2.5 pt-0.5">
                  <span className="text-[14px] leading-[22px] font-semibold text-[#111827]">
                    Copy the script
                  </span>
                  <div className="flex flex-col overflow-hidden rounded-xl border border-[#EEF0F3] bg-[#F3F4F6]">
                    <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] py-1.5 pr-2 pl-3.5">
                      <span className="text-[12px] text-[#6B7280]">
                        Routely tracking script · {pixelKey}
                      </span>
                      <button
                        type="button"
                        onClick={onCopy}
                        className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-[12px] font-medium text-[#374151] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                      >
                        <CopyIcon />
                        {s.copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre
                      className={cn(
                        "m-0 overflow-x-auto px-3.5 pt-3 pb-3.5 text-[13px] leading-[19px] break-normal [overflow-wrap:anywhere] whitespace-pre-wrap text-[#111827]",
                        MONO,
                      )}
                    >
                      {snippet}
                    </pre>
                  </div>
                </div>
              </li>
              <li className="relative flex items-start gap-3">
                <StepRail />
                <StepNum n={2} />
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="text-[14px] leading-[22px] font-semibold text-[#111827]">
                    Paste it into the page head
                  </span>
                  <span className="text-[14px] leading-5 text-pretty text-[#4B5563]">
                    Put it inside the{" "}
                    <code
                      className={cn(
                        "rounded-[5px] bg-[#F3F4F6] px-1.5 py-px text-[13px] text-[#B91C1C]",
                        MONO,
                      )}
                    >
                      &lt;head&gt;
                    </code>{" "}
                    of the tested page and the goal page, as high as you can and before other
                    scripts, so variants show without a flicker.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <StepNum n={3} />
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="text-[14px] leading-[22px] font-semibold text-[#111827]">
                    Publish your changes
                  </span>
                  <span className="text-[14px] leading-5 text-pretty text-[#4B5563]">
                    Then continue to check that Routely can see the script.
                  </span>
                </div>
              </li>
            </ol>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <AbDialogTitle className="text-[18px] leading-[26px] tracking-[-0.01em]">
                Verify your installation
              </AbDialogTitle>
              <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
                Routely will load each page in this experiment and confirm the script is installed
                and sending data.
              </p>
            </div>
            <section
              aria-labelledby="rt-inst-vs"
              role="status"
              className="flex flex-col overflow-hidden rounded-xl border bg-white"
              style={{ borderColor: tone.border }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-3"
                style={{ background: tone.bg, borderColor: tone.border }}
              >
                <h3
                  id="rt-inst-vs"
                  className="m-0 text-[14px] leading-5 font-semibold [overflow-wrap:anywhere]"
                  style={{ color: tone.ink }}
                >
                  {rTitle}
                </h3>
                <span
                  className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold whitespace-nowrap"
                  style={{ background: tone.pillBg, color: tone.pillFg }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ background: tone.dot }}
                  />
                  {tone.label}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col px-4 py-1">
                {rows.map((rc, i) => (
                  <li
                    key={rc.id}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderTop: "1px solid " + (i === 0 ? "transparent" : "#EEF0F3") }}
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-[22px] flex-none items-center justify-center rounded-full"
                      style={{ background: rc.iconBg, color: rc.fg }}
                    >
                      {rc.kind === "ok" ? <CheckIcon size={12} strokeWidth={3} /> : null}
                      {rc.kind === "fail" ? <XIcon size={12} strokeWidth={3} /> : null}
                      {rc.kind === "running" ? <Spinner size={12} strokeWidth={3} /> : null}
                      {rc.kind === "pending" ? (
                        <span className="block size-1.5 rounded-full bg-current" />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="text-[14px] leading-[19px] font-semibold text-[#111827]">
                        {rc.title}
                      </span>
                      <span className="text-[13px] leading-[19px] [overflow-wrap:anywhere] text-[#6B7280]">
                        {rc.text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {lastMissing ? (
                <div className="flex flex-col gap-1.5 border-t border-[#FECACA] bg-[#FEF2F2] px-4 pt-3 pb-3.5">
                  <span className="text-[13px] font-semibold text-[#111827]">Things to check</span>
                  <ul className="m-0 flex list-disc flex-col gap-1 py-0 pr-0 pl-[18px] text-[13px] leading-[19px] text-[#374151]">
                    <li>Make sure your changes are published, not just saved as a draft.</li>
                    <li>If you use a caching plugin or CDN, clear the cache and check again.</li>
                    <li>
                      Check that a cookie banner isn’t blocking the script until visitors accept.
                    </li>
                  </ul>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] bg-white px-6 py-3.5 max-[641px]:px-4 max-[641px]:py-3 max-[641px]:[&>*]:flex-auto max-[641px]:[&>*]:justify-center">
        {istep === 1 ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className={cn(cls.quiet, "h-9 px-1 text-[#4B5563]")}
            >
              I’ll set this up later
            </button>
            <button type="button" onClick={() => onStep(2)} className={cn(cls.primary, cls.tall)}>
              Next: Verify installation
              <ArrowRightIcon />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (!checking) onStep(1);
              }}
              disabled={checking}
              className={cn(cls.quiet, "h-9 gap-1.5 px-1 text-[#374151]")}
            >
              <ArrowLeftIcon />
              Back
            </button>
            <DialogActions>
              {vstate !== "success" ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={checking}
                    className={cn(cls.secondary, "px-4", cls.tall)}
                  >
                    I’ll finish later
                  </button>
                  <button
                    type="button"
                    onClick={onVerify}
                    disabled={checking}
                    className={cn(cls.primary, cls.tall)}
                  >
                    {checking ? <Spinner /> : null}
                    {checking ? "Checking…" : lastMissing ? "Check again" : "Verify installation"}
                  </button>
                </>
              ) : (
                <button type="button" onClick={onClose} className={cn(cls.primary, cls.tall)}>
                  Done
                </button>
              )}
            </DialogActions>
          </>
        )}
      </div>
    </AbDialog>
  );
}

function StepRail() {
  return (
    <span
      aria-hidden
      className="absolute top-[30px] bottom-[-14px] left-3 w-0.5 rounded-sm bg-[#F3F4F6]"
    />
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="relative z-[1] inline-flex size-[26px] flex-none items-center justify-center rounded-full border-[1.5px] border-[#D1D5DB] bg-white text-[13px] font-semibold text-[#374151]"
    >
      {n}
    </span>
  );
}

/** "Launch …?" — the configured split, inclusion, targeting and goal, then a 1.5s launch. */
export function LaunchDialog({
  open,
  launching,
  title,
  body,
  d,
  onClose,
  onConfirm,
}: {
  open: boolean;
  launching: boolean;
  title: string;
  body: string;
  d: Derived;
  onClose(): void;
  onConfirm(): void;
}) {
  return (
    <AbDialog open={open} onClose={onClose} busy={launching} width={480} className="gap-[18px] p-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <AbDialogTitle>{title}</AbDialogTitle>
        <p className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">{body}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-[#EEF0F3] bg-[#FAFBFC] p-3.5">
        {d.rv.arms.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 text-[14px]">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Swatch color={a.color} />
              <span className="font-medium text-[#374151]">{a.name}</span>
              <span className="text-[#6B7280]">{a.meta}</span>
            </span>
            <span className="font-semibold text-[#111827] tabular-nums">{a.pct}</span>
          </div>
        ))}
        <div className="h-px bg-[#F3F4F6]" />
        <Line k="Visitors included" v={d.rv.includeShort} />
        <Line k="Targeting" v={d.rv.targeting} />
        <Line k="Goal" v="Page view" />
      </div>
      <DialogActions>
        <button
          type="button"
          onClick={onClose}
          disabled={launching}
          className={cn(cls.secondary, "px-4")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={launching}
          className={cls.primary}
          style={{ background: ACCENT }}
        >
          {launching ? <Spinner /> : null}
          {launching ? "Launching…" : "Launch experiment"}
        </button>
      </DialogActions>
    </AbDialog>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-[#6B7280]">{k}</span>
      <span className="text-right font-medium text-[#374151]">{v}</span>
    </div>
  );
}
